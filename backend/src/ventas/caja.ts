import { PoolClient } from "pg";
import { LineaLoteDatafono, registrarLoteDatafono } from "./comisionesTarjeta";
import { politicaNumero } from "../clinica/politicas";

// ---------------------------------------------------------------------
// CAJAS Y SESIONES: apertura, arqueo y cierre.
//
// EL ARQUEO es el corazón de este módulo, y lo que lo hace servir es
// que **el esperado lo calcula el sistema y el declarado lo escribe la
// persona**, por separado. Si la pantalla mostrara el esperado en el
// campo del declarado, el cajero confirmaría el número del sistema sin
// contar, y el arqueo dejaría de detectar nada.
//
// Los cinco medios del cuadro del cliente se calculan así:
//
//   efectivo CRC = fondo + cobros en efectivo CRC + anticipos y abonos
//                  en efectivo CRC − vueltos
//                  + ingresos de cambio − retiros − gastos de caja chica
//   efectivo USD = fondo + cobros en efectivo USD ± movimientos en USD
//   tarjeta      = suma de los cobros con tarjeta
//   SINPE        = suma de los cobros por SINPE
//   otros        = transferencia y cualquier otro medio fiscal
//
// El vuelto se resta SOLO del efectivo en colones porque así cobra
// Medicavet: el vuelto se da en colones aunque el cliente haya pagado
// en dólares.
// ---------------------------------------------------------------------

/** Los medios que el arqueo agrupa. No son los códigos de Hacienda. */
export type MedioArqueo = "efectivo" | "tarjeta" | "sinpe" | "otros";

/** De código de Hacienda (Nota 6) al grupo del arqueo. */
export function grupoDeArqueo(medioHacienda: string): MedioArqueo {
  switch (medioHacienda) {
    case "01":
      return "efectivo";
    case "02":
      return "tarjeta";
    case "06":
      return "sinpe";
    default:
      // Cheque, transferencia, recaudado por terceros, plataforma
      // digital y "otros" van juntos: para el arqueo son todos
      // "confirmá el total contra tu estado de cuenta".
      return "otros";
  }
}

export interface LineaEsperada {
  medio: MedioArqueo;
  moneda: string;
  esperado: number;
}

/**
 * Lo que el sistema dice que tiene que haber, por medio y moneda.
 *
 * Devuelve SIEMPRE las cinco filas del cuadro —aunque den cero— porque
 * un medio que desaparece de la lista cuando no hubo cobros obliga a
 * recordar cuántos había para notar que falta uno.
 */
