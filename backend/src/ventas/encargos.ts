import { PoolClient } from "pg";
import { crearOrden } from "../inventario/compras";
import { registrarMovimiento } from "../inventario/movimientos";
import { agregarCargo } from "./cuentas";
import { deudorCliente, registrarAnticipo, saldoAFavor } from "./credito";

// ---------------------------------------------------------------------
// ENCARGOS ESPECIALES — prompt 08, sección de encargos.
//
// El ciclo completo que el prompt pide verificar es "encargo con
// anticipo que llega, reserva stock, avisa y se entrega". Las seis
// transiciones de estado estaban en la ruta como un UPDATE, y eso
// alcanzaba para mover el estado pero no para las tres cosas que pasan
// alrededor:
//
//   * **el anticipo**: se cobra al registrar el encargo, y es dinero
//     que entra a la caja antes de que exista el producto;
//   * **la orden de compra**: "pedido al proveedor" es, literalmente,
//     una orden de compra del inventario. Tenerlas separadas obliga a
//     cargar el mismo pedido dos veces;
//   * **la entrega**: descarga el lote reservado, cobra por la cuenta
//     normal y aplica el anticipo. Antes de esto, un encargo entregado
//     no dejaba rastro de dinero ni de stock.
//
// LA RESERVA NO VIVE ACÁ: `registrarMovimiento` es el que la respeta,
// porque es el único lugar por donde sale stock. Acá solo se marca.
//
// EL AVISO AL CLIENTE sigue sin salir solo: el canal lo da el CRM.
// Hasta entonces el encargo en estado `recibido` es la lista de a quién
// llamar, y `marcarAvisado` registra que se llamó.
// ---------------------------------------------------------------------

export type EstadoEncargo =
  | "pendiente"
  | "pedido"
  | "recibido"
  | "avisado"
  | "entregado"
  | "cancelado";

/** Las transiciones permitidas. Una tabla, no quince `if`. */
const SIGUIENTES: Record<EstadoEncargo, EstadoEncargo[]> = {
  pendiente: ["pedido", "cancelado"],
  pedido: ["recibido", "cancelado"],
  recibido: ["avisado", "entregado", "cancelado"],
  avisado: ["entregado", "cancelado"],
  entregado: [],
  cancelado: [],
};

interface EncargoEnBase {
  id: string;
  propietario_id: string;
  producto_id: string | null;
  descripcion: string;
  cantidad: string;
  estado: EstadoEncargo;
  orden_compra_id: string | null;
  lote_reservado_id: string | null;
  cantidad_reservada: string;
}

async function leer(db: PoolClient, encargoId: string): Promise<EncargoEnBase> {
  const r = await db.query<EncargoEnBase>(
    `SELECT id, propietario_id, producto_id, descripcion, cantidad, estado,
            orden_compra_id, lote_reservado_id, cantidad_reservada
       FROM vta_encargos WHERE id = $1`,
    [encargoId]
  );
  if (r.rows.length === 0) throw new Error(`No existe el encargo ${encargoId}.`);
  return r.rows[0];
}

function exigirTransicion(desde: EstadoEncargo, hacia: EstadoEncargo): void {
  if (!SIGUIENTES[desde].includes(hacia)) {
    throw new Error(
      `Un encargo "${desde}" no puede pasar a "${hacia}". Desde "${desde}" se puede ir a: ` +
        (SIGUIENTES[desde].join(", ") || "ningún estado, es final")
    );
  }
}

/**
 * Registra el encargo y, si el cliente deja algo, su anticipo.
 *
 * El anticipo va por `registrarAnticipo`, el mismo que usa la caja: no
 * emite comprobante al recibirse (ver la nota fiscal de `credito.ts`) y
 * queda como saldo a favor del cliente, ligado a este encargo.
 */
