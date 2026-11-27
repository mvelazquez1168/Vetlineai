import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// LO QUE CUESTA COBRAR CON TARJETA — prompt 08b, A4.
//
// La clínica cobra ₡50 000 con tarjeta y el banco le deposita ₡48 500.
// Esos ₡1 500 son un costo real que hoy no se registraba en ninguna
// parte: aparecían como un faltante inexplicable cuando alguien
// comparaba el cierre de caja contra el estado de cuenta.
//
// POR QUÉ SE GUARDA CALCULADO EN CADA COBRO y no se calcula al leer:
// la comisión cambia cuando el banco renegocia el contrato. Un cobro de
// marzo tiene que seguir explicando su neto con la comisión de marzo, y
// recalcular con la vigente hoy le cambiaría el número a la historia.
//
// EL MEDIO «02» ES TARJETA en el catálogo de Hacienda, y es el único
// medio al que esto aplica: el efectivo no tiene comisión y el SINPE
// tampoco.
// ---------------------------------------------------------------------

/** El medio de pago «tarjeta» en el catálogo oficial de Hacienda. */
export const MEDIO_TARJETA = "02";

export interface ComisionVigente {
  id: string;
  comisionPct: number;
  comisionFija: number;
  banco: string;
  tipoTarjeta: string;
  marca: string | null;
}

/**
 * La comisión que aplica a un cobro, en la fecha en que se cobra.
 *
 * Busca de lo más específico a lo más general: la fila con la marca
 * exacta gana sobre la que no distingue marca, y entre dos vigencias se
 * queda la más reciente que ya empezó.
 *
 * Devuelve `null` cuando la clínica no configuró nada. **No se inventa
 * un porcentaje**: una comisión supuesta ensuciaría la rentabilidad con
 * un costo que nadie cobró, y es peor que no tener el dato.
 */
export async function comisionVigente(
  db: PoolClient,
  tenantId: string,
  datos: { banco?: string | null; tipoTarjeta?: string | null; marca?: string | null; fecha?: string }
): Promise<ComisionVigente | null> {
  if (!datos.banco || !datos.tipoTarjeta) return null;
  const r = await db.query<{
    id: string;
    comision_pct: string;
    comision_fija: string;
    banco: string;
    tipo_tarjeta: string;
    marca: string | null;
  }>(
    `SELECT id, comision_pct::text, comision_fija::text, banco, tipo_tarjeta, marca
       FROM vta_comisiones_tarjeta
      WHERE tenant_id = $1
        AND banco = $2
        AND tipo_tarjeta = $3
        AND (marca IS NULL OR marca = $4)
        AND vigente_desde <= COALESCE($5::date, CURRENT_DATE)
      -- La marca exacta primero; después, la vigencia más reciente.
      ORDER BY (marca IS NOT NULL) DESC, vigente_desde DESC
      LIMIT 1`,
    [tenantId, datos.banco, datos.tipoTarjeta, datos.marca ?? null, datos.fecha ?? null]
  );
  if (r.rows.length === 0) return null;
  const f = r.rows[0];
  return {
    id: f.id,
    comisionPct: Number(f.comision_pct),
    comisionFija: Number(f.comision_fija),
    banco: f.banco,
    tipoTarjeta: f.tipo_tarjeta,
    marca: f.marca,
  };
}

export interface CostoDelCobro {
  comisionEstimada: number | null;
  netoEsperado: number | null;
  comisionId: string | null;
}

/**
 * Lo que el banco se queda de un cobro y lo que la clínica va a recibir.
 *
 * Redondea a dos decimales porque es plata, y porque el neto se va a
 * comparar contra un depósito bancario que viene con dos decimales.
 */
export function costoDelCobro(montoCrc: number, comision: ComisionVigente | null): CostoDelCobro {
  if (!comision) return { comisionEstimada: null, netoEsperado: null, comisionId: null };
  const bruto = (montoCrc * comision.comisionPct) / 100 + comision.comisionFija;
  const estimada = Math.round(bruto * 100) / 100;
  return {
    comisionEstimada: estimada,
    netoEsperado: Math.round((montoCrc - estimada) * 100) / 100,
    comisionId: comision.id,
  };
}