export async function esperadoDeSesion(
  db: PoolClient,
  sesionId: string
): Promise<LineaEsperada[]> {
  const s = await db.query<{ fondo_crc: string; fondo_usd: string }>(
    `SELECT fondo_crc, fondo_usd FROM vta_sesiones_caja WHERE id = $1`,
    [sesionId]
  );
  if (s.rows.length === 0) throw new Error(`No existe la sesión ${sesionId}.`);

  const medios = await db.query<{ medio: string; moneda: string; total: string }>(
    `SELECT cm.medio, cm.moneda, sum(cm.monto)::text AS total
       FROM vta_cobro_medios cm
       JOIN vta_cobros c ON c.id = cm.cobro_id
      WHERE c.sesion_id = $1 AND c.estado = 'aplicado' AND cm.es_fiscal
      GROUP BY cm.medio, cm.moneda`,
    [sesionId]
  );

  const vueltos = await db.query<{ total: string }>(
    `SELECT COALESCE(sum(vuelto_crc), 0)::text AS total FROM vta_cobros
      WHERE sesion_id = $1 AND estado = 'aplicado'`,
    [sesionId]
  );

  // LOS ANTICIPOS Y LOS ABONOS TAMBIÉN SON PLATA QUE ENTRÓ A ESTA CAJA.
  //
  // Faltaban, y el efecto era que un anticipo de ₡6 000 en billetes
  // aparecía como un sobrante que el cajero tenía que justificar. Las
  // dos tablas ya guardaban `sesion_id`; lo que no se guardaba era el
  // medio, y por eso hizo falta la migración 098.
  const anticipos = await db.query<{ medio: string; moneda: string; total: string }>(
    `SELECT medio, moneda, sum(monto)::text AS total
       FROM vta_anticipos WHERE sesion_id = $1
      GROUP BY medio, moneda`,
    [sesionId]
  );

  const abonos = await db.query<{ medio: string; moneda: string; total: string }>(
    `SELECT am.medio, am.moneda, sum(am.monto)::text AS total
       FROM vta_abono_medios am
       JOIN vta_abonos a ON a.id = am.abono_id
      WHERE a.sesion_id = $1
      GROUP BY am.medio, am.moneda`,
    [sesionId]
  );

  const efectivoExtra = await db.query<{ moneda: string; tipo: string; total: string }>(
    `SELECT moneda, tipo, sum(monto)::text AS total
       FROM vta_movimientos_efectivo WHERE sesion_id = $1
      GROUP BY moneda, tipo`,
    [sesionId]
  );

  const acumular = new Map<string, number>();
  const sumar = (medio: MedioArqueo, moneda: string, monto: number) => {
    const k = `${medio}|${moneda}`;
    acumular.set(k, (acumular.get(k) ?? 0) + monto);
  };

  sumar("efectivo", "CRC", Number(s.rows[0].fondo_crc));
  sumar("efectivo", "USD", Number(s.rows[0].fondo_usd));

  for (const m of medios.rows) {
    sumar(grupoDeArqueo(m.medio), m.moneda, Number(m.total));
  }

  for (const a of [...anticipos.rows, ...abonos.rows]) {
    sumar(grupoDeArqueo(a.medio), a.moneda, Number(a.total));
  }

  // El vuelto sale del efectivo en colones.
  sumar("efectivo", "CRC", -Number(vueltos.rows[0].total));

  for (const e of efectivoExtra.rows) {
    const signo = e.tipo === "ingreso_cambio" ? 1 : -1;
    sumar("efectivo", e.moneda, signo * Number(e.total));
  }

  // Las filas fijas del cuadro, más cualquier combinación que haya
  // aparecido y no esté entre ellas.
  const fijas: Array<[MedioArqueo, string]> = [
    ["efectivo", "CRC"],
    ["efectivo", "USD"],
    ["tarjeta", "CRC"],
    ["sinpe", "CRC"],
    ["otros", "CRC"],
  ];
  for (const [medio, moneda] of fijas) {
    const k = `${medio}|${moneda}`;
    if (!acumular.has(k)) acumular.set(k, 0);
  }

  return Array.from(acumular.entries())
    .map(([k, esperado]) => {
      const [medio, moneda] = k.split("|");
      return { medio: medio as MedioArqueo, moneda, esperado: Math.round(esperado * 100) / 100 };
    })
    .sort((a, b) => `${a.medio}${a.moneda}`.localeCompare(`${b.medio}${b.moneda}`));
}

