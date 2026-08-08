import { Router } from "express";
import { PoolClient } from "pg";
import * as path from "path";
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
import { calcularEdadEfectiva } from "../edadPaciente";
import { avisoActivo, emitirNotificacion } from "../notificaciones";
import { construirBloqueRazaDocumento, NOMBRE_DOCUMENTO_PREDISPOSICIONES } from "../razaDocumento";
import { asignarNumeroExpediente } from "../expediente";
import { registrarResultadoAnthropic, registrarExitoAnthropic } from "../proveedorIaEstado";

export const casosRouter = Router();

casosRouter.use(authenticate, withTenantClient);

casosRouter.use((req, res, next) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }
  next();
});

// ---------------------------------------------------------------------
// Documentos de la Base de Conocimiento relevantes para el contexto de un
// caso: los del agente del caso (o compartidos, agente_id NULL) que
// ADEMÁS apliquen al país del tenant — sin país asignado (NULL, aplica a
// cualquier país) o coincidiendo exactamente con tenants.pais_codigo.
//
// Trae también d.contenido_texto (texto completo, cuando está cargado) —
// se usa tanto para el chat real de GCIS (workspace.routes.ts) como para
// la generación real del Dashboard más abajo en este archivo.
//
// Excluye a propósito el documento de predisposiciones raciales (ver
// razaDocumento.ts) — ese va aparte, seleccionado por la raza del
// paciente, y NUNCA como parte de este bloque cacheado: si viviera acá,
// el prefijo dejaría de ser idéntico byte a byte entre casos del mismo
// agente (la raza varía por caso) y se perdería el caché compartido para
// TODO el bloque, no solo para este documento.
// ---------------------------------------------------------------------
export async function obtenerDocumentosParaContexto(
  db: PoolClient,
  agenteId: string,
  tenantId: string
) {
  const result = await db.query(
    `SELECT d.id, d.nombre, d.tipo, d.archivo_ref, d.contenido_texto
     FROM documentos_conocimiento d
     JOIN tenants t ON t.id = $2
     WHERE d.estado = 'activo'
       AND d.incluir_en_contexto = true
       AND d.nombre != $3
       AND (d.agente_id IS NULL OR d.agente_id = $1)
       AND (d.pais_codigo IS NULL OR d.pais_codigo = t.pais_codigo)
     ORDER BY d.fecha_carga DESC`,
    [agenteId, tenantId, NOMBRE_DOCUMENTO_PREDISPOSICIONES]
  );
  return result.rows;
}

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
    items?: {
      medicamentoId: string;
      dosis: string;
      frecuencia: string;
      duracion: string;
      viaAdministracion: string;
      observaciones?: string;
    }[];
  };

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "La receta necesita al menos un medicamento." });
  }

  try {
    const casoResult = await req.db!.query(
      `SELECT id, paciente_id FROM casos WHERE id = $1 AND medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    const caso = casoResult.rows[0];

    const recetaResult = await req.db!.query(
      `INSERT INTO recetas (tenant_id, caso_id, paciente_id, medico_id, instrucciones_generales, instrucciones_propietario)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.auth!.tenantId,
        req.params.id,
        caso.paciente_id,
        req.auth!.userId,
        instruccionesGenerales ?? null,
        instruccionesPropietario ?? null,
      ]
    );
    const receta = recetaResult.rows[0];

    let orden = 0;
    for (const item of items) {
      await req.db!.query(
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

    const itemsResult = await req.db!.query(
      `SELECT ri.*, m.nombre AS medicamento_nombre, m.presentacion, m.concentracion
       FROM receta_items ri
       JOIN medicamentos m ON m.id = ri.medicamento_id
       WHERE ri.receta_id = $1
       ORDER BY ri.orden ASC`,
      [receta.id]
    );

    res.status(201).json({ receta, items: itemsResult.rows });
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

// Mismo mecanismo que workspace.routes.ts (duplicado a propósito, ver
// nota arriba): documentos con contenido_texto cargado se concatenan
// completos; los que no, se mencionan solo por nombre/tipo/archivo_ref.
// El texto resultante tiene que ser BYTE POR BYTE igual al que arma el
// chat para el mismo caso — de eso depende que esta llamada aproveche el
// cache_control ephemeral que ya paga el chat, en vez de escribir un
// cache nuevo.
export function construirBloqueDocumentos(
  documentos: { nombre: string; tipo: string; archivo_ref: string; contenido_texto: string | null }[]
): string {
  if (documentos.length === 0) {
    return "No hay documentos de referencia adicionales cargados para este agente/país.";
  }
  const documentosConTexto = documentos.filter((d) => d.contenido_texto);
  const documentosSinTexto = documentos.filter((d) => !d.contenido_texto);
  return [
    documentosConTexto.length > 0
      ? "Documentos de referencia (contenido completo) para este caso:\n\n" +
        documentosConTexto
          .map((d) => `### ${d.nombre} (${d.tipo})\n${d.contenido_texto}`)
          .join("\n\n---\n\n")
      : null,
    documentosSinTexto.length > 0
      ? "Documentos de referencia mencionados pero sin contenido de texto cargado " +
        "todavía (solo metadata):\n" +
        documentosSinTexto.map((d) => `- ${d.nombre} (${d.tipo}): ${d.archivo_ref}`).join("\n")
      : null,
  ]
    .filter((bloque): bloque is string => bloque !== null)
    .join("\n\n");
}

// ---------------------------------------------------------------------
// Historial de prescripciones YA emitidas de un caso — función
// compartida (ver prompt_receta_contexto_caso.md) reusada tal cual por
// chat, Dashboard, Informe y validación de recetas, mismo criterio que
// obtenerDocumentosParaContexto/construirBloqueDocumentos arriba. Solo
// 'emitida': un borrador de otra sesión/médico no cuenta como "ya
// prescripto" y no debe filtrarse acá.
// ---------------------------------------------------------------------
export async function obtenerRecetasEmitidasParaContexto(db: PoolClient, casoId: string) {
  const result = await db.query(
    `SELECT r.id, r.emitido_en, per.nombre AS medico_nombre,
            med.nombre AS medicamento_nombre, med.concentracion,
            ri.dosis, ri.frecuencia, ri.duracion, ri.via_administracion, ri.orden
     FROM recetas r
     JOIN personas per ON per.id = r.medico_id
     JOIN receta_items ri ON ri.receta_id = r.id
     JOIN medicamentos med ON med.id = ri.medicamento_id
     WHERE r.caso_id = $1 AND r.estado = 'emitida'
     ORDER BY r.emitido_en ASC, ri.orden ASC`,
    [casoId]
  );
  return result.rows;
}

// Devuelve null (nunca un bloque vacío) cuando el caso no tiene ninguna
// receta emitida todavía — mismo criterio de "nunca insertar secciones
// vacías" que ya aplican Dashboard e Informe para sus propias secciones.
export function construirBloquePrescripciones(
  filas: {
    id: string;
    emitido_en: string;
    medico_nombre: string;
    medicamento_nombre: string;
    concentracion: string | null;
    dosis: string;
    frecuencia: string;
    duracion: string;
    via_administracion: string;
  }[]
): string | null {
  if (filas.length === 0) return null;

  const recetasPorId = new Map<string, { emitido_en: string; medico_nombre: string; items: string[] }>();
  const ordenRecetas: string[] = [];
  for (const fila of filas) {
    if (!recetasPorId.has(fila.id)) {
      recetasPorId.set(fila.id, { emitido_en: fila.emitido_en, medico_nombre: fila.medico_nombre, items: [] });
      ordenRecetas.push(fila.id);
    }
    recetasPorId.get(fila.id)!.items.push(
      `- ${fila.medicamento_nombre}${fila.concentracion ? ` (${fila.concentracion})` : ""}: ` +
        `${fila.dosis}, ${fila.frecuencia}, ${fila.duracion}, vía ${fila.via_administracion}`
    );
  }

  const bloques = ordenRecetas.map((id) => {
    const r = recetasPorId.get(id)!;
    const fecha = new Date(r.emitido_en).toISOString().slice(0, 10);
    return `Receta emitida el ${fecha} por ${r.medico_nombre}:\n${r.items.join("\n")}`;
  });

  return (
    "Historial de prescripciones de este caso (recetas YA EMITIDAS — tenelas en cuenta al " +
    "razonar sobre mensajes nuevos, al generar el Dashboard/Informe, y sobre todo al validar " +
    "una receta nueva contra duplicidad terapéutica; nunca las repitas como si fueran una " +
    "prescripción recién indicada):\n\n" +
    bloques.join("\n\n")
  );
}

// Inserta el bloque (si existe) como un par user/assistant sintético
// ANTES del historial real de mensajes — junto a los mensajes, NO en el
// bloque de system prompt cacheado (ver prompt_receta_contexto_caso.md:
// esto es dinámico por caso, igual que los mensajes, nunca debe
// cachearse como si fuera parte de las Project Instructions o la Base
// de Conocimiento). Si no hay recetas emitidas, no toca el array.
export function insertarBloquePrescripciones<T extends { role: "user" | "assistant"; content: unknown }>(
  mensajes: T[],
  bloque: string | null
): T[] {
  if (!bloque) return mensajes;
  return [
    { role: "user", content: bloque } as T,
    { role: "assistant", content: "Entendido — tengo presente el historial de prescripciones de este caso." } as T,
    ...mensajes,
  ];
}

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

// Tool tal como la definió el usuario en dashboard_schema.json — se usa
// TAL CUAL, sin reescribirla. name/description/input_schema copiados
// verbatim (solo transcriptos de JSON a objeto TS). Generalizada a
// cualquier agente clínico (GCIS, ICIS, etc.) — ver
// prompt_generalizar_dashboard_informe.md.
const DASHBOARD_TOOL = {
  name: "generar_dashboard",
  description:
    "Genera el Dashboard clínico estructurado del caso actual, siguiendo estrictamente las zonas, " +
    "componentes y reglas de aparición condicional definidas en la Dashboard Functional Specification " +
    "del agente correspondiente al caso (GCIS-DASH-001 o ICIS-DASH-001, según el agente que lleva el " +
    "caso). Nunca completes un campo de tendencia u opcional si no se cumple el umbral mínimo de datos " +
    "especificado en su descripción — dejalo como null en ese caso. Nunca insertes componentes vacíos o decorativos.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "meta",
      "executive_summary",
      "clinical_state",
      "clinical_confidence",
      "active_problems",
      "alertas",
      "trends",
      "differential_diagnosis",
      "knowledge_match",
      "clinical_reasoning_journal",
      "referral_recommendation",
    ],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["estado_generacion"],
        properties: {
          estado_generacion: {
            type: "string",
            enum: ["sin_datos", "generado"],
            description:
              "Red de seguridad: si pese a haber pasado el filtro inicial del backend detectás que " +
              "el caso no tiene información clínica suficiente para un Dashboard con sentido, devolvé " +
              "'sin_datos' y dejá el resto de los campos raíz en null.",
          },
        },
      },
      executive_summary: {
        type: ["object", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Siempre presente en caso contrario (Zona 1, Sección 4).",
        additionalProperties: false,
        required: ["resumen", "paciente", "contexto_racial"],
        properties: {
          resumen: {
            type: "string",
            description: "2-3 líneas: lo esencial del caso, motivo de consulta y hallazgo principal.",
          },
          paciente: {
            type: "object",
            additionalProperties: false,
            required: ["nombre", "especie", "raza", "edad", "sexo", "peso_actual_kg"],
            properties: {
              nombre: { type: "string" },
              especie: { type: "string" },
              raza: { type: "string" },
              edad: { type: "string" },
              sexo: { type: "string" },
              peso_actual_kg: { type: ["number", "null"] },
            },
          },
          contexto_racial: {
            type: ["string", "null"],
            description:
              "Solo si existe un Breed Knowledge Object cargado (GCIS-KD-001) para esta raza. Ej: " +
              "'Raza con riesgo alto documentado para enteropatía perdedora de proteínas'. Nunca es " +
              "una conclusión diagnóstica por sí sola. Null si no aplica.",
          },
        },
      },
      clinical_state: {
        type: ["object", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Tomado literal del Clinical State Engine (Project Instructions).",
        additionalProperties: false,
        required: ["emoji", "estado", "justificacion"],
        properties: {
          emoji: {
            type: "string",
            enum: ["🟢", "🔵", "🟡", "🟠", "🔴", "⚫", "⚪"],
            description:
              "🟢 Remisión · 🔵 Estable · 🟡 Mejorando · 🟠 Respuesta parcial · 🔴 Empeorando · ⚫ Crítico · ⚪ Información insuficiente",
          },
          estado: {
            type: "string",
            enum: [
              "remision",
              "estable",
              "mejorando",
              "respuesta_parcial",
              "empeorando",
              "critico",
              "informacion_insuficiente",
            ],
          },
          justificacion: {
            type: "string",
            description: "Por qué se asignó este estado — siempre debe explicarse, nunca queda implícito.",
          },
        },
      },
      clinical_confidence: {
        type: ["object", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Indica calidad de evidencia, NUNCA probabilidad de enfermedad.",
        additionalProperties: false,
        required: ["nivel", "justificacion"],
        properties: {
          nivel: { type: "string", enum: ["alto", "moderado", "bajo"] },
          justificacion: { type: "string" },
        },
      },
      active_problems: {
        type: ["array", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Siempre presente en caso contrario, aunque sea con un solo problema (Zona 2).",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["problema", "severidad", "fuente"],
          properties: {
            problema: { type: "string" },
            severidad: { type: "string", enum: ["critico", "relevante", "seguimiento"] },
            fuente: {
              type: "string",
              description: "De dónde surge este problema, ej. 'bioquímica adjunta 31/07', 'reportado por propietario'.",
            },
          },
        },
      },
      alertas: {
        type: ["array", "null"],
        description:
          "Null si no hay ninguna alerta activa (interacciones fármaco-fármaco/raza, banderas rojas, etc.). No es un campo obligatorio como active_problems.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tipo", "descripcion", "nivel", "componente_origen"],
          properties: {
            tipo: { type: "string" },
            descripcion: { type: "string" },
            nivel: { type: "string", enum: ["alta", "media"] },
            componente_origen: { type: "string", description: "Ej. 'CC-302', 'CC-307', 'banderas rojas GI'." },
          },
        },
      },
      trends: {
        type: ["object", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Cada campo interno es independientemente null si " +
          "no cumple su umbral (Zona 3, Sección 5.2) — el objeto trends en sí siempre está presente cuando hay datos.",
        additionalProperties: false,
        required: [
          "weight_trend",
          "bcs_trend",
          "cbc_trend",
          "clinical_chemistry_trend",
          "imaging_comparison",
          "clinical_timeline",
          "treatment_timeline",
        ],
        properties: {
          weight_trend: {
            type: ["array", "null"],
            description: "Requiere >=2 pesos registrados en el expediente. Null si hay menos.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "peso_kg"],
              properties: { fecha: { type: "string" }, peso_kg: { type: "number" } },
            },
          },
          bcs_trend: {
            type: ["array", "null"],
            description: "Requiere >=2 valores de BCS registrados. Null si hay menos.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "bcs"],
              properties: { fecha: { type: "string" }, bcs: { type: "number" } },
            },
          },
          cbc_trend: {
            type: ["array", "null"],
            description: "Requiere >=3 hemogramas. Null si hay menos.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "parametro", "valor", "unidad", "rango_ref"],
              properties: {
                fecha: { type: "string" },
                parametro: { type: "string" },
                valor: { type: "number" },
                unidad: { type: "string" },
                rango_ref: { type: "string" },
              },
            },
          },
          clinical_chemistry_trend: {
            type: ["array", "null"],
            description: "Requiere >=2 perfiles bioquímicos. Null si hay menos.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "parametro", "valor", "unidad", "rango_ref"],
              properties: {
                fecha: { type: "string" },
                parametro: { type: "string" },
                valor: { type: "number" },
                unidad: { type: "string" },
                rango_ref: { type: "string" },
              },
            },
          },
          imaging_comparison: {
            type: ["array", "null"],
            description: "Requiere estudios de imagen seriados (más de uno del mismo tipo). Null si no hay.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "hallazgo"],
              properties: { fecha: { type: "string" }, hallazgo: { type: "string" } },
            },
          },
          clinical_timeline: {
            type: ["array", "null"],
            description: "Requiere >=2 consultas. Null si es la primera consulta del caso.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "evento"],
              properties: { fecha: { type: "string" }, evento: { type: "string" } },
            },
          },
          treatment_timeline: {
            type: ["array", "null"],
            description: "Requiere que haya habido al menos un cambio terapéutico documentado. Null si el tratamiento no ha cambiado.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "cambio"],
              properties: { fecha: { type: "string" }, cambio: { type: "string" } },
            },
          },
        },
      },
      differential_diagnosis: {
        type: ["array", "null"],
        description:
          "Requiere >=2 diagnósticos diferenciales activos (Zona 4, colapsada por defecto). Null si hay menos de 2, o si meta.estado_generacion = 'sin_datos'.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["diagnostico", "evidencia_a_favor", "evidencia_en_contra", "confianza", "informacion_faltante"],
          properties: {
            diagnostico: { type: "string" },
            evidencia_a_favor: { type: "array", items: { type: "string" } },
            evidencia_en_contra: { type: "array", items: { type: "string" } },
            confianza: { type: "string", enum: ["alta", "moderada", "baja"] },
            informacion_faltante: { type: "array", items: { type: "string" } },
          },
        },
      },
      knowledge_match: {
        type: ["array", "null"],
        description:
          "Solo si existen coincidencias reales y relevantes en la Base de Conocimiento (documentos_conocimiento " +
          "o casos similares previos). Null si no hay coincidencias — nunca forzar una referencia débil solo para llenar el campo.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["referencia", "relevancia"],
          properties: {
            referencia: { type: "string" },
            relevancia: { type: "string" },
          },
        },
      },
      clinical_reasoning_journal: {
        type: ["array", "null"],
        description:
          "Registro de hipótesis activas/descartadas a lo largo del caso (Zona 4). Null solo si " +
          "meta.estado_generacion = 'sin_datos' o si el caso es demasiado incipiente para tener hipótesis registradas todavía.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "hipotesis", "estado", "motivo"],
          properties: {
            fecha: { type: "string" },
            hipotesis: { type: "string" },
            estado: { type: "string", enum: ["activa", "descartada"] },
            motivo: { type: "string" },
          },
        },
      },
      referral_recommendation: {
        type: ["object", "null"],
        description:
          "EXCLUSIVO de ICIS (CC-260/261/262, Referral Engine Specification ICIS-REF-001). Siempre " +
          "null en casos de GCIS u otros agentes que no tengan motor de derivación. En ICIS, null solo " +
          "si el caso fue clasificado como 'manejable en atención primaria' — si se clasificó como " +
          "derivación no urgente o urgente, este campo es obligatorio.",
        additionalProperties: false,
        required: ["clasificacion", "especialidad_destino", "pregunta_clinica", "urgencia", "justificacion"],
        properties: {
          clasificacion: {
            type: "string",
            enum: ["manejable_atencion_primaria", "derivacion_no_urgente", "derivacion_urgente", "informacion_insuficiente"],
          },
          especialidad_destino: {
            type: ["string", "null"],
            description: "Null si clasificacion no implica derivación.",
          },
          pregunta_clinica: {
            type: ["string", "null"],
            description: "La pregunta clínica específica que el especialista debe resolver. Null si no aplica.",
          },
          urgencia: {
            type: ["string", "null"],
            enum: ["urgente", "no_urgente", null],
          },
          justificacion: {
            type: "string",
            description: "Por qué se llegó a esta clasificación — siempre presente, incluso si la clasificación es 'manejable en atención primaria'.",
          },
        },
      },
    },
  },
};

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
    const tipoConsumoDashboard = caso.dashboard_cache === null ? "clinico" : "regeneracion";

    // -----------------------------------------------------------------
    // ICIS (sin system_prompt) — stub sin cambios.
    // -----------------------------------------------------------------
    if (!caso.system_prompt) {
      const derivacionResult = await req.db!.query(
        `SELECT especialidad_sugerida, prioridad, motivo
         FROM derivaciones WHERE caso_id = $1 ORDER BY creado_en DESC LIMIT 1`,
        [req.params.id]
      );

      const documentosContexto = await obtenerDocumentosParaContexto(
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

    // -----------------------------------------------------------------
    // Arma el mismo bloque de system prompt cacheado que usa el chat
    // (mismo texto byte a byte, para reusar el cache_control ephemeral
    // que ya paga el chat) + una instrucción adicional breve FUERA del
    // bloque cacheado, específica de esta llamada. La función compartida
    // ya resuelve Project Instructions + AI Reasoning Standard +
    // documentos_conocimiento del agente real del caso — no asume GCIS.
    // -----------------------------------------------------------------
    const documentos = await obtenerDocumentosParaContexto(
      req.db!,
      caso.agente_id,
      req.auth!.tenantId!
    );
    const bloqueDocumentos = construirBloqueDocumentos(documentos);
    const systemCacheado = `${caso.system_prompt}\n\n---\n\n${bloqueDocumentos}`;
    // Ajustes del área de trabajo, Prioridad 1 — mismo bloque y mismo
    // criterio de ubicación que el chat: después del bloque cacheado, sin
    // cache_control (ver contextoCaso.ts).
    const bloqueContextoCaso = await construirBloqueContextoCaso(req.db!, req.params.id);
    const bloqueRazaDocumento = await construirBloqueRazaDocumento(req.db!, req.params.id, req.auth!.tenantId ?? null);
    const instruccionDashboard =
      "A continuación se te pedirá generar el Dashboard clínico del caso mediante la tool " +
      "generar_dashboard, siguiendo estrictamente las reglas de aparición condicional de la " +
      "Dashboard Functional Specification del agente correspondiente a este caso, Sección 5.2 — " +
      "nunca completes un campo de tendencia si no se cumple el umbral mínimo de datos, dejalo en null.";

    // Mismo mecanismo que el chat real (LEFT JOIN a archivos + agrupado
    // por mensaje, bloques image/document por file_id_anthropic cuando el
    // archivo es imagen o pdf) — duplicado a propósito, ver nota de
    // cabecera sobre no tocar workspace.routes.ts. tipo IN ('consulta',
    // 'respuesta') — anotar vs consultar: los bloques de tipo='informacion'
    // no son turnos de conversación acá tampoco, mismo criterio que en el
    // chat real (ver informacionRegistrada.ts).
    const historialResult = await req.db!.query(
      `SELECT m.id, m.remitente, m.contenido,
              a.tipo AS archivo_tipo, a.file_id_anthropic
       FROM mensajes m
       LEFT JOIN archivos a ON a.mensaje_id = m.id
       WHERE m.caso_id = $1 AND m.tipo IN ('consulta', 'respuesta')
       ORDER BY m.creado_en ASC`,
      [req.params.id]
    );
    interface MensajeConArchivos {
      remitente: string;
      contenido: string;
      archivos: { tipo: string; fileId: string | null }[];
    }
    const mensajesPorId = new Map<string, MensajeConArchivos>();
    const ordenMensajes: string[] = [];
    for (const fila of historialResult.rows) {
      if (!mensajesPorId.has(fila.id)) {
        mensajesPorId.set(fila.id, { remitente: fila.remitente, contenido: fila.contenido, archivos: [] });
        ordenMensajes.push(fila.id);
      }
      if (fila.file_id_anthropic || fila.archivo_tipo) {
        mensajesPorId.get(fila.id)!.archivos.push({ tipo: fila.archivo_tipo, fileId: fila.file_id_anthropic });
      }
    }
    const mensajesParaClaude = ordenMensajes.map((id) => {
      const m = mensajesPorId.get(id)!;
      const role = (m.remitente === "medico" ? "user" : "assistant") as "user" | "assistant";
      const bloquesArchivo = m.archivos
        .filter((a) => a.fileId && (a.tipo === "imagen" || a.tipo === "pdf"))
        .map((a) =>
          a.tipo === "imagen"
            ? ({ type: "image" as const, source: { type: "file" as const, file_id: a.fileId! } })
            : ({ type: "document" as const, source: { type: "file" as const, file_id: a.fileId! } })
        );
      if (bloquesArchivo.length === 0) {
        return { role, content: m.contenido };
      }
      return { role, content: [{ type: "text" as const, text: m.contenido }, ...bloquesArchivo] };
    });

    const recetasEmitidas = await obtenerRecetasEmitidasParaContexto(req.db!, req.params.id);
    const bloquePrescripciones = construirBloquePrescripciones(recetasEmitidas);
    const mensajesConPrescripciones = insertarBloquePrescripciones(mensajesParaClaude, bloquePrescripciones);

    // -----------------------------------------------------------------
    // Llamada real con tool_choice forzado a generar_dashboard.
    // -----------------------------------------------------------------
    let response;
    try {
      const anthropic = requerirAnthropic();
      response = await anthropic.beta.messages.create({
        model: MODELO_GCIS,
        // 4096 (valor sugerido originalmente) se probó insuficiente en la
        // práctica: contra el caso de Piki (historia clínica extensa), la
        // respuesta se cortó exactamente en tokens_salida=4096 con 3 de
        // los 10 campos raíz requeridos (differential_diagnosis,
        // knowledge_match, clinical_reasoning_journal) directamente
        // ausentes del JSON — no es un límite arbitrario, es el "ajustable"
        // que el pedido original ya anticipaba que habría que afinar.
        max_tokens: 8192,
        betas: ["files-api-2025-04-14"],
        system: [
          { type: "text", text: systemCacheado, cache_control: { type: "ephemeral" } },
          { type: "text", text: bloqueContextoCaso },
          ...(bloqueRazaDocumento ? [{ type: "text" as const, text: bloqueRazaDocumento }] : []),
          { type: "text", text: instruccionDashboard },
        ],
        messages: [
          ...mensajesConPrescripciones,
          {
            role: "user",
            content: "Generá el Dashboard clínico actualizado de este caso, usando la tool generar_dashboard.",
          },
        ],
        tools: [DASHBOARD_TOOL as any],
        tool_choice: { type: "tool", name: "generar_dashboard" },
      });
      await registrarExitoAnthropic();
    } catch (err) {
      console.error("Error al llamar a la API de Claude para el Dashboard", err);
      await registrarResultadoAnthropic(err);
      return res.status(502).json({ error: "No se pudo generar el Dashboard en este momento." });
    }

    const toolUseBlock = response.content.find(
      (b: any) => b.type === "tool_use" && b.name === "generar_dashboard"
    ) as any;
    if (!toolUseBlock) {
      console.error("La respuesta de Claude no incluyó el tool_use esperado para el Dashboard", response);
      return res.status(502).json({ error: "No se pudo generar el Dashboard en este momento." });
    }

    // El backend siempre pisa caso_id/generado_en — nunca confía en que
    // el modelo los complete (ni el schema se los pide: meta solo exige
    // estado_generacion). Si el modelo devolvió "sin_datos" pese a haber
    // pasado la compuerta, se respeta tal cual — no se sobreescribe.
    const dashboardGenerado = toolUseBlock.input as Record<string, any>;
    dashboardGenerado.meta = {
      ...(dashboardGenerado.meta ?? {}),
      caso_id: req.params.id,
      generado_en: new Date().toISOString(),
    };

    const medicoAgenteResult = await req.db!.query(
      `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2`,
      [req.auth!.userId, caso.agente_id]
    );
    const medicoAgenteId = medicoAgenteResult.rows[0]?.id ?? null;

    const usage = response.usage;
    const tokensCacheEscritura = usage.cache_creation_input_tokens ?? 0;
    const tokensCacheLectura = usage.cache_read_input_tokens ?? 0;

    // Llamada separada del chat — fila propia en uso_api, no se mezcla con
    // el consumo de POST /casos/:id/mensajes. tipoConsumoDashboard ya se
    // determinó arriba, antes de sobreescribir dashboard_cache más abajo.
    await registrarUsoApi(req.db!, {
      tenantId: req.auth!.tenantId!,
      casoId: req.params.id,
      medicoAgenteId,
      personaId: req.auth!.userId,
      modelo: MODELO_GCIS,
      tokensEntrada: usage.input_tokens,
      tokensSalida: usage.output_tokens,
      tokensCacheEscritura,
      tokensCacheLectura,
      tipoConsumo: tipoConsumoDashboard,
      disparadoPor: "usuario",
    });

    // Persiste como cache solo si realmente se generó — un "sin_datos"
    // devuelto por el modelo pese a pasar la compuerta, o cualquier falla
    // previa, no debe pisar un Dashboard bueno que ya existiera (ver
    // prompt_dashboard_persistencia.md Fase B.1).
    if (dashboardGenerado.meta.estado_generacion === "generado") {
      await req.db!.query(
        `UPDATE casos SET dashboard_cache = $1, dashboard_generado_en = $2 WHERE id = $3`,
        [JSON.stringify(dashboardGenerado), dashboardGenerado.meta.generado_en, req.params.id]
      );
    }

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
    res.json({
      dashboard: fila.dashboard_cache ?? null,
      generado_en: fila.dashboard_generado_en ?? null,
      hayInformacionPosterior: fila.hay_informacion_posterior,
    });
  } catch (err) {
    console.error("GET /casos/:id/dashboard", err);
    res.status(500).json({ error: "Error al obtener el dashboard." });
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

// Tal como la definió el usuario en informe_schema.json — se usa TAL
// CUAL, sin reescribirla.
// Generalizada a cualquier agente clínico (GCIS, ICIS, etc.) — ver
// prompt_generalizar_dashboard_informe.md.
const INFORME_TOOL = {
  name: "generar_informe",
  description:
    "Genera el contenido estructurado del Clinical Consultation Report (CR-001) del caso actual, " +
    "siguiendo la Clinical Report Specification del agente correspondiente al caso (GCIS-REP-001 o " +
    "ICIS-REP-001). El backend ensambla el .docx final a partir de este JSON — vos solo producís el " +
    "contenido de texto/datos de cada sección, nunca el documento en sí. Nunca completes una sección " +
    "opcional si no hay datos reales que la sustenten en el caso — dejala en null. Las secciones " +
    "marcadas como 'siempre presente' deben completarse aunque sea indicando explícitamente la " +
    "ausencia de información (ej. 'sin estudios de imagen realizados hasta la fecha'), nunca " +
    "omitirse. Nunca insertes contenido genérico o de relleno.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "meta",
      "resumen_ejecutivo",
      "informacion_paciente",
      "motivo_consulta",
      "historia_clinica",
      "cronologia_clinica",
      "examen_fisico",
      "analisis_laboratorio",
      "estudios_imagen",
      "razonamiento_diagnostico",
      "diagnostico_diferencial",
      "referral_recommendation",
      "matriz_evidencia",
      "historial_terapeutico",
      "evolucion_clinica",
      "estado_clinico_actual",
      "manejo_nutricional",
      "consideraciones_farmacologicas",
      "recomendaciones",
      "pronostico",
      "referencias",
      "apendices",
    ],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["estado_generacion", "tipo_reporte"],
        properties: {
          estado_generacion: {
            type: "string",
            enum: ["sin_datos", "generado"],
            description:
              "Red de seguridad: si el caso no tiene información clínica suficiente para un informe " +
              "con sentido, devolvé 'sin_datos' y dejá el resto de los campos raíz (excepto meta) en null.",
          },
          tipo_reporte: { type: "string", enum: ["CR-001"] },
        },
      },

      resumen_ejecutivo: {
        type: ["object", "null"],
        description: "CRS-002. Siempre presente si estado_generacion='generado'. Máximo equivalente a una página.",
        additionalProperties: false,
        required: [
          "paciente_resumen",
          "problema_principal",
          "diagnostico_mas_probable",
          "estado_clinico_actual",
          "pronostico_resumen",
        ],
        properties: {
          paciente_resumen: { type: "string" },
          problema_principal: { type: "string" },
          diagnostico_mas_probable: { type: "string" },
          estado_clinico_actual: { type: "string" },
          pronostico_resumen: { type: "string" },
        },
      },

      informacion_paciente: {
        type: ["object", "null"],
        description: "CRS-003. Siempre presente.",
        additionalProperties: false,
        required: ["nombre", "especie", "raza", "sexo", "edad", "peso_kg", "bcs", "propietario", "veterinario_remitente"],
        properties: {
          nombre: { type: "string" },
          especie: { type: "string" },
          raza: { type: "string" },
          sexo: { type: "string" },
          edad: { type: "string" },
          peso_kg: { type: ["number", "null"] },
          bcs: { type: ["string", "null"] },
          propietario: { type: "string" },
          veterinario_remitente: { type: ["string", "null"] },
        },
      },

      motivo_consulta: {
        type: ["object", "null"],
        description: "CRS-004. Siempre presente.",
        additionalProperties: false,
        required: ["motivo", "tiempo_evolucion", "antecedentes_relevantes"],
        properties: {
          motivo: { type: "string" },
          tiempo_evolucion: { type: "string" },
          antecedentes_relevantes: { type: "string" },
        },
      },

      historia_clinica: {
        type: ["string", "null"],
        description:
          "CRS-005. Narrativa cronológica sintetizada por vos — nunca copiar notas textuales del chat. Siempre presente.",
      },

      cronologia_clinica: {
        type: ["array", "null"],
        description: "CRS-006. Null solo si es la primera consulta del caso sin eventos previos que cronologizar.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "evento"],
          properties: { fecha: { type: "string" }, evento: { type: "string" } },
        },
      },

      examen_fisico: {
        type: ["object", "null"],
        description: "CRS-007. Siempre presente si hubo examen físico registrado en el caso.",
        additionalProperties: false,
        required: ["hallazgos_por_sistema", "estado_general", "estado_nutricional", "hidratacion"],
        properties: {
          hallazgos_por_sistema: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sistema", "hallazgo"],
              properties: { sistema: { type: "string" }, hallazgo: { type: "string" } },
            },
          },
          estado_general: { type: "string" },
          estado_nutricional: { type: "string" },
          hidratacion: { type: "string" },
        },
      },

      analisis_laboratorio: {
        type: ["array", "null"],
        description: "CRS-008. Null si no hay laboratorios adjuntos al caso. Valores siempre como tabla con datos originales, nunca parafraseados.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "tipo_estudio", "valores", "comentario_interpretativo"],
          properties: {
            fecha: { type: "string" },
            tipo_estudio: { type: "string", description: "Ej. 'Hemograma completo', 'Bioquímica sérica', 'Urianálisis'." },
            valores: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["parametro", "valor", "unidad", "rango_ref", "fuera_de_rango"],
                properties: {
                  parametro: { type: "string" },
                  valor: { type: "string" },
                  unidad: { type: "string" },
                  rango_ref: { type: "string" },
                  fuera_de_rango: { type: "boolean" },
                },
              },
            },
            comentario_interpretativo: { type: "string" },
          },
        },
      },

      estudios_imagen: {
        type: ["array", "null"],
        description: "CRS-009. Null si no hay estudios de imagen en el caso.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "tipo_estudio", "resumen", "hallazgos", "interpretacion"],
          properties: {
            fecha: { type: "string" },
            tipo_estudio: { type: "string" },
            resumen: { type: "string" },
            hallazgos: { type: "string" },
            interpretacion: { type: "string" },
          },
        },
      },

      razonamiento_diagnostico: {
        type: ["string", "null"],
        description:
          "CRS-010. La sección más importante del informe — explicación paso a paso de cómo se llegó al " +
          "diagnóstico o sospecha diagnóstica, no solo el resultado. Siempre presente.",
      },

      diagnostico_diferencial: {
        type: ["array", "null"],
        description: "CRS-011. Null solo si hay un único diagnóstico confirmado sin diferenciales activos.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["diagnostico", "probabilidad", "evidencia", "estado"],
          properties: {
            diagnostico: { type: "string" },
            probabilidad: { type: "string", enum: ["alta", "moderada", "baja"] },
            evidencia: { type: "string" },
            estado: { type: "string", enum: ["activo", "descartado"] },
          },
        },
      },

      referral_recommendation: {
        type: ["object", "null"],
        description:
          "CRS-013. EXCLUSIVO de ICIS (Referral Engine Specification ICIS-REF-001) — siempre null en " +
          "informes de GCIS u otros agentes sin motor de derivación. En ICIS, null solo si el caso fue " +
          "clasificado como 'manejable en atención primaria'.",
        additionalProperties: false,
        required: ["clasificacion", "especialidad_destino", "pregunta_clinica", "urgencia", "justificacion"],
        properties: {
          clasificacion: {
            type: "string",
            enum: ["manejable_atencion_primaria", "derivacion_no_urgente", "derivacion_urgente", "informacion_insuficiente"],
          },
          especialidad_destino: { type: ["string", "null"] },
          pregunta_clinica: {
            type: ["string", "null"],
            description: "La pregunta clínica específica que el especialista debe resolver.",
          },
          urgencia: { type: ["string", "null"], enum: ["urgente", "no_urgente", null] },
          justificacion: { type: "string" },
        },
      },

      matriz_evidencia: {
        type: ["array", "null"],
        description: "CRS-012. Toda afirmación clínicamente relevante del informe debe estar sustentada acá. Siempre presente si hay al menos un hallazgo clínico relevante.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["afirmacion", "evidencia_sustento", "fuente"],
          properties: {
            afirmacion: { type: "string" },
            evidencia_sustento: { type: "string" },
            fuente: { type: "string" },
          },
        },
      },

      historial_terapeutico: {
        type: ["array", "null"],
        description: "CRS-014. Null si no ha habido ningún tratamiento indicado todavía.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "tratamiento", "respuesta"],
          properties: {
            fecha: { type: "string" },
            tratamiento: { type: "string" },
            respuesta: { type: "string" },
          },
        },
      },

      evolucion_clinica: {
        type: ["string", "null"],
        description: "CRS-015. Narrativa longitudinal desde la primera consulta hasta hoy. Null si es la primera consulta del caso.",
      },

      estado_clinico_actual: {
        type: ["object", "null"],
        description: "CRS-016. Siempre presente. Mismo Clinical State Engine usado en el Dashboard.",
        additionalProperties: false,
        required: ["emoji", "estado", "explicacion"],
        properties: {
          emoji: { type: "string", enum: ["🟢", "🔵", "🟡", "🟠", "🔴", "⚫", "⚪"] },
          estado: {
            type: "string",
            enum: ["remision", "estable", "mejorando", "respuesta_parcial", "empeorando", "critico", "informacion_insuficiente"],
          },
          explicacion: { type: "string" },
        },
      },

      manejo_nutricional: {
        type: ["object", "null"],
        description: "CRS-021. Null si no hay registro dietario (CC-306) en el caso.",
        additionalProperties: false,
        required: ["dieta_actual", "objetivo_terapeutico", "fuente_indicacion", "extras_no_controlados", "alerta_ensayo_eliminacion"],
        properties: {
          dieta_actual: { type: "array", items: { type: "string" } },
          objetivo_terapeutico: { type: "string" },
          fuente_indicacion: { type: "string" },
          extras_no_controlados: { type: "array", items: { type: "string" } },
          alerta_ensayo_eliminacion: {
            type: ["string", "null"],
            description: "Si hay una dieta de eliminación activa: tiempo transcurrido vs. punto de decisión esperado (3 semanas / ~12 semanas). Null si no aplica.",
          },
        },
      },

      consideraciones_farmacologicas: {
        type: ["array", "null"],
        description: "CRS-022. Null si no hay alertas del motor de interacciones (CC-302) en el caso.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tipo_alerta", "descripcion", "nivel", "fuente"],
          properties: {
            tipo_alerta: { type: "string" },
            descripcion: { type: "string" },
            nivel: { type: "string", enum: ["alta", "media"] },
            fuente: { type: "string" },
          },
        },
      },

      recomendaciones: {
        type: ["object", "null"],
        description: "CRS-017. Siempre presente.",
        additionalProperties: false,
        required: ["terapeuticas", "estudios_sugeridos", "seguimiento", "monitoreo", "informacion_faltante", "riesgos"],
        properties: {
          terapeuticas: { type: "array", items: { type: "string" } },
          estudios_sugeridos: { type: "array", items: { type: "string" } },
          seguimiento: { type: "string" },
          monitoreo: { type: "array", items: { type: "string" } },
          informacion_faltante: { type: "array", items: { type: "string" } },
          riesgos: { type: "array", items: { type: "string" } },
        },
      },

      pronostico: {
        type: ["object", "null"],
        description: "CRS-018. Siempre presente.",
        additionalProperties: false,
        required: ["categoria", "justificacion"],
        properties: {
          categoria: { type: "string", enum: ["favorable", "reservado", "grave", "incierto", "pendiente_evaluacion_especialista"] },
          justificacion: { type: "string" },
        },
      },

      referencias: {
        type: ["array", "null"],
        description: "CRS-019. Null si el razonamiento no se apoyó en literatura, casos similares ni documentos de banderas rojas específicos.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tipo", "referencia", "detalle"],
          properties: {
            tipo: { type: "string", enum: ["literatura", "caso_similar", "banderas_rojas", "otro"] },
            referencia: { type: "string" },
            detalle: { type: "string" },
          },
        },
      },

      apendices: {
        type: ["array", "null"],
        description: "CRS-020. Datos de soporte completos (tablas extendidas de laboratorio, listados de estudios, etc.) que no caben cómodamente en el cuerpo del informe. Null si el caso es simple y todo el detalle ya cabe en las secciones principales.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["titulo", "contenido"],
          properties: {
            titulo: { type: "string" },
            contenido: { type: "string" },
          },
        },
      },
    },
  },
};

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

