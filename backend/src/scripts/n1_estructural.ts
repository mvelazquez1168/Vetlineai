import fs from "fs";
import path from "path";
import { HERRAMIENTAS_AGENTE } from "../herramientasAgente";
import { SINTESIS_TOOL } from "../sintesisClinica";

// ---------------------------------------------------------------------
// N1 — Validación estructural del modelo de razonamiento.
//
// Determinista, sin llamadas a la API, sin costo. Está pensada para
// correr en CI, pero su primer uso es otro: correrla ANTES de tocar nada
// para tener la línea base. Las fallas que reporta hoy no son bugs de la
// prueba — son el estado actual del sistema, medido.
//
// Las siete comprobaciones salen del documento de diseño, sección 10.
// Cada una responde a algo que ya pasó de verdad en este repositorio.
// ---------------------------------------------------------------------

const RAIZ = path.join(__dirname, "..");
const PROMPTS = path.join(RAIZ, "seed", "plataforma", "prompts");
const MARCA_COMUN = "## Reglas comunes a todos los agentes clínicos de Vetline Ai";

// Registro canónico (documento de diseño, sección 5.1). Un campo que
// represente uno de estos conceptos DEBE llamarse así y usar estos
// valores. Es lo que convierte "no confundas los conceptos" en una
// comprobación mecánica.
const REGISTRO_CANONICO: Record<string, { concepto: string; valores: string[] | null }> = {
  sustento: { concepto: "calidad de la evidencia", valores: ["solida", "parcial", "insuficiente"] },
  probabilidad: { concepto: "probabilidad diagnóstica", valores: ["alta", "moderada", "baja", "descartada"] },
  "confirmacion.estado": {
    concepto: "estado de confirmación",
    valores: ["sospechada", "apoyada", "confirmada", "refutada", "no_confirmable"],
  },
  procedencia: { concepto: "procedencia del dato", valores: ["medido", "reportado", "derivado", "citado"] },
  pronostico: { concepto: "pronóstico", valores: ["favorable", "reservado", "grave", "incierto", "pendiente"] },
};

// Nombres que hoy existen y que el registro considera obsoletos o ambiguos.
const NOMBRES_PROSCRITOS: Record<string, string> = {
  confianza: "ambiguo — se resuelve en 'sustento' (evidencia) o 'probabilidad' (enfermedad)",
  clinical_confidence: "renombrar a 'sustento'",
  confianza_diagnostica: "numérico con precisión falsa — reemplazar por 'sustento'",
};

interface Campo {
  tool: string;
  ruta: string;
  nombre: string;
  valores: string[] | null;
  tipo: string;
}

function recorrer(nodo: any, tool: string, ruta: string, out: Campo[]) {
  if (!nodo || typeof nodo !== "object") return;
  if (nodo.properties) {
    for (const [k, v] of Object.entries<any>(nodo.properties)) {
      const r = ruta ? `${ruta}.${k}` : k;
      out.push({
        tool,
        ruta: r,
        nombre: k,
        valores: Array.isArray(v.enum) ? v.enum.filter((x: any) => x !== null).map(String).sort() : null,
        tipo: Array.isArray(v.type) ? v.type.join("|") : String(v.type ?? "?"),
      });
      recorrer(v, tool, r, out);
    }
  }
  if (nodo.items) recorrer(nodo.items, tool, `${ruta}[]`, out);
}

interface Resultado {
  id: string;
  titulo: string;
  ok: boolean;
  detalle: string[];
}
const resultados: Resultado[] = [];
const registrar = (id: string, titulo: string, detalle: string[]) =>
  resultados.push({ id, titulo, ok: detalle.length === 0, detalle });

