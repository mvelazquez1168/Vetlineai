import { Router } from "express";
import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "../almacenamiento";
import { requerirAnthropic } from "../anthropic";
import { registrarLecturaSensible } from "../middleware/auditoria";
import { authenticate, withTenantClient } from "../middleware/auth";
import {
  obtenerDocumentosParaContexto,
  obtenerRecetasEmitidasParaContexto,
  construirBloquePrescripciones,
  insertarBloquePrescripciones,
} from "./casos.routes";
import { debeBloquearseMensaje, verificarUmbralesYNotificar } from "../usoIa";
import { registrarUsoApi, verificarAntesDeGenerar, mensajeRechazoGeneracion } from "../tarifas";
import { construirBloqueContextoCaso } from "../contextoCaso";
import { CACHE_PREFIJO_COMPARTIDO, HERRAMIENTAS_AGENTE } from "../herramientasAgente";
import { construirMensajesParaModelo } from "../archivosDelCaso";
import { calcularEdadEfectiva } from "../edadPaciente";
import { construirBloqueRazaDocumento } from "../razaDocumento";
import { construirBloqueInformacionRegistrada, TEXTO_DISPARADOR_ANALISIS } from "../informacionRegistrada";
import { obtenerEstadoSuscripcion, suscripcionBloqueaGeneracionIa } from "../purga";
import { asignarNumeroExpediente } from "../expediente";
import { fechaHoyEnZona } from "../fecha";
import { registrarResultadoAnthropic, registrarExitoAnthropic } from "../proveedorIaEstado";

export const workspaceRouter = Router();

// ---------------------------------------------------------------------
// Integración real con Claude — hoy solo para el agente GCIS
// (Gastroenterología), el único con agentes.system_prompt cargado (ver
// nota en POST /casos/:id/mensajes más abajo: la rama se elige por esa
// columna, no por el nombre del agente). El resto de los agentes (ICIS,
// etc.) sigue con generarRespuestaMock() sin cambios.
//
// El precio de este modelo se resuelve en tarifas_modelo (backend/src/tarifas.ts),
// no acá — ver motor de crédito, bloque 1.
const MODELO_GCIS = "claude-sonnet-4-6";

// Todas las rutas de este router requieren sesión + contexto de tenant.
workspaceRouter.use(authenticate, withTenantClient);

/**
 * Solo médicos pueden operar en el workspace. Un admin de clínica o staff
 * de plataforma que le pegue a estas rutas recibe 403.
 */
workspaceRouter.use((req, res, next) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }
  next();
});

// ---------------------------------------------------------------------
// GET /api/workspace/me
// Datos mínimos para el saludo del selector de agente (nombre del médico
// y nombre de la clínica).
// ---------------------------------------------------------------------
workspaceRouter.get("/me", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT p.nombre AS persona_nombre, t.nombre AS tenant_nombre, t.logo_url AS tenant_logo_url
       FROM personas p JOIN tenants t ON t.id = p.tenant_id
       WHERE p.id = $1`,
      [req.auth!.userId]
    );
    const persona = result.rows[0] ?? null;
    if (persona?.tenant_logo_url) {
      persona.tenant_logo_url = almacenamientoPublico.url(claveLogoDesdeValorGuardado(persona.tenant_logo_url));
    }
    res.json({ persona });
  } catch (err) {
    console.error("GET /workspace/me", err);
    res.status(500).json({ error: "Error al obtener el perfil." });
  }
});

// ---------------------------------------------------------------------
// GET /api/workspace/consumo
// Pantallas del médico (prompt 1 de implementación) — una sola llamada
// con todo lo que necesita la barra de consumo de prueba + los avisos de
// saldo: estado de la suscripción, crédito y días restantes si está en
// prueba, y el aviso vigente (uno solo, el más severo) si lo hay. Se
// consulta al entrar al workspace y después de cada generación — nunca
// calcula umbrales ni compone mensajes acá adentro, todo eso ya lo
// resolvió el motor de crédito (usoIa.ts) al escribir notificaciones_uso.
//
// Reconciliación antes de leer: notificaciones_uso registra "esto pasó",
// no "esto es cierto ahora" — un aviso queda sin leer hasta que alguien
// lo marca a mano o el ciclo avanza. Si se lee tal cual, un aviso puede
// seguir mostrándose después de que la condición que lo causó (colchón
// consumido, saldo bajo) ya se resolvió. Por eso se llama acá también a
// verificarUmbralesYNotificar — que además de insertar avisos nuevos,
// marca leídos los que ya dejaron de cumplirse — y no solo después de
// generar: el médico puede ver el banner con solo abrir el caso, sin
// haber mandado ningún mensaje todavía.
// ---------------------------------------------------------------------
workspaceRouter.get("/consumo", async (req, res) => {
  try {
    await verificarUmbralesYNotificar(req.db!, req.auth!.tenantId!);

    const suscripcionResult = await req.db!.query(
      `SELECT s.estado, s.periodo_inicio, s.periodo_fin
       FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
       WHERE t.id = $1`,
      [req.auth!.tenantId]
    );
    const suscripcion = suscripcionResult.rows[0];
    if (!suscripcion) {
      return res.status(404).json({ error: "No se encontró la suscripción de esta clínica." });
    }

    const saldoResult = await req.db!.query(
      `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1`,
      [req.auth!.tenantId]
    );
    const creditoPlan = Number(saldoResult.rows[0]?.credito_plan_usd ?? 0);
    const creditoComprado = Number(saldoResult.rows[0]?.credito_comprado_usd ?? 0);

    let prueba: { creditoRestanteUsd: number; diasRestantes: number; umbralAlcanzado: boolean } | null = null;
    let aviso: { umbral: string; mensaje: string } | null = null;

    if (suscripcion.estado === "prueba") {
      const diasRestantes = Math.max(
        Math.ceil((new Date(suscripcion.periodo_fin).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        0
      );
      const umbralResult = await req.db!.query(
        `SELECT 1 FROM notificaciones_uso
         WHERE tenant_id = $1 AND umbral IN ('trial_80', 'trial_agotado')
           AND leida = false AND fecha >= $2
         LIMIT 1`,
        [req.auth!.tenantId, suscripcion.periodo_inicio]
      );
      prueba = {
        creditoRestanteUsd: creditoPlan + creditoComprado,
        diasRestantes,
        umbralAlcanzado: umbralResult.rows.length > 0,
      };
    } else {
      // Orden de gravedad: colchon_agotado (genera detenida) primero, después
      // saldo_agotado (advertencia, todavía con colchón), después saldo_bajo
      // (informativo). Un tenant puede tener más de un aviso vigente a la
      // vez (ej. saldo_agotado y luego colchon_agotado del mismo ciclo) —
      // se muestra solo el más grave.
      const avisoResult = await req.db!.query(
        `SELECT umbral, mensaje
         FROM notificaciones_uso
         WHERE tenant_id = $1 AND umbral IN ('colchon_agotado', 'saldo_agotado', 'saldo_bajo')
           AND leida = false AND fecha >= $2
         ORDER BY CASE umbral
                    WHEN 'colchon_agotado' THEN 1
                    WHEN 'saldo_agotado' THEN 2
                    WHEN 'saldo_bajo' THEN 3
                  END
         LIMIT 1`,
        [req.auth!.tenantId, suscripcion.periodo_inicio]
      );
      aviso = avisoResult.rows[0] ?? null;
    }

    res.json({ estadoSuscripcion: suscripcion.estado, prueba, aviso });
  } catch (err) {
    console.error("GET /workspace/consumo", err);
    res.status(500).json({ error: "Error al obtener el consumo." });
  }
});

// ---------------------------------------------------------------------
// GET /api/workspace/agentes
// Agentes que este médico tiene asignados (vía medico_agente), con la
// cantidad de casos activos (no completados) para mostrar en el selector.
// ---------------------------------------------------------------------
workspaceRouter.get("/agentes", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT
         a.id, a.nombre, a.descripcion, a.icono, a.estado_catalogo, ma.rol,
         (SELECT COUNT(*) FROM casos c
            WHERE c.agente_id = a.id
              AND c.medico_id = $1
              AND c.estado <> 'completado') AS casos_activos
       FROM medico_agente ma
       JOIN agentes a ON a.id = ma.agente_id
       WHERE ma.persona_id = $1 AND ma.habilitado = true
       ORDER BY a.nombre`,
      [req.auth!.userId]
    );
    res.json({ agentes: result.rows });
  } catch (err) {
    console.error("GET /workspace/agentes", err);
    res.status(500).json({ error: "Error al listar agentes." });
  }
});

