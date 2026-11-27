import { PoolClient } from "pg";
import { deudores } from "../finanzas/cobranza";

// ---------------------------------------------------------------------
// §4 Y §5 — EL RESUMEN DEL CLIENTE Y EL DEL PACIENTE.
//
// Los dos son pestañas «Resumen» de fichas que YA EXISTEN, y por eso
// este módulo devuelve solo lo que falta: no repite la cabecera del
// expediente, ni los problemas, ni la medicación activa, ni la ficha
// racial, ni la evolución de peso —todo eso ya lo arma
// `expediente/resumen.ts` y duplicarlo acá habría sido la segunda
// definición de siempre—.
//
// Lo que agrega: el dinero (gasto, margen, saldo), la frecuencia, el
// estado de los preventivos POR TIPO y los casos abiertos.
// ---------------------------------------------------------------------

export interface ResumenCliente {
  propietarioId: string;
  gastoAcumulado: number;
  gastoPorLinea: Array<{ linea: string; monto: number }>;
  tendencia: Array<{ mes: string; monto: number }>;
  visitas: number;
  primeraVisita: string | null;
  ultimaVisita: string | null;
  /** Días promedio entre visitas. `null` con una sola visita. */
  frecuenciaDias: number | null;
  saldoPendiente: number;
  saldoVencido: number;
  /** El valor del cliente (§1). El proyectado queda para el 14. */
  valor: { ingresos: number; margen: number | null; sinCosto: number };
  mascotas: Array<{
    id: string;
    nombre: string;
    especie: string;
    estado: string;
    preventivosVencidos: number;
    ultimaVisita: string | null;
  }>;
  preventivosPendientes: Array<{
    paciente: string;
    pacienteId: string;
    tipo: string;
    detalle: string | null;
    fecha: string;
    dias: number;
  }>;
}

