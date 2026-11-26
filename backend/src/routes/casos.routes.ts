import { Router } from "express";
import { registrarInteraccion } from "../crm/interacciones";
import { PoolClient } from "pg";
import * as path from "path";
import { adaptarInformeParaTutor } from "../adaptarInformeTutor";
import { conAlcanceTenant } from "../alcanceTenant";
import { obtenerSintesisParaDashboard, obtenerSintesisParaInforme } from "../generarSintesis";
import { estadoSintesis, proyectarDashboard, proyectarInforme } from "../sintesisClinica";
import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "../almacenamiento";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  Footer,
  PageNumber,
  BorderStyle,
} from "docx";
import { requerirAnthropic } from "../anthropic";
import { authenticate, withTenantClient } from "../middleware/auth";
import { registrarUsoApi, verificarAntesDeGenerar, mensajeRechazoGeneracion } from "../tarifas";
import {
  verificarInformeCortesiaPermitido,
  mensajeRechazoCortesia,
  obtenerEstadoSuscripcion,
  suscripcionBloqueaGeneracionIa,
} from "../purga";
import { construirBloqueContextoCaso } from "../contextoCaso";
import { dimensionesImagen, escalarDentroDeCaja } from "../lib/imagenLogo";
import { CACHE_PREFIJO_COMPARTIDO, HERRAMIENTAS_AGENTE } from "../herramientasAgente";
import { construirMensajesParaModelo } from "../archivosDelCaso";
import { calcularEdadEfectiva } from "../edadPaciente";
import { avisoActivo, emitirNotificacion } from "../notificaciones";
import { construirBloqueRazaDocumento, NOMBRE_DOCUMENTO_PREDISPOSICIONES } from "../razaDocumento";
import { asignarNumeroExpediente } from "../expediente";
import { registrarResultadoAnthropic, registrarExitoAnthropic } from "../proveedorIaEstado";
import {
  validarCerrarCasoInput,
  ejecutarCierreCaso,
  validarReabrirCasoInput,
  ejecutarReaperturaCaso,
} from "../cierreCaso";
import { resolverFechaCorte } from "../casosSinActividad";

export const casosRouter = Router();

casosRouter.use(authenticate, withTenantClient);

casosRouter.use((req, res, next) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }
  next();
});

// Las funciones de contexto del agente se movieron a contextoAgente.ts
// para romper el ciclo de importación con generarSintesis.ts (ver la
// cabecera de ese archivo). Se re-exportan acá para no tocar a los nueve
// módulos y scripts que ya las importaban desde esta ruta.
import {
  obtenerDocumentosParaContexto,
  construirBloqueDocumentos,
  obtenerRecetasEmitidasParaContexto,
  construirBloquePrescripciones,
  insertarBloquePrescripciones,
} from "../contextoAgente";
// Se importan (este archivo las sigue usando) y se re-exportan (los nueve
// importadores que ya las traian de aca siguen funcionando sin cambios).
export {
  obtenerDocumentosParaContexto,
  construirBloqueDocumentos,
  obtenerRecetasEmitidasParaContexto,
  construirBloquePrescripciones,
  insertarBloquePrescripciones,
};


// ---------------------------------------------------------------------
// POST /api/casos
// Crea un caso nuevo desde el wizard de "Nuevo caso". A diferencia del
// POST /api/workspace/casos original (que sigue existiendo, sin tocar),
// este además resuelve y persiste medico_agente_id — el agente_id sigue
// viniendo del body (es el contexto en el que el médico está trabajando,
// tomado de la URL en el frontend; no hay estado de sesión server-side
// que lo trackee) pero acá se valida contra medico_agente en vez de
// insertarlo a ciegas.
//
// NOTA: el prompt de esta fase pedía estado inicial 'abierto', pero el
// CHECK de casos.estado solo admite 'triage' | 'en_curso' | 'completado'
// — 'triage' es el equivalente ya usado en todo el resto de la app para
// "caso recién creado, todavía sin investigar", así que se usa ese valor
// en vez de agregar 'abierto' al CHECK constraint.
// ---------------------------------------------------------------------
// prompt: vincular caso↔cita para el reporte de atenciones — citaId
// opcional, viene del wizard "Nuevo Caso" cuando el médico elige una cita
// de hoy ya agendada para vincular. El vínculo se hace acá, no en un
// segundo request aparte, para que quede atómico con la creación del
// caso (misma transacción implícita de req.db). Nunca falla la creación
// del caso si el vínculo no prende (condición de carrera poco probable,
// p.ej. la cita se vinculó a otra cosa entre que el wizard la mostró y
// el submit) — se informa citaVinculada: false en la respuesta.
casosRouter.post("/", async (req, res) => {
  const { pacienteId, agenteId, motivoConsulta, citaId } = req.body as {
    pacienteId?: string;
    agenteId?: string;
    motivoConsulta?: string;
    citaId?: string;
  };

  if (!pacienteId || !agenteId || !motivoConsulta || !motivoConsulta.trim()) {
    return res.status(400).json({ error: "Faltan pacienteId, agenteId o motivoConsulta." });
  }

  try {
    // Flujo de suscripción C — durante la ventana de purga (o ya
    // finalizada) no se pueden crear casos nuevos, aunque sí se puede
    // seguir consultando y exportando los existentes.
    const suscripcionEstadoResult = await req.db!.query(
      `SELECT s.estado FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id WHERE t.id = $1`,
      [req.auth!.tenantId]
    );
    const estadoSuscripcion = suscripcionEstadoResult.rows[0]?.estado;
    if (estadoSuscripcion === "ventana_purga" || estadoSuscripcion === "finalizada") {
      return res.status(402).json({
        error: "No se pueden crear casos nuevos — tu clínica está en período de cierre o sin suscripción activa.",
        motivo: "fuera_de_ventana",
      });
    }

    // Flujo de suscripción A — un agente deshabilitado para el tenant
    // (tenant_agentes) no puede recibir casos nuevos, sin importar el
    // acceso puntual del médico (medico_agente, chequeado abajo). No
    // existía este chequeo acá: medico_agente.habilitado por sí solo no
    // reflejaba si la clínica sigue teniendo el agente contratado.
    const tenantAgenteResult = await req.db!.query(
      `SELECT estado FROM tenant_agentes WHERE tenant_id = $1 AND agente_id = $2`,
      [req.auth!.tenantId, agenteId]
    );
    if (tenantAgenteResult.rows[0]?.estado !== "habilitado") {
      return res.status(403).json({ error: "Este agente no está habilitado para tu clínica." });
    }

    const medicoAgenteResult = await req.db!.query(
      `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2 AND habilitado = true`,
      [req.auth!.userId, agenteId]
    );
    if (medicoAgenteResult.rows.length === 0) {
      return res.status(403).json({ error: "No tenés acceso a este agente." });
    }
    const medicoAgenteId = medicoAgenteResult.rows[0].id;

    // Asignación atómica dentro de la misma transacción que el INSERT
    // del caso — ver expediente.ts. Si algo más abajo en este mismo
    // handler falla y la transacción hace ROLLBACK, el número no queda
    // consumido.
    const numeroExpediente = await asignarNumeroExpediente(req.db!, req.auth!.tenantId!);

    const casoResult = await req.db!.query(
      `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, medico_agente_id, motivo, estado, severidad, numero_expediente)
       VALUES ($1, $2, $3, $4, $5, $6, 'triage', 'estable', $7)
       RETURNING id, motivo, estado, severidad, confianza_diagnostica, creado_en, paciente_id, numero_expediente`,
      [req.auth!.tenantId, pacienteId, agenteId, req.auth!.userId, medicoAgenteId, motivoConsulta.trim(), numeroExpediente]
    );
    const caso = casoResult.rows[0];

    // CRM (prompt 03): el caso de Vetline Ai en la linea de tiempo del
    // paciente. El DETALLE es clinico y solo lo ve quien puede; el
    // evento lo ve todo el personal.
    await registrarInteraccion(req.db!, {
      tenantId: req.auth!.tenantId!,
      tipo: "caso_abierto",
      pacienteId: caso.paciente_id,
      ocurridoEn: caso.creado_en,
      origenTabla: "casos",
      origenId: caso.id,
      personaId: req.auth!.userId,
      resumen: caso.motivo?.slice(0, 120) ?? null,
    });

    const pacienteResult = await req.db!.query(
      `SELECT p.nombre, p.especie, r.nombre AS raza
       FROM pacientes p
       LEFT JOIN razas r ON r.id = p.raza_id
       WHERE p.id = $1`,
      [pacienteId]
    );
    if (pacienteResult.rows.length === 0) {
      return res.status(404).json({ error: "Paciente no encontrado." });
    }

    let citaVinculada: boolean | undefined;
    if (citaId) {
      const vinculoResult = await req.db!.query(
        `UPDATE citas SET caso_id = $1, actualizado_en = now()
         WHERE id = $2 AND tenant_id = $3 AND caso_id IS NULL
         RETURNING id`,
        [caso.id, citaId, req.auth!.tenantId]
      );
      citaVinculada = vinculoResult.rows.length > 0;
    }

    res.status(201).json({
      caso: {
        ...caso,
        paciente_nombre: pacienteResult.rows[0].nombre,
        especie: pacienteResult.rows[0].especie,
        raza: pacienteResult.rows[0].raza,
      },
      ...(citaVinculada !== undefined ? { citaVinculada } : {}),
    });
  } catch (err) {
    console.error("POST /casos", err);
    res.status(500).json({ error: "Error al crear el caso." });
  }
});

// ---------------------------------------------------------------------
// GET /api/casos/sin-actividad
// prompt_code_cierre_caso.md, Paso 4 — casos abiertos (no completados) del
// médico, filtrados por tiempo sin actividad. "Sin actividad" es
// literalmente actualizado_en, que ya refleja mensaje/adjunto/informe/
// receta (ver los puntos de escritura tocados en el Paso 2).
// ---------------------------------------------------------------------
casosRouter.get("/sin-actividad", async (req, res) => {
  const resolucion = resolverFechaCorte(req.query as Record<string, unknown>);
  if (!resolucion.valido) {
    return res.status(400).json({ error: resolucion.error });
  }

  try {
    const result = await req.db!.query(
      `SELECT c.id, c.numero_expediente, c.motivo, c.agente_id, a.nombre AS agente_nombre,
              p.nombre AS paciente_nombre, per.nombre AS medico_nombre,
              c.creado_en, c.actualizado_en
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN agentes a ON a.id = c.agente_id
       JOIN personas per ON per.id = c.medico_id
       WHERE c.medico_id = $1 AND c.estado <> 'completado' AND c.actualizado_en <= $2
       ORDER BY c.actualizado_en ASC`,
      [req.auth!.userId, resolucion.fechaCorte]
    );
    res.json({ casos: result.rows });
  } catch (err) {
    console.error("GET /casos/sin-actividad", err);
    res.status(500).json({ error: "Error al obtener los casos sin actividad." });
  }
});

