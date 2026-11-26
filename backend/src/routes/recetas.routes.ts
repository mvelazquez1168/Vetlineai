import { Router } from "express";
import { registrarInteraccion } from "../crm/interacciones";
import { PoolClient } from "pg";
import PDFDocument from "pdfkit";
import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "../almacenamiento";
import { conAlcanceTenant } from "../alcanceTenant";
import { requerirAnthropic } from "../anthropic";
import { authenticate, withTenantClient } from "../middleware/auth";
import { registrarUsoApi, verificarAntesDeGenerar, mensajeRechazoGeneracion } from "../tarifas";
import {
  obtenerDocumentosParaContexto,
  construirBloqueDocumentos,
  obtenerRecetasEmitidasParaContexto,
  construirBloquePrescripciones,
  insertarBloquePrescripciones,
} from "./casos.routes";
import { construirBloqueRazaDocumento } from "../razaDocumento";
import { CACHE_PREFIJO_COMPARTIDO, HERRAMIENTAS_AGENTE } from "../herramientasAgente";
import { construirMensajesParaModelo } from "../archivosDelCaso";
import { registrarResultadoAnthropic, registrarExitoAnthropic } from "../proveedorIaEstado";
import { calcularEdadEfectiva } from "../edadPaciente";

// =====================================================================
// Módulo de Prescripción Médica — transversal a cualquier agente clínico
// (GCIS, ICIS, u otros a futuro). Nada acá referencia un agente
// específico: el único punto donde el agente importa es /validar, y ahí
// se resuelve dinámicamente vía caso.agente_id -> agentes.system_prompt,
// el mismo mecanismo que ya usa el chat/Dashboard/Informe.
// =====================================================================

export const recetasRouter = Router();

recetasRouter.use(authenticate, withTenantClient);

recetasRouter.use((req, res, next) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }
  next();
});

// MODELO_CLAUDE se repite acá y en workspace.routes.ts/casos.routes.ts a
// propósito (solo el identificador del modelo). El nombre "GCIS" en el
// comentario original de este archivo era solo el identificador del
// modelo de Anthropic usado (Claude), no tiene relación con el agente
// clínico GCIS — la tool_use en sí es agnóstica de agente. El precio se
// resuelve en tarifas_modelo vía backend/src/tarifas.ts (motor de
// crédito, bloque 1) — antes acá había además 4 constantes de precio y
// una copia de registrarUsoApi(), ya consolidadas ahí.
const MODELO_CLAUDE = "claude-sonnet-4-6";


function validacionInformacionInsuficiente(resumen: string) {
  return {
    meta: { estado_validacion: "informacion_insuficiente" as const },
    alertas: [] as any[],
    resumen_validacion: resumen,
  };
}

async function obtenerRecetaConItems(db: PoolClient, recetaId: string, medicoId: string) {
  // prompt_code_registro_atencion.md, Paso 3 — LEFT JOIN a propósito:
  // una receta sin caso (caso_id null) no debe desaparecer de GET
  // /recetas/:id. c.agente_id sale null en ese caso, que es exactamente
  // la señal que usa el frontend para deshabilitar "Validar con IA".
  const recetaResult = await db.query(
    `SELECT r.*, c.agente_id
     FROM recetas r
     LEFT JOIN casos c ON c.id = r.caso_id
     WHERE r.id = $1 AND r.medico_id = $2`,
    [recetaId, medicoId]
  );
  if (recetaResult.rows.length === 0) return null;

  const itemsResult = await db.query(
    `SELECT ri.*, m.nombre AS medicamento_nombre, m.presentacion, m.concentracion
     FROM receta_items ri
     JOIN medicamentos m ON m.id = ri.medicamento_id
     WHERE ri.receta_id = $1
     ORDER BY ri.orden ASC`,
    [recetaId]
  );
  return { receta: recetaResult.rows[0], items: itemsResult.rows };
}

