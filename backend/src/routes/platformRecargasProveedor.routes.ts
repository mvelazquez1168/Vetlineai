import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// prompt_code_panel_consumo_plataforma, Paso 1 — recargas de la cuenta
// de Anthropic. Entrada manual a propósito: el saldo no se puede
// consultar por API (ver docs/inventario-stack-configuracion.md), así
// que esta tabla es la única fuente real de "cuánto se cargó" — el
// saldo derivado (Paso 3) se calcula contra esto, nunca al revés.
// Mismo nivel de sensibilidad que tarifas/parámetros: solo super_admin.
// ---------------------------------------------------------------------

export const platformRecargasProveedorRouter = Router();

platformRecargasProveedorRouter.use(authenticate, withTenantClient);

platformRecargasProveedorRouter.use((req, res, next) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "Las recargas del proveedor de IA son solo para super_admin." });
  }
  next();
});

platformRecargasProveedorRouter.get("/recargas-proveedor-ia", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT r.id, r.fecha, r.monto_usd, r.nota, r.creado_en, s.nombre AS cargado_por_nombre
       FROM recargas_proveedor_ia r
       JOIN staff_plataforma s ON s.id = r.cargado_por
       ORDER BY r.fecha DESC, r.creado_en DESC`
    );
    res.json({
      recargas: result.rows.map((r) => ({
        id: r.id,
        fecha: r.fecha,
        montoUsd: Number(r.monto_usd),
        nota: r.nota,
        creadoEn: r.creado_en,
        cargadoPorNombre: r.cargado_por_nombre,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/recargas-proveedor-ia", err);
    res.status(500).json({ error: "Error al listar las recargas." });
  }
});

platformRecargasProveedorRouter.post("/recargas-proveedor-ia", async (req, res) => {
  const { fecha, montoUsd, nota } = req.body as { fecha?: string; montoUsd?: number; nota?: string };

  if (!fecha || typeof montoUsd !== "number" || !Number.isFinite(montoUsd) || montoUsd <= 0) {
    return res.status(400).json({ error: "Faltan la fecha o el monto, o el monto no es válido." });
  }

  try {
    const result = await req.db!.query(
      `INSERT INTO recargas_proveedor_ia (fecha, monto_usd, cargado_por, nota)
       VALUES ($1, $2, $3, $4)
       RETURNING id, fecha, monto_usd, nota, creado_en`,
      [fecha, montoUsd, req.auth!.userId, nota?.trim() || null]
    );
    res.status(201).json({
      id: result.rows[0].id,
      fecha: result.rows[0].fecha,
      montoUsd: Number(result.rows[0].monto_usd),
      nota: result.rows[0].nota,
      creadoEn: result.rows[0].creado_en,
    });
  } catch (err) {
    console.error("POST /platform-admin/recargas-proveedor-ia", err);
    res.status(500).json({ error: "Error al registrar la recarga." });
  }
});
