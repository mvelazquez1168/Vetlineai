// Antes de wirear el job de Capa 5 (límite exterior de cuenta no
// operativa) a ciclo.job.ts, hay que saber si alguna clínica REAL ya
// matchearía la condición apenas se prenda el job — mismo criterio que se
// usó para procesarFinDePruebas/enviarRecordatoriosPurga en la sesión de
// correos transaccionales: nunca correr un job por lote nuevo contra datos
// reales sin antes confirmar el universo de candidatos.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/relevamiento_impacto_capa5.ts
import { pool } from "../db";

async function main() {
  const admins = await pool.query(
    `SELECT count(*) FILTER (WHERE correo_verificado_en IS NULL) AS sin_verificar,
            count(*) AS total
     FROM personas WHERE es_admin_clinica = true`
  );
  console.log("Admins de clínica — total vs. sin correo_verificado_en tras el backfill:", admins.rows[0]);

  const excluidos = await pool.query(
    `SELECT p.id, p.nombre, p.email, t.nombre AS clinica
     FROM personas p JOIN tenants t ON t.id = p.tenant_id
     WHERE p.es_admin_clinica = true AND p.correo_verificado_en IS NULL`
  );
  console.log("\nAdmins que quedaron sin backfill (excluidos por colegiatura_medico_obligatoria):");
  console.table(excluidos.rows);

  const candidatosHoy = await pool.query(
    `SELECT t.id, t.nombre, t.creado_en, s.estado,
            (now() - t.creado_en) AS antiguedad,
            EXISTS(SELECT 1 FROM personas p2 WHERE p2.tenant_id = t.id AND p2.es_admin_clinica = true AND p2.correo_verificado_en IS NOT NULL) AS admin_verificado,
            EXISTS(SELECT 1 FROM personas p3 WHERE p3.tenant_id = t.id AND p3.es_medico = true AND p3.estado = 'activo' AND p3.colegiatura IS NOT NULL) AS tiene_medico_colegiado
     FROM tenants t
     JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE s.estado = 'prueba'
     ORDER BY t.creado_en`
  );
  console.log(`\nTenants en estado 'prueba' hoy (${candidatosHoy.rows.length}):`);
  console.table(candidatosHoy.rows);

  const yaCandidatos30 = candidatosHoy.rows.filter(
    (r) => !(r.admin_verificado && r.tiene_medico_colegiado)
  );
  console.log(
    `\n=> De esos, ${yaCandidatos30.length} NO están operativas hoy (no cuentan los 30 días — solo confirma si YA matchearían apenas alguno cumpla la antigüedad).`
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