// ---------------------------------------------------------------------
// GET /api/workspace/pacientes
// Lista simple de pacientes del tenant, para el formulario de "Nuevo caso".
// ---------------------------------------------------------------------
workspaceRouter.get("/pacientes", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.especie, r.nombre AS raza, pr.nombre AS propietario
       FROM pacientes p
       JOIN propietarios pr ON pr.id = p.propietario_id
       LEFT JOIN razas r ON r.id = p.raza_id
       ORDER BY p.nombre`
    );
    res.json({ pacientes: result.rows });
  } catch (err) {
    console.error("GET /workspace/pacientes", err);
    res.status(500).json({ error: "Error al listar pacientes." });
  }
});

// ---------------------------------------------------------------------
// GET /api/workspace/casos?agenteId=...
// Casos del médico logueado para un agente puntual.
// ---------------------------------------------------------------------
workspaceRouter.get("/casos", async (req, res) => {
  const { agenteId } = req.query;
  if (!agenteId || typeof agenteId !== "string") {
    return res.status(400).json({ error: "Falta el parámetro agenteId." });
  }

  try {
    const result = await req.db!.query(
      `SELECT c.id, c.motivo, c.estado, c.severidad, c.confianza_diagnostica, c.creado_en, c.numero_expediente,
              p.nombre AS paciente_nombre, p.especie, r.nombre AS raza
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       LEFT JOIN razas r ON r.id = p.raza_id
       WHERE c.medico_id = $1 AND c.agente_id = $2
       ORDER BY c.actualizado_en DESC`,
      [req.auth!.userId, agenteId]
    );
    res.json({ casos: result.rows });
  } catch (err) {
    console.error("GET /workspace/casos", err);
    res.status(500).json({ error: "Error al listar casos." });
  }
});

// ---------------------------------------------------------------------
// GET /api/workspace/casos/:id
// Detalle completo de un caso: paciente, mensajes y derivación sugerida.
// ---------------------------------------------------------------------
workspaceRouter.get("/casos/:id", async (req, res) => {
  try {
    const casoResult = await req.db!.query(
      `SELECT c.id, c.motivo, c.estado, c.severidad, c.confianza_diagnostica, c.creado_en, c.numero_expediente,
              c.diagnostico_final, c.tratamiento_activo, c.tratamiento_activo_detalle, c.desenlace,
              c.cerrado_en, cerrador.nombre AS cerrado_por_nombre,
              c.motivo_reapertura, c.reabierto_en, reabridor.nombre AS reabierto_por_nombre,
              p.id AS paciente_id, p.nombre AS paciente_nombre, p.especie, r.nombre AS raza, p.sexo,
              p.edad_anios, p.fecha_nacimiento, p.estado AS paciente_estado,
              pr.id AS propietario_id, pr.nombre AS propietario_nombre,
              (a.system_prompt IS NOT NULL) AS agente_operativo
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN propietarios pr ON pr.id = p.propietario_id
       LEFT JOIN razas r ON r.id = p.raza_id
       JOIN agentes a ON a.id = c.agente_id
       LEFT JOIN personas cerrador ON cerrador.id = c.cerrado_por
       LEFT JOIN personas reabridor ON reabridor.id = c.reabierto_por
       WHERE c.id = $1 AND c.medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );

    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    casoResult.rows[0].edad_anios = calcularEdadEfectiva(
      casoResult.rows[0].fecha_nacimiento,
      casoResult.rows[0].edad_anios
    );

    // tipo incluido sin filtrar — el hilo completo se manda al frontend tal
    // cual (información registrada incluida, con su propio tratamiento
    // visual en MensajesLista); pendientesInformacion en CasoWorkspace
    // también depende de este campo para saber si "Analizar el caso" se
    // puede usar con la caja vacía.
    const mensajesResult = await req.db!.query(
      `SELECT id, remitente, contenido, tipo, creado_en
       FROM mensajes WHERE caso_id = $1 ORDER BY creado_en ASC`,
      [req.params.id]
    );

    // Cada mensaje trae sus archivos ya vinculados (archivos.mensaje_id) —
    // no hace falta guardar los ids adentro de `contenido`, la FK ya
    // relaciona archivo -> mensaje directamente.
    const archivosResult = await req.db!.query(
      `SELECT id, mensaje_id, nombre_archivo, tipo
       FROM archivos
       WHERE caso_id = $1 AND mensaje_id IS NOT NULL`,
      [req.params.id]
    );
    const archivosPorMensaje = new Map<string, { id: string; nombre_archivo: string; tipo: string }[]>();
    for (const a of archivosResult.rows) {
      const lista = archivosPorMensaje.get(a.mensaje_id) ?? [];
      lista.push({ id: a.id, nombre_archivo: a.nombre_archivo, tipo: a.tipo });
      archivosPorMensaje.set(a.mensaje_id, lista);
    }
    const mensajesConArchivos = mensajesResult.rows.map((m) => ({
      ...m,
      archivos: archivosPorMensaje.get(m.id) ?? [],
    }));

    const derivacionesResult = await req.db!.query(
      `SELECT especialidad_sugerida, prioridad, motivo
       FROM derivaciones WHERE caso_id = $1 ORDER BY creado_en DESC LIMIT 1`,
      [req.params.id]
    );

    // Lectura sensible: expediente clínico completo de un paciente.
    registrarLecturaSensible(req.auth!, `GET /api/workspace/casos/${req.params.id}`, "casos", req.params.id);

    res.json({
      caso: casoResult.rows[0],
      mensajes: mensajesConArchivos,
      derivacion: derivacionesResult.rows[0] ?? null,
    });
  } catch (err) {
    console.error("GET /workspace/casos/:id", err);
    res.status(500).json({ error: "Error al obtener el caso." });
  }
});

