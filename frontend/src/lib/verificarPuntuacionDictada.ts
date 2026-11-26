// Verificación de la puntuación dictada (prompt 07d, fase 1).
//
//   docker compose exec frontend npx tsx src/lib/verificarPuntuacionDictada.ts
//
// El dictado en sí necesita un micrófono y no se puede probar en
// automático. Lo que sí se puede —y es donde están las reglas que se
// pueden equivocar— es la conversión de las palabras de puntuación.
import { aplicarPuntuacionDictada } from "./puntuacionDictada";

let ok = true;
function igual(obtenido: string, esperado: string, msg: string) {
  const mismo = obtenido === esperado;
  console.log(`[${mismo ? "OK" : "FALLO"}] ${msg}`);
  if (!mismo) {
    console.log(`   obtenido: ${JSON.stringify(obtenido)}`);
    console.log(`   esperado: ${JSON.stringify(esperado)}`);
    ok = false;
  }
}

console.log("=== La puntuación dictada ===");

igual(
  aplicarPuntuacionDictada("el paciente llega decaído punto no come desde ayer"),
  "el paciente llega decaído. No come desde ayer",
  "«punto» se vuelve punto, y la palabra siguiente arranca en mayúscula"
);

igual(
  aplicarPuntuacionDictada("temperatura treinta y ocho coma cinco"),
  "temperatura treinta y ocho, cinco",
  "«coma» se vuelve coma"
);

igual(
  aplicarPuntuacionDictada("se indica reposo punto y aparte control en diez días"),
  "se indica reposo.\n\nControl en diez días",
  "«punto y aparte» corta el párrafo, y NO se confunde con «punto»"
);

igual(
  aplicarPuntuacionDictada("primero esto nueva línea segundo aquello"),
  "primero esto\nSegundo aquello",
  "«nueva línea» corta el renglón"
);

igual(
  aplicarPuntuacionDictada("diagnóstico dos puntos otitis externa"),
  "diagnóstico: otitis externa",
  "«dos puntos» no se confunde con «punto»"
);

igual(
  aplicarPuntuacionDictada("come bien punto y coma no vomita"),
  "come bien; no vomita",
  "«punto y coma» tampoco se confunde con «punto»"
);

// LO QUE NO TIENE QUE PASAR: una palabra que CONTIENE «punto» o «coma»
// no se puede romper. «apuntar» y «comadreja» son palabras normales.
igual(
  aplicarPuntuacionDictada("conviene apuntar el peso"),
  "conviene apuntar el peso",
  "«apuntar» NO se parte: la palabra completa es la que cuenta"
);
igual(
  aplicarPuntuacionDictada("sin signos de comadreja"),
  "sin signos de comadreja",
  "«comadreja» tampoco"
);

// LA PRIMERA LETRA NO SE TOCA, y es a propósito: el texto dictado se
// AGREGA a lo que el médico ya había escrito. Si cada tramo empezara en
// mayúscula, dictar en medio de una frase la partiría: «el paciente
// llega decaído Y Luego vomitó».
igual(
  aplicarPuntuacionDictada("y luego vomitó"),
  "y luego vomitó",
  "la primera letra NO se capitaliza: el tramo se agrega a lo que ya había"
);

console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
// `process` no esta en los tipos del frontend (es DOM, no Node) y este
// script corre con tsx: el cast evita agregar @types/node a una
// aplicacion de navegador solo por una linea.
if (!ok) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
