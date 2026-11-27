import { toFile } from "@anthropic-ai/sdk";
import crypto from "crypto";
import { Request, Response, Router } from "express";
import multer from "multer";
import path from "path";
import { requerirAnthropic } from "../anthropic";
import { esLegiblePorAgente } from "../archivosDelCaso";
import { almacenamientoPrivado } from "../almacenamiento";
import { contentTypePorExtension } from "../almacenamiento/contentType";
import {
  DocumentoInvalido,
  puedeSubirTipo,
  validarDatosDeDocumento,
} from "../expediente/documentos";
import { registrarInteraccion } from "../crm/interacciones";
import { authenticate, withTenantClient } from "../middleware/auth";
import { registrarEventoDetallado } from "../middleware/auditoria";

export const archivosRouter = Router();

// El archivo queda en memoria (req.file.buffer), no en disco — ver la
// misma nota en platform-admin.routes.ts. Va al ámbito privado del
// almacenamiento de objetos, organizado en su propia "carpeta" lógica
// (casos/) dentro de ese ámbito.
//
// 25MB: cubre una radiografía o ecografía exportada como JPEG/PNG/PDF (lo
// único que este endpoint tipa — ver contentTypePorExtension) con
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

// La tabla de extensión → tipo vive en almacenamiento/contentType.ts (ver
// `contentTypePorExtension`, importada arriba). Acá había una copia propia
// que ya había divergido: servía .txt y .csv sin `charset=utf-8`, así que
// un estudio exportado como texto con tildes quedaba librado a lo que
// adivinara el navegador.

