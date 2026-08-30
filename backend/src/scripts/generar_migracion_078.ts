import fs from "fs";
import path from "path";
import { pool } from "../db";

// Genera la migración 078 (bloque común ampliado con las once frases
// promovidas desde triaje y reproducción).
//
// A diferencia de la 076, que CONCATENABA el bloque porque no existía, acá
// el bloque ya está: hay que reemplazar su versión vieja por la nueva sin
// tocar nada de lo que viene antes. Se hace cortando el prompt en la marca
// del bloque y pegando el nuevo, así no hace falta embeber la versión
// vieja ni saber cuál tiene cada base.

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const BLOQUE = path.join(DIR, "reglas_comunes_agentes.md");
const DESTINO = path.join(__dirname, "..", "migrations", "078_bloque_comun_ampliado.sql");
const MARCA = "## Reglas comunes a todos los agentes clínicos de Vetline Ai";
const CANARIO = "Un dato faltante no es un espacio en blanco: es un hallazgo.";

async function main() {
  const bloque = fs.readFileSync(BLOQUE, "utf8").replace(/\r\n/g, "\n").trimEnd();
  if (bloque.includes("$bloque")) throw new Error("El bloque contiene el delimitador dollar-quote.");
  if (/^\s*\\/m.test(bloque)) throw new Error("El bloque tiene una línea que empieza con backslash.");
  if (!bloque.includes(CANARIO)) throw new Error("El bloque no trae las frases promovidas.");

  const filas = (
    await pool.query(
      `SELECT slug,
              system_prompt IS NULL AS sin_prompt,
              position($1 in coalesce(system_prompt, '')) > 0 AS tiene_bloque,
              position($2 in substr(coalesce(system_prompt, ''), greatest(position($1 in coalesce(system_prompt, '')), 1))) > 0 AS ya_ampliado
         FROM agentes ORDER BY slug`,
      [MARCA, CANARIO]
    )
  ).rows;
  console.log("ESTADO EN LA BASE");
  for (const f of filas)
    console.log(`   ${f.slug.padEnd(27)}${f.sin_prompt ? "sin prompt" : f.ya_ampliado ? "ya ampliado" : f.tiene_bloque ? "bloque viejo" : "SIN BLOQUE ←"}`);
  const objetivo = filas.filter((f) => !f.sin_prompt && f.tiene_bloque && !f.ya_ampliado).length;
  console.log(`   → alcanza a ${objetivo} agente(s)\n`);

  const sql = `-- Bloque común ampliado: once frases promovidas desde triaje y reproducción.
--
-- Salieron de la unión de las nueve versiones del estándar, afirmación por
-- afirmación. El criterio NO fue la frecuencia: las once estaban en un solo
-- agente y la intersección las habría descartado. Se eligieron porque
-- convierten un principio en algo verificable.
--
-- Ocho vienen de reproducción, que resultó ser el agente que llegó más
-- lejos y no el desviado: la taxonomía de datos faltantes (no solicitado /
-- solicitado y pendiente / no aplicable), la prioridad por cuál dato cambia
-- más la conducta, el motivo por el que un número inventado es peor que una
-- omisión, y qué hacer ante fuentes que se contradicen. Dos vienen de
-- triaje. Todas van VERBATIM: adaptarlas por especialidad es reescribirlas,
-- y reescribir es lo que produjo la deriva que esto viene a cerrar.
--
-- REEMPLAZA el bloque en vez de concatenarlo (a diferencia de la 076, donde
-- el bloque no existía). Se corta el prompt en la marca del bloque y se
-- pega el nuevo: así no hace falta embeber la versión vieja ni saber cuál
-- tiene cada base. Lo anterior a la marca no se toca, incluida cualquier
-- edición hecha por Platform Admin sobre el cuerpo del prompt.
--
-- Idempotente: el WHERE excluye a los que ya tienen la frase canario.
UPDATE agentes
   SET system_prompt = rtrim(left(system_prompt, position($marca$${MARCA}$marca$ in system_prompt) - 1), E' \\n\\r\\t')
                       || E'\\n\\n'
                       || $bloque$${bloque}$bloque$
 WHERE system_prompt IS NOT NULL
   AND position($marca$${MARCA}$marca$ in system_prompt) > 0
   AND position($canario$${CANARIO}$canario$ in substr(system_prompt, position($marca$${MARCA}$marca$ in system_prompt))) = 0;

-- Verificación con dientes: ningún agente con bloque puede quedar con la
-- versión vieja. Si queda alguno, la migración falla y frena el despliegue.
DO $verificacion$
DECLARE
  v_faltan text;
BEGIN
  SELECT string_agg(slug, ', ' ORDER BY slug) INTO v_faltan
    FROM agentes
   WHERE system_prompt IS NOT NULL
     AND position($marca$${MARCA}$marca$ in system_prompt) > 0
     AND position($canario$${CANARIO}$canario$ in substr(system_prompt, position($marca$${MARCA}$marca$ in system_prompt))) = 0;

  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Estos agentes quedaron con el bloque común viejo: %. No se sigue adelante en silencio.', v_faltan;
  END IF;
END
$verificacion$;
`;

  fs.writeFileSync(DESTINO, sql, "utf8");
  console.log(`ESCRITA ${path.basename(DESTINO)} — ${sql.length} caracteres.`);
  await pool.end();
}

main().catch((e) => { console.error("ERROR", e.message ?? e); process.exit(1); });