export async function abrirSesion(
  db: PoolClient,
  tenantId: string,
  datos: { cajaId: string; fondoCrc?: number; fondoUsd?: number; personaId?: string }
): Promise<{ id: string }> {
  const abierta = await db.query<{ id: string }>(
    `SELECT id FROM vta_sesiones_caja WHERE caja_id = $1 AND estado = 'abierta'`,
    [datos.cajaId]
  );
  if (abierta.rows.length > 0) {
    throw new Error(
      `Esa caja ya tiene una sesión abierta (${abierta.rows[0].id}). Hay que cerrarla antes de abrir otra.`
    );
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO vta_sesiones_caja (tenant_id, caja_id, abierta_por, fondo_crc, fondo_usd)
     VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,0)) RETURNING id`,
    [tenantId, datos.cajaId, datos.personaId ?? null, datos.fondoCrc, datos.fondoUsd]
  );
  return { id: r.rows[0].id };
}

export interface LineaDeclarada {
  medio: MedioArqueo;
  moneda: string;
  declarado: number;
  justificacion?: string;
}

export interface ResultadoCierre {
  cerrada: boolean;
  /** Las líneas con su diferencia, para mostrar. */
  lineas: Array<
    LineaEsperada & {
      declarado: number;
      diferencia: number;
      /** true si el declarado salió del conteo por denominación. */
      contadoPorDenominacion?: boolean;
    }
  >;
  diferenciaTotalCrc: number;
  umbral: number;
  /** Cuando la diferencia supera el umbral y nadie la aprobó. */
  aprobacionId?: string;
}

const UMBRAL_POR_DEFECTO = 2000;

/**
 * Cierra la sesión con su arqueo.
 *
 * Si la diferencia total en colones supera el umbral y no viene una
 * aprobación, **la caja NO se cierra**: se crea una solicitud de
 * aprobación y se devuelve su id. Cerrarla igual y avisar después
 * dejaría el arqueo firmado antes de que nadie lo mire, que es
 * exactamente lo contrario de un control.
 */
export async function cerrarSesion(
  db: PoolClient,
  tenantId: string,
  sesionId: string,
  datos: {
    lineas: LineaDeclarada[];
    denominaciones?: Array<{ moneda: string; valor: number; cantidad: number }>;
    /**
     * EL LOTE QUE IMPRIME EL DATÁFONO (prompt 08b, A4).
     *
     * Mismo criterio que las denominaciones: si vino el lote, el
     * declarado de tarjeta SALE de su suma y el campo queda de solo
     * lectura. Dos fuentes del mismo número terminan con el menos
     * confiable ganando.
     */
    loteDatafono?: LineaLoteDatafono[];
    personaId?: string;
    aprobadoPor?: string;
  }
): Promise<ResultadoCierre> {
  const s = await db.query<{ estado: string }>(
    `SELECT estado FROM vta_sesiones_caja WHERE id = $1`,
    [sesionId]
  );
  if (s.rows.length === 0) throw new Error(`No existe la sesión ${sesionId}.`);
  if (s.rows[0].estado !== "abierta") throw new Error("Esa sesión ya está cerrada.");

  const esperadas = await esperadoDeSesion(db, sesionId);

  // EL CONTEO POR DENOMINACIÓN, CUANDO LO HAY, ES EL DECLARADO.
  //
  // Contar los billetes y además escribir el total a mano serían dos
  // fuentes del mismo número, y el día que no coincidan gana el que
  // escribió el campo —es decir, el menos confiable—. Así que si para
  // una moneda vinieron denominaciones, el efectivo declarado de esa
  // moneda SALE de la suma, y el campo de la pantalla queda de solo
  // lectura mostrándola.
  const contado = new Map<string, number>();
  for (const d of datos.denominaciones ?? []) {
    const valor = Number(d.valor);
    const cantidad = Number(d.cantidad);
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new Error(`Una denominación de ${d.valor} no es un valor de billete o moneda.`);
    }
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      throw new Error(`La cantidad de la denominación ${valor} tiene que ser un entero ≥ 0.`);
    }
    contado.set(d.moneda, (contado.get(d.moneda) ?? 0) + valor * cantidad);
  }

  // EL LOTE DEL DATÁFONO, igual que las denominaciones: si vino, es la
  // fuente del declarado de tarjeta.
  const porLote = new Map<string, number>();
  if (datos.loteDatafono && datos.loteDatafono.length > 0) {
    await registrarLoteDatafono(db, tenantId, sesionId, datos.loteDatafono);
    for (const l of datos.loteDatafono) {
      const moneda = (l.moneda ?? "CRC").toUpperCase();
      porLote.set(moneda, (porLote.get(moneda) ?? 0) + Number(l.monto));
    }
  }

  const lineas = esperadas.map((e) => {
    const d = datos.lineas.find((x) => x.medio === e.medio && x.moneda === e.moneda);
    const porDenominacion = e.medio === "efectivo" ? contado.get(e.moneda) : undefined;
    const delLote = e.medio === "tarjeta" ? porLote.get(e.moneda) : undefined;
    const contadoAparte = porDenominacion ?? delLote;
    const declarado =
      contadoAparte !== undefined
        ? Math.round(contadoAparte * 100) / 100
        : d
          ? Number(d.declarado)
          : 0;
    return {
      ...e,
      declarado,
      contadoPorDenominacion: porDenominacion !== undefined,
      /** El declarado de tarjeta salió del lote del datáfono. */
      contadoPorLote: delLote !== undefined,
      diferencia: Math.round((declarado - e.esperado) * 100) / 100,
      justificacion: d?.justificacion,
    };
  });

  const faltaJustificar = lineas.filter((l) => l.diferencia !== 0 && !l.justificacion?.trim());
  if (faltaJustificar.length > 0) {
    throw new Error(
      `Hay ${faltaJustificar.length} diferencia(s) sin justificar: ${faltaJustificar
        .map((l) => `${l.medio} ${l.moneda} (${l.diferencia})`)
        .join(", ")}. Cada diferencia lleva su motivo.`
    );
  }

  // El umbral sale de la política (prompt 04, §4), con respaldo en
  // `vta_parametros.umbral_diferencia_arqueo`.
  const umbral = await politicaNumero(db, tenantId, "arqueo.umbral_diferencia").catch(
    () => UMBRAL_POR_DEFECTO
  );

  // Las diferencias en dólares se convierten para compararlas con un
  // umbral que está en colones. Sin eso, una diferencia de 50 USD
  // parecería menor que una de 1 000 CRC.
  const tc = await tipoDeCambioDelDia(db, tenantId, "USD").catch(() => 1);
  const diferenciaTotalCrc =
    Math.round(
      lineas.reduce((a, l) => a + Math.abs(l.diferencia) * (l.moneda === "USD" ? tc : 1), 0) * 100
    ) / 100;

  if (diferenciaTotalCrc > umbral && !datos.aprobadoPor) {
    const ap = await db.query<{ id: string }>(
      `INSERT INTO vta_aprobaciones (tenant_id, tipo, referencia_id, monto, motivo, solicitada_por)
       VALUES ($1,'diferencia_arqueo',$2,$3,$4,$5) RETURNING id`,
      [
        tenantId,
        sesionId,
        diferenciaTotalCrc,
        `Cierre con una diferencia de ${diferenciaTotalCrc} sobre un umbral de ${umbral}. ` +
          lineas
            .filter((l) => l.diferencia !== 0)
            .map((l) => `${l.medio} ${l.moneda}: ${l.diferencia} (${l.justificacion})`)
            .join(" · "),
        datos.personaId ?? null,
      ]
    );
    return { cerrada: false, lineas, diferenciaTotalCrc, umbral, aprobacionId: ap.rows[0].id };
  }

  for (const l of lineas) {
    await db.query(
      `INSERT INTO vta_arqueo_lineas (tenant_id, sesion_id, medio, moneda, esperado, declarado,
                                      justificacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (sesion_id, medio, moneda) DO UPDATE SET
         esperado = EXCLUDED.esperado, declarado = EXCLUDED.declarado,
         justificacion = EXCLUDED.justificacion`,
      [tenantId, sesionId, l.medio, l.moneda, l.esperado, l.declarado, l.justificacion ?? null]
    );
  }

  for (const d of datos.denominaciones ?? []) {
    await db.query(
      `INSERT INTO vta_arqueo_denominaciones (tenant_id, sesion_id, moneda, valor, cantidad)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (sesion_id, moneda, valor) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
      [tenantId, sesionId, d.moneda, d.valor, d.cantidad]
    );
  }

  // El UPDATE va al final: el trigger de inmutabilidad bloquea
  // cualquier escritura en cuanto el estado pase a 'cerrada'.
  await db.query(
    `UPDATE vta_sesiones_caja
        SET estado = 'cerrada', cerrada_por = $2, cerrada_en = now(),
            diferencia_aprobada_por = $3
      WHERE id = $1`,
    [sesionId, datos.personaId ?? null, datos.aprobadoPor ?? null]
  );

  return { cerrada: true, lineas, diferenciaTotalCrc, umbral };
}

