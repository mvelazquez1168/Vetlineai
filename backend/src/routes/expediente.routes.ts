import { NextFunction, Request, Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso, soloPersonalDeLaClinica } from "../permisos";
import {
  adendasDeAtencion,
  agregarAdenda,
  agregarProblema,
  alergiasDePaciente,
  avisosDeAlergia,
  cambiarEstadoProblema,
  ligarProblemaAAtencion,
  problemasDePaciente,
  registrarAlergia,
} from "../expediente/clinico";
import {
  analitosConHistoria,
  cambiarEstadoEstudio,
  cargarResultados,
  cerrarPendienteConResultado,
  estudiosDePaciente,
  estudiosSinVer,
  marcarEstudioVisto,
  solicitarEstudio,
  tendenciaDeAnalito,
} from "../expediente/laboratorio";
import {
  atenderHallazgo,
  groomingDePaciente,
  hallazgosPendientes,
  registrarGrooming,
} from "../expediente/grooming";
import {
  consentimiento,
  consentimientosDePaciente,
  firmarConsentimiento,
  guardarPlantilla,
  plantillas,
  prepararConsentimiento,
  sembrarPlantillasBase,
} from "../expediente/consentimientos";
import {
  consentimientoEnPdf,
  enviarConsentimientoAlCliente,
} from "../expediente/consentimientoPdf";
import { pedirFirmaADistancia } from "../expediente/firmaRemota";
import { documentosDePaciente, tiposDeDocumento } from "../expediente/documentos";
import { enLaClinicaAhora, deshacerSalida, marcarEstancia, registrarSalida } from "../expediente/estancia";
import { guardarBorrador, liberar, tomarOLatir } from "../expediente/borrador";
import { resumenDelExamen, tendenciaDeSignos } from "../expediente/examen";
import { examenEnPdf } from "../expediente/examenPdf";
import {
  abrirAtencion,
  ConflictoDeVersionError,
  agregarDiagnostico,
  agregarItem,
  aplicarPlantilla,
  atencionCompleta,
  atencionEnCurso,
  avisosAlRecetar,
  cerrarAtencion,
  cuentaViva,
  guardarSoap,
  marcarSistema,
  quitarItem,
  resumenDelCierre,
} from "../expediente/atencion";
import { todosLosCatalogos } from "../expediente/catalogosClinicos";
import {
  TipoClinico,
  estudiosDeAtencion,
  pedirEstudio,
  productosParaAtencion,
  protocolos,
  proximaSugerida,
  registrarHistorico,
} from "../expediente/preventivos";
import { enviarReceta, recetaDeAtencionEnPdf } from "../expediente/recetaPdf";
import {
  agregarLinea,
  quitarLinea,
  recetasAnteriores,
  repetirReceta,
  verReceta,
} from "../expediente/receta";
import {
  buscarEnHistoria,
  encabezadoDeExpediente,
  evolucion,
  fichaRacial,
  lineaDeTiempo,
} from "../expediente/resumen";

// ---------------------------------------------------------------------
// API del EXPEDIENTE CLÍNICO (prompt 07, bloque A).
//
// PERMISOS, siguiendo la sección 1 del prompt ("lo clínico es del
// médico"):
//
//   * LEER el expediente: médico o administrador. La recepción necesita
//     el resumen, los preventivos y las alertas para atender el
//     teléfono.
//   * ESCRIBIR CONTENIDO CLÍNICO (problemas, alergias, adendas, cierre
//     de atención, laboratorio): SOLO médico. `soloMedico` lo impone.
//   * GROOMING: cualquiera del personal. Hoy el rol de groomer no
//     existe —el modelo de personas tiene médico y administrador— y
//     cuando el prompt 04 lo cree, este gate pasa a ser su permiso
//     nombrado. Está dicho acá para que ese día se encuentre.
//
// EL SALDO DEL CLIENTE en la franja de alertas va solo si quien mira es
// administrador: es un dato del cliente, no del paciente.
// ---------------------------------------------------------------------
export const expedienteRouter = Router();

expedienteRouter.use(authenticate, withTenantClient);

expedienteRouter.use(
  soloPersonalDeLaClinica(
  "El expediente clínico es del personal de la clínica."
)
);

// EL CONTENIDO CLÍNICO SE ESCRIBE CON SU PERMISO (prompt 04).
//
// `soloMedico` preguntaba por el booleano `es_medico`. Ahora pregunta
// por `expediente.escribir`, que en la matriz tiene el médico y nadie
// más —el mismo resultado de hoy—, con la diferencia de que los
// permisos clínicos están marcados **no configurables**: la clínica no
// puede dárselo a la recepción ni por error.
//
// Los tres permisos clínicos más finos se usan donde corresponden:
// firmar una atención, emitir una receta y registrar grooming. Existían
// en el catálogo del 04 y no los leía nadie.
const soloMedico = exigirPermiso("expediente.escribir");
const puedeFirmar = exigirPermiso("expediente.firmar");
const puedeRecetar = exigirPermiso("receta.emitir");
const puedeGrooming = exigirPermiso("expediente.grooming");

