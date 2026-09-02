import crypto from "crypto";
import { Request, Response, Router } from "express";
import multer from "multer";
import path from "path";
import { almacenamientoPrivado } from "../almacenamiento";
import { contentTypePorExtension } from "../almacenamiento/contentType";
import { registrarEventoFacturacion } from "../facturacion";
import { extraerTexto } from "../lib/extraccion";
import { registrarLecturaSensible } from "../middleware/auditoria";
import { authenticate, withTenantClient } from "../middleware/auth";
import { requerirStripe } from "../stripe";
import { calcularCicloActual, calcularConsumoCiclo } from "../usoIa";

export const platformAdminRouter = Router();

// El archivo queda en memoria (req.file.buffer), no en disco: en un
// contenedor descartable no hay disco que sobreviva a un reinicio. Va
// directo al almacenamiento de objetos (ámbito privado — ver
// almacenamiento/tipos.ts) detrás del mismo control de acceso que ya
// existe (ver GET /documentos/:id/archivo más abajo).
//
// 25MB: mismo criterio y mismo valor que archivos.routes.ts (adjuntos de
// casos) — cubre imágenes/PDF de referencia clínica con margen. El límite
// se aplica DURANTE la subida (multer corta el stream, no bufferiza el
// archivo completo antes de rechazarlo).
const LIMITE_TAMANO_ARCHIVO = 25 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_TAMANO_ARCHIVO } });

platformAdminRouter.use(authenticate, withTenantClient);

// Más estricto que platformRouter: la Base de Conocimiento es solo para
// soporte_senior y super_admin — un 'soporte' básico recibe 403, y
// cualquier persona de clínica también (ni siquiera llega acá, porque
// esas cuentas tienen tenantId y este router no lo usa).
platformAdminRouter.use((req, res, next) => {
  if (req.auth!.rol !== "super_admin" && req.auth!.rol !== "soporte_senior") {
    return res
      .status(403)
      .json({ error: "Esta sección es solo para soporte senior o super admin." });
  }
  next();
});

// =====================================================================
// DOCUMENTOS DE LA BASE DE CONOCIMIENTO
// =====================================================================

platformAdminRouter.get("/documentos", async (req, res) => {
  const { agente, pais } = req.query;

  try {
    const condiciones: string[] = [];
    const params: string[] = [];

    if (agente === "null") {
      condiciones.push("d.agente_id IS NULL");
    } else if (typeof agente === "string" && agente) {
      params.push(agente);
      condiciones.push(`d.agente_id = $${params.length}`);
    }

    if (pais === "null") {
      condiciones.push("d.pais_codigo IS NULL");
    } else if (typeof pais === "string" && pais) {
      params.push(pais);
      condiciones.push(`d.pais_codigo = $${params.length}`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const result = await req.db!.query(
      `SELECT d.id, d.nombre, d.descripcion, d.tipo, d.agente_id,
              a.nombre AS agente_nombre, d.pais_codigo, d.archivo_ref, d.version, d.estado,
              d.fecha_carga, sp.nombre AS cargado_por_nombre,
              (d.contenido_texto IS NOT NULL) AS tiene_texto,
              char_length(d.contenido_texto) AS caracteres_texto,
              d.incluir_en_contexto
       FROM documentos_conocimiento d
       LEFT JOIN agentes a ON a.id = d.agente_id
       LEFT JOIN staff_plataforma sp ON sp.id = d.cargado_por
       ${where}
       ORDER BY d.fecha_carga DESC`,
      params
    );

    // Lectura sensible: listado completo de la Base de Conocimiento.
    registrarLecturaSensible(req.auth!, "GET /api/platform-admin/documentos", "documentos_conocimiento", null);

    res.json({ documentos: result.rows });
  } catch (err) {
    console.error("GET /platform-admin/documentos", err);
    res.status(500).json({ error: "Error al listar documentos." });
  }
});

// Nombre "legible" para el archivo descargado: no existe ningún registro
// del nombre original del archivo subido (multer solo guarda un UUID), así
// que se reconstruye a partir del título del documento + la extensión real.
function nombreDeArchivoLegible(nombre: string, ext: string): string {
  const sanitizado = nombre.replace(/[\\/:*?"<>|]/g, "").trim() || "documento";
  return `${sanitizado}${ext}`;
}

platformAdminRouter.get("/documentos/:id/archivo", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT nombre, archivo_ref FROM documentos_conocimiento WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Documento no encontrado." });
    }

    const { nombre, archivo_ref: archivoRef } = result.rows[0];
    let datos: Buffer;
    try {
      datos = await almacenamientoPrivado.leer(archivoRef);
    } catch {
      return res.status(404).json({ error: "El archivo ya no está disponible." });
    }

    const ext = path.extname(archivoRef).toLowerCase();
    const contentType = contentTypePorExtension(ext);
    const nombreLegible = nombreDeArchivoLegible(nombre, ext);

    // Solo el PDF tiene vista previa inline en el navegador; cualquier otro
    // formato (o ?descargar=1 explícito) siempre fuerza la descarga.
    const forzarDescarga = req.query.descargar === "1" || ext !== ".pdf";
    const disposicion = forzarDescarga ? "attachment" : "inline";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `${disposicion}; filename="${nombreLegible}"; filename*=UTF-8''${encodeURIComponent(nombreLegible)}`
    );
    res.send(datos);
  } catch (err) {
    console.error("GET /platform-admin/documentos/:id/archivo", err);
    res.status(500).json({ error: "Error al obtener el archivo." });
  }
});

