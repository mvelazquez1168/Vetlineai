import { PoolClient } from "pg";
import { emitirNotificacion } from "../notificaciones";
import { politicaNumero } from "../clinica/politicas";
import { registrarInteraccion } from "../crm/interacciones";

// ---------------------------------------------------------------------
// CUENTAS POR COBRAR Y COBRANZA AMABLE — prompt 10a, §4.
//
// LOS SALDOS SALEN DE LAS CUENTAS DEL 08. No hay una segunda tabla de
// saldos: lo que se debe se calcula sobre `fact_comprobantes` a crédito
// menos lo aplicado de `vta_abono_aplicaciones`, que es exactamente lo
// que ya hacía `cuentaCorriente` del 08. Acá se agrega la vista de
// gestión —por deudor, con antigüedad— y el recordatorio.
//
// EL DEUDOR ES EL RECEPTOR DE LA FACTURA Y PUEDE NO SER EL DUEÑO DEL
// PACIENTE. Es la regla del 08 y del anexo 07-03: la empresa que paga
// por el perro de su empleado, el albergue que trae veinte gatos. Si
// esta pantalla listara dueños de pacientes, le cobraría al que no debe.
// ---------------------------------------------------------------------

export class CobranzaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CobranzaInvalida";
  }
}

export interface DeudorConSaldo {
  propietario_id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  facturas: number;
  saldo: string;
  vencido: string;
  mas_antigua: string | null;
  dias_mas_vencida: number;
  ultimo_recordatorio: string | null;
}

/** El SQL del saldo por deudor: una sola definición, la del 08. */
const SALDO_POR_DEUDOR = `
  WITH facturas AS (
    SELECT f.receptor_propietario_id AS propietario_id,
           f.id,
           f.fecha_emision,
           (f.fecha_emision + (COALESCE(f.plazo_credito_dias, 0) || ' days')::interval)::date AS vence_el,
           f.total_comprobante
             - COALESCE((SELECT sum(aa.monto) FROM vta_abono_aplicaciones aa
                          WHERE aa.comprobante_id = f.id), 0) AS pendiente
      FROM fact_comprobantes f
     WHERE f.tenant_id = $1
       AND f.receptor_propietario_id IS NOT NULL
       AND f.tipo_comprobante = '01'
       AND f.condicion_venta IN ('02', '10')
       AND f.estado IN ('aceptado', 'aceptado_parcial', 'enviado', 'en_cola')
  )
  SELECT p.id AS propietario_id, p.nombre, p.email, p.telefono,
         count(*)::int AS facturas,
         sum(f.pendiente)::text AS saldo,
         COALESCE(sum(CASE WHEN f.vence_el < CURRENT_DATE THEN f.pendiente ELSE 0 END), 0)::text AS vencido,
         min(f.fecha_emision)::date::text AS mas_antigua,
         GREATEST(0, CURRENT_DATE - min(f.vence_el))::int AS dias_mas_vencida,
         (SELECT max(r.enviado_en)::text FROM fin_recordatorios_saldo r
           WHERE r.propietario_id = p.id) AS ultimo_recordatorio
    FROM facturas f
    JOIN propietarios p ON p.id = f.propietario_id
   WHERE f.pendiente > 0.001
   GROUP BY p.id, p.nombre, p.email, p.telefono
   ORDER BY sum(f.pendiente) DESC
`;

export async function deudores(db: PoolClient, tenantId: string): Promise<DeudorConSaldo[]> {
  const r = await db.query<DeudorConSaldo>(SALDO_POR_DEUDOR, [tenantId]);
  return r.rows;
}

export async function resumenPorCobrar(
  db: PoolClient,
  tenantId: string
): Promise<{
  total: number;
  vencido: number;
  clientes: number;
  antiguedad: Array<{ tramo: string; monto: number }>;
}> {
  const lista = await deudores(db, tenantId);
  const tramo = (d: DeudorConSaldo) => {
    const v = d.dias_mas_vencida;
    if (v <= 0) return "al_dia";
    if (v <= 30) return "1_30";
    if (v <= 60) return "31_60";
    return "mas_60";
  };
  const porTramo = new Map<string, number>();
  for (const d of lista) {
    porTramo.set(tramo(d), (porTramo.get(tramo(d)) ?? 0) + Number(d.saldo));
  }
  return {
    total: Math.round(lista.reduce((t, d) => t + Number(d.saldo), 0) * 100) / 100,
    vencido: Math.round(lista.reduce((t, d) => t + Number(d.vencido), 0) * 100) / 100,
    clientes: lista.length,
    antiguedad: ["al_dia", "1_30", "31_60", "mas_60"].map((t) => ({
      tramo: t,
      monto: Math.round((porTramo.get(t) ?? 0) * 100) / 100,
    })),
  };
}