// Solo estos formatos tienen vista inline razonable en el navegador; el
// resto siempre fuerza descarga (mismo criterio que documentos_conocimiento).
//
// NO agregar ".svg" acá. Desde que el tipo sale de la tabla compartida, un
// .svg se sirve como image/svg+xml, y un SVG mostrado inline ejecuta el
// script que traiga adentro con el origen de la aplicación — sería XSS
// almacenado, subible por cualquier médico como adjunto de un caso. Hoy
// está fuera de esta lista y por eso sale con Content-Disposition:
// attachment, que el navegador descarga en vez de interpretar.
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
// que el médico lo vea/descargue desde la interfaz), se sube a la Files
// API de Anthropic — el file_id devuelto queda en
// archivos.file_id_anthropic para que el agente pueda referenciarlo dentro
// del content de un mensaje real (ver archivosDelCaso.ts). Se intenta para
// cualquier caso, no solo los de GCIS: es barata (el storage de la Files
// API no se cobra, solo el uso dentro de un mensaje) y evita tener que
// resolver acá el agente del caso.
//
// Se sube SOLO lo que el agente después va a poder leer — imágenes, PDF y
// texto plano, según esLegiblePorAgente(). El resto se guarda igual y el
// médico lo sigue viendo y descargando, pero queda con file_id_anthropic
// en null, que es lo que la interfaz usa para avisarle en el chip que ese
// adjunto no va a entrar en el análisis. Si la subida falla (Anthropic no
// configurado, red, etc.), el archivo local NO se pierde y el aviso es el
// mismo — el médico se entera al adjuntar, no después de una respuesta en
// la que el agente hizo como si el archivo no existiera.
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
  // EL GATE DEPENDE DEL DESTINO (revisión del 2026-11-27).
  //
  // Antes era `esMedico` para todo. Con el destino nuevo —un documento
  // del expediente— eso dejaba a la recepción sin poder escanear el
  // historial que el cliente trae en papel, y así es como una carpeta
  // de papeles se queda sin cargar. Para el caso y el estudio sigue
  // siendo médico; para el paciente lo decide el TIPO de documento
  // (`puedeSubirTipo`).
  const destinoPaciente = !!(req.body as { pacienteId?: string }).pacienteId;
  if (!destinoPaciente && !req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }

  // DOS DESTINOS POSIBLES, Y SOLO UNO POR ARCHIVO (anexo 07-03, A6):
  //
  //   * `casoId`  — el adjunto del chat de Vetline Ai, lo de siempre.
  //   * `estudioLabId` — el resultado de un laboratorio, que hasta hoy
  //     no tenía dónde entrar: un resultado que llega por correo no
  //     podía subirse si el paciente no tenía un caso abierto.
  //
  // ABRIR EL DESTINO NO AFLOJA NINGÚN CONTROL, y es lo que hay que
  // mirar al leer esto:
  //
  //   1. el gate `esMedico` de arriba sigue valiendo para los dos;
  //   2. el destino se verifica CONTRA LA CLÍNICA de quien sube, con
  //      una consulta que no devuelve nada si es de otro tenant;
  //   3. el límite de 25 MB y la tabla de tipos son los mismos —son del
  //      `multer` y de `contentTypePorExtension`, que no se tocan;
  //   4. el archivo va al mismo ámbito PRIVADO del almacenamiento, y se
  //      sirve solo por `GET /api/archivos/:id`, con sesión y con el
  //      mismo chequeo de clínica.
  const { casoId, estudioLabId, pacienteId, tipoDocumento, fechaDocumento, descripcion, atencionId } =
    req.body as {
      casoId?: string;
      estudioLabId?: string;
      /** TERCER DESTINO: un documento del expediente del paciente. */
      pacienteId?: string;
      tipoDocumento?: string;
      fechaDocumento?: string;
      descripcion?: string;
      atencionId?: string;
    };

  if (!req.file) {
    return res.status(400).json({ error: "Falta el archivo." });
  }
  if (!casoId && !estudioLabId && !pacienteId) {
    return res.status(400).json({ error: "Falta casoId, estudioLabId o pacienteId." });
  }
  if ([casoId, estudioLabId, pacienteId].filter(Boolean).length > 1) {
    return res.status(400).json({
      error: "Un archivo cuelga de un caso, de un estudio o de un paciente: de uno solo.",
    });
  }
  try {
    let pacienteDelEstudio: string | null = null;

    // --- EL DOCUMENTO DEL EXPEDIENTE ------------------------------
    if (pacienteId) {
      validarDatosDeDocumento(
        { tipoDocumento, fechaDocumento, descripcion },
        req.auth!.zonaHoraria
      );
      const permiso = await puedeSubirTipo(req.db!, req.auth!.tenantId!, tipoDocumento!, {
        esMedico: req.auth!.esMedico,
      });
      if (!permiso.puede) {
        return res.status(403).json({ error: permiso.motivo });
      }
      // EL PACIENTE TIENE QUE SER DE ESTA CLÍNICA. La RLS ya lo
      // garantiza; el filtro explícito está por el mismo criterio que
      // el resto del backend.
      const pac = await req.db!.query<{ id: string }>(
        `SELECT id FROM pacientes WHERE id = $1 AND tenant_id = $2`,
        [pacienteId, req.auth!.tenantId]
      );
      if (pac.rows.length === 0) {
        return res.status(404).json({ error: "Paciente no encontrado." });
      }
      if (atencionId) {
        const at = await req.db!.query<{ id: string }>(
          `SELECT id FROM atenciones WHERE id = $1 AND paciente_id = $2`,
          [atencionId, pacienteId]
        );
        if (at.rows.length === 0) {
          return res.status(400).json({ error: "Esa atención no es de este paciente." });
        }
      }
      pacienteDelEstudio = pacienteId;
    } else if (casoId) {
      const casoResult = await req.db!.query(
        `SELECT id, estado FROM casos WHERE id = $1 AND medico_id = $2`,
        [casoId, req.auth!.userId]
      );
      if (casoResult.rows.length === 0) {
        return res.status(404).json({ error: "Caso no encontrado." });
      }
      // prompt_code_cierre_caso.md, Paso 2 — un caso cerrado es de solo
      // lectura: no se le adjuntan estudios nuevos.
      if (casoResult.rows[0].estado === "completado") {
        return res.status(409).json({ error: "El caso está cerrado — no se pueden adjuntar archivos nuevos." });
      }
    } else {
      // EL ESTUDIO TIENE QUE SER DE ESTA CLÍNICA. `exp_estudios_lab`
      // tiene `tenant_id` y RLS, así que el filtro explícito y la
      // política dicen lo mismo; el explícito está igual, por el mismo
      // criterio del resto del backend.
      const estudio = await req.db!.query<{ paciente_id: string }>(
        `SELECT paciente_id FROM exp_estudios_lab WHERE id = $1 AND tenant_id = $2`,
        [estudioLabId, req.auth!.tenantId]
      );
      if (estudio.rows.length === 0) {
        return res.status(404).json({ error: "Ese estudio no existe." });
      }
      pacienteDelEstudio = estudio.rows[0].paciente_id;
    }

    const tipo = inferirTipo(req.file.originalname);
    const ext = path.extname(req.file.originalname).toLowerCase();
    const contentType = contentTypePorExtension(ext);
    // Carpeta lógica por destino, dentro del mismo ámbito privado.
    const clave = `${casoId ? "casos" : "laboratorio"}/${crypto.randomUUID()}${ext}`;
    await almacenamientoPrivado.guardar(clave, req.file.buffer, contentType);

    // Un file_id de la Files API solo sirve si después se puede
    // referenciar dentro de un mensaje, y eso depende del formato. Subir
    // igual un .pages o un .docx dejaba una fila con file_id_anthropic
    // cargado que hacía creer —al mirar la base— que el archivo le había
    // llegado al agente, cuando el armado del pedido lo descartaba por
    // formato. Con este chequeo, file_id_anthropic no nulo significa una
    // sola cosa: el agente puede leerlo. Misma función que decide en
    // archivosDelCaso.ts, no una lista paralela.
    // EL ARCHIVO DE UN LABORATORIO NO VA A ANTHROPIC.
    //
    // La subida a la Files API existe para que el agente pueda leer los
    // adjuntos de SU conversación. Un resultado de laboratorio cargado
    // en el expediente no es eso: ningún agente lo va a leer —
    // `archivosDelCaso.ts` filtra por caso—, así que subirlo sería
    // mandar datos clínicos a un tercero sin que nadie lo pida y sin
    // que sirva para nada. Lo encontré al verificar el A6: el primer
    // PDF de prueba salió con `file_id_anthropic` puesto.
    const legiblePorAgente = Boolean(casoId) && esLegiblePorAgente(tipo, req.file.originalname);
    let fileIdAnthropic: string | null = null;
    if (!casoId) {
      // Sin caso no hay agente que lo lea: no se sube y no se avisa de
      // nada, porque no falta nada.
    } else if (!legiblePorAgente) {
      console.warn(
        `"${req.file.originalname}" (tipo ${tipo}) se guarda en el caso ${casoId} pero el agente no ` +
          `va a poder leerlo: la Messages API solo referencia imágenes, PDF y texto plano.`
      );
    } else {
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
          `No se pudo subir "${req.file.originalname}" a la Files API de Anthropic — sigue disponible localmente, ` +
            `pero el agente NO va a poder leerlo hasta que se vuelva a adjuntar`,
          err
        );
      }
    }

    const result = await req.db!.query(
      `INSERT INTO archivos (caso_id, estudio_lab_id, paciente_id, nombre_archivo, tipo, url,
                             file_id_anthropic, subido_por_persona_id,
                             tipo_documento, fecha_documento, descripcion, atencion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, nombre_archivo, tipo, url, creado_en, file_id_anthropic,
                 tipo_documento, fecha_documento, descripcion, atencion_id`,
      [
        casoId ?? null,
        estudioLabId ?? null,
        pacienteDelEstudio,
        req.file.originalname,
        tipo,
        `/uploads/${clave}`,
        fileIdAnthropic,
        req.auth!.userId,
        tipoDocumento ?? null,
        fechaDocumento ?? null,
        descripcion?.trim() || null,
        atencionId ?? null,
      ]
    );
    // La interfaz necesita saberlo en el momento de adjuntar, no después
    // de un análisis en el que el agente hizo como si el archivo no
    // existiera. `false` acá es lo que pinta el aviso en el chip.
    const archivo = { ...result.rows[0], legible_por_agente: fileIdAnthropic !== null };
    // prompt_code_cierre_caso.md, Paso 2, punto 2 — todos los puntos de
    // actividad tocan actualizado_en, no solo informacion/mensajes.
    if (casoId) {
      await req.db!.query(`UPDATE casos SET actualizado_en = now() WHERE id = $1`, [casoId]);
    }

    // CADA CARGA QUEDA EN LA LÍNEA DE TIEMPO DEL PACIENTE, que es lo
    // que el pedido exige: un documento que está en la galería y no en
    // la historia es un documento que nadie encuentra buscando por
    // fecha.
    if (pacienteId) {
      await registrarInteraccion(req.db!, {
        tenantId: req.auth!.tenantId!,
        tipo: "documento_adjunto",
        pacienteId,
        origenTabla: "archivos",
        origenId: result.rows[0].id,
        personaId: req.auth!.userId,
        resumen: `${tipoDocumento ?? "documento"}: ${req.file.originalname}`.slice(0, 120),
      });
    }

    res.status(201).json({ archivo });
  } catch (err) {
    // UN DATO MAL PEDIDO NO ES UN ERROR DEL SERVIDOR. Sin esto, «falta
    // el tipo de documento» salía como 500 y la pantalla mostraba
    // «Error al subir el archivo», que no dice qué arreglar.
    if (err instanceof DocumentoInvalido) {
      return res.status(400).json({ error: err.message });
    }
    console.error("POST /archivos", err);
    res.status(500).json({ error: "Error al subir el archivo." });
  }
}

