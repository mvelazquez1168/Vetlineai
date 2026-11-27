import { PoolClient } from "pg";
import { ColumnaExportable, TablaExportable } from "../exportacion/tabla";

// ---------------------------------------------------------------------
// LA EXPORTACIÓN PARA EL CONTADOR — prompt 10a, §6.
//
// Cinco tablas por período: ventas, compras y gastos, pagos a
// proveedores, cobros, y movimientos de inventario valorizados.
//
// LAS COLUMNAS SON FIJAS Y ESTÁN DOCUMENTADAS en
// `docs/finanzas/exportacion-contable.md`. Esa es la mitad del trabajo:
// un contador que recibe un archivo con columnas distintas cada mes
// tiene que volver a armar su plantilla cada mes.
//
// EL FORMATO DE IMPORTACIÓN DE UN SOFTWARE CONTABLE ESPECÍFICO NO SE
// CONSTRUYE —lo dice el prompt— y el informe documenta qué haría falta.
// Lo que sale es un Excel/CSV con las columnas de abajo, que es lo que
// un contador puede usar hoy.
//
// SE REUSA `exportacion/tabla.ts`: el mismo escritor de .xlsx del kardex
// y de los reportes de caja. Un segundo escritor sería un segundo
// formato de fecha en el mismo sistema.
// ---------------------------------------------------------------------

export type Cuaderno =
  | "ventas"
  | "compras_gastos"
  | "pagos"
  | "cobros"
  | "inventario_valorizado";

export const CUADERNOS: Array<{ clave: Cuaderno; titulo: string }> = [
  { clave: "ventas", titulo: "Ventas (comprobantes emitidos)" },
  { clave: "compras_gastos", titulo: "Compras y gastos" },
  { clave: "pagos", titulo: "Pagos a proveedores" },
  { clave: "cobros", titulo: "Cobros" },
  { clave: "inventario_valorizado", titulo: "Movimientos de inventario valorizados" },
];