export interface ItemRecetaInput {
  medicamentoId: string;
  dosis: string;
  frecuencia: string;
  duracion: string;
  viaAdministracion: string;
  observaciones?: string;
}

// Núcleo compartido de creación de receta — usado por POST
// /casos/:id/recetas (abajo) y por POST /atenciones/:id/recetas
// (prompt_code_registro_atencion.md, Paso 3: "una receta es un acto del
// médico sobre un paciente; el caso es opcional"). casoId es nullable a
// propósito: una receta desde una atención sin caso no lo lleva.
//
// Comparten el INSERT, pero NO son la misma cosa clínicamente — a
// propósito no se unifican los dos caminos de entrada (respuesta del
// usuario a este prompt):
//   - POST /casos/:id/recetas → un AJUSTE SIN VISITA. Llegó un resultado
//     de laboratorio, el propietario contó algo por teléfono, se
//     modifica una dosis — el paciente no está presente.
//   - POST /atenciones/:id/recetas → lo que se PRESCRIBIÓ CON EL
//     PACIENTE PRESENTE, en la misma visita que generó nota/peso/vacuna.
// atencion_id es la señal de cuál fue: no nulo = con visita. Esto
// determina qué badge muestra RecetaPanel.tsx y el historial
// farmacológico — si no se distingue, el médico usa la que tenga más
// cerca y el registro queda inconsistente (razón dada por el usuario).
export async function crearRecetaConItems(
  db: PoolClient,
  params: {
    tenantId: string;
    casoId: string | null;
    atencionId: string | null;
    pacienteId: string;
    medicoId: string;
    instruccionesGenerales?: string | null;
    instruccionesPropietario?: string | null;
    items: ItemRecetaInput[];
  }
) {
  const recetaResult = await db.query(
    `INSERT INTO recetas
       (tenant_id, caso_id, atencion_id, paciente_id, medico_id, instrucciones_generales, instrucciones_propietario)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.tenantId,
      params.casoId,
      params.atencionId,
      params.pacienteId,
      params.medicoId,
      params.instruccionesGenerales ?? null,
      params.instruccionesPropietario ?? null,
    ]
  );
  const receta = recetaResult.rows[0];

  let orden = 0;
  for (const item of params.items) {
    await db.query(
      `INSERT INTO receta_items (receta_id, medicamento_id, dosis, frecuencia, duracion, via_administracion, observaciones, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        receta.id,
        item.medicamentoId,
        item.dosis,
        item.frecuencia,
        item.duracion,
        item.viaAdministracion,
        item.observaciones ?? null,
        orden++,
      ]
    );
  }

  const itemsResult = await db.query(
    `SELECT ri.*, m.nombre AS medicamento_nombre, m.presentacion, m.concentracion
     FROM receta_items ri
     JOIN medicamentos m ON m.id = ri.medicamento_id
     WHERE ri.receta_id = $1
     ORDER BY ri.orden ASC`,
    [receta.id]
  );
  return { receta, items: itemsResult.rows };
}

// ---------------------------------------------------------------------
// POST /api/casos/:id/recetas
// Crea una receta en estado 'borrador' — módulo transversal a cualquier
// agente, ver recetas.routes.ts. Vive acá (no en ese archivo) solo
// porque el path cuelga de /api/casos, igual que /dashboard/actualizar
// y /informe/generar.
// ---------------------------------------------------------------------
casosRouter.post("/:id/recetas", async (req, res) => {
  const { instruccionesGenerales, instruccionesPropietario, items } = req.body as {
    instruccionesGenerales?: string;
    instruccionesPropietario?: string;
    items?: ItemRecetaInput[];
  };

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "La receta necesita al menos un medicamento." });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT id, paciente_id, estado FROM casos WHERE id = $1 AND medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    const caso = casoResult.rows[0];
    // Un caso cerrado es de solo lectura — no se le agrega información ni
    // se le pide análisis (prompt_code_cierre_caso.md, Paso 2). Prescribir
    // sobre un caso ya cerrado es exactamente eso: información nueva.
    if (caso.estado === "completado") {
      return res.status(409).json({ error: "El caso está cerrado — no se pueden agregar recetas nuevas." });
    }

    const { receta, items: itemsGuardados } = await crearRecetaConItems(req.db!, {
      tenantId: req.auth!.tenantId!,
      casoId: req.params.id,
      atencionId: null,
      pacienteId: caso.paciente_id,
      medicoId: req.auth!.userId,
      instruccionesGenerales,
      instruccionesPropietario,
      items,
    });

    // prompt_code_cierre_caso.md, Paso 2, punto 2 — todos los puntos de
    // actividad tocan actualizado_en, no solo informacion/mensajes.
    await req.db!.query(`UPDATE casos SET actualizado_en = now() WHERE id = $1`, [req.params.id]);

    res.status(201).json({ receta, items: itemsGuardados });
  } catch (err) {
    console.error("POST /casos/:id/recetas", err);
    res.status(500).json({ error: "Error al crear la receta." });
  }
});

// =====================================================================
// DASHBOARD REAL (cualquier agente con system_prompt) — POST
// /api/casos/:id/dashboard/actualizar
//
// MODELO_GCIS se repite acá y en workspace.routes.ts/recetas.routes.ts a
// propósito (solo el identificador del modelo, no hay más para duplicar:
// el precio se resuelve en tarifas_modelo vía backend/src/tarifas.ts,
// motor de crédito bloque 1 — antes acá había además 4 constantes de
// precio y una copia de registrarUsoApi(), ya consolidadas ahí).
// =====================================================================

const MODELO_GCIS = "claude-sonnet-4-6";

// Compuerta antes de gastar una llamada real: sin esto, no tiene sentido
// pedirle un Dashboard al agente — no hay nada real que resumir. Umbral de
// mensajes ajustable acá mismo mientras probamos con casos reales; los
// campos obligatorios (especie/raza/motivo) están hardcodeados abajo
// porque son requisitos estructurales, no un número a afinar.
const DASHBOARD_MENSAJES_MINIMOS = 2;





// Objeto con la forma completa del schema (todas las claves raíz
// requeridas presentes, todo en null salvo meta) — tanto para la
// respuesta de la compuerta del backend como para cuando el modelo
// mismo decide, ya adentro, que no hay datos suficientes (Fase D,
// regla 4: si el modelo devuelve "sin_datos" pese a haber pasado la
// compuerta, se respeta tal cual).
function dashboardSinDatos(casoId: string) {
  return {
    meta: { estado_generacion: "sin_datos" as const, caso_id: casoId, generado_en: new Date().toISOString() },
    executive_summary: null,
    clinical_state: null,
    clinical_confidence: null,
    active_problems: null,
    alertas: null,
    trends: null,
    differential_diagnosis: null,
    knowledge_match: null,
    clinical_reasoning_journal: null,
    referral_recommendation: null,
  };
}


