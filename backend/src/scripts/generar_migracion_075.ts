import fs from "fs";
import path from "path";
import { pool } from "../db";

// ---------------------------------------------------------------------
// Genera la migración 075 (prompt de gastroenterología restaurado).
//
// No se escribe a mano por dos razones: el texto son 15 KB que no hay que
// retipear nunca, y porque la migración solo tiene sentido si antes se
// verifica que lo que hay en la base sea exactamente el prompt corrupto
// conocido. Ese chequeo corre acá y aborta la generación si falla.
//
// La migración resultante actualiza SOLO si el valor guardado coincide
// exacto con el corrupto (ignorando CRLF). No usa un LIKE laxo a
// propósito: si alguien editó el prompt por Platform Admin, esto no lo
// pisa. Y si no lo pisa, no se queda callado — el bloque de verificación
// final levanta una excepción, que es justamente lo que evita que el
// despliegue corra entero dejando el defecto vivo sin que nada falle.
// ---------------------------------------------------------------------

const ID_GCIS = "fc0adced-e371-4fd3-915e-54344c4fa207";
const RAIZ = path.join(__dirname, "..", "..");
const PROMPT = path.join(__dirname, "..", "seed", "plataforma", "prompts", "gastroenterologia.txt");
const CORRUPTO = path.join(RAIZ, ".corrupto_original.txt");
const DESTINO = path.join(__dirname, "..", "migrations", "075_prompt_gastroenterologia_restaurado.sql");

const norm = (s: string) => s.replace(/\r\n/g, "\n");
const degradar = (s: string): string =>
  [...s].map((c) => (c.codePointAt(0)! < 128 ? c : "?".repeat(Buffer.byteLength(c, "utf8")))).join("");

async function main() {
  const restaurado = norm(fs.readFileSync(PROMPT, "utf8"));
  const corrupto = norm(fs.readFileSync(CORRUPTO, "utf8"));

  const fila = (await pool.query(`SELECT system_prompt AS s FROM agentes WHERE id = $1`, [ID_GCIS])).rows[0];
  if (!fila) throw new Error("El agente de gastroenterología no está en esta base.");
  const enBase = norm(fila.s ?? "");

  console.log("VERIFICACIÓN PREVIA");
  console.log(`   en base (sin CR):  ${enBase.length} car., ${(enBase.match(/\?{2,}/g) ?? []).length} residuos`);
  console.log(`   corrupto del repo: ${corrupto.length} car., ${(corrupto.match(/\?{2,}/g) ?? []).length} residuos`);
  console.log(`   restaurado:        ${restaurado.length} car., ${(restaurado.match(/\?{2,}/g) ?? []).length} residuos`);
  const esElCorrupto = enBase === corrupto;
  console.log(`   la base ES el corrupto conocido: ${esElCorrupto ? "SÍ" : "NO"}`);
  const pruebaOk = degradar(restaurado) === degradar(enBase);
  console.log(`   prueba de ida y vuelta contra LA BASE: ${pruebaOk ? "SÍ" : "NO"}`);
  if (!esElCorrupto || !pruebaOk) throw new Error("ABORTA: la base no coincide con lo esperado, no se genera la migración.");

  // Controles de forma para el ejecutor de migraciones y el dollar-quote.
  const backslashInicial = /^\s*\\/m.test(restaurado) || /^\s*\\/m.test(corrupto);
  const chocaDelimitador = restaurado.includes("$gcis") || corrupto.includes("$gcis");
  console.log(`   alguna línea empieza con backslash (rompería el ejecutor): ${backslashInicial ? "SÍ" : "no"}`);
  console.log(`   el texto contiene el delimitador $gcis...$: ${chocaDelimitador ? "SÍ" : "no"}`);
  if (backslashInicial || chocaDelimitador) throw new Error("ABORTA: el texto no es seguro de embeber tal cual.");

  const sql = `-- Prompt de gastroenterología: reemplaza el texto corrupto por el restaurado.
--
-- Hace falta una migración y no alcanza con el sembrado, por la misma razón
-- que la 074 con los catálogos: seedPlataforma inserta con ON CONFLICT (id)
-- DO NOTHING, o sea que AGREGA pero nunca actualiza. En una base ya sembrada
-- —producción— el agente ya existe, el INSERT no hace nada y la corrección
-- del prompt no llega. Nada falla: el despliegue termina bien y el defecto
-- sigue vivo. Por eso va acá.
--
-- Qué se corrige. El prompt se guardó en algún momento pasando por una
-- codificación que no era UTF-8: cada byte no-ASCII quedó convertido en un
-- '?'. Eran 720 signos. La restauración no infirió texto — copió de fuentes
-- limpias del propio proyecto (el original v3.1, el AI Reasoning Standard y
-- los prompts de las otras especialidades, que comparten la sección de
-- razonamiento) y quedó probada con una comparación: degradar el texto
-- restaurado con el mismo mecanismo de la corrupción reproduce el corrupto
-- carácter por carácter. Si se hubiera cambiado una palabra, una coma o el
-- orden de algo, esa igualdad no daría.
--
-- El WHERE compara el texto COMPLETO, no un LIKE laxo: si alguien editó
-- este prompt por Platform Admin, esta migración no lo pisa. replace(...,
-- chr(13), '') ignora la diferencia CRLF/LF, que existe de verdad — este
-- prompt es el único de los nueve que quedó guardado con CRLF, porque
-- sembrarAgentes no normalizaba los saltos de línea (se corrige en el mismo
-- cambio). Se escribe con LF, como los otros ocho.
--
-- Idempotente: al terminar, el texto guardado ya no es el corrupto, así que
-- una segunda corrida no matchea y no cambia nada.
UPDATE agentes
   SET system_prompt = $gcis$${restaurado}$gcis$
 WHERE id = '${ID_GCIS}'
   AND replace(system_prompt, chr(13), '') = $gcis_corrupto$${corrupto}$gcis_corrupto$;

-- Verificación con dientes. El riesgo de este cambio no es que falle: es que
-- no haga nada y nadie se entere. Si el agente existe y su prompt todavía
-- trae residuos de la corrupción, la migración falla acá y frena el
-- despliegue, en vez de dejar pasar un prompt roto en silencio.
DO $verificacion$
DECLARE
  v_prompt text;
BEGIN
  SELECT system_prompt INTO v_prompt FROM agentes WHERE id = '${ID_GCIS}';

  IF v_prompt IS NULL THEN
    -- Base nueva (o agente sin prompt): no hay nada que corregir, el
    -- sembrado va a insertar el texto ya restaurado.
    RAISE NOTICE 'Agente de gastroenterología sin prompt en esta base; lo siembra seedPlataforma con el texto restaurado.';
  ELSIF v_prompt LIKE '%??%' THEN
    RAISE EXCEPTION 'El prompt de gastroenterología sigue corrupto (% residuos de la codificación) y no coincide con el texto que esta migración esperaba reemplazar. Alguien lo editó después de sembrarlo. Corregilo a mano o actualizá esta migración: no se sigue adelante en silencio.',
      (length(v_prompt) - length(replace(v_prompt, '??', ''))) / 2;
  END IF;
END
$verificacion$;
`;

  fs.writeFileSync(DESTINO, sql, "utf8");
  console.log(`\nESCRITA ${path.basename(DESTINO)} — ${sql.length} caracteres.`);
  await pool.end();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
