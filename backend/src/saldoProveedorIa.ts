import { Pool, PoolClient } from "pg";
import { enviarCorreoTransaccional } from "./correos";

// ---------------------------------------------------------------------
// prompt_code_panel_consumo_sin_api — la cuenta de Anthropic es
// individual, sin acceso a la API de administración (uso/costo
// autoritativo del proveedor). El saldo se DERIVA de datos propios:
// recargas_proveedor_ia (lo que registramos que pagamos) menos
// uso_api.costo_usd_calculado (lo que la plataforma ya calculó que
// gastamos, con las tarifas reales). Es una estimación, nunca el número
// del proveedor — todo consumidor de este módulo debe presentarlo así.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export interface UltimoControl {
  id: string;
  fecha: string;
  saldoObservadoUsd: number;
  diferenciaUsd: number;
  nota: string | null;
  registradoPorNombre: string | null;
  creadoEn: string;
}

export async function obtenerUltimoControl(db: EjecutorSql): Promise<UltimoControl | null> {
  const r = await db.query(
    `SELECT c.id, c.fecha, c.saldo_observado_usd, c.diferencia_usd, c.nota, c.creado_en,
            sp.nombre AS registrado_por_nombre
     FROM controles_saldo_proveedor_ia c
     LEFT JOIN staff_plataforma sp ON sp.id = c.registrado_por
     ORDER BY c.fecha DESC, c.creado_en DESC
     LIMIT 1`
  );
  const fila = r.rows[0];
  if (!fila) return null;
  return {
    id: fila.id,
    fecha: fila.fecha,
    saldoObservadoUsd: Number(fila.saldo_observado_usd),
    diferenciaUsd: Number(fila.diferencia_usd),
    nota: fila.nota,
    registradoPorNombre: fila.registrado_por_nombre,
    creadoEn: fila.creado_en,
  };
}

export interface SaldoDerivado {
  saldoUsd: number;
  origen: "control" | "primera_recarga" | "sin_datos";
  desdeFecha: string | null;
}

// El control manual más reciente, si existe, es el punto de partida —
// no la primera recarga histórica. Motivo: el control es la única forma
// de detectar que la derivación se desvió del número real; si al
// detectarlo seguimos acumulando desde el origen de siempre, ese mismo
// error queda arrastrado para siempre. Usar el último control como
// nuevo cero hace que cada control "cierre" el drift detectado hasta
// ese momento — el margen de error del derivado nunca es mayor que lo
// que pasó desde el último chequeo real.
export async function calcularSaldoDerivado(db: EjecutorSql): Promise<SaldoDerivado> {
  const ultimoControl = await obtenerUltimoControl(db);

  if (ultimoControl) {
    // fecha es una DATE (día calendario) — comparar solo por fecha excluye
    // cualquier recarga o consumo registrado el MISMO día que el control
    // pero DESPUÉS de guardarlo (fecha igual, no "mayor"), dejando el saldo
    // derivado congelado hasta el día siguiente. creado_en desempata dentro
    // del mismo día: solo lo posterior al momento exacto del control cuenta.
    const recargas = await db.query(
      `SELECT COALESCE(SUM(monto_usd), 0) AS total FROM recargas_proveedor_ia
       WHERE fecha > $1 OR (fecha = $1 AND creado_en > $2)`,
      [ultimoControl.fecha, ultimoControl.creadoEn]
    );
    const costo = await db.query(
      `SELECT COALESCE(SUM(costo_usd_calculado), 0) AS total FROM uso_api
       WHERE "timestamp"::date > $1 OR ("timestamp"::date = $1 AND "timestamp" > $2)`,
      [ultimoControl.fecha, ultimoControl.creadoEn]
    );
    const saldoUsd =
      ultimoControl.saldoObservadoUsd + Number(recargas.rows[0].total) - Number(costo.rows[0].total);
    return { saldoUsd, origen: "control", desdeFecha: ultimoControl.fecha };
  }

  const primera = await db.query(`SELECT MIN(fecha) AS fecha FROM recargas_proveedor_ia`);
  const primeraFecha: string | null = primera.rows[0]?.fecha ?? null;
  if (!primeraFecha) {
    return { saldoUsd: 0, origen: "sin_datos", desdeFecha: null };
  }

  const recargas = await db.query(`SELECT COALESCE(SUM(monto_usd), 0) AS total FROM recargas_proveedor_ia`);
  const costo = await db.query(
    `SELECT COALESCE(SUM(costo_usd_calculado), 0) AS total FROM uso_api WHERE "timestamp"::date >= $1`,
    [primeraFecha]
  );
  const saldoUsd = Number(recargas.rows[0].total) - Number(costo.rows[0].total);
  return { saldoUsd, origen: "primera_recarga", desdeFecha: primeraFecha };
}

// Ritmo diario = consumo real de los últimos `dias` días calendario
// (incluyendo los días sin actividad, para no inflar el ritmo con una
// ventana artificialmente corta). Es lo que hace que "días de
// proyección" diga algo — el saldo absoluto solo no indica nada.
export async function calcularRitmoDiarioUsd(db: EjecutorSql, dias = 7): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(SUM(costo_usd_calculado), 0) AS total
     FROM uso_api WHERE "timestamp" >= now() - ($1 || ' days')::interval`,
    [dias]
  );
  return Number(r.rows[0].total) / dias;
}

// null = no se puede proyectar (sin consumo reciente, el ritmo es 0).
export function calcularDiasProyeccion(saldoUsd: number, ritmoDiarioUsd: number): number | null {
  if (ritmoDiarioUsd <= 0) return null;
  if (saldoUsd <= 0) return 0;
  return saldoUsd / ritmoDiarioUsd;
}

export interface ConsumoDiario {
  fecha: string;
  costoUsd: number;
}

// Devuelve exactamente `dias` puntos (uno por día calendario, incluidos
// los días sin consumo en 0) para que el gráfico de barras no tenga que
// rellenar huecos del lado del cliente.
export async function obtenerConsumoDiario(db: EjecutorSql, dias = 30): Promise<ConsumoDiario[]> {
  const r = await db.query(
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS fecha, COALESCE(SUM(u.costo_usd_calculado), 0) AS costo
     FROM generate_series(now()::date - ($1::int - 1), now()::date, interval '1 day') AS d
     LEFT JOIN uso_api u ON u."timestamp"::date = d::date
     GROUP BY d
     ORDER BY d`,
    [dias]
  );
  return r.rows.map((fila) => ({ fecha: fila.fecha, costoUsd: Number(fila.costo) }));
}