// AD-BRAND-01 — Decisión de producto (no reabrir): todos los agentes
// clínicos de VetPlatform (GCIS, ICIS, y cualquiera que se agregue
// después) usan el mismo logo institucional de la clínica en los
// documentos que generan (tenants.logo_url, subido en Datos de la
// Clínica y servido desde uploads/logos/) — no hay ni habrá un isotipo
// propio por agente. Aplica por igual al export HTML del Dashboard
// (frontend/src/lib/exportarDashboardHtml.tsx), al Informe
// (POST /:id/informe/generar más abajo) y a Recetas
// (recetas.routes.ts). El "isotipo propio de ICIS" que figura como
// pendiente en el índice del ICIS Operational Manual
// (documentos_conocimiento) ya no aplica — queda descartado por esta
// decisión, no es algo por resolver.
//
// ---------------------------------------------------------------------
// POST /api/casos/:id/dashboard/actualizar
//
// Agentes sin system_prompt configurado: stub sin cambios — igual que
// antes. Cualquier agente CON system_prompt (GCIS, ICIS o futuros):
// generación real vía tool use forzado (generar_dashboard), con la misma
// compuerta de datos mínimos que evita gastar una llamada real en casos
// sin sustancia. AD-DASH-01: el resultado nunca se persiste — se
// recalcula siempre que se pide.
// ---------------------------------------------------------------------
casosRouter.post("/:id/dashboard/actualizar", async (req, res) => {
  try {
    const casoResult = await req.db!.query(
      `SELECT c.id, c.agente_id, c.severidad, c.confianza_diagnostica, c.estado, c.motivo,
              c.dashboard_cache,
              p.nombre AS paciente_nombre, p.especie, r.nombre AS raza,
              a.system_prompt
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       LEFT JOIN razas r ON r.id = p.raza_id
       JOIN agentes a ON a.id = c.agente_id
       WHERE c.id = $1 AND c.medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }

    // Un caso cerrado es de solo lectura — regenerar el Dashboard es
    // pedirle un análisis nuevo al agente, exactamente lo que
    // prompt_code_cierre_caso.md excluye. El dashboard_cache ya generado
    // sigue visible vía GET /:id/dashboard, solo se corta acá la
    // generación de uno nuevo.
    if (casoResult.rows[0].estado === "completado") {
      return res.status(409).json({ error: "El caso está cerrado — no se puede regenerar el Dashboard." });
    }

    // Pantallas faltantes, Prompt B, Paso 2 — generar/regenerar el
    // Dashboard es una operación con IA, se bloquea igual que la creación
    // de casos y el chat. AD-DASH-01 dice que el resultado nunca se
    // persiste, así que durante ventana_purga el médico sigue viendo el
    // último dashboard_cache que haya quedado, solo no puede pedir uno
    // nuevo.
    const estadoSuscripcion = await obtenerEstadoSuscripcion(req.db!, req.auth!.tenantId!);
    if (suscripcionBloqueaGeneracionIa(estadoSuscripcion)) {
      return res.status(402).json({
        error:
          "Tu clínica está en período de cierre o sin suscripción activa — no se pueden generar dashboards nuevos. Podés seguir consultando el historial y exportar los datos.",
        motivo: "fuera_de_ventana",
      });
    }

    const caso = casoResult.rows[0];
    // dashboard_cache NULL antes de esta llamada = todavía no se generó
    // ningún Dashboard para este caso -> primera generación, cuenta como
    // consumo clínico. Con un valor previo, esta llamada lo está
    // reemplazando -> regeneración. Es la única señal que ya existe en el
    // esquema para esa distinción; se lee ACÁ, antes de llamar a Claude,
    // porque más abajo esta misma fila se sobreescribe con el resultado
    // nuevo.
    //
    // Se reemplaza por la vigencia de la síntesis (y por la categoría
    // `regeneracion_forzada`, migración 083) recién cuando esta ruta pase a
    // proyectar desde la síntesis. Cambiarla antes haría que todo cayera en
    // `clinico` sin que nada falle.
    // ¿Había una síntesis VIGENTE antes de esta llamada?
    //
    // Reemplaza a `dashboard_cache === null`, que decía "es la segunda vez
    // o más que se abre el dashboard". Esa señal desaparece al proyectar
    // desde la síntesis, y además dejó de describir algo real: lo que
    // cuesta plata no es volver a abrir, es rehacer el razonamiento.
    //
    // Se lee ACÁ, antes de generar, porque generar la sobreescribe.
    // Categoría NUEVA (`regeneracion_forzada`, migración 083) en vez de
    // reinterpretar `regeneracion`: una serie que cambia de significado sin
    // marca en el dato produce conclusiones falsas cuando ya nadie recuerda
    // el cambio.
    const habiaSintesisVigente = (await estadoSintesis(req.db!, req.params.id)).vigente;

    // -----------------------------------------------------------------
    // ICIS (sin system_prompt) — stub sin cambios.
    // -----------------------------------------------------------------
    if (!caso.system_prompt) {
      const derivacionResult = await req.db!.query(
        `SELECT especialidad_sugerida, prioridad, motivo
         FROM derivaciones WHERE caso_id = $1 ORDER BY creado_en DESC LIMIT 1`,
        [req.params.id]
      );

      const { todos: documentosContexto } = await obtenerDocumentosParaContexto(
        req.db!,
        caso.agente_id,
        req.auth!.tenantId!
      );

      await new Promise((resolve) => setTimeout(resolve, 800));

      return res.json({
        dashboard: {
          casoId: caso.id,
          pacienteNombre: caso.paciente_nombre,
          severidad: caso.severidad,
          confianzaDiagnostica: caso.confianza_diagnostica,
          derivacion: derivacionResult.rows[0] ?? null,
          ultimaActualizacion: new Date().toISOString(),
          documentosContexto,
        },
      });
    }

    // -----------------------------------------------------------------
    // Compuerta de datos mínimos antes de gastar una llamada real.
    // -----------------------------------------------------------------
    const mensajesCountResult = await req.db!.query(
      `SELECT COUNT(*) FROM mensajes WHERE caso_id = $1`,
      [req.params.id]
    );
    const cantidadMensajes = Number(mensajesCountResult.rows[0].count);
    const tieneCamposMinimos = Boolean(caso.especie) && Boolean(caso.raza) && Boolean(caso.motivo?.trim());

    if (!tieneCamposMinimos || cantidadMensajes < DASHBOARD_MENSAJES_MINIMOS) {
      return res.json({ dashboard: dashboardSinDatos(req.params.id) });
    }

    // Motor de crédito, bloque 3 — verificación previa a la generación.
    // Va acá, después de la compuerta de datos mínimos: si el caso no
    // tiene sustancia todavía, no tiene sentido gastar ni siquiera esta
    // consulta contra el estado de la suscripción.
    const verificacionDashboard = await verificarAntesDeGenerar(req.db!, {
      tenantId: req.auth!.tenantId!,
      agenteId: caso.agente_id,
      tipoOperacion: "dashboard",
      disparadoPor: "usuario",
    });
    if (!verificacionDashboard.permitido) {
      return res.status(402).json({
        error: mensajeRechazoGeneracion(verificacionDashboard.motivo!),
        motivo: verificacionDashboard.motivo,
      });
    }

    // Todo lo que esta ruta le pide a la base ya está leído. Se suelta la
    // transacción ANTES de la síntesis, que es la llamada larga.
    //
    // El armado del contexto (prompt cacheado, documentos, historial,
    // adjuntos, prescripciones) ya NO se hace acá: lo hace generarSintesis
    // con exactamente el mismo material. Tenerlo duplicado en dos lugares
    // era lo que permitía que el dashboard y el informe razonaran distinto
    // sobre el mismo paciente.
    await req.cerrarTransaccion!();

    // -----------------------------------------------------------------
    // La síntesis: fuente única del dashboard y del informe.
    //
    // `forzar: true` porque este endpoint ES el pedido explícito de
    // actualizar del médico. Devolverle lo que ya tenía se leería como que
    // el sistema ignoró su pedido. Que cueste está bien mientras sea
    // explícito — y ahora además queda atribuido. Abrir el dashboard (GET)
    // sigue sin generar nada.
    // -----------------------------------------------------------------
    let resultado;
    try {
      resultado = await obtenerSintesisParaDashboard(req.auth!.tenantId!, req.params.id, { forzar: true });
      await registrarExitoAnthropic();
    } catch (err) {
      console.error("Error al generar la síntesis para el Dashboard", err);
      await registrarResultadoAnthropic(err);
      return res.status(502).json({ error: "No se pudo generar el Dashboard en este momento." });
    }

    // Proyección pura: no razona, no completa, no interpreta. Es toda la
    // garantía de que el dashboard y el informe no puedan contradecirse.
    const dashboardGenerado = proyectarDashboard(resultado.sintesis, req.params.id);

    // Segunda transacción, corta: el consumo y el Dashboard persistido van
    // juntos o no va ninguno. Si el consumo se registrara aparte y fallara,
    // quedaría un Dashboard generado y no cobrado (o al revés).
    await conAlcanceTenant(req.auth!.tenantId!, async (db) => {
      const medicoAgenteResult = await db.query(
        `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2`,
        [req.auth!.userId, caso.agente_id]
      );
      const medicoAgenteId = medicoAgenteResult.rows[0]?.id ?? null;

      // Una fila de uso_api POR CADA llamada al modelo, no una por request:
      // la síntesis puede encadenar dos fases y cobrar solo la última
      // regalaría la otra. Lista vacía = se reusó una síntesis vigente y no
      // hay nada que cobrar (no puede pasar acá, que va con forzar, pero la
      // condición se respeta igual y no se inventa consumo).
      for (const usage of resultado.usosDelModelo) {
        await registrarUsoApi(db, {
          tenantId: req.auth!.tenantId!,
          casoId: req.params.id,
          medicoAgenteId,
          personaId: req.auth!.userId,
          modelo: MODELO_GCIS,
          tokensEntrada: usage.input_tokens,
          tokensSalida: usage.output_tokens,
          tokensCacheEscritura: usage.cache_creation_input_tokens ?? 0,
          tokensCacheLectura: usage.cache_read_input_tokens ?? 0,
          // Rehacer una síntesis que YA estaba vigente es lo que el médico
          // eligió pagar; generarla por primera vez, o porque el caso
          // avanzó, es consumo clínico normal.
          tipoConsumo: habiaSintesisVigente ? "regeneracion_forzada" : "clinico",
          disparadoPor: "usuario",
        });
      }

      // Persiste como cache solo si realmente se generó — un "sin_datos"
      // devuelto por el modelo pese a pasar la compuerta, o cualquier falla
      // previa, no debe pisar un Dashboard bueno que ya existiera (ver
      // prompt_dashboard_persistencia.md Fase B.1).
      // Se sigue escribiendo dashboard_cache durante la transición: hay un
      // TERCER consumidor además de las dos vistas —el job de seguimiento
      // faltante— y la columna se retira en una migración aparte, cuando
      // todos hayan migrado. Es lo que hace reversible este cambio.
      //
      // La guarda pasa de "== generado" a "!= sin_datos": la síntesis puede
      // no traer `estado_generacion`, y exigirlo dejaría de persistir sin
      // que nada falle. Se conserva la intención original — no pisar un
      // dashboard bueno con un "sin_datos".
      if (dashboardGenerado.meta?.estado_generacion !== "sin_datos") {
        await db.query(
          `UPDATE casos SET dashboard_cache = $1, dashboard_generado_en = $2 WHERE id = $3`,
          [JSON.stringify(dashboardGenerado), dashboardGenerado.meta.generado_en, req.params.id]
        );
      }
    });

    res.json({ dashboard: dashboardGenerado });
  } catch (err) {
    console.error("POST /casos/:id/dashboard/actualizar", err);
    res.status(500).json({ error: "Error al actualizar el dashboard." });
  }
});

// ---------------------------------------------------------------------
// GET /api/casos/:id/dashboard
//
// Lectura pura del cache (ver migración 015) — nunca llama a Claude, solo
// Postgres. dashboard_cache en null es un estado válido ("todavía no se
// generó"), no un error: devuelve { dashboard: null, generado_en: null }
// con 200. El control de permisos (rol médico + dueño del caso) es el
// mismo que ya usa POST /:id/dashboard/actualizar, vía el mismo WHERE.
//
// hayInformacionPosterior (prompt_code_dashboards_informes, Paso 2): solo
// una indicación para que el médico decida si vale regenerar, nunca un
// bloqueo — true si hay algún mensaje (consulta, información agregada o
// respuesta del agente, cualquiera) posterior a dashboard_generado_en.
// Si el dashboard todavía no se generó, no aplica (false).
// ---------------------------------------------------------------------
casosRouter.get("/:id/dashboard", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT c.dashboard_cache, c.dashboard_generado_en,
              c.dashboard_generado_en IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM mensajes m
                  WHERE m.caso_id = c.id AND m.creado_en > c.dashboard_generado_en
                ) AS hay_informacion_posterior
       FROM casos c WHERE c.id = $1 AND c.medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }

    const fila = result.rows[0];

    // `sintesisAlDia` existe para que el botón de actualizar pueda decirlo
    // ANTES de que lo aprieten: rehacer cuesta plata, y sin este aviso la
    // única forma de enterarse de que no hacía falta es la factura.
    //
    // Es la huella, no una comparación de fechas: `hayInformacionPosterior`
    // solo mira si llegaron MENSAJES después de generar, y el material de
    // un caso también cambia con un adjunto, una receta emitida o un dato
    // del paciente corregido. Se conserva ese campo porque el frontend
    // todavía lo usa, pero el bueno es este.
    //
    // Este GET sigue sin generar nada: abrir un caso no puede costar plata.
    // Un médico que revisa cinco casos por la mañana gastaría cinco veces
    // sin haber pedido nada, y sin saberlo — mirar algo no se siente como
    // una acción que consuma.
    const sintesisAlDia = (await estadoSintesis(req.db!, req.params.id)).vigente;

    res.json({
      dashboard: fila.dashboard_cache ?? null,
      generado_en: fila.dashboard_generado_en ?? null,
      hayInformacionPosterior: fila.hay_informacion_posterior,
      sintesisAlDia,
    });
  } catch (err) {
    console.error("GET /casos/:id/dashboard", err);
    res.status(500).json({ error: "Error al obtener el dashboard." });
  }
});

// =====================================================================
// CRONOLOGÍA DEL CASO — prompt_code_cronologia_seguimiento, Paso 3.
//
// Lista fiel de lo que le pasó al paciente dentro de este caso, en orden
// cronológico: apertura, cada consulta de seguimiento, estudios
// adjuntados, informes generados, recetas EMITIDAS (nunca borradores) y
// cuidados preventivos del paciente desde que se abrió el caso.
//
// A propósito NO incluye las respuestas del agente (tipo='respuesta') —
// son razonamiento sobre lo ocurrido, no eventos clínicos; mezclarlas
// reconstruiría la conversación, que es justo lo que esta vista evita. Y
// a propósito NO genera resúmenes con IA: el contenido de cada consulta
// de seguimiento es el texto tal cual lo escribió el médico, sin tocar
// (el recorte visual es cosa del frontend).
//
// "Cuidados preventivos... en ese período" se acota por paciente_id +
// creado_en >= la apertura del caso — no hay una fecha de cierre
// explícita en `casos`, así que un caso abierto sigue sumando cuidados
// nuevos a su cronología mientras siga así (comportamiento esperado: la
// cronología de un caso en curso no es un snapshot fijo).
// ---------------------------------------------------------------------
casosRouter.get("/:id/cronologia", async (req, res) => {
  try {
    const casoResult = await req.db!.query(
      `SELECT id, paciente_id, motivo, creado_en FROM casos WHERE id = $1 AND medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    const caso = casoResult.rows[0];

    const [consultas, estudios, informes, recetas, cuidados, atenciones] = await Promise.all([
      req.db!.query(
        `SELECT m.id, m.contenido, m.creado_en, per.nombre AS medico_nombre
         FROM mensajes m
         LEFT JOIN personas per ON per.id = m.autor_persona_id
         WHERE m.caso_id = $1 AND m.tipo = 'informacion'
         ORDER BY m.creado_en`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT id, nombre_archivo, tipo, creado_en FROM archivos WHERE caso_id = $1 ORDER BY creado_en`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT ig.id, ig.nombre_archivo, ig.generado_en, per.nombre AS medico_nombre
         FROM informes_generados ig
         JOIN personas per ON per.id = ig.medico_id
         WHERE ig.caso_id = $1
         ORDER BY ig.generado_en`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT r.id, r.emitido_en, per.nombre AS medico_nombre
         FROM recetas r
         JOIN personas per ON per.id = r.medico_id
         WHERE r.caso_id = $1 AND r.estado = 'emitida' AND r.emitido_en IS NOT NULL
         ORDER BY r.emitido_en`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT cp.id, cp.tipo, cp.fecha_aplicacion, cp.vacuna, cp.subtipo_desparasitacion,
                cp.producto_desparasitacion, per.nombre AS registrado_por_nombre
         FROM cuidados_preventivos cp
         JOIN personas per ON per.id = cp.registrado_por
         WHERE cp.paciente_id = $1 AND cp.creado_en >= $2
         ORDER BY cp.fecha_aplicacion`,
        [caso.paciente_id, caso.creado_en]
      ),
      // prompt_code_registro_atencion.md, Paso 7 — una atención pertenece a
      // la cita, no al caso; se resuelve vía citas.caso_id de este caso.
      // "Si la cita está ligada a un caso, la atención aparece igual en la
      // cronología de ese caso."
      req.db!.query(
        `SELECT a.id, a.nota_medica, a.peso, a.temperatura, a.actualizado_en, per.nombre AS medico_nombre
         FROM atenciones a
         JOIN citas c ON c.id = a.cita_id
         JOIN personas per ON per.id = a.medico_id
         WHERE c.caso_id = $1
         ORDER BY a.actualizado_en`,
        [req.params.id]
      ),
    ]);

    const eventos = [
      { tipo: "apertura" as const, fecha: caso.creado_en, motivo: caso.motivo as string },
      ...consultas.rows.map((m) => ({
        tipo: "consulta_seguimiento" as const,
        fecha: m.creado_en,
        mensajeId: m.id as string,
        medicoNombre: m.medico_nombre as string | null,
        contenido: m.contenido as string,
      })),
      ...estudios.rows.map((a) => ({
        tipo: "estudio_adjuntado" as const,
        fecha: a.creado_en,
        archivoId: a.id as string,
        nombreArchivo: a.nombre_archivo as string,
        tipoArchivo: a.tipo as string | null,
      })),
      ...informes.rows.map((i) => ({
        tipo: "informe_generado" as const,
        fecha: i.generado_en,
        informeId: i.id as string,
        medicoNombre: i.medico_nombre as string,
        nombreArchivo: i.nombre_archivo as string,
      })),
      ...recetas.rows.map((r) => ({
        tipo: "receta_emitida" as const,
        fecha: r.emitido_en,
        recetaId: r.id as string,
        medicoNombre: r.medico_nombre as string,
      })),
      ...cuidados.rows.map((c) => ({
        tipo: "cuidado_preventivo" as const,
        fecha: c.fecha_aplicacion,
        cuidadoId: c.id as string,
        cuidadoTipo: c.tipo as "desparasitacion" | "vacunacion",
        vacuna: c.vacuna as string | null,
        subtipoDesparasitacion: c.subtipo_desparasitacion as string | null,
        productoDesparasitacion: c.producto_desparasitacion as string | null,
        registradoPorNombre: c.registrado_por_nombre as string,
      })),
      ...atenciones.rows.map((a) => ({
        tipo: "atencion" as const,
        fecha: a.actualizado_en,
        atencionId: a.id as string,
        medicoNombre: a.medico_nombre as string,
        notaMedica: a.nota_medica as string | null,
        peso: a.peso as string | null,
        temperatura: a.temperatura as string | null,
      })),
    ].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

    res.json({ eventos });
  } catch (err) {
    console.error("GET /casos/:id/cronologia", err);
    res.status(500).json({ error: "Error al obtener la cronología del caso." });
  }
});

// ---------------------------------------------------------------------
// POST /api/casos/:id/cerrar
// prompt_code_cierre_caso.md, Paso 2 — el médico dueño del caso. Ver
// backend/src/cierreCaso.ts para la lógica compartida con el endpoint
// gemelo de administrador (adminRouter, admin.routes.ts): mismo cuerpo,
// mismo módulo, WHERE de pertenencia distinto porque casosRouter exige
// esMedico (línea ~41) y no puede servir también a admin_clinica.
// ---------------------------------------------------------------------
casosRouter.post("/:id/cerrar", async (req, res) => {
  const validacion = validarCerrarCasoInput(req.body);
  if (!validacion.valido) {
    return res.status(400).json({ error: validacion.error });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT id, estado, paciente_id FROM casos WHERE id = $1 AND medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    if (casoResult.rows[0].estado === "completado") {
      return res.status(409).json({ error: "El caso ya está cerrado." });
    }

    const { caso, pacienteMarcadoFallecido } = await ejecutarCierreCaso(
      req.db!,
      req.params.id,
      casoResult.rows[0].paciente_id,
      validacion.input,
      req.auth!.userId
    );

    res.json({ caso, pacienteMarcadoFallecido });
  } catch (err) {
    console.error("POST /casos/:id/cerrar", err);
    res.status(500).json({ error: "Error al cerrar el caso." });
  }
});

// ---------------------------------------------------------------------
// POST /api/casos/:id/reabrir
// prompt_code_cierre_caso.md, Paso 3 — el médico dueño del caso. Endpoint
// gemelo del de admin (admin.routes.ts) — mismo módulo cierreCaso.ts, WHERE
// de pertenencia distinto, igual que el par cerrar/cerrar.
// ---------------------------------------------------------------------
casosRouter.post("/:id/reabrir", async (req, res) => {
  const validacion = validarReabrirCasoInput(req.body);
  if (!validacion.valido) {
    return res.status(400).json({ error: validacion.error });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT id, estado FROM casos WHERE id = $1 AND medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    if (casoResult.rows[0].estado !== "completado") {
      return res.status(409).json({ error: "El caso no está cerrado." });
    }

    const caso = await ejecutarReaperturaCaso(req.db!, req.params.id, validacion.motivo, req.auth!.userId);
    res.json({ caso });
  } catch (err) {
    console.error("POST /casos/:id/reabrir", err);
    res.status(500).json({ error: "Error al reabrir el caso." });
  }
});

// =====================================================================
// INFORME CLÍNICO REAL (cualquier agente con system_prompt) — POST
// /api/casos/:id/informe/generar
//
// CR-001 (Clinical Consultation Report), único tipo de informe del MVP.
// Mismo patrón que el Dashboard (tool use forzado, system prompt
// cacheado compartido con el chat) pero sin persistencia: el .docx se
// arma en memoria y se manda directo como descarga, nunca se guarda en
// disco más allá de lo que Packer.toBuffer necesita internamente.
//
// Duplicación deliberada de MODELO_GCIS/precios/registrarUsoApi, igual
// que el bloque del Dashboard más arriba — mismo motivo (no tocar
// workspace.routes.ts, no acoplar este endpoint a otro).
// =====================================================================

const INFORME_MENSAJES_MINIMOS = 2;


// ---------------------------------------------------------------------
// Ensamblado del .docx — helpers de estilo (paleta del Manual de
// Identidad Visual GastroCare Vet, mismos valores que exportarDashboardHtml
// del frontend: primary #1B2A4A, accent #4A90D9, error #E8725C).
// ---------------------------------------------------------------------
const DOCX_COLOR_PRIMARIO = "1B2A4A";
const DOCX_COLOR_ACENTO = "4A90D9";
const DOCX_COLOR_MUTED = "5A6B82";
const DOCX_COLOR_ERROR = "E8725C";
const DOCX_COLOR_ERROR_FONDO = "FCE9E5";

// dimensionesImagen/escalarDentroDeCaja se movieron a lib/imagenLogo.ts
// (importados arriba): el encabezado de los correos necesita el mismo
// escalado sin deformación y no tenía sentido duplicarlo.

const ESTADO_CASO_LABEL: Record<string, string> = {
  triage: "Triage",
  en_curso: "En curso",
  completado: "Completado",
};

const DESENLACE_LABEL: Record<string, string> = {
  resuelto: "Resuelto",
  derivado: "Derivado",
  en_control: "En control",
  fallecido: "Fallecido",
};

function filasCierreParaInforme(caso: Record<string, any>): string[][] {
  const filas: string[][] = [
    ["Desenlace", DESENLACE_LABEL[caso.desenlace] ?? caso.desenlace],
    ["Diagnóstico final", caso.diagnostico_final ?? "No registrado"],
  ];
  if (caso.tratamiento_activo) {
    filas.push(["Tratamiento activo", caso.tratamiento_activo_detalle ?? "No especificado"]);
  }
  return filas;
}

const ESTADO_CLINICO_LABEL: Record<string, string> = {
  remision: "Remisión",
  estable: "Estable",
  mejorando: "Mejorando",
  respuesta_parcial: "Respuesta parcial",
  empeorando: "Empeorando",
  critico: "Crítico",
  informacion_insuficiente: "Información insuficiente",
};

const PROBABILIDAD_LABEL: Record<string, string> = { alta: "Alta", moderada: "Moderada", baja: "Baja" };
const ESTADO_DIFERENCIAL_LABEL: Record<string, string> = { activo: "Activo", descartado: "Descartado" };
const NIVEL_ALERTA_LABEL: Record<string, string> = { alta: "Alta", media: "Media" };
const PRONOSTICO_LABEL: Record<string, string> = {
  favorable: "Favorable",
  reservado: "Reservado",
  grave: "Grave",
  incierto: "Incierto",
  pendiente_evaluacion_especialista: "Pendiente de evaluación por especialista",
};
const REFERENCIA_TIPO_LABEL: Record<string, string> = {
  literatura: "Literatura",
  caso_similar: "Caso similar",
  banderas_rojas: "Banderas rojas",
  otro: "Otro",
};
const REFERRAL_CLASIFICACION_LABEL: Record<string, string> = {
  manejable_atencion_primaria: "Manejable en atención primaria",
  derivacion_no_urgente: "Derivación no urgente",
  derivacion_urgente: "Derivación urgente",
  informacion_insuficiente: "Información insuficiente",
};
const REFERRAL_URGENCIA_LABEL: Record<string, string> = { urgente: "Urgente", no_urgente: "No urgente" };

function heading1(texto: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text: texto, bold: true, size: 28, color: DOCX_COLOR_PRIMARIO })],
  });
}