// Lee el ancho/alto real del PNG/JPEG (los dos únicos tipos que acepta la
// carga del logo — ver POST /admin/clinica/logo) para poder escalar el
// logo de la portada dentro de una caja máxima SIN estirarlo: un logo de
// clínica veterinaria típico es horizontal (4:1, 5:1...) y forzarlo a un
// tamaño fijo lo deforma. PNG: IHDR siempre en el mismo offset. JPEG: hay
// que caminar los marcadores hasta el primer SOF (0xC0 o 0xC2).
function dimensionesImagen(buffer: Buffer, tipo: "png" | "jpg"): { width: number; height: number } {
  if (tipo === "png") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  let i = 2;
  while (i < buffer.length - 9) {
    if (buffer[i] !== 0xff) {
      i++;
      continue;
    }
    const marcador = buffer[i + 1];
    if (marcador === 0xc0 || marcador === 0xc2) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    const largo = buffer.readUInt16BE(i + 2);
    i += 2 + largo;
  }
  return { width: 180, height: 60 };
}

// Ajusta a la caja máxima (mismo footprint visual que antes) preservando
// la proporción real — igual criterio que .export-header img del HTML
// del Dashboard (height fijo, width automático).
function escalarDentroDeCaja(
  anchoReal: number,
  altoReal: number,
  anchoMax: number,
  altoMax: number
): { width: number; height: number } {
  const escala = Math.min(anchoMax / anchoReal, altoMax / altoReal);
  return { width: Math.round(anchoReal * escala), height: Math.round(altoReal * escala) };
}

