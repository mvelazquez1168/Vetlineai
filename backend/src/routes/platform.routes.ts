import bcrypt from "bcrypt";
import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

export const platformRouter = Router();

platformRouter.use(authenticate, withTenantClient);

platformRouter.use((req, res, next) => {
  if (!["super_admin", "soporte_senior", "soporte"].includes(req.auth!.rol)) {
    return res.status(403).json({ error: "Esta sección es solo para staff de plataforma." });
  }
  next();
});

// NOTA sobre RLS en todo este router: estas queries no ejecutan
// `SET app.tenant_id` (withTenantClient lo salta a propósito cuando
// req.auth.tenantId es null, que es siempre el caso para staff_plataforma).
// Que estas queries igual devuelvan filas de TODOS los tenants depende de
// que la conexión de la app sea dueña de las tablas (ver la misma nota en
// auth.routes.ts). Si en producción el rol de conexión deja de ser owner,
// estas rutas van a necesitar un rol de Postgres con BYPASSRLS explícito.

// =====================================================================
// OVERVIEW (tarjetas superiores)
// =====================================================================

platformRouter.get("/overview", async (req, res) => {
  try {
    const clinicas = await req.db!.query(`SELECT COUNT(*) FROM tenants`);
    const agentesHabilitados = await req.db!.query(
      `SELECT COUNT(*) FROM tenant_agentes WHERE estado = 'habilitado'`
    );

    res.json({
      clinicasActivas: Number(clinicas.rows[0].count),
      agentesHabilitados: Number(agentesHabilitados.rows[0].count),
    });
  } catch (err) {
    console.error("GET /platform/overview", err);
    res.status(500).json({ error: "Error al obtener el resumen." });
  }
});

// =====================================================================
// CLÍNICAS (solo lectura por ahora)
// =====================================================================

// Ajustes del recorrido de prueba, Bloque 1 — filtros por texto, país y
// plan. Este roster no pagina (se asume un volumen manejable para
// staff de plataforma), así que los tres son simples condiciones WHERE.
platformRouter.get("/clinicas", async (req, res) => {
  const { q, pais, plan } = req.query as { q?: string; pais?: string; plan?: string };
  const condiciones: string[] = [];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    condiciones.push(`t.nombre ILIKE $${params.length}`);
  }
  if (pais) {
    params.push(pais);
    condiciones.push(`t.pais_codigo = $${params.length}`);
  }
  if (plan) {
    params.push(plan);
    condiciones.push(`t.plan = $${params.length}`);
  }
  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const result = await req.db!.query(
      `SELECT
         t.id, t.nombre, t.pais_codigo, t.ciudad, t.plan,
         (SELECT COUNT(*) FROM tenant_agentes ta WHERE ta.tenant_id = t.id AND ta.estado = 'habilitado') AS agentes_habilitados,
         (SELECT COUNT(*) FROM personas p WHERE p.tenant_id = t.id AND p.es_admin_clinica = false AND p.estado = 'activo') AS medicos_activos
       FROM tenants t
       ${where}
       ORDER BY t.nombre`,
      params
    );
    res.json({ clinicas: result.rows });
  } catch (err) {
    console.error("GET /platform/clinicas", err);
    res.status(500).json({ error: "Error al listar clínicas." });
  }
});

// Crea una clínica nueva (tenant) junto con su primer usuario admin de
// clínica, en una sola transacción. Sin un admin de clínica, el tenant
// quedaría sin nadie que pueda loguearse a gestionarlo.
platformRouter.post("/clinicas", async (req, res) => {
  const { nombre, pais_codigo, ciudad, idioma, plan, adminNombre, adminEmail } = req.body as {
    nombre?: string;
    pais_codigo?: string;
    ciudad?: string;
    idioma?: string;
    plan?: string;
    adminNombre?: string;
    adminEmail?: string;
  };

  if (!nombre || !pais_codigo || !adminNombre || !adminEmail) {
    return res
      .status(400)
      .json({ error: "Faltan nombre, país, o los datos del admin de clínica (nombre y email)." });
  }

  try {
    const tenantResult = await req.db!.query(
      `INSERT INTO tenants (nombre, pais_codigo, ciudad, idioma, plan)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, pais_codigo, ciudad, plan`,
      [nombre, pais_codigo, ciudad ?? null, idioma ?? "es", plan ?? "profesional"]
    );
    const tenant = tenantResult.rows[0];

    // NOTA: igual que en admin.routes.ts, el admin de clínica nuevo se crea
    // con la contraseña de desarrollo compartida. En una fase futura esto
    // se reemplaza por una invitación real con set-password propio.
    const passwordHash = await bcrypt.hash("DevPassword123!", 10);
    await req.db!.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica)
       VALUES ($1, $2, $3, $4, true)`,
      [tenant.id, adminNombre, adminEmail, passwordHash]
    );

    res.status(201).json({ clinica: { ...tenant, agentes_habilitados: 0, medicos_activos: 0 } });
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un usuario con ese email de admin." });
    }
    console.error("POST /platform/clinicas", err);
    res.status(500).json({ error: "Error al crear la clínica." });
  }
});

// =====================================================================
// AGENTES (catálogo global, solo lectura por ahora)
// =====================================================================

platformRouter.get("/agentes", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT
         a.id, a.nombre, a.descripcion, a.estado_catalogo,
         (SELECT COUNT(*) FROM tenant_agentes ta WHERE ta.agente_id = a.id AND ta.estado = 'habilitado') AS clinicas_habilitadas
       FROM agentes a
       ORDER BY a.nombre`
    );
    res.json({ agentes: result.rows });
  } catch (err) {
    console.error("GET /platform/agentes", err);
    res.status(500).json({ error: "Error al listar agentes." });
  }
});

// Da de alta un agente nuevo en el catálogo global (no habilita a ningún
// tenant automáticamente — eso sigue pasando por el flujo de solicitudes).
platformRouter.post("/agentes", async (req, res) => {
  const { nombre, descripcion, estadoCatalogo, icono } = req.body as {
    nombre?: string;
    descripcion?: string;
    estadoCatalogo?: "disponible" | "proximamente";
    icono?: string;
  };

  if (!nombre) {
    return res.status(400).json({ error: "Falta el nombre del agente." });
  }

  const slug = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // saca tildes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  try {
    const result = await req.db!.query(
      `INSERT INTO agentes (nombre, slug, descripcion, icono, estado_catalogo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, descripcion, estado_catalogo`,
      [nombre, slug, descripcion ?? null, icono ?? "activity", estadoCatalogo ?? "proximamente"]
    );
    res.status(201).json({ agente: { ...result.rows[0], clinicas_habilitadas: 0 } });
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un agente con ese nombre." });
    }
    console.error("POST /platform/agentes", err);
    res.status(500).json({ error: "Error al crear el agente." });
  }
});
