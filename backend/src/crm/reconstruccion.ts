import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// RECONSTRUCCIÓN DEL HISTORIAL — prompt 03, sección 2.
//
// La base del CRM debía existir antes de los demás módulos, para que la
// alimentaran desde el primer día. No fue así: hay citas, atenciones,
// vacunas, recetas, casos, comprobantes y cobros de antes. Esto los
// recorre y les crea su evento CON LA FECHA EN QUE OCURRIERON.
//
// ES IDEMPOTENTE POR EL MODELO, no por cuidado de este código: el índice
// único por (tipo, origen_tabla, origen_id) hace que la segunda corrida
// no inserte nada. Por eso cada consulta usa `ON CONFLICT DO NOTHING` y
// cuenta las filas que de verdad insertó.
//
// LOS CONSENTIMIENTOS DE LOS CLIENTES QUE YA EXISTEN se registran acá
// también, con fuente `existente_al_habilitar`: la clínica ya les manda
// recordatorios de salud por correo, y el prompt pide explícitamente que
// eso siga saliendo igual. Las promociones quedan en NO para todos.
// ---------------------------------------------------------------------

export interface ResultadoReconstruccion {
  porTipo: Record<string, number>;
  total: number;
  consentimientosCreados: number;
  /** Orígenes que no se pudieron reconstruir, con el motivo. */
  sinReconstruir: Array<{ origen: string; cuantos: number; motivo: string }>;
}

interface PasoReconstruccion {
  tipo: string;
  descripcion: string;
  sql: string;
}

/**
 * Cada paso es un INSERT ... SELECT: una consulta por tipo de evento, no
 * una fila por vez. Una clínica con cinco años de historia puede tener
 * decenas de miles de orígenes, y traerlos a Node para insertarlos de a
 * uno sería la diferencia entre un minuto y una hora.
 */