// ---------------------------------------------------------------------
// GET /api/recetas/:id
// ---------------------------------------------------------------------
recetasRouter.get("/:id", async (req, res) => {
  try {
    const datos = await obtenerRecetaConItems(req.db!, req.params.id, req.auth!.userId);
    if (!datos) {
      return res.status(404).json({ error: "Receta no encontrada." });
    }
    res.json({ receta: datos.receta, items: datos.items });
  } catch (err) {
    console.error("GET /recetas/:id", err);
    res.status(500).json({ error: "Error al obtener la receta." });
  }
});

// ---------------------------------------------------------------------
// PUT /api/recetas/:id
// Editable mientras no esté 'emitida' — una vez emitida, es un documento
// legal ya entregado, no se puede alterar retroactivamente.
// ---------------------------------------------------------------------
recetasRouter.put("/:id", async (req, res) => {
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

  try {
    const recetaResult = await req.db!.query(
      `SELECT id, estado FROM recetas WHERE id = $1 AND medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (recetaResult.rows.length === 0) {
      return res.status(404).json({ error: "Receta no encontrada." });
    }
    if (recetaResult.rows[0].estado === "emitida") {
      return res.status(400).json({ error: "No se puede editar una receta que ya fue emitida." });
    }

    await req.db!.query(
      `UPDATE recetas SET instrucciones_generales = $1, instrucciones_propietario = $2 WHERE id = $3`,
      [instruccionesGenerales ?? null, instruccionesPropietario ?? null, req.params.id]
    );

    if (items) {
      await req.db!.query(`DELETE FROM receta_items WHERE receta_id = $1`, [req.params.id]);
      let orden = 0;
      for (const item of items) {
        await req.db!.query(
          `INSERT INTO receta_items (receta_id, medicamento_id, dosis, frecuencia, duracion, via_administracion, observaciones, orden)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.params.id,
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
    }

    const datos = await obtenerRecetaConItems(req.db!, req.params.id, req.auth!.userId);
    res.json({ receta: datos!.receta, items: datos!.items });
  } catch (err) {
    console.error("PUT /recetas/:id", err);
    res.status(500).json({ error: "Error al editar la receta." });
  }
});

