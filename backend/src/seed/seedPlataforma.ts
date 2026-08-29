import fs from "fs";
import path from "path";
import "dotenv/config";
import { Pool, PoolClient } from "pg";

// Sembrado de PLATAFORMA: lo que falta para que un servidor nuevo quede
// operativo DESPUÉS de correr las migraciones — tarifas del modelo,
// catálogo de agentes con su system_prompt, y la base de conocimiento (con
// sus alias de raza). Distinto de backend/src/seed/seed.ts (datos de DEMO —
// una clínica, médico y casos de ejemplo, opcional y solo para desarrollo
// local): este script es el que corre en cualquier despliegue nuevo, real
// o de prueba.
//
// País/planes/parámetros de plataforma NO están acá — ya los siembran las
// migraciones mismas (002, 025 y siete migraciones sucesivas
// respectivamente; confirmado corriendo las 58 contra una base vacía: 194
// países, 4 planes activos y 19 parámetros ya están puestos apenas termina
// `npm run migrate`, sin este script). Agregarlos acá hubiera sido
// redundante y, peor, roto la idempotencia: cada migración les asigna un id
// nuevo (gen_random_uuid()) en cada base, así que un segundo INSERT con los
// ids congelados de la base viva jamás iba a chocar por id — chocaba por la
// clave natural (planes.codigo) primero, con un error de duplicado real.
//
// Todo el contenido sale de backend/src/seed/plataforma/, congelado a mano
// desde la base viva con exportar_sembrado_plataforma.ts (no se lee la base
// viva en este script — los archivos son la fuente de verdad versionada).
//
// Idempotente por diseño: cada fila trae su id real (el mismo que tiene en
// la base viva) y cada INSERT usa ON CONFLICT (id) DO NOTHING. Correr este
// script dos veces no duplica nada; tampoco pisa cambios que se hayan hecho
// después a mano (Platform Admin), a propósito: esto es un sembrado
// inicial, no una sincronización.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DIR = path.join(__dirname, "plataforma");
const PROMPTS_DIR = path.join(DIR, "prompts");
const DOCUMENTOS_DIR = path.join(DIR, "documentos");

function leerJson<T>(nombreArchivo: string): T {
  return JSON.parse(fs.readFileSync(path.join(DIR, nombreArchivo), "utf8"));
}

interface Tarifa {
  id: string;
  modelo: string;
  tipo_token: string;
  precio_usd_por_millon: string;
  facturable: boolean;
}

interface Agente {
  id: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
  icono: string | null;
  estado_catalogo: string;
  especialidad: string | null;
  estado: string;
  promptFile: string | null;
}

interface Documento {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo: string;
  agente_slug: string | null;
  pais_codigo: string | null;
  incluir_en_contexto: boolean;
  // Migración 073 — en qué bloque del pedido entra el documento. Si el
  // sembrado no lo llevara, la mitad de composición se insertaría con el
  // DEFAULT ('clinico') y volvería al bloque que lee el chat, deshaciendo
  // la partición sin que nada falle a la vista.
  ambito?: "clinico" | "generacion";
  estado: string;
  contenidoFile: string;
}

interface RazaAliasFila {
  id: string;
  raza_nombre: string;
  documento_id: string;
  titulo_seccion: string;
  nota: string | null;
}

interface FarmacoDosisEspecie {
  especie: "canino" | "felino";
  dosis_min: number | null;
  dosis_max: number | null;
  unidad: string | null;
}

interface Farmaco {
  id: string;
  nombre: string;
  principio_activo: string;
  clase: string | null;
  presentacion: string | null;
  concentracion: string | null;
  via_administracion_default: string | null;
  dosis_especie: FarmacoDosisEspecie[];
}

async function sembrarTarifas(client: PoolClient) {
  const tarifas = leerJson<Tarifa[]>("tarifas.json");
  let insertadas = 0;
  for (const t of tarifas) {
    const r = await client.query(
      `INSERT INTO tarifas_modelo (id, modelo, tipo_token, precio_usd_por_millon, facturable)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.modelo, t.tipo_token, t.precio_usd_por_millon, t.facturable]
    );
    insertadas += r.rowCount ?? 0;
  }
  console.log(`tarifas: ${insertadas} insertadas de ${tarifas.length} (resto ya existía)`);
}

async function sembrarAgentes(client: PoolClient) {
  const agentes = leerJson<Agente[]>("agentes.json");
  let insertadas = 0;
  for (const a of agentes) {
    // Se normalizan los saltos de línea por la misma razón que en
    // sembrarDocumentos: el system_prompt encabeza el bloque cacheado y el
    // caché es un match de prefijo byte a byte, así que un sembrado hecho
    // desde un checkout Windows (CRLF) no compartiría caché con uno hecho
    // desde Linux (LF). Faltaba acá y no era teórico: de los nueve agentes
    // sembrados, gastroenterología era el único guardado con CRLF, porque
    // su archivo es el único CRLF en el repo.
    const systemPrompt = a.promptFile
      ? fs.readFileSync(path.join(PROMPTS_DIR, a.promptFile), "utf8").replace(/\r\n/g, "\n")
      : null;
    const r = await client.query(
      `INSERT INTO agentes (id, nombre, slug, descripcion, icono, estado_catalogo, especialidad,
                             estado, system_prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.nombre, a.slug, a.descripcion, a.icono, a.estado_catalogo, a.especialidad, a.estado, systemPrompt]
    );
    insertadas += r.rowCount ?? 0;
  }
  console.log(`agentes: ${insertadas} insertados de ${agentes.length} (resto ya existía)`);
  const sinPrompt = agentes.filter((a) => !a.promptFile).map((a) => a.slug);
  if (sinPrompt.length > 0) {
    console.log(`  atención: sin system_prompt configurado — ${sinPrompt.join(", ")}`);
  }
}

