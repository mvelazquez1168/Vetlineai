// Reconstruye la línea de tiempo del CRM desde los orígenes que ya
// existen (prompt 03, sección 2).
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/reconstruir_crm.ts [tenantId|--todas]
//
// ES IDEMPOTENTE: correrlo dos veces no duplica nada, porque la unicidad
// está en la base (índice por tipo y origen). La segunda corrida informa
// cero eventos nuevos, que es la forma de comprobarlo.
//
// PARA PRODUCCIÓN queda listo como paso del despliegue. Acá NO se corre
// contra producción: el guarda de entorno lo impide.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { reconstruirHistorial } from "../crm/reconstruccion";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

async function main() {
  exigirEntornoDeDesarrollo("reconstruir_crm");
  const arg = process.argv[2];

  const tenants =
    !arg || arg === "--todas"
      ? (
          await pool.query<{ id: string; nombre: string }>(
            `SELECT id, nombre FROM tenants ORDER BY creado_en`
          )
        ).rows
      : (
          await pool.query<{ id: string; nombre: string }>(
            `SELECT id, nombre FROM tenants WHERE id = $1`,
            [arg]
          )
        ).rows;

  if (tenants.length === 0) {
    console.error("No hay clínicas para reconstruir.");
    process.exit(1);
  }

  let totalGeneral = 0;
  for (const t of tenants) {
    const r = await conAlcanceTenant(t.id, (db) => reconstruirHistorial(db, t.id));
    totalGeneral += r.total;

    console.log(`\n=== ${t.nombre} (${t.id}) ===`);
    if (r.total === 0 && r.consentimientosCreados === 0) {
      console.log("Sin eventos nuevos: ya estaba reconstruida.");
    } else {
      console.log(`${r.total} evento(s) nuevos:`);
      for (const [tipo, n] of Object.entries(r.porTipo).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(6)}  ${tipo}`);
      }
      if (r.consentimientosCreados > 0) {
        console.log(
          `  ${String(r.consentimientosCreados).padStart(6)}  consentimientos de clientes existentes`
        );
      }
    }
    if (r.sinReconstruir.length > 0) {
      console.log("No se reconstruyó:");
      for (const s of r.sinReconstruir) {
        console.log(`  ${String(s.cuantos).padStart(6)}  ${s.origen} — ${s.motivo}`);
      }
    }
  }

  console.log(`\nTotal: ${totalGeneral} evento(s) en ${tenants.length} clínica(s).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("ERROR", err);
  await pool.end();
  process.exit(1);
});