/**
 * ¿Se le puede volver a recordar a este deudor?
 *
 * La política `cobranza.dias_entre_recordatorios` (04) decide cada
 * cuántos días. Se consulta ANTES de llamar a `emitirNotificacion`
 * porque es una regla de la clínica y no del consentimiento: el cliente
 * puede haber consentido y la clínica igual no querer escribirle todos
 * los días.
 */
export async function porQueNoSePuedeRecordar(
  db: PoolClient,
  tenantId: string,
  propietarioId: string
): Promise<string | null> {
  const dias = await politicaNumero(db, tenantId, "cobranza.dias_entre_recordatorios");
  const r = await db.query<{ hace: number }>(
    `SELECT (CURRENT_DATE - max(enviado_en)::date)::int AS hace
       FROM fin_recordatorios_saldo
      WHERE tenant_id = $1 AND propietario_id = $2`,
    [tenantId, propietarioId]
  );
  const hace = r.rows[0]?.hace;
  if (hace === null || hace === undefined) return null;
  if (hace < dias) {
    return `Ya se le recordó hace ${hace === 0 ? "menos de un día" : `${hace} día${hace === 1 ? "" : "s"}`}. La clínica configuró recordar cada ${dias} días.`;
  }
  return null;
}

/**
 * Le recuerda el saldo a un deudor.
 *
 * Pasa por `emitirNotificacion`, que es el único punto de envío: ahí se
 * consultan los consentimientos, el canal preferido y la franja horaria.
 * La finalidad es **salud** y no **promociones** a propósito: cobrar lo
 * que se debe es una comunicación transaccional de la cuenta, no
 * marketing, y por eso no consume el tope mensual de promociones.
 */
export async function recordarSaldo(
  db: PoolClient,
  tenantId: string,
  datos: { propietarioId: string; mensaje?: string | null; personaId: string }
): Promise<{ enviado: boolean; motivo?: string; canal?: string }> {
  const bloqueo = await porQueNoSePuedeRecordar(db, tenantId, datos.propietarioId);
  if (bloqueo) return { enviado: false, motivo: bloqueo };

  const lista = await deudores(db, tenantId);
  const deudor = lista.find((d) => d.propietario_id === datos.propietarioId);
  if (!deudor) {
    return { enviado: false, motivo: "Esa persona no tiene saldo pendiente." };
  }

  const notificacionId = await emitirNotificacion(db, {
    tenantId,
    tipo: "recordatorio_saldo",
    destinatarioTipo: "propietario",
    destinatarioId: datos.propietarioId,
    asunto: `Saldo pendiente — CRC ${deudor.saldo}`,
    contenido:
      `Saldo pendiente de CRC ${deudor.saldo} en ${deudor.facturas} factura(s)` +
      (deudor.mas_antigua ? `, la más antigua del ${deudor.mas_antigua}` : "") +
      ".",
    datosCorreo: {
      saldo: deudor.saldo,
      moneda: "CRC",
      facturas: deudor.facturas,
      masAntigua: deudor.mas_antigua,
      mensajeDeLaClinica: datos.mensaje?.trim() || null,
    },
  });

  // Qué pasó de verdad: si el envío quedó bloqueado por consentimiento,
  // `emitirNotificacion` deja la fila en 'fallida' con su motivo. El
  // recordatorio se anota igual —la clínica intentó— pero se devuelve el
  // motivo para que la pantalla lo diga.
  const estado = await db.query<{ estado: string; error: string | null; canal: string }>(
    `SELECT estado, error, canal FROM notificaciones WHERE id = $1`,
    [notificacionId]
  );
  const fila = estado.rows[0];

  await db.query(
    `INSERT INTO fin_recordatorios_saldo
       (tenant_id, propietario_id, saldo, canal, notificacion_id, enviado_por)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      tenantId,
      datos.propietarioId,
      Number(deudor.saldo),
      fila?.canal ?? "correo",
      notificacionId,
      datos.personaId,
    ]
  );

  // EN LA LÍNEA DE TIEMPO DEL CRM, como pide el prompt: el recordatorio
  // es parte de la relación con ese cliente, no un evento de finanzas.
  await registrarInteraccion(db, {
    tenantId,
    tipo: "recordatorio_saldo",
    propietarioId: datos.propietarioId,
    origenTabla: "fin_recordatorios_saldo",
    origenId: notificacionId,
    personaId: datos.personaId,
    resumen: `Saldo de CRC ${deudor.saldo} en ${deudor.facturas} factura(s)`,
  });

  if (fila?.estado === "fallida") {
    return { enviado: false, motivo: fila.error ?? "No se pudo enviar." };
  }
  return { enviado: true, canal: fila?.canal };
}
