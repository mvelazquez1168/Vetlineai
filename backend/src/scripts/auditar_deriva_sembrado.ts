import fs from "fs";
import path from "path";
import { pool } from "../db";

// ---------------------------------------------------------------------
// ¿Qué cambios del sembrado NO llegarían a una base ya sembrada?
//
// seedPlataforma inserta con ON CONFLICT (id) DO NOTHING: agrega, nunca
// actualiza. Eso es correcto a propósito (no pisa lo que Platform Admin
// haya editado a mano), pero significa que cualquier corrección hecha
// sobre un archivo del sembrado es invisible para una base que ya tiene
// esa fila — y no falla nada, que es lo peligroso.
//
// Este script compara fila por fila lo que hay en la base contra lo que
// dicen los archivos del sembrado, y reporta las diferencias que el
// sembrado NO podría cerrar por sí solo. Cada una necesita una migración.
//
// Sirve como control antes de cada despliegue, no solo esta vez.
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const PROMPTS_DIR = path.join(DIR, "prompts");
const DOCUMENTOS_DIR = path.join(DIR, "documentos");

const leer = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const norm = (s: string) => s.replace(/\r\n/g, "\n");
const residuos = (s: string) => (s.match(/\?{2,}/g) ?? []).length;

interface Deriva {
  tabla: string;
  id: string;
  clave: string;
  detalle: string;
}