function heading2(texto: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 160, after: 100 },
    children: [new TextRun({ text: texto, bold: true, size: 22, color: DOCX_COLOR_ACENTO })],
  });
}

function parrafo(texto: string): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: texto, size: 22 })] });
}

function listaItems(items: string[]): Paragraph[] {
  return items.map(
    (item) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: parsearInlineMarkdown(item) })
  );
}

function heading3(texto: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 120, after: 80 },
    children: [new TextRun({ text: texto, bold: true, size: 20, color: DOCX_COLOR_MUTED })],
  });
}

// Referencia de numeración para las listas numeradas que el agente pueda
// escribir dentro de un campo de texto libre — se declara una sola vez acá
// y se registra en Document.numbering.config al armar el documento.
const MARKDOWN_LISTA_NUMERADA_REF = "informe-lista-numerada";

// Prompt de renderizado del informe — el agente sigue escribiendo **negrita**
// y demás marcado dentro de sus campos de texto libre (es correcto que lo
// haga, ver LO QUE NO DEBÉS HACER del prompt); lo que faltaba era
// interpretarlo. Soporta negrita/cursiva inline — nunca se anida, alcanza
// para prosa clínica.
function parsearInlineMarkdown(texto: string, opts: { size?: number } = {}): TextRun[] {
  const size = opts.size ?? 22;
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
  let ultimoIndice = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(texto)) !== null) {
    if (match.index > ultimoIndice) {
      runs.push(new TextRun({ text: texto.slice(ultimoIndice, match.index), size }));
    }
    if (match[1] !== undefined) {
      runs.push(new TextRun({ text: match[1], bold: true, size }));
    } else {
      runs.push(new TextRun({ text: (match[2] ?? match[3])!, italics: true, size }));
    }
    ultimoIndice = regex.lastIndex;
  }
  if (ultimoIndice < texto.length) {
    runs.push(new TextRun({ text: texto.slice(ultimoIndice), size }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text: texto, size })];
}

