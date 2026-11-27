import { PoolClient } from "pg";
import { alertasDeInventario } from "../inventario/consultas";
import {
  Periodo,
  atenciones,
  cargosFugados,
  clientesNuevos,
  cobrosPorMedio,
  cuentasCobradas,
  inasistencias,
  ingresos,
  ocupacion,
  periodoAnterior,
  porCobrar,
  porLineaDeNegocio,
  retencion,
  serieDeIngresos,
  topDeItems,
} from "./diccionario";

// ---------------------------------------------------------------------
// LOS DASHBOARDS — prompt 12, §2 y §3.
//
// Acá no se calcula NADA: todo sale de `diccionario.ts`. Este archivo
// solo arma bloques y decide qué se muestra. Es a propósito: el día que
// alguien quiera cambiar qué cuenta como ingreso, hay un solo lugar
// donde hacerlo, y la tarjeta, la lista y el Excel cambian juntos.
// ---------------------------------------------------------------------

export interface Tarjeta {
  clave: string;
  valor: number | null;
  anterior: number | null;
  /** La variación contra el período anterior, en porcentaje. */
  variacion: number | null;
  /** Lo que la tarjeta dice debajo del número. */
  detalle?: string;
  serie?: Array<{ fecha: string; valor: number }>;
}

function variacion(valor: number | null, anterior: number | null): number | null {
  if (valor === null || anterior === null || anterior === 0) return null;
  return Math.round(((valor - anterior) / Math.abs(anterior)) * 1000) / 10;
}

export interface OpcionesDashboard {
  /** Sin el permiso de costos, los bloques de margen no se arman (§10). */
  verCostos: boolean;
}

export interface DashboardClinica {
  periodo: Periodo;
  comparado: Periodo;
  tarjetas: Tarjeta[];
  porLinea: Array<{
    linea: string;
    ingresos: number;
    costo: number;
    margen: number;
    sin_costo: number;
  }>;
  verCostos: boolean;
  sinCosto: number;
  tendencia: Array<{ fecha: string; valor: number }>;
  topPorIngresos: Awaited<ReturnType<typeof topDeItems>>;
  topPorMargen: Awaited<ReturnType<typeof topDeItems>> | null;
  inventarioCritico: { bajoMinimo: number; porVencer: number; vencidosConExistencia: number };
  agenda: {
    porMedico: Array<{ medico: string; citas: number; minutos: number; noShow: number }>;
    porSala: Array<{ sala: string; citas: number; minutos: number }>;
    inasistenciasPorMotivo: Array<{ motivo: string; cantidad: number }>;
  };
  clientes: { nuevos: number; recurrentes: number; retencion: number | null };
  cobrosPorMedio: Array<{ medio: string; monto: number; cantidad: number }>;
  /** §2: el bloque de campañas solo aparece si YA hay campañas con datos. */
  campanas: Array<{ campana: string; enviados: number; respondieron: number }> | null;
}

