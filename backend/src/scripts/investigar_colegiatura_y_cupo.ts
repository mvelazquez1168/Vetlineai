import { pool } from "../db";

async function main() {
  console.log("=== 1. Constraint colegiatura_medico_obligatoria: definición y si está VALIDATED ===");
  const constraint = await pool.query(
    `SELECT conname, convalidated, pg_get_constraintdef(oid) AS definicion
     FROM pg_constraint WHERE conname = 'colegiatura_medico_obligatoria'`
  );
  console.log(constraint.rows[0]);

  console.log("\n=== 2. Médicos SIN colegiatura hoy ===");
  const sinColegiatura = await pool.query(
    `SELECT p.id, p.nombre, p.email, p.creado_en, p.estado, t.nombre AS clinica
     FROM personas p JOIN tenants t ON t.id = p.tenant_id
     WHERE p.es_medico = true AND p.colegiatura IS NULL
     ORDER BY p.creado_en`
  );
  console.table(sinColegiatura.rows);

  console.log("\n=== 3. Prueba EMPÍRICA: ¿el constraint bloquea un INSERT nuevo con es_medico=true, colegiatura=NULL? ===");
  try {
    await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico, colegiatura, estado)
       SELECT id, 'QA Prueba Constraint', 'qa.pruebaconstraint@example.com', 'n/a', false, true, NULL, 'activo'
       FROM tenants LIMIT 1`
    );
    console.log("=> El INSERT tuvo éxito — EL CONSTRAINT NO ESTÁ BLOQUEANDO INSERTS NUEVOS.");
    await pool.query(`DELETE FROM personas WHERE email = 'qa.pruebaconstraint@example.com'`);
  } catch (err: any) {
    console.log("=> El INSERT falló (esperado si el constraint funciona):", err.message);
  }

  console.log("\n=== 4. trial.medicos_incluidos — ¿existe? ===");
  const parametro = await pool.query(`SELECT * FROM parametros_plataforma WHERE clave = 'trial.medicos_incluidos'`);
  console.log(parametro.rows.length ? parametro.rows[0] : "NO EXISTE");

  console.log("\n=== 5. medicos_contratados en suscripciones de prueba activas ===");
  const suscripcionesPrueba = await pool.query(
    `SELECT s.id, t.nombre, s.medicos_contratados, s.estado
     FROM suscripciones s JOIN tenants t ON t.suscripcion_id = s.id
     WHERE s.estado = 'prueba'`
  );
  console.table(suscripcionesPrueba.rows);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