function main() {
  const campos: Campo[] = [];
  // La sintesis entra en N1 como una tool mas: es donde viven ahora los
  // conceptos canonicos, y dejarla afuera seria verificar el modelo viejo.
  for (const t of [...(HERRAMIENTAS_AGENTE as any[]), SINTESIS_TOOL]) recorrer(t.input_schema, t.name, "", campos);
  const conEnum = campos.filter((c) => c.valores && c.valores.length);

  // ---------------------------------------------------------------
  // N1.1 — El bloque de reglas comunes, byte-idéntico en los ocho.
  // ---------------------------------------------------------------
  {
    const fallas: string[] = [];
    const archivos = fs.readdirSync(PROMPTS).filter((f) => f.endsWith(".txt"));
    const bloques = new Map<string, string>();
    for (const f of archivos) {
      const t = fs.readFileSync(path.join(PROMPTS, f), "utf8").replace(/\r\n/g, "\n");
      const i = t.indexOf(MARCA_COMUN);
      if (i < 0) fallas.push(`${f}: sin el bloque común`);
      else bloques.set(f, t.slice(i).trimEnd());
    }
    const variantes = [...new Set(bloques.values())];
    if (variantes.length > 1) fallas.push(`${variantes.length} variantes distintas del bloque común`);
    registrar("N1.1", "Reglas comunes byte-idénticas en los ocho prompts", fallas);
  }

  // ---------------------------------------------------------------
  // N1.2 — Un mismo nombre de campo no puede tener dos vocabularios.
  // ---------------------------------------------------------------
  {
    const fallas: string[] = [];
    const porNombre = new Map<string, Map<string, string[]>>();
    for (const c of conEnum) {
      const m = porNombre.get(c.nombre) ?? new Map();
      m.set(c.valores!.join("|"), [...(m.get(c.valores!.join("|")) ?? []), `${c.tool}:${c.ruta}`]);
      porNombre.set(c.nombre, m);
    }
    for (const [nombre, vocabs] of porNombre) {
      if (vocabs.size > 1) {
        fallas.push(`'${nombre}' usa ${vocabs.size} vocabularios distintos:`);
        for (const [v, dondes] of vocabs) fallas.push(`      [${v}]  en ${dondes.join(", ")}`);
      }
    }
    registrar("N1.2", "Un nombre de campo, un solo vocabulario", fallas);
  }

  // ---------------------------------------------------------------
  // N1.3 — Un mismo vocabulario bajo dos nombres = concepto duplicado.
  //        Es la comprobación que habría cazado confianza/probabilidad.
  // ---------------------------------------------------------------
  {
    const fallas: string[] = [];
    const porVocab = new Map<string, Set<string>>();
    const dondes = new Map<string, string[]>();
    // Mismo concepto en dos alcances distintos NO es un duplicado. El
    // sustento de una hipotesis y el del caso entero son la misma cosa
    // medida sobre distinto objeto, y comparten vocabulario a proposito.
    // La excepcion va declarada y acotada: cualquier otro par que comparta
    // vocabulario sigue siendo un hallazgo.
    const MISMO_CONCEPTO_OTRO_ALCANCE = new Set(["sustento|nivel", "nivel|sustento"]);
    for (const c of conEnum) {
      const k = c.valores!.join("|");
      if (c.valores!.length < 3) continue; // vocabularios chicos coinciden por azar
      porVocab.set(k, (porVocab.get(k) ?? new Set()).add(c.nombre));
      dondes.set(k, [...(dondes.get(k) ?? []), `${c.tool}:${c.ruta}`]);
    }
    for (const [vocab, nombres] of porVocab) {
      if (nombres.size > 1 && !MISMO_CONCEPTO_OTRO_ALCANCE.has([...nombres].sort().join("|"))) {
        fallas.push(`el vocabulario [${vocab}] aparece bajo ${nombres.size} nombres: ${[...nombres].join(", ")}`);
        fallas.push(`      en ${dondes.get(vocab)!.join(", ")}`);
      }
    }
    registrar("N1.3", "Un vocabulario, un solo concepto", fallas);
  }

  // ---------------------------------------------------------------
  // N1.4 — Conformidad con el registro canónico.
  // ---------------------------------------------------------------
  {
    const fallas: string[] = [];
    for (const c of campos) {
      const proscrito = NOMBRES_PROSCRITOS[c.nombre];
      if (proscrito) fallas.push(`'${c.nombre}' (${c.tool}:${c.ruta}) — ${proscrito}`);
    }
    for (const [nombre, def] of Object.entries(REGISTRO_CANONICO)) {
      // Las claves con punto se buscan por RUTA, no por nombre de hoja:
      // 'confirmacion.estado' no debe matchear cualquier campo llamado
      // 'estado'. Buscarlo por hoja hacía que la comprobación acusara a
      // clinical_state.estado de no usar el vocabulario de confirmación,
      // que es un falso positivo — son conceptos distintos.
      const encontrados = nombre.includes(".")
        ? campos.filter((c) => c.ruta.endsWith(nombre))
        : campos.filter((c) => c.nombre === nombre);
      if (encontrados.length === 0) {
        fallas.push(`falta el campo canónico '${nombre}' (${def.concepto}) en las tools`);
        continue;
      }
      for (const e of encontrados) {
        if (def.valores && e.valores && e.valores.join("|") !== [...def.valores].sort().join("|"))
          fallas.push(`'${nombre}' en ${e.tool}:${e.ruta} usa [${e.valores.join("|")}], el registro dice [${def.valores.join("|")}]`);
      }
    }
    registrar("N1.4", "Conformidad con el registro canónico", fallas);
  }

  // ---------------------------------------------------------------
  // N1.5 — Toda entidad-hipótesis debe poder expresar provisionalidad.
  // ---------------------------------------------------------------
  {
    const fallas: string[] = [];
    // Solo las rutas de ITEM (terminadas en []) son entidades-hipótesis;
    // el array contenedor no tiene campos propios y aparecía como una
    // falla duplicada de su propio item.
    const rutasHipotesis = [...new Set(
      campos
        .filter((c) => /diferencial|differential|journal/i.test(c.ruta))
        .map((c) => c.ruta.replace(/\[\]\..*$/, "[]"))
        .filter((r) => r.endsWith("[]"))
    )];
    for (const r of rutasHipotesis) {
      const hijos = campos.filter((c) => c.ruta.startsWith(r + ".")).map((c) => c.nombre);
      if (!hijos.some((h) => /confirmacion|estado_confirmacion/.test(h)))
        fallas.push(`'${r}' no puede expresar estado de confirmación (campos: ${hijos.join(", ") || "—"})`);
    }
    if (rutasHipotesis.length === 0) fallas.push("no se encontró ninguna entidad de hipótesis en las tools");
    registrar("N1.5", "Provisionalidad representable en toda hipótesis", fallas);
  }

  // ---------------------------------------------------------------
  // N1.6 — Razonamiento duplicado entre prompts y código.
  // ---------------------------------------------------------------
  {
    const norm = (s: string) =>
      s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const shingles = (s: string, n = 7) => {
      const p = norm(s).split(" ").filter(Boolean);
      const out = new Set<string>();
      for (let i = 0; i + n <= p.length; i++) out.add(p.slice(i, i + n).join(" "));
      return out;
    };
    const shPrompts = new Set<string>();
    for (const f of fs.readdirSync(PROMPTS).filter((x) => x.endsWith(".txt")))
      for (const s of shingles(fs.readFileSync(path.join(PROMPTS, f), "utf8"))) shPrompts.add(s);

    const fallas: string[] = [];
    const rutas = ["routes/casos.routes.ts", "routes/workspace.routes.ts", "routes/recetas.routes.ts", "herramientasAgente.ts"];
    for (const r of rutas) {
      const src = fs.readFileSync(path.join(RAIZ, r), "utf8");
      for (const m of src.matchAll(/"([^"\\]{80,})"/g)) {
        const comunes = [...shingles(m[1])].filter((x) => shPrompts.has(x));
        if (comunes.length >= 2)
          fallas.push(`${r}: literal repite razonamiento de los prompts → "${m[1].slice(0, 80)}…"`);
      }
      // Reglas de razonamiento escritas en código aunque no sean copia literal.
      for (const m of src.matchAll(/"([^"\\]{40,})"/g))
        if (/nunca completes|nunca complete|no inventes|nunca se rellena|sin datos reales/i.test(m[1]))
          fallas.push(`${r}: regla de razonamiento redactada en código → "${m[1].slice(0, 80)}…"`);
    }
    registrar("N1.6", "Sin razonamiento duplicado entre prompts y código", [...new Set(fallas)]);
  }

  // ---------------------------------------------------------------
  // N1.7 — Trazabilidad presente en todo camino que concluye.
  // ---------------------------------------------------------------
  {
    const fallas: string[] = [];
    for (const t of HERRAMIENTAS_AGENTE as any[]) {
      const propios = campos.filter((c) => c.tool === t.name);
      const tieneTraza = propios.some((c) => /trazabilidad|matriz_evidencia/.test(c.nombre));
      const tieneLimitacion = propios.some((c) => /limitacion/.test(c.nombre));
      if (!tieneTraza) fallas.push(`${t.name}: sin objeto de trazabilidad`);
      else if (!tieneLimitacion) fallas.push(`${t.name}: trazabilidad sin el eslabón 'limitacion'`);
    }
    fallas.push("chat (workspace.routes.ts): sin trazabilidad — no usa tool, el razonamiento va en prosa");
    registrar("N1.7", "Trazabilidad en todo camino que produce conclusiones", fallas);
  }

  // ---------------------------------------------------------------
  const ancho = 74;
  console.log("N1 — VALIDACIÓN ESTRUCTURAL\n");
  for (const r of resultados) {
    console.log(`${r.ok ? "[OK ]" : "[FAL]"} ${r.id}  ${r.titulo}`);
    for (const d of r.detalle) console.log(`        ${d}`);
    console.log("");
  }
  const ok = resultados.filter((r) => r.ok).length;
  console.log("-".repeat(ancho));
  console.log(`${ok} de ${resultados.length} comprobaciones en verde.`);
  if (ok < resultados.length)
    console.log(`\nEstas fallas son la LÍNEA BASE, no bugs de la prueba: describen el estado\nactual del sistema antes de la fase 1.`);
  process.exit(0); // en línea base nunca corta; en CI se invierte con --ci
}

main();
