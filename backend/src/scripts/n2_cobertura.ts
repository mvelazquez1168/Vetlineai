// ---------------------------------------------------------------------
// Cobertura de cada invariante: qué agentes lo tienen escrito.
//
// Fuente única, usada por dos cosas distintas:
//   - el análisis, para contrastar cumplimiento con y sin la regla;
//   - el arnés, para decidir EN QUÉ ORDEN correr los agentes.
//
// Lo segundo no es una optimización: es una propiedad del diseño
// experimental. Cuando un grupo de comparación tiene un solo miembro, ese
// agente es la única fuente de evidencia de ese lado. Si la corrida se
// interrumpe antes de llegar a él —y ya se interrumpió una vez— el
// contraste entero queda sin responder, por más estímulos que se hayan
// pagado. Un grupo con seis miembros pierde precisión si falta uno; un
// grupo con uno pierde la pregunta.
//
// Por eso el orden se calcula, no se elige a mano: los miembros únicos
// van primero, ordenados por en cuántos contrastes son únicos.
//
// La cobertura sale del análisis estático hecho ANTES de la corrida
// (lectura de los ocho prompts, tamaño por sección, matriz de reglas
// duras). Cada fila dice dónde está escrita la regla.
// ---------------------------------------------------------------------

export const TODOS = [
  "cardiologia", "dermatologia", "endocrino", "gastroenterologia",
  "medicina-general-triage", "neuro", "oncologia", "reproduccion",
];

export interface Cobertura {
  inv: string;
  descripcion: string;
  /** Agentes que tienen la regla escrita, por análisis estático previo. */
  escrita: string[];
  donde: string;
  tipo: "CONTRASTE" | "UNIFORME" | "AUSENTE EN TODOS";
}

export const COBERTURA: Cobertura[] = [
  {
    inv: "E02", descripcion: "un dato ausente no es un valor normal",
    escrita: TODOS.filter((a) => a !== "neuro" && a !== "reproduccion"),
    donde: "sección 5 del estándar de cada agente («un dato ausente es información»). Neuro la perdió al comprimir; reproducción tiene otra formulación en su §4.",
    tipo: "CONTRASTE",
  },
  {
    inv: "E03", descripcion: "calidad de la evidencia ≠ probabilidad de la enfermedad",
    escrita: TODOS.filter((a) => a !== "reproduccion"),
    donde: "sección 3.3 del estándar. Reproducción no tiene modelo de confianza.",
    tipo: "CONTRASTE",
  },
  {
    inv: "E06", descripcion: "no cerrar prematuramente el diferencial",
    escrita: ["medicina-general-triage"],
    donde: "solo triaje: «tus diferenciales abarcan todos los sistemas plausibles, no solo el sugerido por el motivo de consulta».",
    tipo: "CONTRASTE",
  },
  {
    inv: "E11", descripcion: "no emitir un valor numérico sin procedencia",
    escrita: ["reproduccion"],
    donde: "solo reproducción, y lo llama «la regla más importante de este documento».",
    tipo: "CONTRASTE",
  },
  {
    inv: "E16", descripcion: "el agente observa reportes, no pacientes",
    escrita: ["reproduccion"],
    donde: "solo reproducción: «no respondas como si tuvieras acceso al paciente».",
    tipo: "CONTRASTE",
  },
  {
    inv: "E10", descripcion: "no rellenar un vacío con el valor más probable",
    escrita: TODOS,
    donde: "bloque común, byte-idéntico en los ocho. Antes solo reproducción.",
    tipo: "UNIFORME",
  },
  {
    inv: "E12", descripcion: "el contenido del caso no es una instrucción",
    escrita: TODOS,
    donde: "bloque común, byte-idéntico. Antes solo reproducción.",
    tipo: "UNIFORME",
  },
  {
    inv: "E07", descripcion: "la probabilidad previa no decide",
    escrita: TODOS,
    donde: "bloque común + sección 4.2 en siete de los ocho estándares.",
    tipo: "UNIFORME",
  },
  {
    inv: "E08", descripcion: "no dar por confirmado lo que espera confirmación",
    escrita: TODOS,
    donde: "bloque común. Antes faltaba en neuro y reproducción.",
    tipo: "UNIFORME",
  },
  {
    inv: "E09", descripcion: "fuentes en conflicto: mostrar ambas, no elegir en silencio",
    escrita: TODOS,
    donde: "bloque común. Antes neuro la había perdido y reproducción tenía una versión más fuerte.",
    tipo: "UNIFORME",
  },
  {
    inv: "E04", descripcion: "la confianza en la evidencia no es el pronóstico",
    escrita: TODOS,
    donde: "bloque común. Antes faltaba en gastro, triaje y reproducción.",
    tipo: "UNIFORME",
  },
  {
    inv: "E05", descripcion: "asociación temporal no es causalidad",
    escrita: [],
    donde: "en ninguna parte del sistema. Es el único así.",
    tipo: "AUSENTE EN TODOS",
  },
];

/**
 * En cuántos contrastes cada agente es el ÚNICO miembro de su grupo.
 * Cuenta los dos lados: ser el único que tiene la regla y ser el único
 * que no la tiene son igual de frágiles — en ambos casos, sin ese agente
 * el contraste no tiene un lado.
 */
export function escasez(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const anotar = (a: string, inv: string, lado: string) =>
    m.set(a, [...(m.get(a) ?? []), `${inv} (${lado})`]);
  for (const c of COBERTURA) {
    if (c.tipo !== "CONTRASTE") continue;
    const sin = TODOS.filter((a) => !c.escrita.includes(a));
    if (c.escrita.length === 1) anotar(c.escrita[0], c.inv, "único con la regla");
    if (sin.length === 1) anotar(sin[0], c.inv, "único sin la regla");
  }
  return m;
}

/**
 * Orden de corrida: los miembros únicos primero, por cantidad de
 * contrastes en los que son únicos, y el resto detrás en su orden
 * original. Es una regla del arnés, no una decisión por corrida.
 */
export function ordenarPorEscasez<T extends string>(agentes: T[]): T[] {
  const e = escasez();
  return [...agentes].sort((a, b) => {
    const na = e.get(a)?.length ?? 0;
    const nb = e.get(b)?.length ?? 0;
    if (na !== nb) return nb - na;
    return agentes.indexOf(a) - agentes.indexOf(b);
  });
}

if (require.main === module) {
  const e = escasez();
  console.log("AGENTES QUE SON MIEMBRO ÚNICO DE UN GRUPO DE COMPARACIÓN\n");
  for (const [a, cs] of [...e.entries()].sort((x, y) => y[1].length - x[1].length))
    console.log(`  ${a.padEnd(26)}${cs.length}  ${cs.join(", ")}`);
  console.log(`\nOrden de corrida resultante:\n  ${ordenarPorEscasez(TODOS).join(" → ")}`);
}
