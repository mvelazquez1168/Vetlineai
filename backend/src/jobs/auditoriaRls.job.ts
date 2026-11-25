import cron from "node-cron";
import { Pool } from "pg";
import { pool } from "../db";
import { TABLAS_BORRADO_MANUAL_EN_PURGA, TABLAS_SIN_POLITICA_RLS_A_PROPOSITO } from "../tablasTenant";

// ---------------------------------------------------------------------
// Auditoría estructural de aislamiento por tenant.
//
// Versión original (prompt_code_auditoria_tenant): reportaba una sola
// cosa — tabla con columna `tenant_id` y RLS deshabilitado. Eso dejaba
// pasar tres defectos distintos, los tres encontrados a mano en el
// relevamiento de `docs/relevamientos/modelo-compartido-gestion.md`:
//
//   1. RLS habilitado pero NO FORZADO. `atenciones` estaba así: el
//      chequeo viejo la daba por buena porque solo miraba
//      `relrowsecurity`. Sin FORCE, el dueño de la tabla se saltea sus
//      propias políticas.
//   2. RLS habilitado y CERO políticas sin querer. Un lockout total es
//      un diseño válido (dos tablas lo usan a propósito), pero
//      indistinguible de "alguien habilitó RLS y se olvidó la política"
//      — y el síntoma es que la tabla deja de devolver filas en
//      silencio.
//   3. FK a `tenants` sin `ON DELETE CASCADE` que la purga no borra a
//      mano. Esto no es RLS, pero es el mismo tipo de brecha
//      estructural y el mismo momento para detectarla: hace que
//      `purga.ts::ejecutarPurgas` falle con violación de FK y haga
//      ROLLBACK, dentro de un catch, dejando clínicas que debían
//      eliminarse colgadas indefinidamente. Ya pasó una vez
//      (`notificaciones_callback`).
//
// Las excepciones viven en `tablasTenant.ts`, en un solo lugar y con el
// motivo escrito, nunca hardcodeadas acá.
// ---------------------------------------------------------------------

export interface HallazgosAuditoriaRls {
  /** Tabla con `tenant_id` y RLS deshabilitado. El chequeo original. */
  sinRls: string[];
  /** Tabla con `tenant_id`, RLS habilitado, pero sin FORCE. */
  sinForzar: string[];
  /** Tabla con `tenant_id`, RLS habilitado y ninguna política, sin estar en la lista de excepciones. */
  sinPolitica: string[];
  /** FK a `tenants` sin ON DELETE CASCADE que la purga no borra a mano. */
  fkSinCascada: { tabla: string; constraint: string }[];
}

/**
 * Las tres consultas sobre RLS en una sola pasada. El criterio sigue
 * siendo deliberadamente simple: cualquier tabla de `public` con columna
 * `tenant_id` tiene que tener RLS habilitado, forzado, y al menos una
 * política (salvo las excepciones nombradas).
 *
 * `relkind = 'r'` deja afuera vistas y tablas particionadas a propósito:
 * hoy no hay ninguna, y si aparecen conviene decidir su criterio en vez
 * de que este chequeo las trate como tablas comunes.
 */
export async function auditarRlsPorTenant(db: Pool): Promise<HallazgosAuditoriaRls> {
  const tablas = await db.query<{
    tabla: string;
    rls_habilitado: boolean;
    rls_forzado: boolean;
    politicas: number;
  }>(
    `SELECT c.relname                                   AS tabla,
            c.relrowsecurity                            AS rls_habilitado,
            c.relforcerowsecurity                       AS rls_forzado,
            (SELECT count(*) FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS politicas
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns ic
         WHERE ic.table_schema = 'public'
           AND ic.table_name = c.relname
           AND ic.column_name = 'tenant_id'
       )
     ORDER BY c.relname`
  );

  const sinRls: string[] = [];
  const sinForzar: string[] = [];
  const sinPolitica: string[] = [];

  for (const fila of tablas.rows) {
    if (!fila.rls_habilitado) {
      // Sin RLS no tiene sentido reportar además que no está forzada ni
      // que no tiene política: es el mismo defecto, y repetirlo tres
      // veces por tabla vuelve el log ilegible.
      sinRls.push(fila.tabla);
      continue;
    }
    if (!fila.rls_forzado) sinForzar.push(fila.tabla);
    if (fila.politicas === 0 && !(fila.tabla in TABLAS_SIN_POLITICA_RLS_A_PROPOSITO)) {
      sinPolitica.push(fila.tabla);
    }
  }

  // `confdeltype` es el código de la acción ON DELETE de la FK:
  // 'c' = CASCADE, 'a' = NO ACTION, 'r' = RESTRICT, 'n' = SET NULL,
  // 'd' = SET DEFAULT. Se compara contra 'c' y no contra 'a' porque
  // cualquier cosa que no sea cascada hace fallar el DELETE del tenant.
  const fks = await db.query<{ tabla: string; constraint: string }>(
    `SELECT con.conrelid::regclass::text AS tabla, con.conname AS constraint
     FROM pg_constraint con
     WHERE con.contype = 'f'
       AND con.confrelid = 'tenants'::regclass
       AND con.confdeltype <> 'c'
     ORDER BY 1`
  );
  const borradoManual = new Set<string>(TABLAS_BORRADO_MANUAL_EN_PURGA);
  const fkSinCascada = fks.rows.filter((f) => !borradoManual.has(f.tabla));

  return { sinRls, sinForzar, sinPolitica, fkSinCascada };
}

