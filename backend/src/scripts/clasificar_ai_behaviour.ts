import { pool } from "../db";

// ---------------------------------------------------------------------
// Clasifica la sección "AI Behaviour" del catálogo de GCIS en dos partes:
// marco de razonamiento aplicable a cualquier especialidad, y contenido
// propio de gastroenterología.
//
// La clasificación es una lista explícita, no un filtro por palabras
// clave: las 23 secciones se leyeron completas y cada una se asignó a
// mano. Un regex sobre "gastrointestinal" habría mandado a la columna
// equivocada componentes que son genéricos con una sola línea de ejemplo
// gastro (CC-201, CC-203) y no habría distinguido un componente que solo
// existe para gastro (CC-205, CC-206) de uno transversal que menciona
// gastro de paso.
//
// Solo reporta. No modifica nada.
// ---------------------------------------------------------------------

// Componentes cuyo AI Behaviour es marco de razonamiento puro: nada de lo
// que dicen depende de la especialidad.
const GENERICO = [
  "CC-001", // resumen ejecutivo del caso: qué tiene, por qué consulta, qué falta
  "CC-002", // perfil del paciente: ajustar por especie/raza/edad/sexo
  "CC-003", // metadata del caso: primera consulta vs seguimiento, no mezclar episodios
  "CC-004", // línea de tiempo: qué pasó primero, no inventar eventos
  "CC-005", // registro de problemas activos: prioridad, evidencia, no borrar historia
  "CC-102", // motivo de consulta y evolución de signos (aparece dos veces, ver aviso)
  "CC-104", // examen físico: normal vs anormal, correlacionar, no inferir
  "CC-106", // scores clínicos: solo escalas validadas, comparar con previos
  "CC-107", // factores de riesgo: predisponente vs desencadenante, no es diagnóstico
  "CC-202", // bioquímica: patrones, tendencias, no diagnosticar por un analito
  "CC-204", // urianálisis: contexto, método de obtención, no asumir infección
  "CC-220", // imagenología: integrar con el resto, no sustituir al especialista
  "CC-231", // histopatología: peso de la evidencia, calidad de la muestra
  "CC-240", // motor de correlación diagnóstica: integrar, explicar, mostrar incertidumbre
];

// Genéricos en su estructura, pero con una línea que nombra gastro. Van al
// documento compartido cambiando esa línea por la especialidad que
// corresponda — son el argumento más fuerte para un documento único
// parametrizado en vez de seis guías escritas de cero.
const GENERICO_CON_LINEA_GASTRO = [
  "CC-105", // nutrición: nombra cobalamina entre los laboratorios a correlacionar
  "CC-201", // hemograma: "patrones compatibles con enfermedades gastrointestinales"
  "CC-203", // electrolitos: "relacionar con la fisiopatología gastrointestinal"
];

// Componentes que solo existen porque el agente es de gastroenterología.
const ESPECIFICO = [
  "CC-205", // diagnóstico fecal
  "CC-206", // biomarcadores gastrointestinales
  "CC-230", // endoscopia
];