function fallo(res: Response, err: unknown, contexto: string) {
  const e = err as { message?: string; code?: string };
  if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) {
    console.error(contexto, err);
    return res.status(400).json({ error: e.message ?? "No se pudo completar la operación." });
  }
  res.status(400).json({ error: e.message ?? "No se pudo completar la operación." });
}

// =====================================================================
// EL EXPEDIENTE: encabezado, línea de tiempo, búsqueda, evolución
// =====================================================================
expedienteRouter.get("/pacientes/:id", async (req, res) => {
  try {
    res.json(
      await encabezadoDeExpediente(req.db!, req.params.id, {
        verSaldo: !!req.auth!.esAdminClinica,
      })
    );
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id");
  }
});

expedienteRouter.get("/pacientes/:id/linea-de-tiempo", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  try {
    res.json({
      eventos: await lineaDeTiempo(req.db!, req.params.id, {
        tipo: q.tipo || undefined,
        desde: q.desde || undefined,
        hasta: q.hasta || undefined,
        medicoId: q.medico || undefined,
      }),
    });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/linea-de-tiempo");
  }
});

expedienteRouter.get("/pacientes/:id/buscar", async (req, res) => {
  try {
    res.json({
      coincidencias: await buscarEnHistoria(req.db!, req.params.id, String(req.query.q ?? "")),
    });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/buscar");
  }
});

