import { PoolClient } from "pg";
import { ColumnaExportable } from "../exportacion/tabla";

// ---------------------------------------------------------------------
// LOS CINCO REPORTES DE CAJA — sección 9 del prompt 08.
//
// Estaban escritos dentro del `switch` de la ruta. Salen a su propio
// módulo porque ahora los piden DOS caminos —la pantalla en JSON y la
// exportación a Excel y PDF— y una consulta escrita dos veces es un
// reporte que un día dice dos cosas distintas. La definición de columnas
// vive acá al lado de su consulta por el mismo motivo: el archivo
// exportado y la tabla en pantalla tienen que tener las mismas columnas
// con los mismos nombres.
//
// DEFECTO CORREGIDO AL EXTRAERLOS: el reporte de CUENTAS POR COBRAR
// miraba solo `receptor_propietario_id`, es decir, solo las facturas a
// nombre de un cliente. Desde que el receptor puede ser un perfil de
// facturación (la empresa del dueño, una fundación), esas deudas
// quedaban FUERA del reporte: la clínica no veía lo que le debe su
// cliente corporativo más grande. Ahora el reporte une las dos.
// ---------------------------------------------------------------------

export type ReporteDeVentas =
  | "ventas"
  | "lineas-negocio"
  | "arqueos"
  | "aprobaciones"
  | "por-cobrar";

export interface ResultadoReporte {
  titulo: string;
  columnas: ColumnaExportable[];
  filas: Array<Record<string, unknown>>;
  /** Si el reporte ignora el período, se dice: el PDF lo imprime. */
  ignoraPeriodo?: boolean;
}

const COLUMNAS: Record<ReporteDeVentas, ColumnaExportable[]> = {
  ventas: [
    { clave: "cajero", titulo: "Cajero" },
    { clave: "caja", titulo: "Caja" },
    { clave: "medio_nombre", titulo: "Medio de pago" },
    { clave: "cobros", titulo: "Cobros", tipo: "numero" },
    { clave: "total", titulo: "Total", tipo: "dinero" },
  ],
  "lineas-negocio": [
    { clave: "linea", titulo: "Línea de negocio" },
    { clave: "lineas", titulo: "Líneas", tipo: "numero" },
    { clave: "neto", titulo: "Neto", tipo: "dinero" },
  ],
  arqueos: [
    { clave: "caja", titulo: "Caja" },
    { clave: "cajero", titulo: "Cerró" },
    { clave: "cerrada_en", titulo: "Cerrada", tipo: "fecha" },
    { clave: "diferencia_total", titulo: "Diferencia", tipo: "dinero" },
    { clave: "medios_con_diferencia", titulo: "Medios con diferencia", tipo: "numero" },
  ],
  aprobaciones: [
    { clave: "tipo", titulo: "Tipo" },
    { clave: "estado", titulo: "Estado" },
    { clave: "monto", titulo: "Monto", tipo: "dinero" },
    { clave: "motivo", titulo: "Motivo" },
    { clave: "solicitada_por", titulo: "Pidió" },
    { clave: "solicitada_en", titulo: "Pedida", tipo: "fecha" },
    { clave: "resuelta_por", titulo: "Resolvió" },
    { clave: "resuelta_en", titulo: "Resuelta", tipo: "fecha" },
  ],
  "por-cobrar": [
    { clave: "deudor", titulo: "Deudor" },
    { clave: "tipo_deudor", titulo: "Qué es" },
    { clave: "pendiente", titulo: "Pendiente", tipo: "dinero" },
    { clave: "mas_antigua", titulo: "Más antigua", tipo: "fecha" },
    { clave: "antiguedad_max_dias", titulo: "Antigüedad (días)", tipo: "numero" },
  ],
};

const TITULO: Record<ReporteDeVentas, string> = {
  ventas: "Ventas por cajero, caja y medio de pago",
  "lineas-negocio": "Ventas por línea de negocio",
  arqueos: "Arqueos y diferencias",
  aprobaciones: "Anulaciones, devoluciones y descuentos autorizados",
  "por-cobrar": "Cuentas por cobrar con antigüedad",
};

export function esReporteConocido(cual: string): cual is ReporteDeVentas {
  return cual in COLUMNAS;
}

