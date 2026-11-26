import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// EL PUNTO ÚNICO por donde se mueve el stock.
//
// Caja, la atención, las compras, los ajustes y los conteos pasan TODOS
// por `registrarMovimiento`. Nadie escribe en `inv_lotes` por fuera.
//
// Qué garantiza, y por qué cada cosa está acá y no repartida:
//
//   1. **La conversión a unidad base se hace en UN lugar.** Quien llama
//      dice "2 cajas" o "150 ml" y acá se multiplica por el factor de la
//      presentación. Si cada llamador convirtiera, la caja de 20 estaría
//      escrita en cinco lugares y el día que pase a 24 se arreglarían
//      cuatro.
//
//   2. **La dirección no se elige acá tampoco.** El signo lo aplica un
//      trigger de la base leyendo `inv_tipos_movimiento.direccion`
//      (migración 095). Este módulo ni siquiera tiene un `if` que decida
//      sumar o restar: no hay forma de que una merma sume.
//
//   3. **FEFO por defecto.** Una salida sin lote elegido toma primero el
//      que vence antes, y puede repartirse entre varios lotes si el
//      primero no alcanza. Eso genera VARIOS movimientos, uno por lote,
//      que es lo correcto: el costo de cada salida es el del lote del
//      que salió.
//
//   4. **El envase abierto se registra solo.** Al primer fraccionamiento
//      de un lote con vida útil tras la apertura queda la fecha y su
//      vencimiento efectivo, que la base calcula como el menor de los
//      dos.
//
// Lo que NO hace: no decide precios, no factura y no sabe de pacientes
// más allá de guardar el vínculo que le pasen. Es inventario.
// ---------------------------------------------------------------------

export type DireccionMovimiento = "entrada" | "salida";

/** Los trece tipos, como los nombra el catálogo de la migración 095. */
export type TipoMovimiento =
  | "inventario_inicial"
  | "compra"
  | "devolucion_cliente"
  | "ajuste_positivo"
  | "traslado_entrante"
  | "venta"
  | "atencion"
  | "consumo_interno"
  | "merma"
  | "vencimiento"
  | "ajuste_negativo"
  | "traslado_saliente"
  | "devolucion_proveedor";

export interface SolicitudMovimiento {
  tipo: TipoMovimiento;
  productoId: string;
  bodegaId: string;

  /**
   * Cuánto. Se da de UNA de estas dos formas, nunca de las dos:
   * `cantidadBase` cuando quien llama ya trabaja en unidad base, o
   * `presentacionId` + `cantidadPresentacion` cuando se mueve "2 cajas".
   */
  cantidadBase?: string | number;
  presentacionId?: string;
  cantidadPresentacion?: string | number;

  /**
   * De qué lote sale o a cuál entra.
   *
   * En una ENTRADA es obligatorio identificar el lote: su número, su
   * vencimiento y su costo. Si el lote no existe se crea.
   *
   * En una SALIDA es opcional: sin lote se aplica FEFO.
   */
  lote?: {
    numero: string;
    vencimiento?: string | null;
    costoUnitario?: string | number;
  };
  /** Para forzar un lote concreto en una salida, en vez de FEFO. */
  loteId?: string;

  motivo?: string;
  motivoDetalle?: string;
  personaId?: string;

  /**
   * Deja salir stock RESERVADO para un encargo. Lo usa la entrega del
   * encargo, que es la única salida legítima de lo reservado; para
   * cualquier otra salida la reserva es un freno, y eso es el punto de
   * reservar.
   */
  ignorarReservas?: boolean;

  /** Los cuatro vínculos opcionales. Que no haya paciente es normal. */
  pacienteId?: string;
  atencionId?: string;
  comprobanteId?: string;
  compraId?: string;
  ajusteId?: string;
}

export interface MovimientoRegistrado {
  id: string;
  loteId: string;
  loteNumero: string;
  cantidadBase: string;
  costoUnitario: string;
  direccion: DireccionMovimiento;
}

interface ProductoParaMovimiento {
  id: string;
  unidad_base: string;
  vida_util_apertura_dias: number | null;
  permite_stock_negativo: boolean;
}

/** Normaliza un número que puede venir como texto con coma decimal. */
function aNumero(valor: string | number | undefined, queEs: string): number {
  if (valor === undefined || valor === null || valor === "") {
    throw new Error(`Falta ${queEs}.`);
  }
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`${queEs} no es un número: "${valor}".`);
  return n;
}