/**
 * El tipo de cambio vigente de una moneda.
 *
 * Toma el del día y, si no hay, el último registrado antes de hoy.
 * NO inventa 1: un cobro en dólares convertido a 1 sería un error de
 * 500 veces, así que si no hay ninguno se lanza.
 */
export async function tipoDeCambioDelDia(
  db: PoolClient,
  tenantId: string,
  moneda = "USD"
): Promise<number> {
  const r = await db.query<{ valor: string; fecha: string }>(
    `SELECT valor::text, fecha::text FROM vta_tipos_cambio
      WHERE tenant_id = $1 AND moneda = $2 AND fecha <= CURRENT_DATE
      ORDER BY fecha DESC LIMIT 1`,
    [tenantId, moneda]
  );
  if (r.rows.length === 0) {
    throw new Error(
      `No hay tipo de cambio registrado para ${moneda}. Un administrador tiene que cargarlo antes de poder cobrar en esa moneda.`
    );
  }
  return Number(r.rows[0].valor);
}

export async function registrarTipoCambio(
  db: PoolClient,
  tenantId: string,
  datos: { fecha?: string; moneda?: string; valor: number; fuente?: string; personaId?: string }
): Promise<void> {
  if (!(datos.valor > 0)) throw new Error("El tipo de cambio tiene que ser mayor que cero.");
  await db.query(
    `INSERT INTO vta_tipos_cambio (tenant_id, fecha, moneda, valor, fuente, registrado_por)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), COALESCE($3,'USD'), $4,
             COALESCE($5,'manual'), $6)
     ON CONFLICT (tenant_id, fecha, moneda) DO UPDATE SET
       valor = EXCLUDED.valor, fuente = EXCLUDED.fuente,
       registrado_por = EXCLUDED.registrado_por, registrado_en = now()`,
    [
      tenantId,
      datos.fecha ?? null,
      datos.moneda ?? null,
      datos.valor,
      datos.fuente ?? null,
      datos.personaId ?? null,
    ]
  );
}

