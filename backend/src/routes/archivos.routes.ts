import { toFile } from "@anthropic-ai/sdk";
import crypto from "crypto";
import { Request, Response, Router } from "express";
import multer from "multer";
import path from "path";
import { requerirAnthropic } from "../anthropic";
import { almacenamientoPrivado } from "../almacenamiento";
import { authenticate, withTenantClient } from "../middleware/auth";

export const archivosRouter = Router();

// El archivo queda en memoria (req.file.buffer), no en disco — ver la
// misma nota en platform-admin.routes.ts. Va al ámbito privado del
// almacenamiento de objetos, organizado en su propia "carpeta" lógica
// (casos/) dentro de ese ámbito.
//
// 25MB: cubre una radiografía o ecografía exportada como JPEG/PNG/PDF (lo
// único que este endpoint tipa — ver CONTENT_TYPE_POR_EXTENSION) con
// margen; un estudio DICOM crudo no entra en este flujo, es un formato
// distinto que este endpoint no interpreta. El límite se aplica DURANTE
// la subida (multer corta el stream al llegar al límite, no bufferiza el
// archivo completo antes de rechazarlo) — el tope real de memoria por
// archivo es este valor, nunca el tamaño real del archivo que alguien
// intente mandar.
const LIMITE_TAMANO_ARCHIVO = 25 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_TAMANO_ARCHIVO } });

function inferirTipo(nombreOriginal: string): string {
  const ext = path.extname(nombreOriginal).toLowerCase().replace(".", "");
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "imagen";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "txt", "rtf"].includes(ext)) return "documento";
  if (["xls", "xlsx", "csv"].includes(ext)) return "hoja_calculo";
  return "otro";
}

const CONTENT_TYPE_POR_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Solo estos formatos tienen vista inline razonable en el navegador; el
// resto siempre fuerza descarga (mismo criterio que documentos_conocimiento).
const EXTENSIONES_INLINE = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt"];

archivosRouter.use(authenticate, withTenantClient);

// ---------------------------------------------------------------------
// POST /api/archivos
// Sube un archivo suelto (multipart/form-data, campo "archivo") y lo
// asocia a un caso (campo "casoId"). El archivo queda con mensaje_id NULL
// hasta que se lo referencia en un POST de mensaje (ver
// workspace.routes.ts) — así el chip puede subirse apenas se adjunta,
// antes de que el médico termine de escribir y enviar el mensaje.
//
// Además de guardarlo en el filesystem local (sigue siendo la fuente para
// que el médico lo vea/descargue desde la interfaz), se sube también a la
// Files API de Anthropic — el file_id devuelto queda en
// archivos.file_id_anthropic para que GCIS pueda referenciarlo dentro del
// content de un mensaje real (ver workspace.routes.ts). La subida a
// Anthropic se intenta para todos los archivos, no solo los de casos de
// GCIS: es barata (el storage de la Files API no se cobra, solo el uso
// dentro de un mensaje) y evita tener que resolver acá el agente del caso.
// Si falla (Anthropic no configurado, formato no soportado, etc.), el
// archivo local NO se pierde — solo queda file_id_anthropic en null.
// ---------------------------------------------------------------------
archivosRouter.post("/", (req, res) => {
  upload.single("archivo")(req, res, async (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `El archivo supera el máximo de ${LIMITE_TAMANO_ARCHIVO / (1024 * 1024)}MB.`,
        });
      }
      console.error("POST /archivos (upload)", err);
      return res.status(500).json({ error: "Error al subir el archivo." });
    }
    await manejarSubidaArchivo(req, res);
  });
});

async function manejarSubidaArchivo(req: Request, res: Response) {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }

  const { casoId } = req.body as { casoId?: string };

  if (!req.file) {
    return res.status(400).json({ error: "Falta el archivo." });
  }
  if (!casoId) {
    return res.status(400).json({ error: "Falta casoId." });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT id FROM casos WHERE id = $1 AND medico_id = $2`,
      [casoId, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }

    const tipo = inferirTipo(req.file.originalname);
    const ext = path.extname(req.file.originalname).toLowerCase();
    const contentType = CONTENT_TYPE_POR_EXTENSION[ext] ?? "application/octet-stream";
    const clave = `casos/${crypto.randomUUID()}${ext}`;
    await almacenamientoPrivado.guardar(clave, req.file.buffer, contentType);

    let fileIdAnthropic: string | null = null;
    try {
      const anthropic = requerirAnthropic();
      const subida = await anthropic.beta.files.upload({
        file: await toFile(req.file.buffer, req.file.originalname, {
          type: contentType,
        }),
        betas: ["files-api-2025-04-14"],
      });
      fileIdAnthropic = subida.id;
    } catch (err) {
      console.error(
        `No se pudo subir "${req.file.originalname}" a la Files API de Anthropic — sigue disponible localmente`,
        err
      );
    }

    const result = await req.db!.query(
      `INSERT INTO archivos (caso_id, nombre_archivo, tipo, url, file_id_anthropic)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre_archivo, tipo, url, creado_en, file_id_anthropic`,
      [casoId, req.file.originalname, tipo, `/uploads/${clave}`, fileIdAnthropic]
    );

    res.status(201).json({ archivo: result.rows[0] });
  } catch (err) {
    console.error("POST /archivos", err);
    res.status(500).json({ error: "Error al subir el archivo." });
  }
}

// ---------------------------------------------------------------------
// GET /api/archivos/:id
// Sirve el archivo físico, pero SOLO si el caso al que pertenece es del
// tenant de la sesión actual — join explícito archivos → casos.tenant_id
// (archivos no tiene tenant_id propio; ver 001_init.sql). Esto es defensa
// en profundidad además de la RLS `archivos_isolation` que ya filtra por
// el mismo camino vía withTenantClient: si algún día un handler corre con
// una conexión sin RLS activa, este WHERE explícito sigue protegiendo.
//
// Nunca 403 acá: un archivo de otro tenant no debe ni siquiera confirmar
// que existe, así que ese caso devuelve el mismo 404 que "no existe".
// ---------------------------------------------------------------------
archivosRouter.get("/:id", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT a.nombre_archivo, a.url
       FROM archivos a
       JOIN casos c ON c.id = a.caso_id
       WHERE a.id = $1 AND c.tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Archivo no encontrado." });
    }

    const { nombre_archivo: nombreArchivo, url } = result.rows[0];
    // `url` es una ruta relativa a la raíz del servidor (ej. "/uploads/casos/x.pdf")
    // — se le saca el prefijo para obtener la clave dentro del ámbito privado.
    const clave = url.replace(/^\/uploads\//, "");
    let datos: Buffer;
    try {
      datos = await almacenamientoPrivado.leer(clave);
    } catch {
      return res.status(404).json({ error: "El archivo ya no está disponible." });
    }

    const ext = path.extname(clave).toLowerCase();
    const contentType = CONTENT_TYPE_POR_EXTENSION[ext] ?? "application/octet-stream";
    const forzarDescarga = req.query.descargar === "1" || !EXTENSIONES_INLINE.includes(ext);
    const disposicion = forzarDescarga ? "attachment" : "inline";
    const nombreSanitizado = nombreArchivo.replace(/[\\/:*?"<>|]/g, "").trim() || "archivo";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `${disposicion}; filename="${nombreSanitizado}"; filename*=UTF-8''${encodeURIComponent(nombreSanitizado)}`
    );
    res.send(datos);
  } catch (err) {
    console.error("GET /archivos/:id", err);
    res.status(500).json({ error: "Error al obtener el archivo." });
  }
});