platformAdminRouter.post("/documentos", (req, res) => {
  upload.single("archivo")(req, res, async (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `El archivo supera el máximo de ${LIMITE_TAMANO_ARCHIVO / (1024 * 1024)}MB.`,
        });
      }
      console.error("POST /platform-admin/documentos (upload)", err);
      return res.status(500).json({ error: "Error al subir el documento." });
    }
    await manejarSubidaDocumento(req, res);
  });
});

async function manejarSubidaDocumento(req: Request, res: Response) {
  const { nombre, descripcion, tipo, agenteId, version } = req.body as {
    nombre?: string;
    descripcion?: string;
    tipo?: string;
    agenteId?: string;
    version?: string;
  };

  if (!req.file) {
    return res.status(400).json({ error: "Falta el archivo." });
  }
  if (!nombre || !tipo) {
    return res.status(400).json({ error: "Faltan nombre o tipo." });
  }

  try {
    const ext = path.extname(req.file.originalname);
    const clave = `conocimiento/${crypto.randomUUID()}${ext}`;
    const contenidoTexto = await extraerTexto(req.file.buffer, ext);
    await almacenamientoPrivado.guardar(clave, req.file.buffer, req.file.mimetype);

    const result = await req.db!.query(
      `INSERT INTO documentos_conocimiento
         (nombre, descripcion, tipo, agente_id, archivo_ref, version, cargado_por, contenido_texto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, nombre, descripcion, tipo, agente_id, archivo_ref, version, estado, fecha_carga,
                 (contenido_texto IS NOT NULL) AS tiene_texto`,
      [
        nombre,
        descripcion ?? null,
        tipo,
        agenteId || null,
        clave,
        version || "1.0",
        req.auth!.userId,
        contenidoTexto?.trim() || null,
      ]
    );
    res.status(201).json({ documento: result.rows[0] });
  } catch (err) {
    console.error("POST /platform-admin/documentos", err);
    res.status(500).json({ error: "Error al subir el documento." });
  }
}

platformAdminRouter.patch("/documentos/:id/archivar", async (req, res) => {
  try {
    const result = await req.db!.query(
      `UPDATE documentos_conocimiento SET estado = 'archivado'
       WHERE id = $1
       RETURNING id, nombre, estado`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Documento no encontrado." });
    }
    res.json({ documento: result.rows[0] });
  } catch (err) {
    console.error("PATCH /platform-admin/documentos/:id/archivar", err);
    res.status(500).json({ error: "Error al archivar el documento." });
  }
});

platformAdminRouter.patch("/documentos/:id", (req, res) => {
  upload.single("archivo")(req, res, async (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `El archivo supera el máximo de ${LIMITE_TAMANO_ARCHIVO / (1024 * 1024)}MB.`,
        });
      }
      console.error("PATCH /platform-admin/documentos/:id (upload)", err);
      return res.status(500).json({ error: "Error al editar el documento." });
    }
    await manejarEdicionDocumento(req, res);
  });
});

async function manejarEdicionDocumento(req: Request, res: Response) {
  const { nombre, descripcion, tipo, agenteId, paisCodigo, version } = req.body as {
    nombre?: string;
    descripcion?: string;
    tipo?: string;
    agenteId?: string;
    paisCodigo?: string;
    version?: string;
  };

  if (!nombre || !tipo) {
    return res.status(400).json({ error: "Faltan nombre o tipo." });
  }

  try {
    const actual = await req.db!.query(
      `SELECT archivo_ref, pais_codigo, contenido_texto FROM documentos_conocimiento WHERE id = $1`,
      [req.params.id]
    );
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: "Documento no encontrado." });
    }

    const nuevaExt = req.file ? path.extname(req.file.originalname) : null;
    const nuevoArchivoRef = req.file ? `conocimiento/${crypto.randomUUID()}${nuevaExt}` : actual.rows[0].archivo_ref;

    // Si se reemplazó el archivo, el texto extraído del archivo anterior ya
    // no corresponde a nada — se vuelve a extraer del nuevo. Si no se tocó
    // el archivo, se preserva el contenido_texto existente tal cual.
    const nuevoContenidoTexto = req.file
      ? (await extraerTexto(req.file.buffer, nuevaExt!))?.trim() || null
      : actual.rows[0].contenido_texto;

    if (req.file) {
      await almacenamientoPrivado.guardar(nuevoArchivoRef, req.file.buffer, req.file.mimetype);
    }

    // El modal de edición de esta fase no expone un selector de país, así
    // que si no viene en el body se preserva el valor existente en vez de
    // limpiarlo (no confundir "no lo mandaron" con "lo quieren en null").
    const nuevoPaisCodigo = paisCodigo !== undefined ? paisCodigo || null : actual.rows[0].pais_codigo;

    const result = await req.db!.query(
      `UPDATE documentos_conocimiento
       SET nombre = $1, descripcion = $2, tipo = $3, agente_id = $4,
           pais_codigo = $5, version = $6, archivo_ref = $7, contenido_texto = $8
       WHERE id = $9
       RETURNING id, nombre, descripcion, tipo, agente_id, pais_codigo, archivo_ref, version, estado, fecha_carga,
                 (contenido_texto IS NOT NULL) AS tiene_texto`,
      [
        nombre,
        descripcion ?? null,
        tipo,
        agenteId || null,
        nuevoPaisCodigo,
        version || "1.0",
        nuevoArchivoRef,
        nuevoContenidoTexto,
        req.params.id,
      ]
    );

    // Si se reemplazó el archivo, el anterior queda huérfano — se borra
    // recién después del UPDATE, para no perder el archivo viejo si la
    // consulta hubiera fallado.
    if (req.file && actual.rows[0].archivo_ref) {
      almacenamientoPrivado.eliminar(actual.rows[0].archivo_ref).catch(() => {});
    }

    res.json({ documento: result.rows[0] });
  } catch (err) {
    console.error("PATCH /platform-admin/documentos/:id", err);
    res.status(500).json({ error: "Error al editar el documento." });
  }
}