async function leerProducto(db: PoolClient, productoId: string): Promise<ProductoParaMovimiento> {
  const r = await db.query<ProductoParaMovimiento>(
    `SELECT id, unidad_base, vida_util_apertura_dias, permite_stock_negativo
       FROM inv_productos WHERE id = $1`,
    [productoId]
  );
  if (r.rows.length === 0) throw new Error(`No existe el producto ${productoId}.`);
  return r.rows[0];
}

async function direccionDe(db: PoolClient, tipo: string): Promise<DireccionMovimiento> {
  const r = await db.query<{ direccion: DireccionMovimiento }>(
    `SELECT direccion FROM inv_tipos_movimiento WHERE codigo = $1 AND activo`,
    [tipo]
  );
  if (r.rows.length === 0) {
    throw new Error(
      `"${tipo}" no es un tipo de movimiento de inventario. Los trece están en inv_tipos_movimiento.`
    );
  }
  return r.rows[0].direccion;
}

/**
 * Cuántas unidades base son, y con qué presentación se registró.
 *
 * Acá vive LA conversión. `2 cajas × factor 20 = 40 tabletas`.
 */
async function resolverCantidad(
  db: PoolClient,
  s: SolicitudMovimiento
): Promise<{ base: number; presentacionId: string | null; cantidadPresentacion: number | null }> {
  const porPresentacion = s.presentacionId !== undefined;
  const porBase = s.cantidadBase !== undefined;

  if (porPresentacion === porBase) {
    throw new Error(
      "Un movimiento se expresa en unidad base O con una presentación y su cantidad, nunca con las dos cosas ni con ninguna."
    );
  }

  if (porBase) {
    const base = aNumero(s.cantidadBase, "la cantidad en unidad base");
    if (base <= 0) throw new Error("La cantidad tiene que ser mayor que cero.");
    return { base, presentacionId: null, cantidadPresentacion: null };
  }

  const p = await db.query<{ factor: string; producto_id: string; nombre: string }>(
    `SELECT factor, producto_id, nombre FROM inv_presentaciones WHERE id = $1 AND activo`,
    [s.presentacionId]
  );
  if (p.rows.length === 0) {
    throw new Error(`No existe la presentación ${s.presentacionId} o está inactiva.`);
  }
  if (p.rows[0].producto_id !== s.productoId) {
    // Sin esto, mover "2 cajas" de un producto con el factor de otro
    // descontaría una cantidad inventada, y cuadraría igual.
    throw new Error(
      `La presentación "${p.rows[0].nombre}" no es de ese producto. Una presentación pertenece a un solo producto.`
    );
  }
  const cantidad = aNumero(s.cantidadPresentacion, "la cantidad de la presentación");
  if (cantidad <= 0) throw new Error("La cantidad tiene que ser mayor que cero.");

  return {
    base: cantidad * Number(p.rows[0].factor),
    presentacionId: s.presentacionId!,
    cantidadPresentacion: cantidad,
  };
}

/**
 * El lote de una ENTRADA: el que ya existe con ese número en esa bodega,
 * o uno nuevo.
 *
 * Si la entrada trae un costo distinto, el costo del lote se recalcula
 * como PROMEDIO PONDERADO con lo que ya había. No se pisa: pisarlo haría
 * que las unidades compradas baratas se valoricen al precio nuevo, y el
 * margen de lo ya vendido cambiaría hacia atrás.
 */
