import { randomUUID } from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { almacenamientoPrivado } from "../almacenamiento";
import { conAlcanceTenant } from "../alcanceTenant";
import { authenticate, withTenantClient } from "../middleware/auth";
import { mensajeRechazoGeneracion, verificarAntesDeGenerar } from "../tarifas";
import {
  aplicarBorrador,
  completarReceta,
  contextoDelPaciente,
  descartarDictado,
  estadoDelDictado,
  guardarDictado,
  verDictado,
} from "../expediente/dictado";
import { catalogosDelDictado, ordenarDictado } from "../expediente/dictadoBorrador";
import {
  TranscripcionNoDisponibleError,
  transcriptorDelEntorno,
  vocabularioDeLaClinica,
} from "../expediente/transcripcion";

// ---------------------------------------------------------------------
// EL DICTADO DE LA CONSULTA — rutas (prompt 07d, fase 2).
//
// Router propio y no un bloque más en `expediente.routes.ts` por una
// razón concreta: la ruta que transcribe necesita `multer` (sube audio) y
// tiene que CERRAR LA TRANSACCIÓN en el medio (habla con dos servicios
// externos, uno de transcripción y el modelo). Las dos cosas son
// excepciones al patrón del resto del expediente, y mezcladas ahí se
// leen como si fueran lo normal.
//
// EL ORDEN DE UNA TRANSCRIPCIÓN, Y POR QUÉ ES ASÍ:
//
//   1. transacción abierta — permisos, interruptor de la clínica,
//      compuerta de crédito, y se levanta todo lo que hace falta
//      después (catálogos, vocabulario, paciente);
//   2. `cerrarTransaccion()` — porque lo que viene tarda segundos y
//      dejar la transacción abierta mientras tanto es el `idle in
//      transaction` que ya nos costó una alerta (migración 081);
//   3. sin transacción — transcribir y ordenar;
//   4. transacción corta — guardar el dictado y su consumo, juntos.
// ---------------------------------------------------------------------

export const dictadoRouter = Router();

// 20 MB: unos 40 minutos de opus a 64 kbps, muy por encima de una
// consulta dictada. El tope existe para que un archivo equivocado falle
// rápido, no para limitar el dictado.
const LIMITE_AUDIO = 20 * 1024 * 1024;
const subirAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_AUDIO } });

// El modelo que ordena. Mismo identificador que usan las otras cuatro
// generaciones; el precio sale de `tarifas_modelo` vía `tarifas.ts`.
const MODELO_ORDENAMIENTO = "claude-sonnet-4-6";

dictadoRouter.use(authenticate, withTenantClient);

// EL DICTADO ES UN ACTO CLÍNICO. Un administrador puede ver la atención;
// dictarla, no. Mismo criterio que `soloMedico` del expediente, repetido
// acá porque este router no cuelga de aquél.
dictadoRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.auth?.esMedico) {
    return res.status(403).json({
      error: "El dictado de la consulta es del médico que la atiende.",
    });
  }
  next();
});

function fallo(res: Response, err: unknown, contexto: string) {
  console.error(contexto, err);
  const e = err as { message?: string };
  res.status(400).json({ error: e.message ?? "No se pudo completar la operación." });
}

/**
 * Si el dictado por IA está disponible para este usuario y esta clínica.
 *
 * La pantalla lo pregunta antes de dibujar el botón: un botón que al
 * tocarlo contesta «tu clínica no tiene esto» es un botón que no debería
 * haber estado ahí.
 */
dictadoRouter.get("/estado", async (req, res) => {
  try {
    const estado = await estadoDelDictado(req.db!, req.auth!.tenantId!);
    const transcriptor = transcriptorDelEntorno(null);
    const disponible = transcriptor.disponible();
    res.json({
      activo: estado.activo,
      retencionAudioHoras: estado.retencionAudioHoras,
      proveedor: transcriptor.nombre,
      // El simulado necesita que el navegador mande el texto que
      // reconoció. La pantalla tiene que saberlo para pedirlo.
      necesitaTextoDelNavegador: transcriptor.nombre === "simulado",
      proveedorListo: disponible.listo,
      motivoNoListo: disponible.motivo ?? null,
    });
  } catch (err) {
    fallo(res, err, "GET /dictado/estado");
  }
});