export interface LineaLoteDatafono {
  banco: string;
  tipoTarjeta: string;
  marca?: string | null;
  cantidad: number;
  monto: number;
  moneda?: string;
  numeroLote?: string | null;
}

/**
 * Los totales que imprime el datáfono al cerrar el lote.
 *
 * Se guardan tal como los dice el papel, sin conciliarlos todavía: la
 * comparación es la función de abajo, y separar las dos cosas permite
 * cargar el lote aunque la diferencia haya que investigarla mañana.
 */
export async function registrarLoteDatafono(
  db: PoolClient,
  tenantId: string,
  sesionId: string,
  lineas: LineaLoteDatafono[]
): Promise<{ guardadas: number }> {
  // SE REEMPLAZA EL LOTE ENTERO, no se acumula: quien lo carga dos veces
  // está corrigiendo lo que escribió mal, no sumando un segundo lote.
  await db.query(`DELETE FROM vta_lote_datafono WHERE sesion_id = $1`, [sesionId]);
  for (const l of lineas) {
    if (!l.banco?.trim() || !l.tipoTarjeta?.trim()) {
      throw new Error("Cada línea del lote lleva el banco y el tipo de tarjeta.");
    }
    await db.query(
      `INSERT INTO vta_lote_datafono
         (tenant_id, sesion_id, banco, tipo_tarjeta, marca, cantidad, monto, moneda, numero_lote)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenantId,
        sesionId,
        l.banco.trim(),
        l.tipoTarjeta.trim(),
        l.marca?.trim() || null,
        l.cantidad,
        l.monto,
        (l.moneda ?? "CRC").toUpperCase(),
        l.numeroLote?.trim() || null,
      ]
    );
  }
  return { guardadas: lineas.length };
}

export interface ConciliacionTarjetas {
  /** Una fila por banco y tipo, con los dos lados y la diferencia. */
  filas: Array<{
    banco: string | null;
    tipoTarjeta: string | null;
    marca: string | null;
    sistemaCantidad: number;
    sistemaMonto: number;
    loteCantidad: number | null;
    loteMonto: number | null;
    diferencia: number | null;
  }>;
  /** Los cobros con tarjeta de la sesión, para buscar la diferencia. */
  cobros: Array<{
    cobroId: string;
    medioId: string;
    banco: string | null;
    tipoTarjeta: string | null;
    marca: string | null;
    monto: number;
    referencia: string | null;
    comisionEstimada: number | null;
    netoEsperado: number | null;
    cobradoEn: string;
  }>;
  /**
   * EL TOTAL, ADEMÁS DEL DETALLE.
   *
   * Hace falta porque el detalle no siempre calza: un cobro hecho antes
   * de que existiera esta función no tiene banco cargado, así que queda
   * en su propia fila y el lote en otra, y las dos aparecen con la
   * diferencia entera. El cajero igual necesita saber si el total de
   * tarjetas del día cuadra, y ese número sí es comparable siempre.
   */
  totalSistema: number;
  totalLote: number | null;
  diferenciaDelTotal: number | null;
  /** Cuántos cobros con tarjeta no tienen banco cargado. */
  cobrosSinBanco: number;
  /** La suma de las diferencias por fila, para el detalle. */
  diferenciaTotal: number;
  /** Lo que el banco se va a quedar de todo el lote. */
  comisionTotal: number;
}

/**
 * La conciliación del cierre: lo que el sistema cobró contra lo que el
 * datáfono imprimió, y los cobros uno por uno para encontrar dónde está
 * la diferencia.
 *
 * LAS FILAS SIN LOTE CARGADO SE DEVUELVEN IGUAL, con el lote en `null`:
 * «todavía no cargaron el papel» es un estado distinto de «el papel dice
 * cero», y mostrar un cero sería decir que el datáfono no cobró nada.
 */
export async function conciliarTarjetas(
  db: PoolClient,
  sesionId: string
): Promise<ConciliacionTarjetas> {
  const cobros = await db.query<{
    cobro_id: string;
    medio_id: string;
    banco: string | null;
    tipo_tarjeta: string | null;
    marca_tarjeta: string | null;
    monto_crc: string;
    referencia: string | null;
    comision_estimada: string | null;
    neto_esperado: string | null;
    cobrado_en: string;
  }>(
    `SELECT co.id AS cobro_id, cm.id AS medio_id, cm.banco, cm.tipo_tarjeta, cm.marca_tarjeta,
            cm.monto_crc::text, cm.referencia, cm.comision_estimada::text, cm.neto_esperado::text,
            co.creado_en::text AS cobrado_en
       FROM vta_cobro_medios cm
       JOIN vta_cobros co ON co.id = cm.cobro_id
      WHERE co.sesion_id = $1 AND co.estado = 'aplicado' AND cm.medio = $2
      ORDER BY co.creado_en`,
    [sesionId, MEDIO_TARJETA]
  );

  const lote = await db.query<{
    banco: string;
    tipo_tarjeta: string;
    marca: string | null;
    cantidad: number;
    monto: string;
  }>(
    `SELECT banco, tipo_tarjeta, marca, cantidad, monto::text
       FROM vta_lote_datafono WHERE sesion_id = $1`,
    [sesionId]
  );

  const clave = (b: string | null, t: string | null, m: string | null) =>
    `${b ?? "?"}|${t ?? "?"}|${m ?? ""}`;

  const agregados = new Map<
    string,
    {
      banco: string | null;
      tipoTarjeta: string | null;
      marca: string | null;
      sistemaCantidad: number;
      sistemaMonto: number;
      loteCantidad: number | null;
      loteMonto: number | null;
    }
  >();

  for (const c of cobros.rows) {
    const k = clave(c.banco, c.tipo_tarjeta, c.marca_tarjeta);
    const a =
      agregados.get(k) ??
      {
        banco: c.banco,
        tipoTarjeta: c.tipo_tarjeta,
        marca: c.marca_tarjeta,
        sistemaCantidad: 0,
        sistemaMonto: 0,
        loteCantidad: null,
        loteMonto: null,
      };
    a.sistemaCantidad += 1;
    a.sistemaMonto += Number(c.monto_crc);
    agregados.set(k, a);
  }
  for (const l of lote.rows) {
    const k = clave(l.banco, l.tipo_tarjeta, l.marca);
    const a =
      agregados.get(k) ??
      {
        banco: l.banco,
        tipoTarjeta: l.tipo_tarjeta,
        marca: l.marca,
        sistemaCantidad: 0,
        sistemaMonto: 0,
        loteCantidad: null,
        loteMonto: null,
      };
    a.loteCantidad = (a.loteCantidad ?? 0) + Number(l.cantidad);
    a.loteMonto = (a.loteMonto ?? 0) + Number(l.monto);
    agregados.set(k, a);
  }

  const filas = [...agregados.values()].map((a) => ({
    ...a,
    sistemaMonto: Math.round(a.sistemaMonto * 100) / 100,
    diferencia:
      a.loteMonto === null ? null : Math.round((a.loteMonto - a.sistemaMonto) * 100) / 100,
  }));

  const totalSistema =
    Math.round(cobros.rows.reduce((t, c) => t + Number(c.monto_crc), 0) * 100) / 100;
  const totalLote =
    lote.rows.length === 0
      ? null
      : Math.round(lote.rows.reduce((t, l) => t + Number(l.monto), 0) * 100) / 100;

  return {
    filas,
    totalSistema,
    totalLote,
    diferenciaDelTotal:
      totalLote === null ? null : Math.round((totalLote - totalSistema) * 100) / 100,
    cobrosSinBanco: cobros.rows.filter((c) => !c.banco).length,
    cobros: cobros.rows.map((c) => ({
      cobroId: c.cobro_id,
      medioId: c.medio_id,
      banco: c.banco,
      tipoTarjeta: c.tipo_tarjeta,
      marca: c.marca_tarjeta,
      monto: Number(c.monto_crc),
      referencia: c.referencia,
      comisionEstimada: c.comision_estimada === null ? null : Number(c.comision_estimada),
      netoEsperado: c.neto_esperado === null ? null : Number(c.neto_esperado),
      cobradoEn: c.cobrado_en,
    })),
    diferenciaTotal:
      Math.round(filas.reduce((t, f) => t + (f.diferencia ?? 0), 0) * 100) / 100,
    comisionTotal:
      Math.round(
        cobros.rows.reduce((t, c) => t + Number(c.comision_estimada ?? 0), 0) * 100
      ) / 100,
  };
}