const PASOS: PasoReconstruccion[] = [
  {
    tipo: "cliente_registrado",
    descripcion: "propietarios",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, tipo, ocurrido_en, origen_tabla, origen_id, resumen)
          SELECT p.tenant_id, p.id, 'cliente_registrado', p.creado_en, 'propietarios', p.id,
                 p.nombre
            FROM propietarios p
           WHERE p.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "mascota_registrada",
    descripcion: "pacientes",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             resumen)
          SELECT pa.tenant_id, pa.propietario_id, pa.id, 'mascota_registrada', pa.creado_en,
                 'pacientes', pa.id, pa.nombre || ' (' || pa.especie || ')'
            FROM pacientes pa
           WHERE pa.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "cita_agendada",
    descripcion: "citas",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id, resumen)
          SELECT c.tenant_id, pa.propietario_id, c.paciente_id, 'cita_agendada', c.creado_en,
                 'citas', c.id, c.medico_id,
                 to_char(c.fecha, 'YYYY-MM-DD') || ' ' || to_char(c.hora_inicio, 'HH24:MI')
            FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id
           WHERE c.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
  {
    // El estado FINAL de la cita, con la fecha de su última
    // actualización: es lo único reconstruible. Los estados intermedios
    // por los que pasó no quedaron registrados en ninguna parte, y
    // inventarlos sería peor que no tenerlos. Va en el reporte.
    tipo: "cita_completada",
    descripcion: "citas completadas",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id)
          SELECT c.tenant_id, pa.propietario_id, c.paciente_id, 'cita_completada',
                 c.actualizado_en, 'citas', c.id, c.medico_id
            FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id
           WHERE c.tenant_id = $1 AND c.estado = 'completada'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "cita_cancelada",
    descripcion: "citas canceladas",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             resumen)
          SELECT c.tenant_id, pa.propietario_id, c.paciente_id, 'cita_cancelada',
                 c.actualizado_en, 'citas', c.id, left(c.motivo_cancelacion, 120)
            FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id
           WHERE c.tenant_id = $1 AND c.estado = 'cancelada'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "cita_no_presentada",
    descripcion: "citas no presentadas",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id)
          SELECT c.tenant_id, pa.propietario_id, c.paciente_id, 'cita_no_presentada',
                 c.actualizado_en, 'citas', c.id
            FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id
           WHERE c.tenant_id = $1 AND c.estado = 'no_show'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "atencion_cerrada",
    descripcion: "atenciones",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id, resumen)
          SELECT a.tenant_id, pa.propietario_id, a.paciente_id, 'atencion_cerrada',
                 COALESCE(a.cerrada_en, a.creado_en), 'atenciones', a.id, a.medico_id,
                 left(COALESCE(a.evaluacion, a.nota_medica), 120)
            FROM atenciones a JOIN pacientes pa ON pa.id = a.paciente_id
           WHERE a.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "vacuna_aplicada",
    descripcion: "cuidados preventivos (vacunación)",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id, resumen)
          SELECT cp.tenant_id, pa.propietario_id, cp.paciente_id, 'vacuna_aplicada',
                 cp.fecha_aplicacion::timestamptz, 'cuidados_preventivos', cp.id,
                 cp.registrado_por, cp.vacuna
            FROM cuidados_preventivos cp JOIN pacientes pa ON pa.id = cp.paciente_id
           WHERE cp.tenant_id = $1 AND cp.tipo = 'vacunacion'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "desparasitacion",
    descripcion: "cuidados preventivos (desparasitación)",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id, resumen)
          SELECT cp.tenant_id, pa.propietario_id, cp.paciente_id, 'desparasitacion',
                 cp.fecha_aplicacion::timestamptz, 'cuidados_preventivos', cp.id,
                 cp.registrado_por, cp.producto_desparasitacion
            FROM cuidados_preventivos cp JOIN pacientes pa ON pa.id = cp.paciente_id
           WHERE cp.tenant_id = $1 AND cp.tipo = 'desparasitacion'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "receta_emitida",
    descripcion: "recetas emitidas",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id)
          SELECT r.tenant_id, pa.propietario_id, r.paciente_id, 'receta_emitida',
                 COALESCE(r.emitido_en, r.creado_en), 'recetas', r.id, r.medico_id
            FROM recetas r JOIN pacientes pa ON pa.id = r.paciente_id
           WHERE r.tenant_id = $1 AND r.estado = 'emitida'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "caso_abierto",
    descripcion: "casos",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id, resumen)
          SELECT c.tenant_id, pa.propietario_id, c.paciente_id, 'caso_abierto', c.creado_en,
                 'casos', c.id, c.medico_id, left(c.motivo, 120)
            FROM casos c JOIN pacientes pa ON pa.id = c.paciente_id
           WHERE c.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "caso_cerrado",
    descripcion: "casos cerrados",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id, resumen)
          SELECT c.tenant_id, pa.propietario_id, c.paciente_id, 'caso_cerrado',
                 COALESCE(c.cerrado_en, c.actualizado_en), 'casos', c.id, c.cerrado_por,
                 left(c.diagnostico_final, 120)
            FROM casos c JOIN pacientes pa ON pa.id = c.paciente_id
           WHERE c.tenant_id = $1 AND c.estado = 'completado'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "estudio_laboratorio",
    descripcion: "estudios de laboratorio con resultado",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             resumen)
          SELECT e.tenant_id, pa.propietario_id, e.paciente_id, 'estudio_laboratorio',
                 COALESCE(e.fecha_resultado, e.creado_en), 'exp_estudios_lab', e.id,
                 e.tipo_estudio
            FROM exp_estudios_lab e JOIN pacientes pa ON pa.id = e.paciente_id
           WHERE e.tenant_id = $1 AND e.estado = 'resultado_recibido'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "grooming",
    descripcion: "visitas de grooming",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id, resumen)
          SELECT g.tenant_id, pa.propietario_id, g.paciente_id, 'grooming',
                 COALESCE(g.fecha::timestamptz, g.creado_en), 'exp_grooming', g.id,
                 g.groomer_id, g.tipo_corte
            FROM exp_grooming g JOIN pacientes pa ON pa.id = g.paciente_id
           WHERE g.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "consentimiento_firmado",
    descripcion: "consentimientos firmados",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             resumen)
          SELECT c.tenant_id, pa.propietario_id, c.paciente_id, 'consentimiento_firmado',
                 c.firmado_en, 'exp_consentimientos', c.id, left(c.titulo, 120)
            FROM exp_consentimientos c JOIN pacientes pa ON pa.id = c.paciente_id
           WHERE c.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
  {
    // El documento del expediente: la radiografia que trae el cliente,
    // el resultado de otro laboratorio. Cuelga del paciente, no de un
    // caso de Vetline Ai (ver la migracion 104).
    tipo: "documento_adjunto",
    descripcion: "documentos del expediente",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en, origen_tabla, origen_id,
             persona_id, resumen)
          SELECT pa.tenant_id, pa.propietario_id, ar.paciente_id, 'documento_adjunto',
                 COALESCE(ar.fecha_documento::timestamptz, ar.creado_en), 'archivos', ar.id,
                 ar.subido_por_persona_id,
                 left(COALESCE(ar.descripcion, ar.nombre_archivo), 120)
            FROM archivos ar JOIN pacientes pa ON pa.id = ar.paciente_id
           WHERE pa.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "comprobante_emitido",
    descripcion: "comprobantes electrónicos",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, tipo, ocurrido_en, origen_tabla, origen_id, resumen)
          SELECT f.tenant_id, f.receptor_propietario_id, 'comprobante_emitido', f.fecha_emision,
                 'fact_comprobantes', f.id, f.consecutivo
            FROM fact_comprobantes f
           WHERE f.tenant_id = $1 AND f.receptor_propietario_id IS NOT NULL
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "cobro",
    descripcion: "cobros",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, tipo, ocurrido_en, origen_tabla, origen_id, persona_id,
             resumen)
          SELECT co.tenant_id, cu.propietario_id, 'cobro', co.creado_en, 'vta_cobros', co.id,
                 co.cobrado_por, co.total::text
            FROM vta_cobros co JOIN vta_cuentas cu ON cu.id = co.cuenta_id
           WHERE co.tenant_id = $1 AND cu.propietario_id IS NOT NULL AND co.estado = 'aplicado'
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "anticipo",
    descripcion: "anticipos",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, tipo, ocurrido_en, origen_tabla, origen_id, resumen)
          SELECT a.tenant_id, a.propietario_id, 'anticipo', a.creado_en, 'vta_anticipos', a.id,
                 left(a.motivo, 120)
            FROM vta_anticipos a
           WHERE a.tenant_id = $1 AND a.propietario_id IS NOT NULL
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "abono",
    descripcion: "abonos",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, tipo, ocurrido_en, origen_tabla, origen_id, resumen)
          SELECT ab.tenant_id, ab.propietario_id, 'abono', ab.creado_en, 'vta_abonos', ab.id,
                 ab.monto::text
            FROM vta_abonos ab
           WHERE ab.tenant_id = $1 AND ab.propietario_id IS NOT NULL
          ON CONFLICT DO NOTHING`,
  },
  {
    tipo: "encargo_creado",
    descripcion: "encargos",
    sql: `INSERT INTO crm_interacciones
            (tenant_id, propietario_id, tipo, ocurrido_en, origen_tabla, origen_id, resumen)
          SELECT e.tenant_id, e.propietario_id, 'encargo_creado', e.creado_en, 'vta_encargos',
                 e.id, left(e.descripcion, 120)
            FROM vta_encargos e
           WHERE e.tenant_id = $1
          ON CONFLICT DO NOTHING`,
  },
];

export async function reconstruirHistorial(
  db: PoolClient,
  tenantId: string
): Promise<ResultadoReconstruccion> {
  const porTipo: Record<string, number> = {};
  let total = 0;

  for (const paso of PASOS) {
    const r = await db.query(paso.sql, [tenantId]);
    const n = r.rowCount ?? 0;
    if (n > 0) porTipo[paso.tipo] = (porTipo[paso.tipo] ?? 0) + n;
    total += n;
  }

  // Los consentimientos de los clientes que ya existían.
  const consent = await db.query(
    `WITH nuevos AS (
       INSERT INTO crm_consentimientos (tenant_id, propietario_id, canal, finalidad, otorgado)
       SELECT p.tenant_id, p.id, v.canal, v.finalidad, v.otorgado
         FROM propietarios p,
              (VALUES ('correo', 'salud', true),
                      ('correo', 'promociones', false),
                      ('whatsapp', 'salud', false),
                      ('whatsapp', 'promociones', false))
              AS v(canal, finalidad, otorgado)
        WHERE p.tenant_id = $1
       ON CONFLICT (propietario_id, canal, finalidad) DO NOTHING
       RETURNING propietario_id, canal, finalidad, otorgado
     )
     INSERT INTO crm_consentimiento_historial
       (tenant_id, propietario_id, canal, finalidad, otorgado, fuente, nota)
     SELECT $1, n.propietario_id, n.canal, n.finalidad, n.otorgado, 'existente_al_habilitar',
            'Cliente que ya existía al habilitar el CRM. Salud por correo: la clínica ya le enviaba recordatorios. Promociones: no, hasta que lo autorice.'
       FROM nuevos n`,
    [tenantId]
  );

  // Lo que NO se pudo reconstruir, contado desde la base. No es una
  // lista de defectos: es lo que el historial existente no guarda.
  const sinReconstruir: ResultadoReconstruccion["sinReconstruir"] = [];

  const cobrosSinCliente = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM vta_cobros co
       JOIN vta_cuentas cu ON cu.id = co.cuenta_id
      WHERE co.tenant_id = $1 AND cu.propietario_id IS NULL`,
    [tenantId]
  );
  if (Number(cobrosSinCliente.rows[0].n) > 0) {
    sinReconstruir.push({
      origen: "vta_cobros",
      cuantos: Number(cobrosSinCliente.rows[0].n),
      motivo:
        "Venta de mostrador sin cliente: no hay línea de tiempo donde ponerla, y es correcto que no la haya.",
    });
  }

  const comprobantesSinCliente = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM fact_comprobantes
      WHERE tenant_id = $1 AND receptor_propietario_id IS NULL`,
    [tenantId]
  );
  if (Number(comprobantesSinCliente.rows[0].n) > 0) {
    sinReconstruir.push({
      origen: "fact_comprobantes",
      cuantos: Number(comprobantesSinCliente.rows[0].n),
      motivo:
        "Tiquete sin cliente identificado, o factura a nombre de un perfil de facturación: la línea de tiempo es del cliente, no del receptor fiscal.",
    });
  }

  const estadosIntermedios = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM citas
      WHERE tenant_id = $1 AND estado IN ('confirmada', 'registrada', 'en_consulta')`,
    [tenantId]
  );
  if (Number(estadosIntermedios.rows[0].n) > 0) {
    sinReconstruir.push({
      origen: "citas (estados intermedios)",
      cuantos: Number(estadosIntermedios.rows[0].n),
      motivo:
        "De una cita solo se conoce su estado ACTUAL: por qué estados pasó antes no quedó registrado en ninguna parte, y no se inventa.",
    });
  }

  const mensajesViejos = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM notificaciones
      WHERE tenant_id = $1 AND destinatario_tipo = 'propietario'`,
    [tenantId]
  );
  if (Number(mensajesViejos.rows[0].n) > 0) {
    sinReconstruir.push({
      origen: "notificaciones",
      cuantos: Number(mensajesViejos.rows[0].n),
      motivo:
        "Los avisos enviados antes del CRM no se reconstruyen como eventos: su destinatario es una persona o un propietario según el tipo, y mezclarlos daría una línea de tiempo con mensajes que nunca fueron para el cliente. Se reportan y quedan en `notificaciones`.",
    });
  }

  return {
    porTipo,
    total,
    consentimientosCreados: consent.rowCount ?? 0,
    sinReconstruir,
  };
}