/** El último dictado de una atención, con su borrador. */
dictadoRouter.get("/atenciones/:id", async (req, res) => {
  try {
    res.json({ dictado: await verDictado(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /dictado/atenciones/:id");
  }
});

// ---------------------------------------------------------------------
// TRANSCRIBIR Y ORDENAR
//
// multipart: `audio` (el archivo) y, solo con el proveedor simulado,
// `texto` (lo que reconoció el navegador — ver TranscriptorSimulado).
// `segundos` es la duración que midió el navegador, y se usa únicamente
// si el proveedor no informa la suya.
// ---------------------------------------------------------------------
dictadoRouter.post("/atenciones/:id", subirAudio.single("audio"), async (req, res) => {
  const atencionId = req.params.id;
  const tenantId = req.auth!.tenantId!;
  const personaId = req.auth!.userId!;

  try {
    // ---- 1. Transacción abierta: permisos, interruptor y crédito ----
    const estado = await estadoDelDictado(req.db!, tenantId);
    if (!estado.activo) {
      return res.status(403).json({
        error:
          "El dictado de la consulta con IA no está activado para esta clínica. " +
          "Lo activa el administrador en Administración › Notificaciones y servicios.",
      });
    }

    const atencion = await req.db!.query<{ estado: string }>(
      `SELECT estado FROM atenciones WHERE id = $1`,
      [atencionId]
    );
    if (atencion.rows.length === 0) {
      return res.status(404).json({ error: "Esa atención no existe." });
    }
    if (atencion.rows[0].estado !== "borrador") {
      return res.status(400).json({
        error: "La atención ya está cerrada: lo que falte se agrega en una adenda.",
      });
    }

    // LA MISMA COMPUERTA QUE LAS OTRAS CUATRO GENERACIONES. Sin agente,
    // porque el dictado no es un agente de Vetline Ai (ver tarifas.ts).
    const verificacion = await verificarAntesDeGenerar(req.db!, {
      tenantId,
      agenteId: null,
      tipoOperacion: "dictado",
      disparadoPor: "usuario",
    });
    if (!verificacion.permitido) {
      return res.status(402).json({
        error: mensajeRechazoGeneracion(verificacion.motivo!),
        motivo: verificacion.motivo,
      });
    }

    const paciente = await contextoDelPaciente(req.db!, atencionId);
    if (!paciente) {
      return res.status(404).json({ error: "Esa atención no existe." });
    }
    const catalogos = await catalogosDelDictado(req.db!);
    const vocabulario = await vocabularioDeLaClinica(req.db!, tenantId);

    // ---- 2. Se cierra la transacción ANTES de hablar con afuera ----
    await req.cerrarTransaccion!();

    // ---- 3. Transcribir y ordenar, sin transacción abierta ----
    const transcriptor = transcriptorDelEntorno(
      typeof req.body?.texto === "string" ? req.body.texto : null
    );
    let transcripcion;
    try {
      transcripcion = await transcriptor.transcribir(
        {
          bytes: req.file?.buffer ?? Buffer.alloc(0),
          tipo: req.file?.mimetype ?? "audio/webm",
          segundosDeclarados: req.body?.segundos ? Number(req.body.segundos) : null,
        },
        vocabulario
      );
    } catch (err) {
      if (err instanceof TranscripcionNoDisponibleError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("POST /dictado/atenciones/:id — transcripción", err);
      return res.status(502).json({
        error: "No se pudo transcribir el audio en este momento. El texto escrito a mano sigue funcionando.",
      });
    }

    // EL ORDENAMIENTO PUEDE FALLAR Y EL DICTADO IGUAL SE GUARDA. El
    // texto transcrito ya es útil por sí solo —el médico lo puede copiar
    // a los campos— y ya se pagó. Perderlo porque el modelo no contestó
    // sería tirar lo que costó.
    let ordenamiento = null;
    let errorOrdenamiento: string | null = null;
    try {
      ordenamiento = await ordenarDictado(
        catalogos,
        transcripcion.texto,
        paciente.contexto,
        MODELO_ORDENAMIENTO
      );
    } catch (err) {
      console.error("POST /dictado/atenciones/:id — ordenamiento", err);
      errorOrdenamiento =
        "Se transcribió el dictado pero no se pudo ordenar en los campos. El texto quedó guardado.";
    }

    // ---- 3b. El audio, solo si la clínica lo pidió ----
    //
    // Por omisión NO SE GUARDA, y el camino es el de arriba: si
    // `retencionAudioHoras` es 0 ni se toca el almacenamiento. Lo que se
    // guarda cuando sí está configurado es el archivo crudo, y el
    // barrido de `dictados.job.ts` lo borra al vencer.
    let audioArchivoId: string | null = null;
    if (estado.retencionAudioHoras > 0 && req.file?.buffer?.length) {
      try {
        const extension = (req.file.mimetype.split("/")[1] ?? "webm").replace(/[^a-z0-9]/gi, "");
        const clave = `dictados/${tenantId}/${randomUUID()}.${extension}`;
        await almacenamientoPrivado.guardar(clave, req.file.buffer, req.file.mimetype);
        audioArchivoId = await conAlcanceTenant(tenantId, async (db) => {
          const r = await db.query<{ id: string }>(
            `INSERT INTO archivos (atencion_id, nombre_archivo, tipo, url, subido_por_persona_id)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [atencionId, `dictado.${extension}`, req.file!.mimetype, `/uploads/${clave}`, personaId]
          );
          return r.rows[0].id;
        });
      } catch (err) {
        // Que el audio no se pueda guardar no puede costar el dictado.
        console.error("POST /dictado/atenciones/:id — guardado del audio", err);
      }
    }

    // ---- 4. Transacción corta: el dictado y su consumo, juntos ----
    const resultado = await conAlcanceTenant(tenantId, async (db) => {
      const borrador = ordenamiento?.borrador ?? null;
      if (borrador) {
        // El calce con el catálogo, la dosis por peso y el aviso de
        // alergia necesitan la base: se hacen acá y no en el
        // ordenamiento.
        // El peso DICTADO va al cálculo (ver completarReceta): el del
        // expediente puede ser el de la visita anterior, y la dosis del
        // borrador tiene que ser la de hoy.
        borrador.receta = await completarReceta(
          db,
          atencionId,
          paciente.pacienteId,
          borrador.receta,
          borrador.signos.peso
        );
      }
      await guardarDictado(db, {
        tenantId,
        atencionId,
        personaId,
        transcripcion,
        borrador,
        modeloOrdenamiento: ordenamiento?.modelo ?? null,
        usoOrdenamiento: ordenamiento?.uso ?? null,
        audioArchivoId,
        retencionAudioHoras: estado.retencionAudioHoras,
      });
      return verDictado(db, atencionId);
    });

    res.status(201).json({ dictado: resultado, aviso: errorOrdenamiento });
  } catch (err) {
    fallo(res, err, "POST /dictado/atenciones/:id");
  }
});

/**
 * Aceptar el borrador, campo por campo.
 *
 * `campos` es la lista de lo que el médico tildó. No hay un «aceptar
 * todo» del lado del servidor: la pantalla manda la lista completa, y
 * así lo que queda registrado en `campos_aplicados` es lo que el médico
 * aceptó de verdad, no un «todo» que después nadie puede desarmar.
 */
dictadoRouter.post("/:id/aplicar", async (req, res) => {
  try {
    const campos = Array.isArray(req.body?.campos) ? (req.body.campos as string[]) : [];
    if (campos.length === 0) {
      return res.status(400).json({ error: "No se indicó ningún campo para aceptar." });
    }
    res.json(
      await aplicarBorrador(req.db!, req.auth!.tenantId!, req.params.id, campos, req.auth!.userId!)
    );
  } catch (err) {
    fallo(res, err, "POST /dictado/:id/aplicar");
  }
});

dictadoRouter.post("/:id/descartar", async (req, res) => {
  try {
    await descartarDictado(req.db!, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /dictado/:id/descartar");
  }
});

/**
 * El audio guardado, cuando la clínica configuró retención.
 *
 * Existe porque guardar algo que nadie puede escuchar no sirve de nada:
 * la retención es para poder volver al audio cuando el texto quedó mal.
 * La autorización pasa por `exp_dictados`, que sí tiene RLS por tenant
 * (`archivos` no la tiene).
 */
dictadoRouter.get("/:id/audio", async (req, res) => {
  try {
    const r = await req.db!.query<{ url: string; tipo: string | null }>(
      `SELECT a.url, a.tipo
         FROM exp_dictados d JOIN archivos a ON a.id = d.audio_archivo_id
        WHERE d.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Ese dictado no tiene audio guardado." });
    }
    const clave = r.rows[0].url.replace(/^\/uploads\//, "");
    const bytes = await almacenamientoPrivado.leer(clave);
    res.setHeader("Content-Type", r.rows[0].tipo ?? "audio/webm");
    res.send(bytes);
  } catch (err) {
    fallo(res, err, "GET /dictado/:id/audio");
  }
});