// Interpreta el marcado de bloque (encabezados de dos niveles, listas con
// viñeta y numeradas, tablas) que el agente pueda incluir DENTRO de un
// campo de texto libre — reemplaza a parrafo() para todo contenido que
// venga del agente. Nunca quita el marcado: lo traduce a elementos reales
// del documento en vez de dejarlo como texto plano con símbolos.
function parrafoLibre(texto: string | null | undefined): (Paragraph | Table)[] {
  if (!texto) return [];
  const lineas = texto.split(/\r?\n/);
  const bloques: (Paragraph | Table)[] = [];
  let filasTabla: string[][] | null = null;

  const cerrarTabla = () => {
    if (filasTabla && filasTabla.length > 0) {
      bloques.push(tablaConHeaders(filasTabla[0], filasTabla.slice(1)));
    }
    filasTabla = null;
  };

  for (const lineaCruda of lineas) {
    const linea = lineaCruda.trim();

    if (!linea) {
      cerrarTabla();
      continue;
    }

    // Tabla markdown: | a | b | ... — la fila separadora (|---|---|) se descarta.
    if (/^\|.*\|$/.test(linea)) {
      const celdas = linea
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (celdas.every((c) => /^:?-+:?$/.test(c))) continue;
      filasTabla = filasTabla ?? [];
      filasTabla.push(celdas);
      continue;
    }
    cerrarTabla();

    if (linea.startsWith("## ")) {
      bloques.push(heading3(linea.slice(3).trim()));
      continue;
    }
    if (linea.startsWith("# ")) {
      bloques.push(heading2(linea.slice(2).trim()));
      continue;
    }
    if (/^[-*]\s+/.test(linea)) {
      bloques.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: parsearInlineMarkdown(linea.replace(/^[-*]\s+/, "")),
        })
      );
      continue;
    }
    const numerada = linea.match(/^\d+\.\s+(.*)$/);
    if (numerada) {
      bloques.push(
        new Paragraph({
          numbering: { reference: MARKDOWN_LISTA_NUMERADA_REF, level: 0 },
          spacing: { after: 60 },
          children: parsearInlineMarkdown(numerada[1]),
        })
      );
      continue;
    }

    bloques.push(new Paragraph({ spacing: { after: 120 }, children: parsearInlineMarkdown(linea) }));
  }
  cerrarTabla();
  return bloques;
}

// Bug real encontrado en verificación (prompt_code_cierre_caso.md): Claude
// a veces devuelve null en un campo de informacion_paciente (ej. raza o
// edad sin dato claro en el hilo) — TextRun de la librería docx no tolera
// null/undefined y hace caer TODA la generación del informe, no solo esa
// celda. `texto` viene tipado como string desde los call sites, pero en
// la práctica puede llegar null en runtime (el JSON de Claude no se valida
// campo por campo antes de esto), de ahí el `?? "No registrado"` acá y no
// en cada call site.
function celda(
  texto: string,
  opts: { bold?: boolean; color?: string; shadingFill?: string } = {}
): TableCell {
  return new TableCell({
    shading: opts.shadingFill ? { fill: opts.shadingFill } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: texto ?? "No registrado", bold: opts.bold, color: opts.color, size: 20 }),
        ],
      }),
    ],
  });
}

function tablaConHeaders(headers: string[], filas: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map((h) => celda(h, { bold: true, color: "FFFFFF", shadingFill: DOCX_COLOR_PRIMARIO })),
      }),
      ...filas.map((fila) => new TableRow({ children: fila.map((c) => celda(c)) })),
    ],
  });
}

function tablaLaboratorio(
  valores: { parametro: string; valor: string; unidad: string; rango_ref: string; fuera_de_rango: boolean }[]
): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: ["Parámetro", "Valor", "Unidad", "Rango de referencia"].map((h) =>
          celda(h, { bold: true, color: "FFFFFF", shadingFill: DOCX_COLOR_PRIMARIO })
        ),
      }),
      ...valores.map(
        (v) =>
          new TableRow({
            children: [
              celda(v.parametro, v.fuera_de_rango ? { bold: true } : {}),
              celda(
                v.valor,
                v.fuera_de_rango
                  ? { bold: true, color: DOCX_COLOR_ERROR, shadingFill: DOCX_COLOR_ERROR_FONDO }
                  : {}
              ),
              celda(v.unidad),
              celda(v.rango_ref),
            ],
          })
      ),
    ],
  });
}

