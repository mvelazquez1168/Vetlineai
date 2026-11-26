// ---------------------------------------------------------------------
// EL TEMA DE LA CLÍNICA — prompt 01c, sección 2.
//
// A la clínica se le piden DOS cosas: un color primario y un logo. Todo
// lo demás se deriva. Pedirle cinco colores sería pedirle que diseñe, y
// el resultado serían combinaciones ilegibles.
//
// ESTE MÓDULO ES LA FUENTE ÚNICA DEL CÁLCULO. El mismo código corre en
// el servidor (que guarda y devuelve el tema) y se copia en el cliente
// solo para la vista previa en vivo. Si el cálculo viviera en los dos
// lados escrito dos veces, la vista previa mostraría un color y la
// pantalla real otro.
//
// EL CONTRASTE NO ES OPCIONAL. WCAG AA pide 4,5:1 para texto normal. Si
// el primario elegido no lo cumple contra el texto blanco, se oscurece
// lo justo para cumplir —y la pantalla de configuración lo dice—. Es la
// diferencia entre una interfaz con la marca de la clínica y una
// interfaz que no se puede leer.
// ---------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface TemaCalculado {
  /** El primario tal como lo eligió la clínica. */
  primarioElegido: string;
  /** El que se usa de verdad: igual, o oscurecido para cumplir AA. */
  primario: string;
  /** `true` si hubo que oscurecerlo. La pantalla lo avisa. */
  ajustado: boolean;
  contrasteConBlanco: number;
  /** Blanco o casi negro, según cuál se lea mejor sobre el primario. */
  sobrePrimario: string;
  primarioHover: string;
  primarioSuave: string;
  primarioOscuro: string;
  primarioBorde: string;
}

export const PRIMARIO_POR_DEFECTO = "#0F766E";
export type TemaPredefinido = "marca" | "sereno" | "vibrante";
export const TEMAS: TemaPredefinido[] = ["marca", "sereno", "vibrante"];

