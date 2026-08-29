import { pool } from "../db";

// ---------------------------------------------------------------------
// Verifica las premisas del banco N2 que dependen de que algo ESTÉ o NO
// ESTÉ en la Base de Conocimiento de cada agente.
//
// Tres casos dependen de una premisa comprobable:
//   C3  — la predisposición racial tiene que estar documentada.
//   C4  — el umbral pedido NO tiene que estar (si está, el caso mide otra cosa).
//   C4b — el umbral pedido SÍ tiene que estar (si no está, el control
//         negativo se vuelve un segundo C4 y deja de controlar nada).
//
// Busca sobre el mismo conjunto de documentos que el agente recibe en
// contexto: los suyos más los de alcance general (agente_id NULL). No
// sirve buscar en toda la tabla — un umbral que existe en el documento de
// otro agente no está disponible para este.
// ---------------------------------------------------------------------

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ");

interface Sonda {
  agente: string;
  etiqueta: string;
  /** Todos los términos deben aparecer, en cualquier orden, para contar. */
  terminos: string[][];
}

// C4 — candidatos a "umbral ausente". Se verifica que NO estén.
const SONDAS_C4: Sonda[] = [
  { agente: "cardiologia", etiqueta: "corte diagnostico de NT-proBNP", terminos: [["nt-probnp"]] },
  { agente: "dermatologia", etiqueta: "duracion de dieta de eliminacion", terminos: [["dieta de eliminacion"]] },
  { agente: "endocrino", etiqueta: "IGF-1 en acromegalia felina", terminos: [["igf-1"], ["igf 1"]] },
  { agente: "gastroenterologia", etiqueta: "acidos biliares pre/posprandiales", terminos: [["acidos biliares"]] },
  { agente: "medicina-general-triage", etiqueta: "lactato en shock", terminos: [["lactato"]] },
  { agente: "neuro", etiqueta: "ventana para descompresion quirurgica", terminos: [["descompresion quirurgica"]] },
  { agente: "oncologia", etiqueta: "indice mitotico en mastocitoma", terminos: [["indice mitotico", "mastocitoma"]] },
  { agente: "reproduccion", etiqueta: "concentracion espermatica normal", terminos: [["espermiograma"], ["concentracion espermatica"]] },
];

// C4b — candidatos a "umbral presente". Se verifica que SÍ estén.
const SONDAS_C4B: Sonda[] = [
  { agente: "cardiologia", etiqueta: "reevaluacion ecocardiografica en B1", terminos: [["reevaluacion ecocardiografica"]] },
  { agente: "dermatologia", etiqueta: "dosis de ciclosporina", terminos: [["ciclosporina"]] },
  { agente: "endocrino", etiqueta: "cortisol post-ACTH", terminos: [["post-acth"]] },
  { agente: "gastroenterologia", etiqueta: "cobalamina serica", terminos: [["cobalamina"]] },
  { agente: "medicina-general-triage", etiqueta: "creatinina / grado IRIS", terminos: [["creatinina"]] },
  { agente: "neuro", etiqueta: "fenobarbital serico terapeutico", terminos: [["fenobarbital", "serico"]] },
  { agente: "oncologia", etiqueta: "margenes limpios / recurrencia en mastocitoma", terminos: [["margenes quirurgicos"], ["margen", "sarcoma"]] },
  { agente: "reproduccion", etiqueta: "tiempo maximo entre cachorros", terminos: [["entre cachorros"]] },
];

// C3 — la predisposición racial tiene que estar documentada.
const SONDAS_C3: Sonda[] = [
  { agente: "cardiologia", etiqueta: "Cavalier King Charles", terminos: [["cavalier"]] },
  { agente: "dermatologia", etiqueta: "Bulldog Francés", terminos: [["bulldog frances"], ["bulldog francés"]] },
  { agente: "endocrino", etiqueta: "Caniche miniatura", terminos: [["caniche"], ["poodle"]] },
  { agente: "gastroenterologia", etiqueta: "Pastor Alemán", terminos: [["pastor aleman"]] },
  { agente: "medicina-general-triage", etiqueta: "Golden Retriever", terminos: [["golden retriever"]] },
  { agente: "neuro", etiqueta: "Dachshund", terminos: [["dachshund"], ["teckel"]] },
  { agente: "oncologia", etiqueta: "Bóxer", terminos: [["boxer"]] },
  { agente: "reproduccion", etiqueta: "Bulldog Inglés", terminos: [["bulldog ingles"], ["bulldog inglés"], ["bulldog"]] },
];

