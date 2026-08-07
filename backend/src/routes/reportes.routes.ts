import { Router } from "express";
import { authenticate } from "../middleware/auth";

export const reportesRouter = Router();

// Datos de referencia estáticos — no dependen del tenant ni requieren DB,
// solo una sesión válida (cualquier rol autenticado puede consultarlos).
const GRUPOS_TIPOS_REPORTE = [
  {
    grupo: "Para el expediente",
    tipos: ["Informe de consulta", "Reporte de seguimiento", "Informe de cierre de caso"],
  },
  {
    grupo: "Para compartir",
    tipos: ["Segunda opinión", "Informe de derivación"],
  },
  {
    grupo: "Para la Base de Conocimiento",
    tipos: ["Caso docente", "Caso para Base de Conocimiento"],
  },
];

reportesRouter.get("/tipos", authenticate, (_req, res) => {
  res.json({ grupos: GRUPOS_TIPOS_REPORTE });
});
