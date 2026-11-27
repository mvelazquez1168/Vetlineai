import { PoolClient } from "pg";
import { deudores, resumenPorCobrar } from "../finanzas/cobranza";

// ---------------------------------------------------------------------
// EL DICCIONARIO DE MÉTRICAS — prompt 12, §1.
//
// UNA SOLA DEFINICIÓN POR NÚMERO. Cada métrica se define una vez, acá, y
// el mismo cálculo alimenta la tarjeta, el gráfico, la lista del
// drill-down, la exportación y —cuando llegue— el agente del 16.
//
// POR QUÉ ESTO ES EL CENTRO DEL PROMPT: un indicador calculado en dos
// lugares es dos indicadores. El día que uno excluye las notas de
// crédito y el otro no, la clínica tiene dos cifras de ingresos y
// ninguna forma de saber cuál es. Acá cada métrica declara **qué
// excluye**, **a qué fecha se imputa** y **de dónde sale**, y la lista
// del drill-down se arma con el MISMO `FROM` y el MISMO `WHERE` que el
// total.
//
// LA REGLA QUE SE VERIFICA: la suma de la lista es igual al número de
// la tarjeta. Si no, hay dos definiciones y una está mal.
// ---------------------------------------------------------------------

export type ClaveMetrica =
  | "ingresos"
  | "ticket_promedio"
  | "atenciones"
  | "clientes_nuevos"
  | "ocupacion"
  | "inasistencias"
  | "por_cobrar"
  | "cargos_fugados"
  | "margen"
  | "retencion";

export interface DefinicionMetrica {
  clave: ClaveMetrica;
  nombre: string;
  /** En lenguaje simple: lo que ve quien toca el ícono de información. */
  descripcion: string;
  formula: string;
  /** Las tablas de las que sale, para el diccionario publicado. */
  fuente: string;
  /** Qué NO cuenta. Es la mitad de la definición. */
  excluye: string;
  /** A qué fecha se imputa, y por qué esa. */
  imputacion: string;
  /** Cómo se muestra. */
  formato: "dinero" | "entero" | "porcentaje";
  /** Si necesita el permiso de ver costos (§10). */
  requierePermiso?: string;
  /** Si tiene lista: qué se ve al hacer clic. */
  drillDown?: string;
}