export function aRgb(hex: string): Rgb {
  const limpio = hex.trim().replace(/^#/, "");
  const completo =
    limpio.length === 3
      ? limpio
          .split("")
          .map((c) => c + c)
          .join("")
      : limpio;
  if (!/^[0-9a-fA-F]{6}$/.test(completo)) {
    throw new Error(`"${hex}" no es un color hexadecimal válido (se espera #RRGGBB).`);
  }
  return {
    r: parseInt(completo.slice(0, 2), 16),
    g: parseInt(completo.slice(2, 4), 16),
    b: parseInt(completo.slice(4, 6), 16),
  };
}

export function aHex({ r, g, b }: Rgb): string {
  const dos = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${dos(r)}${dos(g)}${dos(b)}`.toUpperCase();
}

/** Luminancia relativa, según la definición de WCAG 2.1. */
export function luminancia({ r, g, b }: Rgb): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razón de contraste entre dos colores, de 1 a 21. */
export function contraste(a: Rgb, b: Rgb): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const claro = Math.max(la, lb);
  const oscuro = Math.min(la, lb);
  return (claro + 0.05) / (oscuro + 0.05);
}

const BLANCO: Rgb = { r: 255, g: 255, b: 255 };
const CASI_NEGRO: Rgb = { r: 18, g: 30, b: 54 };
const NEGRO: Rgb = { r: 0, g: 0, b: 0 };
const AA_TEXTO_NORMAL = 4.5;

/** Mezcla dos colores. `cuanto` = 0 devuelve `a`, 1 devuelve `b`. */
function mezclar(a: Rgb, b: Rgb, cuanto: number): Rgb {
  return redondear({
    r: a.r + (b.r - a.r) * cuanto,
    g: a.g + (b.g - a.g) * cuanto,
    b: a.b + (b.b - a.b) * cuanto,
  });
}

/**
 * SE REDONDEA ANTES DE MEDIR, no después.
 *
 * Era un defecto real de la primera versión, encontrado por el barrido
 * de 4 096 colores de `verificar_tema_por_clinica.ts`: el contraste se
 * verificaba sobre el color con decimales y se aplicaba el color
 * redondeado a enteros. Un candidato que medía 4,5003 pasaba la
 * verificación y terminaba en pantalla con 4,4996. Casos como `#008899`
 * quedaban un pelo por debajo de AA.
 */
function redondear({ r, g, b }: Rgb): Rgb {
  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
  };
}

function distancia(a: Rgb, b: Rgb): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/**
 * Lleva el color hacia `hacia` (negro o blanco) hasta que el texto
 * `texto` encima cumpla AA, en pasos de 1 %.
 *
 * Devuelve `null` si ni el extremo alcanza, que es la señal para probar
 * el otro lado.
 */
function ajustarHasta(color: Rgb, hacia: Rgb, texto: Rgb): Rgb | null {
  for (let paso = 0; paso <= 100; paso++) {
    const candidato = mezclar(color, hacia, paso / 100);
    if (contraste(candidato, texto) >= AA_TEXTO_NORMAL) return candidato;
  }
  return null;
}

/**
 * Todo el tema, a partir del color que la clínica eligió.
 *
 * EL ORDEN DE LAS DECISIONES, que es lo que importa acá:
 *
 *   1. Si el primario ya se lee con texto BLANCO, se usa tal cual. Es lo
 *      que la dirección visual quiere: franja de color, texto blanco.
 *   2. Si no, pero se lee con texto CASI NEGRO, se usa tal cual y el
 *      texto encima pasa a oscuro. Un amarillo pastel se respeta así, en
 *      vez de oscurecerlo hasta volverlo marrón y perder la marca.
 *   3. Si NINGUNO de los dos se lee —el caso de los tonos medios, como
 *      un celeste #4A90D9— hay que mover el color. Se prueban las dos
 *      salidas (oscurecerlo para que sirva el blanco, o aclararlo para
 *      que sirva el oscuro) y se elige **la que cambia menos el color**,
 *      que es lo que «se oscurece lo justo para cumplir» quiere decir.
 *
 * El defecto de la primera versión era quedarse en el paso 2 con el
 * mejor de los dos SIN exigirle que cumpliera: un celeste medio se leía
 * mejor con texto oscuro que con blanco, y ninguno de los dos llegaba a
 * 4,5:1. El resultado era texto ilegible con la bendición del sistema.
 */
export function calcularTema(primarioElegido: string): TemaCalculado {
  const elegido = redondear(aRgb(primarioElegido));

  let primario = elegido;
  let sobrePrimario = BLANCO;
  let ajustado = false;

  if (contraste(elegido, BLANCO) >= AA_TEXTO_NORMAL) {
    // 1. Sirve con blanco.
  } else if (contraste(elegido, CASI_NEGRO) >= AA_TEXTO_NORMAL) {
    // 2. Sirve con oscuro.
    sobrePrimario = CASI_NEGRO;
  } else {
    // 3. Ninguno sirve: hay que mover el color.
    const oscurecido = ajustarHasta(elegido, NEGRO, BLANCO);
    const aclarado = ajustarHasta(elegido, BLANCO, CASI_NEGRO);
    const costeOscurecer = oscurecido ? distancia(elegido, oscurecido) : Infinity;
    const costeAclarar = aclarado ? distancia(elegido, aclarado) : Infinity;
    if (costeOscurecer <= costeAclarar && oscurecido) {
      primario = oscurecido;
      sobrePrimario = BLANCO;
    } else if (aclarado) {
      primario = aclarado;
      sobrePrimario = CASI_NEGRO;
    } else {
      // No puede pasar —el negro siempre cumple con blanco— pero el
      // camino no se deja abierto.
      primario = NEGRO;
      sobrePrimario = BLANCO;
    }
    ajustado = true;
  }

  // El fondo suave es el primario casi llevado al blanco, y el oscuro es
  // el que se usa para TEXTO sobre ese fondo. Es el otro par que el
  // prompt exige legible, así que se ajusta hasta que lo sea.
  const suave = mezclar(primario, BLANCO, 0.93);
  let oscuro = mezclar(primario, NEGRO, 0.25);
  for (let paso = 0; paso <= 100 && contraste(oscuro, suave) < AA_TEXTO_NORMAL; paso++) {
    oscuro = mezclar(primario, NEGRO, Math.min(1, 0.25 + paso / 100));
  }

  return {
    primarioElegido: aHex(elegido),
    primario: aHex(primario),
    ajustado,
    contrasteConBlanco: Math.round(contraste(primario, BLANCO) * 100) / 100,
    sobrePrimario: aHex(sobrePrimario),
    primarioHover: aHex(mezclar(primario, NEGRO, 0.12)),
    primarioSuave: aHex(suave),
    primarioOscuro: aHex(oscuro),
    primarioBorde: aHex(mezclar(primario, BLANCO, 0.7)),
  };
}

/** Las variables CSS que el cliente escribe en el elemento raíz. */
export function variablesCss(tema: TemaCalculado): Record<string, string> {
  const triple = (hex: string) => {
    const { r, g, b } = aRgb(hex);
    return `${r} ${g} ${b}`;
  };
  return {
    "--color-primary": triple(tema.primario),
    "--color-primary-hover": triple(tema.primarioHover),
    "--color-primary-suave": triple(tema.primarioSuave),
    "--color-primary-oscuro": triple(tema.primarioOscuro),
    "--color-primary-borde": triple(tema.primarioBorde),
    "--color-sobre-primary": triple(tema.sobrePrimario),
  };
}