async function sembrarDocumentos(client: PoolClient) {
  const documentos = leerJson<Documento[]>("documentos.json");
  const agentesPorSlug = new Map(
    (await client.query(`SELECT id, slug FROM agentes`)).rows.map((r) => [r.slug, r.id])
  );
  let insertadas = 0;
  for (const d of documentos) {
    // Normalizar los saltos de línea NO es cosmético: el contenido de
    // estos documentos entra en el bloque cacheado, y el caché es un
    // match de prefijo byte a byte. Sin esto, un checkout en Windows
    // (CRLF) sembraría un texto distinto al de un checkout en Linux (LF)
    // y las dos bases nunca compartirían caché entre sí ni con lo ya
    // sembrado.
    const contenido = fs
      .readFileSync(path.join(DOCUMENTOS_DIR, d.contenidoFile), "utf8")
      .replace(/\r\n/g, "\n");
    const agenteId = d.agente_slug ? agentesPorSlug.get(d.agente_slug) ?? null : null;
    const r = await client.query(
      `INSERT INTO documentos_conocimiento (id, nombre, descripcion, tipo, agente_id, archivo_ref,
                                             estado, pais_codigo, contenido_texto, incluir_en_contexto,
                                             ambito)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        d.id,
        d.nombre,
        d.descripcion,
        d.tipo,
        agenteId,
        // archivo_ref es NOT NULL pero, según ya quedó documentado (ver
        // memoria del proyecto), 150/153 filas de la base viva ya son solo
        // un nombre de origen sin archivo real detrás — se preserva el
        // mismo patrón acá, no un archivo real.
        `${d.nombre}.txt`,
        d.estado,
        d.pais_codigo,
        contenido,
        d.incluir_en_contexto,
        d.ambito ?? "clinico",
      ]
    );
    insertadas += r.rowCount ?? 0;
  }
  console.log(`documentos de conocimiento: ${insertadas} insertados de ${documentos.length} (resto ya existía)`);
}

async function sembrarRazasAliasDocumento(client: PoolClient) {
  const data = leerJson<{ documento_id_esperado: string; filas: RazaAliasFila[] }>(
    "razas_alias_documento.json"
  );
  const documento = await client.query(`SELECT id FROM documentos_conocimiento WHERE id = $1`, [
    data.documento_id_esperado,
  ]);
  if (documento.rows.length === 0) {
    console.log(
      `razas_alias_documento: SALTEADO — el documento ${data.documento_id_esperado} (Predisposiciones Raciales) no está en esta base. Sembrar documentos primero.`
    );
    return;
  }
  let insertadas = 0;
  let sinRaza = 0;
  for (const f of data.filas) {
    const raza = await client.query(`SELECT id FROM razas WHERE nombre = $1`, [f.raza_nombre]);
    if (raza.rows.length === 0) {
      sinRaza++;
      continue;
    }
    const r = await client.query(
      `INSERT INTO razas_alias_documento (id, raza_id, documento_id, titulo_seccion, nota)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [f.id, raza.rows[0].id, f.documento_id, f.titulo_seccion, f.nota]
    );
    insertadas += r.rowCount ?? 0;
  }
  console.log(
    `razas_alias_documento: ${insertadas} insertadas de ${data.filas.length}${
      sinRaza > 0 ? ` (${sinRaza} sin raza correspondiente en el catálogo — inesperado, ver migración 009)` : ""
    }`
  );
}

// Catálogo de fármacos de plataforma (prompt_code: cargar catálogo de
// fármacos, migración 071). id es determinista (derivado del nombre en
// origen) — ON CONFLICT (id) DO NOTHING es lo que permite agregar filas
// después sin tocar las existentes. tenant_id NULL a propósito: estas
// filas son de plataforma, visibles para todas las clínicas.
// presentacion/concentracion llegan NULL (varían por laboratorio/país,
// las completa cada clínica); dosis_especie llega vacío en este
// sembrado — no se inventa ni estima ninguna dosis, si el arreglo no
// trae filas para un fármaco, simplemente no se inserta nada en
// medicamento_dosis_especie para ese fármaco.
async function sembrarFarmacos(client: PoolClient) {
  const data = leerJson<{ farmacos: Farmaco[] }>("farmacos.json");
  let insertados = 0;
  let dosisInsertadas = 0;
  for (const f of data.farmacos) {
    const r = await client.query(
      `INSERT INTO medicamentos (id, tenant_id, nombre, principio_activo, clase, presentacion,
                                  concentracion, via_administracion_default)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [f.id, f.nombre, f.principio_activo, f.clase, f.presentacion, f.concentracion, f.via_administracion_default]
    );
    insertados += r.rowCount ?? 0;

    for (const d of f.dosis_especie) {
      const rd = await client.query(
        `INSERT INTO medicamento_dosis_especie (medicamento_id, especie, dosis_min, dosis_max, unidad)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (medicamento_id, especie) DO NOTHING`,
        [f.id, d.especie, d.dosis_min, d.dosis_max, d.unidad]
      );
      dosisInsertadas += rd.rowCount ?? 0;
    }
  }
  console.log(
    `fármacos: ${insertados} insertados de ${data.farmacos.length} (resto ya existía)` +
      (dosisInsertadas > 0 ? `, ${dosisInsertadas} rango(s) de dosis por especie insertados` : "")
  );
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await sembrarTarifas(client);
    await sembrarAgentes(client);
    await sembrarDocumentos(client);
    await sembrarRazasAliasDocumento(client);
    await sembrarFarmacos(client);
    await client.query("COMMIT");
    console.log("\n✅ Sembrado de plataforma completo.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error en el sembrado de plataforma, se hizo rollback:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