async function main() {
  const t = (
    await pool.query(
      `SELECT contenido_texto AS t FROM documentos_conocimiento
        WHERE nombre LIKE 'GCIS Clinical Components Catalog%'`
    )
  ).rows[0].t as string;

  const lineas = t.split("\n");
  let comp: string | null = null;
  let nombre = "";
  let dentro = false;
  const secciones: { id: string; nombre: string; chars: number; encabezados: string[] }[] = [];
  let actual: (typeof secciones)[number] | null = null;

  for (const x of lineas) {
    const c = x.match(/^(CC-\d+)\s*[–-]?\s*(.*)$/);
    if (c && x.length < 90) {
      comp = c[1];
      nombre = (c[2] || "").trim();
      dentro = false;
    }
    if (/^\d+\.\s+AI Behaviour\s*$/.test(x)) {
      dentro = true;
      actual = { id: comp ?? "?", nombre, chars: 0, encabezados: [] };
      secciones.push(actual);
      continue;
    }
    if (dentro && (/^\d+\.\s+\S/.test(x) || /^CC-\d+\s/.test(x))) dentro = false;
    if (dentro && actual && x.trim()) {
      actual.chars += x.length + 1;
      // Los encabezados internos son las líneas que abren una lista de
      // obligaciones o prohibiciones; el resto es contenido.
      if (/^(Claude|Siempre|Nunca|Deberá|Responderá|Utilizará)/.test(x.trim())) {
        actual.encabezados.push(x.trim().replace(/:$/, ""));
      }
    }
  }

  const clase = (id: string) =>
    GENERICO.includes(id)
      ? "generico"
      : GENERICO_CON_LINEA_GASTRO.includes(id)
        ? "generico_ajustable"
        : ESPECIFICO.includes(id)
          ? "especifico"
          : "sin_clasificar";

  const peso: Record<string, number> = { generico: 0, generico_ajustable: 0, especifico: 0, sin_clasificar: 0 };
  for (const s of secciones) peso[clase(s.id)] += s.chars;
  const total = Object.values(peso).reduce((a, b) => a + b, 0);

  const pct = (v: number) => ((v / total) * 100).toFixed(0) + "%";

  console.log(`\nAI Behaviour del catálogo de GCIS: ${secciones.length} secciones, ${total} caracteres\n`);
  console.log("CLASE                                        CHARS      %");
  console.log("---------------------------------------------------------");
  console.log("Marco de razonamiento (cualquier especialidad)".padEnd(45) + String(peso.generico).padStart(7) + pct(peso.generico).padStart(7));
  console.log("  + genérico con una línea gastro ajustable".padEnd(45) + String(peso.generico_ajustable).padStart(7) + pct(peso.generico_ajustable).padStart(7));
  console.log("Específico de gastroenterología".padEnd(45) + String(peso.especifico).padStart(7) + pct(peso.especifico).padStart(7));
  if (peso.sin_clasificar > 0) {
    console.log("SIN CLASIFICAR (revisar)".padEnd(45) + String(peso.sin_clasificar).padStart(7) + pct(peso.sin_clasificar).padStart(7));
  }
  console.log("---------------------------------------------------------");
  console.log(
    "REUTILIZABLE (marco + ajustables)".padEnd(45) +
      String(peso.generico + peso.generico_ajustable).padStart(7) +
      pct(peso.generico + peso.generico_ajustable).padStart(7)
  );

  console.log("\n\nESTRUCTURA DE LA PARTE REUTILIZABLE (encabezados, sin contenido)");
  console.log("=================================================================");
  for (const s of secciones) {
    const c = clase(s.id);
    if (c !== "generico" && c !== "generico_ajustable") continue;
    const marca = c === "generico_ajustable" ? "  [ajustar 1 línea a la especialidad]" : "";
    console.log(`\n${s.id} — ${s.nombre || "(sin nombre)"}  (${s.chars} chars)${marca}`);
    for (const e of s.encabezados) console.log(`    · ${e}`);
  }

  console.log("\n\nESPECÍFICO DE GASTRO (no va al documento compartido)");
  console.log("=================================================================");
  for (const s of secciones) {
    if (clase(s.id) !== "especifico") continue;
    console.log(`  ${s.id} — ${s.nombre} (${s.chars} chars)`);
  }

  // Aviso de integridad: un id repetido con contenido distinto.
  const vistos = new Map<string, number>();
  for (const s of secciones) vistos.set(s.id, (vistos.get(s.id) ?? 0) + 1);
  const repetidos = [...vistos.entries()].filter(([, n]) => n > 1);
  if (repetidos.length > 0) {
    console.log("\n\nAVISO DE INTEGRIDAD DEL CATÁLOGO");
    console.log("=================================================================");
    for (const [id, n] of repetidos) {
      console.log(`  ${id} aparece ${n} veces con contenido distinto — hay un componente mal numerado.`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