const ESTADO_CASO_LABEL: Record<string, string> = {
  triage: "Triage",
  en_curso: "En curso",
  completado: "Completado",
};

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

function celda(
  texto: string,
  opts: { bold?: boolean; color?: string; shadingFill?: string } = {}
): TableCell {
  return new TableCell({
    shading: opts.shadingFill ? { fill: opts.shadingFill } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: texto, bold: opts.bold, color: opts.color, size: 20 })],
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
  try {
    const casoResult = await req.db!.query(
      `SELECT c.id, c.agente_id, c.estado, c.motivo, c.numero_expediente,
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

    // -----------------------------------------------------------------
    // Mismo bloque de system prompt cacheado que el chat y el Dashboard
    // (byte a byte) para reusar el cache_control ephemeral ya pagado.
    // -----------------------------------------------------------------
    const documentos = await obtenerDocumentosParaContexto(req.db!, caso.agente_id, req.auth!.tenantId!);
    const bloqueDocumentos = construirBloqueDocumentos(documentos);
    const systemCacheado = `${caso.system_prompt}\n\n---\n\n${bloqueDocumentos}`;
    // Ajustes del área de trabajo, Prioridad 1 — mismo criterio que el
    // chat y el Dashboard (ver contextoCaso.ts).
    const bloqueContextoCaso = await construirBloqueContextoCaso(req.db!, req.params.id);
    const bloqueRazaDocumento = await construirBloqueRazaDocumento(req.db!, req.params.id, req.auth!.tenantId ?? null);
    const instruccionInforme =
      "A continuación se te pedirá generar el contenido del Informe de Consulta Clínica (CR-001) del caso " +
      "mediante la tool generar_informe, siguiendo estrictamente la Clinical Report Specification del " +
      "agente correspondiente a este caso y sus reglas de sección condicional — nunca completes una " +
      "sección opcional sin datos reales que la sustenten. En las secciones de texto libre (Historia " +
      "Clínica, Razonamiento Diagnóstico, Evolución Clínica, apéndices): si subdividís el contenido " +
      "internamente, marcá esa subdivisión con un encabezado de nivel 2 (## Título), nunca con negrita a " +
      "modo de título — la negrita queda solo para destacar una palabra o frase dentro de un párrafo. Si " +
      "anunciás una cantidad de partes o elementos, esa cantidad tiene que coincidir exactamente con lo " +
      "que enumerás después.";

    // Mismo mecanismo que el chat real y el Dashboard (duplicado a
    // propósito, ver nota de cabecera). tipo IN ('consulta','respuesta') —
    // ver mismo comentario en el historial del Dashboard más arriba.
    const historialResult = await req.db!.query(
      `SELECT m.id, m.remitente, m.contenido,
              a.tipo AS archivo_tipo, a.file_id_anthropic
       FROM mensajes m
       LEFT JOIN archivos a ON a.mensaje_id = m.id
       WHERE m.caso_id = $1 AND m.tipo IN ('consulta', 'respuesta')
       ORDER BY m.creado_en ASC`,
      [req.params.id]
    );
    interface MensajeConArchivos {
      remitente: string;
      contenido: string;
      archivos: { tipo: string; fileId: string | null }[];
    }
    const mensajesPorId = new Map<string, MensajeConArchivos>();
    const ordenMensajes: string[] = [];
    for (const fila of historialResult.rows) {
      if (!mensajesPorId.has(fila.id)) {
        mensajesPorId.set(fila.id, { remitente: fila.remitente, contenido: fila.contenido, archivos: [] });
        ordenMensajes.push(fila.id);
      }
      if (fila.file_id_anthropic || fila.archivo_tipo) {
        mensajesPorId.get(fila.id)!.archivos.push({ tipo: fila.archivo_tipo, fileId: fila.file_id_anthropic });
      }
    }
    const mensajesParaClaude = ordenMensajes.map((id) => {
      const m = mensajesPorId.get(id)!;
      const role = (m.remitente === "medico" ? "user" : "assistant") as "user" | "assistant";
      const bloquesArchivo = m.archivos
        .filter((a) => a.fileId && (a.tipo === "imagen" || a.tipo === "pdf"))
        .map((a) =>
          a.tipo === "imagen"
            ? ({ type: "image" as const, source: { type: "file" as const, file_id: a.fileId! } })
            : ({ type: "document" as const, source: { type: "file" as const, file_id: a.fileId! } })
        );
      if (bloquesArchivo.length === 0) {
        return { role, content: m.contenido };
      }
      return { role, content: [{ type: "text" as const, text: m.contenido }, ...bloquesArchivo] };
    });

    const recetasEmitidas = await obtenerRecetasEmitidasParaContexto(req.db!, req.params.id);
    const bloquePrescripciones = construirBloquePrescripciones(recetasEmitidas);
    const mensajesConPrescripciones = insertarBloquePrescripciones(mensajesParaClaude, bloquePrescripciones);

    // -----------------------------------------------------------------
    // Llamada real con tool_choice forzado a generar_informe.
    // max_tokens generoso (contenido más extenso que el Dashboard) —
    // verificado explícitamente contra el caso de Piki, sin truncarse.
    // -----------------------------------------------------------------
    let response;
    try {
      const anthropic = requerirAnthropic();
      response = await anthropic.beta.messages.create({
        model: MODELO_GCIS,
        // 8192 (mismo valor que terminó sirviendo para el Dashboard) se
        // probó insuficiente acá: contra el caso de Piki, tokens_salida
        // salió exactamente 8192 y 8 de las secciones "siempre presente"
        // (razonamiento_diagnostico, estado_clinico_actual, recomendaciones,
        // diagnostico_diferencial, historial_terapeutico, manejo_nutricional,
        // consideraciones_farmacologicas, referencias) llegaron en null —
        // el informe es más extenso que el Dashboard, como ya anticipaba
        // el pedido original.
        max_tokens: 16384,
        betas: ["files-api-2025-04-14"],
        system: [
          { type: "text", text: systemCacheado, cache_control: { type: "ephemeral" } },
          { type: "text", text: bloqueContextoCaso },
          ...(bloqueRazaDocumento ? [{ type: "text" as const, text: bloqueRazaDocumento }] : []),
          { type: "text", text: instruccionInforme },
        ],
        messages: [
          ...mensajesConPrescripciones,
          {
            role: "user",
            content: "Generá el Informe de Consulta Clínica (CR-001) de este caso, usando la tool generar_informe.",
          },
        ],
        tools: [INFORME_TOOL as any],
        tool_choice: { type: "tool", name: "generar_informe" },
      });
      await registrarExitoAnthropic();
    } catch (err) {
      console.error("Error al llamar a la API de Claude para el Informe", err);
      await registrarResultadoAnthropic(err);
      return res.status(502).json({ error: "No se pudo generar el informe en este momento." });
    }

    const toolUseBlock = response.content.find(
      (b: any) => b.type === "tool_use" && b.name === "generar_informe"
    ) as any;
    if (!toolUseBlock) {
      console.error("La respuesta de Claude no incluyó el tool_use esperado para el Informe", response);
      return res.status(502).json({ error: "No se pudo generar el informe en este momento." });
    }

    const informeGenerado = toolUseBlock.input as Record<string, any>;
    if (informeGenerado.meta?.estado_generacion === "sin_datos") {
      return res.status(422).json({ error: "No se pudo generar un informe con datos suficientes para este caso." });
    }

    const medicoAgenteResult = await req.db!.query(
      `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2`,
      [req.auth!.userId, caso.agente_id]
    );
    const medicoAgenteId = medicoAgenteResult.rows[0]?.id ?? null;

    const usage = response.usage;
    const tokensCacheEscritura = usage.cache_creation_input_tokens ?? 0;
    const tokensCacheLectura = usage.cache_read_input_tokens ?? 0;

    // Llamada separada del Dashboard y del chat — fila propia en uso_api.
    // El Informe siempre cuenta como consumo clínico: a diferencia del
    // Dashboard, no se regenera en el sentido de reemplazar un resultado
    // previo — cada generación queda persistida como un informe nuevo
    // (ver informes_generados).
    await registrarUsoApi(req.db!, {
      tenantId: req.auth!.tenantId!,
      casoId: req.params.id,
      medicoAgenteId,
      personaId: req.auth!.userId,
      modelo: MODELO_GCIS,
      tokensEntrada: usage.input_tokens,
      tokensSalida: usage.output_tokens,
      tokensCacheEscritura,
      tokensCacheLectura,
      tipoConsumo: esCortesia ? "cortesia" : "clinico",
      disparadoPor: "usuario",
    });

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
    try {
      await req.db!.query(
        `INSERT INTO informes_generados (tenant_id, caso_id, medico_id, tipo_reporte, contenido_docx, nombre_archivo, es_cortesia)
         VALUES ($1, $2, $3, 'CR-001', $4, $5, $6)`,
        [req.auth!.tenantId, req.params.id, req.auth!.userId, buffer, nombreArchivo, esCortesia]
      );
    } catch (err) {
      console.error("Error al persistir el informe en informes_generados (no bloquea la descarga)", err);
    }

    // prompt_code_notificaciones_pendientes.md, C3 — avisa que el informe
    // está disponible, sin adjuntarlo (decisión confirmada: es el
    // veterinario quien controla cuándo y cómo se comunica el contenido
    // clínico). No debería bloquear la descarga tampoco.
    try {
      // prompt_code_paciente_nacimiento_estado.md, Parte B2 — un paciente
      // fallecido no recibe ningún aviso.
      if (
        caso.paciente_estado === "activo" &&
        (await avisoActivo(req.db!, req.auth!.tenantId!, "informe_disponible_activo"))
      ) {
        await emitirNotificacion(req.db!, {
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
      }
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
