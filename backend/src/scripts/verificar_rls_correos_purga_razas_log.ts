// Verificación real de la migración 045 (prompt_code_auditoria_tenant,
// hallazgo secundario: 3 tablas con tenant_id sin RLS). Cada tabla tiene
// un criterio distinto — ver la migración y la memoria de la sesión —
// así que se verifica cada una con la prueba que realmente le
// corresponde, contra una conexión CRUDA como vetplatform_app (mismo
// técnica que auditoria_aislamiento_tenant.ts: bypasea la app por
// completo, prueba RLS en la base, no el código).
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_rls_correos_purga_razas_log.ts
import { Pool } from "pg";
import { pool } from "../db";
import { config } from "../config";
import { auditarTablasTenantSinRls } from "../jobs/auditoriaRls.job";

const sufijo = Date.now();
const tenantA = "11111111-1111-4111-8111-111111111111".replace(/1/g, () => String(sufijo % 10));
const tenantB = "22222222-2222-4222-8222-222222222222".replace(/2/g, () => String((sufijo + 1) % 10));

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function main() {
  const tenantConn = new Pool({ connectionString: config.tenantDatabaseUrl });

  try {
    console.log("=== auditarTablasTenantSinRls() ===");
    const sinRls = await auditarTablasTenantSinRls(pool);
    assert(sinRls.length === 0, "0 tablas con tenant_id y RLS deshabilitado", sinRls);

    console.log("\n=== correos_enviados — política de tenant estándar ===");
    await pool.query(
      `INSERT INTO correos_enviados (tenant_id, destinatario, tipo, resultado) VALUES ($1, $2, 'verificacion_correo', 'enviado')`,
      [tenantA, `verif-a-${sufijo}@vetlineai-test.com`]
    );
    await pool.query(
      `INSERT INTO correos_enviados (tenant_id, destinatario, tipo, resultado) VALUES ($1, $2, 'verificacion_correo', 'enviado')`,
      [tenantB, `verif-b-${sufijo}@vetlineai-test.com`]
    );
    const clienteA = await tenantConn.connect();
    try {
      await clienteA.query("BEGIN");
      await clienteA.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      const propios = await clienteA.query(`SELECT destinatario FROM correos_enviados WHERE tenant_id = $1`, [tenantA]);
      const ajenos = await clienteA.query(`SELECT destinatario FROM correos_enviados WHERE tenant_id = $1`, [tenantB]);
      assert(propios.rows.length === 1, "Tenant A ve su propio correo", { filas: propios.rows.length });
      assert(ajenos.rows.length === 0, "Tenant A NO ve el correo de Tenant B", { filas: ajenos.rows.length });
      await clienteA.query("COMMIT");
    } finally {
      clienteA.release();
    }

    console.log("\n=== clinicas_purgadas_auditoria — lockout total para tenant ===");
    const clienteLockout = await tenantConn.connect();
    try {
      await clienteLockout.query("BEGIN");
      await clienteLockout.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      const lectura = await clienteLockout.query(`SELECT 1 FROM clinicas_purgadas_auditoria LIMIT 1`);
      assert(lectura.rows.length === 0, "Tenant no puede leer ninguna fila (RLS sin política = deny-all)", {
        filas: lectura.rows.length,
      });
      let insertoBloqueado = false;
      try {
        await clienteLockout.query(
          `INSERT INTO clinicas_purgadas_auditoria (tenant_id, nombre_clinica, purgado_en) VALUES ($1, 'Intento desde tenant', now())`,
          [tenantA]
        );
      } catch (err) {
        insertoBloqueado = true;
      }
      assert(insertoBloqueado, "INSERT desde contexto de tenant es rechazado (no hay política de INSERT)");
      await clienteLockout.query("ROLLBACK");
    } finally {
      clienteLockout.release();
    }

    console.log("\n=== razas_sin_coincidencia_log — INSERT permitido, SELECT bloqueado ===");
    const clienteLog = await tenantConn.connect();
    let insertoLogOk = false;
    try {
      await clienteLog.query("BEGIN");
      await clienteLog.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await clienteLog.query(
        `INSERT INTO razas_sin_coincidencia_log (tenant_id, especie, raza_texto) VALUES ($1, 'Canino', $2)`,
        [tenantA, `RLS-TEST-${sufijo}`]
      );
      insertoLogOk = true;
      const lectura = await clienteLog.query(
        `SELECT 1 FROM razas_sin_coincidencia_log WHERE raza_texto = $1`,
        [`RLS-TEST-${sufijo}`]
      );
      assert(lectura.rows.length === 0, "Tenant no puede leer ni su propia fila recién insertada (SELECT bloqueado)", {
        filas: lectura.rows.length,
      });
      await clienteLog.query("COMMIT");
    } finally {
      clienteLog.release();
    }
    assert(insertoLogOk, "INSERT desde contexto de tenant se permitió (el log real no se rompe)");

    const verificacionSuperuser = await pool.query(
      `SELECT tenant_id FROM razas_sin_coincidencia_log WHERE raza_texto = $1`,
      [`RLS-TEST-${sufijo}`]
    );
    assert(
      verificacionSuperuser.rows.length === 1 && verificacionSuperuser.rows[0].tenant_id === tenantA,
      "La fila SÍ quedó insertada de verdad (visible vía pool con bypass)",
      verificacionSuperuser.rows[0]
    );
  } finally {
    console.log("\n=== Limpieza ===");
    await pool.query(`DELETE FROM correos_enviados WHERE tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await pool.query(`DELETE FROM razas_sin_coincidencia_log WHERE raza_texto = $1`, [`RLS-TEST-${sufijo}`]);
    await tenantConn.end();
    console.log("Filas descartables eliminadas.");
  }

  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