export async function dashboardClinica(
  db: PoolClient,
  tenantId: string,
  p: Periodo,
  opciones: OpcionesDashboard
): Promise<DashboardClinica> {
  const anterior = periodoAnterior(p);

  // EN ORDEN y no con Promise.all: `db` es un solo cliente de Postgres
  // dentro de una transacción, y no admite dos consultas a la vez.
  const ing = await ingresos(db, tenantId, p);
  const ingAnt = await ingresos(db, tenantId, anterior);
  const cuentas = await cuentasCobradas(db, tenantId, p);
  const cuentasAnt = await cuentasCobradas(db, tenantId, anterior);
  const at = await atenciones(db, tenantId, p);
  const atAnt = await atenciones(db, tenantId, anterior);
  const nuevos = await clientesNuevos(db, tenantId, p);
  const nuevosAnt = await clientesNuevos(db, tenantId, anterior);
  const ocu = await ocupacion(db, tenantId, p);
  const ocuAnt = await ocupacion(db, tenantId, anterior);
  const ina = await inasistencias(db, tenantId, p);
  const inaAnt = await inasistencias(db, tenantId, anterior);
  const cobrar = await porCobrar(db, tenantId);
  const fuga = await cargosFugados(db, tenantId, p);
  const fugaAnt = await cargosFugados(db, tenantId, anterior);
  const tendencia = await serieDeIngresos(db, tenantId, p, granoDe(p));
  const linea = await porLineaDeNegocio(db, tenantId, p);
  const topIng = await topDeItems(db, tenantId, p, "ingresos");
  const topMar = opciones.verCostos ? await topDeItems(db, tenantId, p, "margen") : null;
  const ret = await retencion(db, tenantId, p);
  const medios = await cobrosPorMedio(db, tenantId, p);
  const alertas = await alertasDeInventario(db);
  const agenda = await agendaDelPeriodo(db, tenantId, p);
  const campanas = await resultadoDeCampanas(db, tenantId, p);

  const ticket = cuentas > 0 ? Math.round((ing / cuentas) * 100) / 100 : 0;
  const ticketAnt = cuentasAnt > 0 ? Math.round((ingAnt / cuentasAnt) * 100) / 100 : 0;
  const sinCosto = linea.reduce((s, l) => s + l.sin_costo, 0);

  const tarjetas: Tarjeta[] = [
    {
      clave: "ingresos",
      valor: ing,
      anterior: ingAnt,
      variacion: variacion(ing, ingAnt),
      serie: tendencia,
    },
    {
      clave: "ticket_promedio",
      valor: ticket,
      anterior: ticketAnt,
      variacion: variacion(ticket, ticketAnt),
      detalle: `${cuentas} cuentas cobradas`,
    },
    { clave: "atenciones", valor: at, anterior: atAnt, variacion: variacion(at, atAnt) },
    {
      clave: "clientes_nuevos",
      valor: nuevos,
      anterior: nuevosAnt,
      variacion: variacion(nuevos, nuevosAnt),
    },
    {
      clave: "ocupacion",
      valor: ocu.porcentaje,
      anterior: ocuAnt.porcentaje,
      variacion: variacion(ocu.porcentaje, ocuAnt.porcentaje),
      // SIN HORARIO NO HAY OCUPACIÓN: se dice, en vez de mostrar 0 %.
      detalle:
        ocu.porcentaje === null
          ? "Falta configurar el horario de la clínica"
          : `${ocu.minutosCitados} de ${ocu.minutosDisponibles} minutos`,
    },
    {
      clave: "inasistencias",
      valor: ina.porcentaje,
      anterior: inaAnt.porcentaje,
      variacion: variacion(ina.porcentaje, inaAnt.porcentaje),
      detalle: `${ina.noShow} de ${ina.total} citas`,
    },
    {
      clave: "por_cobrar",
      valor: cobrar.total,
      anterior: null,
      variacion: null,
      // El período NO la afecta, y la tarjeta tiene que decirlo.
      detalle: `${cobrar.documentos} documentos · saldo de hoy`,
    },
    {
      clave: "cargos_fugados",
      valor: fuga.total,
      anterior: fugaAnt.total,
      variacion: variacion(fuga.total, fugaAnt.total),
      detalle: `${fuga.cantidad} cargos sin cobrar`,
    },
  ];

  return {
    periodo: p,
    comparado: anterior,
    tarjetas,
    // SIN PERMISO DE COSTOS no se devuelve el costo ni el margen: no
    // alcanza con no dibujarlo en la pantalla, porque el dato viaja
    // igual al navegador y cualquiera lo lee en la respuesta.
    porLinea: opciones.verCostos
      ? linea
      : linea.map((l) => ({ linea: l.linea, ingresos: l.ingresos, costo: 0, margen: 0, sin_costo: 0 })),
    verCostos: opciones.verCostos,
    sinCosto: opciones.verCostos ? sinCosto : 0,
    tendencia,
    topPorIngresos: opciones.verCostos
      ? topIng
      : topIng.map((t) => ({ ...t, costo: 0, margen: 0 })),
    topPorMargen: topMar,
    inventarioCritico: {
      bajoMinimo: alertas.bajoMinimo.length,
      porVencer: alertas.porVencer30.length,
      vencidosConExistencia: alertas.lotesVencidosConExistencia.length,
    },
    agenda,
    clientes: { nuevos, recurrentes: Math.max(0, ret.volvieron), retencion: ret.porcentaje },
    cobrosPorMedio: medios,
    campanas,
  };
}

