import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Platform Admin — administración de parametros_plataforma. Estos 9
// valores (trial.*, saldo.*, recarga.*, purga.*, agentes.cambios_por_ciclo)
// hoy solo se pueden cambiar editando la base a mano; este router es el
// primer punto de entrada real.
// ---------------------------------------------------------------------

export const platformParametrosRouter = Router();

platformParametrosRouter.use(authenticate, withTenantClient);

platformParametrosRouter.use((req, res, next) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "La administración de parámetros es solo para super_admin." });
  }
  next();
});

// Validación por clave: nunca negativo; toda clave *_dias debe ser un
// entero positivo; purga.plazo_dias además no puede superar los 15 días
// (regla de negocio explícita del prompt, no una convención genérica de
// nombre de columna).
function validarValorParametro(clave: string, valorNum: number): string | null {
  if (!Number.isFinite(valorNum)) return "El valor debe ser numérico.";
  if (valorNum < 0) return "El valor no puede ser negativo.";
  if (clave.endsWith("_dias") && (!Number.isInteger(valorNum) || valorNum <= 0)) {
    return "Debe ser un número entero positivo de días.";
  }
  if (clave === "purga.plazo_dias" && valorNum > 15) {
    return "El plazo de purga no puede superar los 15 días.";
  }
  return null;
}

platformParametrosRouter.get("/parametros", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT p.clave, p.valor, p.tipo, p.descripcion, p.actualizado_en, s.nombre AS actualizado_por_nombre
       FROM parametros_plataforma p
       LEFT JOIN staff_plataforma s ON s.id = p.actualizado_por
       ORDER BY p.clave`
    );
    res.json({
      parametros: result.rows.map((p) => ({
        clave: p.clave,
        valor: p.valor,
        tipo: p.tipo,
        descripcion: p.descripcion,
        actualizadoEn: p.actualizado_en,
        actualizadoPorNombre: p.actualizado_por_nombre,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/parametros", err);
    res.status(500).json({ error: "Error al listar los parámetros." });
  }
});

platformParametrosRouter.put("/parametros/:clave", async (req, res) => {
  const { clave } = req.params;
  const { valor } = req.body as { valor?: string | number };

  if (valor === undefined || valor === null || valor === "") {
    return res.status(400).json({ error: "Falta el valor." });
  }

  try {
    const existente = await req.db!.query(
      `SELECT tipo FROM parametros_plataforma WHERE clave = $1`,
      [clave]
    );
    if (existente.rows.length === 0) {
      return res.status(404).json({ error: "No existe ese parámetro." });
    }

    // Los 9 parámetros de esta fase son todos 'numero' — la validación de
    // rango solo aplica a ese tipo. 'texto'/'booleano'/'json' (previstos
    // por el CHECK de la tabla pero sin uso todavía) se guardan tal cual.
    if (existente.rows[0].tipo === "numero") {
      const valorNum = Number(valor);
      const error = validarValorParametro(clave, valorNum);
      if (error) return res.status(400).json({ error });
    }

    const result = await req.db!.query(
      `UPDATE parametros_plataforma
       SET valor = $1, actualizado_por = $2, actualizado_en = now()
       WHERE clave = $3
       RETURNING clave, valor, tipo, descripcion, actualizado_en`,
      [String(valor), req.auth!.userId, clave]
    );

    res.json({
      clave: result.rows[0].clave,
      valor: result.rows[0].valor,
      tipo: result.rows[0].tipo,
      descripcion: result.rows[0].descripcion,
      actualizadoEn: result.rows[0].actualizado_en,
    });
  } catch (err) {
    console.error("PUT /platform-admin/parametros/:clave", err);
    res.status(500).json({ error: "Error al actualizar el parámetro." });
  }
});

// GET /parametros/consumo-pruebas — consumo agregado del mes calendario
// en curso de TODAS las cuentas en prueba, contra trial.tope_global_mensual_usd.
// Es un tope global de la red completa, no por tenant — no está atado al
// periodo_inicio de cada prueba individual.
platformParametrosRouter.get("/parametros/consumo-pruebas", async (req, res) => {
  try {
    const topeResult = await req.db!.query(
      `SELECT valor FROM parametros_plataforma WHERE clave = 'trial.tope_global_mensual_usd'`
    );
    const topeUsd = Number(topeResult.rows[0]?.valor ?? 0);

    const consumoResult = await req.db!.query(
      `SELECT COALESCE(SUM(u.costo_usd_calculado), 0) AS consumo
       FROM uso_api u
       JOIN suscripciones s ON s.tenant_id = u.tenant_id
       WHERE s.estado = 'prueba' AND u."timestamp" >= date_trunc('month', now())`
    );
    const consumoUsd = Number(consumoResult.rows[0].consumo);

    res.json({ consumoUsd, topeUsd });
  } catch (err) {
    console.error("GET /platform-admin/parametros/consumo-pruebas", err);
    res.status(500).json({ error: "Error al calcular el consumo de pruebas del mes." });
  }
});
