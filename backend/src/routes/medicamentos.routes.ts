import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Catálogo de medicamentos — propio de cada clínica (tenant_id), común a
// cualquier agente clínico (GCIS, ICIS, u otros a futuro). Sin ninguna
// lógica de filtrado manual por tenant: la conexión ya trae
// app.tenant_id seteado (withTenantClient) y RLS hace el resto, igual
// que el resto del backend.
// ---------------------------------------------------------------------
export const medicamentosRouter = Router();

medicamentosRouter.use(authenticate, withTenantClient);

medicamentosRouter.use((req, res, next) => {
  if (!req.auth!.esMedico) {
    return res.status(403).json({ error: "Esta sección es solo para médicos." });
  }
  next();
});

// GET /api/medicamentos?q=... — lista para autocompletado del frontend.
medicamentosRouter.get("/", async (req, res) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    const result = await req.db!.query(
      q
        ? `SELECT * FROM medicamentos WHERE activo = true AND nombre ILIKE $1 ORDER BY nombre ASC LIMIT 20`
        : `SELECT * FROM medicamentos WHERE activo = true ORDER BY nombre ASC`,
      q ? [`%${q}%`] : []
    );
    res.json({ medicamentos: result.rows });
  } catch (err) {
    console.error("GET /medicamentos", err);
    res.status(500).json({ error: "Error al listar medicamentos." });
  }
});

medicamentosRouter.post("/", async (req, res) => {
  const {
    nombre,
    principioActivo,
    presentacion,
    concentracion,
    viaAdministracionDefault,
    dosisMin,
    dosisMax,
    unidadDosis,
  } = req.body as {
    nombre?: string;
    principioActivo?: string;
    presentacion?: string;
    concentracion?: string;
    viaAdministracionDefault?: string;
    dosisMin?: number;
    dosisMax?: number;
    unidadDosis?: string;
  };

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre del medicamento." });
  }

  try {
    const result = await req.db!.query(
      `INSERT INTO medicamentos
         (tenant_id, nombre, principio_activo, presentacion, concentracion,
          via_administracion_default, dosis_min, dosis_max, unidad_dosis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.auth!.tenantId,
        nombre.trim(),
        principioActivo ?? null,
        presentacion ?? null,
        concentracion ?? null,
        viaAdministracionDefault ?? null,
        dosisMin ?? null,
        dosisMax ?? null,
        unidadDosis ?? null,
      ]
    );
    res.status(201).json({ medicamento: result.rows[0] });
  } catch (err) {
    console.error("POST /medicamentos", err);
    res.status(500).json({ error: "Error al crear el medicamento." });
  }
});

medicamentosRouter.put("/:id", async (req, res) => {
  const {
    nombre,
    principioActivo,
    presentacion,
    concentracion,
    viaAdministracionDefault,
    dosisMin,
    dosisMax,
    unidadDosis,
  } = req.body as {
    nombre?: string;
    principioActivo?: string;
    presentacion?: string;
    concentracion?: string;
    viaAdministracionDefault?: string;
    dosisMin?: number;
    dosisMax?: number;
    unidadDosis?: string;
  };

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre del medicamento." });
  }

  try {
    const result = await req.db!.query(
      `UPDATE medicamentos
       SET nombre = $1, principio_activo = $2, presentacion = $3, concentracion = $4,
           via_administracion_default = $5, dosis_min = $6, dosis_max = $7, unidad_dosis = $8
       WHERE id = $9
       RETURNING *`,
      [
        nombre.trim(),
        principioActivo ?? null,
        presentacion ?? null,
        concentracion ?? null,
        viaAdministracionDefault ?? null,
        dosisMin ?? null,
        dosisMax ?? null,
        unidadDosis ?? null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Medicamento no encontrado." });
    }
    res.json({ medicamento: result.rows[0] });
  } catch (err) {
    console.error("PUT /medicamentos/:id", err);
    res.status(500).json({ error: "Error al editar el medicamento." });
  }
});

// Soft-delete — nunca se borra un medicamento (podría estar referenciado
// por receta_items de recetas ya emitidas).
medicamentosRouter.patch("/:id/desactivar", async (req, res) => {
  try {
    const result = await req.db!.query(
      `UPDATE medicamentos SET activo = false WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Medicamento no encontrado." });
    }
    res.json({ medicamento: result.rows[0] });
  } catch (err) {
    console.error("PATCH /medicamentos/:id/desactivar", err);
    res.status(500).json({ error: "Error al desactivar el medicamento." });
  }
});
