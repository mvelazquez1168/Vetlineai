// ---------------------------------------------------------------------
// Migración de los archivos existentes en backend/uploads/ (filesystem
// local del contenedor) hacia el almacenamiento de objetos configurado
// (ALMACENAMIENTO_PROVEEDOR=s3 — ver almacenamiento/). Cubre las 4
// categorías que hoy viven en disco: adjuntos de casos, documentos de la
// Base de Conocimiento y exportaciones (ámbito privado), y logos de
// clínica (ámbito público) — 56 archivos en total al momento de escribir
// este script.
//
// NO se ejecuta como parte del despliegue: se corre a mano, una sola vez,
// después de tomar respaldo, apuntando ALMACENAMIENTO_PROVEEDOR (y las
// credenciales S3_*) al bucket real de destino. El origen (disco local)
// nunca se toca — este script solo lee de ahí y escribe en el
// almacenamiento configurado; no borra ni modifica nada en /uploads ni en
// la base de datos.
//
// Por defecto es DRY-RUN (no escribe nada en el almacenamiento) — pasar
// --aplicar para migrar de verdad. Seguro de re-correr: por cada archivo,
// si ya existe en destino con el mismo tamaño, se saltea.
// ---------------------------------------------------------------------
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { almacenamientoPrivado, almacenamientoPublico } from "../almacenamiento";
import { claveLogoDesdeValorGuardado } from "../almacenamiento";
import { contentTypePorClave } from "../almacenamiento/contentType";
import { AlmacenamientoObjetos } from "../almacenamiento/tipos";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const UPLOADS_DIR = path.join(__dirname, "../../uploads");
const aplicar = process.argv.includes("--aplicar");

type Estado = "migrado" | "ya_existia" | "sin_archivo_local" | "error";

interface Resultado {
  categoria: string;
  id: string;
  clave: string;
  estado: Estado;
  detalle?: string;
}

async function migrarUno(
  categoria: string,
  id: string,
  claveCruda: string,
  destino: AlmacenamientoObjetos
): Promise<Resultado> {
  const clave = claveCruda.replace(/^\/uploads\//, "");
  const rutaLocal = path.join(UPLOADS_DIR, clave);

  if (!fs.existsSync(rutaLocal)) {
    return { categoria, id, clave, estado: "sin_archivo_local" };
  }

  const datos = await fs.promises.readFile(rutaLocal);

  try {
    const existente = await destino.leer(clave);
    if (existente.length === datos.length) {
      return { categoria, id, clave, estado: "ya_existia" };
    }
  } catch {
    // No existe en destino todavía — sigue y lo sube.
  }

  if (aplicar) {
    // Explícito aunque el ámbito S3 ya lo derivaría solo: acá el tipo es
    // lo único que se pierde al pasar del disco (donde express.static lo
    // recalcula en cada respuesta desde la extensión) al bucket (donde
    // queda congelado en el momento de subir). Un logo migrado sin tipo se
    // sirve como binary/octet-stream y deja de mostrarse en los correos.
    await destino.guardar(clave, datos, contentTypePorClave(clave));
  }
  return { categoria, id, clave, estado: "migrado" };
}

async function migrarCategoria(
  categoria: string,
  query: string,
  destino: AlmacenamientoObjetos
): Promise<Resultado[]> {
  const { rows } = await pool.query(query);
  const resultados: Resultado[] = [];
  for (const row of rows) {
    try {
      resultados.push(await migrarUno(categoria, row.id, row.clave, destino));
    } catch (err) {
      resultados.push({
        categoria,
        id: row.id,
        clave: row.clave,
        estado: "error",
        detalle: (err as Error).message,
      });
    }
  }
  return resultados;
}

async function migrarLogos(): Promise<Resultado[]> {
  const { rows } = await pool.query(
    `SELECT id, logo_url AS clave FROM tenants WHERE logo_url IS NOT NULL`
  );
  const resultados: Resultado[] = [];
  for (const row of rows) {
    const claveNormalizada = claveLogoDesdeValorGuardado(row.clave);
    try {
      resultados.push(await migrarUno("logos", row.id, claveNormalizada, almacenamientoPublico));
    } catch (err) {
      resultados.push({
        categoria: "logos",
        id: row.id,
        clave: claveNormalizada,
        estado: "error",
        detalle: (err as Error).message,
      });
    }
  }
  return resultados;
}

function imprimirResumen(resultados: Resultado[]) {
  const porCategoria = new Map<string, Resultado[]>();
  for (const r of resultados) {
    if (!porCategoria.has(r.categoria)) porCategoria.set(r.categoria, []);
    porCategoria.get(r.categoria)!.push(r);
  }

  console.log("");
  console.log(`=== Resumen (${aplicar ? "APLICADO" : "DRY-RUN"}) ===`);
  for (const [categoria, items] of porCategoria) {
    const migrados = items.filter((r) => r.estado === "migrado").length;
    const yaExistian = items.filter((r) => r.estado === "ya_existia").length;
    const sinArchivo = items.filter((r) => r.estado === "sin_archivo_local");
    const errores = items.filter((r) => r.estado === "error");

    console.log(
      `${categoria}: ${items.length} fila(s) — ${migrados} ${aplicar ? "migrados" : "se migrarían"}, ${yaExistian} ya en destino, ${sinArchivo.length} sin archivo local, ${errores.length} error(es)`
    );
    for (const r of sinArchivo) console.log(`  [sin archivo local] ${r.id} — ${r.clave}`);
    for (const r of errores) console.log(`  [error] ${r.id} — ${r.clave} — ${r.detalle}`);
  }

  const total = resultados.length;
  const totalMigrados = resultados.filter((r) => r.estado === "migrado").length;
  console.log("");
  console.log(`${totalMigrados}/${total} archivo(s) ${aplicar ? "migrados" : "se migrarían"}.`);
  if (!aplicar) {
    console.log("Corré de nuevo con --aplicar para migrar de verdad (después de tomar respaldo).");
  }
}

(async () => {
  try {
    console.log(`Proveedor de almacenamiento de destino: ${process.env.ALMACENAMIENTO_PROVEEDOR ?? "local"}`);
    if ((process.env.ALMACENAMIENTO_PROVEEDOR ?? "local") === "local" && aplicar) {
      console.log(
        "ADVERTENCIA: ALMACENAMIENTO_PROVEEDOR=local — esto copiaría los archivos sobre sí mismos, no migra a ningún lado real."
      );
    }

    const resultados: Resultado[] = [];
    resultados.push(
      ...(await migrarCategoria(
        "casos",
        `SELECT id, url AS clave FROM archivos WHERE url IS NOT NULL`,
        almacenamientoPrivado
      ))
    );
    resultados.push(
      ...(await migrarCategoria(
        "conocimiento",
        `SELECT id, archivo_ref AS clave FROM documentos_conocimiento WHERE archivo_ref IS NOT NULL`,
        almacenamientoPrivado
      ))
    );
    resultados.push(
      ...(await migrarCategoria(
        "exportaciones",
        `SELECT id, archivo_ref AS clave FROM exportaciones WHERE archivo_ref IS NOT NULL`,
        almacenamientoPrivado
      ))
    );
    resultados.push(...(await migrarLogos()));

    imprimirResumen(resultados);
    process.exit(resultados.some((r) => r.estado === "error") ? 1 : 0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
