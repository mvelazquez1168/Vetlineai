// Ningún modal se cierra con un clic afuera si tiene un formulario.
//
//   docker compose exec frontend npm run verificar-modales
//   docker compose exec frontend node scripts/verificar_modales.mjs <dir>
//
// POR QUÉ EXISTE. En Finanzas › Gastos › Registrar un gasto, un clic
// fuera del modal lo cerraba y se perdía lo escrito. No era un descuido
// de esa pantalla: `Modal.tsx` cerraba en el clic sobre el fondo —lo
// usan más de cuarenta— y otros once componentes se armaban su propio
// fondo copiando el mismo `onClick={onClose}`. Un defecto que se arregla
// en catorce lugares vuelve en el decimoquinto.
//
// QUÉ MIRA, y por qué estas tres cosas:
//
//   1. UN `fixed inset-0` FUERA DE `CapaModal.tsx`. Es la firma de un
//      fondo propio, y un fondo propio es una copia de la regla. La
//      lista de excepciones está abajo, con el motivo de cada una.
//   2. UN `onClick` EN EL MISMO ELEMENTO QUE EL `fixed inset-0`. Es
//      exactamente la línea del defecto.
//   3. UN `<CapaModal` CON `tipo="consulta"` QUE TENGA `<Input`,
//      `<Select`, `<textarea` O `hayCambios` ADENTRO. Un modal de
//      consulta con un formulario está mal declarado, y declararlo mal
//      es la otra forma de volver al defecto.
//
// Es un verificador de CÓDIGO FUENTE, no de comportamiento: lee los
// archivos. No reemplaza probarlo en el navegador —eso está en el
// informe— pero sí impide que el patrón reaparezca sin que nadie lo
// note.

import fs from "fs";
import path from "path";

const raiz = process.argv[2] ?? "src";

/**
 * Los únicos lugares donde `fixed inset-0` está justificado, con el
 * motivo. La lista es corta a propósito: si crece, lo que hay que
 * revisar es por qué, no la lista.
 */
const EXCEPCIONES = new Map([
  ["components/ui/CapaModal.tsx", "es el componente que define la regla"],
  [
    "components/BackdropMenuMovil.tsx",
    "es el fondo del menú lateral en móvil, que no es un modal: no tiene formulario y cerrarlo al tocar afuera es el gesto esperado de un cajón",
  ],
  [
    "components/PanelAyuda.tsx",
    "es un panel lateral de consulta que convive con la pantalla; no bloquea el trabajo detrás",
  ],
  [
    "hooks/useCambiosSinGuardar.tsx",
    "es el diálogo que PREGUNTA si se puede cerrar (guía §4.7): usar CapaModal sería circular, porque CapaModal lo usa a él",
  ],
]);

let fallos = 0;
let revisados = 0;

function aviso(archivo, linea, mensaje) {
  console.log(`[FALLO] ${archivo}:${linea} — ${mensaje}`);
  fallos++;
}

function recorrer(dir) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name === "dist") continue;
      recorrer(completo);
    } else if (/\.(tsx|ts)$/.test(entrada.name)) {
      revisar(completo);
    }
  }
}

function revisar(archivo) {
  const relativo = path
    .relative(raiz, archivo)
    .split(path.sep)
    .join("/");
  const texto = fs.readFileSync(archivo, "utf8");
  const lineas = texto.split("\n");
  revisados++;

  // --- 1 y 2. Fondos propios -------------------------------------
  lineas.forEach((linea, i) => {
    if (!linea.includes("fixed inset-0")) return;
    if (EXCEPCIONES.has(relativo)) return;
    aviso(
      relativo,
      i + 1,
      "fondo de modal propio (`fixed inset-0`). Usá <CapaModal> o <Modal>, " +
        "que son los únicos que saben cuándo un modal se cierra."
    );
  });

  // --- 3. Un modal de consulta que en realidad tiene formulario ---
  const bloques = texto.split("<CapaModal");
  for (let i = 1; i < bloques.length; i++) {
    const bloque = bloques[i].slice(0, bloques[i].indexOf("</CapaModal>") + 1 || 4000);
    if (!/tipo="consulta"/.test(bloque)) continue;
    const tieneFormulario =
      /<Input\b/.test(bloque) ||
      /<Select\b/.test(bloque) ||
      /<textarea\b/.test(bloque) ||
      /hayCambios/.test(bloque);
    if (tieneFormulario) {
      const linea = texto.slice(0, texto.indexOf(bloques[i])).split("\n").length;
      aviso(
        relativo,
        linea,
        'un modal declarado `tipo="consulta"` tiene campos adentro: se cierra con el ' +
          "clic afuera y pierde lo escrito. Si tiene formulario, es de formulario."
      );
    }
  }
}

recorrer(raiz);

console.log(`\n${revisados} archivo(s) revisados en ${raiz}.`);
for (const [archivo, motivo] of EXCEPCIONES) {
  console.log(`  excepción: ${archivo} — ${motivo}`);
}
console.log(fallos === 0 ? "\nTODO OK" : `\nHAY FALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);
