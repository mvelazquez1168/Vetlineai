import { pool } from "../db";

// Barrido de candidatos para C4 (umbral ausente) y C4b (umbral presente).
//
// Adivinar un candidato y verificarlo de a uno es lento y sesgado: se
// termina eligiendo el primero que da bien. Acá se prueban varios por
// agente y se elige con la tabla a la vista.
//
// Criterio de "presente": el término aparece Y hay una cifra con unidad
// cerca. Nombrar un parámetro no es tener su valor de corte.

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ");
const RE_CIFRA = /\d+([.,]\d+)?\s*(%|mg|µg|ug|ng|g\/dl|mmol|mcg|ui|u\/l|cm|mm|kg|dias?|semanas?|horas?|h\b|min|meses)/;

interface Cand { etiqueta: string; terminos: string[] }

const CANDIDATOS: Record<string, Cand[]> = {
  cardiologia: [
    { etiqueta: "intervalo de reevaluacion ecocardiografica", terminos: ["reevaluacion ecocardiografica"] },
    { etiqueta: "criterios numericos de etapa B2", terminos: ["etapa b2"] },
    { etiqueta: "VHS / vertebral heart score", terminos: ["vhs"] },
    { etiqueta: "frecuencia respiratoria en reposo", terminos: ["frecuencia respiratoria"] },
    { etiqueta: "dosis de pimobendan", terminos: ["pimobendan"] },
  ],
  "medicina-general-triage": [
    { etiqueta: "hematocrito de referencia", terminos: ["hematocrito"] },
    { etiqueta: "creatinina / estadificacion IRIS", terminos: ["creatinina"] },
    { etiqueta: "temperatura corporal normal", terminos: ["temperatura"] },
    { etiqueta: "niveles de evidencia I a III", terminos: ["nivel de evidencia"] },
    { etiqueta: "condicion corporal BCS", terminos: ["bcs"] },
  ],
};

async function main() {
  const agentes = (await pool.query(`SELECT id, slug FROM agentes WHERE system_prompt IS NOT NULL ORDER BY slug`)).rows;
  console.log("BARRIDO DE CANDIDATOS — ¿el umbral está, con valor numérico, en el contexto del agente?\n");
  for (const a of agentes) {
    const docs = (
      await pool.query(
        `SELECT nombre, contenido_texto FROM documentos_conocimiento
          WHERE estado='activo' AND incluir_en_contexto = true AND (agente_id IS NULL OR agente_id = $1)`,
        [a.id]
      )
    ).rows.map((r) => ({ nombre: r.nombre, texto: norm(r.contenido_texto ?? "") }));

    console.log(`\n${a.slug}  (${docs.length} documentos)`);
    console.log("  " + "-".repeat(84));
    for (const c of CANDIDATOS[a.slug] ?? []) {
      let hit: { doc: string; ext: string } | null = null;
      for (const d of docs) {
        if (!c.terminos.every((t) => d.texto.includes(norm(t)))) continue;
        let desde = 0;
        for (;;) {
          const i = d.texto.indexOf(norm(c.terminos[0]), desde);
          if (i < 0) break;
          desde = i + 1;
          const v = d.texto.slice(Math.max(0, i - 110), i + 110);
          if (RE_CIFRA.test(v)) { hit = { doc: d.nombre, ext: v }; break; }
        }
        if (hit) break;
      }
      console.log(`  ${(hit ? "PRESENTE" : "ausente ").padEnd(10)}${c.etiqueta.padEnd(48)}${hit ? hit.doc.slice(0, 30) : ""}`);
      if (hit) console.log(`             …${hit.ext.slice(60, 175)}…`);
    }
  }
  await pool.end();
}

main().catch((e) => { console.error("ERROR", e.message ?? e); process.exit(1); });
