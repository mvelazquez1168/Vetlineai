import fs from "fs";
import path from "path";
import "dotenv/config";
import { Pool } from "pg";

// Script de un solo uso: vuelca de la base VIVA (dev) el catálogo real de
// plataforma a archivos versionables bajo backend/src/seed/plataforma/, para
// que seedPlataforma.ts los aplique contra cualquier base nueva. Se corre a
// mano una vez (o cada vez que el catálogo real cambie y se quiera
// re-congelar); no se importa desde ningún otro módulo.
//
// NO exporta países/planes/parámetros de plataforma: ya los siembran las
// migraciones mismas (verificado corriendo las 58 contra una base vacía).
// Volcarlos acá también hubiera sido redundante y roto la idempotencia del
// seed (cada migración les asigna un id nuevo en cada base, así que un
// segundo INSERT con ids congelados de la base viva no choca por id, choca
// por la clave natural — ej. planes.codigo — con un error real).
//
// Sí filtra lo que exporta:
//  - tarifas_modelo: solo la fila vigente (vigente_hasta IS NULL) por
//    modelo+tipo_token, y solo para el modelo que el código realmente usa
//    (claude-sonnet-4-6) — no el histórico de precios superados ni el
//    modelo de prueba/mock.
//  - documentos_conocimiento: solo estado='activo' con contenido_texto
//    real — descarta 2 filas basura de la base de dev (un documento
//    "Frame" archivado sin contenido, y el documento demo hardcodeado en
//    seed.ts, que nunca tuvo contenido_texto real).

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const OUT_DIR = path.join(__dirname, "..", "seed", "plataforma");
const PROMPTS_DIR = path.join(OUT_DIR, "prompts");
const DOCUMENTOS_DIR = path.join(OUT_DIR, "documentos");

function escribirJson(nombreArchivo: string, datos: unknown) {
  fs.writeFileSync(path.join(OUT_DIR, nombreArchivo), JSON.stringify(datos, null, 2) + "\n", "utf8");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROMPTS_DIR, { recursive: true });
  fs.mkdirSync(DOCUMENTOS_DIR, { recursive: true });

  const client = await pool.connect();
  try {
    // -----------------------------------------------------------------
    // Tarifas — solo la fila vigente por (modelo, tipo_token), y solo para
    // el modelo real (no el mock de pruebas)
    // -----------------------------------------------------------------
    const tarifas = await client.query(
      `SELECT id, modelo, tipo_token, precio_usd_por_millon, facturable
       FROM tarifas_modelo
       WHERE vigente_hasta IS NULL AND modelo = 'claude-sonnet-4-6'
       ORDER BY tipo_token`
    );
    escribirJson("tarifas.json", tarifas.rows);
    console.log(`tarifas vigentes (claude-sonnet-4-6): ${tarifas.rows.length}`);

    // -----------------------------------------------------------------
    // Agentes — metadata + un archivo .txt por system_prompt
    // -----------------------------------------------------------------
    const agentes = await client.query(
      `SELECT id, nombre, slug, descripcion, icono, estado_catalogo, especialidad, estado,
              system_prompt IS NOT NULL AND system_prompt <> '' AS tiene_prompt
       FROM agentes ORDER BY nombre`
    );
    const agentesCatalogo = [];
    for (const a of agentes.rows) {
      let promptFile: string | null = null;
      if (a.tiene_prompt) {
        const full = await client.query(`SELECT system_prompt FROM agentes WHERE id = $1`, [a.id]);
        promptFile = `${a.slug}.txt`;
        fs.writeFileSync(path.join(PROMPTS_DIR, promptFile), full.rows[0].system_prompt, "utf8");
      }
      agentesCatalogo.push({
        id: a.id,
        nombre: a.nombre,
        slug: a.slug,
        descripcion: a.descripcion,
        icono: a.icono,
        estado_catalogo: a.estado_catalogo,
        especialidad: a.especialidad,
        estado: a.estado,
        promptFile,
      });
    }
    escribirJson("agentes.json", agentesCatalogo);
    console.log(
      `agentes: ${agentesCatalogo.length} (con prompt: ${agentesCatalogo.filter((a) => a.promptFile).length}, sin prompt: ${agentesCatalogo.filter((a) => !a.promptFile).length})`
    );

    // -----------------------------------------------------------------
    // Documentos de conocimiento — metadata + un archivo .txt por
    // contenido (algunos documentos no tienen contenido_texto cargado)
    // -----------------------------------------------------------------
    // estado='archivado' y contenido_texto vacío se excluyen a propósito:
    // son basura de prueba en la base de dev (un documento llamado "Frame"
    // sin contenido, y el documento demo hardcodeado en seed.ts —
    // "Perfil de razas caninas y felinas — predisposiciones generales",
    // que nunca tuvo contenido_texto real) — no conocimiento real que un
    // servidor nuevo necesite.
    const documentos = await client.query(
      `SELECT d.id, d.nombre, d.descripcion, d.tipo, a.slug AS agente_slug, d.pais_codigo,
              d.incluir_en_contexto, d.estado, d.contenido_texto
       FROM documentos_conocimiento d
       LEFT JOIN agentes a ON a.id = d.agente_id
       WHERE d.estado = 'activo'
         AND d.contenido_texto IS NOT NULL AND d.contenido_texto <> ''
       ORDER BY d.nombre`
    );
    const documentosCatalogo = [];
    for (const d of documentos.rows) {
      const contenidoFile = `${d.id}.txt`;
      fs.writeFileSync(path.join(DOCUMENTOS_DIR, contenidoFile), d.contenido_texto, "utf8");
      documentosCatalogo.push({
        id: d.id,
        nombre: d.nombre,
        descripcion: d.descripcion,
        tipo: d.tipo,
        agente_slug: d.agente_slug,
        pais_codigo: d.pais_codigo,
        incluir_en_contexto: d.incluir_en_contexto,
        estado: d.estado,
        contenidoFile,
      });
    }
    escribirJson("documentos.json", documentosCatalogo);
    console.log(
      `documentos: ${documentosCatalogo.length} (con contenido: ${documentosCatalogo.filter((d) => d.contenidoFile).length}, sin contenido: ${documentosCatalogo.filter((d) => !d.contenidoFile).length})`
    );

    // -----------------------------------------------------------------
    // razas_alias_documento — depende de razas (por nombre, catálogo fijo
    // sembrado por la migración 009) y del documento de predisposiciones
    // raciales (por id, ya volcado arriba)
    // -----------------------------------------------------------------
    const docPredisposiciones = documentosCatalogo.find(
      (d) => d.nombre === "Predisposiciones Raciales a Enfermedades — Perros y Gatos"
    );
    const aliasRows = await client.query(
      `SELECT rad.id, r.nombre AS raza_nombre, rad.documento_id, rad.titulo_seccion, rad.nota
       FROM razas_alias_documento rad
       JOIN razas r ON r.id = rad.raza_id
       ORDER BY r.nombre`
    );
    escribirJson("razas_alias_documento.json", {
      documento_id_esperado: docPredisposiciones?.id ?? null,
      filas: aliasRows.rows,
    });
    console.log(`razas_alias_documento: ${aliasRows.rows.length}`);

    console.log("\nExportación completa.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error exportando el sembrado de plataforma:", err);
  process.exit(1);
});
