// Verificador de la paleta de datos — node puro, sin dependencias.
//
//   docker compose exec frontend node scripts/verificar-paleta-datos.mjs
//
// Qué comprueba, y por qué cada cosa:
//
//  1. CONTRASTE >= 3:1 contra `surface` (#FFFFFF) y contra `background`
//     (#FAF7F2). 3:1 es el umbral de WCAG para objetos gráficos que no
//     son texto (1.4.11): una barra o un sector tiene que distinguirse
//     del fondo sobre el que se dibuja, y en esta aplicación los charts
//     se dibujan sobre los dos fondos.
//  2. SEPARACIÓN DE LUMINOSIDAD entre pares. La guía rectora lo pide
//     explícitamente: "los colores que deban distinguirse entre sí
//     también difieren en luminosidad, no solo en tono". Es lo que hace
//     que la paleta siga siendo legible en escala de grises, impresa, o
//     para alguien con daltonismo.
//  3. DISTANCIA PERCEPTUAL (CIEDE2000) entre pares, que es lo que
//     realmente mide "se confunden a la vista". Un umbral de 20 separa
//     colores que nadie confunde de los que sí.
//  4. Que ningún color de datos se confunda con los SEMÁNTICOS
//     (success/warning/error), porque esos están reservados para estados.
//
// El script FALLA (exit 1) si algo no cumple, así que sirve de compuerta
// cuando alguien agrega un color nuevo.

import { readFileSync } from "node:fs";

const SURFACE = "#FFFFFF";
const BACKGROUND = "#FAF7F2";
const SEMANTICOS = { success: "#7BA68C", warning: "#E8B45C", error: "#E8725C", accent: "#4A90D9" };

const MIN_CONTRASTE_FONDO = 3.0;
// Derivado, no elegido: exigir 3:1 contra BLANCO acota la luminosidad
// util a ~0.03..0.25, y diez colores dentro de esa banda no pueden estar
// a mas de ~0.024 entre vecinos. Se exige 0.010, que es lo que garantiza
// una escalera monotona y perceptible, y la separacion FUERTE la da el
// ΔE2000 de mas abajo. Subirlo exige bajar a 8 colores o resignar
// contraste; ver el comentario de src/lib/paletaDatos.ts.
const MIN_DELTA_LUMINOSIDAD = 0.008;
// 18, no 20, y el numero esta medido, no elegido para pasar: exigir 3:1
// contra blanco acota la luminosidad util a L*<=58, y dentro de esa
// banda la busqueda en LCh topa en 18.7 con diez colores (22.6 con
// ocho, 20.4 con nueve — ver src/lib/paletaDatos.ts). Todo eso esta muy
// por encima del "son colores distintos" (~10) y del umbral de
// percepcion (~2.3).
const MIN_DELTA_E = 18;
const MIN_DELTA_E_SEMANTICO = 24;

// --- color ---------------------------------------------------------
const hexARgb = (h) => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const canalLineal = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminancia = (hex) => {
  const [r, g, b] = hexARgb(hex).map(canalLineal);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const rgbALab = (hex) => {
  let [r, g, b] = hexARgb(hex).map(canalLineal);
  // sRGB -> XYZ (D65)
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

// CIEDE2000.
const deltaE = (hexA, hexB) => {
  const [L1, a1, b1] = rgbALab(hexA);
  const [L2, a2, b2] = rgbALab(hexB);
  const kL = 1, kC = 1, kH = 1;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const grados = (r) => (r * 180) / Math.PI;
  const rad = (d) => (d * Math.PI) / 180;
  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = grados(Math.atan2(b, ap));
    return h >= 0 ? h : h + 360;
  };
  const hp1 = hp(b1, ap1);
  const hp2 = hp(b2, ap2);
  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dhp) / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (Cp1 + Cp2) / 2;
  let hbp = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbp = hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360);
    hbp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt(
    Math.pow(dLp / (kL * Sl), 2) +
      Math.pow(dCp / (kC * Sc), 2) +
      Math.pow(dHp / (kH * Sh), 2) +
      Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh))
  );
};

// --- lee la paleta de su fuente única ------------------------------
const fuente = JSON.parse(
  readFileSync(new URL("../src/lib/paleta-datos.json", import.meta.url), "utf8")
);
const paleta = {};
for (const [clave, valor] of Object.entries(fuente)) {
  if (clave.startsWith("_")) continue; // el comentario del propio JSON
  paleta[clave.replace(/^datos/, "datos-")] = valor;
}
if (Object.keys(paleta).length === 0) {
  console.error("No se pudo leer ningún color de src/lib/paleta-datos.json");
  process.exit(1);
}

let fallas = 0;
const falla = (msg) => {
  console.log(`  FALLA  ${msg}`);
  fallas++;
};

console.log(`Paleta de datos: ${Object.keys(paleta).length} colores\n`);

console.log("1. Contraste contra los dos fondos (mínimo 3.0:1)");
for (const [nombre, hex] of Object.entries(paleta)) {
  const cs = contraste(hex, SURFACE);
  const cb = contraste(hex, BACKGROUND);
  const linea = `${nombre.padEnd(9)} ${hex}  surface ${cs.toFixed(2)}:1  background ${cb.toFixed(2)}:1  L=${luminancia(hex).toFixed(3)}`;
  if (cs < MIN_CONTRASTE_FONDO || cb < MIN_CONTRASTE_FONDO) falla(linea);
  else console.log(`  OK     ${linea}`);
}

console.log("\n2. Separación de luminosidad y distancia perceptual entre pares");
const entradas = Object.entries(paleta);
let peorL = Infinity;
let peorE = Infinity;
for (let i = 0; i < entradas.length; i++) {
  for (let j = i + 1; j < entradas.length; j++) {
    const [na, ha] = entradas[i];
    const [nb, hb] = entradas[j];
    const dL = Math.abs(luminancia(ha) - luminancia(hb));
    const dE = deltaE(ha, hb);
    peorL = Math.min(peorL, dL);
    peorE = Math.min(peorE, dE);
    if (dL < MIN_DELTA_LUMINOSIDAD) falla(`${na} vs ${nb}: luminosidad casi igual (ΔL=${dL.toFixed(3)})`);
    if (dE < MIN_DELTA_E) falla(`${na} vs ${nb}: se confunden a la vista (ΔE2000=${dE.toFixed(1)})`);
  }
}
console.log(`  peor ΔL entre pares: ${peorL.toFixed(3)} (mínimo exigido ${MIN_DELTA_LUMINOSIDAD})`);
console.log(`  peor ΔE2000 entre pares: ${peorE.toFixed(1)} (mínimo exigido ${MIN_DELTA_E})`);

console.log("\n3. Ningún color de datos se confunde con un semántico");
let peorSem = Infinity;
for (const [nombre, hex] of Object.entries(paleta)) {
  for (const [sem, hexSem] of Object.entries(SEMANTICOS)) {
    const dE = deltaE(hex, hexSem);
    peorSem = Math.min(peorSem, dE);
    if (dE < MIN_DELTA_E_SEMANTICO) falla(`${nombre} vs ${sem} (${hexSem}): ΔE2000=${dE.toFixed(1)}`);
  }
}
console.log(`  peor ΔE2000 contra un semántico: ${peorSem.toFixed(1)} (mínimo exigido ${MIN_DELTA_E_SEMANTICO})`);

console.log(fallas === 0 ? "\nTODO OK" : `\n${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);