/**
 * Compatibilidad con el nombre anterior — lo usa el script de
 * verificación de la auditoría original. Se mantiene en vez de
 * renombrarlo en 2 lados para que ese script siga sirviendo como
 * verificación independiente de este chequeo.
 */
export async function auditarTablasTenantSinRls(db: Pool): Promise<string[]> {
  return (await auditarRlsPorTenant(db)).sinRls;
}

export async function ejecutarJobAuditoriaRls(db: Pool): Promise<HallazgosAuditoriaRls> {
  const hallazgos = await auditarRlsPorTenant(db);

  // Un console.error por tipo de hallazgo, no uno por tabla: el motivo y
  // el arreglo son distintos para cada tipo, y el mensaje tiene que decir
  // qué hacer, no solo qué está mal.
  if (hallazgos.sinRls.length > 0) {
    console.error(
      `[auditoriaRls.job] ${hallazgos.sinRls.length} tabla(s) con tenant_id y RLS DESHABILITADO ` +
        `(falta ENABLE + FORCE ROW LEVEL SECURITY y su política): ${hallazgos.sinRls.join(", ")}`
    );
  }
  if (hallazgos.sinForzar.length > 0) {
    console.error(
      `[auditoriaRls.job] ${hallazgos.sinForzar.length} tabla(s) con tenant_id y RLS SIN FORZAR ` +
        `(el dueño de la tabla se saltea sus propias políticas; falta FORCE ROW LEVEL SECURITY): ` +
        `${hallazgos.sinForzar.join(", ")}`
    );
  }
  if (hallazgos.sinPolitica.length > 0) {
    console.error(
      `[auditoriaRls.job] ${hallazgos.sinPolitica.length} tabla(s) con tenant_id y RLS habilitado ` +
        `pero SIN NINGUNA POLÍTICA (no devuelve ninguna fila a ningún tenant; si el bloqueo total ` +
        `es a propósito, agregala a TABLAS_SIN_POLITICA_RLS_A_PROPOSITO en tablasTenant.ts con su ` +
        `motivo): ${hallazgos.sinPolitica.join(", ")}`
    );
  }
  if (hallazgos.fkSinCascada.length > 0) {
    console.error(
      `[auditoriaRls.job] ${hallazgos.fkSinCascada.length} FK a tenants SIN ON DELETE CASCADE que la ` +
        `purga no borra a mano (ejecutarPurgas va a fallar con violación de FK y la clínica no se ` +
        `va a eliminar nunca; poné la FK en CASCADE, o agregá la tabla a ` +
        `TABLAS_BORRADO_MANUAL_EN_PURGA en tablasTenant.ts): ` +
        hallazgos.fkSinCascada.map((f) => `${f.tabla} (${f.constraint})`).join(", ")
    );
  }

  return hallazgos;
}

// Diario alcanza — es una verificación estructural, no algo que cambie
// varias veces por día. Corre también una vez al arrancar (mismo patrón
// que validarCredencialesPaisesHabilitados en index.ts) para no esperar
// hasta el próximo horario programado.
export function iniciarJobAuditoriaRls() {
  ejecutarJobAuditoriaRls(pool).catch((err) => console.error("[auditoriaRls.job] Error en el chequeo inicial", err));
  cron.schedule("0 9 * * *", () => {
    ejecutarJobAuditoriaRls(pool).catch((err) => console.error("[auditoriaRls.job] Error en el job", err));
  });
}