// ---------------------------------------------------------------------
// POST /api/workspace/casos
// Crea un caso nuevo para un paciente existente.
// ---------------------------------------------------------------------
workspaceRouter.post("/casos", async (req, res) => {
  const { pacienteId, agenteId, motivo } = req.body as {
    pacienteId?: string;
    agenteId?: string;
    motivo?: string;
  };

  if (!pacienteId || !agenteId || !motivo) {
    return res.status(400).json({ error: "Faltan pacienteId, agenteId o motivo." });
  }

  try {
    const numeroExpediente = await asignarNumeroExpediente(req.db!, req.auth!.tenantId!);
    const result = await req.db!.query(
      `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, estado, severidad, numero_expediente)
       VALUES ($1, $2, $3, $4, $5, 'triage', 'estable', $6)
       RETURNING id, motivo, estado, severidad, creado_en, numero_expediente`,
      [req.auth!.tenantId, pacienteId, agenteId, req.auth!.userId, motivo, numeroExpediente]
    );
    res.status(201).json({ caso: result.rows[0] });
  } catch (err) {
    console.error("POST /workspace/casos", err);
    res.status(500).json({ error: "Error al crear el caso." });
  }
});

// ---------------------------------------------------------------------
// Respuesta MOCK del asistente, basada en palabras clave simples del
// mensaje del médico.
//
// INTEGRACIÓN FUTURA: este es el punto exacto donde se conecta la llamada
// real a la API de Claude (Messages API), pasándole el contenido del
// mensaje + el contexto ya armado en casos.routes.ts
// (obtenerDocumentosParaContexto) + el historial de la conversación. Por
// ahora es una función pura sin llamada de red, para no mezclar el mock
// con el resto de la lógica del endpoint.
// ---------------------------------------------------------------------
function generarRespuestaMock(contenidoMedico: string): string {
  const texto = contenidoMedico.toLowerCase();

  if (texto.includes("diarrea") || texto.includes("vomito") || texto.includes("vómito")) {
    return (
      "Entendido, gracias por la información. Basándome en los síntomas gastrointestinales " +
      "que describís, los diagnósticos diferenciales iniciales a considerar incluyen " +
      "gastroenteritis aguda, parasitosis intestinal y, si el cuadro es crónico, enfermedad " +
      "inflamatoria intestinal. ¿Podés compartir hace cuánto tiempo comenzaron los síntomas y " +
      "si hay cambios en el apetito o la hidratación del paciente?"
    );
  }

  return (
    "Gracias por la actualización. Para poder ayudarte mejor, ¿podés darme más detalles sobre " +
    "la evolución del cuadro clínico? Por ejemplo: duración de los síntomas, cambios recientes " +
    "en la conducta del paciente, o resultados de estudios que ya tengas disponibles."
  );
}