// ---------------------------------------------------------------------
// POST /api/recetas/:id/validar
//
// Única fase donde el agente importa, y solo para decidir qué bloque de
// system prompt cacheado usar. El resto de la lógica es idéntica sin
// importar el agente del caso.
//
// prompt_code_registro_atencion.md, Paso 3 — sin caso no hay agente, así
// que no hay system_prompt con el que validar. La UI deshabilita el
// botón con una explicación (no lo oculta), pero este 422 es la
// verificación de fondo: nunca dependemos únicamente de que el frontend
// no deje llegar la petición.
//
// Anotado, no construido: las recetas sin caso son justamente las más
// rápidas (una visita de rutina, sin razonamiento clínico de por medio)
// y son las que hoy se quedan sin validación. Hay una salida natural a
// futuro que no depende de un agente/especialidad en absoluto: una
// validación de dosis solo necesita peso + especie + fármaco, no
// razonamiento de especialidad. El peso ya es un campo estructurado en
// `atenciones` (este mismo prompt) — cuando se decida construirla, sería
// una llamada a Claude con un system prompt general (no el del agente
// del caso), gateada por p.especie + item.dosis + atencion.peso en vez
// de c.agente_id. No es este prompt.
// ---------------------------------------------------------------------
recetasRouter.post("/:id/validar", async (req, res) => {
  try {
    const casoYPacienteResult = await req.db!.query(
      `SELECT r.id, r.caso_id, r.tenant_id,
              c.agente_id, a.system_prompt,
              p.especie, p.edad_anios
       FROM recetas r
       LEFT JOIN casos c ON c.id = r.caso_id
       LEFT JOIN agentes a ON a.id = c.agente_id
       JOIN pacientes p ON p.id = r.paciente_id
       WHERE r.id = $1 AND r.medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoYPacienteResult.rows.length === 0) {
      return res.status(404).json({ error: "Receta no encontrada." });
    }
    const fila = casoYPacienteResult.rows[0];
    if (!fila.caso_id) {
      return res.status(422).json({
        error: "Esta receta no está asociada a un caso, así que no se puede validar con IA. Podés emitirla directamente.",
      });
    }

    // Recibe el cliente en vez de tomar `req.db` de afuera: las ramas que
    // cortan antes del modelo la llaman dentro de la transacción de la
    // request, y la que guarda el resultado real la llama en la
    // transacción corta de después. Sin el parámetro, esa última usaría un
    // cliente ya devuelto al pool.
    const guardarValidacion = async (db: PoolClient, validacion: Record<string, any>) => {
      await db.query(
        `UPDATE recetas SET validacion_ia = $1, validado_en = now(), estado = 'validada' WHERE id = $2`,
        [JSON.stringify(validacion), req.params.id]
      );
    };

    // Agente sin system_prompt cargado todavía (ICIS en mock hoy) — no
    // hay bloque cacheado real que armar, así que no tiene sentido
    // llamar a Claude. No es "faltan datos del paciente" en sentido
    // estricto, pero el schema no tiene un enum dedicado para esto y es
    // el más cercano — el código no asume que esto sea permanente, el
    // día que ICIS tenga su Operational Manual esta rama deja de
    // dispararse sin ningún cambio acá.
    if (!fila.system_prompt) {
      const validacion = validacionInformacionInsuficiente(
        "El agente de este caso todavía no tiene su manual operativo cargado — la validación clínica automática no está disponible por ahora."
      );
      await guardarValidacion(req.db!, validacion);
      return res.json(validacion);
    }

    // Compuerta de datos mínimos del paciente. El prompt original pedía
    // chequear "especie, peso, edad" estructuralmente, pero pacientes NO
    // tiene columna de peso en este esquema, y edad_anios en la práctica
    // suele quedar NULL incluso en casos con historia clínica extensa
    // (ej. Piki: edad solo se conoce como "12-14 años estimados" dentro
    // del chat/documentos, nunca se cargó en la columna estructurada) —
    // exigir edad_anios NOT NULL dejaría esta validación inutilizable en
    // la práctica. Se chequea especie (sí confiable) + que haya
    // suficiente historial de mensajes para razonar sobre el caso, mismo
    // umbral que ya usan el Dashboard y el Informe.
    const mensajesCountResult = await req.db!.query(`SELECT COUNT(*) FROM mensajes WHERE caso_id = $1`, [
      fila.caso_id,
    ]);
    const cantidadMensajes = Number(mensajesCountResult.rows[0].count);
    if (!fila.especie || cantidadMensajes < 2) {
      const validacion = validacionInformacionInsuficiente(
        "El caso no tiene registrados los datos mínimos del paciente ni historial clínico suficiente para una validación."
      );
      await guardarValidacion(req.db!, validacion);
      return res.json(validacion);
    }

    // Motor de crédito, bloque 3 — verificación previa a la generación.
    const verificacionReceta = await verificarAntesDeGenerar(req.db!, {
      tenantId: req.auth!.tenantId!,
      agenteId: fila.agente_id,
      tipoOperacion: "receta",
      disparadoPor: "usuario",
    });
    if (!verificacionReceta.permitido) {
      return res.status(402).json({
        error: mensajeRechazoGeneracion(verificacionReceta.motivo!),
        motivo: verificacionReceta.motivo,
      });
    }

    const datos = await obtenerRecetaConItems(req.db!, req.params.id, req.auth!.userId);
    const items = datos!.items;

    // Mismo bloque cacheado que ya usa el chat de este caso — reusado,
    // no reescrito (obtenerDocumentosParaContexto/construirBloqueDocumentos
    // importados de casos.routes.ts).
    const documentos = await obtenerDocumentosParaContexto(req.db!, fila.agente_id, req.auth!.tenantId!);
    const bloqueDocumentos = construirBloqueDocumentos(documentos.clinicos);
    // Bloque B: solo lo mandan los caminos de generación. Va DESPUÉS del
    // bloque A y con su propio cache_control, así el prefijo del chat
    // (tools + A) sigue siendo un prefijo exacto de éste (tools + A + B) y
    // A se comparte entre los cuatro (ver migración 073).
    const bloqueGeneracion =
      documentos.generacion.length > 0 ? construirBloqueDocumentos(documentos.generacion) : null;
    const systemCacheado = `${fila.system_prompt}\n\n---\n\n${bloqueDocumentos}`;
    // Mismo criterio que chat/Dashboard/Informe — ver razaDocumento.ts.
    const bloqueRazaDocumento = await construirBloqueRazaDocumento(req.db!, fila.caso_id, req.auth!.tenantId ?? null);
    const instruccionValidacion =
      "A continuación se te pedirá validar el contenido de una receta propuesta por el médico mediante " +
      "la tool validar_receta. Esta validación es exclusivamente ADVISORIA: nunca aprueba, rechaza ni " +
      "bloquea la receta — el médico decide con la información que provees. Para la categoría " +
      "'duplicidad_terapeutica' en particular: revisá no solo los medicamentos dentro de esta misma " +
      "receta en borrador, sino también contra el bloque 'Historial de prescripciones de este caso' " +
      "(si está presente más abajo, junto al historial de mensajes) — un medicamento ya recetado en una " +
      "receta emitida anteriormente para este caso también cuenta como duplicidad terapéutica.";

    // Historial + adjuntos: mismo módulo compartido que el chat real, el
    // Dashboard y el informe (ver archivosDelCaso.ts).
    const { mensajes: mensajesParaClaude } = await construirMensajesParaModelo(req.db!, fila.caso_id);

    // Solo recetas 'emitida' de este caso — la que se está validando
    // ahora mismo sigue en 'borrador' en este punto (guardarBorrador() ya
    // corrió antes de llegar acá), así que nunca se compara contra sí
    // misma acá; eso lo sigue resolviendo el propio Claude mirando
    // textoReceta más abajo.
    const recetasEmitidas = await obtenerRecetasEmitidasParaContexto(req.db!, fila.caso_id);
    const bloquePrescripciones = construirBloquePrescripciones(recetasEmitidas);
    const mensajesConPrescripciones = insertarBloquePrescripciones(mensajesParaClaude, bloquePrescripciones);

    const textoReceta = items
      .map(
        (i: any) =>
          `- ${i.medicamento_nombre}${i.concentracion ? ` (${i.concentracion})` : ""}: ${i.dosis}, ` +
          `${i.frecuencia}, ${i.duracion}, vía ${i.via_administracion}` +
          (i.observaciones ? `, observaciones: ${i.observaciones}` : "")
      )
      .join("\n");

    // Acá se suelta la transacción de la request, antes de la llamada al
    // modelo — mismo patrón que chat, dashboard e informe. Todo lo de
    // arriba que llega hasta este punto es LECTURA: las dos ramas que
    // escriben (`guardarValidacion` para agente sin manual y para datos
    // insuficientes) devuelven la respuesta antes de llegar acá, dentro de
    // la transacción de la request.
    await req.cerrarTransaccion!();

    let response;
    try {
      const anthropic = requerirAnthropic();
      response = await anthropic.beta.messages.create({
        model: MODELO_CLAUDE,
        max_tokens: 4096,
        betas: ["files-api-2025-04-14"],
        system: [
          { type: "text", text: systemCacheado, cache_control: CACHE_PREFIJO_COMPARTIDO },
          ...(bloqueGeneracion
            ? [{ type: "text" as const, text: bloqueGeneracion, cache_control: CACHE_PREFIJO_COMPARTIDO }]
            : []),
          ...(bloqueRazaDocumento ? [{ type: "text" as const, text: bloqueRazaDocumento }] : []),
          { type: "text", text: instruccionValidacion },
        ],
        messages: [
          ...mensajesConPrescripciones,
          {
            role: "user",
            content:
              `Validá la siguiente receta propuesta para este caso, usando la tool validar_receta:\n\n${textoReceta}`,
          },
        ],
        tools: HERRAMIENTAS_AGENTE,
        tool_choice: { type: "tool", name: "validar_receta" },
      });
      await registrarExitoAnthropic();
    } catch (err) {
      console.error("Error al llamar a la API de Claude para validar la receta", err);
      await registrarResultadoAnthropic(err);
      return res.status(502).json({ error: "No se pudo validar la receta en este momento." });
    }

    const toolUseBlock = response.content.find(
      (b: any) => b.type === "tool_use" && b.name === "validar_receta"
    ) as any;
    if (!toolUseBlock) {
      console.error("La respuesta de Claude no incluyó el tool_use esperado para validar_receta", response);
      return res.status(502).json({ error: "No se pudo validar la receta en este momento." });
    }
    const validacion = toolUseBlock.input as Record<string, any>;

    const usage = response.usage;
    const tokensCacheEscritura = usage.cache_creation_input_tokens ?? 0;
    const tokensCacheLectura = usage.cache_read_input_tokens ?? 0;

    // Transacción corta de cierre: la validación guardada y el consumo van
    // juntos o no va ninguno — si se registrara el consumo aparte y
    // fallara, quedaría una receta validada y no cobrada (o al revés).
    await conAlcanceTenant(req.auth!.tenantId!, async (db) => {
      await guardarValidacion(db, validacion);

      const medicoAgenteResult = await db.query(
        `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2`,
        [req.auth!.userId, fila.agente_id]
      );

      await registrarUsoApi(db, {
        tenantId: req.auth!.tenantId!,
        casoId: fila.caso_id,
        medicoAgenteId: medicoAgenteResult.rows[0]?.id ?? null,
        personaId: req.auth!.userId,
        modelo: MODELO_CLAUDE,
        tokensEntrada: usage.input_tokens,
        tokensSalida: usage.output_tokens,
        tokensCacheEscritura,
        tokensCacheLectura,
        tipoConsumo: "clinico",
        disparadoPor: "usuario",
      });
    });

    res.json(validacion);
  } catch (err) {
    console.error("POST /recetas/:id/validar", err);
    res.status(500).json({ error: "Error al validar la receta." });
  }
});

// ---------------------------------------------------------------------
// POST /api/recetas/:id/emitir
//
// PDF idéntico sin importar el agente del caso — el logo es el de la
// clínica (tenants.logo_url), no del agente (AD-BRAND-01 en
// casos.routes.ts — decisión de producto, no reabrir). Las alertas de
// validacion_ia NUNCA se imprimen acá: ese documento es para el
// propietario, las alertas quedan solo en la interfaz del médico.
// ---------------------------------------------------------------------
recetasRouter.post("/:id/emitir", async (req, res) => {
  try {
    const recetaResult = await req.db!.query(
      `SELECT r.id, r.estado, r.caso_id, r.instrucciones_generales, r.instrucciones_propietario,
              p.nombre AS paciente_nombre, p.especie, ra.nombre AS raza, p.sexo, p.edad_anios, p.fecha_nacimiento,
              prop.nombre AS propietario_nombre,
              m.nombre AS medico_nombre, m.colegiatura AS medico_colegiatura,
              t.logo_url AS tenant_logo_url, t.zona_horaria
       FROM recetas r
       JOIN pacientes p ON p.id = r.paciente_id
       LEFT JOIN razas ra ON ra.id = p.raza_id
       JOIN propietarios prop ON prop.id = p.propietario_id
       JOIN personas m ON m.id = r.medico_id
       JOIN tenants t ON t.id = r.tenant_id
       WHERE r.id = $1 AND r.medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (recetaResult.rows.length === 0) {
      return res.status(404).json({ error: "Receta no encontrada." });
    }
    const receta = recetaResult.rows[0];
    receta.edad_anios = calcularEdadEfectiva(receta.fecha_nacimiento, receta.edad_anios);

    // La validación clínica es opcional (decisión del médico, igual que
    // ya lo es emitir pese a las alertas) — se puede emitir directo
    // desde 'borrador' sin pasar por /validar. Si nunca se validó,
    // validacion_ia/validado_en quedan en null (default de la tabla),
    // no se fuerza ningún valor acá.
    if (receta.estado !== "validada" && receta.estado !== "borrador") {
      return res.status(400).json({ error: "La receta ya fue emitida." });
    }

    if (!receta.tenant_logo_url) {
      return res.status(422).json({
        error: "La clínica no tiene un logo cargado. Subilo en Datos de la Clínica antes de emitir la receta.",
      });
    }
    let logoBuffer: Buffer;
    try {
      logoBuffer = await almacenamientoPublico.leer(claveLogoDesdeValorGuardado(receta.tenant_logo_url));
    } catch {
      return res.status(422).json({ error: "No se encontró el archivo del logo de la clínica en el servidor." });
    }

    const itemsResult = await req.db!.query(
      `SELECT ri.*, med.nombre AS medicamento_nombre
       FROM receta_items ri
       JOIN medicamentos med ON med.id = ri.medicamento_id
       WHERE ri.receta_id = $1
       ORDER BY ri.orden ASC`,
      [req.params.id]
    );

    const buffer = await generarPdfReceta({
      pacienteNombre: receta.paciente_nombre,
      especie: receta.especie,
      raza: receta.raza,
      sexo: receta.sexo,
      edadAnios: receta.edad_anios,
      propietarioNombre: receta.propietario_nombre,
      medicoNombre: receta.medico_nombre,
      medicoColegiatura: receta.medico_colegiatura,
      zonaHoraria: receta.zona_horaria,
      logoBuffer,
      instruccionesGenerales: receta.instrucciones_generales,
      instruccionesPropietario: receta.instrucciones_propietario,
      items: itemsResult.rows,
    });

    await req.db!.query(`UPDATE recetas SET estado = 'emitida', emitido_en = now() WHERE id = $1`, [
      req.params.id,
    ]);

    // CRM (prompt 03): la receta queda en la linea de tiempo cuando se
    // EMITE, no cuando se escribe. Una receta en borrador no es un
    // hecho de la relacion con el cliente todavia.
    await registrarInteraccion(req.db!, {
      tenantId: req.auth!.tenantId!,
      tipo: "receta_emitida",
      pacienteId: receta.paciente_id,
      origenTabla: "recetas",
      origenId: req.params.id,
      personaId: req.auth!.userId,
    });
    // prompt_code_cierre_caso.md, Paso 2, punto 2 — todos los puntos de
    // actividad tocan actualizado_en, no solo informacion/mensajes.
    // prompt_code_registro_atencion.md, Paso 3 — receta.caso_id puede ser
    // null (receta sin caso); explícito en vez de dejar que el WHERE
    // id = NULL no actualice nada por accidente.
    if (receta.caso_id) {
      await req.db!.query(`UPDATE casos SET actualizado_en = now() WHERE id = $1`, [receta.caso_id]);
    }

    const fechaArchivo = new Intl.DateTimeFormat("en-CA", {
      timeZone: receta.zona_horaria ?? "America/Costa_Rica",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const nombreArchivo = `Receta_${sanitizarNombreArchivo(receta.paciente_nombre)}_${fechaArchivo}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    res.send(buffer);
  } catch (err) {
    console.error("POST /recetas/:id/emitir", err);
    res.status(500).json({ error: "Error al emitir la receta." });
  }
});

function sanitizarNombreArchivo(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return limpio || "paciente";
}

interface DatosPdfReceta {
  pacienteNombre: string;
  especie: string;
  raza: string | null;
  sexo: string | null;
  edadAnios: number | null;
  propietarioNombre: string;
  medicoNombre: string;
  medicoColegiatura: string | null;
  zonaHoraria: string | null;
  logoBuffer: Buffer;
  instruccionesGenerales: string | null;
  instruccionesPropietario: string | null;
  items: {
    medicamento_nombre: string;
    dosis: string;
    frecuencia: string;
    duracion: string;
    via_administracion: string;
    observaciones: string | null;
  }[];
}

const PDF_COLOR_PRIMARIO = "#1B2A4A";
const PDF_COLOR_ACENTO = "#4A90D9";
const PDF_COLOR_MUTED = "#5A6B82";

function generarPdfReceta(datos: DatosPdfReceta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const buffers: Buffer[] = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    const fechaEmisionFmt = new Intl.DateTimeFormat("es", {
      timeZone: datos.zonaHoraria ?? "America/Costa_Rica",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date());

    // Header: logo + título.
    doc.image(datos.logoBuffer, 50, 45, { width: 130 });
    doc
      .fontSize(20)
      .fillColor(PDF_COLOR_PRIMARIO)
      .text("Receta Médica", 200, 55, { align: "right" });
    doc
      .fontSize(10)
      .fillColor(PDF_COLOR_MUTED)
      .text(`Fecha de emisión: ${fechaEmisionFmt}`, 200, 80, { align: "right" });
    doc.moveDown(3);
    doc.y = 130;

    // Datos del paciente.
    doc.fontSize(13).fillColor(PDF_COLOR_ACENTO).text("Datos del Paciente", 50, doc.y);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#000000");
    const edadTexto = datos.edadAnios != null ? `${datos.edadAnios} años` : "No registrada";
    const filasPaciente: [string, string][] = [
      ["Nombre", datos.pacienteNombre],
      ["Especie", datos.especie],
      ["Raza", datos.raza ?? "No registrada"],
      ["Sexo", datos.sexo ?? "No registrado"],
      ["Edad", edadTexto],
      ["Propietario", datos.propietarioNombre],
    ];
    for (const [campo, valor] of filasPaciente) {
      doc.font("Helvetica-Bold").text(`${campo}: `, 50, doc.y, { continued: true });
      doc.font("Helvetica").text(valor);
    }
    doc.moveDown(1);

    // Tabla de medicamentos.
    doc.fontSize(13).fillColor(PDF_COLOR_ACENTO).text("Medicamentos", 50, doc.y);
    doc.moveDown(0.3);

    // Anchos redistribuidos: Dosis/Frecuencia/Duración reducidos a lo que
    // su contenido típico realmente ocupa ("10 mg/kg", "Cada 12 horas",
    // "7 días"), el espacio liberado va a Observaciones (texto libre,
    // suele ser la columna más larga — ver prompt_ajuste_columnas_pdf_receta.md).
    // Medicamento y Vía quedan prácticamente igual que antes.
    const colX = { medicamento: 50, dosis: 165, frecuencia: 215, duracion: 280, via: 322, obs: 380 };
    const colWidth = { medicamento: 110, dosis: 46, frecuencia: 61, duracion: 38, via: 54, obs: 178 };
    const anchoTotal = 512;

    const dibujarEncabezadoTabla = () => {
      doc.rect(50, doc.y, anchoTotal, 20).fill(PDF_COLOR_PRIMARIO);
      const y = doc.y + 5;
      doc
        .fontSize(8)
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .text("Medicamento", colX.medicamento + 5, y, { width: colWidth.medicamento })
        .text("Dosis", colX.dosis + 2, y, { width: colWidth.dosis })
        .text("Frecuencia", colX.frecuencia + 2, y, { width: colWidth.frecuencia })
        .text("Duración", colX.duracion + 2, y, { width: colWidth.duracion })
        .text("Vía", colX.via + 2, y, { width: colWidth.via })
        .text("Observaciones", colX.obs + 2, y, { width: colWidth.obs });
      doc.y += 22;
    };

    dibujarEncabezadoTabla();

    for (const item of datos.items) {
      // Salto de página manual si no queda espacio — pdfkit no
      // auto-pagina contenido posicionado por coordenadas fijas.
      if (doc.y > 700) {
        doc.addPage();
        doc.y = 50;
        dibujarEncabezadoTabla();
      }
      const yFila = doc.y;
      doc
        .fontSize(8)
        .fillColor("#000000")
        .font("Helvetica")
        .text(item.medicamento_nombre, colX.medicamento + 5, yFila, { width: colWidth.medicamento })
        .text(item.dosis, colX.dosis + 2, yFila, { width: colWidth.dosis })
        .text(item.frecuencia, colX.frecuencia + 2, yFila, { width: colWidth.frecuencia })
        .text(item.duracion, colX.duracion + 2, yFila, { width: colWidth.duracion })
        .text(item.via_administracion, colX.via + 2, yFila, { width: colWidth.via })
        .text(item.observaciones ?? "—", colX.obs + 2, yFila, { width: colWidth.obs });
      // Altura de fila considerando las 6 columnas, no solo
      // Medicamento/Observaciones — con Dosis/Frecuencia/Duración/Vía
      // ahora más angostas, un valor atípicamente largo en cualquiera de
      // ellas también puede hacer wrap, y la fila tiene que crecer para
      // no solaparse con la siguiente (mismo criterio pedido para
      // Observaciones, aplicado de forma consistente a toda la fila).
      const alturaFila = Math.max(
        doc.heightOfString(item.medicamento_nombre, { width: colWidth.medicamento }),
        doc.heightOfString(item.dosis, { width: colWidth.dosis }),
        doc.heightOfString(item.frecuencia, { width: colWidth.frecuencia }),
        doc.heightOfString(item.duracion, { width: colWidth.duracion }),
        doc.heightOfString(item.via_administracion, { width: colWidth.via }),
        doc.heightOfString(item.observaciones ?? "—", { width: colWidth.obs }),
        14
      );
      doc.y = yFila + alturaFila + 8;
      doc
        .moveTo(50, doc.y - 4)
        .lineTo(50 + anchoTotal, doc.y - 4)
        .strokeColor("#E5E5E5")
        .stroke();
    }
    doc.moveDown(1.5);

    // Instrucciones.
    if (datos.instruccionesGenerales) {
      doc.fontSize(11).fillColor(PDF_COLOR_ACENTO).font("Helvetica-Bold").text("Instrucciones Generales");
      doc.fontSize(10).fillColor("#000000").font("Helvetica").text(datos.instruccionesGenerales);
      doc.moveDown(1);
    }
    if (datos.instruccionesPropietario) {
      doc
        .fontSize(11)
        .fillColor(PDF_COLOR_ACENTO)
        .font("Helvetica-Bold")
        .text("Instrucciones para el Propietario");
      doc.fontSize(10).fillColor("#000000").font("Helvetica").text(datos.instruccionesPropietario);
      doc.moveDown(1);
    }

    // Firma — datos reales del médico, nunca placeholder.
    if (doc.y > 680) {
      doc.addPage();
      doc.y = 50;
    }
    doc.moveDown(2);
    doc
      .fontSize(10)
      .fillColor(PDF_COLOR_MUTED)
      .text("_______________________________", 50, doc.y);
    doc
      .fontSize(10)
      .fillColor("#000000")
      .text(
        `Dr./Dra. ${datos.medicoNombre} — Colegiado N.º ${datos.medicoColegiatura ?? "no registrado"}`
      );

    doc.end();
  });
}
