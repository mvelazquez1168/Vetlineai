import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// LA AUDITORÍA CONSULTABLE — prompt 11, §5.
//
// HALLAZGO DEL RELEVAMIENTO, y define todo este módulo:
// `bitacora_auditoria.accion` guarda, en la mayoría de sus filas, **el
// método y la ruta** de la solicitud —`GET /api/platform-admin/documentos`,
// 313 veces—. Es un registro de HTTP, no de eventos de negocio: no tiene
// valor anterior ni nuevo, y registra las lecturas, que son ruido.
//
// Lo que el prompt pide ver —anulaciones, descuentos autorizados,
// cambios de política, cambios de precio, ajustes de inventario,
// fusiones de clientes, cambios de roles, exportaciones— **ya está
// registrado, y mejor**, en las tablas de cada módulo.
//
// POR ESO ESTO ES UNA LECTURA UNIFICADA y no un segundo registro. Es la
// misma regla que el 10a aplicó a finanzas: consolidar, no recapturar.
// Un segundo registro de lo mismo es un registro que un día no coincide.
// ---------------------------------------------------------------------

export interface EventoAuditoria {
  fuente: string;
  tipo: string;
  modulo: string;
  cuando: string;
  quien: string | null;
  quien_id: string | null;
  /** Sobre qué: el paciente, la factura, el producto. */
  sobre: string | null;
  entidad_id: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  detalle: string | null;
}

export interface FiltrosAuditoria {
  desde?: string;
  hasta?: string;
  personaId?: string;
  modulo?: string;
  tipo?: string;
  /** El id del registro afectado: un paciente, una factura, un producto. */
  entidadId?: string;
  limite?: number;
}

/**
 * El flujo de eventos, de todas las fuentes, ordenado por fecha.
 *
 * Cada `SELECT` de esta unión es una fuente distinta y todas devuelven
 * las mismas columnas. Está escrito así —y no con una tabla de eventos—
 * porque cada módulo ya guarda lo suyo con el detalle que le
 * corresponde, y copiarlo acá sería duplicarlo.
 */