// Arma el cuerpo del documento (todo lo que va después de la portada,
// antes de la firma) — cada sección se agrega solo si su campo en el
// JSON de Claude es no-null, en el mismo orden de FASE C del prompt.
function construirCuerpoInforme(informe: Record<string, any>): (Paragraph | Table)[] {
  const bloques: (Paragraph | Table)[] = [];

  if (informe.resumen_ejecutivo) {
    const r = informe.resumen_ejecutivo;
    bloques.push(
      heading1("Resumen Ejecutivo"),
      ...parrafoLibre(r.paciente_resumen),
      heading2("Problema principal"),
      ...parrafoLibre(r.problema_principal),
      heading2("Diagnóstico más probable"),
      ...parrafoLibre(r.diagnostico_mas_probable),
      heading2("Estado clínico actual"),
      ...parrafoLibre(r.estado_clinico_actual),
      heading2("Pronóstico"),
      ...parrafoLibre(r.pronostico_resumen)
    );
  }

  if (informe.informacion_paciente) {
    const p = informe.informacion_paciente;
    bloques.push(
      heading1("Información del Paciente"),
      tablaConHeaders(
        ["Campo", "Valor"],
        [
          ["Nombre", p.nombre],
          ["Especie", p.especie],
          ["Raza", p.raza],
          ["Sexo", p.sexo],
          ["Edad", p.edad],
          ["Peso", p.peso_kg != null ? `${p.peso_kg} kg` : "No registrado"],
          ["BCS", p.bcs ?? "No registrado"],
          ["Propietario", p.propietario],
          ["Veterinario remitente", p.veterinario_remitente ?? "No aplica"],
        ]
      )
    );
  }

  if (informe.motivo_consulta) {
    const m = informe.motivo_consulta;
    bloques.push(
      heading1("Motivo de Consulta"),
      ...parrafoLibre(m.motivo),
      heading2("Tiempo de evolución"),
      ...parrafoLibre(m.tiempo_evolucion),
      heading2("Antecedentes relevantes"),
      ...parrafoLibre(m.antecedentes_relevantes)
    );
  }

  if (informe.historia_clinica) {
    bloques.push(heading1("Historia Clínica"), ...parrafoLibre(informe.historia_clinica));
  }

  if (informe.cronologia_clinica) {
    bloques.push(
      heading1("Cronología Clínica"),
      tablaConHeaders(["Fecha", "Evento"], informe.cronologia_clinica.map((e: any) => [e.fecha, e.evento]))
    );
  }

  if (informe.examen_fisico) {
    const ef = informe.examen_fisico;
    bloques.push(
      heading1("Examen Físico"),
      heading2("Estado general"),
      ...parrafoLibre(ef.estado_general),
      heading2("Estado nutricional"),
      ...parrafoLibre(ef.estado_nutricional),
      heading2("Hidratación"),
      ...parrafoLibre(ef.hidratacion),
      heading2("Hallazgos por sistema"),
      ...listaItems(ef.hallazgos_por_sistema.map((h: any) => `${h.sistema}: ${h.hallazgo}`))
    );
  }

  if (informe.analisis_laboratorio) {
    bloques.push(heading1("Análisis de Laboratorio"));
    for (const estudio of informe.analisis_laboratorio) {
      bloques.push(
        heading2(`${estudio.tipo_estudio} — ${estudio.fecha}`),
        tablaLaboratorio(estudio.valores),
        ...parrafoLibre(estudio.comentario_interpretativo)
      );
    }
  }

  if (informe.estudios_imagen) {
    bloques.push(heading1("Estudios de Imagen"));
    for (const e of informe.estudios_imagen) {
      bloques.push(
        heading2(`${e.tipo_estudio} — ${e.fecha}`),
        ...parrafoLibre(`Resumen: ${e.resumen}`),
        ...parrafoLibre(`Hallazgos: ${e.hallazgos}`),
        ...parrafoLibre(`Interpretación: ${e.interpretacion}`)
      );
    }
  }

  if (informe.razonamiento_diagnostico) {
    bloques.push(heading1("Razonamiento Diagnóstico"), ...parrafoLibre(informe.razonamiento_diagnostico));
  }

  if (informe.diagnostico_diferencial) {
    bloques.push(
      heading1("Diagnóstico Diferencial"),
      tablaConHeaders(
        ["Diagnóstico", "Probabilidad", "Evidencia", "Estado"],
        informe.diagnostico_diferencial.map((d: any) => [
          d.diagnostico,
          PROBABILIDAD_LABEL[d.probabilidad] ?? d.probabilidad,
          d.evidencia,
          ESTADO_DIFERENCIAL_LABEL[d.estado] ?? d.estado,
        ])
      )
    );
  }

  if (informe.referral_recommendation) {
    const rr = informe.referral_recommendation;
    bloques.push(
      heading1("Recomendación de Derivación"),
      tablaConHeaders(
        ["Campo", "Valor"],
        [
          ["Clasificación", REFERRAL_CLASIFICACION_LABEL[rr.clasificacion] ?? rr.clasificacion],
          ["Especialidad destino", rr.especialidad_destino ?? "No aplica"],
          ["Pregunta clínica", rr.pregunta_clinica ?? "No aplica"],
          ["Urgencia", rr.urgencia ? REFERRAL_URGENCIA_LABEL[rr.urgencia] ?? rr.urgencia : "No aplica"],
        ]
      ),
      ...parrafoLibre(rr.justificacion)
    );
  }

  if (informe.matriz_evidencia) {
    bloques.push(
      heading1("Matriz de Evidencia"),
      tablaConHeaders(
        ["Afirmación", "Evidencia de sustento", "Fuente"],
        informe.matriz_evidencia.map((m: any) => [m.afirmacion, m.evidencia_sustento, m.fuente])
      )
    );
  }

  if (informe.historial_terapeutico) {
    bloques.push(
      heading1("Historial Terapéutico"),
      ...listaItems(
        informe.historial_terapeutico.map((h: any) => `${h.fecha} — ${h.tratamiento}: ${h.respuesta}`)
      )
    );
  }

  if (informe.manejo_nutricional) {
    const mn = informe.manejo_nutricional;
    bloques.push(
      heading1("Manejo Nutricional"),
      heading2("Dieta actual"),
      ...listaItems(mn.dieta_actual),
      heading2("Objetivo terapéutico"),
      ...parrafoLibre(mn.objetivo_terapeutico),
      heading2("Fuente de indicación"),
      ...parrafoLibre(mn.fuente_indicacion)
    );
    if (mn.extras_no_controlados.length > 0) {
      bloques.push(heading2("Extras no controlados"), ...listaItems(mn.extras_no_controlados));
    }
    if (mn.alerta_ensayo_eliminacion) {
      bloques.push(heading2("Alerta de ensayo de eliminación"), ...parrafoLibre(mn.alerta_ensayo_eliminacion));
    }
  }

  if (informe.consideraciones_farmacologicas) {
    bloques.push(heading1("Consideraciones Farmacológicas"));
    for (const c of informe.consideraciones_farmacologicas) {
      bloques.push(
        heading2(`${c.tipo_alerta} (${NIVEL_ALERTA_LABEL[c.nivel] ?? c.nivel})`),
        ...parrafoLibre(c.descripcion),
        ...parrafoLibre(`Fuente: ${c.fuente}`)
      );
    }
  }

  if (informe.evolucion_clinica) {
    bloques.push(heading1("Evolución Clínica"), ...parrafoLibre(informe.evolucion_clinica));
  }

  if (informe.estado_clinico_actual) {
    const ec = informe.estado_clinico_actual;
    bloques.push(
      heading1("Estado Clínico Actual"),
      parrafo(`${ec.emoji} ${ESTADO_CLINICO_LABEL[ec.estado] ?? ec.estado}`),
      ...parrafoLibre(ec.explicacion)
    );
  }

  if (informe.recomendaciones) {
    const r = informe.recomendaciones;
    bloques.push(heading1("Recomendaciones"), heading2("Terapéuticas"), ...listaItems(r.terapeuticas));
    if (r.estudios_sugeridos.length > 0) {
      bloques.push(heading2("Estudios sugeridos"), ...listaItems(r.estudios_sugeridos));
    }
    bloques.push(heading2("Seguimiento"), ...parrafoLibre(r.seguimiento));
    if (r.monitoreo.length > 0) {
      bloques.push(heading2("Monitoreo"), ...listaItems(r.monitoreo));
    }
    if (r.informacion_faltante.length > 0) {
      bloques.push(heading2("Información faltante"), ...listaItems(r.informacion_faltante));
    }
    if (r.riesgos.length > 0) {
      bloques.push(heading2("Riesgos"), ...listaItems(r.riesgos));
    }
  }

  if (informe.pronostico) {
    const pr = informe.pronostico;
    bloques.push(
      heading1("Pronóstico"),
      parrafo(`Categoría: ${PRONOSTICO_LABEL[pr.categoria] ?? pr.categoria}`),
      ...parrafoLibre(pr.justificacion)
    );
  }

  if (informe.referencias) {
    bloques.push(
      heading1("Referencias"),
      ...listaItems(
        informe.referencias.map(
          (r: any) => `[${REFERENCIA_TIPO_LABEL[r.tipo] ?? r.tipo}] ${r.referencia} — ${r.detalle}`
        )
      )
    );
  }

  if (informe.apendices) {
    bloques.push(heading1("Apéndices"));
    for (const a of informe.apendices) {
      bloques.push(heading2(a.titulo), ...parrafoLibre(a.contenido));
    }
  }

  return bloques;
}

function sanitizarNombreArchivoInforme(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return limpio || "paciente";
}

