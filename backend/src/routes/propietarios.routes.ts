import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

export const propietariosRouter = Router();

propietariosRouter.use(authenticate, withTenantClient);

// Ampliado a admin_clinica (ver prompt_fix_agenda_permisos_paciente.md):
// el módulo de Agenda necesita que un admin también pueda buscar/crear
// propietarios y pacientes al armar una cita nueva, no solo un médico
// vía el wizard de "Nuevo Caso" original que gateaba esto.
propietariosRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

// ---------------------------------------------------------------------
// GET /api/propietarios/tipos-identificacion
// prompt_code_expediente_y_propietario, Parte B2 — mismo catálogo
// tipos_identificacion que usa el registro de la clínica (paises.routes.ts,
// admin.routes.ts), filtrado automáticamente por el país de la propia
// clínica del médico/admin que llama — a diferencia de esas dos rutas,
// acá el país no es un parámetro: es siempre el de req.auth, nunca uno
// elegido por el cliente.
// ---------------------------------------------------------------------
propietariosRouter.get("/tipos-identificacion", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT ti.id, ti.codigo, ti.etiqueta
       FROM tipos_identificacion ti
       JOIN tenants t ON t.pais_codigo = ti.pais_codigo
       WHERE t.id = $1 AND ti.activo = true AND ti.aplica_persona_fisica = true
       ORDER BY ti.orden`,
      [req.auth!.tenantId]
    );
    res.json({ tipos: result.rows });
  } catch (err) {
    console.error("GET /propietarios/tipos-identificacion", err);
    res.status(500).json({ error: "Error al obtener los tipos de identificación." });
  }
});

// ---------------------------------------------------------------------
// GET /api/propietarios/buscar-por-identificacion?tipoIdentificacionId=X&numero=Y
// prompt_code_propietarios, Ajuste 1 — búsqueda EXACTA (no ILIKE) por la
// combinación que la propia tabla trata como llave única
// (propietarios_identificacion_unica: tenant + tipo + número). Es la que
// dispara el formulario de alta apenas se completan los dos campos, para
// ofrecer "usar este propietario" antes de crear uno nuevo. Devuelve como
// mucho un propietario (la unicidad lo garantiza), o ninguno.
// ---------------------------------------------------------------------
propietariosRouter.get("/buscar-por-identificacion", async (req, res) => {
  const tipoIdentificacionId = typeof req.query.tipoIdentificacionId === "string" ? req.query.tipoIdentificacionId : "";
  const numero = typeof req.query.numero === "string" ? req.query.numero.trim() : "";

  if (!tipoIdentificacionId || !numero) {
    return res.status(400).json({ error: "Faltan tipoIdentificacionId o numero." });
  }

  try {
    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.telefono, p.email, p.direccion, p.numero_identificacion,
              ti.etiqueta AS tipo_identificacion_etiqueta
       FROM propietarios p
       LEFT JOIN tipos_identificacion ti ON ti.id = p.tipo_identificacion_id
       WHERE p.tipo_identificacion_id = $1 AND p.numero_identificacion = $2`,
      [tipoIdentificacionId, numero]
    );
    res.json({ propietario: result.rows[0] ?? null });
  } catch (err) {
    console.error("GET /propietarios/buscar-por-identificacion", err);
    res.status(500).json({ error: "Error al buscar por identificación." });
  }
});

// ---------------------------------------------------------------------
// GET /api/propietarios/buscar?q=texto
// Búsqueda por nombre, teléfono, email o número de identificación (ILIKE,
// no exact match), máximo 10 resultados. Sin query (q vacío/ausente)
// devuelve los primeros 10 alfabéticamente, para poblar el paso 1 del
// wizard de "Nuevo caso" antes de que el médico escriba nada.
// ---------------------------------------------------------------------
propietariosRouter.get("/buscar", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  try {
    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.telefono, p.email, p.numero_identificacion,
              ti.etiqueta AS tipo_identificacion_etiqueta
       FROM propietarios p
       LEFT JOIN tipos_identificacion ti ON ti.id = p.tipo_identificacion_id
       WHERE $1 = ''
          OR p.nombre ILIKE '%' || $1 || '%'
          OR p.telefono ILIKE '%' || $1 || '%'
          OR p.email ILIKE '%' || $1 || '%'
          OR p.numero_identificacion ILIKE '%' || $1 || '%'
       ORDER BY p.nombre
       LIMIT 10`,
      [q]
    );
    res.json({ propietarios: result.rows });
  } catch (err) {
    console.error("GET /propietarios/buscar", err);
    res.status(500).json({ error: "Error al buscar propietarios." });
  }
});

// ---------------------------------------------------------------------
// POST /api/propietarios
// tipoIdentificacionId/numeroIdentificacion son opcionales — Parte B2:
// una clínica que atiende una urgencia no debe verse obligada a pedirle
// documentos al tutor. Cuando se completan, tienen que venir los dos
// juntos (el CHECK de la migración 047 lo exige a nivel de base; acá se
// valida temprano para devolver un 400 claro en vez de un error crudo de
// constraint) y la unicidad por clínica la aplica esa misma migración.
// ---------------------------------------------------------------------
propietariosRouter.post("/", async (req, res) => {
  const { nombre, telefono, email, direccion, tipoIdentificacionId, numeroIdentificacion } = req.body as {
    nombre?: string;
    telefono?: string;
    email?: string;
    direccion?: string;
    tipoIdentificacionId?: string;
    numeroIdentificacion?: string;
  };

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre del propietario." });
  }
  if (Boolean(tipoIdentificacionId) !== Boolean(numeroIdentificacion?.trim())) {
    return res.status(400).json({
      error: "Si cargás la identificación del propietario, hacen falta el tipo y el número juntos.",
    });
  }

  try {
    const result = await req.db!.query(
      `INSERT INTO propietarios (tenant_id, nombre, telefono, email, direccion, tipo_identificacion_id, numero_identificacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, nombre, telefono, email, direccion, tipo_identificacion_id, numero_identificacion`,
      [
        req.auth!.tenantId,
        nombre.trim(),
        telefono?.trim() || null,
        email?.trim() || null,
        direccion?.trim() || null,
        tipoIdentificacionId || null,
        numeroIdentificacion?.trim() || null,
      ]
    );
    res.status(201).json({ propietario: result.rows[0] });
  } catch (err: any) {
    if (err?.code === "23505" && err?.constraint === "propietarios_identificacion_unica") {
      return res.status(409).json({
        error: "Ya existe un propietario registrado en tu clínica con ese tipo y número de identificación.",
      });
    }
    console.error("POST /propietarios", err);
    res.status(500).json({ error: "Error al crear el propietario." });
  }
});

// ---------------------------------------------------------------------
// GET /api/propietarios/:id/pacientes
// Mascotas ya registradas de ese propietario, para el paso 2 del wizard.
// ---------------------------------------------------------------------
propietariosRouter.get("/:id/pacientes", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.especie, r.nombre AS raza
       FROM pacientes p
       LEFT JOIN razas r ON r.id = p.raza_id
       WHERE p.propietario_id = $1
       ORDER BY p.nombre`,
      [req.params.id]
    );
    res.json({ pacientes: result.rows });
  } catch (err) {
    console.error("GET /propietarios/:id/pacientes", err);
    res.status(500).json({ error: "Error al listar las mascotas del propietario." });
  }
});
