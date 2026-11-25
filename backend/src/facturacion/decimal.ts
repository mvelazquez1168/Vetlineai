// ---------------------------------------------------------------------
// Aritmética de montos para el facturador, en coma fija y con BigInt.
//
// Por qué no `number`: los montos de un comprobante son `decimal(18,5)`
// en el XSD, y Hacienda valida que los totales cuadren con la suma de
// las líneas. Con punto flotante, `0.1 + 0.2` no da `0.3` y una factura
// de veinte líneas puede quedar desviada un céntimo — lo que produce un
// rechazo cuyo motivo es imposible de encontrar leyendo el XML, porque a
// la vista los números están bien.
//
// Por qué no una librería: lo único que hace falta son sumar, restar,
// multiplicar y redondear a 5 decimales. Un `bigint` en unidades de
// 1e-5 lo resuelve exacto y sin agregar una dependencia al camino que
// emite documentos fiscales.
//
// Todos los montos de este módulo son BigInt en CIENMILÉSIMAS: el número
// 1 se representa como 100000n. El tipo es `bigint` a secas y no un tipo
// de marca, pero los nombres de las funciones (`aMonto`, `deMonto`) son
// la frontera: adentro del módulo de cálculo nunca entra un `number`
// crudo.
// ---------------------------------------------------------------------

/** Los 5 decimales del `DecimalDineroType` del XSD. */
export const DECIMALES = 5;
const ESCALA = 100_000n; // 10^5

/**
 * Pasa un valor de entrada a cienmilésimas.
 *
 * Acepta string y number. Con string el valor se lee dígito por dígito,
 * sin pasar nunca por un `parseFloat`: así "12345678901234.56789" (el
 * máximo que admite el XSD) entra exacto, cosa que un `number` ya no
 * puede representar.
 */
export function aMonto(valor: string | number): bigint {
  const texto = typeof valor === "number" ? formatearNumero(valor) : valor.trim();

  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(texto);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new Error(`"${valor}" no es un número decimal válido.`);
  }
  const signo = m[1] === "-" ? -1n : 1n;
  const entera = m[2] === "" ? "0" : m[2];
  const decimal = m[3] ?? "";

  if (decimal.length > DECIMALES) {
    // Más de 5 decimales no es un detalle de formato: es un dato que no
    // cabe en el XML. Se redondea, pero el redondeo es explícito y no un
    // truncamiento silencioso.
    const conservados = decimal.slice(0, DECIMALES);
    const siguiente = Number(decimal[DECIMALES]);
    const base = BigInt(entera + conservados);
    return signo * (siguiente >= 5 ? base + 1n : base);
  }

  return signo * BigInt(entera + decimal.padEnd(DECIMALES, "0"));
}

/**
 * `number` → texto decimal sin notación exponencial. `String(1e-7)` da
 * "1e-7", que el parser de arriba rechazaría.
 */
function formatearNumero(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`"${n}" no es un número finito.`);
  return n.toFixed(DECIMALES + 1);
}

/** Cienmilésimas → el texto decimal que va al XML, con los 5 decimales. */
export function deMonto(monto: bigint): string {
  const negativo = monto < 0n;
  const abs = negativo ? -monto : monto;
  const entera = abs / ESCALA;
  const decimal = (abs % ESCALA).toString().padStart(DECIMALES, "0");
  return `${negativo ? "-" : ""}${entera}.${decimal}`;
}

/** Cienmilésimas → `number`, solo para mostrar en pantalla. Nunca para calcular. */
export function aNumero(monto: bigint): number {
  return Number(deMonto(monto));
}

export const CERO = 0n;

export function sumar(...montos: bigint[]): bigint {
  return montos.reduce((a, b) => a + b, 0n);
}

export function restar(a: bigint, b: bigint): bigint {
  return a - b;
}

/**
 * Multiplica dos montos y vuelve a la escala, redondeando al medio
 * hacia arriba (half-up) sobre el valor absoluto.
 *
 * Half-up y no "banker's rounding": es el redondeo comercial que usan
 * las facturas, y el que produce el mismo resultado que el cálculo a
 * mano con el que se compara en el verificador.
 */
export function multiplicar(a: bigint, b: bigint): bigint {
  const producto = a * b;
  return redondearDivision(producto, ESCALA);
}

/**
 * Un monto por una tarifa expresada como porcentaje entero
 * (13 para el 13%, 0.5 para el 0,5%). La tarifa llega en cienmilésimas
 * igual que todo lo demás.
 */
export function porcentajeDe(base: bigint, tarifaPorcentaje: bigint): bigint {
  return redondearDivision(base * tarifaPorcentaje, ESCALA * 100n);
}

/** División con redondeo half-up sobre el valor absoluto. */
export function redondearDivision(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) throw new Error("División por cero en el cálculo de un monto.");
  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;
  const cociente = n / d;
  const resto = n % d;
  const redondeado = resto * 2n >= d ? cociente + 1n : cociente;
  return negativo ? -redondeado : redondeado;
}

/**
 * Reparte `total` en proporción a `pesos`, de forma que la suma de las
 * partes sea EXACTAMENTE `total`.
 *
 * Hace falta para los totales del resumen que la norma define como
 * "porcentaje de exoneración por el monto total": repartir con
 * `round(total * peso / suma)` línea por línea deja un residuo de
 * céntimos, y Hacienda valida la suma. El residuo se le asigna a la
 * parte con el resto más grande (método del resto mayor), que es el
 * reparto que minimiza el error de cada parte.
 */
export function repartirProporcional(total: bigint, pesos: bigint[]): bigint[] {
  const sumaPesos = sumar(...pesos);
  if (sumaPesos === 0n) return pesos.map(() => 0n);

  const partes = pesos.map((p) => (total * p) / sumaPesos);
  const restos = pesos.map((p, i) => ({ i, resto: (total * p) % sumaPesos }));
  let faltante = total - sumar(...partes);

  restos.sort((a, b) => (b.resto > a.resto ? 1 : b.resto < a.resto ? -1 : a.i - b.i));
  let k = 0;
  while (faltante > 0n && restos.length > 0) {
    partes[restos[k % restos.length].i] += 1n;
    faltante -= 1n;
    k++;
  }
  return partes;
}