platformAdminRouter.delete("/documentos/:id", async (req, res) => {
  try {
    const result = await req.db!.query(
      `DELETE FROM documentos_conocimiento WHERE id = $1 RETURNING archivo_ref`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Documento no encontrado." });
    }

    const { archivo_ref } = result.rows[0];
    if (archivo_ref) {
      almacenamientoPrivado.eliminar(archivo_ref).catch(() => {});
    }

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /platform-admin/documentos/:id", err);
    res.status(500).json({ error: "Error al eliminar el documento." });
  }
});

// =====================================================================
// CATÁLOGO DE AGENTES (edición completa — distinto del listado de solo
// lectura en /api/platform/agentes, que se deja intacto).
// =====================================================================

platformAdminRouter.get("/agentes", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT
         a.id, a.nombre, a.especialidad, a.descripcion, a.icono, a.estado_catalogo,
         a.estado, a.motivo_mantenimiento, a.retorno_estimado, a.estado_actualizado_en,
         (SELECT COUNT(*) FROM tenant_agentes ta WHERE ta.agente_id = a.id AND ta.estado = 'habilitado') AS clinicas_activas,
         (SELECT COUNT(*) FROM casos c WHERE c.agente_id = a.id) AS casos_totales
       FROM agentes a
       ORDER BY a.nombre`
    );
    res.json({ agentes: result.rows });
  } catch (err) {
    console.error("GET /platform-admin/agentes", err);
    res.status(500).json({ error: "Error al listar el catálogo de agentes." });
  }
});

// PASO 3 — cambiar el estado operativo de un agente (activo/discontinuado/
// mantenimiento). Distinto de estado_catalogo (disponible/proximamente,
// editable arriba en PATCH /agentes/:id) — este es "¿sigue funcionando?",
// aquel es "¿está ofrecido en el catálogo?".
platformAdminRouter.patch("/agentes/:id/estado", async (req, res) => {
  const { estado, motivoMantenimiento, retornoEstimado } = req.body as {
    estado?: "activo" | "discontinuado" | "mantenimiento";
    motivoMantenimiento?: string;
    retornoEstimado?: string;
  };

  if (!estado || !["activo", "discontinuado", "mantenimiento"].includes(estado)) {
    return res.status(400).json({ error: "Estado no válido." });
  }
  if (estado === "mantenimiento" && !motivoMantenimiento?.trim()) {
    return res.status(400).json({ error: "Poner un agente en mantenimiento requiere un motivo." });
  }

  try {
    // Reactivar (a activo) limpia motivo y fecha estimada — no deben
    // quedar restos de un mantenimiento anterior en la tarjeta.
    const result = await req.db!.query(
      `UPDATE agentes
       SET estado = $1::varchar,
           motivo_mantenimiento = CASE WHEN $1::varchar = 'mantenimiento' THEN $2::text ELSE NULL END,
           retorno_estimado = CASE WHEN $1::varchar = 'mantenimiento' THEN $3::date ELSE NULL END,
           estado_actualizado_en = now(),
           estado_actualizado_por = $4
       WHERE id = $5
       RETURNING id, estado, motivo_mantenimiento, retorno_estimado, estado_actualizado_en`,
      [estado, motivoMantenimiento?.trim() ?? null, retornoEstimado ?? null, req.auth!.userId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Agente no encontrado." });
    res.json({ agente: result.rows[0] });
  } catch (err) {
    console.error("PATCH /platform-admin/agentes/:id/estado", err);
    res.status(500).json({ error: "Error al cambiar el estado del agente." });
  }
});

// Editar el catálogo global de agentes es más sensible que administrar la
// Base de Conocimiento — restringido a super_admin únicamente, mismo
// patrón inline que /legal/:tipo más abajo (no el gate del router).
platformAdminRouter.patch("/agentes/:id", async (req, res) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "Editar el catálogo de agentes es solo para super_admin." });
  }

  const { nombre, especialidad, descripcion, icono, estado } = req.body as {
    nombre?: string;
    especialidad?: string;
    descripcion?: string;
    icono?: string;
    estado?: "disponible" | "proximamente";
  };

  if (!nombre) {
    return res.status(400).json({ error: "Falta el nombre del agente." });
  }

  try {
    const actual = await req.db!.query(`SELECT estado_catalogo FROM agentes WHERE id = $1`, [req.params.id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: "Agente no encontrado." });
    }

    const result = await req.db!.query(
      `UPDATE agentes
       SET nombre = $1, especialidad = $2, descripcion = $3, icono = $4, estado_catalogo = $5
       WHERE id = $6
       RETURNING id, nombre, especialidad, descripcion, icono, estado_catalogo`,
      [
        nombre,
        especialidad ?? null,
        descripcion ?? null,
        icono ?? null,
        estado ?? actual.rows[0].estado_catalogo,
        req.params.id,
      ]
    );
    res.json({ agente: result.rows[0] });
  } catch (err) {
    console.error("PATCH /platform-admin/agentes/:id", err);
    res.status(500).json({ error: "Error al editar el agente." });
  }
});

// =====================================================================
// DOCUMENTOS LEGALES (Términos y Condiciones, Política de Privacidad)
// Más estricto todavía que el resto de este router: SOLO super_admin,
// ni siquiera soporte_senior puede publicar una versión nueva.
// =====================================================================

const TIPOS_LEGALES_VALIDOS = ["terminos_condiciones", "politica_privacidad"];

platformAdminRouter.patch("/legal/:tipo", async (req, res) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "Publicar una versión legal es solo para super_admin." });
  }

  const { tipo } = req.params;
  if (!TIPOS_LEGALES_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: "Tipo de documento inválido." });
  }

  const { contenido, version } = req.body as { contenido?: string; version?: string };
  if (!contenido || !contenido.trim() || !version || !version.trim()) {
    return res.status(400).json({ error: "Faltan contenido o version." });
  }

  try {
    // Nunca se actualiza el contenido de una fila existente — siempre se
    // desactiva la vigente y se inserta una nueva, para preservar el
    // historial completo de versiones anteriores.
    await req.db!.query(
      `UPDATE documentos_legales SET activo = false WHERE tipo = $1 AND activo = true`,
      [tipo]
    );

    const result = await req.db!.query(
      `INSERT INTO documentos_legales (tipo, contenido, version, publicado_por)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tipo, contenido, version, fecha_publicacion`,
      [tipo, contenido.trim(), version.trim(), req.auth!.userId]
    );

    res.status(201).json({ documento: result.rows[0] });
  } catch (err) {
    console.error("PATCH /platform-admin/legal/:tipo", err);
    res.status(500).json({ error: "Error al publicar el documento." });
  }
});

// =====================================================================
// BITÁCORA DE AUDITORÍA (bitacora_auditoria)
// Más estricto todavía que el resto de este router: SOLO super_admin —
// mismo patrón inline que /legal/:tipo (el gate del router de arriba
// deja pasar a soporte_senior, este endpoint lo restringe más).
//
// `accion` guarda el método + ruta completa tal como la vio el
// middleware global (ej. "PATCH /api/platform-admin/documentos/<uuid>")
// — no hay una columna de "tipo" separada. Para que el filtro por tipo
// de acción sea útil (y no un match exacto casi único por el uuid
// embebido), se normaliza reemplazando cualquier uuid por ":id" tanto
// para listar las opciones del filtro como para aplicar el filtro
// mismo — sin necesidad de tocar el schema.
// =====================================================================

const PATRON_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const POR_PAGINA = 20;

platformAdminRouter.get("/auditoria", async (req, res) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "La bitácora de auditoría es solo para super_admin." });
  }

  const { tenantId, tipoAccion, desde, hasta } = req.query as {
    tenantId?: string;
    tipoAccion?: string;
    desde?: string;
    hasta?: string;
  };
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);

  const condiciones: string[] = [];
  const params: any[] = [];

  if (tenantId) {
    params.push(tenantId);
    condiciones.push(`b.tenant_id = $${params.length}`);
  }
  if (tipoAccion) {
    params.push(tipoAccion);
    condiciones.push(`regexp_replace(b.accion, '${PATRON_UUID}', ':id', 'g') = $${params.length}`);
  }
  if (desde) {
    params.push(desde);
    condiciones.push(`b.creado_en >= $${params.length}::date`);
  }
  if (hasta) {
    params.push(hasta);
    condiciones.push(`b.creado_en < ($${params.length}::date + interval '1 day')`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const totalResult = await req.db!.query(
      `SELECT COUNT(*) FROM bitacora_auditoria b ${where}`,
      params
    );
    const total = Number(totalResult.rows[0].count);

    const registrosResult = await req.db!.query(
      `SELECT
         b.id, b.creado_en, b.accion, b.entidad, b.entidad_id,
         t.nombre AS tenant_nombre,
         COALESCE(p.nombre, s.nombre) AS usuario_nombre,
         CASE
           WHEN b.persona_id IS NOT NULL AND p.es_admin_clinica THEN 'admin_clinica'
           WHEN b.persona_id IS NOT NULL THEN 'medico'
           WHEN b.staff_id IS NOT NULL THEN 'staff_plataforma'
           ELSE 'desconocido'
         END AS usuario_tipo
       FROM bitacora_auditoria b
       LEFT JOIN personas p ON p.id = b.persona_id
       LEFT JOIN staff_plataforma s ON s.id = b.staff_id
       LEFT JOIN tenants t ON t.id = b.tenant_id
       ${where}
       ORDER BY b.creado_en DESC
       LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
      params
    );

    // Opciones del filtro "tipo de acción": siempre todas las disponibles,
    // sin importar qué otros filtros estén aplicados ahora mismo.
    const tiposResult = await req.db!.query(
      `SELECT DISTINCT regexp_replace(accion, '${PATRON_UUID}', ':id', 'g') AS tipo
       FROM bitacora_auditoria
       ORDER BY 1`
    );

    res.json({
      registros: registrosResult.rows,
      total,
      pagina,
      totalPaginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
      tiposAccion: tiposResult.rows.map((r) => r.tipo),
    });
  } catch (err) {
    console.error("GET /platform-admin/auditoria", err);
    res.status(500).json({ error: "Error al listar la bitácora de auditoría." });
  }
});