// ---------------------------------------------------------------------
// DELETE /api/archivos/:id
// Quita un adjunto del caso. Borrado real —fila, objeto del
// almacenamiento y archivo de la Files API— igual que el borrado de
// documentos_conocimiento (platform-admin.routes.ts): el proyecto no usa
// baja lógica en ningún lado, y una fila fantasma en `archivos` sería un
// adjunto que el médico no ve pero el agente sí sigue leyendo, que es
// exactamente el tipo de divergencia que este módulo acaba de cerrar.
//
// Dos reglas, ambas definidas por el usuario:
//   1. Solo quien lo subió. Ver migración 072: hasta ahora no se guardaba
//      el autor, así que la comparación es contra subido_por_persona_id, y
//      cuando esa columna quedó en NULL (autor no reconstruible) el
//      permiso cae al médico del caso.
//   2. En un caso cerrado no tiene sentido: 409, igual que la subida.
//
// Queda registrado en auditoría con el nombre del archivo, no solo el id:
// un adjunto clínico borrado tiene que poder rastrearse por lo que era.
// ---------------------------------------------------------------------
archivosRouter.delete("/:id", async (req, res) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }

  try {
    const result = await req.db!.query(
      // Misma apertura y mismo cuidado que el GET: el archivo es de esta
      // clínica si su caso lo es o si su estudio lo es. Sin esto, un
      // adjunto de laboratorio no se podía borrar nunca —el médico que
      // sube el PDF equivocado quedaba con él en el expediente.
      `SELECT a.id, a.nombre_archivo, a.url, a.caso_id, a.estudio_lab_id, a.file_id_anthropic,
              a.subido_por_persona_id, c.estado AS caso_estado, c.medico_id
         FROM archivos a
         LEFT JOIN casos c            ON c.id = a.caso_id
         LEFT JOIN exp_estudios_lab e ON e.id = a.estudio_lab_id
        WHERE a.id = $1
          AND (c.tenant_id = $2 OR e.tenant_id = $2)`,
      [req.params.id, req.auth!.tenantId]
    );
    // Mismo criterio que el GET de abajo: un archivo de otro tenant no
    // confirma ni siquiera que existe.
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Archivo no encontrado." });
    }
    const archivo = result.rows[0];

    const autor = archivo.subido_por_persona_id ?? archivo.medico_id;
    if (autor !== req.auth!.userId) {
      return res.status(403).json({
        error: "Solo quien adjuntó el archivo puede eliminarlo.",
      });
    }

    if (archivo.caso_estado === "completado") {
      return res.status(409).json({
        error: "El caso está cerrado — no se pueden eliminar sus archivos.",
      });
    }

    await req.db!.query(`DELETE FROM archivos WHERE id = $1`, [req.params.id]);
    if (archivo.caso_id) {
      await req.db!.query(`UPDATE casos SET actualizado_en = now() WHERE id = $1`, [archivo.caso_id]);
    }

    registrarEventoDetallado(req.auth!, "eliminar", "archivo", archivo.id, {
      nombre_archivo: archivo.nombre_archivo,
      caso_id: archivo.caso_id,
    });

    // El objeto guardado y el archivo del proveedor se van detrás de la
    // fila, sin bloquear la respuesta: si alguno falla, lo que el médico
    // pidió (que el adjunto deje de estar en el caso, y de llegarle al
    // agente) ya pasó igual. Se loguean, no se reintentan.
    const clave = String(archivo.url).replace(/^\/uploads\//, "");
    almacenamientoPrivado
      .eliminar(clave)
      .catch((err) => console.error(`No se pudo borrar el objeto ${clave} del almacenamiento`, err));

    if (archivo.file_id_anthropic) {
      void (async () => {
        try {
          await requerirAnthropic().beta.files.delete(archivo.file_id_anthropic, {
            betas: ["files-api-2025-04-14"],
          });
        } catch (err) {
          console.error(
            `No se pudo borrar ${archivo.file_id_anthropic} de la Files API — la fila ya no existe, ` +
              `así que no se le va a mandar al agente igual`,
            err
          );
        }
      })();
    }

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /archivos/:id", err);
    res.status(500).json({ error: "Error al eliminar el archivo." });
  }
});

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
      // LA AUTORIZACIÓN ES LO IMPORTANTE DE ESTA CONSULTA.
      //
      // Nacía con un JOIN a `casos` que probaba la clínica por el caso.
      // Desde el A6 un archivo también puede colgar de un estudio de
      // laboratorio, y la tentación fácil —pasar el JOIN a LEFT— habría
      // hecho que un archivo sin caso pasara SIN NINGÚN chequeo de
      // clínica. Por eso el filtro es explícito y exige que el archivo
      // pertenezca a un caso de esta clínica o a un estudio de esta
      // clínica: si no cumple ninguna de las dos, no existe.
      `SELECT a.nombre_archivo, a.url
       FROM archivos a
       LEFT JOIN casos c            ON c.id = a.caso_id
       LEFT JOIN exp_estudios_lab e ON e.id = a.estudio_lab_id
       WHERE a.id = $1
         AND (c.tenant_id = $2 OR e.tenant_id = $2)`,
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
    const contentType = contentTypePorExtension(ext);
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