// ---------------------------------------------------------------------
// POST /api/casos/:id/informe/generar
//
// Cualquier agente con system_prompt configurado (CR-001) — agentes sin
// integración real todavía (sin system_prompt) devuelven 400 más abajo.
// Sin persistencia: el .docx se arma en memoria y se manda directo como
// adjunto descargable.
// ---------------------------------------------------------------------
casosRouter.post("/:id/informe/generar", async (req, res) => {
  // Paso 4 — para quién es este informe. Es una decisión POR INFORME, no
  // una configuración: por eso viaja en el cuerpo del pedido y no hay un
  // control permanente en la barra del área de trabajo, que ya está
  // apretada y le quita espacio a lo que el médico lee.
  //
  // Default 'colega' = exactamente el comportamiento anterior, para que un
  // cliente que todavía no manda el campo siga funcionando igual.
  const destinatario = ((req.body ?? {}) as { destinatario?: string }).destinatario ?? "colega";
  if (destinatario !== "colega" && destinatario !== "tutor") {
    return res.status(400).json({ error: "El destinatario del informe tiene que ser 'colega' o 'tutor'." });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT c.id, c.agente_id, c.estado, c.motivo, c.numero_expediente,
              c.diagnostico_final, c.tratamiento_activo, c.tratamiento_activo_detalle, c.desenlace,
              p.id AS paciente_id, p.nombre AS paciente_nombre, p.especie, r.nombre AS raza,
              p.sexo AS paciente_sexo, p.edad_anios AS paciente_edad_anios, p.fecha_nacimiento AS paciente_fecha_nacimiento,
              p.estado AS paciente_estado,
              pr.id AS propietario_id, pr.nombre AS propietario_nombre,
              a.system_prompt,
              m.nombre AS medico_nombre, m.colegiatura AS medico_colegiatura,
              t.nombre AS tenant_nombre, t.logo_url AS tenant_logo_url, t.zona_horaria
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       LEFT JOIN razas r ON r.id = p.raza_id
       JOIN propietarios pr ON pr.id = p.propietario_id
       JOIN agentes a ON a.id = c.agente_id
       JOIN personas m ON m.id = c.medico_id
       JOIN tenants t ON t.id = c.tenant_id
       WHERE c.id = $1 AND c.medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    const caso = casoResult.rows[0];
    caso.paciente_edad_anios = calcularEdadEfectiva(caso.paciente_fecha_nacimiento, caso.paciente_edad_anios);

    if (!caso.system_prompt) {
      return res.status(400).json({
        error: "La generación de informes solo está disponible para agentes con integración real.",
      });
    }

    // El logo institucional nunca se omite en silencio (mismo criterio ya
    // aplicado en el export HTML del Dashboard): si la clínica todavía no
    // cargó uno en Datos de la Clínica, se corta acá con un error claro
    // en vez de generar un documento oficial sin logo. Es el logo de la
    // clínica (tenant), no del agente — ver AD-BRAND-01 más arriba.
    if (!caso.tenant_logo_url) {
      return res.status(422).json({
        error: "La clínica no tiene un logo cargado. Subilo en Datos de la Clínica antes de generar el informe.",
      });
    }
    const logoClave = claveLogoDesdeValorGuardado(caso.tenant_logo_url);
    let logoBuffer: Buffer;
    try {
      logoBuffer = await almacenamientoPublico.leer(logoClave);
    } catch {
      return res.status(422).json({
        error: "No se encontró el archivo del logo de la clínica en el servidor.",
      });
    }
    const logoExt = path.extname(logoClave).toLowerCase();
    const logoType: "png" | "jpg" = logoExt === ".png" ? "png" : "jpg";

    // -----------------------------------------------------------------
    // Compuerta de datos mínimos — mismo criterio que el Dashboard.
    // -----------------------------------------------------------------
    const mensajesCountResult = await req.db!.query(`SELECT COUNT(*) FROM mensajes WHERE caso_id = $1`, [
      req.params.id,
    ]);
    const cantidadMensajes = Number(mensajesCountResult.rows[0].count);
    const tieneCamposMinimos = Boolean(caso.especie) && Boolean(caso.raza) && Boolean(caso.motivo?.trim());

    if (!tieneCamposMinimos || cantidadMensajes < INFORME_MENSAJES_MINIMOS) {
      return res.status(400).json({ error: "El caso no tiene información suficiente para generar un informe." });
    }

    // Motor de crédito, bloque 3 — verificación previa a la generación.
    // tipoOperacion="informe": es la única que la ventana de purga sigue
    // permitiendo (para exportar el historial antes de que se elimine).
    //
    // Flujo de suscripción C — dentro de ventana_purga, el informe pasa
    // por un camino distinto (verificarInformeCortesiaPermitido, sin
    // chequeo de saldo) en vez del bloque 3 normal: el propio flujo pide
    // "se ejecuta sin verificar saldo", algo que verificarAntesDeGenerar
    // no hace para tipoOperacion="informe" (sigue revisando saldo/colchón
    // aunque la suscripción esté en ventana_purga). Se resuelve el estado
    // acá antes de decidir qué camino tomar.
    const suscripcionEstadoResult = await req.db!.query(
      `SELECT s.estado FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id WHERE t.id = $1`,
      [req.auth!.tenantId]
    );
    const enVentanaPurga = suscripcionEstadoResult.rows[0]?.estado === "ventana_purga";
    let esCortesia = false;

    if (enVentanaPurga) {
      const verificacionCortesia = await verificarInformeCortesiaPermitido(req.db!, req.auth!.tenantId!, req.params.id);
      if (!verificacionCortesia.permitido) {
        return res.status(402).json({
          error: mensajeRechazoCortesia(verificacionCortesia.motivo!),
          motivo: verificacionCortesia.motivo,
        });
      }
      esCortesia = true;
    } else {
      const verificacionInforme = await verificarAntesDeGenerar(req.db!, {
        tenantId: req.auth!.tenantId!,
        agenteId: caso.agente_id,
        tipoOperacion: "informe",
        disparadoPor: "usuario",
      });
      if (!verificacionInforme.permitido) {
        return res.status(402).json({
          error: mensajeRechazoGeneracion(verificacionInforme.motivo!),
          motivo: verificacionInforme.motivo,
        });
      }
    }

    // Acá se suelta la transacción: lo que sigue es la síntesis, la llamada
    // más larga del sistema. Sostenerla abierta era la causa raíz de la
    // alerta de `idle in transaction`.
    //
    // Todo lo de arriba es LECTURA —incluidos verificarAntesDeGenerar y
    // verificarInformeCortesiaPermitido, que solo consultan—, así que
    // confirmar acá no puede perder ninguna escritura pendiente. La
    // cortesía, que es lo único con efecto de una sola vez, se marca con el
    // INSERT en informes_generados de más abajo, no antes.
    //
    // El armado del contexto ya NO se hace acá: lo hace generarSintesis con
    // el mismo material. Dos armados separados eran dos razonamientos que
    // podían discrepar sobre el mismo paciente sin que nadie lo notara
    // hasta comparar la pantalla con el documento.
    //
    // Desde este punto `req.db` no se usa más.
    await req.cerrarTransaccion!();

    // -----------------------------------------------------------------
    // La síntesis, completa. SIN `forzar`: si ya hay una vigente, el
    // informe la proyecta y NO consume nada — que es el punto del Paso 3.
    // Si solo existe el núcleo, se completa; si no hay nada, se hacen las
    // dos fases, sin depender de que alguien haya abierto el dashboard.
    // -----------------------------------------------------------------
    let resultadoInforme;
    try {
      resultadoInforme = await obtenerSintesisParaInforme(req.auth!.tenantId!, req.params.id);
      await registrarExitoAnthropic();
    } catch (err) {
      console.error("Error al generar la síntesis para el informe", err);
      await registrarResultadoAnthropic(err);
      return res.status(502).json({ error: "No se pudo generar el informe en este momento." });
    }

    // Proyección pura de la MISMA síntesis que ve el dashboard.
    let informeGenerado = proyectarInforme(resultadoInforme.sintesis, req.params.id);
    if (informeGenerado.meta?.estado_generacion === "sin_datos") {
      return res.status(422).json({ error: "No se pudo generar un informe con datos suficientes para este caso." });
    }

    // PARA UN COLEGA no se llama al modelo: el lenguaje técnico ya está en
    // la síntesis y el informe se compone proyectándola. Consumo cero.
    //
    // PARA EL TUTOR hay una llamada chica que REESCRIBE esa proyección en
    // lenguaje llano — no vuelve a razonar ni recarga la base de
    // conocimiento. Son dos caminos de generación distintos, no dos
    // plantillas: si fueran dos prompts completos, la interfaz se vería
    // igual y la diferencia aparecería solo en la factura.
    const usosDelInforme = [...resultadoInforme.usosDelModelo];
    if (destinatario === "tutor") {
      try {
        const adaptado = await adaptarInformeParaTutor(informeGenerado);
        informeGenerado = adaptado.informe;
        usosDelInforme.push(adaptado.usage);
        if (adaptado.descartados.length > 0) {
          // No es cosmético: cada entrada es un intento de agregar, quitar
          // o cambiar contenido clínico que la barrera de forma frenó. Si
          // esto aparece seguido, el prompt de adaptación necesita trabajo.
          console.warn(
            `Informe para tutor del caso ${req.params.id}: se descartaron ${adaptado.descartados.length} ` +
              `cambio(s) que no respetaban la forma del informe técnico — ${adaptado.descartados.join("; ")}`
          );
        }
      } catch (err) {
        // Entregar la versión técnica "por las dudas" sería peor que fallar:
        // el médico pidió una versión para el tutor y se llevaría un
        // documento con lenguaje que el tutor no entiende, sin enterarse.
        console.error(`Error al adaptar el informe para el tutor — caso ${req.params.id}`, err);
        await registrarResultadoAnthropic(err);
        return res.status(502).json({
          error: "No se pudo preparar la versión para el tutor. La versión para colega sí está disponible.",
        });
      }
    }


    // Primera transacción corta después del modelo: el consumo. Va sola y
    // ANTES de armar el .docx porque la llamada ya se hizo y ya costó —
    // registrarla no depende de que el ensamblado del documento salga bien.
    //
    // UNA FILA POR CADA llamada al modelo, no una por request: pedir el
    // informe sin síntesis previa encadena núcleo y complemento, y cobrar
    // solo la última regalaría la otra sin que nada falle.
    //
    // Y si `usosDelModelo` viene vacío NO se registra nada: el informe se
    // armó proyectando una síntesis que ya existía y estaba vigente. Ese es
    // el punto del Paso 3 — el informe no vuelve a razonar, así que tampoco
    // vuelve a cobrar.
    if (usosDelInforme.length > 0) {
      await conAlcanceTenant(req.auth!.tenantId!, async (db) => {
        const medicoAgenteResult = await db.query(
          `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2`,
          [req.auth!.userId, caso.agente_id]
        );
        for (const usage of usosDelInforme) {
          await registrarUsoApi(db, {
            tenantId: req.auth!.tenantId!,
            casoId: req.params.id,
            medicoAgenteId: medicoAgenteResult.rows[0]?.id ?? null,
            personaId: req.auth!.userId,
            modelo: MODELO_GCIS,
            tokensEntrada: usage.input_tokens,
            tokensSalida: usage.output_tokens,
            tokensCacheEscritura: usage.cache_creation_input_tokens ?? 0,
            tokensCacheLectura: usage.cache_read_input_tokens ?? 0,
            tipoConsumo: esCortesia ? "cortesia" : "clinico",
            disparadoPor: "usuario",
          });
        }
      });
    }

    // -----------------------------------------------------------------
    // Ensamblado del .docx — portada y firma con datos reales del
    // backend (Claude nunca los genera), cuerpo a partir del JSON.
    // -----------------------------------------------------------------
    const fechaEmision = new Date();
    const fechaEmisionFmt = new Intl.DateTimeFormat("es", {
      timeZone: caso.zona_horaria ?? "America/Costa_Rica",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(fechaEmision);

    const edadFmt =
      caso.paciente_edad_anios == null
        ? "No registrada"
        : `${caso.paciente_edad_anios} ${Number(caso.paciente_edad_anios) === 1 ? "año" : "años"}`;

    const dimensionesLogo = dimensionesImagen(logoBuffer, logoType);
    const tamanoLogo = escalarDentroDeCaja(dimensionesLogo.width, dimensionesLogo.height, 180, 60);

    const portada: (Paragraph | Table)[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            type: logoType,
            data: logoBuffer,
            transformation: tamanoLogo,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [new TextRun({ text: caso.tenant_nombre, bold: true, size: 24, color: DOCX_COLOR_MUTED })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({ text: "Informe de Consulta Clínica", bold: true, size: 40, color: DOCX_COLOR_PRIMARIO })],
      }),
      tablaConHeaders(
        ["Campo", "Valor"],
        [
          ["N.º de Expediente", String(caso.numero_expediente)],
          ["Paciente", caso.paciente_nombre],
          ["Especie", caso.especie],
          ["Raza", caso.raza ?? "No registrada"],
          ["Sexo", caso.paciente_sexo ?? "No registrado"],
          ["Edad", edadFmt],
          ["Propietario", caso.propietario_nombre],
          ["Código del caso", caso.id],
          ["Fecha de emisión", fechaEmisionFmt],
          ["Médico tratante", caso.medico_nombre],
          ["Colegiado N.º", caso.medico_colegiatura ?? "No registrado"],
          ["Versión", "1.0"],
          ["Estado del caso", ESTADO_CASO_LABEL[caso.estado] ?? caso.estado],
          // prompt_code_cierre_caso.md — si el caso está cerrado, el informe
          // final lo refleja: desenlace, diagnóstico final, y tratamiento
          // activo solo si quedó alguno (no una fila vacía si no aplica).
          ...(caso.estado === "completado" ? filasCierreParaInforme(caso) : []),
        ]
      ),
      new Paragraph({ pageBreakBefore: true, children: [] }),
    ];

    const firma: Paragraph[] = [
      heading1("Firma y Certificación"),
      parrafo(`Dr./Dra. ${caso.medico_nombre} — Colegiado N.º ${caso.medico_colegiatura ?? "no registrado"}`),
      parrafo(`Fecha de emisión: ${fechaEmisionFmt}`),
      new Paragraph({
        spacing: { before: 300 },
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: DOCX_COLOR_MUTED, space: 8 } },
        children: [
          new TextRun({
            text:
              "Este informe fue elaborado con el apoyo de un sistema de inteligencia artificial. " +
              "La responsabilidad clínica sobre su contenido corresponde al veterinario que lo firma.",
            italics: true,
            size: 18,
            color: DOCX_COLOR_MUTED,
          }),
        ],
      }),
    ];

    const doc = new Document({
      features: { updateFields: true },
      numbering: {
        config: [
          {
            reference: MARKDOWN_LISTA_NUMERADA_REF,
            levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START }],
          },
        ],
      },
      sections: [
        {
          properties: {},
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: "Página ", size: 16, color: DOCX_COLOR_MUTED }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 16, color: DOCX_COLOR_MUTED }),
                    new TextRun({ text: " de ", size: 16, color: DOCX_COLOR_MUTED }),
                    new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: DOCX_COLOR_MUTED }),
                  ],
                }),
              ],
            }),
          },
          children: [...portada, ...construirCuerpoInforme(informeGenerado), ...firma],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);

    const fechaArchivo = new Intl.DateTimeFormat("en-CA", {
      timeZone: caso.zona_horaria ?? "America/Costa_Rica",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(fechaEmision);
    const nombreArchivo = `Informe_${sanitizarNombreArchivoInforme(caso.paciente_nombre)}_${fechaArchivo}.docx`;

    // Historial versionado — SIEMPRE INSERT, nunca UPDATE (ver migración
    // 018): a diferencia del Dashboard, cada informe generado es un
    // documento formal fechado que se conserva para siempre. Si esto
    // fallara, no debería tirar abajo la descarga que el médico ya está
    // esperando — se loguea y se sigue.
    //
    // Va en SU PROPIA transacción, separada de la del consumo de arriba.
    // Antes las dos compartían la transacción de la request, y eso hacía
    // que este fallo —el que el comentario dice que no debe bloquear
    // nada— envenenara la transacción entera: en Postgres, un error deja
    // la transacción abortada y todo lo que siguiera, incluido el registro
    // de consumo ya hecho, se perdía en el COMMIT. El `catch` tapaba el
    // error pero no el efecto.
    try {
      await conAlcanceTenant(req.auth!.tenantId!, async (db) => {
        await db.query(
          `INSERT INTO informes_generados (tenant_id, caso_id, medico_id, tipo_reporte, contenido_docx, nombre_archivo, es_cortesia, destinatario)
           VALUES ($1, $2, $3, 'CR-001', $4, $5, $6, $7)`,
          [req.auth!.tenantId, req.params.id, req.auth!.userId, buffer, nombreArchivo, esCortesia, destinatario]
        );
        // prompt_code_cierre_caso.md, Paso 2, punto 2 — todos los puntos de
        // actividad tocan actualizado_en, no solo informacion/mensajes.
        await db.query(`UPDATE casos SET actualizado_en = now() WHERE id = $1`, [req.params.id]);

        // La preferencia del médico, para preseleccionarla la próxima vez.
        // Va acá y no antes: solo cuenta como "lo que este médico elige" si
        // el informe realmente se emitió. Un intento que falló no es una
        // preferencia.
        await db.query(`UPDATE personas SET destinatario_informe_preferido = $2 WHERE id = $1`, [
          req.auth!.userId,
          destinatario,
        ]);
      });
    } catch (err) {
      console.error("Error al persistir el informe en informes_generados (no bloquea la descarga)", err);
    }

    // prompt_code_notificaciones_pendientes.md, C3 — avisa que el informe
    // está disponible, sin adjuntarlo (decisión confirmada: es el
    // veterinario quien controla cuándo y cómo se comunica el contenido
    // clínico). No debería bloquear la descarga tampoco.
    //
    // RESIDUO CONOCIDO: `emitirNotificacion` inserta la fila y manda el
    // correo en el mismo await, así que esta transacción corta sigue
    // abierta durante la llamada a Resend (~centenas de ms). Es tres
    // órdenes de magnitud menos que los ~40 s del modelo, pero es el mismo
    // defecto en chico. Sacarlo del todo exige partir emitirNotificacion en
    // "persistir" y "enviar", que la usan ~10 llamadores y merece su propio
    // cambio. No se puede resolver acá usando el pool sin transacción: la
    // escritura es tenant-scoped y `app.tenant_id` vive en la transacción.
    try {
      await conAlcanceTenant(req.auth!.tenantId!, async (db) => {
        // prompt_code_paciente_nacimiento_estado.md, Parte B2 — un paciente
        // fallecido no recibe ningún aviso.
        if (
          caso.paciente_estado !== "activo" ||
          !(await avisoActivo(db, req.auth!.tenantId!, "informe_disponible_activo"))
        ) {
          return;
        }
        await emitirNotificacion(db, {
          tenantId: req.auth!.tenantId!,
          tipo: "informe_disponible",
          destinatarioTipo: "propietario",
          destinatarioId: caso.propietario_id,
          casoId: caso.id,
          pacienteId: caso.paciente_id,
          asunto: `Informe clínico disponible — ${caso.paciente_nombre}`,
          contenido: `El veterinario generó un nuevo informe clínico de ${caso.paciente_nombre}. Consultalo en tu próxima visita a la clínica.`,
          datosCorreo: { nombrePaciente: caso.paciente_nombre },
        });
      });
    } catch (err) {
      console.error("Error al emitir la notificación de informe disponible (no bloquea la descarga)", err);
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    res.send(buffer);
  } catch (err) {
    console.error("POST /casos/:id/informe/generar", err);
    res.status(500).json({ error: "Error al generar el informe." });
  }
});