// =====================================================================
// FACTURACIÓN — USO DE IA (vista agregada de todas las clínicas)
// Mismo cálculo de ciclo/consumo que usa cada clínica en su propia
// pantalla de Uso y Facturación (ver usoIa.ts) — acá se corre una vez
// por tenant para armar la vista consolidada de Platform Admin.
// =====================================================================

platformAdminRouter.get("/facturacion/uso-ia", async (req, res) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "El uso de IA por clínica es solo para super_admin." });
  }

  try {
    const tenantsResult = await req.db!.query(
      `SELECT t.id, t.nombre, t.estado_suscripcion, t.trial_termina_en, t.creado_en,
              t.stripe_subscription_id, t.limite_usd_configurado, t.limite_accion,
              p.nombre AS plan_nombre, p.presupuesto_usd_incluido
       FROM tenants t
       LEFT JOIN planes p ON p.id = t.plan_id
       ORDER BY t.nombre`
    );

    const clinicas = await Promise.all(
      tenantsResult.rows.map(async (tenant) => {
        const ciclo = await calcularCicloActual(tenant);
        const montoUsado = await calcularConsumoCiclo(req.db!, tenant.id, ciclo);
        const presupuestoUsdIncluido =
          tenant.presupuesto_usd_incluido != null ? Number(tenant.presupuesto_usd_incluido) : null;

        return {
          tenantId: tenant.id,
          tenantNombre: tenant.nombre,
          planNombre: tenant.plan_nombre,
          montoUsado,
          presupuestoUsdIncluido,
          porcentajePresupuesto:
            presupuestoUsdIncluido && presupuestoUsdIncluido > 0
              ? Math.round((montoUsado / presupuestoUsdIncluido) * 1000) / 10
              : null,
          limiteUsdConfigurado:
            tenant.limite_usd_configurado != null ? Number(tenant.limite_usd_configurado) : null,
          limiteAccion: tenant.limite_accion,
          cicloInicio: ciclo.cicloInicio.toISOString(),
          cicloFin: ciclo.cicloFin.toISOString(),
        };
      })
    );

    registrarLecturaSensible(req.auth!, "GET /api/platform-admin/facturacion/uso-ia", "uso_api", null);

    res.json({ clinicas });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/uso-ia", err);
    res.status(500).json({ error: "Error al obtener el uso de IA por clínica." });
  }
});