const COLUMNAS: Record<Cuaderno, ColumnaExportable[]> = {
  ventas: [
    { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
    { clave: "tipo", titulo: "Tipo" },
    { clave: "consecutivo", titulo: "Consecutivo" },
    { clave: "clave", titulo: "Clave" },
    { clave: "receptor", titulo: "Cliente" },
    { clave: "identificacion", titulo: "Identificación" },
    { clave: "condicion", titulo: "Condición" },
    { clave: "moneda", titulo: "Moneda" },
    { clave: "subtotal", titulo: "Subtotal", tipo: "dinero" },
    { clave: "impuesto", titulo: "IVA", tipo: "dinero" },
    { clave: "total", titulo: "Total", tipo: "dinero" },
    { clave: "estado", titulo: "Estado en Hacienda" },
  ],
  compras_gastos: [
    { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
    { clave: "origen", titulo: "Origen" },
    { clave: "proveedor", titulo: "Proveedor" },
    { clave: "identificacion", titulo: "Identificación" },
    { clave: "documento", titulo: "Documento" },
    { clave: "categoria", titulo: "Categoría" },
    { clave: "linea_negocio", titulo: "Línea de negocio" },
    { clave: "moneda", titulo: "Moneda" },
    { clave: "monto", titulo: "Monto", tipo: "dinero" },
    { clave: "impuesto", titulo: "IVA", tipo: "dinero" },
    { clave: "soporte", titulo: "Soporte fiscal" },
  ],
  pagos: [
    { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
    { clave: "proveedor", titulo: "Proveedor" },
    { clave: "medio", titulo: "Medio" },
    { clave: "cuenta_banco", titulo: "Cuenta" },
    { clave: "referencia", titulo: "Referencia" },
    { clave: "moneda", titulo: "Moneda" },
    { clave: "monto", titulo: "Monto", tipo: "dinero" },
    { clave: "tipo_cambio", titulo: "Tipo de cambio", tipo: "numero" },
    { clave: "documentos", titulo: "Documentos pagados" },
    { clave: "estado", titulo: "Estado" },
  ],
  cobros: [
    { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
    { clave: "cliente", titulo: "Cliente" },
    { clave: "medio", titulo: "Medio" },
    { clave: "moneda", titulo: "Moneda" },
    { clave: "monto", titulo: "Monto", tipo: "dinero" },
    { clave: "monto_crc", titulo: "Monto en colones", tipo: "dinero" },
    { clave: "referencia", titulo: "Referencia" },
    { clave: "comprobante", titulo: "Comprobante" },
    { clave: "estado", titulo: "Estado" },
  ],
  inventario_valorizado: [
    { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
    { clave: "producto", titulo: "Producto" },
    { clave: "motivo", titulo: "Motivo" },
    { clave: "cantidad", titulo: "Cantidad", tipo: "numero" },
    { clave: "costo_unitario", titulo: "Costo unitario", tipo: "dinero" },
    { clave: "valor", titulo: "Valor", tipo: "dinero" },
    { clave: "bodega", titulo: "Bodega" },
  ],
};

async function filas(
  db: PoolClient,
  tenantId: string,
  cuaderno: Cuaderno,
  desde: string,
  hasta: string
): Promise<Array<Record<string, unknown>>> {
  switch (cuaderno) {
    case "ventas": {
      const r = await db.query(
        `SELECT f.fecha_emision AS fecha, f.tipo_comprobante AS tipo, f.consecutivo, f.clave,
                COALESCE(f.receptor_nombre, p.nombre) AS receptor,
                f.receptor_numero_identificacion AS identificacion,
                f.condicion_venta AS condicion, f.moneda,
                (f.total_comprobante - COALESCE(f.total_impuesto, 0))::text AS subtotal,
                COALESCE(f.total_impuesto, 0)::text AS impuesto,
                f.total_comprobante::text AS total, f.estado
           FROM fact_comprobantes f
           LEFT JOIN propietarios p ON p.id = f.receptor_propietario_id
          WHERE f.tenant_id = $1 AND f.fecha_emision::date BETWEEN $2::date AND $3::date
          ORDER BY f.fecha_emision`,
        [tenantId, desde, hasta]
      );
      return r.rows;
    }
    case "compras_gastos": {
      // LAS DOS COSAS EN UNA TABLA, con la columna «origen» para
      // distinguirlas: el contador las asienta distinto, y tenerlas en
      // dos archivos obliga a cruzarlas a mano para ver el total que
      // salió.
      const r = await db.query(
        `SELECT g.fecha, 'Gasto' AS origen, pr.nombre AS proveedor,
                pr.numero_identificacion AS identificacion,
                COALESCE(rec.consecutivo, g.descripcion) AS documento,
                c.nombre AS categoria, g.linea_negocio, g.moneda, g.monto::text,
                COALESCE(rec.total_impuesto, 0)::text AS impuesto,
                CASE WHEN g.sin_comprobante THEN 'Sin comprobante electrónico'
                     ELSE 'Comprobante electrónico' END AS soporte
           FROM fin_gastos g
           JOIN fin_categorias_gasto c ON c.id = g.categoria_id
           LEFT JOIN inv_proveedores pr ON pr.id = g.proveedor_id
           LEFT JOIN fact_recibidos rec ON rec.id = g.recibido_id
          WHERE g.tenant_id = $1 AND g.fecha BETWEEN $2::date AND $3::date
            AND g.estado = 'real'
         UNION ALL
         SELECT rec.fecha_emision::date AS fecha, 'Compra' AS origen,
                rec.emisor_nombre AS proveedor, rec.emisor_identificacion AS identificacion,
                rec.consecutivo AS documento, 'Inventario' AS categoria,
                NULL AS linea_negocio, rec.moneda, rec.total_comprobante::text AS monto,
                COALESCE(rec.total_impuesto, 0)::text AS impuesto,
                'Comprobante electrónico' AS soporte
           FROM fact_recibidos rec
          WHERE rec.tenant_id = $1 AND rec.fecha_emision::date BETWEEN $2::date AND $3::date
            AND rec.registrado_en_inventario IS NOT NULL
          ORDER BY 1`,
        [tenantId, desde, hasta]
      );
      return r.rows;
    }
    case "pagos": {
      const r = await db.query(
        `SELECT pg.fecha, pr.nombre AS proveedor, pg.medio, b.nombre AS cuenta_banco,
                pg.referencia, pg.moneda, pg.monto::text, pg.tipo_cambio::text,
                (SELECT string_agg(COALESCE(cp.documento, 'sin número'), ', ')
                   FROM fin_pago_aplicaciones a
                   JOIN fin_cuentas_pagar cp ON cp.id = a.cuenta_id
                  WHERE a.pago_id = pg.id) AS documentos,
                pg.estado
           FROM fin_pagos pg
           JOIN inv_proveedores pr ON pr.id = pg.proveedor_id
           LEFT JOIN fin_cuentas_banco b ON b.id = pg.cuenta_banco_id
          WHERE pg.tenant_id = $1 AND pg.fecha BETWEEN $2::date AND $3::date
          ORDER BY pg.fecha`,
        [tenantId, desde, hasta]
      );
      return r.rows;
    }
    case "cobros": {
      const r = await db.query(
        `SELECT c.creado_en AS fecha,
                COALESCE(p.nombre, cu.cliente_nombre) AS cliente,
                cm.medio, cm.moneda, cm.monto::text, cm.monto_crc::text, cm.referencia,
                f.consecutivo AS comprobante, c.estado
           FROM vta_cobros c
           JOIN vta_cobro_medios cm ON cm.cobro_id = c.id
           LEFT JOIN vta_cuentas cu ON cu.id = c.cuenta_id
           LEFT JOIN propietarios p ON p.id = cu.propietario_id
           LEFT JOIN fact_comprobantes f ON f.id = c.comprobante_id
          WHERE c.tenant_id = $1 AND c.creado_en::date BETWEEN $2::date AND $3::date
          ORDER BY c.creado_en`,
        [tenantId, desde, hasta]
      );
      return r.rows;
    }
    case "inventario_valorizado": {
      const r = await db.query(
        `SELECT m.creado_en AS fecha, p.nombre AS producto, m.motivo,
                m.cantidad_base::text AS cantidad, m.costo_unitario::text,
                (m.cantidad_base * COALESCE(m.costo_unitario, 0))::text AS valor,
                b.nombre AS bodega
           FROM inv_movimientos m
           JOIN inv_productos p ON p.id = m.producto_id
           LEFT JOIN inv_bodegas b ON b.id = m.bodega_id
          WHERE m.tenant_id = $1 AND m.creado_en::date BETWEEN $2::date AND $3::date
          ORDER BY m.creado_en`,
        [tenantId, desde, hasta]
      );
      return r.rows;
    }
  }
}

export async function tablaContable(
  db: PoolClient,
  tenantId: string,
  cuaderno: Cuaderno,
  desde: string,
  hasta: string
): Promise<TablaExportable> {
  const titulo = CUADERNOS.find((c) => c.clave === cuaderno)?.titulo ?? cuaderno;
  return {
    titulo,
    subtitulo: `Del ${desde} al ${hasta}`,
    columnas: COLUMNAS[cuaderno],
    filas: await filas(db, tenantId, cuaderno, desde, hasta),
    // El aviso va en el archivo, no solo en la pantalla: el contador
    // recibe el archivo por correo y no vio la pantalla.
    aviso:
      cuaderno === "compras_gastos"
        ? "Las filas marcadas «Sin comprobante electrónico» no tienen soporte fiscal: son pagos registrados con su respaldo interno."
        : undefined,
  };
}