/** Día para períodos cortos, mes para los largos. */
function granoDe(p: Periodo): "dia" | "semana" | "mes" {
  const dias = Math.round(
    (new Date(p.hasta).getTime() - new Date(p.desde).getTime()) / 86400000
  );
  if (dias <= 31) return "dia";
  if (dias <= 120) return "semana";
  return "mes";
}

async function agendaDelPeriodo(db: PoolClient, tenantId: string, p: Periodo) {
  const porMedico = await db.query<{
    medico: string;
    citas: number;
    minutos: number;
    no_show: number;
  }>(
    `SELECT COALESCE(per.nombre, 'Sin médico') AS medico,
            count(*) FILTER (WHERE c.estado <> 'cancelada')::int AS citas,
            COALESCE(sum(c.duracion_minutos) FILTER (WHERE c.estado <> 'cancelada'), 0)::int AS minutos,
            count(*) FILTER (WHERE c.estado = 'no_show')::int AS no_show
       FROM citas c LEFT JOIN personas per ON per.id = c.medico_id
      WHERE c.tenant_id = $1 AND c.fecha BETWEEN $2::date AND $3::date
      GROUP BY 1 ORDER BY 2 DESC`,
    [tenantId, p.desde, p.hasta]
  );

  const porSala = await db.query<{ sala: string; citas: number; minutos: number }>(
    `SELECT COALESCE(s.nombre, 'Sin sala') AS sala,
            count(*)::int AS citas,
            COALESCE(sum(c.duracion_minutos), 0)::int AS minutos
       FROM citas c LEFT JOIN salas s ON s.id = c.sala_id
      WHERE c.tenant_id = $1 AND c.fecha BETWEEN $2::date AND $3::date
        AND c.estado <> 'cancelada'
      GROUP BY 1 ORDER BY 2 DESC`,
    [tenantId, p.desde, p.hasta]
  );

  // El motivo de la inasistencia lo explica la cancelación cuando la
  // hubo; cuando no, es «No avisó», que es justamente el caso que duele.
  const motivos = await db.query<{ motivo: string; cantidad: number }>(
    `SELECT COALESCE(NULLIF(trim(c.motivo_cancelacion), ''), 'No avisó') AS motivo,
            count(*)::int AS cantidad
       FROM citas c
      WHERE c.tenant_id = $1 AND c.estado = 'no_show'
        AND c.fecha BETWEEN $2::date AND $3::date
      GROUP BY 1 ORDER BY 2 DESC`,
    [tenantId, p.desde, p.hasta]
  );

  return {
    porMedico: porMedico.rows.map((f) => ({
      medico: f.medico,
      citas: f.citas,
      minutos: f.minutos,
      noShow: f.no_show,
    })),
    porSala: porSala.rows,
    inasistenciasPorMotivo: motivos.rows,
  };
}

/**
 * Campañas: el bloque APARECE SOLO SI HAY DATOS (§2).
 *
 * Un bloque vacío que dice «0 campañas» no informa nada y ocupa el
 * lugar de algo que sí. La tabla todavía no existe —la construye el
 * 14—, así que se pregunta por ella antes de consultarla.
 */
