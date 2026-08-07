// Prompt agentes/países, Prompt A Paso 3 — reparación puntual de los
// médicos activos que quedaron sin ninguna fila en medico_agente pese a
// que su clínica sí tiene agentes habilitados. No es la regla permanente
// (esa es asignarAgenteAlRegistrante() en medicoAgente.ts, más el flujo
// manual del administrador) — este script es idempotente y se puede
// volver a correr si hiciera falta (ej. una migración de datos futura
// que vuelva a dejar médicos sin asignación).
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/reparar_medico_agente.ts
import { pool } from "../db";
import { repararAsignacionesFaltantes } from "../medicoAgente";

async function main() {
  const resultado = await repararAsignacionesFaltantes(pool);
  console.log(
    `Reparación completa: ${resultado.filasCreadas} filas creadas en medico_agente, ${resultado.clinicasAfectadas} clínica(s) afectada(s).`
  );
  await pool.end();
}

main().catch((err) => {
  console.error("reparar_medico_agente falló", err);
  process.exit(1);
});