export async function eventos(
  db: PoolClient,
  tenantId: string,
  filtros: FiltrosAuditoria = {}
): Promise<EventoAuditoria[]> {
  const limite = Math.min(filtros.limite ?? 300, 1000);
  const r = await db.query<EventoAuditoria>(
    `WITH todo AS (
       -- 1. CAMBIOS DE POLÍTICA (04): ya traen valor anterior y nuevo.
       SELECT 'politicas'::text AS fuente, 'cambio_politica'::text AS tipo,
              'admin'::text AS modulo, h.cambiado_en AS cuando,
              per.nombre AS quien, h.cambiado_por AS quien_id,
              pol.nombre AS sobre, h.clave::text AS entidad_id,
              h.valor_anterior, h.valor_nuevo,
              CASE WHEN h.rol IS NOT NULL THEN 'para el rol ' || h.rol ELSE NULL END AS detalle
         FROM politicas_historial h
         LEFT JOIN personas per ON per.id = h.cambiado_por
         LEFT JOIN politicas pol ON pol.clave = h.clave
        WHERE h.tenant_id = $1

       UNION ALL
       -- 2. ANULACIONES Y DESCUENTOS AUTORIZADOS (08b).
       SELECT 'aprobaciones', a.tipo, 'caja', COALESCE(a.resuelta_en, a.solicitada_en),
              COALESCE(res.nombre, sol.nombre), COALESCE(a.resuelta_por, a.solicitada_por),
              COALESCE(a.motivo, a.tipo), a.referencia_id::text,
              NULL, a.estado,
              -- El monto y la nota de quien resolvió: es lo que explica
              -- una anulación tres meses después.
              concat_ws(' · ', nullif(a.monto::text, ''), a.nota_resolucion)
         FROM vta_aprobaciones a
         LEFT JOIN personas sol ON sol.id = a.solicitada_por
         LEFT JOIN personas res ON res.id = a.resuelta_por
        WHERE a.tenant_id = $1

       UNION ALL
       -- 3. CAMBIOS DE PRECIO (migración 159: antes no quedaban en
       --    ninguna parte).
       SELECT 'precios', 'cambio_precio', 'inventario', ph.cambiado_en,
              per.nombre, ph.cambiado_por,
              COALESCE(p.nombre, s.nombre), COALESCE(ph.presentacion_id, ph.servicio_id)::text,
              ph.precio_anterior::text, ph.precio_nuevo::text,
              lp.nombre
         FROM inv_precios_historial ph
         LEFT JOIN personas per ON per.id = ph.cambiado_por
         LEFT JOIN inv_presentaciones pres ON pres.id = ph.presentacion_id
         LEFT JOIN inv_productos p ON p.id = pres.producto_id
         LEFT JOIN inv_servicios s ON s.id = ph.servicio_id
         LEFT JOIN inv_listas_precio lp ON lp.id = ph.lista_id
        WHERE ph.tenant_id = $1

       UNION ALL
       -- 4. AJUSTES DE INVENTARIO (06).
       SELECT 'inventario', 'ajuste_inventario', 'inventario',
              COALESCE(aj.aplicado_en, aj.aprobado_en, aj.solicitado_en),
              COALESCE(apr.nombre, sol.nombre), COALESCE(aj.aprobado_por, aj.solicitado_por),
              aj.tipo, aj.id::text,
              NULL, aj.valor::text,
              COALESCE(aj.motivo_detalle, aj.motivo)
         FROM inv_ajustes aj
         LEFT JOIN personas sol ON sol.id = aj.solicitado_por
         LEFT JOIN personas apr ON apr.id = aj.aprobado_por
        WHERE aj.tenant_id = $1

       UNION ALL
       -- 5. FUSIONES DE CLIENTES Y PACIENTES (anexo 07-03, B1).
       SELECT 'crm', 'unificacion', 'clientes', u.hecho_en,
              per.nombre, u.hecho_por,
              u.entidad, u.sobreviviente_id::text,
              u.absorbido_nombre, u.sobreviviente_nombre,
              left(u.detalle::text, 300)
         FROM crm_unificaciones u
         LEFT JOIN personas per ON per.id = u.hecho_por
        WHERE u.tenant_id = $1

       UNION ALL
       -- 6. EXPORTACIONES DE DATOS.
       SELECT 'exportaciones', 'exportacion', 'admin', e.creada_en,
              per.nombre, e.solicitada_por,
              'Exportación de la clínica', e.id::text,
              NULL, e.estado,
              CASE WHEN e.descargada_en IS NOT NULL THEN 'descargada' ELSE NULL END
         FROM exportaciones e
         LEFT JOIN personas per ON per.id = e.solicitada_por
        WHERE e.tenant_id = $1

       UNION ALL
       -- 7. EL ENLACE DE UNA INVITACIÓN, COPIADO (migración 170). El
       --    enlace es una credencial de un solo uso: quién lo tuvo es
       --    una pregunta de seguridad, no una curiosidad.
       SELECT 'invitaciones', 'enlace_invitacion_copiado', 'admin', c.creado_en,
              per.nombre, c.persona_id,
              COALESCE(i.nombre, i.email), c.invitacion_id::text,
              NULL, i.email,
              CASE WHEN c.ip IS NOT NULL THEN 'desde ' || host(c.ip) ELSE NULL END
         FROM invitacion_enlace_copiado c
         LEFT JOIN personas per ON per.id = c.persona_id
         LEFT JOIN invitaciones_medico i ON i.id = c.invitacion_id
        WHERE c.tenant_id = $1

       UNION ALL
       -- 8. LA BITÁCORA, **sin los GET**. Lo que queda son las acciones
       --    semánticas que algún módulo escribió a mano.
       SELECT 'bitacora', b.accion, 'sistema', b.creado_en,
              per.nombre, b.persona_id,
              b.entidad, b.entidad_id::text,
              NULL, NULL,
              left(b.detalle::text, 300)
         FROM bitacora_auditoria b
         LEFT JOIN personas per ON per.id = b.persona_id
        WHERE b.tenant_id = $1
          AND b.accion !~ '^(GET|HEAD|OPTIONS) '
     )
     SELECT * FROM todo
      WHERE ($2::timestamptz IS NULL OR cuando >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR cuando < ($3::date + 1)::timestamptz)
        AND ($4::uuid IS NULL OR quien_id = $4::uuid)
        AND ($5::text IS NULL OR modulo = $5::text)
        AND ($6::text IS NULL OR tipo = $6::text)
        AND ($7::text IS NULL OR entidad_id = $7::text)
      ORDER BY cuando DESC
      LIMIT $8`,
    [
      tenantId,
      filtros.desde ?? null,
      filtros.hasta ?? null,
      filtros.personaId ?? null,
      filtros.modulo ?? null,
      filtros.tipo ?? null,
      filtros.entidadId ?? null,
      limite,
    ]
  );
  return r.rows;
}

/** Los tipos que hay, para armar el filtro sin inventarlos. */
export async function tiposDeEvento(
  db: PoolClient,
  tenantId: string
): Promise<Array<{ tipo: string; modulo: string; cantidad: number }>> {
  const todos = await eventos(db, tenantId, { limite: 1000 });
  const mapa = new Map<string, { tipo: string; modulo: string; cantidad: number }>();
  for (const e of todos) {
    const llave = `${e.modulo}|${e.tipo}`;
    const ya = mapa.get(llave);
    if (ya) ya.cantidad += 1;
    else mapa.set(llave, { tipo: e.tipo, modulo: e.modulo, cantidad: 1 });
  }
  return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad);
}
