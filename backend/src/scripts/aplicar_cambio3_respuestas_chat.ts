// prompt_code_optimizacion_contexto — Cambio 3: acortar las respuestas
// del chat. Inserta un párrafo nuevo en el system_prompt de cada agente,
// justo antes de la sección "Documentos de referencia" (o su equivalente
// en RCIS, que tiene otra estructura), sin tocar ningún otro contenido
// ni renumerar secciones. NO pone un tope numérico de palabras — es una
// instrucción de registro y propósito, tal como pide el prompt.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/aplicar_cambio3_respuestas_chat.ts
import { pool } from "../db";

// Para los 7 agentes de la familia "N. Estilo profesional" — todos
// comparten la misma sección 4 "Estructura fija" (Resumen → Hallazgos →
// Diferenciales → Información faltante → Próximos pasos), confirmado
// contra el texto real de los 7 antes de escribir este párrafo genérico.
const PARRAFO_ESTILO_ICIS_FAMILIA =
  "En el chat, tu respuesta es conversacional: la extensión que el momento amerita, dirigida a un colega en consulta que necesita lo esencial para decidir el próximo paso — no el despliegue completo de la estructura fija (resumen, hallazgos, diferenciales, información faltante, próximos pasos) en cada turno. Reservá ese desarrollo exhaustivo, por apartados, para cuando generes el Dashboard o el Informe.";

const AGENTES_FAMILIA_ICIS = [
  "cardiologia",
  "dermatologia",
  "endocrino",
  "gastroenterologia",
  "medicina-general-triage",
  "neuro",
  "oncologia",
];

// RCIS tiene su propia estructura ("7. TUS SALIDAS", con DASHBOARD e
// INFORMES ya enumerados) — se agrega como un tercer punto en ese mismo
// estilo, no como párrafo suelto.
const PARRAFO_ESTILO_RCIS =
  "CONVERSACIÓN. Tu respuesta ordinaria en el chat es conversacional, dirigida a un colega en consulta: la extensión que el momento pide, no el despliegue completo de un Dashboard o un Informe. Guardá el desarrollo exhaustivo por apartados para cuando el usuario pida explícitamente uno de esos dos.";

async function aplicarAgenteFamiliaIcis(slug: string): Promise<{ slug: string; antes: number; despues: number }> {
  const result = await pool.query(`SELECT system_prompt FROM agentes WHERE slug = $1`, [slug]);
  const texto = result.rows[0].system_prompt as string;
  const esCrLf = texto.includes("\r\n");
  const separador = esCrLf ? "\r\n\r\n" : "\n\n";

  // Heading "N. Documentos de referencia", con 1 o 2 saltos de línea
  // antes (varía por agente) — se captura el heading completo tal cual
  // aparece, para reinsertarlo sin alterarlo.
  const regexHeading = /\r?\n\r?\n?(\d+)\.\s*Documentos de referencia/;
  const match = texto.match(regexHeading);
  if (!match || match.index === undefined) {
    throw new Error(`${slug}: no se encontró la sección "Documentos de referencia"`);
  }
  // Verificar que hay una sola ocurrencia real de ese heading exacto (no
  // solo del número) antes de tocar nada.
  const ocurrencias = texto.split(match[0]).length - 1;
  if (ocurrencias !== 1) {
    throw new Error(`${slug}: el heading "${match[0]}" aparece ${ocurrencias} veces, se esperaba 1`);
  }

  const antes = texto.slice(0, match.index);
  const heading = match[0]; // incluye los saltos de línea originales
  const despuesDelHeading = texto.slice(match.index + heading.length);

  const nuevoTexto = `${antes}${separador}${PARRAFO_ESTILO_ICIS_FAMILIA}${heading}${despuesDelHeading}`;

  await pool.query(`UPDATE agentes SET system_prompt = $1 WHERE slug = $2`, [nuevoTexto, slug]);
  return { slug, antes: texto.length, despues: nuevoTexto.length };
}

async function aplicarReproduccion(): Promise<{ slug: string; antes: number; despues: number }> {
  const slug = "reproduccion";
  const result = await pool.query(`SELECT system_prompt FROM agentes WHERE slug = $1`, [slug]);
  const texto = result.rows[0].system_prompt as string;

  const anclaje = "No emitís informe durante el trabajo de parto: esa información viaja por el dashboard.\n\n";
  const ocurrencias = texto.split(anclaje).length - 1;
  if (ocurrencias !== 1) {
    throw new Error(`${slug}: el anclaje esperado aparece ${ocurrencias} veces, se esperaba 1`);
  }

  const nuevoTexto = texto.replace(anclaje, `${anclaje}${PARRAFO_ESTILO_RCIS}\n\n`);
  await pool.query(`UPDATE agentes SET system_prompt = $1 WHERE slug = $2`, [nuevoTexto, slug]);
  return { slug, antes: texto.length, despues: nuevoTexto.length };
}

async function main() {
  const resultados: { slug: string; antes: number; despues: number }[] = [];
  for (const slug of AGENTES_FAMILIA_ICIS) {
    resultados.push(await aplicarAgenteFamiliaIcis(slug));
  }
  resultados.push(await aplicarReproduccion());

  console.log("Agente | antes | después | diferencia");
  for (const r of resultados) {
    console.log(`${r.slug} | ${r.antes} | ${r.despues} | +${r.despues - r.antes}`);
  }
  console.log(
    "\nurologia: sin system_prompt cargado (agente mock, sin integración real todavía) — no hay nada que editar ahí."
  );
  console.log("\nTODO OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
