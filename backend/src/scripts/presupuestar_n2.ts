import { pool } from "../db";
import { obtenerDocumentosParaContexto } from "../routes/casos.routes";
import { HERRAMIENTAS_AGENTE } from "../herramientasAgente";

// Presupuesto exacto de una corrida de N2 (decisión 16.7).
//
// No estima "un prompt típico": mide el prefijo real de cada agente
// —system_prompt + documentos clínicos que le tocan— y lo multiplica por
// el plan de la prueba. La aritmética de caché es la que importa: el
// prefijo se escribe UNA vez por agente y se lee en todas las llamadas
// siguientes, así que el costo no crece con los casos como parecería.
//
// Solo calcula. No llama a la API.

const PRECIO = {
  entrada: 3.0 / 1_000_000,
  salida: 15.0 / 1_000_000,
  escrituraCache1h: (3.0 * 2.0) / 1_000_000,
  lecturaCache: (3.0 * 0.1) / 1_000_000,
};

// 1 token ≈ 3,6 caracteres en español técnico. Es una aproximación
// deliberadamente conservadora (sobreestima) para no prometer de menos.
const CHARS_POR_TOKEN = 3.6;

const CASOS = 10;
const TURNOS = 2; // el caso + una repregunta que fuerza a explicitar
const PASADAS_JUEZ = 2; // doble pasada con criterios invertidos (R4)
const SALIDA_AGENTE = 900; // tokens, respuesta conversacional de chat
const SALIDA_JUEZ = 300; // veredicto + cita textual
const ENUNCIADO_CASO = 400; // tokens del caso sintético

async function main() {
  const agentes = (
    await pool.query(`SELECT id, slug, system_prompt FROM agentes WHERE system_prompt IS NOT NULL ORDER BY slug`)
  ).rows;
  const tenant = (await pool.query(`SELECT id FROM tenants LIMIT 1`)).rows[0];
  const herramientas = JSON.stringify(HERRAMIENTAS_AGENTE).length / CHARS_POR_TOKEN;

  console.log(`Herramientas (comunes a todos): ${Math.round(herramientas).toLocaleString("es")} tokens\n`);
  console.log("agente                     prompt   docs clínicos   prefijo cacheado");
  console.log("-".repeat(74));

  let totalEscritura = 0;
  let totalLectura = 0;
  const client = await pool.connect();
  try {
    for (const a of agentes) {
      const docs = await obtenerDocumentosParaContexto(client as any, a.id, tenant.id);
      const charsDocs = docs.clinicos.reduce((n: number, d: any) => n + (d.contenido_texto?.length ?? 0), 0);
      const tokPrompt = a.system_prompt.length / CHARS_POR_TOKEN;
      const tokDocs = charsDocs / CHARS_POR_TOKEN;
      const prefijo = herramientas + tokPrompt + tokDocs;

      // El prefijo se escribe una vez por agente y se lee en todas las
      // llamadas restantes de ese agente.
      const llamadas = CASOS * TURNOS;
      totalEscritura += prefijo;
      totalLectura += prefijo * (llamadas - 1);

      console.log(
        `${a.slug.padEnd(25)}${Math.round(tokPrompt).toLocaleString("es").padStart(8)}${Math.round(tokDocs)
          .toLocaleString("es")
          .padStart(16)}${Math.round(prefijo).toLocaleString("es").padStart(19)}`
      );
    }
  } finally {
    client.release();
  }

  const llamadasAgente = agentes.length * CASOS * TURNOS;
  const llamadasJuez = agentes.length * CASOS * PASADAS_JUEZ;

  // El juez no lleva prefijo cacheado: recibe invariante + caso + respuesta.
  const entradaJuez = (400 + ENUNCIADO_CASO + SALIDA_AGENTE) * llamadasJuez;

  const costo = {
    escritura: totalEscritura * PRECIO.escrituraCache1h,
    lectura: totalLectura * PRECIO.lecturaCache,
    entradaVariable: ENUNCIADO_CASO * llamadasAgente * PRECIO.entrada,
    salidaAgente: SALIDA_AGENTE * llamadasAgente * PRECIO.salida,
    entradaJuez: entradaJuez * PRECIO.entrada,
    salidaJuez: SALIDA_JUEZ * llamadasJuez * PRECIO.salida,
  };
  const total = Object.values(costo).reduce((a, b) => a + b, 0);

  console.log(`\nPLAN DE LA CORRIDA`);
  console.log(`   ${agentes.length} agentes × ${CASOS} casos × ${TURNOS} turnos = ${llamadasAgente} llamadas al agente`);
  console.log(`   ${agentes.length} agentes × ${CASOS} casos × ${PASADAS_JUEZ} pasadas  = ${llamadasJuez} llamadas al juez`);
  console.log(`\nCOSTO`);
  const linea = (k: string, v: number) => console.log(`   ${k.padEnd(34)}USD ${v.toFixed(2).padStart(6)}`);
  linea("escritura de caché (1 vez/agente)", costo.escritura);
  linea("lectura de caché", costo.lectura);
  linea("entrada variable (enunciados)", costo.entradaVariable);
  linea("salida del agente", costo.salidaAgente);
  linea("entrada del juez", costo.entradaJuez);
  linea("salida del juez", costo.salidaJuez);
  console.log(`   ${"".padEnd(34)}${"-".repeat(10)}`);
  linea("TOTAL por corrida", total);

  console.log(`\n   N3 reutiliza las MISMAS respuestas de N2: costo adicional 0.`);
  console.log(`   Fases que requieren corrida (base + 7): USD ${(total * 8).toFixed(2)}`);
  await pool.end();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
