import cron from "node-cron";
import { Pool } from "pg";
import { pool } from "../db";

// ---------------------------------------------------------------------
// prompt_code_auditoria_tenant — hallazgo secundario: 3 tablas con
// tenant_id sin RLS (corregido en la migración 045, cada una con su
// propio criterio — ver esa migración y la memoria de la sesión). El
// usuario pidió además una verificación periódica que agarre el próximo
// caso: alguien crea una tabla, le pone tenant_id, y se olvida de
// ENABLE ROW LEVEL SECURITY. Sin este chequeo esa brecha queda invisible
// hasta que alguien la audite a mano de nuevo.
//
// El criterio es deliberadamente simple y sin excepciones hardcodeadas:
// cualquier tabla de public con una columna tenant_id y RLS deshabilitado
// se reporta. No exige que tenga política — clinicas_purgadas_auditoria
// tiene RLS habilitado SIN política a propósito (ver migración 045) y
// eso es correcto, así que este chequeo no la marca.
// ---------------------------------------------------------------------
export async function auditarTablasTenantSinRls(db: Pool): Promise<string[]> {
  const result = await db.query(
    `SELECT c.table_name
     FROM information_schema.columns c
     JOIN pg_class pc ON pc.relname = c.table_name AND pc.relkind = 'r'
     JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
     WHERE c.table_schema = 'public'
       AND c.column_name = 'tenant_id'
       AND pc.relrowsecurity = false
     ORDER BY c.table_name`
  );
  return result.rows.map((fila) => fila.table_name as string);
}

export async function ejecutarJobAuditoriaRls(db: Pool): Promise<{ sinRls: string[] }> {
  const sinRls = await auditarTablasTenantSinRls(db);
  if (sinRls.length > 0) {
    console.error(
      `[auditoriaRls.job] ${sinRls.length} tabla(s) con tenant_id y RLS deshabilitado: ${sinRls.join(", ")}`
    );
  }
  return { sinRls };
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
