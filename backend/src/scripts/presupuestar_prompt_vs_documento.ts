import { pool } from "../db";
import { HERRAMIENTAS_AGENTE } from "../herramientasAgente";

// ---------------------------------------------------------------------
// Costo del experimento «¿una regla en documento manda como una en el
// prompt?».
//
// CAMBIO DE DISEÑO respecto de lo propuesto. Correr contra la línea base
// no serviría: desde que se tomó cambiaron TRES cosas —neuro reparado, el
// bloque común ampliado con once frases, y el marco agregado—. Una mejora
// no se podría atribuir a ninguna de las tres.
//
// En su lugar, A/B en el mismo estado del código: los mismos estímulos,
// los mismos agentes, el mismo momento, con el marco en contexto y sin él.
// Todo lo demás queda constante por construcción, no por supuesto.
//
// Además es un diseño PAREADO: cada agente es su propio control. Eso saca
// la varianza entre agentes, que era el término dominante del cálculo de
// resolución anterior (35 puntos de diferencia mínima detectable).
//
// Los estímulos usan reglas que existen SOLO en el marco: 97 de las 117
// no tienen equivalente en ningún prompt, así que hay de dónde elegir.
// Si la regla estuviera también en el prompt, una mejora no sería
// atribuible al documento.

const CHARS_POR_TOKEN = 3.6;
const PRECIO = { entrada: 3.0 / 1e6, salida: 15.0 / 1e6, escritura1h: 6.0 / 1e6, lectura: 0.3 / 1e6 };
const ESTIMULOS = 3;
const TURNOS = 2;
const PASADAS_JUEZ = 2;
const SALIDA_AGENTE = 900;
const SALIDA_JUEZ = 300;
const ENUNCIADO = 400;

async function main() {
  const agentes = (await pool.query(`SELECT id, slug, system_prompt FROM agentes WHERE system_prompt IS NOT NULL ORDER BY slug`)).rows;
  const herr = JSON.stringify(HERRAMIENTAS_AGENTE).length / CHARS_POR_TOKEN;
  const marcoChars = (
    await pool.query(`SELECT length(contenido_texto) n FROM documentos_conocimiento WHERE nombre ILIKE '%Marco de Razonamiento%'`)
  ).rows[0].n as number;
  const marcoTok = marcoChars / CHARS_POR_TOKEN;

  let escrituraCon = 0, escrituraSin = 0, lecturaCon = 0, lecturaSin = 0;
  const client = await pool.connect();
  try {
    for (const a of agentes) {
      const docs = (
        await client.query(
          `SELECT sum(length(contenido_texto))::int n FROM documentos_conocimiento
            WHERE estado='activo' AND incluir_en_contexto AND (agente_id IS NULL OR agente_id=$1) AND ambito <> 'generacion'`,
          [a.id]
        )
      ).rows[0].n as number;
      const conMarco = herr + (a.system_prompt.length + docs) / CHARS_POR_TOKEN;
      const sinMarco = conMarco - marcoTok;
      const llamadas = ESTIMULOS * TURNOS;
      // Cada rama tiene su propio prefijo: dos escrituras de caché por agente.
      escrituraCon += conMarco; escrituraSin += sinMarco;
      lecturaCon += conMarco * (llamadas - 1); lecturaSin += sinMarco * (llamadas - 1);
    }
  } finally { client.release(); }

  const llamadasAgente = agentes.length * ESTIMULOS * TURNOS * 2;
  const llamadasJuez = agentes.length * ESTIMULOS * PASADAS_JUEZ * 2;
  const entradaJuez = (400 + ENUNCIADO + SALIDA_AGENTE) * llamadasJuez;

  const c = {
    escritura: (escrituraCon + escrituraSin) * PRECIO.escritura1h,
    lectura: (lecturaCon + lecturaSin) * PRECIO.lectura,
    entrada: ENUNCIADO * llamadasAgente * PRECIO.entrada,
    salidaAgente: SALIDA_AGENTE * llamadasAgente * PRECIO.salida,
    entradaJuez: entradaJuez * PRECIO.entrada,
    salidaJuez: SALIDA_JUEZ * llamadasJuez * PRECIO.salida,
  };
  const total = Object.values(c).reduce((x, y) => x + y, 0);

  console.log("EXPERIMENTO: ¿una regla en documento manda como una en el prompt?\n");
  console.log(`Diseño A/B pareado · ${ESTIMULOS} estímulos × ${agentes.length} agentes × 2 ramas × ${TURNOS} turnos`);
  console.log(`El marco pesa ${marcoChars.toLocaleString("es")} caracteres (~${Math.round(marcoTok).toLocaleString("es")} tokens) y es la única diferencia entre ramas.\n`);
  console.log(`   ${llamadasAgente} llamadas al agente · ${llamadasJuez} al juez`);
  console.log(`   ${agentes.length * 2} escrituras de caché (cada rama tiene su prefijo)\n`);
  console.log("COSTO");
  const l = (k: string, v: number) => console.log(`   ${k.padEnd(32)}USD ${v.toFixed(2).padStart(6)}`);
  l("escritura de caché", c.escritura);
  l("lectura de caché", c.lectura);
  l("entrada variable", c.entrada);
  l("salida del agente", c.salidaAgente);
  l("entrada del juez", c.entradaJuez);
  l("salida del juez", c.salidaJuez);
  console.log(`   ${"".padEnd(32)}${"-".repeat(10)}`);
  l("TOTAL", total);

  console.log(`\nRESOLUCIÓN (criterio fijado ANTES de correr)`);
  const pares = agentes.length * ESTIMULOS;
  console.log(`   ${pares} observaciones pareadas: cada agente es su propio control.`);
  console.log(`   Con el signo como prueba, si el marco da vuelta 6 o más de ${pares} de falla a`);
  console.log(`   cumplimiento y ninguna en sentido contrario, es significativo al 95 %.`);
  console.log(`   Menos de 3 discordancias, o discordancias en las dos direcciones, es ruido.`);
  console.log(`\n   Comparar: el contraste entre agentes necesitaba 35 puntos de diferencia.`);
  console.log(`   El pareado saca la varianza entre agentes, que era el término dominante.`);
  await pool.end();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
