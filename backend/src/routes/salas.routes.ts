import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Salas de examen/cirugía/dental de la clínica (tenant_id directo — ver
// nota de diseño en la migración 017: no hay concepto de sede/clínica
// múltiple en este esquema, sala no implica una sede distinta).
// ---------------------------------------------------------------------
export const salasRouter = Router();

salasRouter.use(authenticate, withTenantClient);

salasRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

salasRouter.get("/", async (req, res) => {
  try {
    const result = await req.db!.query(`SELECT * FROM salas WHERE activa = true ORDER BY nombre ASC`);
    res.json({ salas: result.rows });
  } catch (err) {
    console.error("GET /salas", err);
    res.status(500).json({ error: "Error al listar las salas." });
  }
});

salasRouter.post("/", async (req, res) => {
  const { nombre, tipo } = req.body as { nombre?: string; tipo?: string };
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre de la sala." });
  }
  try {
    const result = await req.db!.query(
      `INSERT INTO salas (tenant_id, nombre, tipo) VALUES ($1, $2, $3) RETURNING *`,
      [req.auth!.tenantId, nombre.trim(), tipo ?? null]
    );
    res.status(201).json({ sala: result.rows[0] });
  } catch (err) {
    console.error("POST /salas", err);
    res.status(500).json({ error: "Error al crear la sala." });
  }
});

salasRouter.put("/:id", async (req, res) => {
  const { nombre, tipo } = req.body as { nombre?: string; tipo?: string };
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre de la sala." });
  }
  try {
    const result = await req.db!.query(
      `UPDATE salas SET nombre = $1, tipo = $2 WHERE id = $3 RETURNING *`,
      [nombre.trim(), tipo ?? null, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Sala no encontrada." });
    }
    res.json({ sala: result.rows[0] });
  } catch (err) {
    console.error("PUT /salas/:id", err);
    res.status(500).json({ error: "Error al editar la sala." });
  }
});

salasRouter.patch("/:id/desactivar", async (req, res) => {
  try {
    const result = await req.db!.query(
      `UPDATE salas SET activa = false WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Sala no encontrada." });
    }
    res.json({ sala: result.rows[0] });
  } catch (err) {
    console.error("PATCH /salas/:id/desactivar", err);
    res.status(500).json({ error: "Error al desactivar la sala." });
  }
});
