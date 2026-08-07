// Verificación pendiente del motor de crédito, Bloque 1 — Parte A del
// Paso 6 original (generación real con GCIS). No se pudo cerrar el
// 2026-08-04 porque la cuenta de Anthropic configurada devuelve
// "Your credit balance is too low to access the Anthropic API" — no es un
// problema de código (el mismo error ya estaba en los logs desde antes de
// esta sesión). Los otros dos caminos del Paso 6 (sin tarifa vigente, y
// claude-sonnet-5-mock no facturable) sí se verificaron y pasaron.
//
// Correr cuando la cuenta tenga saldo:
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_gcis_real.ts
//
// Hace una llamada real y mínima a la API de Anthropic (24 tokens de
// salida como máximo) usando el mismo servicio que usan las rutas reales
// (requerirAnthropic + registrarUsoApi), y confirma contra la base que la
// fila de uso_api resultante tiene costo > 0, las 4 referencias de tarifa
// pobladas, y que el descuento de saldo (bloque 2) dejó movimientos_credito
// coherente. No hace ROLLBACK — la fila y el descuento quedan reales,
// igual que cualquier consumo real de un médico.
import { pool } from "../db";
import { requerirAnthropic } from "../anthropic";
import { registrarUsoApi } from "../tarifas";

const CASO_PIKI = "3f95b788-60e1-4b57-a7c5-294793e2fe9b";

async function main() {
  const client = await pool.connect();
  try {
    const casoResult = await client.query(
      `SELECT c.tenant_id, c.agente_id, c.medico_id, c.dashboard_cache
       FROM casos c WHERE c.id = $1`,
      [CASO_PIKI]
    );
    if (casoResult.rows.length === 0) {
      console.log("No se encontro el caso de Piki (id hardcodeado en este script) — ajustar CASO_PIKI.");
      return;
    }
    const caso = casoResult.rows[0];

    const saldoAntes = await client.query(
      `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1`,
      [caso.tenant_id]
    );
    console.log("Saldo ANTES:", saldoAntes.rows[0]);

    const medicoAgenteResult = await client.query(
      `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2`,
      [caso.medico_id, caso.agente_id]
    );
    const medicoAgenteId = medicoAgenteResult.rows[0]?.id ?? null;

    const anthropic = requerirAnthropic();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 24,
      messages: [{ role: "user", content: "Respondé solamente con la palabra: ok" }],
    });
    console.log("Llamada real a Anthropic OK. usage:", response.usage);

    await registrarUsoApi(client, {
      tenantId: caso.tenant_id,
      casoId: CASO_PIKI,
      medicoAgenteId,
      personaId: caso.medico_id,
      modelo: "claude-sonnet-4-6",
      tokensEntrada: response.usage.input_tokens,
      tokensSalida: response.usage.output_tokens,
      tokensCacheEscritura: response.usage.cache_creation_input_tokens ?? 0,
      tokensCacheLectura: response.usage.cache_read_input_tokens ?? 0,
      tipoConsumo: caso.dashboard_cache === null ? "clinico" : "regeneracion",
      disparadoPor: "usuario",
    });

    const filaResult = await client.query(
      `SELECT id, modelo, tipo_consumo, disparado_por, cobrable, bolsa_afectada,
              costo_usd_calculado, tarifa_entrada_id, tarifa_salida_id,
              tarifa_cache_escritura_id, tarifa_cache_lectura_id
       FROM uso_api WHERE caso_id = $1 ORDER BY "timestamp" DESC LIMIT 1`,
      [CASO_PIKI]
    );
    console.log("Fila insertada en uso_api:");
    console.table(filaResult.rows);

    const saldoDespues = await client.query(
      `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1`,
      [caso.tenant_id]
    );
    console.log("Saldo DESPUES:", saldoDespues.rows[0]);

    const movResult = await client.query(
      `SELECT tipo, bolsa, monto_usd, saldo_plan_post, saldo_comprado_post
       FROM movimientos_credito WHERE referencia_tabla = 'uso_api' AND referencia_id = $1`,
      [filaResult.rows[0].id]
    );
    console.log("Movimientos de credito generados por este consumo:");
    console.table(movResult.rows);

    console.log(
      "\nVerificar a ojo: costo_usd_calculado > 0, las 4 tarifa_*_id pobladas, " +
        "y que saldo ANTES - costo == saldo DESPUES (dentro de la bolsa que corresponda)."
    );
  } catch (err) {
    console.error("FALLO la verificacion (revisar si sigue siendo saldo de la cuenta de Anthropic):", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