export async function resumenDeCliente(
  db: PoolClient,
  tenantId: string,
  propietarioId: string,
  opciones: { verCostos: boolean }
): Promise<ResumenCliente> {
  const existe = await db.query(
    `SELECT 1 FROM propietarios WHERE id = $1 AND tenant_id = $2`,
    [propietarioId, tenantId]
  );
  if (existe.rows.length === 0) throw new Error("Ese cliente no existe.");

  // EL GASTO SALE DE LOS CARGOS DE SUS CUENTAS, no de los comprobantes:
  // la factura puede estar a nombre de otro receptor (la empresa que
  // paga por el perro de su empleado), y lo que gastó este cliente es
  // lo que se le cargó a él.
  const gasto = await db.query<{ linea: string; monto: string }>(
    `SELECT COALESCE(c.linea_negocio, 'sin_linea') AS linea,
            sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))
              ::numeric(14,2)::text AS monto
       FROM vta_cargos c JOIN vta_cuentas cu ON cu.id = c.cuenta_id
      WHERE c.tenant_id = $1 AND cu.propietario_id = $2
        AND c.anulado_en IS NULL AND cu.estado <> 'anulada'
      GROUP BY 1 ORDER BY 2 DESC`,
    [tenantId, propietarioId]
  );

  const tendencia = await db.query<{ mes: string; monto: string }>(
    `SELECT to_char(date_trunc('month', c.creado_en), 'YYYY-MM') AS mes,
            sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))
              ::numeric(14,2)::text AS monto
       FROM vta_cargos c JOIN vta_cuentas cu ON cu.id = c.cuenta_id
      WHERE c.tenant_id = $1 AND cu.propietario_id = $2
        AND c.anulado_en IS NULL AND cu.estado <> 'anulada'
        AND c.creado_en >= date_trunc('month', CURRENT_DATE) - interval '11 months'
      GROUP BY 1 ORDER BY 1`,
    [tenantId, propietarioId]
  );

  const costo = await db.query<{ costo: string; sin_costo: number }>(
    `SELECT COALESCE(sum(m.cantidad_base * m.costo_unitario), 0)::numeric(14,2)::text AS costo,
            count(*) FILTER (
              WHERE c.presentacion_id IS NOT NULL
                AND (m.costo_unitario IS NULL OR m.costo_unitario = 0)
            )::int AS sin_costo
       FROM vta_cargos c
       JOIN vta_cuentas cu ON cu.id = c.cuenta_id
       LEFT JOIN inv_movimientos m ON m.id = c.movimiento_id
      WHERE c.tenant_id = $1 AND cu.propietario_id = $2
        AND c.anulado_en IS NULL AND cu.estado <> 'anulada'`,
    [tenantId, propietarioId]
  );

  const visitas = await db.query<{
    visitas: number;
    primera: string | null;
    ultima: string | null;
  }>(
    `SELECT count(*)::int AS visitas,
            min(a.creado_en)::date::text AS primera,
            max(a.creado_en)::date::text AS ultima
       FROM atenciones a JOIN pacientes pa ON pa.id = a.paciente_id
      WHERE a.tenant_id = $1 AND pa.propietario_id = $2 AND a.estado <> 'anulada'`,
    [tenantId, propietarioId]
  );

  const mascotas = await db.query<{
    id: string;
    nombre: string;
    especie: string;
    estado: string;
    vencidos: number;
    ultima: string | null;
  }>(
    `SELECT pa.id, pa.nombre, pa.especie, pa.estado,
            (SELECT count(*)::int FROM cuidados_preventivos cp
              WHERE cp.paciente_id = pa.id
                AND cp.fecha_proxima_recomendada < CURRENT_DATE) AS vencidos,
            (SELECT max(a.creado_en)::date::text FROM atenciones a
              WHERE a.paciente_id = pa.id) AS ultima
       FROM pacientes pa
      WHERE pa.tenant_id = $1 AND pa.propietario_id = $2
        AND pa.unificado_hacia_id IS NULL
      ORDER BY pa.nombre`,
    [tenantId, propietarioId]
  );

  const pendientes = await db.query<{
    paciente: string;
    paciente_id: string;
    tipo: string;
    detalle: string | null;
    fecha: string;
    dias: number;
  }>(
    `SELECT pa.nombre AS paciente, pa.id AS paciente_id, cp.tipo,
            COALESCE(cp.vacuna, cp.producto_desparasitacion) AS detalle,
            cp.fecha_proxima_recomendada::text AS fecha,
            (CURRENT_DATE - cp.fecha_proxima_recomendada)::int AS dias
       FROM cuidados_preventivos cp JOIN pacientes pa ON pa.id = cp.paciente_id
      WHERE cp.tenant_id = $1 AND pa.propietario_id = $2
        AND pa.estado = 'activo'
        AND cp.fecha_proxima_recomendada IS NOT NULL
        AND cp.fecha_proxima_recomendada < CURRENT_DATE + 30
      ORDER BY cp.fecha_proxima_recomendada`,
    [tenantId, propietarioId]
  );

  // EL SALDO SALE DE LA MISMA FUNCIÓN DEL 10a, con la regla del deudor.
  const todos = await deudores(db, tenantId);
  const suyo = todos.find((d) => d.propietario_id === propietarioId);

  const ingresosTotales = gasto.rows.reduce((s, f) => s + Number(f.monto), 0);
  const v = visitas.rows[0];
  const dias =
    v.primera && v.ultima && v.visitas > 1
      ? Math.round(
          (new Date(v.ultima).getTime() - new Date(v.primera).getTime()) /
            86400000 /
            (v.visitas - 1)
        )
      : null;

  return {
    propietarioId,
    gastoAcumulado: Math.round(ingresosTotales * 100) / 100,
    gastoPorLinea: gasto.rows.map((f) => ({ linea: f.linea, monto: Number(f.monto) })),
    tendencia: tendencia.rows.map((f) => ({ mes: f.mes, monto: Number(f.monto) })),
    visitas: v.visitas,
    primeraVisita: v.primera,
    ultimaVisita: v.ultima,
    frecuenciaDias: dias,
    saldoPendiente: suyo ? Number(suyo.saldo) : 0,
    saldoVencido: suyo ? Number(suyo.vencido) : 0,
    valor: {
      ingresos: Math.round(ingresosTotales * 100) / 100,
      // Sin permiso de costos el margen NO VIAJA, ni como cero.
      margen: opciones.verCostos
        ? Math.round((ingresosTotales - Number(costo.rows[0].costo)) * 100) / 100
        : null,
      sinCosto: opciones.verCostos ? costo.rows[0].sin_costo : 0,
    },
    mascotas: mascotas.rows.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      especie: m.especie,
      estado: m.estado,
      preventivosVencidos: m.vencidos,
      ultimaVisita: m.ultima,
    })),
    preventivosPendientes: pendientes.rows.map((f) => ({
      paciente: f.paciente,
      pacienteId: f.paciente_id,
      tipo: f.tipo,
      detalle: f.detalle,
      fecha: f.fecha,
      dias: f.dias,
    })),
  };
}

// ---------------------------------------------------------------------
// §5 — EL RESUMEN DEL PACIENTE
// ---------------------------------------------------------------------

export type EstadoPreventivo = "al_dia" | "por_vencer" | "vencido" | "sin_registro";

export interface PreventivoPorTipo {
  tipo: string;
  subtipo: string | null;
  estado: EstadoPreventivo;
  ultima: string | null;
  proxima: string | null;
  /** Un registro histórico del 07c cuenta como registro. */
  historico: boolean;
  dias: number | null;
}

/**
 * ESTADO DE PREVENTIVOS POR TIPO, con la distinción que pide la guía
 * §4.4: **«sin registro» no es «no vacunado»**.
 *
 * Que el sistema no tenga el dato no significa que el animal no esté
 * protegido —puede haberse vacunado en otra clínica—, y mostrarlo como
 * «no vacunado» llevaría a revacunar o a asustar al cliente sin motivo.
 * Por eso son cuatro estados y no tres, y el histórico cargado a mano
 * cuenta igual que el aplicado acá.
 */