// ---------------------------------------------------------------------
// GET /api/casos/:id/informes
// Historial de informes generados para el caso — sin el binario (sería
// pesado innecesariamente), más reciente primero.
//
// prompt_code_informes_anteriores, Paso 3 — el acceso es por CASO dentro
// del tenant (RLS vía withTenantClient), no por "es mi caso": antes esto
// filtraba también por medico_id = req.auth.userId, así que un médico que
// no fuera el dueño ACTUAL del caso (reasignado, o cualquier otro médico
// de la clínica con acceso al caso) se encontraba con un 404 silencioso
// — cargarInformes() no tiene catch, así que la lista quedaba vacía sin
// ningún error visible. Mismo criterio que ya usan propietarios/pacientes
// (cualquier médico de la clínica puede acceder), no el de "dueño único".
// ---------------------------------------------------------------------
casosRouter.get("/:id/informes", async (req, res) => {
  try {
    const casoResult = await req.db!.query(`SELECT id FROM casos WHERE id = $1`, [req.params.id]);
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }

    const result = await req.db!.query(
      `SELECT i.id, i.tipo_reporte, i.nombre_archivo, i.generado_en, i.medico_id, m.nombre AS medico_nombre,
              i.es_cortesia
       FROM informes_generados i
       JOIN personas m ON m.id = i.medico_id
       WHERE i.caso_id = $1
       ORDER BY i.generado_en DESC`,
      [req.params.id]
    );
    res.json({ informes: result.rows });
  } catch (err) {
    console.error("GET /casos/:id/informes", err);
    res.status(500).json({ error: "Error al obtener el historial de informes." });
  }
});
