#!/usr/bin/env node
// ---------------------------------------------------------------------
// NINGUNA OPCIÓN DEL MENÚ SIN SU PERMISO — hallazgo del 2026-11-27 por
// la noche.
//
// Juanita entró con rol **Recepción** y su menú mostraba Personas,
// Catálogos y cumplimiento, Calidad de datos, Casos clínicos y Casos
// sin actividad. Ninguna le corresponde según la matriz del 04. La causa
// era simple: esas opciones no declaraban permiso, así que se mostraban
// siempre.
//
// Esto no comprueba la matriz —eso lo hace
// `verificar_acceso_por_rol.ts` del backend, que llama a los endpoints
// con una sesión de cada rol—. Comprueba la REGLA que el defecto
// violaba: toda opción se gatea. Una opción sin permiso se muestra a
// todo el mundo, y eso no se nota hasta que alguien de recepción abre el
// menú.
//
// Se corre en `npm run verificar-menu` y dentro de `npm run build`.
// ---------------------------------------------------------------------

import { readFileSync } from "node:fs";

const RUTA = new URL("../src/components/AppShell.tsx", import.meta.url).pathname;
const fuente = readFileSync(RUTA, "utf8");

/**
 * Las que se muestran a todo el personal, con su motivo.
 *
 * «Inicio» no es una sección: es a donde llega cualquiera que entre.
 */
const SIN_PERMISO_A_PROPOSITO = {
  "/inicio": "no es una sección: es a donde llega cualquiera que entra al sistema",
};

// El bloque de grupos, acotado para no leer el resto del archivo.
const desde = fuente.indexOf("const GRUPOS: Grupo[] = [");
const hasta = fuente.indexOf("\n];", desde);
if (desde === -1 || hasta === -1) {
  console.error("[FALLO] No se encontró el bloque GRUPOS en AppShell.tsx.");
  process.exit(1);
}
const bloque = fuente.slice(desde, hasta);

// Cada opción es un objeto con `to:`. Se parte por ahí y se mira si en
// el mismo objeto hay un `permiso:` o un `permisoAlguno:`.
const partes = bloque.split(/\bto:\s*"/).slice(1);
const fallos = [];
const revisadas = [];

for (const parte of partes) {
  const ruta = parte.slice(0, parte.indexOf('"'));
  // El objeto termina en el primer `},` que cierra su nivel. Alcanza con
  // mirar hasta el próximo `to:` —ya separado— o el final del bloque.
  const tienePermiso = /\bpermiso:\s*"/.test(parte) || /\bpermisoAlguno:\s*\[/.test(parte);

  if (tienePermiso) {
    revisadas.push(`${ruta} — con permiso`);
    continue;
  }
  const motivo = SIN_PERMISO_A_PROPOSITO[ruta];
  if (motivo) {
    revisadas.push(`${ruta} — sin permiso a propósito: ${motivo}`);
    continue;
  }
  fallos.push(
    `${ruta}: la opción del menú no declara permiso, así que se muestra a TODO el personal. ` +
      `Póngale el permiso que pide su ruta (la matriz del 04), o declárela en ` +
      `SIN_PERMISO_A_PROPOSITO con su motivo.`
  );
}

console.log(`Opciones de menú revisadas: ${revisadas.length + fallos.length}`);
for (const r of revisadas) console.log(`  OK   ${r}`);

if (fallos.length > 0) {
  console.error(`\nFALLOS (${fallos.length}):`);
  for (const f of fallos) console.error(` - ${f}`);
  process.exit(1);
}
console.log("\nOK: cada opción del menú se muestra solo si el rol tiene su permiso.");