export async function reporteDeVentas(
  db: PoolClient,
  cual: ReporteDeVentas,
  desde: string,
  hasta: string
): Promise<ResultadoReporte> {
  const rango = [desde, hasta];
  const base = { titulo: TITULO[cual], columnas: COLUMNAS[cual] };

  if (cual === "ventas") {
    // EL VUELTO SE RESTA DEL EFECTIVO.
    //
    // Sumar `monto_crc` a secas cuenta lo que el cliente ENTREGÓ, no lo
    // que quedó en la caja: una venta de ₡282,50 pagada con un billete
    // de ₡10 000 aparecía como ₡10 000 de efectivo. El arqueo sí
    // descuenta el vuelto (ver esperadoDeSesion), así que el reporte y
    // el arqueo decían dos cosas distintas del mismo efectivo.
    //
    // El vuelto es del cobro y no de un medio, así que se le carga a UNA
    // línea de efectivo del mismo cobro: la de colones si existe, si no
    // la de efectivo en dólares (una venta en dólares con vuelto en
    // colones es un caso real de esta caja).
    const r = await db.query(
      `WITH lineas AS (
         SELECT cm.cobro_id, cm.medio, cm.monto_crc, co.cobrado_por, co.sesion_id,
                co.vuelto_crc,
                row_number() OVER (
                  PARTITION BY cm.cobro_id
                  ORDER BY (cm.medio = '01' AND cm.moneda = 'CRC') DESC,
                           (cm.medio = '01') DESC,
                           cm.monto_crc DESC
                ) AS orden
           FROM vta_cobros co
           JOIN vta_cobro_medios cm ON cm.cobro_id = co.id
          WHERE co.estado = 'aplicado'
            AND co.creado_en >= $1::date AND co.creado_en < ($2::date + interval '1 day')
       )
       SELECT p.nombre AS cajero, caja.nombre AS caja, l.medio,
              mp.nombre AS medio_nombre,
              count(DISTINCT l.cobro_id)::int AS cobros,
              sum(
                l.monto_crc
                - CASE WHEN l.orden = 1 AND l.medio = '01' THEN l.vuelto_crc ELSE 0 END
              )::text AS total
         FROM lineas l
         JOIN vta_sesiones_caja s ON s.id = l.sesion_id
         JOIN vta_cajas caja ON caja.id = s.caja_id
         LEFT JOIN personas p ON p.id = l.cobrado_por
         LEFT JOIN fact_cat_medio_pago mp ON mp.codigo = l.medio
        GROUP BY p.nombre, caja.nombre, l.medio, mp.nombre
        ORDER BY caja.nombre, p.nombre`,
      rango
    );
    return { ...base, filas: r.rows };
  }

  if (cual === "lineas-negocio") {
    const r = await db.query(
      `SELECT COALESCE(ln.nombre, 'Sin línea') AS linea,
              sum(g.cantidad * g.precio_unitario - g.descuento)::text AS neto,
              count(*)::int AS lineas
         FROM vta_cargos g
         JOIN vta_cuentas cu ON cu.id = g.cuenta_id
         LEFT JOIN lineas_negocio ln ON ln.codigo = g.linea_negocio
        WHERE g.anulado_en IS NULL AND cu.estado = 'cobrada'
          AND g.creado_en >= $1::date AND g.creado_en < ($2::date + interval '1 day')
        GROUP BY ln.nombre ORDER BY 2 DESC`,
      rango
    );
    return { ...base, filas: r.rows };
  }

  if (cual === "arqueos") {
    const r = await db.query(
      `SELECT s.id, c.nombre AS caja, p.nombre AS cajero, s.cerrada_en,
              sum(al.diferencia)::text AS diferencia_total,
              count(*) FILTER (WHERE al.diferencia <> 0)::int AS medios_con_diferencia
         FROM vta_sesiones_caja s
         JOIN vta_cajas c ON c.id = s.caja_id
         LEFT JOIN personas p ON p.id = s.cerrada_por
         LEFT JOIN vta_arqueo_lineas al ON al.sesion_id = s.id
        WHERE s.estado = 'cerrada'
          AND s.cerrada_en >= $1::date AND s.cerrada_en < ($2::date + interval '1 day')
        GROUP BY s.id, c.nombre, p.nombre ORDER BY s.cerrada_en DESC`,
      rango
    );
    return { ...base, filas: r.rows };
  }

  if (cual === "aprobaciones") {
    const r = await db.query(
      `SELECT a.tipo, a.estado, a.monto, a.motivo, a.solicitada_en, a.resuelta_en,
              ps.nombre AS solicitada_por, pr.nombre AS resuelta_por
         FROM vta_aprobaciones a
         LEFT JOIN personas ps ON ps.id = a.solicitada_por
         LEFT JOIN personas pr ON pr.id = a.resuelta_por
        WHERE a.solicitada_en >= $1::date AND a.solicitada_en < ($2::date + interval '1 day')
        ORDER BY a.solicitada_en DESC`,
      rango
    );
    return { ...base, filas: r.rows };
  }

  // CUENTAS POR COBRAR: clientes Y perfiles de facturación.
  //
  // El saldo NO depende del período —es lo que se debe hoy— y por eso
  // este reporte ignora las fechas y lo dice.
  const r = await db.query(
    `WITH pendiente_por_factura AS (
       SELECT f.id, f.receptor_propietario_id, f.receptor_perfil_id, f.fecha_emision,
              f.total_comprobante
                - COALESCE((SELECT sum(aa.monto) FROM vta_abono_aplicaciones aa
                             WHERE aa.comprobante_id = f.id), 0) AS pendiente
         FROM fact_comprobantes f
        WHERE f.tipo_comprobante = '01' AND f.condicion_venta IN ('02','10')
          AND f.estado IN ('aceptado','aceptado_parcial','enviado','en_cola')
     )
     SELECT p.nombre AS deudor, 'cliente' AS tipo_deudor, p.id AS deudor_id,
            sum(pf.pendiente)::text AS pendiente,
            min(pf.fecha_emision)::date AS mas_antigua,
            max(CURRENT_DATE - pf.fecha_emision::date)::int AS antiguedad_max_dias
       FROM pendiente_por_factura pf
       JOIN propietarios p ON p.id = pf.receptor_propietario_id
      GROUP BY p.id, p.nombre
     HAVING sum(pf.pendiente) > 0
     UNION ALL
     SELECT pe.nombre, 'perfil de facturación', pe.id,
            sum(pf.pendiente)::text,
            min(pf.fecha_emision)::date,
            max(CURRENT_DATE - pf.fecha_emision::date)::int
       FROM pendiente_por_factura pf
       JOIN fact_perfiles_facturacion pe ON pe.id = pf.receptor_perfil_id
      GROUP BY pe.id, pe.nombre
     HAVING sum(pf.pendiente) > 0
      ORDER BY 4 DESC`
  );
  return { ...base, filas: r.rows, ignoraPeriodo: true };
}
