import { requerirAnthropic } from "../anthropic";

// ¿Hay un modelo distinto disponible para la segunda pasada del juez?
//
// Las dos pasadas actuales comparten modelo: coincidir no prueba acertar,
// y un error correlacionado entre ellas es invisible. Un modelo distinto
// en la pasada B convierte el control de "consistencia interna" en algo
// mas parecido a una segunda opinion.
//
// Se prueba disponibilidad y se calcula el costo real de la pasada B
// completa con cada uno.

const CANDIDATOS = [
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-opus-4-1",
  "claude-3-5-haiku-latest",
  "claude-haiku-4-5",
];

// Pasada B completa: 112 estimulos.
const LLAMADAS = 112;
const TOK_ENTRADA = 1700; // invariante + criterios + caso + dos respuestas
const TOK_SALIDA = 300;

async function main() {
  const anthropic = requerirAnthropic();
  console.log("MODELOS DISPONIBLES PARA LA SEGUNDA PASADA DEL JUEZ\n");
  console.log("modelo                          estado        costo de la pasada B completa");
  console.log("-".repeat(78));

  for (const m of CANDIDATOS) {
    try {
      const r: any = await anthropic.messages.create({
        model: m,
        max_tokens: 32,
        messages: [{ role: "user", content: "Respondé solo: OK" }],
      });
      const txt = (r.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      console.log(`${m.padEnd(32)}${("disponible").padEnd(14)}${txt.slice(0, 12)}`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const corto = /not_found|does not exist|Invalid model/i.test(msg) ? "no existe" : msg.slice(0, 40);
      console.log(`${m.padEnd(32)}${corto}`);
    }
  }

  console.log(`\nCOSTO DE LA PASADA B (${LLAMADAS} llamadas · ${TOK_ENTRADA} tok entrada · ${TOK_SALIDA} tok salida)\n`);
  const precios: Record<string, [number, number]> = {
    "claude-haiku-4-5": [1, 5],
    "claude-sonnet-4-6": [3, 15],
    "claude-opus-4-5": [5, 25],
    "claude-opus-4-1": [15, 75],
  };
  for (const [m, [pe, ps]] of Object.entries(precios)) {
    const c = LLAMADAS * (TOK_ENTRADA * pe + TOK_SALIDA * ps) / 1_000_000;
    console.log(`  ${m.padEnd(24)}USD ${c.toFixed(2)}`);
  }
  console.log(`\n  Referencia: la corrida completa de agentes + juez costó ~USD 12,81.`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
