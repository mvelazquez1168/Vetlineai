import fs from "fs";
import path from "path";
import { pool } from "../db";

// Genera la migración 076 (reglas comunes en los prompts ya sembrados).
//
// A diferencia de la 075, esta NO reemplaza el prompt entero: lo CONCATENA.
// Es la misma operación que se hizo sobre los archivos, y tiene una
// ventaja concreta — si alguien editó un prompt por Platform Admin, la
// edición se conserva y las reglas se agregan igual. Reemplazar el texto
// completo habría pisado esa edición.

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const BLOQUE = path.join(DIR, "reglas_comunes_agentes.md");
const DESTINO = path.join(__dirname, "..", "migrations", "076_reglas_comunes_agentes.sql");
const MARCA = "## Reglas comunes a todos los agentes clínicos de Vetline Ai";

async function main() {
  const bloque = fs.readFileSync(BLOQUE, "utf8").replace(/\r\n/g, "\n").trimEnd();
  if (bloque.includes("$bloque")) throw new Error("El bloque contiene el delimitador dollar-quote.");
  if (/^\s*\\/m.test(bloque)) throw new Error("El bloque tiene una línea que empieza con backslash.");

  const filas = (
    await pool.query(
      `SELECT slug, system_prompt IS NULL AS sin_prompt,
              position($1 in coalesce(system_prompt, '')) > 0 AS ya_lo_tiene
         FROM agentes ORDER BY slug`,
      [MARCA]
    )
  ).rows;
  console.log("ESTADO EN LA BASE ANTES DE LA MIGRACIÓN");
  for (const f of filas)
    console.log(`   ${f.slug.padEnd(27)}${f.sin_prompt ? "sin system_prompt (queda fuera)" : f.ya_lo_tiene ? "ya lo tiene" : "le falta el bloque"}`);
  const objetivo = filas.filter((f) => !f.sin_prompt).length;
  console.log(`   → la migración alcanza a ${objetivo} de ${filas.length} agentes.\n`);

  const sql = `-- Reglas de seguridad comunes a todos los agentes clínicos.
--
-- Igual que la 074 y la 075: el sembrado inserta con ON CONFLICT (id) DO
-- NOTHING, así que en una base ya sembrada estos prompts ya existen, el
-- INSERT no hace nada, y las reglas no llegarían. Sin esta migración el
-- despliegue corre entero y los agentes siguen sin las reglas.
--
-- Qué se agrega y por qué. Una revisión de los nueve prompts encontró que
-- las reglas de seguridad estaban desparejas: cada agente tenía un
-- subconjunto distinto. La más seria faltaba en ocho de nueve — la defensa
-- contra inyección de prompt, que solo tenía reproducción. Importa ahora
-- porque los archivos adjuntos de un caso recién empezaron a llegar al
-- modelo: un PDF subido por un tercero es contenido no confiable entrando
-- al contexto.
--
-- El texto es IDÉNTICO carácter por carácter en los ocho. No es prolijidad:
-- copiar texto entre prompts con variaciones es lo que produjo la deriva
-- del AI Reasoning Standard (mismos títulos, entre 14% y 69% de solape).
-- Entrando idénticas, una futura extracción a documento único las puede
-- cortar exacto.
--
-- CONCATENA, no reemplaza. Si alguien editó un prompt por Platform Admin,
-- la edición se conserva y las reglas se agregan igual.
--
-- Idempotente: el WHERE excluye a los que ya tienen el bloque, así que una
-- segunda corrida no duplica nada. Los agentes sin system_prompt (urología
-- hoy) quedan fuera y lo recibirán del sembrado cuando se les cargue uno.
UPDATE agentes
   SET system_prompt = system_prompt || E'\\n\\n' || $bloque$${bloque}$bloque$
 WHERE system_prompt IS NOT NULL
   AND position($bloque_marca$${MARCA}$bloque_marca$ in system_prompt) = 0;

-- Verificación con dientes: si queda algún agente CON prompt y SIN las
-- reglas, la migración falla y frena el despliegue. El riesgo de este
-- cambio no es que falle, es que no haga nada y nadie se entere.
DO $verificacion$
DECLARE
  v_faltan text;
BEGIN
  SELECT string_agg(slug, ', ' ORDER BY slug) INTO v_faltan
    FROM agentes
   WHERE system_prompt IS NOT NULL
     AND position($bloque_marca$${MARCA}$bloque_marca$ in system_prompt) = 0;

  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Estos agentes quedaron sin las reglas de seguridad comunes: %. No se sigue adelante en silencio.', v_faltan;
  END IF;
END
$verificacion$;
`;

  fs.writeFileSync(DESTINO, sql, "utf8");
  console.log(`ESCRITA ${path.basename(DESTINO)} — ${sql.length} caracteres.`);
  await pool.end();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