export interface DesgloseBolsas {
  plan: number;
  comprado: number;
  prueba: number;
  colchon: number;
  otro: number;
}

// Las 4 bolsas del prompt tienen economía distinta:
//  - 'comprado' y 'colchon' vienen directo de bolsa_afectada.
//  - "Crédito de plan" vs. "Pruebas gratuitas" NO son distinguibles por
//    bolsa_afectada solo (ambas usan 'plan') — se separan por el estado
//    de la suscripción del tenant en el momento de la consulta.
//  - 'otro' agrupa NULL (fila sin bolsa resuelta, ver tarifas.ts) y
//    'ninguna' (cortesía/no cobrable) — se muestra siempre, aunque sea
//    en cero, para que el desglose sume el total del período.
export async function obtenerDesgloseBolsas(db: EjecutorSql, dias = 30): Promise<DesgloseBolsas> {
  const r = await db.query(
    `SELECT
       CASE
         WHEN u.bolsa_afectada = 'comprado' THEN 'comprado'
         WHEN u.bolsa_afectada = 'colchon' THEN 'colchon'
         WHEN u.bolsa_afectada = 'plan' AND s.estado = 'prueba' THEN 'prueba'
         WHEN u.bolsa_afectada = 'plan' THEN 'plan'
         ELSE 'otro'
       END AS bucket,
       COALESCE(SUM(u.costo_usd_calculado), 0) AS costo
     FROM uso_api u
     JOIN tenants t ON t.id = u.tenant_id
     JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE u."timestamp" >= now() - ($1 || ' days')::interval
     GROUP BY bucket`,
    [dias]
  );
  const mapa: DesgloseBolsas = { plan: 0, comprado: 0, prueba: 0, colchon: 0, otro: 0 };
  for (const fila of r.rows) {
    const bucket = fila.bucket as keyof DesgloseBolsas;
    mapa[bucket] = Number(fila.costo);
  }
  return mapa;
}

export interface UltimaRecarga {
  fecha: string;
  montoUsd: number;
}

export async function obtenerUltimaRecarga(db: EjecutorSql): Promise<UltimaRecarga | null> {
  const r = await db.query(
    `SELECT fecha, monto_usd FROM recargas_proveedor_ia ORDER BY fecha DESC, creado_en DESC LIMIT 1`
  );
  const fila = r.rows[0];
  return fila ? { fecha: fila.fecha, montoUsd: Number(fila.monto_usd) } : null;
}

async function leerParametroTexto(db: EjecutorSql, clave: string): Promise<string | null> {
  const r = await db.query(`SELECT valor FROM parametros_plataforma WHERE clave = $1`, [clave]);
  return r.rows[0]?.valor ?? null;
}

async function leerParametroNumero(db: EjecutorSql, clave: string, porDefecto: number): Promise<number> {
  const r = await db.query(`SELECT valor FROM parametros_plataforma WHERE clave = $1`, [clave]);
  return r.rows[0]?.valor != null ? Number(r.rows[0].valor) : porDefecto;
}

// Job diario. Un solo aviso por cruce de umbral: si ya hay una alerta
// activa (resuelto_en IS NULL), no se manda otra — el saldo puede
// seguir bajo indefinidamente sin generar ruido nuevo. En cuanto el
// saldo vuelve a estar por encima del umbral, la alerta se cierra y
// deja el camino libre para el próximo cruce.
export async function verificarYNotificarSaldoBajo(db: EjecutorSql): Promise<void> {
  const umbralUsd = await leerParametroNumero(db, "saldo_proveedor.umbral_usd", 0);
  const { saldoUsd } = await calcularSaldoDerivado(db);

  const activaResult = await db.query(
    `SELECT id FROM alertas_saldo_proveedor_ia WHERE resuelto_en IS NULL LIMIT 1`
  );
  const alertaActivaId: string | undefined = activaResult.rows[0]?.id;

  if (saldoUsd < umbralUsd) {
    if (!alertaActivaId) {
      await db.query(
        `INSERT INTO alertas_saldo_proveedor_ia (saldo_derivado_usd) VALUES ($1)`,
        [saldoUsd]
      );
      const correoDestino = await leerParametroTexto(db, "saldo_proveedor.correo_destino");
      if (correoDestino) {
        await enviarCorreoTransaccional(db, null, correoDestino, "saldo_proveedor_bajo", {
          saldoUsd,
          umbralUsd,
        });
      } else {
        console.error(
          "[saldoProveedorIa] Saldo bajo el umbral pero no hay saldo_proveedor.correo_destino configurado — no se envió aviso."
        );
      }
    }
  } else if (alertaActivaId) {
    await db.query(
      `UPDATE alertas_saldo_proveedor_ia SET resuelto_en = now() WHERE id = $1`,
      [alertaActivaId]
    );
  }
}
