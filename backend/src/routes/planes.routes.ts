import { Router } from "express";
import { pool } from "../db";

export const planesRouter = Router();

// Público a propósito: se consulta desde /registro antes de tener sesión
// (el que se está por dar de alta necesita ver precios para elegir). Solo
// los planes pagos — "Prueba Gratuita" ya no es seleccionable acá, no hay
// más período de prueba (decisión de producto, ver migración 022).
planesRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, cupos_agente_medico, presupuesto_usd_incluido, precio_mensual_usd, precio_cupo_extra_usd
       FROM planes
       WHERE es_plan_prueba = false
       ORDER BY precio_mensual_usd`
    );
    res.json({ planes: result.rows });
  } catch (err) {
    console.error("GET /planes", err);
    res.status(500).json({ error: "Error al obtener los planes." });
  }
});
