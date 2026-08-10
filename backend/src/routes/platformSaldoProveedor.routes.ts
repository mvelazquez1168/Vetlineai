import { Router } from "express";
import { PoolClient } from "pg";
import { authenticate, withTenantClient } from "../middleware/auth";
import {
  calcularDiasProyeccion,
  calcularRitmoDiarioUsd,
  calcularSaldoDerivado,
  obtenerConsumoDiario,
  obtenerDesgloseBolsas,
  obtenerUltimaRecarga,
  obtenerUltimoControl,
} from "../saldoProveedorIa";

// ---------------------------------------------------------------------
// prompt_code_panel_consumo_sin_api — panel de consumo del proveedor de
// IA sin API de administración (cuenta individual). Todo lo que este
// router expone es una ESTIMACIÓN derivada de datos propios, nunca el
// número real del proveedor — ver saldoProveedorIa.ts.
// ---------------------------------------------------------------------

export const platformSaldoProveedorRouter = Router();

platformSaldoProveedorRouter.use(authenticate, withTenantClient);

platformSaldoProveedorRouter.use((req, res, next) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "El saldo del proveedor de IA es solo para super_admin." });
  }
  next();
});

// GET /saldo-proveedor-ia — Bloques 1 y 2 del panel.
platformSaldoProveedorRouter.get("/saldo-proveedor-ia", async (req, res) => {
  try {
    const [derivado, ritmoDiarioUsd, consumoDiario, desgloseBolsas, ultimaRecarga, ultimoControl] =
      await Promise.all([
        calcularSaldoDerivado(req.db!),
        calcularRitmoDiarioUsd(req.db!),
        obtenerConsumoDiario(req.db!),
        obtenerDesgloseBolsas(req.db!),
        obtenerUltimaRecarga(req.db!),
        obtenerUltimoControl(req.db!),
      ]);

    const diasProyeccion = calcularDiasProyeccion(derivado.saldoUsd, ritmoDiarioUsd);

    res.json({
      saldoDerivadoUsd: derivado.saldoUsd,
      origenDerivacion: derivado.origen,
      desdeFecha: derivado.desdeFecha,
      ritmoDiarioUsd,
      diasProyeccion,
      consumoDiario,
      desgloseBolsas,
      ultimaRecarga,
      ultimoControl,
    });
  } catch (err) {
    console.error("GET /platform-admin/saldo-proveedor-ia", err);
    res.status(500).json({ error: "Error al calcular el saldo del proveedor de IA." });
  }
});