export async function preventivosPorTipo(
  db: PoolClient,
  tenantId: string,
  pacienteId: string
): Promise<PreventivoPorTipo[]> {
  // Los tipos que la clínica efectivamente maneja: los dos del catálogo
  // (vacunación y desparasitación, con sus dos subtipos) son los que el
  // modelo admite hoy.
  const esperados: Array<{ tipo: string; subtipo: string | null }> = [
    { tipo: "vacunacion", subtipo: null },
    { tipo: "desparasitacion", subtipo: "interna" },
    { tipo: "desparasitacion", subtipo: "externa" },
  ];

  const r = await db.query<{
    tipo: string;
    subtipo: string | null;
    ultima: string | null;
    proxima: string | null;
    historico: boolean;
  }>(
    `SELECT cp.tipo, cp.subtipo_desparasitacion AS subtipo,
            max(cp.fecha_aplicacion)::text AS ultima,
            max(cp.fecha_proxima_recomendada)::text AS proxima,
            bool_or(COALESCE(cp.historico, false)) AS historico
       FROM cuidados_preventivos cp
      WHERE cp.tenant_id = $1 AND cp.paciente_id = $2
      GROUP BY 1, 2`,
    [tenantId, pacienteId]
  );

  const hoy = new Date();
  return esperados.map((e) => {
    const fila = r.rows.find(
      (f) => f.tipo === e.tipo && (f.subtipo ?? null) === e.subtipo
    );
    if (!fila) {
      return {
        tipo: e.tipo,
        subtipo: e.subtipo,
        estado: "sin_registro" as EstadoPreventivo,
        ultima: null,
        proxima: null,
        historico: false,
        dias: null,
      };
    }
    let estado: EstadoPreventivo = "al_dia";
    let dias: number | null = null;
    if (fila.proxima) {
      dias = Math.round((new Date(fila.proxima).getTime() - hoy.getTime()) / 86400000);
      if (dias < 0) estado = "vencido";
      else if (dias <= 30) estado = "por_vencer";
    }
    return {
      tipo: e.tipo,
      subtipo: e.subtipo,
      estado,
      ultima: fila.ultima,
      proxima: fila.proxima,
      historico: fila.historico,
      dias,
    };
  });
}

export interface ResumenPaciente {
  pacienteId: string;
  preventivos: PreventivoPorTipo[];
  gastoAcumulado: number;
  gastoPorLinea: Array<{ linea: string; monto: number }>;
  casosAbiertos: Array<{ id: string; motivo: string; estado: string; creado: string }>;
  /** Signos del examen físico, para la curva. */
  signos: Array<Record<string, unknown>>;
}

export async function resumenDePaciente(
  db: PoolClient,
  tenantId: string,
  pacienteId: string
): Promise<ResumenPaciente> {
  const preventivos = await preventivosPorTipo(db, tenantId, pacienteId);

  const gasto = await db.query<{ linea: string; monto: string }>(
    `SELECT COALESCE(c.linea_negocio, 'sin_linea') AS linea,
            sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))
              ::numeric(14,2)::text AS monto
       FROM vta_cargos c
      WHERE c.tenant_id = $1 AND c.paciente_id = $2 AND c.anulado_en IS NULL
      GROUP BY 1 ORDER BY 2 DESC`,
    [tenantId, pacienteId]
  );

  const casos = await db.query<{
    id: string;
    motivo: string;
    estado: string;
    creado: string;
  }>(
    `SELECT id, motivo, estado, creado_en::date::text AS creado
       FROM casos
      WHERE tenant_id = $1 AND paciente_id = $2 AND estado <> 'cerrado'
      ORDER BY creado_en DESC`,
    [tenantId, pacienteId]
  );

  const signos = await db.query(
    `SELECT a.creado_en::date::text AS fecha, a.peso, a.temperatura,
            a.frecuencia_cardiaca, a.frecuencia_respiratoria, a.condicion_corporal
       FROM atenciones a
      WHERE a.tenant_id = $1 AND a.paciente_id = $2
        AND (a.peso IS NOT NULL OR a.temperatura IS NOT NULL
             OR a.frecuencia_cardiaca IS NOT NULL OR a.frecuencia_respiratoria IS NOT NULL)
      ORDER BY a.creado_en`,
    [tenantId, pacienteId]
  );

  return {
    pacienteId,
    preventivos,
    gastoAcumulado:
      Math.round(gasto.rows.reduce((s, f) => s + Number(f.monto), 0) * 100) / 100,
    gastoPorLinea: gasto.rows.map((f) => ({ linea: f.linea, monto: Number(f.monto) })),
    casosAbiertos: casos.rows,
    signos: signos.rows,
  };
}