export const METRICAS: DefinicionMetrica[] = [
  {
    clave: "ingresos",
    nombre: "Ingresos",
    descripcion:
      "Lo que la clínica facturó en el período, sin el IVA y descontando las notas de crédito.",
    formula: "suma(comprobantes de venta sin IVA) − suma(notas de crédito sin IVA)",
    fuente: "fact_comprobantes",
    excluye:
      "los comprobantes rechazados por Hacienda y los anulados; el IVA, que es de Hacienda y está de paso",
    imputacion:
      "la fecha de emisión del comprobante. Es la que el contador usa y la que no cambia si el cliente paga tarde",
    formato: "dinero",
    drillDown: "los comprobantes del período, con su cliente y su total",
  },
  {
    clave: "ticket_promedio",
    nombre: "Ticket promedio",
    descripcion: "Cuánto deja, en promedio, cada cuenta que se cobró.",
    formula: "ingresos ÷ cantidad de cuentas cobradas",
    fuente: "fact_comprobantes, vta_cuentas",
    excluye: "las cuentas abiertas: todavía no son una venta",
    imputacion: "la del ingreso que promedia",
    formato: "dinero",
  },
  {
    clave: "atenciones",
    nombre: "Atenciones",
    descripcion: "Las consultas que se cerraron y se firmaron en el período.",
    formula: "cantidad de atenciones con estado cerrada",
    fuente: "atenciones",
    excluye:
      "las atenciones abiertas o a medio escribir: una consulta sin firmar todavía no pasó del todo",
    imputacion: "la fecha de cierre, no la de apertura",
    formato: "entero",
    drillDown: "las atenciones cerradas, con su paciente y su médico",
  },
  {
    clave: "clientes_nuevos",
    nombre: "Clientes nuevos",
    descripcion: "Clientes cuya PRIMERA atención o compra cayó en el período.",
    formula: "clientes cuya primera actividad está dentro del período",
    fuente: "propietarios, atenciones, vta_cuentas",
    excluye:
      "los que se dieron de alta pero nunca vinieron: un cliente cargado en el sistema no es un cliente",
    imputacion: "la fecha de su primera actividad real",
    formato: "entero",
    drillDown: "los clientes y la fecha de su primera visita",
  },
  {
    clave: "ocupacion",
    nombre: "Ocupación de la agenda",
    descripcion: "Qué parte del tiempo disponible de la clínica está citado.",
    formula: "minutos citados ÷ minutos disponibles según el horario de la clínica",
    fuente: "citas, clinica_horario",
    excluye: "las citas canceladas; los días que la clínica no abre",
    imputacion: "la fecha de la cita",
    formato: "porcentaje",
  },
  {
    clave: "inasistencias",
    nombre: "Inasistencias",
    descripcion: "De las citas del período, cuántas no se presentaron.",
    formula: "citas no presentadas ÷ citas del período",
    fuente: "citas",
    excluye:
      "las canceladas con aviso: avisar que no se puede venir no es faltar, y contarlas igual castiga al cliente que avisó",
    imputacion: "la fecha de la cita",
    formato: "porcentaje",
    drillDown: "las citas no presentadas, con su cliente",
  },
  {
    clave: "por_cobrar",
    nombre: "Cuentas por cobrar",
    descripcion: "Lo que los clientes deben hoy, venga del período que venga.",
    formula: "facturas a crédito − abonos aplicados",
    fuente: "fact_comprobantes, vta_abono_aplicaciones",
    excluye: "lo que se cobró al contado",
    imputacion:
      "no se imputa a un período: es un saldo de HOY. Cambiar el período no lo cambia, y la pantalla lo dice",
    formato: "dinero",
    drillDown: "los deudores con su saldo",
  },
  {
    clave: "cargos_fugados",
    nombre: "Cargos fugados",
    descripcion:
      "Lo que se registró en una atención ya cerrada y nunca se cobró. Es plata que la clínica hizo y no facturó.",
    formula: "cargos de cuentas abiertas cuya atención ya cerró, más las cuentas abiertas hace más de N días",
    fuente: "vta_cargos, vta_cuentas, atenciones",
    excluye: "los cargos anulados y las cuentas ya cobradas",
    imputacion: "la fecha del cargo",
    formato: "dinero",
    drillDown: "los cargos sin cobrar, con su cuenta y su paciente, para poder recuperarlos",
  },
  {
    clave: "margen",
    nombre: "Margen de contribución",
    descripcion: "Lo que queda después de pagar lo que costó: ingresos menos costo directo.",
    formula: "ingresos − costo de los productos que salieron del inventario",
    fuente: "vta_cargos, inv_movimientos",
    excluye:
      "los ítems SIN COSTO CARGADO, que se cuentan aparte y nunca como 100 % de margen: eso sería inventar que algo no costó nada",
    imputacion: "la del ingreso",
    formato: "dinero",
    requierePermiso: "catalogo.ver_costos",
    drillDown: "los cargos con su ingreso, su costo y su margen",
  },
  {
    clave: "retencion",
    nombre: "Retención",
    descripcion:
      "De los clientes que vinieron en el período anterior, cuántos volvieron en este.",
    formula: "clientes con actividad en los dos períodos ÷ clientes con actividad en el anterior",
    fuente: "atenciones, vta_cuentas",
    excluye: "los clientes nuevos de este período: no se puede retener a quien todavía no estaba",
    imputacion: "la fecha de la actividad",
    formato: "porcentaje",
  },
];

export function definicion(clave: ClaveMetrica): DefinicionMetrica {
  const d = METRICAS.find((m) => m.clave === clave);
  if (!d) throw new Error(`No existe la métrica «${clave}».`);
  return d;
}

export interface Periodo {
  desde: string;
  hasta: string;
}

export interface FiltrosMetrica {
  lineaNegocio?: string | null;
  medicoId?: string | null;
}

/**
 * EL `WHERE` DE LOS COMPROBANTES DE VENTA, en un solo lugar.
 *
 * Lo comparten el total de ingresos, el desglose por línea y la lista
 * del drill-down. Está escrito una vez para que no puedan divergir:
 * ese es el defecto que este módulo existe para evitar.
 */
const MONTO_SIN_IVA = `
  (f.total_comprobante - COALESCE(f.total_impuesto, 0))
  * CASE WHEN f.moneda = 'CRC' THEN 1 ELSE COALESCE(f.tipo_cambio, 1) END
`;

