import { Router } from "express";
import { pool } from "../db";
import { authenticate } from "../middleware/auth";

export const farmacosRouter = Router();

// Catálogo global (no tiene tenant_id, no lleva RLS) — a diferencia de
// /api/paises, esta es información de formulario/negocio propia de la
// plataforma, así que sí requiere sesión válida (cualquier rol).
farmacosRouter.get("/", authenticate, async (req, res) => {
  const { pais, principioActivo } = req.query;

  try {
    const condiciones: string[] = [];
    const params: string[] = [];

    if (typeof pais === "string" && pais) {
      params.push(pais);
      condiciones.push(`pais_codigo = $${params.length}`);
    }
    if (typeof principioActivo === "string" && principioActivo) {
      params.push(`%${principioActivo}%`);
      condiciones.push(`principio_activo ILIKE $${params.length}`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT id, principio_activo, pais_codigo, nombre_comercial
       FROM farmacos_equivalencias
       ${where}
       ORDER BY principio_activo`,
      params
    );
    res.json({ equivalencias: result.rows });
  } catch (err) {
    console.error("GET /farmacos-equivalencias", err);
    res.status(500).json({ error: "Error al listar equivalencias de fármacos." });
  }
});
