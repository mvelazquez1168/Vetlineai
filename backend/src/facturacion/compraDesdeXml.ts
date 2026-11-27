import { PoolClient } from "pg";
import { registrarMovimiento } from "../inventario/movimientos";

// ---------------------------------------------------------------------
// LA COMPRA QUE ENTRA DESDE EL XML DEL PROVEEDOR — prompt 09b, B2.
//
// El proveedor manda su factura electrónica; de ahí sale el costo exacto
// de cada producto, que es la base de todos los márgenes. Hoy ese XML se
// cargaba, se validaba y se respondía, y después alguien tecleaba la
// compra otra vez en inventario.
//
// LO QUE HACE QUE ESTO SIRVA LA SEGUNDA VEZ: la equivalencia. La primera
// compra de un proveedor se vincula a mano línea por línea; la
// equivalencia queda guardada con el CÓDIGO que ese proveedor usa, y la
// próxima factura del mismo proveedor llega con las líneas ya
// reconocidas. Sin eso, cada compra es el mismo trabajo manual y nadie
// lo usa dos veces.
//
// LO QUE NO HACE: adivinar. Una línea sin equivalencia queda sin
// vincular y la pantalla la muestra para resolverla; no se busca «por
// nombre parecido» para entrar un producto equivocado al inventario,
// que es un error que después aparece como un faltante de stock.
// ---------------------------------------------------------------------

export interface LineaDelXml {
  numeroLinea: number;
  codigoProveedor: string | null;
  descripcion: string;
  cantidad: number;
  unidadMedida: string | null;
  precioUnitario: number;
  montoTotal: number;
  /** Lo que ya se reconoció por la equivalencia, si existía. */
  productoId: string | null;
  presentacionId: string | null;
  productoNombre: string | null;
}

/** Lee las líneas de detalle del XML, sin interpretar nada. */
export function lineasDelXml(xml: string): LineaDelXml[] {
  const lineas: LineaDelXml[] = [];
  const bloques = xml.match(/<LineaDetalle>[\s\S]*?<\/LineaDetalle>/g) ?? [];
  for (const b of bloques) {
    const leer = (nombre: string): string | null => {
      const m = new RegExp(`<${nombre}>([^<]*)</${nombre}>`).exec(b);
      return m ? m[1].trim() : null;
    };
    // EL CÓDIGO DEL PROVEEDOR es `CodigoComercial/Codigo` con tipo 01
    // («código del producto del vendedor»), que es exactamente lo que
    // esto necesita. Si no viene, queda la descripción.
    const comercial = /<CodigoComercial>[\s\S]*?<Tipo>01<\/Tipo>[\s\S]*?<Codigo>([^<]+)<\/Codigo>[\s\S]*?<\/CodigoComercial>/.exec(
      b
    );
    lineas.push({
      numeroLinea: Number(leer("NumeroLinea") ?? lineas.length + 1),
      codigoProveedor: comercial ? comercial[1].trim() : null,
      descripcion: leer("Detalle") ?? "(sin detalle)",
      cantidad: Number(leer("Cantidad") ?? 0),
      unidadMedida: leer("UnidadMedida"),
      precioUnitario: Number(leer("PrecioUnitario") ?? 0),
      montoTotal: Number(leer("MontoTotalLinea") ?? leer("SubTotal") ?? 0),
      productoId: null,
      presentacionId: null,
      productoNombre: null,
    });
  }
  return lineas;
}

/**
 * Las líneas del comprobante recibido, con lo que la equivalencia ya
 * sabe de cada una.
 *
 * El proveedor se identifica por su cédula, que viene en el XML: así la
 * equivalencia es del proveedor real y no de quien alguien eligió en una
 * lista.
 */