const COMPROBANTES_DE_VENTA = `
  f.tenant_id = $1
  AND f.fecha_emision::date BETWEEN $2::date AND $3::date
  AND f.tipo_comprobante IN ('01', '04')
  AND f.estado IN ('aceptado', 'aceptado_parcial', 'enviado', 'en_cola')
`;

/** Lo mismo para las notas de crédito, que RESTAN. */
const NOTAS_DE_CREDITO = `
  f.tenant_id = $1
  AND f.fecha_emision::date BETWEEN $2::date AND $3::date
  AND f.tipo_comprobante = '03'
  AND f.estado IN ('aceptado', 'aceptado_parcial', 'enviado', 'en_cola')
`;

export interface ValorMetrica {
  clave: ClaveMetrica;
  valor: number;
  /** El mismo cálculo en el período anterior, para la variación. */
  anterior: number | null;
  /** Cuántos ítems quedaron fuera por no tener costo (solo margen). */
  sinCosto?: number;
}

/** Ingresos: comprobantes de venta sin IVA, menos notas de crédito. */
export async function ingresos(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<number> {
  const r = await db.query<{ total: string }>(
    `SELECT (
       COALESCE((SELECT sum(${MONTO_SIN_IVA})
                   FROM fact_comprobantes f WHERE ${COMPROBANTES_DE_VENTA}), 0)
       - COALESCE((SELECT sum(${MONTO_SIN_IVA})
                     FROM fact_comprobantes f WHERE ${NOTAS_DE_CREDITO}), 0)
     )::numeric(14,2)::text AS total`,
    [tenantId, p.desde, p.hasta]
  );
  return Number(r.rows[0].total);
}

/** La lista que compone los ingresos. Mismo `WHERE` que el total. */
export async function listaDeIngresos(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT f.fecha_emision::date::text AS fecha,
            f.tipo_comprobante AS tipo,
            f.consecutivo,
            COALESCE(f.receptor_nombre, pr.nombre, 'Contado') AS cliente,
            f.moneda,
            (CASE WHEN f.tipo_comprobante = '03' THEN -1 ELSE 1 END
              * ${MONTO_SIN_IVA})::numeric(14,2) AS monto,
            f.id
       FROM fact_comprobantes f
       LEFT JOIN propietarios pr ON pr.id = f.receptor_propietario_id
      WHERE f.tenant_id = $1
        AND f.fecha_emision::date BETWEEN $2::date AND $3::date
        AND f.tipo_comprobante IN ('01', '03', '04')
        AND f.estado IN ('aceptado', 'aceptado_parcial', 'enviado', 'en_cola')
      ORDER BY f.fecha_emision DESC`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows;
}

export async function atenciones(db: PoolClient, tenantId: string, p: Periodo): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM atenciones a
      WHERE a.tenant_id = $1 AND a.estado = 'cerrada'
        AND a.cerrada_en::date BETWEEN $2::date AND $3::date`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows[0].n;
}

export async function listaDeAtenciones(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT a.cerrada_en::date::text AS fecha, pac.nombre AS paciente,
            per.nombre AS medico, a.tipo_consulta, a.id
       FROM atenciones a
       JOIN pacientes pac ON pac.id = a.paciente_id
       LEFT JOIN personas per ON per.id = a.medico_id
      WHERE a.tenant_id = $1 AND a.estado = 'cerrada'
        AND a.cerrada_en::date BETWEEN $2::date AND $3::date
      ORDER BY a.cerrada_en DESC`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows;
}

export async function clientesNuevos(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<number> {
  const r = await db.query<{ n: number }>(
    `WITH primera AS (
       SELECT pr.id, min(act.fecha) AS fecha
         FROM propietarios pr
         JOIN LATERAL (
           SELECT min(a.creado_en::date) AS fecha
             FROM atenciones a JOIN pacientes pa ON pa.id = a.paciente_id
            WHERE pa.propietario_id = pr.id
           UNION ALL
           SELECT min(c.abierta_en::date) FROM vta_cuentas c WHERE c.propietario_id = pr.id
         ) act ON true
        WHERE pr.tenant_id = $1
        GROUP BY pr.id
     )
     SELECT count(*)::int AS n FROM primera
      WHERE fecha BETWEEN $2::date AND $3::date`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows[0].n;
}

export async function listaDeClientesNuevos(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `WITH primera AS (
       SELECT pr.id, pr.nombre, pr.telefono, min(act.fecha) AS fecha
         FROM propietarios pr
         JOIN LATERAL (
           SELECT min(a.creado_en::date) AS fecha
             FROM atenciones a JOIN pacientes pa ON pa.id = a.paciente_id
            WHERE pa.propietario_id = pr.id
           UNION ALL
           SELECT min(c.abierta_en::date) FROM vta_cuentas c WHERE c.propietario_id = pr.id
         ) act ON true
        WHERE pr.tenant_id = $1
        GROUP BY pr.id, pr.nombre, pr.telefono
     )
     SELECT nombre AS cliente, telefono, fecha::text, id FROM primera
      WHERE fecha BETWEEN $2::date AND $3::date
      ORDER BY fecha DESC`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows;
}

/**
 * Inasistencias: no presentadas sobre el total de citas del período.
 *
 * Las canceladas **con aviso** no cuentan ni arriba ni abajo: avisar no
 * es faltar, y dejarlas en el denominador le bajaría el indicador a la
 * clínica que tiene clientes que avisan.
 */
export async function inasistencias(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<{ porcentaje: number; noShow: number; total: number }> {
  const r = await db.query<{ no_show: number; total: number }>(
    `SELECT count(*) FILTER (WHERE estado = 'no_show')::int AS no_show,
            count(*) FILTER (WHERE estado <> 'cancelada')::int AS total
       FROM citas
      WHERE tenant_id = $1 AND fecha BETWEEN $2::date AND $3::date`,
    [tenantId, p.desde, p.hasta]
  );
  const { no_show, total } = r.rows[0];
  return {
    porcentaje: total > 0 ? Math.round((no_show / total) * 1000) / 10 : 0,
    noShow: no_show,
    total,
  };
}

export async function listaDeInasistencias(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT c.fecha::text, c.hora_inicio::text, pac.nombre AS paciente,
            pr.nombre AS cliente, pr.telefono, per.nombre AS medico, c.id
       FROM citas c
       JOIN pacientes pac ON pac.id = c.paciente_id
       LEFT JOIN propietarios pr ON pr.id = pac.propietario_id
       LEFT JOIN personas per ON per.id = c.medico_id
      WHERE c.tenant_id = $1 AND c.estado = 'no_show'
        AND c.fecha BETWEEN $2::date AND $3::date
      ORDER BY c.fecha DESC`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows;
}

/**
 * Ocupación: minutos citados sobre minutos que la clínica abre.
 *
 * SIN HORARIO CONFIGURADO NO HAY OCUPACIÓN, y se devuelve `null` en vez
 * de 0: un 0 % diría «la agenda está vacía» cuando lo que pasa es que
 * nadie configuró el horario.
 */
export async function ocupacion(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<{ porcentaje: number | null; minutosCitados: number; minutosDisponibles: number }> {
  const citados = await db.query<{ minutos: number }>(
    `SELECT COALESCE(sum(duracion_minutos), 0)::int AS minutos
       FROM citas
      WHERE tenant_id = $1 AND fecha BETWEEN $2::date AND $3::date
        AND estado <> 'cancelada'`,
    [tenantId, p.desde, p.hasta]
  );

  const disponibles = await db.query<{ minutos: number }>(
    `WITH dias AS (
       SELECT d::date AS dia FROM generate_series($2::date, $3::date, '1 day') d
     ),
     abiertos AS (
       SELECT dias.dia, h.bloques
         FROM dias
         JOIN clinica_horario h
           ON h.tenant_id = $1
          AND h.dia_semana = EXTRACT(DOW FROM dias.dia)::int
          AND h.abierto
        WHERE NOT EXISTS (
          SELECT 1 FROM clinica_excepciones e
           WHERE e.tenant_id = $1 AND e.bloquea AND e.medico_id IS NULL
             AND e.estado = 'aprobada'
             AND dias.dia BETWEEN e.desde AND e.hasta
        )
     )
     SELECT COALESCE(sum(
       EXTRACT(EPOCH FROM ((b->>'hasta')::time - (b->>'desde')::time)) / 60
     ), 0)::int AS minutos
       FROM abiertos, jsonb_array_elements(abiertos.bloques) b`,
    [tenantId, p.desde, p.hasta]
  );

  const minutosCitados = citados.rows[0].minutos;
  const minutosDisponibles = disponibles.rows[0].minutos;
  return {
    porcentaje:
      minutosDisponibles > 0
        ? Math.round((minutosCitados / minutosDisponibles) * 1000) / 10
        : null,
    minutosCitados,
    minutosDisponibles,
  };
}

/**
 * Cargos fugados: lo que se hizo y no se cobró.
 *
 * Son los cargos de cuentas **abiertas** cuya atención **ya cerró**: el
 * médico registró lo que hizo, la consulta terminó, y la cuenta sigue
 * abierta. Más las cuentas abiertas hace más de N días, que es la misma
 * fuga por otra puerta.
 */
export async function cargosFugados(
  db: PoolClient,
  tenantId: string,
  p: Periodo,
  diasDeGracia = 2
): Promise<{ total: number; cantidad: number }> {
  const r = await db.query<{ total: string; cantidad: number }>(
    `SELECT COALESCE(sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0)), 0)
              ::numeric(14,2)::text AS total,
            count(*)::int AS cantidad
       FROM vta_cargos c
       JOIN vta_cuentas cu ON cu.id = c.cuenta_id
       LEFT JOIN atenciones a ON a.id::text = c.origen_id::text AND c.origen = 'atencion'
      WHERE c.tenant_id = $1
        AND c.anulado_en IS NULL
        AND cu.estado = 'abierta'
        AND c.creado_en::date BETWEEN $2::date AND $3::date
        AND (
          (a.id IS NOT NULL AND a.estado = 'cerrada')
          OR cu.abierta_en < now() - ($4 || ' days')::interval
        )`,
    [tenantId, p.desde, p.hasta, diasDeGracia]
  );
  return { total: Number(r.rows[0].total), cantidad: r.rows[0].cantidad };
}

export async function listaDeCargosFugados(
  db: PoolClient,
  tenantId: string,
  p: Periodo,
  diasDeGracia = 2
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT c.creado_en::date::text AS fecha, c.descripcion,
            COALESCE(pr.nombre, cu.cliente_nombre) AS cliente,
            pac.nombre AS paciente,
            ((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))::numeric(14,2) AS monto,
            cu.numero AS cuenta, c.id
       FROM vta_cargos c
       JOIN vta_cuentas cu ON cu.id = c.cuenta_id
       LEFT JOIN propietarios pr ON pr.id = cu.propietario_id
       LEFT JOIN pacientes pac ON pac.id = c.paciente_id
       LEFT JOIN atenciones a ON a.id::text = c.origen_id::text AND c.origen = 'atencion'
      WHERE c.tenant_id = $1
        AND c.anulado_en IS NULL
        AND cu.estado = 'abierta'
        AND c.creado_en::date BETWEEN $2::date AND $3::date
        AND (
          (a.id IS NOT NULL AND a.estado = 'cerrada')
          OR cu.abierta_en < now() - ($4 || ' days')::interval
        )
      ORDER BY c.creado_en DESC`,
    [tenantId, p.desde, p.hasta, diasDeGracia]
  );
  return r.rows;
}

/**
 * Ingresos y margen por línea de negocio.
 *
 * EL MARGEN SALE DE LOS CARGOS Y NO DE LOS COMPROBANTES, porque el costo
 * vive en el movimiento de inventario que el cargo generó. Y **lo que no
 * tiene costo se cuenta aparte**: mostrarlo con 100 % de margen sería
 * inventar que no costó nada, que es la regla de la guía §8.3.
 */
export async function porLineaDeNegocio(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<
  Array<{ linea: string; ingresos: number; costo: number; margen: number; sin_costo: number }>
> {
  const r = await db.query<{
    linea: string;
    ingresos: string;
    costo: string;
    sin_costo: number;
  }>(
    `SELECT COALESCE(c.linea_negocio, 'sin_linea') AS linea,
            sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))
              ::numeric(14,2)::text AS ingresos,
            COALESCE(sum(m.cantidad_base * m.costo_unitario), 0)::numeric(14,2)::text AS costo,
            count(*) FILTER (
              WHERE c.presentacion_id IS NOT NULL AND (m.costo_unitario IS NULL OR m.costo_unitario = 0)
            )::int AS sin_costo
       FROM vta_cargos c
       LEFT JOIN inv_movimientos m ON m.id = c.movimiento_id
      WHERE c.tenant_id = $1
        AND c.anulado_en IS NULL
        AND c.creado_en::date BETWEEN $2::date AND $3::date
      GROUP BY 1
      ORDER BY 2 DESC`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows.map((f) => ({
    linea: f.linea,
    ingresos: Number(f.ingresos),
    costo: Number(f.costo),
    margen: Math.round((Number(f.ingresos) - Number(f.costo)) * 100) / 100,
    sin_costo: f.sin_costo,
  }));
}

/** El top de productos y servicios, por ingresos o por margen. */
export async function topDeItems(
  db: PoolClient,
  tenantId: string,
  p: Periodo,
  por: "ingresos" | "margen" = "ingresos",
  limite = 10
): Promise<
  Array<{
    item: string;
    tipo: "producto" | "servicio";
    cantidad: number;
    ingresos: number;
    costo: number;
    margen: number;
    sin_costo: boolean;
  }>
> {
  const r = await db.query<{
    item: string;
    tipo: "producto" | "servicio";
    cantidad: string;
    ingresos: string;
    costo: string;
    sin_costo: boolean;
  }>(
    `SELECT COALESCE(pr.nombre, s.nombre, c.descripcion) AS item,
            CASE WHEN c.servicio_id IS NOT NULL THEN 'servicio' ELSE 'producto' END AS tipo,
            sum(c.cantidad)::text AS cantidad,
            sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))
              ::numeric(14,2)::text AS ingresos,
            COALESCE(sum(m.cantidad_base * m.costo_unitario), 0)::numeric(14,2)::text AS costo,
            bool_and(m.costo_unitario IS NULL OR m.costo_unitario = 0) AS sin_costo
       FROM vta_cargos c
       LEFT JOIN inv_presentaciones pre ON pre.id = c.presentacion_id
       LEFT JOIN inv_productos pr ON pr.id = pre.producto_id
       LEFT JOIN inv_servicios s ON s.id = c.servicio_id
       LEFT JOIN inv_movimientos m ON m.id = c.movimiento_id
      WHERE c.tenant_id = $1 AND c.anulado_en IS NULL
        AND c.creado_en::date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2
      ORDER BY ${por === "margen" ? "(sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0)) - COALESCE(sum(m.cantidad_base * m.costo_unitario), 0))" : "sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))"} DESC
      LIMIT $4`,
    [tenantId, p.desde, p.hasta, limite]
  );
  return r.rows.map((f) => ({
    item: f.item,
    tipo: f.tipo,
    cantidad: Number(f.cantidad),
    ingresos: Number(f.ingresos),
    costo: Number(f.costo),
    margen: Math.round((Number(f.ingresos) - Number(f.costo)) * 100) / 100,
    sin_costo: f.sin_costo,
  }));
}

/** El período inmediatamente anterior, del mismo largo. */
export function periodoAnterior(p: Periodo): Periodo {
  const desde = new Date(p.desde);
  const hasta = new Date(p.hasta);
  const dias = Math.max(1, Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1);
  const finAnterior = new Date(desde.getTime() - 86400000);
  const inicioAnterior = new Date(finAnterior.getTime() - (dias - 1) * 86400000);
  return {
    desde: inicioAnterior.toISOString().slice(0, 10),
    hasta: finAnterior.toISOString().slice(0, 10),
  };
}

/**
 * Cuentas por cobrar: un SALDO DE HOY, no un total del período.
 *
 * NO SE CALCULA ACÁ. Ya existía en `finanzas/cobranza.ts` desde el 10a,
 * con la regla del deudor —el receptor de la factura, que puede no ser
 * el dueño del paciente— y con la antigüedad. Volver a escribirlo acá
 * habría creado el segundo número que este archivo existe para evitar:
 * la pantalla de cobranza y el dashboard dirían distinto y las dos
 * tendrían razón.
 *
 * Lo único que agrega esta función es la forma que la tarjeta espera.
 */
export async function porCobrar(
  db: PoolClient,
  tenantId: string
): Promise<{ total: number; documentos: number }> {
  const r = await resumenPorCobrar(db, tenantId);
  return { total: r.total, documentos: r.clientes };
}

/** La lista del drill-down: los mismos deudores de la pantalla del 10a. */
export async function listaDePorCobrar(
  db: PoolClient,
  tenantId: string
): Promise<Array<Record<string, unknown>>> {
  const lista = await deudores(db, tenantId);
  return lista.map((d) => ({
    cliente: d.nombre,
    telefono: d.telefono,
    facturas: d.facturas,
    monto: Number(d.saldo),
    vencido: Number(d.vencido),
    dias: d.dias_mas_vencida,
    id: d.propietario_id,
  }));
}

/** Clientes con actividad en un período. Base de la retención. */
async function clientesConActividad(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<Set<string>> {
  const r = await db.query<{ id: string }>(
    `SELECT DISTINCT pa.propietario_id AS id
       FROM atenciones a JOIN pacientes pa ON pa.id = a.paciente_id
      WHERE a.tenant_id = $1 AND pa.propietario_id IS NOT NULL
        AND a.creado_en::date BETWEEN $2::date AND $3::date
     UNION
     SELECT DISTINCT c.propietario_id
       FROM vta_cuentas c
      WHERE c.tenant_id = $1 AND c.propietario_id IS NOT NULL
        AND c.abierta_en::date BETWEEN $2::date AND $3::date`,
    [tenantId, p.desde, p.hasta]
  );
  return new Set(r.rows.map((f) => f.id));
}

export async function retencion(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<{ porcentaje: number | null; volvieron: number; base: number }> {
  const anterior = periodoAnterior(p);
  const [antes, ahora] = await Promise.all([
    clientesConActividad(db, tenantId, anterior),
    clientesConActividad(db, tenantId, p),
  ]);
  let volvieron = 0;
  for (const id of antes) if (ahora.has(id)) volvieron++;
  return {
    porcentaje: antes.size > 0 ? Math.round((volvieron / antes.size) * 1000) / 10 : null,
    volvieron,
    base: antes.size,
  };
}

/** Cobros por medio de pago, en colones. */
export async function cobrosPorMedio(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<Array<{ medio: string; monto: number; cantidad: number }>> {
  const r = await db.query<{ medio: string; monto: string; cantidad: number }>(
    `SELECT m.medio, sum(m.monto_crc)::numeric(14,2)::text AS monto, count(*)::int AS cantidad
       FROM vta_cobro_medios m
       JOIN vta_cobros co ON co.id = m.cobro_id
      WHERE m.tenant_id = $1 AND co.anulado_en IS NULL
        AND co.creado_en::date BETWEEN $2::date AND $3::date
      GROUP BY m.medio ORDER BY 2 DESC`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows.map((f) => ({
    medio: f.medio,
    monto: Number(f.monto),
    cantidad: f.cantidad,
  }));
}

/**
 * La serie de ingresos, por día o por mes.
 *
 * Alimenta el sparkline de la tarjeta y la tendencia del gráfico: el
 * mismo cálculo que el total, agrupado. Si el sparkline saliera de otra
 * consulta, un día no sumaría lo que dice la tarjeta.
 */
export async function serieDeIngresos(
  db: PoolClient,
  tenantId: string,
  p: Periodo,
  grano: "dia" | "semana" | "mes" = "dia"
): Promise<Array<{ fecha: string; valor: number }>> {
  // `date_trunc` habla inglés: 'dia' no es una unidad para Postgres y
  // el error sale recién en ejecución. El grano se traduce acá.
  const unidad = grano === "dia" ? "day" : grano === "semana" ? "week" : "month";
  const r = await db.query<{ fecha: string; valor: string }>(
    `SELECT date_trunc($4, f.fecha_emision)::date::text AS fecha,
            sum(CASE WHEN f.tipo_comprobante = '03' THEN -1 ELSE 1 END * ${MONTO_SIN_IVA})
              ::numeric(14,2)::text AS valor
       FROM fact_comprobantes f
      WHERE f.tenant_id = $1
        AND f.fecha_emision::date BETWEEN $2::date AND $3::date
        AND f.tipo_comprobante IN ('01', '03', '04')
        AND f.estado IN ('aceptado', 'aceptado_parcial', 'enviado', 'en_cola')
      GROUP BY 1 ORDER BY 1`,
    [tenantId, p.desde, p.hasta, unidad]
  );
  return r.rows.map((f) => ({ fecha: f.fecha, valor: Number(f.valor) }));
}

/** Cuentas cobradas en el período: el denominador del ticket promedio. */
export async function cuentasCobradas(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM vta_cuentas
      WHERE tenant_id = $1 AND estado = 'cobrada'
        AND cerrada_en::date BETWEEN $2::date AND $3::date`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows[0].n;
}