// GET /saldo-proveedor-ia/controles — historial de controles manuales.
platformSaldoProveedorRouter.get("/saldo-proveedor-ia/controles", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT c.id, c.fecha, c.saldo_observado_usd, c.diferencia_usd, c.nota, c.creado_en,
              sp.nombre AS registrado_por_nombre
       FROM controles_saldo_proveedor_ia c
       LEFT JOIN staff_plataforma sp ON sp.id = c.registrado_por
       ORDER BY c.fecha DESC, c.creado_en DESC
       LIMIT 50`
    );
    res.json({
      controles: result.rows.map((r) => ({
        id: r.id,
        fecha: r.fecha,
        saldoObservadoUsd: Number(r.saldo_observado_usd),
        diferenciaUsd: Number(r.diferencia_usd),
        nota: r.nota,
        registradoPorNombre: r.registrado_por_nombre,
        creadoEn: r.creado_en,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/saldo-proveedor-ia/controles", err);
    res.status(500).json({ error: "Error al listar los controles de saldo." });
  }
});

// POST /saldo-proveedor-ia/controles — registrar lo que se ve en la
// consola del proveedor. La diferencia contra el derivado A ESA FECHA
// (no contra el derivado actual, que ya pudo moverse) es lo más valioso
// del panel: si no coinciden, hay una tarifa mal cargada o consumo sin
// registrar.
platformSaldoProveedorRouter.post("/saldo-proveedor-ia/controles", async (req, res) => {
  const { fecha, saldoObservadoUsd, nota } = req.body as {
    fecha?: string;
    saldoObservadoUsd?: number;
    nota?: string;
  };

  if (!fecha) {
    return res.status(400).json({ error: "Falta la fecha del control." });
  }
  if (typeof saldoObservadoUsd !== "number" || !Number.isFinite(saldoObservadoUsd) || saldoObservadoUsd < 0) {
    return res.status(400).json({ error: "El saldo observado debe ser un número mayor o igual a cero." });
  }

  try {
    // Diferencia contra lo que el sistema habría derivado A LA FECHA del
    // control (con el punto de partida vigente ANTES de este control,
    // para no comparar contra sí mismo).
    const derivadoAlMomento = await calcularSaldoDerivadoHastaFecha(req.db!, fecha);
    const diferenciaUsd = saldoObservadoUsd - derivadoAlMomento;

    const result = await req.db!.query(
      `INSERT INTO controles_saldo_proveedor_ia (fecha, saldo_observado_usd, diferencia_usd, registrado_por, nota)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, fecha, saldo_observado_usd, diferencia_usd, nota, creado_en`,
      [fecha, saldoObservadoUsd, diferenciaUsd, req.auth!.userId, nota?.trim() || null]
    );
    const fila = result.rows[0];

    res.status(201).json({
      id: fila.id,
      fecha: fila.fecha,
      saldoObservadoUsd: Number(fila.saldo_observado_usd),
      diferenciaUsd: Number(fila.diferencia_usd),
      nota: fila.nota,
      creadoEn: fila.creado_en,
    });
  } catch (err) {
    console.error("POST /platform-admin/saldo-proveedor-ia/controles", err);
    res.status(500).json({ error: "Error al registrar el control de saldo." });
  }
});

// Igual que calcularSaldoDerivado, pero usando el control ANTERIOR a
// `hastaFecha` como punto de partida (si existe) — es la derivación tal
// como estaba justo antes de insertar el nuevo control, para poder
// calcular la diferencia real que el nuevo control revela.
async function calcularSaldoDerivadoHastaFecha(db: PoolClient, hastaFecha: string): Promise<number> {
  // Esta función corre ANTES de insertar el nuevo control, así que
  // cualquier control ya existente con fecha <= hastaFecha es, por
  // definición, anterior a este — filtrar con "<" (estricto) excluía
  // el caso más común: registrar un control hoy cuando ya hay otro de hoy.
  const controlAnterior = await db.query(
    `SELECT fecha, creado_en, saldo_observado_usd FROM controles_saldo_proveedor_ia
     WHERE fecha <= $1 ORDER BY fecha DESC, creado_en DESC LIMIT 1`,
    [hastaFecha]
  );
  const anterior = controlAnterior.rows[0];

  if (anterior) {
    // Mismo desempate por creado_en que calcularSaldoDerivado: fecha por sí
    // sola no puede ordenar dos eventos del mismo día calendario.
    const recargas = await db.query(
      `SELECT COALESCE(SUM(monto_usd), 0) AS total FROM recargas_proveedor_ia
       WHERE fecha <= $3 AND (fecha > $1 OR (fecha = $1 AND creado_en > $2))`,
      [anterior.fecha, anterior.creado_en, hastaFecha]
    );
    const costo = await db.query(
      `SELECT COALESCE(SUM(costo_usd_calculado), 0) AS total FROM uso_api
       WHERE "timestamp"::date <= $3 AND ("timestamp"::date > $1 OR ("timestamp"::date = $1 AND "timestamp" > $2))`,
      [anterior.fecha, anterior.creado_en, hastaFecha]
    );
    return Number(anterior.saldo_observado_usd) + Number(recargas.rows[0].total) - Number(costo.rows[0].total);
  }

  const primera = await db.query(
    `SELECT MIN(fecha) AS fecha FROM recargas_proveedor_ia WHERE fecha <= $1`,
    [hastaFecha]
  );
  const primeraFecha = primera.rows[0]?.fecha;
  if (!primeraFecha) return 0;

  const recargas = await db.query(
    `SELECT COALESCE(SUM(monto_usd), 0) AS total FROM recargas_proveedor_ia WHERE fecha <= $1`,
    [hastaFecha]
  );
  const costo = await db.query(
    `SELECT COALESCE(SUM(costo_usd_calculado), 0) AS total FROM uso_api WHERE "timestamp"::date >= $1 AND "timestamp"::date <= $2`,
    [primeraFecha, hastaFecha]
  );
  return Number(recargas.rows[0].total) - Number(costo.rows[0].total);
}
