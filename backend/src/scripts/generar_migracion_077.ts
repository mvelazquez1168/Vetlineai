import fs from "fs";
import path from "path";
import { pool } from "../db";

// Genera la migración 077 (estándar de neuro reparado).
//
// Mismo patrón que la 075: el sembrado no actualiza, así que en una base
// ya sembrada el prompt reparado no llegaría. Y como las reposiciones van
// en el medio del documento, no se puede concatenar como en la 076 — hay
// que reemplazar, con guarda de coincidencia exacta para no pisar una
// edición hecha por Platform Admin.

const ID_NEURO = "slug:neuro";
const PROMPT = path.join(__dirname, "..", "seed", "plataforma", "prompts", "neuro.txt");
const DESTINO = path.join(__dirname, "..", "migrations", "077_prompt_neuro_reparado.sql");

const norm = (s: string) => s.replace(/\r\n/g, "\n");

async function main() {
  const nuevo = norm(fs.readFileSync(PROMPT, "utf8"));
  const fila = (await pool.query(`SELECT id, system_prompt AS s FROM agentes WHERE slug = 'neuro'`)).rows[0];
  if (!fila) throw new Error("neuro no está en esta base.");
  const viejo = norm(fila.s ?? "");

  console.log("VERIFICACIÓN PREVIA");
  console.log(`   en base:    ${viejo.length} car.`);
  console.log(`   reparado:   ${nuevo.length} car.  (+${nuevo.length - viejo.length})`);

  // El reparado tiene que contener al viejo salvo por las inserciones:
  // se comprueba que cada línea del viejo siga existiendo.
  const perdidas = viejo.split("\n").filter((l) => l.trim() && !nuevo.includes(l));
  console.log(`   líneas del prompt en base que no están en el reparado: ${perdidas.length}`);
  perdidas.slice(0, 3).forEach((l) => console.log(`      ${JSON.stringify(l.slice(0, 70))}`));
  if (perdidas.length) throw new Error("ABORTA: el reparado no es un superconjunto del que está en la base.");

  for (const [t, txt] of [["nuevo", nuevo], ["viejo", viejo]] as const) {
    if (txt.includes("$neuro")) throw new Error(`ABORTA: el ${t} contiene el delimitador dollar-quote.`);
    if (/^\s*\\/m.test(txt)) throw new Error(`ABORTA: el ${t} tiene una línea que empieza con backslash.`);
  }

  const sql = `-- Estándar de razonamiento de neurología, reparado.
--
-- Neuro tenía los mismos once títulos que sus siete hermanos y entre un
-- tercio y la mitad del contenido. Lo que le faltaba no era estilo: eran las
-- oraciones que convierten un título en un mecanismo. Se reponen ocho,
-- copiadas literalmente de gastroenterología y cardiología — no reescritas.
--
-- La más cara está confirmada por dos vías independientes. El análisis
-- estático de los prompts encontró que neuro era el único de los ocho sin
-- «un dato ausente es información; nunca se trata como un valor
-- implícitamente normal», y la corrida de comportamiento lo confirmó: ante
-- un panel con un analito marcado NO REALIZADO, neuro respondió
-- «laboratorio general dentro de límites normales».
--
-- Las ocho reposiciones:
--   §3.2  qué sostiene un Confidence Score alto
--   §4.3  nunca se actualiza una probabilidad en silencio
--   §5    un dato ausente es información  (la confirmada)
--   §5    no inventar referencias ni casos similares
--   §5    decir «información insuficiente» en vez de rellenar
--   §7    una conclusión que no responde las cuatro preguntas no está lista
--   §8    "Se sabe que..." sin fuente rastreable no es válida
--   §9    la incertidumbre va junto a la conclusión, no al final
--
-- Nada propio de neuro se tocó: las tres líneas clínicas, el dolor profundo,
-- el estadio COASTeR y los AEDs quedan intactos. Verificado por
-- reversibilidad: quitando las ocho inserciones se recupera el texto
-- anterior carácter por carácter.
--
-- REEMPLAZA en vez de concatenar (a diferencia de la 076) porque las
-- reposiciones van en el medio del documento. La guarda compara el texto
-- COMPLETO: si alguien editó este prompt por Platform Admin, no se lo pisa.
--
-- Idempotente: al terminar el texto guardado ya no es el viejo.
UPDATE agentes
   SET system_prompt = $neuro$${nuevo}$neuro$
 WHERE slug = 'neuro'
   AND replace(system_prompt, chr(13), '') = $neuro_viejo$${viejo}$neuro_viejo$;

-- Verificación con dientes: si neuro sigue sin la regla que la corrida
-- confirmó que le faltaba, la migración falla y frena el despliegue.
DO $verificacion$
DECLARE
  v_prompt text;
BEGIN
  SELECT system_prompt INTO v_prompt FROM agentes WHERE slug = 'neuro';

  IF v_prompt IS NULL THEN
    RAISE NOTICE 'Neuro sin prompt en esta base; lo siembra seedPlataforma con el texto reparado.';
  ELSIF position('Un dato ausente es información' in v_prompt) = 0 THEN
    RAISE EXCEPTION 'El estándar de neurología sigue sin la regla de dato ausente. O el prompt fue editado después de sembrarlo, o esta migración no aplicó. No se sigue adelante en silencio.';
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