// =====================================================================
// FACTURACIÓN — FACTURAS, PAGOS, CANCELACIONES, NUEVAS CLÍNICAS
// Todos solo super_admin. Las listas usan `eventos_facturacion` (llenada
// centralizadamente por registrarEventoFacturacion, ver ../facturacion.ts
// — webhook de Stripe, job de excedente y confirmar-pago de Tilopay son
// sus llamadores) como fuente — no se re-consulta Stripe en vivo acá para
// no pegarle N veces por página. El "estado" de una fila de
// factura_manual/excedente_aplicado se deriva viendo si ya existe un
// evento pago_exitoso posterior con la misma referencia_externa: si sí,
// "pagada"; si no, "pendiente" (todavía no llegó el webhook de Stripe
// confirmando el cobro).
// =====================================================================

const POR_PAGINA_FACTURACION = 5;

function requiereSuperAdmin(req: any, res: any): boolean {
  if (req.auth!.rol !== "super_admin") {
    res.status(403).json({ error: "Esta sección es solo para super_admin." });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// Facturar manualmente — cobro único, fuera del ciclo de suscripción.
// ---------------------------------------------------------------------
platformAdminRouter.post("/facturas/manual", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;

  const { tenantId, concepto, montoUsd } = req.body as {
    tenantId?: string;
    concepto?: string;
    montoUsd?: number;
  };

  if (!tenantId || !concepto?.trim() || !montoUsd || montoUsd <= 0) {
    return res.status(400).json({ error: "Faltan tenantId, concepto o montoUsd (debe ser mayor a 0)." });
  }

  try {
    const tenantResult = await req.db!.query(
      `SELECT nombre, stripe_customer_id FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      return res.status(404).json({ error: "Clínica no encontrada." });
    }
    if (!tenant.stripe_customer_id) {
      return res.status(409).json({ error: "Esta clínica todavía no tiene un customer de Stripe asociado." });
    }

    const stripe = requerirStripe();

    // El invoiceItem pendiente se adjunta automáticamente al crear la
    // factura para el mismo customer (comportamiento default de Stripe
    // cuando no se pasa pending_invoice_items_behavior: 'exclude').
    await stripe.invoiceItems.create({
      customer: tenant.stripe_customer_id,
      amount: Math.round(montoUsd * 100),
      currency: "usd",
      description: concepto.trim(),
    });
    const invoice = await stripe.invoices.create({
      customer: tenant.stripe_customer_id,
      collection_method: "charge_automatically",
      auto_advance: true,
    });
    const finalizada = await stripe.invoices.finalizeInvoice(invoice.id);

    await registrarEventoFacturacion(
      req.db!,
      tenantId,
      "factura_manual",
      montoUsd,
      finalizada.id,
      concepto.trim()
    );

    res.status(201).json({
      factura: {
        clinica: tenant.nombre,
        concepto: concepto.trim(),
        monto: montoUsd,
        stripeInvoiceId: finalizada.id,
      },
    });
  } catch (err: any) {
    console.error("POST /platform-admin/facturas/manual", err);
    if (err?.type?.startsWith("Stripe")) {
      return res.status(402).json({ error: err.message ?? "Error al emitir la factura en Stripe." });
    }
    res.status(500).json({ error: "Error al emitir la factura manual." });
  }
});

// ---------------------------------------------------------------------
// FACTURAS
// ---------------------------------------------------------------------
platformAdminRouter.get("/facturacion/resumen-facturas", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;
  try {
    const ingresos = await req.db!.query(
      `SELECT COALESCE(SUM(monto_usd), 0) AS total FROM eventos_facturacion
       WHERE tipo = 'pago_exitoso' AND fecha >= date_trunc('month', now())`
    );
    const emitidas = await req.db!.query(
      `SELECT COUNT(*) FROM eventos_facturacion
       WHERE tipo IN ('pago_exitoso', 'factura_manual', 'excedente_aplicado')
         AND fecha >= now() - interval '30 days'`
    );
    const pendientes = await req.db!.query(
      `SELECT COUNT(*) FROM eventos_facturacion e
       WHERE e.tipo IN ('factura_manual', 'excedente_aplicado')
         AND NOT EXISTS (
           SELECT 1 FROM eventos_facturacion pe
           WHERE pe.tipo = 'pago_exitoso' AND pe.referencia_externa = e.referencia_externa
         )`
    );
    res.json({
      ingresosEsteMes: Number(ingresos.rows[0].total),
      facturasEmitidas30d: Number(emitidas.rows[0].count),
      facturasPendientes: Number(pendientes.rows[0].count),
    });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/resumen-facturas", err);
    res.status(500).json({ error: "Error al obtener el resumen de facturas." });
  }
});

platformAdminRouter.get("/facturacion/facturas", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;

  const { desde, hasta, q, estado, origen } = req.query as {
    desde?: string;
    hasta?: string;
    q?: string;
    estado?: string;
    origen?: string;
  };
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);

  const condiciones = [`e.tipo IN ('pago_exitoso', 'factura_manual', 'excedente_aplicado')`];
  const params: any[] = [];
  if (desde) {
    params.push(desde);
    condiciones.push(`e.fecha >= $${params.length}::date`);
  }
  if (hasta) {
    params.push(hasta);
    condiciones.push(`e.fecha < ($${params.length}::date + interval '1 day')`);
  }
  if (q) {
    params.push(`%${q}%`);
    condiciones.push(`(t.nombre ILIKE $${params.length} OR e.detalle ILIKE $${params.length})`);
  }
  const where = `WHERE ${condiciones.join(" AND ")}`;

  // estado/origen son columnas calculadas (no existen en la tabla), así
  // que el filtro se aplica en un WHERE aparte, afuera de la CTE que las
  // calcula — SQL no deja reusar un alias del SELECT en el mismo nivel.
  const condicionesCalculadas: string[] = [];
  if (estado) {
    params.push(estado);
    condicionesCalculadas.push(`estado = $${params.length}`);
  }
  if (origen) {
    params.push(origen);
    condicionesCalculadas.push(`origen = $${params.length}`);
  }
  const whereCalculado =
    condicionesCalculadas.length > 0 ? `WHERE ${condicionesCalculadas.join(" AND ")}` : "";

  const cte = `
    WITH base AS (
      SELECT e.id, t.nombre AS clinica, e.detalle AS concepto, e.monto_usd AS monto, e.fecha,
             CASE
               WHEN e.tipo = 'pago_exitoso' THEN 'pagada'
               WHEN EXISTS (
                 SELECT 1 FROM eventos_facturacion pe
                 WHERE pe.tipo = 'pago_exitoso' AND pe.referencia_externa = e.referencia_externa
               ) THEN 'pagada'
               ELSE 'pendiente'
             END AS estado,
             CASE WHEN e.tipo = 'factura_manual' THEN 'manual' ELSE 'automatica' END AS origen
      FROM eventos_facturacion e
      JOIN tenants t ON t.id = e.tenant_id
      ${where}
    )
  `;

  try {
    const totalResult = await req.db!.query(`${cte} SELECT COUNT(*) FROM base ${whereCalculado}`, params);
    const total = Number(totalResult.rows[0].count);

    const filasResult = await req.db!.query(
      `${cte} SELECT * FROM base ${whereCalculado}
       ORDER BY fecha DESC
       LIMIT ${POR_PAGINA_FACTURACION} OFFSET ${(pagina - 1) * POR_PAGINA_FACTURACION}`,
      params
    );

    res.json({
      facturas: filasResult.rows.map((r) => ({
        id: r.id,
        clinica: r.clinica,
        concepto: r.concepto,
        monto: Number(r.monto),
        fecha: r.fecha,
        estado: r.estado,
        origen: r.origen,
      })),
      total,
      pagina,
      totalPaginas: Math.max(1, Math.ceil(total / POR_PAGINA_FACTURACION)),
    });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/facturas", err);
    res.status(500).json({ error: "Error al listar las facturas." });
  }
});

// ---------------------------------------------------------------------
// PAGOS
// ---------------------------------------------------------------------
platformAdminRouter.get("/facturacion/resumen-pagos", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;
  try {
    const exitosos = await req.db!.query(
      `SELECT COUNT(*) FROM eventos_facturacion WHERE tipo = 'pago_exitoso' AND fecha >= now() - interval '30 days'`
    );
    const monto = await req.db!.query(
      `SELECT COALESCE(SUM(monto_usd), 0) AS total FROM eventos_facturacion
       WHERE tipo = 'pago_exitoso' AND fecha >= now() - interval '30 days'`
    );
    const fallidos = await req.db!.query(
      `SELECT COUNT(*) FROM eventos_facturacion WHERE tipo = 'pago_fallido' AND fecha >= now() - interval '30 days'`
    );
    res.json({
      pagosExitosos30d: Number(exitosos.rows[0].count),
      montoTotalCobrado30d: Number(monto.rows[0].total),
      pagosFallidos30d: Number(fallidos.rows[0].count),
    });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/resumen-pagos", err);
    res.status(500).json({ error: "Error al obtener el resumen de pagos." });
  }
});

platformAdminRouter.get("/facturacion/pagos", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;

  const { desde, hasta, q } = req.query as { desde?: string; hasta?: string; q?: string };
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);

  const condiciones = [`e.tipo = 'pago_exitoso'`];
  const params: any[] = [];
  if (desde) {
    params.push(desde);
    condiciones.push(`e.fecha >= $${params.length}::date`);
  }
  if (hasta) {
    params.push(hasta);
    condiciones.push(`e.fecha < ($${params.length}::date + interval '1 day')`);
  }
  if (q) {
    params.push(`%${q}%`);
    condiciones.push(`t.nombre ILIKE $${params.length}`);
  }
  const where = `WHERE ${condiciones.join(" AND ")}`;

  try {
    const totalResult = await req.db!.query(
      `SELECT COUNT(*) FROM eventos_facturacion e JOIN tenants t ON t.id = e.tenant_id ${where}`,
      params
    );
    const total = Number(totalResult.rows[0].count);

    const filasResult = await req.db!.query(
      `SELECT e.id, t.nombre AS clinica, e.monto_usd AS monto, e.fecha, p.nombre AS plan
       FROM eventos_facturacion e
       JOIN tenants t ON t.id = e.tenant_id
       LEFT JOIN planes p ON p.id = t.plan_id
       ${where}
       ORDER BY e.fecha DESC
       LIMIT ${POR_PAGINA_FACTURACION} OFFSET ${(pagina - 1) * POR_PAGINA_FACTURACION}`,
      params
    );

    res.json({
      pagos: filasResult.rows.map((r) => ({
        id: r.id,
        clinica: r.clinica,
        monto: Number(r.monto),
        fecha: r.fecha,
        plan: r.plan,
      })),
      total,
      pagina,
      totalPaginas: Math.max(1, Math.ceil(total / POR_PAGINA_FACTURACION)),
    });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/pagos", err);
    res.status(500).json({ error: "Error al listar los pagos." });
  }
});

// ---------------------------------------------------------------------
// CANCELACIONES
// ---------------------------------------------------------------------
platformAdminRouter.get("/facturacion/resumen-cancelaciones", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;
  try {
    const pendientes = await req.db!.query(
      `SELECT COUNT(*) FROM tenants WHERE cancelacion_solicitada = true AND estado_suscripcion = 'activa'`
    );
    const completadas30 = await req.db!.query(
      `SELECT COUNT(*) FROM eventos_facturacion WHERE tipo = 'cancelacion' AND fecha >= now() - interval '30 days'`
    );
    // Base de comparación: clínicas que alguna vez pagaron (activa,
    // suspendida o cancelada) — un tenant todavía en trial no cuenta para
    // la tasa de cancelación del mes.
    const base = await req.db!.query(
      `SELECT COUNT(*) FROM tenants WHERE estado_suscripcion IN ('activa', 'suspendida', 'cancelada')`
    );
    const totalBase = Number(base.rows[0].count);
    const tasa = totalBase > 0 ? Math.round((Number(completadas30.rows[0].count) / totalBase) * 1000) / 10 : 0;

    res.json({
      cancelacionesPendientes: Number(pendientes.rows[0].count),
      cancelacionesCompletadas30d: Number(completadas30.rows[0].count),
      tasaCancelacionMes: tasa,
    });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/resumen-cancelaciones", err);
    res.status(500).json({ error: "Error al obtener el resumen de cancelaciones." });
  }
});

platformAdminRouter.get("/facturacion/cancelaciones", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;

  const { q, estado } = req.query as { q?: string; estado?: string };
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);

  // "Pendiente": ya se pidió la cancelación pero el job diario todavía no
  // llegó a la fecha efectiva (estado_suscripcion sigue 'activa').
  // "Completada": el job ya pasó el tenant a 'cancelada' y quedó su
  // evento correspondiente en eventos_facturacion (ver suscripciones.job.ts).
  const cte = `
    WITH combinado AS (
      SELECT t.id, t.nombre AS clinica, t.cancelacion_solicitada_en AS fecha_solicitud,
             t.cancelacion_efectiva_en AS fecha_efectiva, 'pendiente' AS estado
      FROM tenants t
      WHERE t.cancelacion_solicitada = true AND t.estado_suscripcion = 'activa'
      UNION ALL
      SELECT t.id, t.nombre AS clinica, t.cancelacion_solicitada_en AS fecha_solicitud,
             t.cancelacion_efectiva_en AS fecha_efectiva, 'completada' AS estado
      FROM tenants t
      JOIN eventos_facturacion ef ON ef.tenant_id = t.id AND ef.tipo = 'cancelacion'
      WHERE t.estado_suscripcion = 'cancelada'
    )
  `;
  const params: any[] = [];
  const condicionesCombinado: string[] = [];
  if (q) {
    params.push(`%${q}%`);
    condicionesCombinado.push(`clinica ILIKE $${params.length}`);
  }
  if (estado) {
    params.push(estado);
    condicionesCombinado.push(`estado = $${params.length}`);
  }
  const whereClinica = condicionesCombinado.length > 0 ? `WHERE ${condicionesCombinado.join(" AND ")}` : "";

  try {
    const totalResult = await req.db!.query(
      `${cte} SELECT COUNT(*) FROM combinado ${whereClinica}`,
      params
    );
    const total = Number(totalResult.rows[0].count);

    const filasResult = await req.db!.query(
      `${cte} SELECT * FROM combinado ${whereClinica}
       ORDER BY fecha_efectiva DESC NULLS LAST
       LIMIT ${POR_PAGINA_FACTURACION} OFFSET ${(pagina - 1) * POR_PAGINA_FACTURACION}`,
      params
    );

    res.json({
      cancelaciones: filasResult.rows.map((r) => ({
        id: r.id,
        clinica: r.clinica,
        fechaSolicitud: r.fecha_solicitud,
        fechaEfectiva: r.fecha_efectiva,
        estado: r.estado,
      })),
      total,
      pagina,
      totalPaginas: Math.max(1, Math.ceil(total / POR_PAGINA_FACTURACION)),
    });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/cancelaciones", err);
    res.status(500).json({ error: "Error al listar las cancelaciones." });
  }
});

// ---------------------------------------------------------------------
// NUEVAS CLÍNICAS
// ---------------------------------------------------------------------
platformAdminRouter.get("/facturacion/resumen-nuevas-clinicas", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;
  try {
    const nuevas30 = await req.db!.query(
      `SELECT COUNT(*) FROM tenants WHERE creado_en >= now() - interval '30 days'`
    );
    const enTrial = await req.db!.query(`SELECT COUNT(*) FROM tenants WHERE estado_suscripcion = 'trial'`);
    // "Convertida" = su trial terminó y quedó activa en un plan pago — no
    // hay una fecha de conversión propia guardada, así que se aproxima con
    // trial_termina_en dentro de los últimos 30 días (el job de
    // suscripciones.job.ts la pasa a 'activa' justo quand vence el trial).
    const convertidas30 = await req.db!.query(
      `SELECT COUNT(*) FROM tenants t
       JOIN planes p ON p.id = t.plan_id
       WHERE t.estado_suscripcion = 'activa' AND p.es_plan_prueba = false
         AND t.trial_termina_en IS NOT NULL AND t.trial_termina_en >= now() - interval '30 days'`
    );
    res.json({
      clinicasNuevas30d: Number(nuevas30.rows[0].count),
      enPeriodoDePrueba: Number(enTrial.rows[0].count),
      convertidasAPago30d: Number(convertidas30.rows[0].count),
    });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/resumen-nuevas-clinicas", err);
    res.status(500).json({ error: "Error al obtener el resumen de nuevas clínicas." });
  }
});

platformAdminRouter.get("/facturacion/nuevas-clinicas", async (req, res) => {
  if (!requiereSuperAdmin(req, res)) return;

  const { q } = req.query as { q?: string };
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);

  const condiciones: string[] = [];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    condiciones.push(`t.nombre ILIKE $${params.length}`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const totalResult = await req.db!.query(`SELECT COUNT(*) FROM tenants t ${where}`, params);
    const total = Number(totalResult.rows[0].count);

    const filasResult = await req.db!.query(
      `SELECT t.id, t.nombre, t.pais_codigo, t.creado_en, t.estado_suscripcion, p.nombre AS plan_nombre
       FROM tenants t
       LEFT JOIN planes p ON p.id = t.plan_id
       ${where}
       ORDER BY t.creado_en DESC
       LIMIT ${POR_PAGINA_FACTURACION} OFFSET ${(pagina - 1) * POR_PAGINA_FACTURACION}`,
      params
    );

    res.json({
      clinicas: filasResult.rows.map((r) => ({
        id: r.id,
        nombre: r.nombre,
        pais: r.pais_codigo,
        fechaRegistro: r.creado_en,
        estado: r.estado_suscripcion,
        plan: r.plan_nombre,
      })),
      total,
      pagina,
      totalPaginas: Math.max(1, Math.ceil(total / POR_PAGINA_FACTURACION)),
    });
  } catch (err) {
    console.error("GET /platform-admin/facturacion/nuevas-clinicas", err);
    res.status(500).json({ error: "Error al listar las nuevas clínicas." });
  }
});