// ---------------------------------------------------------------------
// POST /api/workspace/casos/:id/informacion
// Anotar vs consultar, Capa 2 — "Agregar información". Registra un bloque
// de información clínica en el caso, con su autor y su marca de tiempo, y
// nada más: NO llama al modelo por ningún camino (ni siquiera el mock), NO
// pasa por verificarAntesDeGenerar/registrarUsoApi (no hay nada que cobrar
// ni que verificar contra el saldo), y NO toca dashboard_cache. Latencia y
// costo prácticamente cero — es la mitad barata de la separación.
//
// A propósito no se filtra por estado de la suscripción (verificarAntesDeGenerar
// es del lado de "consultar", no de "anotar"): un bloque de información es
// dato del expediente, no una generación con IA, así que no compite por el
// mismo gate que el crédito.
// ---------------------------------------------------------------------
workspaceRouter.post("/casos/:id/informacion", async (req, res) => {
  const { contenido, archivoIds } = req.body as { contenido?: string; archivoIds?: string[] };
  const contenidoLimpio = (contenido ?? "").trim();

  if (!contenidoLimpio) {
    return res.status(400).json({ error: "La información no puede estar vacía." });
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
    // prompt_code_cierre_caso.md, Paso 2 — un caso cerrado es de solo
    // lectura: no se le agrega información nueva.
    if (caso.estado === "completado") {
      return res.status(409).json({ error: "El caso está cerrado — no se puede agregar información nueva." });
    }

    const mensajeResult = await req.db!.query(
      `INSERT INTO mensajes (caso_id, remitente, contenido, tipo, autor_persona_id)
       VALUES ($1, 'medico', $2, 'informacion', $3)
       RETURNING id, remitente, contenido, tipo, creado_en`,
      [req.params.id, contenidoLimpio, req.auth!.userId]
    );
    const mensaje = mensajeResult.rows[0];

    // Mismo mecanismo que ya existía para el chat: el archivo se sube
    // suelto (mensaje_id NULL) apenas se adjunta, y acá se linkea al
    // bloque recién creado — así un estudio se puede adjuntar mientras se
    // arma el caso, sin que eso obligue a analizar.
    let archivosVinculados: { id: string; nombre_archivo: string; tipo: string }[] = [];
    if (Array.isArray(archivoIds) && archivoIds.length > 0) {
      const archivosResult = await req.db!.query(
        `UPDATE archivos SET mensaje_id = $1
         WHERE id = ANY($2::uuid[]) AND caso_id = $3
         RETURNING id, nombre_archivo, tipo`,
        [mensaje.id, archivoIds, req.params.id]
      );
      archivosVinculados = archivosResult.rows;
    }

    // Cronología de seguimiento, Paso 2 — vínculo automático con la cita
    // del día. A propósito conservador: solo si hay EXACTAMENTE una cita
    // de este paciente hoy sin caso asociado. Ninguna candidata, o más de
    // una, o la única ya vinculada a otro caso (que por eso no aparece en
    // el WHERE caso_id IS NULL) → no se adivina, queda sin vincular. Este
    // vínculo alimenta el reporte de atenciones que se presenta ante el
    // colegio — una asociación equivocada ahí es peor que ninguna.
    const hoy = fechaHoyEnZona(req.auth!.zonaHoraria);
    const candidatas = await req.db!.query(
      `SELECT id FROM citas WHERE paciente_id = $1 AND fecha = $2 AND caso_id IS NULL`,
      [caso.paciente_id, hoy]
    );
    let citaVinculada = false;
    if (candidatas.rows.length === 1) {
      const vinculo = await req.db!.query(
        `UPDATE citas SET caso_id = $1 WHERE id = $2 AND caso_id IS NULL RETURNING id`,
        [req.params.id, candidatas.rows[0].id]
      );
      citaVinculada = vinculo.rows.length > 0;
    }

    await req.db!.query(`UPDATE casos SET actualizado_en = now() WHERE id = $1`, [req.params.id]);

    res.status(201).json({ mensaje: { ...mensaje, archivos: archivosVinculados }, citaVinculada });
  } catch (err) {
    console.error("POST /workspace/casos/:id/informacion", err);
    res.status(500).json({ error: "Error al registrar la información." });
  }
});