export async function lineasParaVincular(
  db: PoolClient,
  recibidoId: string
): Promise<{
  lineas: LineaDelXml[];
  proveedorId: string | null;
  proveedorNombre: string | null;
  yaRegistrado: boolean;
}> {
  const r = await db.query<{
    xml_recibido: Buffer;
    emisor_identificacion: string | null;
    emisor_nombre: string | null;
    compra_id: string | null;
  }>(
    `SELECT xml_recibido, emisor_identificacion, emisor_nombre, compra_id
       FROM fact_recibidos WHERE id = $1`,
    [recibidoId]
  );
  if (r.rows.length === 0) throw new Error("Ese comprobante recibido no existe.");
  const xml = r.rows[0].xml_recibido.toString("utf-8");
  const lineas = lineasDelXml(xml);

  // El proveedor del catálogo que tenga esa identificación.
  const prov = await db.query<{ id: string; nombre: string }>(
    // La columna es `numero_identificacion`, verificada contra el
    // esquema. Se comparan solo los dígitos porque una cédula jurídica
    // se escribe con y sin guiones.
    `SELECT id, nombre FROM inv_proveedores
      WHERE regexp_replace(COALESCE(numero_identificacion,''), '[^0-9]', '', 'g') =
            regexp_replace(COALESCE($1,''), '[^0-9]', '', 'g')
        AND $1 IS NOT NULL
      LIMIT 1`,
    [r.rows[0].emisor_identificacion]
  );
  const proveedorId = prov.rows[0]?.id ?? null;

  if (proveedorId) {
    for (const l of lineas) {
      // Primero por código, que es la llave buena; si el proveedor no
      // manda código, por la descripción exacta que se guardó la vez
      // anterior. NO por parecido.
      const eq = await db.query<{
        producto_id: string;
        presentacion_compra_id: string | null;
        nombre: string;
      }>(
        `SELECT pp.producto_id, pp.presentacion_compra_id, p.nombre
           FROM inv_proveedor_productos pp
           JOIN inv_productos p ON p.id = pp.producto_id
          WHERE pp.proveedor_id = $1
            AND ( ($2::text IS NOT NULL AND pp.codigo_proveedor = $2)
               OR ($2::text IS NULL AND pp.descripcion_proveedor = $3) )
          LIMIT 1`,
        [proveedorId, l.codigoProveedor, l.descripcion]
      );
      if (eq.rows.length > 0) {
        l.productoId = eq.rows[0].producto_id;
        l.presentacionId = eq.rows[0].presentacion_compra_id;
        l.productoNombre = eq.rows[0].nombre;
      }
    }
  }

  return {
    lineas,
    proveedorId,
    proveedorNombre: prov.rows[0]?.nombre ?? r.rows[0].emisor_nombre,
    yaRegistrado: r.rows[0].compra_id !== null,
  };
}

export interface VinculoDeLinea {
  numeroLinea: number;
  productoId: string;
  presentacionId: string;
  /** Cuántas unidades de esa presentación entran. */
  cantidad: number;
  costoUnitario: number;
  lote?: { numero: string; vencimiento?: string | null };
  /** Guardar la equivalencia para las próximas compras. */
  recordar?: boolean;
}

export interface ResultadoCompra {
  compraId: string;
  movimientos: number;
  equivalenciasGuardadas: number;
}

/**
 * Registra la compra en inventario desde el comprobante recibido.
 *
 * UN COMPROBANTE NO SE REGISTRA DOS VECES: lo impone el índice único de
 * `fact_recibidos.compra_id` y se comprueba acá para poder decirlo en
 * castellano antes de que falle la base.
 *
 * Todo el stock entra por `registrarMovimiento`, que es el único camino
 * que sabe de lotes, de costos y de reservas. Un INSERT a mano en
 * `inv_movimientos` se salta el trigger que exige el lote.
 */