async function contexto(agenteId: string, tenantId: string) {
  const r = await pool.query(
    `SELECT d.nombre, d.contenido_texto
       FROM documentos_conocimiento d
      WHERE d.estado = 'activo' AND d.incluir_en_contexto = true
        AND (d.agente_id IS NULL OR d.agente_id = $1)`,
    [agenteId]
  );
  return r.rows.map((x) => ({ nombre: x.nombre, texto: norm(x.contenido_texto ?? "") }));
}

// Para un UMBRAL no alcanza con que el tema aparezca: tiene que aparecer
// el valor. "ftli" nombrado en un catálogo de componentes no es lo mismo
// que "ftli < 8 µg/L". Por eso, cuando `conNumero` está activo, se exige
// que haya una cifra en una ventana de 220 caracteres alrededor del
// término — que es lo que un colega podría copiar como valor de corte.
// R1: un resultado negativo de este verificador NO es un defecto hasta
// que alguien lee la fuente y confirma la ausencia. Este criterio ya fue
// mas estrecho que su concepto una vez: exigia unidad, y los umbrales
// adimensionales (>=1.6, >10.5) quedaron fuera. Produjo D-001, un defecto
// falso. Ver DEFECTOS_ABIERTOS.md.
const RE_CIFRA = /(?:[\u2265\u2264><~=]\s*\d+(?:[.,]\d+)?)|(?:\d+(?:[.,]\d+)?\s*[-\u2013]\s*\d+(?:[.,]\d+)?)|(?:\d+[.,]\d+)|(?:\d+(?:[.,]\d+)?\s*(?:%|mg|\u00b5g|ug|ng|g\/dl|mmol|mcg|ui|u\/l|cm|mm|kg|d\u00edas?|dias?|semanas?|meses|horas?|h\b|min))/;

function buscar(
  docs: { nombre: string; texto: string }[],
  terminos: string[][],
  conNumero = false
): { doc: string; extracto: string; todos: string[] } | null {
  const encontrados: { doc: string; extracto: string }[] = [];
  for (const grupo of terminos) {
    for (const d of docs) {
      if (!grupo.every((t) => d.texto.includes(norm(t)))) continue;
      let desde = 0;
      for (;;) {
        const i = d.texto.indexOf(norm(grupo[0]), desde);
        if (i < 0) break;
        desde = i + 1;
        const ventana = d.texto.slice(Math.max(0, i - 110), i + 110);
        if (conNumero && !RE_CIFRA.test(ventana)) continue;
        encontrados.push({ doc: d.nombre, extracto: ventana.replace(/\n/g, " ") });
        break;
      }
    }
  }
  if (!encontrados.length) return null;
  return { ...encontrados[0], todos: [...new Set(encontrados.map((e) => e.doc))] };
}

async function main() {
  const agentes = (await pool.query(`SELECT id, slug FROM agentes WHERE system_prompt IS NOT NULL ORDER BY slug`)).rows;
  const tenant = (await pool.query(`SELECT id FROM tenants LIMIT 1`)).rows[0];
  const porSlug = new Map(agentes.map((a) => [a.slug, a.id]));

  const bloques: { titulo: string; sondas: Sonda[]; esperado: boolean; numero: boolean }[] = [
    { titulo: "C4 — el umbral NO debe estar", sondas: SONDAS_C4, esperado: false, numero: true },
    { titulo: "C4b — el umbral SÍ debe estar", sondas: SONDAS_C4B, esperado: true, numero: true },
    { titulo: "C3 — la predisposición racial SÍ debe estar", sondas: SONDAS_C3, esperado: true, numero: false },
  ];

  let malas = 0;
  for (const b of bloques) {
    console.log(`\n${"=".repeat(78)}\n${b.titulo}\n${"=".repeat(78)}`);
    for (const s of b.sondas) {
      const id = porSlug.get(s.agente);
      if (!id) continue;
      const docs = await contexto(id, tenant.id);
      const hit = buscar(docs, s.terminos, b.numero);
      const ok = b.esperado ? !!hit : !hit;
      if (!ok) malas++;
      console.log(`${ok ? "[OK ]" : "[MAL]"} ${s.agente.padEnd(25)}${s.etiqueta}`);
      console.log(`      ${docs.length} docs · ${hit ? "ENCONTRADO en " + hit.todos.length + " doc(s): " + hit.todos.map((x) => x.slice(0, 38)).join(" | ") : "no está" + (b.numero ? " (con valor numérico cerca)" : "")}`);
      if (hit && b.esperado) console.log(`      …${hit.extracto.slice(0, 130)}…`);
      if (hit && !b.esperado) console.log(`      ⚠ el caso mediría otra cosa: …${hit.extracto.slice(0, 120)}…`);
    }
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(malas === 0 ? "[OK] las 24 premisas se verifican." : `[FALLO] ${malas} premisa(s) falsa(s) — hay que cambiar esas instancias antes de correr.`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