export async function crearEncargo(
  db: PoolClient,
  tenantId: string,
  datos: {
    propietarioId: string;
    productoId?: string | null;
    descripcion: string;
    cantidad: number;
    anticipo?: number;
    sesionId?: string;
    personaId?: string;
  }
): Promise<{ id: string; anticipoId?: string }> {
  if (!datos.descripcion?.trim()) {
    throw new Error("Un encargo necesita su descripción: es lo que se le va a pedir al proveedor.");
  }
  if (!(datos.cantidad > 0)) throw new Error("La cantidad del encargo tiene que ser mayor que cero.");

  const r = await db.query<{ id: string }>(
    `INSERT INTO vta_encargos (tenant_id, propietario_id, producto_id, descripcion, cantidad,
                               creado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      tenantId,
      datos.propietarioId,
      datos.productoId ?? null,
      datos.descripcion.trim(),
      datos.cantidad,
      datos.personaId ?? null,
    ]
  );
  const id = r.rows[0].id;

  if (datos.anticipo && datos.anticipo > 0) {
    if (!datos.sesionId) {
      throw new Error(
        "Un anticipo entra a una caja: hace falta una sesión de caja abierta para recibirlo."
      );
    }
    const a = await registrarAnticipo(db, tenantId, {
      // El anticipo de un encargo es del CLIENTE que lo encargó, no de
      // un perfil de facturación: el encargo es del dueño.
      deudor: deudorCliente(datos.propietarioId),
      sesionId: datos.sesionId,
      motivo: `Anticipo del encargo: ${datos.descripcion.trim()}`,
      monto: datos.anticipo,
      encargoId: id,
      personaId: datos.personaId,
    });
    return { id, anticipoId: a.id };
  }

  return { id };
}

/**
 * "Pedido al proveedor" con la orden de compra de verdad.
 *
 * Si se dice el proveedor y la presentación, se crea la orden por
 * `crearOrden` —la misma del inventario, con su consecutivo y su
 * recepción— y queda ligada al encargo. Sin esos datos el estado pasa
 * igual: una clínica que pide por WhatsApp no tiene por qué cargar una
 * orden, y bloquear el estado por eso dejaría el encargo mintiendo en
 * "pendiente".
 */
export async function pedirAlProveedor(
  db: PoolClient,
  tenantId: string,
  encargoId: string,
  datos: {
    proveedorId?: string;
    bodegaId?: string;
    presentacionId?: string;
    costoUnitario?: number;
    ordenCompraId?: string;
    personaId?: string;
  } = {}
): Promise<{ ordenCompraId: string | null; numeroOrden?: number }> {
  const e = await leer(db, encargoId);
  exigirTransicion(e.estado, "pedido");

  let ordenId = datos.ordenCompraId ?? null;
  let numero: number | undefined;

  if (!ordenId && datos.proveedorId && datos.bodegaId && datos.presentacionId) {
    if (!e.producto_id) {
      throw new Error(
        "Para armar la orden de compra el encargo tiene que apuntar a un producto del catálogo. " +
          "Si es algo que no está en el catálogo, se pide por fuera y el estado se cambia sin orden."
      );
    }
    const orden = await crearOrden(db, tenantId, {
      proveedorId: datos.proveedorId,
      bodegaId: datos.bodegaId,
      estado: "aprobada",
      creadoPor: datos.personaId,
      lineas: [
        {
          productoId: e.producto_id,
          presentacionId: datos.presentacionId,
          cantidadPedida: Number(e.cantidad),
          costoUnitario: datos.costoUnitario,
          explicacion: `Encargo de un cliente: ${e.descripcion}`,
        },
      ],
    });
    ordenId = orden.id;
    numero = orden.numero;
  }

  await db.query(
    `UPDATE vta_encargos
        SET estado = 'pedido', orden_compra_id = COALESCE($2, orden_compra_id)
      WHERE id = $1`,
    [encargoId, ordenId]
  );
  return { ordenCompraId: ordenId, numeroOrden: numero };
}

/**
 * Llegó: se reserva del stock.
 *
 * Sin lote se toma el que vence primero del producto en esa bodega —el
 * mismo criterio FEFO que usa cualquier salida—, porque reservar el que
 * vence último dejaría el otro para vender y después habría que tirarlo.
 */
export async function marcarRecibido(
  db: PoolClient,
  encargoId: string,
  datos: { loteId?: string; bodegaId?: string } = {}
): Promise<{ loteId: string; reservado: number }> {
  const e = await leer(db, encargoId);
  exigirTransicion(e.estado, "recibido");

  let loteId = datos.loteId ?? null;
  if (!loteId) {
    if (!e.producto_id) {
      throw new Error(
        "Este encargo no apunta a un producto del catálogo, así que no hay lote que reservar. " +
          "Decí de qué lote se reserva, o entregalo como cargo manual."
      );
    }
    const r = await db.query<{ id: string }>(
      `SELECT id FROM inv_lotes
        WHERE producto_id = $1 AND cantidad > 0
          AND ($2::uuid IS NULL OR bodega_id = $2::uuid)
        ORDER BY vencimiento_efectivo ASC NULLS LAST, creado_en ASC
        LIMIT 1`,
      [e.producto_id, datos.bodegaId ?? null]
    );
    if (r.rows.length === 0) {
      throw new Error(
        "No hay existencia de ese producto, así que no hay nada que reservar. " +
          "Primero se registra la entrada de la compra."
      );
    }
    loteId = r.rows[0].id;
  }

  await db.query(
    `UPDATE vta_encargos
        SET estado = 'recibido', lote_reservado_id = $2, cantidad_reservada = cantidad
      WHERE id = $1`,
    [encargoId, loteId]
  );
  return { loteId, reservado: Number(e.cantidad) };
}

export async function marcarAvisado(db: PoolClient, encargoId: string): Promise<void> {
  const e = await leer(db, encargoId);
  exigirTransicion(e.estado, "avisado");
  await db.query(
    `UPDATE vta_encargos SET estado = 'avisado', avisado_en = now() WHERE id = $1`,
    [encargoId]
  );
}

/**
 * La entrega: descarga el lote reservado, lo deja como cargo en una
 * cuenta y aplica el anticipo que el cliente había dejado.
 *
 * El cargo entra por `agregarCargo` con origen `encargo`, así que paga
 * y factura por el camino normal, y el anticipo se aplica al cobrar con
 * el medio `anticipo`. La salida de stock pasa `ignorarReservas` porque
 * es la única salida para la que la reserva existe.
 *
 * LA RESERVA SE LIBERA SIEMPRE, tanto acá como en la cancelación: una
 * reserva que sobrevive a la entrega inmoviliza stock que ya no está.
 */
export async function entregar(
  db: PoolClient,
  tenantId: string,
  encargoId: string,
  datos: {
    cuentaId: string;
    presentacionId?: string;
    precioUnitario?: number;
    bodegaId?: string;
    personaId?: string;
  }
): Promise<{ cargoId: string; anticipoDisponible: number; movimientoId?: string }> {
  const e = await leer(db, encargoId);
  exigirTransicion(e.estado, "entregado");

  // El stock sale del lote reservado, no por FEFO: lo que se le
  // entrega al cliente es lo que se le apartó.
  let movimientoId: string | undefined;
  if (e.producto_id && e.lote_reservado_id) {
    const mov = await registrarMovimiento(db, tenantId, {
      tipo: "venta",
      productoId: e.producto_id,
      bodegaId: datos.bodegaId ?? (await bodegaDelLote(db, e.lote_reservado_id)),
      loteId: e.lote_reservado_id,
      // LA CANTIDAD DEL ENCARGO SE CUENTA EN LA PRESENTACIÓN QUE SE
      // ENTREGA. Con presentación, "2" son dos cajas tanto para el
      // stock como para el precio del cargo; sin presentación, son dos
      // unidades base. Lo que no puede pasar es que el stock la lea en
      // base y el cargo la cobre por caja.
      ...(datos.presentacionId
        ? { presentacionId: datos.presentacionId, cantidadPresentacion: Number(e.cantidad) }
        : { cantidadBase: Number(e.cantidad) }),
      ignorarReservas: true,
      // Sin `motivo`: el catálogo `inv_motivos` es de mermas y ajustes
      // ("vencido", "rotura", "diferencia_conteo"). Una venta no tiene
      // motivo, tiene cliente.
      personaId: datos.personaId,
    });
    movimientoId = mov[0]?.id;
  }

  // El cargo NO vuelve a descargar inventario: ya salió arriba, del
  // lote reservado. `sinDescargo` existe para esto.
  const cargo = await agregarCargo(db, tenantId, {
    cuentaId: datos.cuentaId,
    origen: "encargo",
    origenId: encargoId,
    presentacionId: datos.presentacionId,
    descripcion: e.descripcion,
    cantidad: Number(e.cantidad),
    precioUnitario: datos.precioUnitario,
    sinDescargo: true,
    personaId: datos.personaId,
    // Un encargo se cotizó cuando se pidió: si no viene precio, manda
    // el del catálogo, no una lista de hoy.
    listaPrecioId: null,
  });

  // EL ANTICIPO NO SE CONSUME ACÁ, y la primera versión de esto lo
  // hacía: llamaba a `aplicarAnticipos` al entregar. El resultado era
  // que el saldo a favor del cliente desaparecía y la cuenta seguía
  // debiendo el total — la plata se evaporaba en el camino.
  //
  // Un anticipo se aplica AL COBRAR, como medio `anticipo`, que es el
  // único lugar donde queda un `vta_cobros` que baje el saldo de la
  // cuenta. Acá solo se informa cuánto hay disponible para que la
  // pantalla de cobro lo proponga.
  const anticipo = await db.query<{ resta: string }>(
    `SELECT COALESCE(sum(monto - aplicado), 0)::text AS resta
       FROM vta_anticipos
      WHERE encargo_id = $1 AND estado = 'disponible'`,
    [encargoId]
  );
  const disponible = Math.min(Number(anticipo.rows[0].resta), cargo.total);

  await db.query(
    `UPDATE vta_encargos
        SET estado = 'entregado', entregado_en = now(), cantidad_reservada = 0
      WHERE id = $1`,
    [encargoId]
  );

  return { cargoId: cargo.id, anticipoDisponible: disponible, movimientoId };
}

/**
 * Cancelar.
 *
 * El anticipo NO se borra: queda como saldo a favor del cliente, que es
 * lo que de hecho es. Devolverlo en efectivo es una devolución y pasa
 * por su propia aprobación; hacerlo desaparecer acá sería perder plata
 * de alguien en un cambio de estado.
 */
export async function cancelar(
  db: PoolClient,
  encargoId: string,
  motivo?: string
): Promise<{ saldoAFavorDelCliente: number }> {
  const e = await leer(db, encargoId);
  exigirTransicion(e.estado, "cancelado");

  await db.query(
    `UPDATE vta_encargos
        SET estado = 'cancelado', cantidad_reservada = 0,
            descripcion = CASE WHEN $2::varchar IS NULL THEN descripcion
                               ELSE left(descripcion || ' (cancelado: ' || $2::varchar || ')', 200)
                          END
      WHERE id = $1`,
    [encargoId, motivo?.trim() || null]
  );

  return { saldoAFavorDelCliente: await saldoAFavor(db, deudorCliente(e.propietario_id)) };
}

async function bodegaDelLote(db: PoolClient, loteId: string): Promise<string> {
  const r = await db.query<{ bodega_id: string }>(
    `SELECT bodega_id FROM inv_lotes WHERE id = $1`,
    [loteId]
  );
  if (r.rows.length === 0) throw new Error("El lote reservado ya no existe.");
  return r.rows[0].bodega_id;
}