export async function registrarCompraDesdeXml(
  db: PoolClient,
  tenantId: string,
  recibidoId: string,
  datos: {
    proveedorId: string;
    bodegaId: string;
    vinculos: VinculoDeLinea[];
    personaId?: string;
  }
): Promise<ResultadoCompra> {
  const r = await db.query<{ compra_id: string | null; clave: string; fecha_emision: Date | null }>(
    `SELECT compra_id, clave, fecha_emision FROM fact_recibidos WHERE id = $1`,
    [recibidoId]
  );
  if (r.rows.length === 0) throw new Error("Ese comprobante recibido no existe.");
  if (r.rows[0].compra_id) {
    throw new Error("Ese comprobante ya se registró en inventario: una compra no entra dos veces.");
  }
  if (datos.vinculos.length === 0) {
    throw new Error("Hay que vincular al menos una línea a un producto del catálogo.");
  }

  // LA COMPRA ES UNA ORDEN DE COMPRA RECIBIDA.
  //
  // No hay una tabla `inv_compras`: `inv_movimientos.compra_id` apunta a
  // `inv_ordenes_compra`, que es donde el 06 modeló la compra. Así que
  // una compra que entra desde un XML crea su orden ya **recibida** —no
  // hubo orden previa, la factura llegó con la mercadería— y guarda la
  // clave del comprobante en `factura_proveedor`, que es lo que permite
  // llegar del movimiento de stock al XML que lo respalda.
  //
  // Lo pensé al revés primero y escribí un INSERT contra una tabla que
  // no existe; lo encontré consultando el esquema antes de correrlo.
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':inv_orden_compra'))`, [tenantId]);
  const ultimo = await db.query<{ numero: number }>(
    `SELECT COALESCE(max(numero), 0) AS numero FROM inv_ordenes_compra WHERE tenant_id = $1`,
    [tenantId]
  );
  const compra = await db.query<{ id: string }>(
    `INSERT INTO inv_ordenes_compra
       (tenant_id, numero, proveedor_id, bodega_id, estado, factura_proveedor, creado_por,
        recibida_en)
     VALUES ($1,$2,$3,$4,'recibida',$5,$6, COALESCE($7::timestamptz, now()))
     RETURNING id`,
    [
      tenantId,
      Number(ultimo.rows[0].numero) + 1,
      datos.proveedorId,
      datos.bodegaId,
      r.rows[0].clave,
      datos.personaId ?? null,
      r.rows[0].fecha_emision,
    ]
  );
  const compraId = compra.rows[0].id;

  let movimientos = 0;
  let equivalencias = 0;
  const lineasXml = await lineasParaVincular(db, recibidoId);

  for (const v of datos.vinculos) {
    const delXml = lineasXml.lineas.find((l) => l.numeroLinea === v.numeroLinea);
    const movs = await registrarMovimiento(db, tenantId, {
      tipo: "compra",
      productoId: v.productoId,
      bodegaId: datos.bodegaId,
      presentacionId: v.presentacionId,
      cantidadPresentacion: v.cantidad,
      lote: {
        numero: v.lote?.numero ?? `SIN-LOTE-${r.rows[0].clave.slice(-8)}`,
        vencimiento: v.lote?.vencimiento ?? null,
        costoUnitario: v.costoUnitario,
      },
      // `motivo` es un CÓDIGO del catálogo `inv_motivos` (30
      // caracteres) y no texto libre: el texto va en `motivo_detalle`.
      // Una compra no necesita motivo —el tipo de movimiento ya dice
      // que es una compra—, así que solo va el detalle con la clave del
      // comprobante que la respalda.
      motivoDetalle: `Comprobante ${r.rows[0].clave}`,
      personaId: datos.personaId,
      compraId,
    });
    movimientos += movs.length;

    // LA EQUIVALENCIA, para que la próxima factura del mismo proveedor
    // llegue reconocida.
    if (v.recordar !== false && delXml) {
      await db.query(
        `INSERT INTO inv_proveedor_productos
           (tenant_id, proveedor_id, producto_id, presentacion_compra_id, codigo_proveedor,
            descripcion_proveedor, ultimo_costo)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, proveedor_id, codigo_proveedor)
           WHERE codigo_proveedor IS NOT NULL
           DO UPDATE SET producto_id = EXCLUDED.producto_id,
                         presentacion_compra_id = EXCLUDED.presentacion_compra_id,
                         descripcion_proveedor = EXCLUDED.descripcion_proveedor,
                         ultimo_costo = EXCLUDED.ultimo_costo,
                         actualizado_en = now()`,
        [
          tenantId,
          datos.proveedorId,
          v.productoId,
          v.presentacionId,
          delXml.codigoProveedor,
          delXml.descripcion,
          v.costoUnitario,
        ]
      );
      equivalencias += 1;
    }
  }

  await db.query(
    `UPDATE fact_recibidos
        SET compra_id = $2, registrado_en_inventario = now(), registrado_por = $3
      WHERE id = $1`,
    [recibidoId, compraId, datos.personaId ?? null]
  );

  return { compraId, movimientos, equivalenciasGuardadas: equivalencias };
}