expedienteRouter.get("/pacientes/:id/evolucion", async (req, res) => {
  try {
    res.json({ puntos: await evolucion(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/evolucion");
  }
});

expedienteRouter.get("/pacientes/:id/ficha-racial", async (req, res) => {
  try {
    res.json(await fichaRacial(req.db!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/ficha-racial");
  }
});

// =====================================================================
// LISTA DE PROBLEMAS
// =====================================================================
expedienteRouter.get("/pacientes/:id/problemas", async (req, res) => {
  try {
    res.json({ problemas: await problemasDePaciente(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/problemas");
  }
});

expedienteRouter.post("/pacientes/:id/problemas", soloMedico, async (req, res) => {
  try {
    res.status(201).json(
      await agregarProblema(req.db!, req.auth!.tenantId!, {
        ...req.body,
        pacienteId: req.params.id,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/pacientes/:id/problemas");
  }
});

expedienteRouter.put("/problemas/:id", soloMedico, async (req, res) => {
  try {
    await cambiarEstadoProblema(req.db!, req.auth!.tenantId!, req.params.id, req.body ?? {});
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /expediente/problemas/:id");
  }
});

expedienteRouter.post("/problemas/:id/atenciones", soloMedico, async (req, res) => {
  try {
    if (!req.body?.atencionId) return res.status(400).json({ error: "Falta la atención." });
    await ligarProblemaAAtencion(
      req.db!,
      req.auth!.tenantId!,
      req.params.id,
      req.body.atencionId
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /expediente/problemas/:id/atenciones");
  }
});

// =====================================================================
// ALERGIAS
// =====================================================================
expedienteRouter.get("/pacientes/:id/alergias", async (req, res) => {
  try {
    res.json({ alergias: await alergiasDePaciente(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/alergias");
  }
});

expedienteRouter.post("/pacientes/:id/alergias", soloMedico, async (req, res) => {
  try {
    res.status(201).json(
      await registrarAlergia(req.db!, req.auth!.tenantId!, {
        ...req.body,
        pacienteId: req.params.id,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/pacientes/:id/alergias");
  }
});

/**
 * `GET /pacientes/:id/avisos-alergia?nombre=&grupo=` — ¿es alérgico a
 * esto?
 *
 * Lo consulta la pantalla ANTES de confirmar una receta. Es una
 * consulta y no una validación que bloquee: la decisión de recetar
 * igual es del médico, y el aviso existe para que la tome sabiendo.
 */
expedienteRouter.get("/pacientes/:id/avisos-alergia", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  try {
    res.json({
      avisos: await avisosDeAlergia(req.db!, req.params.id, {
        medicamentoId: q.medicamentoId || undefined,
        nombre: q.nombre || undefined,
        principioActivo: q.principioActivo || undefined,
        grupo: q.grupo || undefined,
      }),
    });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/avisos-alergia");
  }
});

// =====================================================================
// ATENCIÓN: adendas
//
// EL CIERRE NO ESTÁ ACÁ. El bloque A tenía su propio
// `POST /atenciones/:id/cerrar` que solo firmaba, y al llegar el bloque
// B quedaron DOS rutas con la misma URL: Express atiende la primera, así
// que la pantalla nueva firmaba la atención y los cargos se quedaban
// afuera. Una atención cerrada sin su cuenta es plata que nadie va a
// cobrar. Ahora hay una sola, la de abajo, que hace el cierre completo.
// =====================================================================

expedienteRouter.get("/atenciones/:id/adendas", async (req, res) => {
  try {
    res.json({ adendas: await adendasDeAtencion(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id/adendas");
  }
});

expedienteRouter.post("/atenciones/:id/adendas", soloMedico, async (req, res) => {
  try {
    res.status(201).json(
      await agregarAdenda(req.db!, req.auth!.tenantId!, {
        ...req.body,
        atencionId: req.params.id,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/adendas");
  }
});

// =====================================================================
// LABORATORIO
// =====================================================================
expedienteRouter.get("/pacientes/:id/laboratorio", async (req, res) => {
  try {
    res.json({
      estudios: await estudiosDePaciente(req.db!, req.params.id),
      analitos: await analitosConHistoria(req.db!, req.params.id),
    });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/laboratorio");
  }
});

expedienteRouter.get("/pacientes/:id/laboratorio/tendencia/:codigo", async (req, res) => {
  try {
    res.json(await tendenciaDeAnalito(req.db!, req.params.id, req.params.codigo));
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/laboratorio/tendencia/:codigo");
  }
});

expedienteRouter.post("/pacientes/:id/laboratorio", soloMedico, async (req, res) => {
  try {
    res.status(201).json(
      await solicitarEstudio(req.db!, req.auth!.tenantId!, {
        ...req.body,
        pacienteId: req.params.id,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/pacientes/:id/laboratorio");
  }
});

expedienteRouter.put("/laboratorio/:id/estado", soloMedico, async (req, res) => {
  try {
    await cambiarEstadoEstudio(req.db!, req.params.id, req.body?.estado);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /expediente/laboratorio/:id/estado");
  }
});

expedienteRouter.post("/laboratorio/:id/resultados", soloMedico, async (req, res) => {
  const b = req.body ?? {};
  try {
    if (!Array.isArray(b.resultados) || b.resultados.length === 0) {
      return res.status(400).json({ error: "No hay resultados que cargar." });
    }
    res.json(
      await cargarResultados(req.db!, req.auth!.tenantId!, req.params.id, b.resultados, {
        fechaMuestra: b.fechaMuestra,
        observaciones: b.observaciones,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/laboratorio/:id/resultados");
  }
});

/**
 * Cerrar un pendiente con su resultado (anexo 07-03, A6).
 *
 * Los archivos se suben aparte, por `POST /api/archivos` con
 * `estudioLabId`: el punto de subida del sistema es uno solo.
 */
expedienteRouter.post("/laboratorio/:id/resultado", soloMedico, async (req, res) => {
  try {
    await cerrarPendienteConResultado(req.db!, req.auth!.tenantId!, req.params.id, {
      fechaMuestra: req.body?.fechaMuestra ?? null,
      observaciones: req.body?.observaciones ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /expediente/laboratorio/:id/resultado");
  }
});

expedienteRouter.post("/laboratorio/:id/visto", soloMedico, async (req, res) => {
  try {
    await marcarEstudioVisto(req.db!, req.params.id, req.auth!.userId!);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /expediente/laboratorio/:id/visto");
  }
});

/** Los resultados que llegaron y nadie miró: el aviso al médico. */
expedienteRouter.get("/laboratorio/sin-ver", async (req, res) => {
  try {
    res.json({ estudios: await estudiosSinVer(req.db!) });
  } catch (err) {
    fallo(res, err, "GET /expediente/laboratorio/sin-ver");
  }
});

// =====================================================================
// GROOMING
// =====================================================================
expedienteRouter.get("/pacientes/:id/grooming", async (req, res) => {
  try {
    res.json({ grooming: await groomingDePaciente(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/grooming");
  }
});

expedienteRouter.post("/pacientes/:id/grooming", async (req, res) => {
  try {
    res.status(201).json(
      await registrarGrooming(req.db!, req.auth!.tenantId!, {
        ...req.body,
        pacienteId: req.params.id,
        groomerId: req.body?.groomerId ?? req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/pacientes/:id/grooming");
  }
});

expedienteRouter.get("/grooming/hallazgos", async (req, res) => {
  try {
    res.json({
      hallazgos: await hallazgosPendientes(
        req.db!,
        (req.query.paciente as string) || undefined
      ),
    });
  } catch (err) {
    fallo(res, err, "GET /expediente/grooming/hallazgos");
  }
});

expedienteRouter.post("/grooming/hallazgos/:id/atender", puedeGrooming, async (req, res) => {
  try {
    await atenderHallazgo(req.db!, req.params.id, req.auth!.userId!, req.body?.atencionId);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /expediente/grooming/hallazgos/:id/atender");
  }
});

// =====================================================================
// CONSENTIMIENTOS
// =====================================================================
expedienteRouter.get("/consentimientos/plantillas", async (req, res) => {
  try {
    res.json({ plantillas: await plantillas(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    fallo(res, err, "GET /expediente/consentimientos/plantillas");
  }
});

expedienteRouter.post("/consentimientos/plantillas", async (req, res) => {
  try {
    res.status(201).json(await guardarPlantilla(req.db!, req.auth!.tenantId!, req.body ?? {}));
  } catch (err) {
    fallo(res, err, "POST /expediente/consentimientos/plantillas");
  }
});

/** Siembra las cuatro plantillas base. Idempotente. */
expedienteRouter.post("/consentimientos/plantillas/base", async (req, res) => {
  try {
    res.json(await sembrarPlantillasBase(req.db!, req.auth!.tenantId!));
  } catch (err) {
    fallo(res, err, "POST /expediente/consentimientos/plantillas/base");
  }
});

expedienteRouter.get("/pacientes/:id/consentimientos", async (req, res) => {
  try {
    res.json({ consentimientos: await consentimientosDePaciente(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/consentimientos");
  }
});

/** El texto ya resuelto, para mostrarlo antes de firmar. */
expedienteRouter.get("/pacientes/:id/consentimientos/preparar", async (req, res) => {
  try {
    res.json(
      await prepararConsentimiento(req.db!, req.auth!.tenantId!, {
        plantillaId: String(req.query.plantilla ?? ""),
        pacienteId: req.params.id,
        procedimiento: (req.query.procedimiento as string) || undefined,
        medicoId: req.auth!.esMedico ? req.auth!.userId : undefined,
      })
    );
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/consentimientos/preparar");
  }
});

expedienteRouter.post("/pacientes/:id/consentimientos", async (req, res) => {
  try {
    const firmado = await firmarConsentimiento(
      req.db!,
      req.auth!.tenantId!,
      { ...req.body, pacienteId: req.params.id },
      {
        // LA EVIDENCIA SE TOMA DEL SERVIDOR, no del cuerpo: el
        // dispositivo y la IP los pone la solicitud, y el testigo es
        // quien está con la sesión abierta. Si vinieran en el cuerpo,
        // serían tres datos que el navegador puede inventar.
        relacion: req.body?.relacion,
        autorizadoPor: req.body?.autorizadoPor,
        dispositivo: req.get("user-agent") ?? null,
        ip: req.ip ?? null,
        testigoId: req.auth!.userId,
      }
    );

    // EL PDF SE LE MANDA AL CLIENTE, si se le puede escribir. No se
    // frena la firma si el envío no se puede hacer: el consentimiento
    // ya está firmado y el documento se puede imprimir.
    let envio: { enviado: boolean; motivo?: string } = { enviado: false };
    try {
      const c = await consentimiento(req.db!, firmado.id);
      const pac = await req.db!.query<{ propietario_id: string | null; nombre: string }>(
        `SELECT propietario_id, nombre FROM pacientes WHERE id = $1`,
        [req.params.id]
      );
      envio = await enviarConsentimientoAlCliente(req.db!, req.auth!.tenantId!, {
        consentimientoId: firmado.id,
        pacienteId: req.params.id,
        propietarioId: pac.rows[0]?.propietario_id ?? null,
        titulo: c.titulo,
        pacienteNombre: pac.rows[0]?.nombre ?? "",
      });
    } catch (err) {
      console.error("[consentimientos] no se pudo enviar el PDF al cliente", err);
      envio = { enviado: false, motivo: "No se pudo enviar el correo." };
    }

    res.status(201).json({ ...firmado, envio });
  } catch (err) {
    fallo(res, err, "POST /expediente/pacientes/:id/consentimientos");
  }
});

// EL PDF DEL CONSENTIMIENTO, con el texto, la firma, la evidencia y la
// huella. Se genera al vuelo: el documento es reproducible desde la
// fila, y guardar una copia sería un segundo original.
// --- IMÁGENES Y DOCUMENTOS (revisión del 2026-11-27) -------------

/** El catálogo de tipos de documento de la clínica. */
expedienteRouter.get("/tipos-documento", async (req, res) => {
  try {
    res.json({ tipos: await tiposDeDocumento(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    fallo(res, err, "GET /expediente/tipos-documento");
  }
});

/** La galería del paciente, con sus filtros y el origen de cada cosa. */
expedienteRouter.get("/pacientes/:id/documentos", async (req, res) => {
  try {
    res.json({
      documentos: await documentosDePaciente(req.db!, req.params.id, {
        tipo: (req.query.tipo as string) || undefined,
        desde: (req.query.desde as string) || undefined,
        hasta: (req.query.hasta as string) || undefined,
      }),
    });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/documentos");
  }
});

expedienteRouter.get("/consentimientos/:id/pdf", async (req, res) => {
  try {
    const c = await consentimiento(req.db!, req.params.id);
    const pdf = await consentimientoEnPdf(req.db!, req.auth!.tenantId!, c as never);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="consentimiento-${req.params.id.slice(0, 8)}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    fallo(res, err, "GET /expediente/consentimientos/:id/pdf");
  }
});

// FIRMA A DISTANCIA: se le manda el enlace al cliente.
expedienteRouter.post("/pacientes/:id/consentimientos/a-distancia", async (req, res) => {
  try {
    const r = await pedirFirmaADistancia(req.db!, req.auth!.tenantId!, {
      pacienteId: req.params.id,
      plantillaId: req.body?.plantillaId ?? null,
      atencionId: req.body?.atencionId ?? null,
      titulo: req.body?.titulo,
      texto: req.body?.texto,
      canal: req.body?.canal,
      solicitadoPor: req.auth!.userId,
    });
    // EL ENLACE NO SE DEVUELVE a la pantalla: el que tiene que abrirlo
    // es el cliente, por su canal. Devolverlo acá invitaría a que
    // alguien lo abra desde el mostrador y firme por él, que es
    // exactamente lo que la firma a distancia tiene que evitar.
    res.status(201).json({
      id: r.id,
      canal: r.canal,
      destino: `…${r.destino.slice(-4)}`,
      vence: r.vence,
    });
  } catch (err) {
    fallo(res, err, "POST /expediente/pacientes/:id/consentimientos/a-distancia");
  }
});

expedienteRouter.get("/consentimientos/:id", async (req, res) => {
  try {
    res.json({ consentimiento: await consentimiento(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/consentimientos/:id");
  }
});

// =====================================================================
// LA ATENCIÓN QUE GENERA CARGOS — bloque B
//
// Todo acá es `soloMedico`: registrar lo que pasó en una consulta y
// firmarlo es un acto clínico. La única lectura abierta a la
// administración es la cuenta viva, que la recepción necesita para
// decirle al cliente cuánto va a pagar.
// =====================================================================

expedienteRouter.post("/atenciones", soloMedico, async (req, res) => {
  try {
    const atencion = await abrirAtencion(req.db!, req.auth!.tenantId!, {
      ...req.body,
      medicoId: req.auth!.userId,
    });
    res.status(atencion.creada ? 201 : 200).json({ atencion });
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones");
  }
});

/**
 * ¿Hay una atención empezada de este paciente? Va ANTES de
 * `/atenciones/:id` por el orden de rutas de Express: con el orden al
 * revés, "plantillas" entraría como un id.
 */
expedienteRouter.get("/pacientes/:id/atencion-en-curso", async (req, res) => {
  try {
    const id = await atencionEnCurso(req.db!, req.params.id);
    res.json({ atencionId: id, detalle: id ? await atencionCompleta(req.db!, id) : null });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/atencion-en-curso");
  }
});

expedienteRouter.get("/atenciones/plantillas", async (req, res) => {
  try {
    const r = await req.db!.query(
      `SELECT id, tipo_consulta, nombre, sistemas, tenant_id IS NULL AS de_la_plataforma
         FROM exp_plantillas_atencion
        WHERE activo
        ORDER BY (tenant_id IS NOT NULL) DESC, nombre`
    );
    res.json({ plantillas: r.rows });
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/plantillas");
  }
});

expedienteRouter.get("/atenciones/:id", async (req, res) => {
  try {
    res.json(await atencionCompleta(req.db!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id");
  }
});

/**
 * Guardado automático del SOAP. La pantalla manda solo lo que cambió, y
 * esto no exige nada: una atención a medio escribir es el estado normal
 * de una consulta en curso.
 */
expedienteRouter.patch("/atenciones/:id", soloMedico, async (req, res) => {
  try {
    // `version` es opcional para no romper a nadie: el cliente que no
    // la manda escribe como antes. La pantalla de la atencion si la
    // manda (anexo 07-03, A4).
    const { version, ...campos } = (req.body ?? {}) as Record<string, unknown>;
    const r = await guardarSoap(
      req.db!,
      req.params.id,
      campos,
      typeof version === "number" ? version : undefined
    );
    res.json({ guardado: true, ...r });
  } catch (err) {
    if (err instanceof ConflictoDeVersionError) {
      // 409 CON LOS VALORES DEL SERVIDOR: el medico tiene que poder
      // comparar lo suyo con lo que llego, no solo enterarse de que
      // hubo un choque.
      return res.status(409).json({
        error: err.message,
        codigo: "CONFLICTO_DE_VERSION",
        versionActual: err.versionActual,
        valores: err.valores,
      });
    }
    fallo(res, err, "PATCH /expediente/atenciones/:id");
  }
});

// ---------------------------------------------------------------------
// EL LATIDO: quien tiene la atencion abierta (anexo 07-03, A4)
// ---------------------------------------------------------------------

/**
 * Tomar la atencion o renovar el latido.
 *
 * La pantalla lo llama al abrir y cada 30 s. Si contesta `mio: false`,
 * entra en modo lectura y dice de quien es.
 */
expedienteRouter.post("/atenciones/:id/latido", soloMedico, async (req, res) => {
  try {
    res.json(
      await tomarOLatir(req.db!, req.auth!.tenantId!, {
        documentoTipo: "atencion",
        documentoId: req.params.id,
        personaId: req.auth!.userId!,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/latido");
  }
});

/** Lo que se esta escribiendo y todavia no llego a la atencion. */
expedienteRouter.put("/atenciones/:id/borrador", soloMedico, async (req, res) => {
  try {
    await guardarBorrador(req.db!, req.auth!.tenantId!, {
      documentoTipo: "atencion",
      documentoId: req.params.id,
      personaId: req.auth!.userId!,
      contenido: (req.body?.contenido ?? {}) as Record<string, unknown>,
    });
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /expediente/atenciones/:id/borrador");
  }
});

/** Soltarla al salir. Si no se llama, el latido vence solo. */
expedienteRouter.delete("/atenciones/:id/latido", soloMedico, async (req, res) => {
  try {
    await liberar(req.db!, {
      documentoTipo: "atencion",
      documentoId: req.params.id,
      personaId: req.auth!.userId!,
    });
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "DELETE /expediente/atenciones/:id/latido");
  }
});

expedienteRouter.post("/atenciones/:id/plantilla", soloMedico, async (req, res) => {
  try {
    res.json(
      await aplicarPlantilla(
        req.db!,
        req.auth!.tenantId!,
        req.params.id,
        String(req.body.tipoConsulta ?? "")
      )
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/plantilla");
  }
});

expedienteRouter.put("/atenciones/:id/sistemas/:sistema", soloMedico, async (req, res) => {
  try {
    await marcarSistema(
      req.db!,
      req.auth!.tenantId!,
      req.params.id,
      decodeURIComponent(req.params.sistema),
      req.body.estado,
      req.body.nota
    );
    res.json({ guardado: true });
  } catch (err) {
    fallo(res, err, "PUT /expediente/atenciones/:id/sistemas/:sistema");
  }
});

expedienteRouter.post("/atenciones/:id/diagnosticos", soloMedico, async (req, res) => {
  try {
    res.status(201).json(
      await agregarDiagnostico(req.db!, req.auth!.tenantId!, {
        ...req.body,
        atencionId: req.params.id,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/diagnosticos");
  }
});

expedienteRouter.post("/atenciones/:id/items", soloMedico, async (req, res) => {
  try {
    res
      .status(201)
      .json(
        await agregarItem(
          req.db!,
          req.auth!.tenantId!,
          req.params.id,
          req.body,
          req.auth!.userId
        )
      );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/items");
  }
});

expedienteRouter.delete("/atenciones/:id/items/:itemId", soloMedico, async (req, res) => {
  try {
    await quitarItem(req.db!, req.params.id, req.params.itemId);
    res.json({ quitado: true });
  } catch (err) {
    fallo(res, err, "DELETE /expediente/atenciones/:id/items/:itemId");
  }
});

// =====================================================================
// LAS ACCIONES EXPLICITAS DE LA ATENCION — prompt 07c
//
// Una ruta por cada cosa que el medico hace, en vez de una sola puerta
// con una casilla escondida adentro. El cargo y el stock siguen saliendo
// por donde salian: lo que cambia es que ahora se puede NOMBRAR lo que
// se hizo.
// =====================================================================

/** Los catalogos clinicos de la clinica: vias, frecuencias, unidades de
 *  dosis, sistemas del examen. Los usa la receta y el examen fisico. */
expedienteRouter.get("/catalogos-clinicos", async (req, res) => {
  try {
    res.json(await todosLosCatalogos(req.db!));
  } catch (err) {
    fallo(res, err, "GET /expediente/catalogos-clinicos");
  }
});

/** Los productos que ofrece cada accion, ya filtrados por su tipo clinico. */
expedienteRouter.get("/catalogo-clinico", async (req, res) => {
  try {
    const tipo = req.query.tipo as TipoClinico | undefined;
    res.json({
      productos: await productosParaAtencion(req.db!, {
        tipoClinico: tipo,
        // La accion "Producto" muestra lo que NO tiene accion propia.
        excluir: tipo ? undefined : ["vacuna", "antiparasitario"],
        busqueda: (req.query.q as string) || undefined,
      }),
    });
  } catch (err) {
    fallo(res, err, "GET /expediente/catalogo-clinico");
  }
});

/** Cuando toca la proxima, segun el protocolo de la clinica. */
expedienteRouter.get("/proxima-sugerida", async (req, res) => {
  try {
    res.json(
      (await proximaSugerida(req.db!, {
        tipo: req.query.tipo as "vacunacion" | "desparasitacion",
        especie: (req.query.especie as string) || null,
        productoId: (req.query.productoId as string) || null,
        nombre: (req.query.nombre as string) || null,
      })) ?? { fecha: null, meses: null, origen: null }
    );
  } catch (err) {
    fallo(res, err, "GET /expediente/proxima-sugerida");
  }
});

expedienteRouter.get("/protocolos", async (req, res) => {
  try {
    res.json({ protocolos: await protocolos(req.db!) });
  } catch (err) {
    fallo(res, err, "GET /expediente/protocolos");
  }
});

/** El registro historico: una vacuna puesta antes o en otro lugar. */
expedienteRouter.post("/pacientes/:id/preventivo-historico", soloMedico, async (req, res) => {
  try {
    res.status(201).json(
      await registrarHistorico(
        req.db!,
        req.auth!.tenantId!,
        { ...req.body, pacienteId: req.params.id },
        req.auth!.userId!
      )
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/pacientes/:id/preventivo-historico");
  }
});

// --- La receta -------------------------------------------------------

expedienteRouter.get("/atenciones/:id/receta", async (req, res) => {
  try {
    res.json(await verReceta(req.db!, req.auth!.tenantId!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id/receta");
  }
});

expedienteRouter.post("/atenciones/:id/receta/lineas", puedeRecetar, async (req, res) => {
  try {
    res
      .status(201)
      .json(
        await agregarLinea(req.db!, req.auth!.tenantId!, req.params.id, req.body, req.auth!.userId)
      );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/receta/lineas");
  }
});

expedienteRouter.delete("/atenciones/:id/receta/lineas/:lineaId", puedeRecetar, async (req, res) => {
  try {
    await quitarLinea(req.db!, req.params.id, req.params.lineaId);
    res.json({ quitada: true });
  } catch (err) {
    fallo(res, err, "DELETE /expediente/atenciones/:id/receta/lineas/:lineaId");
  }
});

expedienteRouter.post("/atenciones/:id/receta/repetir", puedeRecetar, async (req, res) => {
  try {
    res.json(
      await repetirReceta(
        req.db!,
        req.auth!.tenantId!,
        req.params.id,
        req.body?.recetaId,
        req.auth!.userId
      )
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/receta/repetir");
  }
});

expedienteRouter.get("/pacientes/:id/recetas", async (req, res) => {
  try {
    res.json({
      recetas: await recetasAnteriores(
        req.db!,
        req.params.id,
        (req.query.excluirAtencion as string) || undefined
      ),
    });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/recetas");
  }
});

/** El PDF. Lo puede bajar cualquiera de la clinica: es el documento que
 *  se le entrega al propietario en el mostrador. */
expedienteRouter.get("/atenciones/:id/receta.pdf", async (req, res) => {
  try {
    const r = await recetaDeAtencionEnPdf(req.db!, req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${r.nombreArchivo}"`);
    res.send(r.buffer);
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id/receta.pdf");
  }
});

expedienteRouter.post("/atenciones/:id/receta/enviar", async (req, res) => {
  try {
    res.json(await enviarReceta(req.db!, req.auth!.tenantId!, req.params.id));
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/receta/enviar");
  }
});

// --- El estudio ------------------------------------------------------

expedienteRouter.post("/atenciones/:id/estudios", soloMedico, async (req, res) => {
  try {
    res
      .status(201)
      .json(
        await pedirEstudio(req.db!, req.auth!.tenantId!, req.params.id, req.body, req.auth!.userId!)
      );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/estudios");
  }
});

expedienteRouter.get("/atenciones/:id/estudios", async (req, res) => {
  try {
    res.json({ estudios: await estudiosDeAtencion(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id/estudios");
  }
});

/** Lo que va a pasar al cerrar. Se lee ANTES de confirmar. */
expedienteRouter.get("/atenciones/:id/resumen-cierre", async (req, res) => {
  try {
    res.json(await resumenDelCierre(req.db!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id/resumen-cierre");
  }
});

/** La cuenta viva: la recepción también la lee, así que no es soloMedico. */
expedienteRouter.get("/atenciones/:id/cuenta", async (req, res) => {
  try {
    res.json(await cuentaViva(req.db!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id/cuenta");
  }
});

/**
 * El aviso de alergia ANTES de confirmar la receta. Es una consulta, no
 * un freno: el médico puede tener una razón para recetar igual, pero no
 * puede no saberlo.
 */
expedienteRouter.get("/pacientes/:id/avisos-receta", async (req, res) => {
  try {
    const presentacionId = String(req.query.presentacionId ?? "");
    if (!presentacionId) {
      return res.status(400).json({ error: "Falta la presentación a recetar." });
    }
    res.json({ avisos: await avisosAlRecetar(req.db!, req.params.id, presentacionId) });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/avisos-receta");
  }
});


// =====================================================================
// EL EXAMEN QUE SE LEE Y LAS TENDENCIAS — anexo del 07, A1
// =====================================================================

/**
 * El examen en PDF, con la marca de la clínica (anexo 07-03, A1).
 *
 * No es soloMedico, igual que el PDF de la receta: lo imprime quien
 * atiende al cliente en el mostrador.
 */
expedienteRouter.get("/atenciones/:id/examen.pdf", async (req, res) => {
  try {
    const r = await examenEnPdf(req.db!, req.auth!.tenantId!, req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${r.nombreArchivo}"`);
    res.send(r.buffer);
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id/examen.pdf");
  }
});

/** El examen ordenado: primero lo anormal, después el resto. */
expedienteRouter.get("/atenciones/:id/examen", async (req, res) => {
  try {
    res.json(await resumenDelExamen(req.db!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /expediente/atenciones/:id/examen");
  }
});

/**
 * Peso, temperatura y condición corporal a lo largo de las visitas.
 *
 * No es soloMedico: la recepción ve la ficha, y el peso de un paciente
 * no es información que haya que esconderle a quien lo pesa.
 */
expedienteRouter.get("/pacientes/:id/tendencia-signos", async (req, res) => {
  try {
    res.json({ tendencias: await tendenciaDeSignos(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /expediente/pacientes/:id/tendencia-signos");
  }
});

// =====================================================================
// INGRESO, SALIDA Y ESTANCIA — anexo del 07, A2
// =====================================================================

/**
 * Quién está en la clínica ahora.
 *
 * NO es soloMedico, y es el punto: la pregunta la hace la recepción.
 */
expedienteRouter.get("/en-la-clinica", async (req, res) => {
  try {
    res.json({ pacientes: await enLaClinicaAhora(req.db!) });
  } catch (err) {
    fallo(res, err, "GET /expediente/en-la-clinica");
  }
});

/** Marcar la salida del paciente. La registra quien lo ve irse. */
expedienteRouter.post("/atenciones/:id/salida", async (req, res) => {
  try {
    res.json(await registrarSalida(req.db!, req.params.id, req.body?.cuando ?? null));
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/salida");
  }
});

/** Deshacerla: alguien la marcó y el paciente seguía adentro. */
expedienteRouter.delete("/atenciones/:id/salida", async (req, res) => {
  try {
    await deshacerSalida(req.db!, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "DELETE /expediente/atenciones/:id/salida");
  }
});

/** El paciente se queda: observación, preparación quirúrgica, grooming. */
expedienteRouter.put("/atenciones/:id/estancia", soloMedico, async (req, res) => {
  try {
    await marcarEstancia(req.db!, req.params.id, Boolean(req.body?.esEstancia), req.body?.motivo);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /expediente/atenciones/:id/estancia");
  }
});

/**
 * EL CIERRE. Una sola llamada, una sola transacción: o pasa todo o no
 * pasa nada. Si falta stock devuelve el error de inventario tal cual —el
 * médico necesita saber de qué producto se trata, no un «no se pudo
 * cerrar»—.
 */
expedienteRouter.post("/atenciones/:id/cerrar", puedeFirmar, async (req, res) => {
  try {
    res.json(
      await cerrarAtencion(req.db!, req.auth!.tenantId!, req.params.id, {
        ...req.body,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /expediente/atenciones/:id/cerrar");
  }
});