async function main() {
  const derivas: Deriva[] = [];

  // ---------------- agentes: system_prompt ----------------
  const agentes = leer<{ id: string; slug: string; promptFile: string | null }[]>("agentes.json");
  const enBase = new Map<string, { system_prompt: string | null }>(
    (await pool.query(`SELECT id, system_prompt FROM agentes`)).rows.map((r) => [r.id, r])
  );
  console.log("AGENTES");
  console.log("slug                       en base   sembrado   estado");
  console.log("-".repeat(78));
  for (const a of agentes) {
    const fila = enBase.get(a.id);
    if (!fila) {
      console.log(`${a.slug.padEnd(27)}${"—".padStart(7)}${" ".repeat(3)}${"".padStart(8)}   no existe en la base: el sembrado lo insertaría bien`);
      continue;
    }
    if (!a.promptFile) {
      console.log(`${a.slug.padEnd(27)}${String(fila.system_prompt?.length ?? 0).padStart(7)}${"".padStart(11)}   sin promptFile en el sembrado`);
      continue;
    }
    // Se compara contra el archivo NORMALIZADO porque es lo que el
    // sembrador inserta: sembrarAgentes normaliza CRLF→LF al leer. Comparar
    // contra el archivo crudo daría una deriva falsa permanente en cualquier
    // checkout Windows.
    const archivo = norm(fs.readFileSync(path.join(PROMPTS_DIR, a.promptFile), "utf8"));
    const guardado = fila.system_prompt ?? "";
    let estado: string;
    if (guardado === archivo) estado = "idéntico";
    else if (norm(guardado) === archivo) estado = "CRLF heredado en la base (sembrado anterior a la normalización)";
    else estado = `DIFIERE — base ${residuos(guardado)} residuos, sembrado ${residuos(archivo)}`;
    console.log(
      `${a.slug.padEnd(27)}${String(guardado.length).padStart(7)}${String(archivo.length).padStart(11)}   ${estado}`
    );
    if (guardado !== archivo) derivas.push({ tabla: "agentes", id: a.id, clave: a.slug, detalle: estado });
  }

  // ---------------- documentos_conocimiento ----------------
  const docs = leer<
    { id: string; nombre: string; contenidoFile: string; incluir_en_contexto: boolean; estado: string; ambito?: string }[]
  >("documentos.json");
  const docsBase = new Map<string, any>(
    (
      await pool.query(
        `SELECT id, nombre, contenido_texto, incluir_en_contexto, estado, ambito FROM documentos_conocimiento`
      )
    ).rows.map((r) => [r.id, r])
  );
  let idem = 0,
    faltan = 0;
  const difDoc: string[] = [];
  for (const d of docs) {
    const fila = docsBase.get(d.id);
    if (!fila) {
      faltan++;
      continue;
    }
    const archivo = norm(fs.readFileSync(path.join(DOCUMENTOS_DIR, d.contenidoFile), "utf8"));
    const problemas: string[] = [];
    if (norm(fila.contenido_texto ?? "") !== archivo) problemas.push("contenido");
    if (fila.incluir_en_contexto !== d.incluir_en_contexto) problemas.push(`incluir_en_contexto ${fila.incluir_en_contexto}≠${d.incluir_en_contexto}`);
    if (fila.estado !== d.estado) problemas.push(`estado ${fila.estado}≠${d.estado}`);
    if ((fila.ambito ?? "clinico") !== (d.ambito ?? "clinico")) problemas.push(`ambito ${fila.ambito}≠${d.ambito ?? "clinico"}`);
    if (/\r/.test(fila.contenido_texto ?? "")) problemas.push("CRLF en la base");
    if (problemas.length === 0) idem++;
    else {
      difDoc.push(`   ${d.nombre.slice(0, 58).padEnd(60)}${problemas.join(", ")}`);
      derivas.push({ tabla: "documentos_conocimiento", id: d.id, clave: d.nombre, detalle: problemas.join(", ") });
    }
  }
  console.log(`\nDOCUMENTOS DE CONOCIMIENTO  (${docs.length} en el sembrado)`);
  console.log(`   idénticos: ${idem}   difieren: ${difDoc.length}   no están en la base: ${faltan}`);
  difDoc.forEach((l) => console.log(l));

  // ---------------- tarifas / fármacos / alias ----------------
  const tarifas = leer<{ id: string; modelo: string; tipo_token: string; precio_usd_por_millon: string }[]>("tarifas.json");
  const tBase = new Map<string, any>(
    (await pool.query(`SELECT id, modelo, tipo_token, precio_usd_por_millon FROM tarifas_modelo`)).rows.map((r) => [r.id, r])
  );
  let tDif = 0;
  for (const t of tarifas) {
    const f = tBase.get(t.id);
    if (f && String(f.precio_usd_por_millon) !== String(t.precio_usd_por_millon)) {
      tDif++;
      derivas.push({ tabla: "tarifas_modelo", id: t.id, clave: `${t.modelo}/${t.tipo_token}`, detalle: `precio ${f.precio_usd_por_millon}≠${t.precio_usd_por_millon}` });
    }
  }
  const farm = leer<{ farmacos: { id: string; nombre: string }[] }>("farmacos.json").farmacos;
  const fBase = new Set((await pool.query(`SELECT id FROM medicamentos WHERE tenant_id IS NULL`)).rows.map((r) => r.id));
  const alias = leer<{ filas: { id: string }[] }>("razas_alias_documento.json").filas;
  const aBase = new Set((await pool.query(`SELECT id FROM razas_alias_documento`)).rows.map((r) => r.id));
  console.log(`\nOTRAS TABLAS`);
  console.log(`   tarifas_modelo: ${tarifas.length} en el sembrado, ${tDif} con precio distinto en la base`);
  console.log(`   medicamentos de plataforma: ${farm.length} en el sembrado, ${farm.filter((f) => !fBase.has(f.id)).length} faltan en la base`);
  console.log(`   razas_alias_documento: ${alias.length} en el sembrado, ${alias.filter((a) => !aBase.has(a.id)).length} faltan en la base`);

  // ---------------- resumen ----------------
  console.log("\n" + "=".repeat(78));
  if (derivas.length === 0) {
    console.log("Sin deriva: correr el sembrado dejaría la base igual a los archivos.");
  } else {
    console.log(`DERIVA: ${derivas.length} fila(s) que el sembrado NO puede corregir (ON CONFLICT DO NOTHING).`);
    console.log("Cada una necesita una migración, igual que la 074 con los catálogos.\n");
    for (const d of derivas) console.log(`   ${d.tabla.padEnd(26)} ${d.clave.slice(0, 40).padEnd(42)} ${d.detalle}`);
  }
  console.log("\nNOTA: esto se midió contra la base LOCAL. Producción puede diferir");
  console.log("si alguien editó algo por Platform Admin; correr este mismo script allá.");
  await pool.end();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