export async function registrarMovimientoEfectivo(
  db: PoolClient,
  tenantId: string,
  datos: {
    sesionId: string;
    tipo: "retiro_caja_fuerte" | "ingreso_cambio" | "gasto_caja_chica";
    moneda?: string;
    monto: number;
    categoriaGasto?: string;
    motivo: string;
    respaldoUrl?: string;
    personaId?: string;
  }
): Promise<{ id: string }> {
  if (!datos.motivo?.trim()) {
    throw new Error("Un movimiento de efectivo lleva motivo: sin eso el arqueo no se puede leer.");
  }
  if (datos.tipo === "gasto_caja_chica" && !datos.categoriaGasto?.trim()) {
    throw new Error(
      "Un gasto de caja chica lleva categoría: es lo que finanzas va a usar después para clasificarlo."
    );
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO vta_movimientos_efectivo (tenant_id, sesion_id, tipo, moneda, monto,
                                           categoria_gasto, motivo, respaldo_url, persona_id)
     VALUES ($1,$2,$3,COALESCE($4,'CRC'),$5,$6,$7,$8,$9) RETURNING id`,
    [
      tenantId, datos.sesionId, datos.tipo, datos.moneda ?? null, datos.monto,
      datos.categoriaGasto ?? null, datos.motivo.trim(), datos.respaldoUrl ?? null,
      datos.personaId ?? null,
    ]
  );
  return { id: r.rows[0].id };
}
