#!/usr/bin/env node
// ---------------------------------------------------------------------
// NUNCA SE PIERDEN DATOS AL SALIR DE UNA PANTALLA — guía rectora §4.7.
//
// El mismo molde que `verificar_modales.mjs`: se listan TODOS los
// formularios del sistema y se falla si alguno no está cubierto. Un
// barrido que se hace una vez y nadie vuelve a correr es un barrido que
// dura hasta el próximo formulario.
//
// QUÉ CUENTA COMO FORMULARIO acá: un archivo que tiene campos editables
// (Input, Select, textarea, input) Y una llamada que ESCRIBE (POST,
// PATCH, PUT, crear, guardar, actualizar). Un buscador o una barra de
// filtros tiene campos y no escribe nada: no hay datos que perder y
// preguntar al salir sería una molestia sin motivo.
//
// CÓMO QUEDA CUBIERTO, en orden:
//   1. el archivo usa `useCambiosSinGuardar` directamente;
//   2. todos sus campos están dentro de un `Modal`/`CapaModal`, que ya
//      lo usa por dentro para los 102 modales de una sola vez;
//   3. está en la lista de excepciones de abajo, con su motivo escrito.
//
// Se corre con `npm run verificar-cambios-sin-guardar` y dentro de
// `npm run build`.
// ---------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = new URL("../src", import.meta.url).pathname;

/**
 * Excepciones, con su motivo. Cada línea es una decisión, no un
 * pendiente: si el motivo no se sostiene, se saca de acá y se arregla.
 */
const EXCEPCIONES = {
  "pages/Login.tsx": "iniciar sesión: no hay nada guardado que perder, y el formulario se vacía solo",
  "pages/Registro.tsx":
    "el alta de una clínica: su propio asistente por pasos, con su aviso de salida",
  "pages/RestablecerContrasena.tsx": "pedir el enlace: un campo de correo, sin datos propios",
  "pages/EstablecerContrasenaNueva.tsx":
    "la contraseña nueva: guardar a medias sería guardar una contraseña a medias",
  "pages/InvitacionMedico.tsx": "aceptar la invitación: lo mismo que la contraseña nueva",
  "pages/FirmarADistancia.tsx":
    "la firma pública: un trazo a medias no se guarda, y el enlace sirve una sola vez",
  "components/expediente/AtencionActual.tsx":
    "la atención se guarda sola (anexo 07-03, A4) — ver useAutoguardadoAtencion",
  "components/PanelAyuda.tsx": "preguntarle al sistema: la pregunta no es un dato de la clínica",
};

const CAMPOS = /<(Input|Select|Textarea|textarea|input|BreedCombobox|ClinicaCombobox|CountryCombobox|PanelFirma)\b/;
const ESCRIBE = /"(POST|PATCH|PUT)"|\.crear[A-Z]|\.guardar[A-Z]?|\.actualizar[A-Z]?|\.registrar[A-Z]/;
const MODAL = /<(Modal|CapaModal)\b/;
const HOOK = /useCambiosSinGuardar/;

const archivos = [];
(function recorrer(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (e.endsWith(".tsx")) archivos.push(p);
  }
})(RAIZ);

const fallos = [];
const cubiertos = [];

for (const ruta of archivos) {
  const rel = relative(RAIZ, ruta).replace(/\\/g, "/");
  if (rel.startsWith("components/ui/") || rel.startsWith("pages/dev/")) continue;

  const texto = readFileSync(ruta, "utf8");
  if (!CAMPOS.test(texto) || !ESCRIBE.test(texto)) continue;

  if (HOOK.test(texto)) {
    cubiertos.push(`${rel} — usa el hook`);
    continue;
  }

  const motivo = EXCEPCIONES[rel];
  if (motivo) {
    cubiertos.push(`${rel} — excepción: ${motivo}`);
    continue;
  }

  // ¿Todos los campos están dentro de un modal? Se aproxima con la
  // posición: si el primer campo aparece DESPUÉS de la primera etiqueta
  // de modal, no hay campos sueltos en la pantalla.
  const primerModal = texto.search(MODAL);
  const primerCampo = texto.search(CAMPOS);
  if (primerModal !== -1 && primerCampo > primerModal) {
    cubiertos.push(`${rel} — sus campos viven dentro de un Modal`);
    continue;
  }

  fallos.push(
    `${rel}: tiene campos editables y escribe, y no usa useCambiosSinGuardar ` +
      `ni está dentro de un Modal. Agregá el hook, o la excepción con su motivo.`
  );
}

console.log(`Formularios revisados: ${cubiertos.length + fallos.length}`);
for (const c of cubiertos) console.log(`  OK   ${c}`);

if (fallos.length > 0) {
  console.error(`\nFALLOS (${fallos.length}):`);
  for (const f of fallos) console.error(` - ${f}`);
  process.exit(1);
}
console.log("\nOK: todo formulario avisa antes de perder lo escrito.");