async function resultadoDeCampanas(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<Array<{ campana: string; enviados: number; respondieron: number }> | null> {
  const existe = await db.query<{ existe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'crm_campanas'
     ) AS existe`
  );
  if (!existe.rows[0].existe) return null;

  const r = await db.query<{ campana: string; enviados: number; respondieron: number }>(
    `SELECT ca.nombre AS campana,
            count(m.*)::int AS enviados,
            count(m.*) FILTER (WHERE m.respondido_en IS NOT NULL)::int AS respondieron
       FROM crm_campanas ca
       LEFT JOIN crm_mensajes m ON m.campana_id = ca.id
        AND m.creado_en::date BETWEEN $2::date AND $3::date
      WHERE ca.tenant_id = $1
      GROUP BY 1 HAVING count(m.*) > 0
      ORDER BY 2 DESC`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows.length > 0 ? r.rows : null;
}

// ---------------------------------------------------------------------
// §3 — EL DASHBOARD DEL MÉDICO
//
// «Un médico ve lo suyo»: todas las consultas filtran por `medicoId`.
// Quién puede pedir el de otro lo decide la ruta, no este módulo.
// ---------------------------------------------------------------------

export interface DashboardMedico {
  medicoId: string;
  medico: string;
  periodo: Periodo;
  tarjetas: Tarjeta[];
  agendaHoy: Array<Record<string, unknown>>;
  agendaSemana: Array<{ fecha: string; citas: number }>;
  seguimientos: Array<Record<string, unknown>>;
  recomendacionesNoAgendadas: Array<Record<string, unknown>>;
  laboratorioSinVer: Array<Record<string, unknown>>;
  porLinea: Array<{ linea: string; ingresos: number }>;
  topServicios: Array<{ item: string; cantidad: number; ingresos: number }>;
}

export async function dashboardMedico(
  db: PoolClient,
  tenantId: string,
  medicoId: string,
  p: Periodo
): Promise<DashboardMedico> {
  const anterior = periodoAnterior(p);

  const nombre = await db.query<{ nombre: string }>(
    `SELECT nombre FROM personas WHERE id = $1 AND tenant_id = $2`,
    [medicoId, tenantId]
  );
  if (nombre.rows.length === 0) throw new Error("Ese médico no es de esta clínica.");

  const cuenta = async (per: Periodo) =>
    (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM atenciones
          WHERE tenant_id = $1 AND medico_id = $4 AND estado = 'cerrada'
            AND cerrada_en::date BETWEEN $2::date AND $3::date`,
        [tenantId, per.desde, per.hasta, medicoId]
      )
    ).rows[0].n;

  // FACTURACIÓN ATRIBUIDA: por `realizado_por`, el ejecutor que registra
  // cada cargo (08b). No por el médico de la atención: quien aplicó la
  // vacuna puede no ser quien escribió la consulta, y la comisión del 11
  // ya reparte con este mismo criterio.
  const facturado = async (per: Periodo) =>
    Number(
      (
        await db.query<{ total: string }>(
          `SELECT COALESCE(sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0)), 0)
                    ::numeric(14,2)::text AS total
             FROM vta_cargos c
            WHERE c.tenant_id = $1 AND c.anulado_en IS NULL
              AND COALESCE(c.realizado_por, c.creado_por) = $4
              AND c.creado_en::date BETWEEN $2::date AND $3::date`,
          [tenantId, per.desde, per.hasta, medicoId]
        )
      ).rows[0].total
    );

  const at = await cuenta(p);
  const atAnt = await cuenta(anterior);
  const fac = await facturado(p);
  const facAnt = await facturado(anterior);

  const casos = (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM casos
        WHERE tenant_id = $1 AND medico_id = $2 AND estado <> 'cerrado'`,
      [tenantId, medicoId]
    )
  ).rows[0].n;

  const agendaHoy = (
    await db.query(
      `SELECT c.hora_inicio::text AS hora, pa.nombre AS paciente, c.estado,
              c.motivo_consulta, c.id, pa.id AS paciente_id
         FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id
        WHERE c.tenant_id = $1 AND c.medico_id = $2 AND c.fecha = CURRENT_DATE
        ORDER BY c.hora_inicio`,
      [tenantId, medicoId]
    )
  ).rows;

  const agendaSemana = (
    await db.query<{ fecha: string; citas: number }>(
      `SELECT c.fecha::text, count(*)::int AS citas
         FROM citas c
        WHERE c.tenant_id = $1 AND c.medico_id = $2
          AND c.fecha BETWEEN CURRENT_DATE AND CURRENT_DATE + 6
          AND c.estado <> 'cancelada'
        GROUP BY 1 ORDER BY 1`,
      [tenantId, medicoId]
    )
  ).rows;

  // Seguimientos: los controles que él programó y los preventivos
  // vencidos de SUS pacientes (los que atendió alguna vez).
  const seguimientos = (
    await db.query(
      `SELECT * FROM (
         SELECT a.control_fecha::text AS fecha, pa.nombre AS paciente,
                a.control_motivo AS motivo, 'control' AS clase, pa.id AS paciente_id
           FROM atenciones a JOIN pacientes pa ON pa.id = a.paciente_id
          WHERE a.tenant_id = $1 AND a.medico_id = $2
            AND a.control_fecha IS NOT NULL AND a.control_fecha <= CURRENT_DATE + 7
            AND a.control_cita_id IS NULL AND pa.estado = 'activo'
         UNION ALL
         SELECT cp.fecha_proxima_recomendada::text, pa.nombre,
                cp.tipo || COALESCE(' · ' || cp.vacuna, ''), 'preventivo', pa.id
           FROM cuidados_preventivos cp
           JOIN pacientes pa ON pa.id = cp.paciente_id
          WHERE cp.tenant_id = $1
            AND cp.fecha_proxima_recomendada < CURRENT_DATE
            AND pa.estado = 'activo'
            AND EXISTS (SELECT 1 FROM atenciones a2
                         WHERE a2.paciente_id = pa.id AND a2.medico_id = $2)
       ) t
       ORDER BY fecha
       LIMIT 100`,
      [tenantId, medicoId]
    )
  ).rows;

  // RECOMENDACIONES NO AGENDADAS: un control recomendado en una atención
  // que el cliente nunca agendó. Es la lista accionable del §3 —y la
  // única forma, hoy, de ver cuánto control recomendado se pierde.
  const recomendaciones = (
    await db.query(
      `SELECT a.control_fecha::text AS fecha, a.control_motivo AS motivo,
              pa.nombre AS paciente, pr.nombre AS cliente, pr.telefono,
              pa.id AS paciente_id, pr.id AS propietario_id
         FROM atenciones a
         JOIN pacientes pa ON pa.id = a.paciente_id
         LEFT JOIN propietarios pr ON pr.id = pa.propietario_id
        WHERE a.tenant_id = $1 AND a.medico_id = $2
          AND a.control_fecha IS NOT NULL
          AND a.control_cita_id IS NULL
          AND pa.estado = 'activo'
          AND NOT EXISTS (
            SELECT 1 FROM citas c
             WHERE c.paciente_id = pa.id AND c.estado <> 'cancelada'
               AND c.fecha >= a.cerrada_en::date
          )
        ORDER BY a.control_fecha
        LIMIT 100`,
      [tenantId, medicoId]
    )
  ).rows;

  const laboratorio = (
    await db.query(
      `SELECT e.fecha_resultado::text AS fecha, e.tipo_estudio, pa.nombre AS paciente,
              e.laboratorio, e.id, pa.id AS paciente_id
         FROM exp_estudios_lab e JOIN pacientes pa ON pa.id = e.paciente_id
        WHERE e.tenant_id = $1 AND e.solicitado_por = $2
          AND e.estado = 'resultado_recibido' AND e.visto_en IS NULL
        ORDER BY e.fecha_resultado`,
      [tenantId, medicoId]
    )
  ).rows;

  const porLinea = (
    await db.query<{ linea: string; ingresos: string }>(
      `SELECT COALESCE(c.linea_negocio, 'sin_linea') AS linea,
              sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))
                ::numeric(14,2)::text AS ingresos
         FROM vta_cargos c
        WHERE c.tenant_id = $1 AND c.anulado_en IS NULL
          AND COALESCE(c.realizado_por, c.creado_por) = $4
          AND c.creado_en::date BETWEEN $2::date AND $3::date
        GROUP BY 1 ORDER BY 2 DESC`,
      [tenantId, p.desde, p.hasta, medicoId]
    )
  ).rows.map((f) => ({ linea: f.linea, ingresos: Number(f.ingresos) }));

  const topServicios = (
    await db.query<{ item: string; cantidad: string; ingresos: string }>(
      `SELECT COALESCE(s.nombre, c.descripcion) AS item,
              sum(c.cantidad)::text AS cantidad,
              sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))
                ::numeric(14,2)::text AS ingresos
         FROM vta_cargos c LEFT JOIN inv_servicios s ON s.id = c.servicio_id
        WHERE c.tenant_id = $1 AND c.anulado_en IS NULL
          AND COALESCE(c.realizado_por, c.creado_por) = $4
          AND c.creado_en::date BETWEEN $2::date AND $3::date
        GROUP BY 1 ORDER BY 3 DESC LIMIT 10`,
      [tenantId, p.desde, p.hasta, medicoId]
    )
  ).rows.map((f) => ({
    item: f.item,
    cantidad: Number(f.cantidad),
    ingresos: Number(f.ingresos),
  }));

  const ticket = at > 0 ? Math.round((fac / at) * 100) / 100 : 0;
  const ticketAnt = atAnt > 0 ? Math.round((facAnt / atAnt) * 100) / 100 : 0;

  return {
    medicoId,
    medico: nombre.rows[0].nombre,
    periodo: p,
    tarjetas: [
      { clave: "atenciones", valor: at, anterior: atAnt, variacion: variacion(at, atAnt) },
      {
        clave: "facturacion_atribuida",
        valor: fac,
        anterior: facAnt,
        variacion: variacion(fac, facAnt),
        detalle: "por el ejecutor de cada cargo",
      },
      {
        clave: "ticket_promedio",
        valor: ticket,
        anterior: ticketAnt,
        variacion: variacion(ticket, ticketAnt),
        detalle: "facturado ÷ atenciones",
      },
      { clave: "casos_abiertos", valor: casos, anterior: null, variacion: null },
    ],
    agendaHoy,
    agendaSemana,
    seguimientos,
    recomendacionesNoAgendadas: recomendaciones,
    laboratorioSinVer: laboratorio,
    porLinea,
    topServicios,
  };
}

/** La comparativa entre médicos, que solo ve el administrador (§3). */
export async function comparativaDeMedicos(
  db: PoolClient,
  tenantId: string,
  p: Periodo
): Promise<
  Array<{
    medicoId: string;
    medico: string;
    atenciones: number;
    facturado: number;
    ticket: number;
    noShow: number;
  }>
> {
  const r = await db.query<{
    id: string;
    nombre: string;
    atenciones: number;
    facturado: string;
    no_show: number;
  }>(
    `SELECT per.id, per.nombre,
            (SELECT count(*)::int FROM atenciones a
              WHERE a.medico_id = per.id AND a.estado = 'cerrada'
                AND a.cerrada_en::date BETWEEN $2::date AND $3::date) AS atenciones,
            (SELECT COALESCE(sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0)), 0)
                      ::numeric(14,2)::text
               FROM vta_cargos c
              WHERE COALESCE(c.realizado_por, c.creado_por) = per.id AND c.anulado_en IS NULL
                AND c.creado_en::date BETWEEN $2::date AND $3::date) AS facturado,
            (SELECT count(*)::int FROM citas ci
              WHERE ci.medico_id = per.id AND ci.estado = 'no_show'
                AND ci.fecha BETWEEN $2::date AND $3::date) AS no_show
       FROM personas per
      WHERE per.tenant_id = $1 AND per.es_medico AND per.estado = 'activo'
      ORDER BY 3 DESC`,
    [tenantId, p.desde, p.hasta]
  );
  return r.rows.map((f) => ({
    medicoId: f.id,
    medico: f.nombre,
    atenciones: f.atenciones,
    facturado: Number(f.facturado),
    ticket: f.atenciones > 0 ? Math.round((Number(f.facturado) / f.atenciones) * 100) / 100 : 0,
    noShow: f.no_show,
  }));
}