// ---------------------------------------------------------------------
// POST /api/workspace/casos/:id/mensajes
// Anotar vs consultar, Capa 2 — "Analizar el caso". Vincula los archivos
// ya subidos (POST /api/archivos) que hayan quedado sueltos con mensaje_id
// NULL, y genera la respuesta del asistente sobre el texto actual MÁS toda
// la información registrada (tipo='informacion', incorporada=false) desde
// la última respuesta — ver informacionRegistrada.ts para el porqué de la
// marca explícita en vez de un corte por fecha.
//
// El texto actual es opcional acá (a diferencia de antes): el médico puede
// analizar solo con lo que ya agregó, sin escribir nada nuevo. Lo único
// que no se permite es analizar sin texto Y sin nada pendiente — no hay
// nada nuevo que el agente no haya visto ya, así que sería una llamada
// completa para regenerar la misma respuesta.
//
// La rama que se toma (real vs. mock) depende de agentes.system_prompt:
// si el agente del caso tiene uno cargado (hoy: 8 de los 9 agentes, ver
// migración 032), se llama de verdad a Claude; si no (ICIS/Urologia),
// sigue generarRespuestaMock() sin cambios de fondo. Nuevos agentes
// obtienen la integración real simplemente cargándoles su system_prompt —
// no hace falta tocar código.
// ---------------------------------------------------------------------
workspaceRouter.post("/casos/:id/mensajes", async (req, res) => {
  const { contenido, archivoIds } = req.body as { contenido?: string; archivoIds?: string[] };
  const contenidoLimpio = (contenido ?? "").trim();

  try {
    // Confirmamos que el caso existe y pertenece a este médico antes de
    // escribir, y de paso traemos el system_prompt del agente (si tiene)
    // y la zona horaria de la clínica (para las marcas de hora del bloque
    // de información — un seguimiento normal abarca varios días).
    const casoResult = await req.db!.query(
      `SELECT c.id, c.agente_id, c.estado, a.system_prompt, t.zona_horaria
       FROM casos c
       JOIN agentes a ON a.id = c.agente_id
       JOIN tenants t ON t.id = c.tenant_id
       WHERE c.id = $1 AND c.medico_id = $2`,
      [req.params.id, req.auth!.userId]
    );
    if (casoResult.rows.length === 0) {
      return res.status(404).json({ error: "Caso no encontrado." });
    }
    const caso = casoResult.rows[0];
    // prompt_code_cierre_caso.md, Paso 2 — un caso cerrado es de solo
    // lectura: no se le pide análisis nuevo.
    if (caso.estado === "completado") {
      return res.status(409).json({ error: "El caso está cerrado — no se puede analizar de nuevo." });
    }

    // Pendientes de incorporar — se consultan ANTES de decidir si hay algo
    // para analizar, y su lista de IDs se captura acá mismo (no se vuelve
    // a consultar más abajo) para poder marcar exactamente estas filas
    // como incorporadas después de un éxito, sin arrastrar ninguna que se
    // haya agregado mientras la llamada a Claude estaba en curso.
    const pendientesResult = await req.db!.query(
      `SELECT id, contenido, creado_en FROM mensajes
       WHERE caso_id = $1 AND tipo = 'informacion' AND incorporada = false
       ORDER BY creado_en ASC`,
      [req.params.id]
    );
    const pendientes = pendientesResult.rows as { id: string; contenido: string; creado_en: Date }[];

    const idsArchivos = Array.isArray(archivoIds) ? archivoIds : [];
    const hayAdjuntos = idsArchivos.length > 0;

    // Adjuntar estudios SIN escribir nada es un análisis legítimo — es,
    // de hecho, el caso más natural ("mirá esta endoscopía"). Antes esto
    // devolvía 400 y el botón de la interfaz estaba deshabilitado, así
    // que la única forma de mandar archivos era escribiendo algo.
    if (!contenidoLimpio && !hayAdjuntos && pendientes.length === 0) {
      return res.status(400).json({
        error: "No hay nada nuevo para analizar — adjuntá un archivo, agregá información o escribí un mensaje.",
      });
    }

    // Se crea una fila de mensaje si el médico escribió algo O si adjuntó
    // archivos. El segundo caso NO fabrica palabras que el médico no dijo:
    // deja constancia del hecho que sí ocurrió (adjuntó estos archivos),
    // y le da a los adjuntos un turno propio en el hilo — sin eso no
    // tendrían dónde mostrarse en la conversación ni dónde viajar dentro
    // del pedido al modelo.
    //
    // Si analiza con la caja vacía y sin adjuntos (solo información
    // pendiente), se sigue sin persistir fila: lo que dispara el análisis
    // es el click (ver TEXTO_DISPARADOR_ANALISIS más abajo).
    let mensaje: { id: string; remitente: string; contenido: string; tipo: string; creado_en: Date } | null =
      null;
    if (contenidoLimpio || hayAdjuntos) {
      let contenidoMensaje = contenidoLimpio;
      if (!contenidoMensaje) {
        const nombresResult = await req.db!.query(
          `SELECT nombre_archivo FROM archivos
            WHERE id = ANY($1::uuid[]) AND caso_id = $2
            ORDER BY creado_en ASC`,
          [idsArchivos, req.params.id]
        );
        const nombres = nombresResult.rows.map((f: any) => f.nombre_archivo);
        contenidoMensaje =
          nombres.length > 0
            ? `Archivos adjuntos: ${nombres.join(", ")}`
            : "Archivos adjuntos.";
      }
      const mensajeResult = await req.db!.query(
        `INSERT INTO mensajes (caso_id, remitente, contenido, tipo, autor_persona_id)
         VALUES ($1, 'medico', $2, 'consulta', $3)
         RETURNING id, remitente, contenido, tipo, creado_en`,
        [req.params.id, contenidoMensaje, req.auth!.userId]
      );
      mensaje = mensajeResult.rows[0];
    }

    // La vinculación NO está condicionada a que haya texto: el `if
    // (mensaje && ...)` anterior hacía que, sin texto, los archivoIds se
    // ignoraran en silencio y los archivos quedaran con mensaje_id NULL
    // para siempre. Hoy siempre hay un mensaje cuando hay adjuntos (arriba),
    // y aun si algo quedara suelto, construirMensajesParaModelo() lo
    // recoge igual (ver archivosDelCaso.ts).
    let archivosVinculados: { id: string; nombre_archivo: string; tipo: string }[] = [];
    if (mensaje && hayAdjuntos) {
      const archivosResult = await req.db!.query(
        `UPDATE archivos SET mensaje_id = $1
         WHERE id = ANY($2::uuid[]) AND caso_id = $3
         RETURNING id, nombre_archivo, tipo`,
        [mensaje.id, idsArchivos, req.params.id]
      );
      archivosVinculados = archivosResult.rows;
      if (archivosVinculados.length !== idsArchivos.length) {
        // Nunca debería pasar (los ids vienen de una subida a este mismo
        // caso), pero si pasa es una pérdida silenciosa de un estudio
        // clínico: queda en el log con nombre y caso.
        console.error(
          `Vinculación incompleta de adjuntos en el caso ${req.params.id}: se pidieron ` +
            `${idsArchivos.length} y se vincularon ${archivosVinculados.length}.`
        );
      }
    }

    await req.db!.query(`UPDATE casos SET actualizado_en = now() WHERE id = $1`, [req.params.id]);

    // El mensaje del médico ya quedó guardado arriba pase lo que pase. Si
    // la clínica configuró limite_accion='bloquear' y ya superó su límite
    // propio, no se genera (ni se cobra) una respuesta de IA para este
    // mensaje — pero nunca se pierde lo que el médico escribió.
    if (await debeBloquearseMensaje(req.db!, req.auth!.tenantId!)) {
      return res.status(402).json({
        error: "Límite de uso alcanzado — contactá a tu administrador de clínica.",
        mensaje: mensaje ? { ...mensaje, archivos: archivosVinculados } : null,
      });
    }

    // Pantallas faltantes, Prompt B, Paso 2 — "analizar el caso" es
    // generación con IA, se bloquea en ventana_purga/finalizada igual que
    // la creación de casos y el Dashboard. Misma posición que
    // verificarAntesDeGenerar de abajo (después de persistir el mensaje
    // del médico, nunca antes) para que el 402 devuelva `mensaje` y el
    // frontend lo agregue al hilo con el aviso "sin respuesta" en vez de
    // perderlo — "Agregar información" (el endpoint hermano de arriba) NO
    // pasa por este chequeo a propósito, ver su comentario de cabecera.
    const estadoSuscripcion = await obtenerEstadoSuscripcion(req.db!, req.auth!.tenantId!);
    if (suscripcionBloqueaGeneracionIa(estadoSuscripcion)) {
      return res.status(402).json({
        error:
          "Tu clínica está en período de cierre o sin suscripción activa — no se pueden generar respuestas nuevas con IA. Podés seguir consultando el historial y exportar los datos.",
        motivo: "fuera_de_ventana",
        mensaje: mensaje ? { ...mensaje, archivos: archivosVinculados } : null,
      });
    }

    // Motor de crédito, bloque 3 — verificación previa a la generación.
    // Se aplica tanto a la rama mock como a la real: aunque el mock no
    // llama a Anthropic, sí registra consumo (uso_api con costo cero) y
    // el producto no debería seguir ofreciendo respuestas de IA —ni
    // siquiera simuladas— a una clínica sin suscripción activa o con el
    // agente deshabilitado.
    const verificacion = await verificarAntesDeGenerar(req.db!, {
      tenantId: req.auth!.tenantId!,
      agenteId: caso.agente_id,
      tipoOperacion: "chat",
      disparadoPor: "usuario",
    });
    if (!verificacion.permitido) {
      return res.status(402).json({
        error: mensajeRechazoGeneracion(verificacion.motivo!),
        motivo: verificacion.motivo,
        mensaje: mensaje ? { ...mensaje, archivos: archivosVinculados } : null,
      });
    }

    const medicoAgenteResult = await req.db!.query(
      `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2`,
      [req.auth!.userId, caso.agente_id]
    );
    const medicoAgenteId = medicoAgenteResult.rows[0]?.id ?? null;

    // prompt_code_cierre_caso.md, Paso 2 — "en_curso" recién significa algo
    // (recién creado vs. en trabajo vs. cerrado) si se marca en el primer
    // análisis real, no en la creación del caso. WHERE estado='triage' lo
    // hace un no-op inofensivo en cualquier análisis posterior. Se llama
    // desde las dos ramas (mock y real), solo cuando cada una ya tuvo
    // éxito — nunca si el análisis fue bloqueado o falló antes de esto.
    async function marcarEnCursoSiTriage() {
      await req.db!.query(`UPDATE casos SET estado = 'en_curso' WHERE id = $1 AND estado = 'triage'`, [
        req.params.id,
      ]);
    }

    const idsPendientes = pendientes.map((p) => p.id);
    async function marcarPendientesIncorporadas() {
      if (idsPendientes.length === 0) return;
      await req.db!.query(`UPDATE mensajes SET incorporada = true WHERE id = ANY($1::uuid[])`, [
        idsPendientes,
      ]);
    }

    // ---------------------------------------------------------------
    // Agente SIN system_prompt (ICIS y el resto) — mock sin cambios de
    // fondo. Si la caja vino vacía, se le da al mock la información
    // pendiente concatenada (para que el matching por palabra clave siga
    // teniendo algo sobre qué trabajar) en vez del texto disparador fijo,
    // que es específico de la llamada real a Claude.
    // ---------------------------------------------------------------
    if (!caso.system_prompt) {
      // Simula una latencia de red breve, igual que antes.
      await new Promise((resolve) => setTimeout(resolve, 700));

      const contenidoParaMock = contenidoLimpio || pendientes.map((p) => p.contenido).join(". ");
      const respuestaMock = generarRespuestaMock(contenidoParaMock);
      const respuestaResult = await req.db!.query(
        `INSERT INTO mensajes (caso_id, remitente, contenido, tipo)
         VALUES ($1, 'ai', $2, 'respuesta')
         RETURNING id, remitente, contenido, tipo, creado_en`,
        [req.params.id, respuestaMock]
      );

      await marcarPendientesIncorporadas();
      await marcarEnCursoSiTriage();

      // Misma estimación que ya se usaba. El costo lo resuelve el servicio
      // de tarifas: claude-sonnet-5-mock tiene tarifa vigente marcada
      // facturable=false (migración 026), así que queda en costo cero y
      // cobrable en false sin disparar la alerta de "sin tarifa vigente".
      const tokensEntrada = Math.round(contenidoParaMock.length / 4) + 800;
      const tokensSalida = Math.round(respuestaMock.length / 4);

      await registrarUsoApi(req.db!, {
        tenantId: req.auth!.tenantId!,
        casoId: req.params.id,
        medicoAgenteId,
        personaId: req.auth!.userId,
        modelo: "claude-sonnet-5-mock",
        tokensEntrada,
        tokensSalida,
        tokensCacheEscritura: 0,
        tokensCacheLectura: 0,
        tipoConsumo: "clinico",
        disparadoPor: "usuario",
      });

      return res.status(201).json({
        mensaje: mensaje ? { ...mensaje, archivos: archivosVinculados } : null,
        respuesta: { ...respuestaResult.rows[0], archivos: [] },
      });
    }

    // ---------------------------------------------------------------
    // Agente CON system_prompt (GCIS) — llamada real a Claude.
    // ---------------------------------------------------------------
    const documentos = await obtenerDocumentosParaContexto(
      req.db!,
      caso.agente_id,
      req.auth!.tenantId!
    );
    // obtenerDocumentosParaContexto() ahora trae también d.contenido_texto
    // (columna ya poblada a mano para varios documentos, ver
    // documentos_conocimiento). No todos los documentos tienen ese campo
    // cargado todavía — para los que sí, se concatena el texto completo;
    // para los que no, se cae al fallback anterior de solo mencionarlos
    // por nombre/tipo/archivo_ref, así igual quedan visibles como
    // referencia aunque no aporten contenido real al prompt.
    const documentosConTexto = documentos.filter((d: any) => d.contenido_texto);
    const documentosSinTexto = documentos.filter((d: any) => !d.contenido_texto);

    const bloqueDocumentos =
      documentos.length === 0
        ? "No hay documentos de referencia adicionales cargados para este agente/país."
        : [
            documentosConTexto.length > 0
              ? "Documentos de referencia (contenido completo) para este caso:\n\n" +
                documentosConTexto
                  .map((d: any) => `### ${d.nombre} (${d.tipo})\n${d.contenido_texto}`)
                  .join("\n\n---\n\n")
              : null,
            documentosSinTexto.length > 0
              ? "Documentos de referencia mencionados pero sin contenido de texto cargado " +
                "todavía (solo metadata):\n" +
                documentosSinTexto
                  .map((d: any) => `- ${d.nombre} (${d.tipo}): ${d.archivo_ref}`)
                  .join("\n")
              : null,
          ]
            .filter((bloque): bloque is string => bloque !== null)
            .join("\n\n");

    const systemCombinado = `${caso.system_prompt}\n\n---\n\n${bloqueDocumentos}`;
    // Ajustes del área de trabajo, Prioridad 1 — se arma en cada mensaje
    // (no solo al abrir el caso) para que un dato corregido a mitad de
    // conversación llegue en el siguiente turno.
    const bloqueContextoCaso = await construirBloqueContextoCaso(req.db!, req.params.id);
    // Carga selectiva de predisposiciones raciales — mismo criterio y
    // mismo punto de llamada que bloqueContextoCaso (ver razaDocumento.ts):
    // varía por caso, así que va acá, no en el bloque cacheado de arriba.
    const bloqueRazaDocumento = await construirBloqueRazaDocumento(req.db!, req.params.id, req.auth!.tenantId ?? null);
    // Anotar vs consultar, Paso 3 — mismo patrón que bloqueContextoCaso:
    // system adicional, sin cache_control, nunca mensajes de usuario. Se
    // arma con los `pendientes` ya consultados arriba (no se vuelve a
    // pedir acá) para que la lista de IDs a marcar como incorporadas más
    // abajo sea exactamente la misma que se le mandó al modelo.
    const bloqueInformacionRegistrada = construirBloqueInformacionRegistrada(
      pendientes,
      caso.zona_horaria ?? "America/Costa_Rica"
    );

    // Historial + adjuntos, todo desde archivosDelCaso.ts: es el único
    // lugar donde se decide qué archivo del caso llega al modelo, y es el
    // mismo módulo que usan dashboard, informe y receta. La versión
    // anterior de esto vivía duplicada en los cuatro puntos, y bastaba con
    // que un adjunto no cayera en el LEFT JOIN (por estar colgado de un
    // bloque de información, o de ningún mensaje) para que desapareciera
    // sin dejar rastro.
    const { mensajes: mensajesParaClaude, archivosEnviados, archivosNoLegibles } =
      await construirMensajesParaModelo(req.db!, req.params.id);
    if (archivosNoLegibles.length > 0) {
      console.warn(
        `Caso ${req.params.id}: ${archivosNoLegibles.length} adjunto(s) no se le pueden mandar al agente ` +
          `(${archivosNoLegibles.map((a) => a.nombre).join(", ")}). Se le nombran en el pedido para que lo diga.`
      );
    }

    const recetasEmitidas = await obtenerRecetasEmitidasParaContexto(req.db!, req.params.id);
    const bloquePrescripciones = construirBloquePrescripciones(recetasEmitidas);
    const mensajesConPrescripciones = insertarBloquePrescripciones(mensajesParaClaude, bloquePrescripciones);

    // Si la caja vino vacía (se analiza solo con información pendiente), no
    // hay ningún turno "consulta" nuevo en el historial de arriba — el
    // último turno real puede ser una respuesta vieja, o no haber ninguno
    // (primer análisis del caso). La Messages API exige que el último
    // turno sea de rol "user", así que se agrega acá, en memoria, el
    // disparador fijo — nunca se persiste como fila de `mensajes` (ver
    // TEXTO_DISPARADOR_ANALISIS en informacionRegistrada.ts).
    if (!contenidoLimpio) {
      mensajesConPrescripciones.push({ role: "user", content: TEXTO_DISPARADOR_ANALISIS });
    }

    let respuestaTexto: string;
    let usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
    try {
      const anthropic = requerirAnthropic();
      // Endpoint beta: es lo que exige la Files API para referenciar un
      // file_id dentro de un mensaje (mismo header en la subida y acá).
      // Se usa siempre para GCIS, tenga o no archivos este mensaje puntual
      // — sin eso, no cambia nada respecto de la llamada no-beta.
      const response = await anthropic.beta.messages.create({
        model: MODELO_GCIS,
        max_tokens: 2048,
        betas: ["files-api-2025-04-14"],
        // El bloque cacheado (system_prompt + documentos) siempre va
        // primero, con su propio cache_control — es idéntico byte a byte
        // entre casos del mismo agente, así que Anthropic lo lee de cache
        // en vez de reescribirlo. El contexto del caso va DESPUÉS, sin
        // cache_control: es distinto en cada caso y se recalcula en cada
        // llamada, pero al no llevar cache_control no rompe ni reescribe
        // el cache del bloque anterior.
        //
        // Latencia y costo, Cambio 1 — TTL de una hora en vez del default
        // de 5 minutos: el patrón de uso real (leer la respuesta, revisar
        // el expediente, pensar, recién ahí escribir) supera los 5 minutos
        // con facilidad, así que casi 2 de cada 3 mensajes reescribían el
        // caché completo. La escritura a 1h cuesta el doble, pero se paga
        // una sola vez por sesión en vez de en el 62% de los mensajes — ver
        // tarifas.ts (tarifaCacheEscritura1h) para el lado del costo.
        system: [
          {
            type: "text",
            text: systemCombinado,
            cache_control: CACHE_PREFIJO_COMPARTIDO,
          },
          { type: "text", text: bloqueContextoCaso },
          // Solo si hay algo que mostrar — igual que bloqueContextoCaso
          // cuando no hay caso, un bloque de texto vacío no se manda.
          ...(bloqueRazaDocumento ? [{ type: "text" as const, text: bloqueRazaDocumento }] : []),
          ...(bloqueInformacionRegistrada
            ? [{ type: "text" as const, text: bloqueInformacionRegistrada }]
            : []),
        ],
        // El chat no usa ninguna de estas herramientas: las manda para
        // que su prefijo sea idéntico al de dashboard/informe/receta y
        // los cuatro compartan una sola entrada de caché. tool_choice
        // "none" impide usarlas y NO invalida el caché (a diferencia de
        // cambiar las definiciones, que sí lo invalida).
        tools: HERRAMIENTAS_AGENTE,
        tool_choice: { type: "none" },
        messages: mensajesConPrescripciones,
      });
      await registrarExitoAnthropic();
      const bloqueTexto = response.content.find((b) => b.type === "text");
      respuestaTexto = bloqueTexto?.text ?? "";
      usage = response.usage;
    } catch (err) {
      console.error(
        `Error al llamar a la API de Claude (GCIS) — caso ${req.params.id}, ${archivosEnviados} adjunto(s) en el pedido`,
        err
      );
      await registrarResultadoAnthropic(err);
      // La información pendiente NO se marca incorporada acá: la llamada
      // falló, así que el modelo nunca la vio de verdad. Queda pendiente
      // para el próximo intento (ver informacionRegistrada.ts).
      //
      // No hay reintento automático sin los adjuntos: una respuesta
      // generada a ciegas sobre un caso que tiene estudios adjuntos es
      // peor que no tener respuesta, y el médico no tendría cómo notar la
      // diferencia. Si los adjuntos son la causa, se dice.
      return res.status(502).json({
        error:
          archivosEnviados > 0
            ? "No se pudo generar la respuesta de IA en este momento — puede ser un problema con alguno de los archivos adjuntos. Tu mensaje y tus archivos quedaron guardados."
            : "No se pudo generar la respuesta de IA en este momento. Tu mensaje quedó guardado.",
        mensaje: mensaje ? { ...mensaje, archivos: archivosVinculados } : null,
      });
    }

    const respuestaResult = await req.db!.query(
      `INSERT INTO mensajes (caso_id, remitente, contenido, tipo)
       VALUES ($1, 'ai', $2, 'respuesta')
       RETURNING id, remitente, contenido, tipo, creado_en`,
      [req.params.id, respuestaTexto]
    );

    // Recién acá, con la llamada ya exitosa — exactamente las filas que se
    // capturaron en `pendientes` antes de llamar a Claude, ni una más (ver
    // el comentario sobre la ventana de carrera en informacionRegistrada.ts).
    await marcarPendientesIncorporadas();
    await marcarEnCursoSiTriage();

    const tokensCacheEscritura = usage.cache_creation_input_tokens ?? 0;
    const tokensCacheLectura = usage.cache_read_input_tokens ?? 0;

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
      tipoConsumo: "clinico",
      disparadoPor: "usuario",
      ttlCacheEscritura: "1h",
    });

    res.status(201).json({
      mensaje: mensaje ? { ...mensaje, archivos: archivosVinculados } : null,
      respuesta: { ...respuestaResult.rows[0], archivos: [] },
    });
  } catch (err) {
    console.error("POST /workspace/casos/:id/mensajes", err);
    res.status(500).json({ error: "Error al enviar el mensaje." });
  }
});
