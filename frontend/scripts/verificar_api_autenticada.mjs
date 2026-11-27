#!/usr/bin/env node
// ---------------------------------------------------------------------
// QUE NINGUNA LLAMADA PRIVADA VIAJE SIN SESIÓN — defecto del 2026-11-27.
//
// `metricasApi.ts` se escribió entero sin `token: getStoredToken()` y la
// pantalla Administración › Reportes mostraba «No autenticado. Falta el
// token» en sus trece llamadas. El arreglo de fondo fue invertir el
// defecto en `lib/api.ts`: toda llamada va autenticada y lo que se
// declara es la excepción (`publico: true`).
//
// Este verificador cuida la inversión:
//   1. que `api.ts` siga resolviendo el token sin condición;
//   2. que cada `publico: true` apunte a una ruta que el backend sirve
//      de verdad sin sesión. Marcar privada como pública es el error que
//      la inversión vuelve posible, y es peor que el original: antes
//      fallaba con un 401 visible; ahora fallaría igual, pero alguien
//      habría escrito a mano que era correcto.
//
// Se corre en `npm run verificar-api` y dentro de `npm run build`.
// ---------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../src", import.meta.url).pathname;

// Prefijos que el backend sirve sin `authenticate`. Sale de recorrer
// `backend/src/routes/*.routes.ts` y quedarse con los routers que no
// llaman `use(authenticate)`.
const PUBLICAS = [
  "/paises",
  "/registro-publico",
  "/restablecer-contrasena",
  "/invitaciones",
  "/legal",
  "/firma",
  "/verificacion-correo",
  "/auth",
  "/planes",
];

const archivos = [];
(function recorrer(dir) {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (/\.(ts|tsx)$/.test(entrada)) archivos.push(p);
  }
})(RAIZ);

const fallos = [];

// --- 1. api.ts no volvió a condicionar el token ----------------------
const api = readFileSync(join(RAIZ, "lib", "api.ts"), "utf8");
if (/token \? await obtenerTokenValido\(\)/.test(api)) {
  fallos.push(
    "lib/api.ts volvió a mandar el token solo si quien llama lo pide. " +
      "El defecto del 2026-11-27 fue exactamente eso: olvidarse era gratis."
  );
}
if ((api.match(/tokenPara\(publico\)/g) ?? []).length !== 3) {
  fallos.push(
    "lib/api.ts debe resolver el token con tokenPara(publico) en las tres " +
      "funciones (apiFetch, apiFetchBlob, apiFetchFile)."
  );
}

// --- 2. cada `publico: true` apunta a una ruta pública ---------------
let revisados = 0;
for (const p of archivos) {
  const texto = readFileSync(p, "utf8");
  if (!texto.includes("publico: true")) continue;

  let i = -1;
  while ((i = texto.indexOf("publico: true", i + 1)) !== -1) {
    // La línea del comentario que explica la regla no es una llamada.
    const linea = texto.slice(texto.lastIndexOf("\n", i) + 1, texto.indexOf("\n", i));
    if (linea.trimStart().startsWith("//")) continue;

    // Hacia atrás hasta el `apiFetch…(` que abre esta llamada, y de ahí
    // la primera cadena: es la ruta.
    const antes = texto.slice(0, i);
    const abre = Math.max(
      antes.lastIndexOf("apiFetch<"),
      antes.lastIndexOf("apiFetch("),
      antes.lastIndexOf("apiFetchBlob("),
      antes.lastIndexOf("apiFetchFile(")
    );
    if (abre === -1) {
      fallos.push(`${p}: hay un publico: true sin una llamada de API delante.`);
      continue;
    }
    const trozo = texto.slice(abre, i);
    const ruta = /["'`](\/[^"'`]*)/.exec(trozo);
    if (!ruta) {
      fallos.push(`${p}: no se pudo leer la ruta de un publico: true.`);
      continue;
    }
    revisados += 1;
    if (!PUBLICAS.some((pref) => ruta[1].startsWith(pref))) {
      fallos.push(
        `${p}: «${ruta[1]}» está marcada publico: true y no es una ruta pública del backend. ` +
          "Si de verdad lo es, sumala a PUBLICAS acá y decí por qué."
      );
    }
  }
}

console.log(`Rutas declaradas públicas revisadas: ${revisados}`);
if (fallos.length > 0) {
  console.error("\nFALLOS:");
  for (const f of fallos) console.error(` - ${f}`);
  process.exit(1);
}
console.log("OK: el token viaja por defecto y las excepciones son rutas públicas de verdad.");