async function loteParaEntrada(
  db: PoolClient,
  tenantId: string,
  s: SolicitudMovimiento,
  cantidadBase: number
): Promise<{ id: string; numero: string; costoUnitario: number }> {
  if (!s.lote?.numero) {
    throw new Error(
      "Una entrada de inventario tiene que decir a qué lote entra: su número, y su vencimiento cuando el producto lo tenga."
    );
  }
  const costoNuevo = s.lote.costoUnitario === undefined ? 0 : aNumero(s.lote.costoUnitario, "el costo unitario");
  if (costoNuevo < 0) throw new Error("El costo unitario no puede ser negativo.");

  const existente = await db.query<{ id: string; cantidad: string; costo_unitario: string }>(
    `SELECT id, cantidad, costo_unitario FROM inv_lotes
      WHERE producto_id = $1 AND bodega_id = $2 AND numero = $3`,
    [s.productoId, s.bodegaId, s.lote.numero]
  );

  if (existente.rows.length === 0) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO inv_lotes (tenant_id, producto_id, bodega_id, numero, vencimiento,
                              costo_unitario, cantidad)
       VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id`,
      [tenantId, s.productoId, s.bodegaId, s.lote.numero, s.lote.vencimiento ?? null, costoNuevo]
    );
    return { id: r.rows[0].id, numero: s.lote.numero, costoUnitario: costoNuevo };
  }

  const fila = existente.rows[0];
  const cantidadPrevia = Number(fila.cantidad);
  const costoPrevio = Number(fila.costo_unitario);
  let costoFinal = costoPrevio;

  if (s.lote.costoUnitario !== undefined) {
    const total = cantidadPrevia + cantidadBase;
    costoFinal =
      total > 0 ? (cantidadPrevia * costoPrevio + cantidadBase * costoNuevo) / total : costoNuevo;
    await db.query(`UPDATE inv_lotes SET costo_unitario = $2 WHERE id = $1`, [fila.id, costoFinal]);
  }
  if (s.lote.vencimiento) {
    await db.query(
      `UPDATE inv_lotes SET vencimiento = $2 WHERE id = $1 AND vencimiento IS DISTINCT FROM $2`,
      [fila.id, s.lote.vencimiento]
    );
  }

  return { id: fila.id, numero: s.lote.numero, costoUnitario: costoFinal };
}

interface LoteDisponible {
  id: string;
  numero: string;
  cantidad: string;
  costo_unitario: string;
}

/**
 * CUÁNTO DE CADA LOTE ESTÁ RESERVADO PARA UN ENCARGO, y para quién.
 *
 * Esta consulta mira una tabla de ventas (`vta_encargos`) desde el
 * módulo de inventario, y es a propósito: la reserva es un hecho SOBRE
 * EL LOTE, y el único lugar por donde sale stock es `registrarMovimiento`.
 * La alternativa —que cada quien consulte la reserva antes de mover—
 * es exactamente la regla escrita en varios lugares que la guía
 * rectora prohíbe, y el día que alguien se olvide, el producto que se
 * pidió para un cliente se le vende a otro sin que nada avise.
 */
async function reservasPorLote(
  db: PoolClient,
  loteIds: string[]
): Promise<Map<string, { cantidad: number; para: string }>> {
  const reservas = new Map<string, { cantidad: number; para: string }>();
  if (loteIds.length === 0) return reservas;

  const r = await db.query<{ lote: string; cantidad: string; para: string }>(
    `SELECT e.lote_reservado_id AS lote,
            sum(e.cantidad_reservada)::text AS cantidad,
            string_agg(DISTINCT p.nombre, ', ') AS para
       FROM vta_encargos e
       JOIN propietarios p ON p.id = e.propietario_id
      WHERE e.lote_reservado_id = ANY($1::uuid[])
        AND e.estado IN ('recibido', 'avisado')
        AND e.cantidad_reservada > 0
      GROUP BY e.lote_reservado_id`,
    [loteIds]
  );
  for (const f of r.rows) {
    reservas.set(f.lote, { cantidad: Number(f.cantidad), para: f.para });
  }
  return reservas;
}

/**
 * Los lotes de los que puede salir, en orden FEFO: primero el que vence
 * antes. Los que no tienen vencimiento van al final — no vencer no es
 * razón para salir primero.
 *
 * `FOR UPDATE` bloquea las filas hasta el COMMIT: es lo que hace que dos
 * salidas simultáneas de la última unidad se serialicen en vez de leer
 * las dos el mismo "queda 1".
 */
async function lotesParaSalida(
  db: PoolClient,
  s: SolicitudMovimiento
): Promise<LoteDisponible[]> {
  if (s.loteId) {
    const r = await db.query<LoteDisponible>(
      `SELECT id, numero, cantidad, costo_unitario FROM inv_lotes
        WHERE id = $1 AND producto_id = $2 AND bodega_id = $3
        FOR UPDATE`,
      [s.loteId, s.productoId, s.bodegaId]
    );
    if (r.rows.length === 0) {
      throw new Error(`El lote ${s.loteId} no es de ese producto en esa bodega.`);
    }
    return r.rows;
  }

  const r = await db.query<LoteDisponible>(
    `SELECT id, numero, cantidad, costo_unitario FROM inv_lotes
      WHERE producto_id = $1 AND bodega_id = $2 AND cantidad > 0
      ORDER BY vencimiento_efectivo ASC NULLS LAST, creado_en ASC
      FOR UPDATE`,
    [s.productoId, s.bodegaId]
  );
  return r.rows;
}

/**
 * Marca el lote como ABIERTO si el producto tiene vida útil tras la
 * apertura y es la primera vez que se fracciona.
 *
 * "Se fracciona" = sale una cantidad menor que la existencia del lote.
 * El vencimiento efectivo lo calcula la base como el menor entre el del
 * lote y el de la apertura; acá solo se escriben las dos fechas.
 */
async function registrarAperturaSiCorresponde(
  db: PoolClient,
  producto: ProductoParaMovimiento,
  loteId: string,
  cantidadQueSale: number,
  cantidadDisponible: number
): Promise<void> {
  if (!producto.vida_util_apertura_dias) return;
  if (cantidadQueSale >= cantidadDisponible) return; // se lleva el envase entero

  await db.query(
    `UPDATE inv_lotes
        SET fecha_apertura = CURRENT_DATE,
            vencimiento_apertura = CURRENT_DATE + ($2 || ' days')::interval
      WHERE id = $1 AND fecha_apertura IS NULL`,
    [loteId, producto.vida_util_apertura_dias]
  );
}

/**
 * Registra un movimiento de stock. **El único camino.**
 *
 * Devuelve UN resultado por lote tocado: una salida por FEFO que se
 * reparte entre dos lotes devuelve dos, porque son dos movimientos con
 * costos distintos.
 *
 * Recibe la transacción abierta (`db`) en vez de abrirla: quien llama
 * —una venta, el cierre de una atención, la recepción de una compra—
 * necesita que el movimiento sea atómico con lo suyo.
 */
export async function registrarMovimiento(
  db: PoolClient,
  tenantId: string,
  solicitud: SolicitudMovimiento
): Promise<MovimientoRegistrado[]> {
  const direccion = await direccionDe(db, solicitud.tipo);
  const producto = await leerProducto(db, solicitud.productoId);
  const { base, presentacionId, cantidadPresentacion } = await resolverCantidad(db, solicitud);

  const insertar = async (
    loteId: string,
    loteNumero: string,
    cantidad: number,
    costo: number,
    cantidadPres: number | null
  ): Promise<MovimientoRegistrado> => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO inv_movimientos (
         tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base,
         presentacion_id, cantidad_presentacion, costo_unitario,
         motivo, motivo_detalle, persona_id,
         paciente_id, atencion_id, comprobante_id, compra_id, ajuste_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        tenantId,
        solicitud.tipo,
        solicitud.productoId,
        solicitud.bodegaId,
        loteId,
        cantidad,
        presentacionId,
        cantidadPres,
        costo,
        solicitud.motivo ?? null,
        solicitud.motivoDetalle ?? null,
        solicitud.personaId ?? null,
        solicitud.pacienteId ?? null,
        solicitud.atencionId ?? null,
        solicitud.comprobanteId ?? null,
        solicitud.compraId ?? null,
        solicitud.ajusteId ?? null,
      ]
    );
    return {
      id: r.rows[0].id,
      loteId,
      loteNumero,
      cantidadBase: String(cantidad),
      costoUnitario: String(costo),
      direccion,
    };
  };

  // --- ENTRADA: un solo lote, el que dice la solicitud ---------------
  if (direccion === "entrada") {
    const lote = await loteParaEntrada(db, tenantId, solicitud, base);
    return [await insertar(lote.id, lote.numero, base, lote.costoUnitario, cantidadPresentacion)];
  }

  // --- SALIDA: FEFO, repartiendo entre lotes si hace falta -----------
  const disponibles = await lotesParaSalida(db, solicitud);
  const total = disponibles.reduce((a, l) => a + Number(l.cantidad), 0);

  if (disponibles.length === 0) {
    throw new Error(
      `No hay existencia de ese producto en esa bodega, así que no puede salir ${base} ${producto.unidad_base}.`
    );
  }

  // Lo reservado para un encargo no está disponible para nadie más.
  const reservas = solicitud.ignorarReservas
    ? new Map<string, { cantidad: number; para: string }>()
    : await reservasPorLote(db, disponibles.map((l) => l.id));
  const libreEn = (lote: LoteDisponible) =>
    Number(lote.cantidad) - (reservas.get(lote.id)?.cantidad ?? 0);
  const libre = disponibles.reduce((a, l) => a + Math.max(0, libreEn(l)), 0);
  const reservadoTotal = total - disponibles.reduce((a, l) => a + Math.min(Number(l.cantidad), Math.max(0, libreEn(l))), 0);

  if (total < base && !producto.permite_stock_negativo) {
    throw new Error(
      `Hay ${total} ${producto.unidad_base} y la salida es de ${base}. El producto no admite stock negativo: si la salida es correcta, primero hay que registrar la entrada que falta.`
    );
  }
  if (libre < base && reservadoTotal > 0 && !producto.permite_stock_negativo) {
    const para = [...reservas.values()].map((v) => v.para).join(", ");
    throw new Error(
      `De los ${total} ${producto.unidad_base} que hay, ${reservadoTotal} están reservados para un encargo de ${para}, así que quedan ${libre} libres y la salida es de ${base}. Si hay que entregarle el encargo, se hace desde Encargos; si el encargo se cayó, hay que cancelarlo primero.`
    );
  }

  const hechos: MovimientoRegistrado[] = [];
  let porRepartir = base;

  for (const lote of disponibles) {
    if (porRepartir <= 0) break;
    const hay = Math.max(0, libreEn(lote));
    // El último lote absorbe el resto aunque quede negativo: solo se
    // llega acá si el producto lo permite, porque si no ya se lanzó.
    const esUltimo = lote === disponibles[disponibles.length - 1];
    const toma = esUltimo ? porRepartir : Math.min(hay, porRepartir);
    if (toma <= 0) continue;

    await registrarAperturaSiCorresponde(db, producto, lote.id, toma, hay);

    const proporcion = cantidadPresentacion !== null ? (toma / base) * cantidadPresentacion : null;
    hechos.push(
      await insertar(lote.id, lote.numero, toma, Number(lote.costo_unitario), proporcion)
    );
    porRepartir -= toma;
  }

  return hechos;
}

/**
 * Un traslado entre bodegas: una salida y una entrada LIGADAS.
 *
 * Son dos movimientos y no uno porque el stock sale de un lote de una
 * bodega y entra a otro lote de otra: un solo movimiento no podría
 * decir de cuál a cuál. `movimiento_par_id` los une, para que el kardex
 * muestre un traslado y no una merma seguida de una aparición.
 */
export async function registrarTraslado(
  db: PoolClient,
  tenantId: string,
  datos: {
    productoId: string;
    bodegaOrigenId: string;
    bodegaDestinoId: string;
    cantidadBase?: string | number;
    presentacionId?: string;
    cantidadPresentacion?: string | number;
    loteId?: string;
    personaId?: string;
    motivoDetalle?: string;
  }
): Promise<{ salidas: MovimientoRegistrado[]; entradas: MovimientoRegistrado[] }> {
  if (datos.bodegaOrigenId === datos.bodegaDestinoId) {
    throw new Error("El origen y el destino de un traslado no pueden ser la misma bodega.");
  }

  const salidas = await registrarMovimiento(db, tenantId, {
    tipo: "traslado_saliente",
    productoId: datos.productoId,
    bodegaId: datos.bodegaOrigenId,
    cantidadBase: datos.cantidadBase,
    presentacionId: datos.presentacionId,
    cantidadPresentacion: datos.cantidadPresentacion,
    loteId: datos.loteId,
    personaId: datos.personaId,
    motivoDetalle: datos.motivoDetalle,
  });

  const entradas: MovimientoRegistrado[] = [];
  for (const salida of salidas) {
    // Cada lote de origen entra como un lote con el MISMO número en el
    // destino, conservando su costo: trasladar no cambia lo que costó.
    const info = await db.query<{ numero: string; vencimiento: string | null }>(
      `SELECT numero, to_char(vencimiento, 'YYYY-MM-DD') AS vencimiento
         FROM inv_lotes WHERE id = $1`,
      [salida.loteId]
    );
    const entrada = await registrarMovimiento(db, tenantId, {
      tipo: "traslado_entrante",
      productoId: datos.productoId,
      bodegaId: datos.bodegaDestinoId,
      cantidadBase: salida.cantidadBase,
      lote: {
        numero: info.rows[0].numero,
        vencimiento: info.rows[0].vencimiento,
        costoUnitario: salida.costoUnitario,
      },
      personaId: datos.personaId,
      motivoDetalle: datos.motivoDetalle,
    });
    entradas.push(...entrada);

    await db.query(`UPDATE inv_movimientos SET movimiento_par_id = $2 WHERE id = $1`, [
      salida.id,
      entrada[0].id,
    ]);
    await db.query(`UPDATE inv_movimientos SET movimiento_par_id = $2 WHERE id = $1`, [
      entrada[0].id,
      salida.id,
    ]);
  }

  return { salidas, entradas };
}
