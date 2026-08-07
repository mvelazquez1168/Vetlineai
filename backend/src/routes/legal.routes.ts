import { Router } from "express";
import { pool } from "../db";

export const legalRouter = Router();

const TIPOS_VALIDOS = ["terminos_condiciones", "politica_privacidad"];

// Público a propósito: se puede consultar desde /registro o /login antes
// de tener sesión. Solo consulta — no es un gate de ninguna acción.
legalRouter.get("/:tipo", async (req, res) => {
  const { tipo } = req.params;
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: "Tipo de documento inválido." });
  }

  try {
    const result = await pool.query(
      `SELECT id, tipo, contenido, version, fecha_publicacion
       FROM documentos_legales
       WHERE tipo = $1 AND activo = true
       ORDER BY fecha_publicacion DESC
       LIMIT 1`,
      [tipo]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No hay una versión publicada de este documento." });
    }
    res.json({ documento: result.rows[0] });
  } catch (err) {
    console.error("GET /legal/:tipo", err);
    res.status(500).json({ error: "Error al obtener el documento." });
  }
});
