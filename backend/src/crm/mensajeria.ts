import { PoolClient } from "pg";
import {
  Canal,
  Finalidad,
  esPalabraDeBaja,
  puedeEnviar,
  registrarConsentimiento,
} from "./consentimientos";
import { registrarInteraccion } from "./interacciones";
import { enviosRealesHabilitados, explicacionDeSimulacion } from "../entorno";

// ---------------------------------------------------------------------
// EL CANAL DE MENSAJERÍA — prompt 03, sección 6.
//
// Una interfaz para enviar y para recibir, con una implementación
// SIMULADA. La conexión real con Converza va en otro prompt; acá queda
// el contrato, documentado en `docs/crm/contrato-mensajeria.md`, para
// que conectarlo no obligue a cambiar el CRM.
//
// POR QUÉ UNA INTERFAZ Y NO UNA LLAMADA DIRECTA: el proveedor de
// mensajería es lo único de este módulo que no se puede probar sin
// internet y sin plata. Con la interfaz, los nueve escenarios del
// verificador corren en medio segundo y sin mandarle un WhatsApp a
// nadie. Es el mismo patrón del proveedor de Hacienda y del de pagos,
// que ya existen en este repo.
// ---------------------------------------------------------------------

export interface MensajeAEnviar {
  canal: Canal;
  destino: string;
  texto: string;
  /** Para que el proveedor pueda correlacionar la respuesta. */
  referencia?: string;
}

export interface ResultadoProveedor {
  entregado: boolean;
  proveedorMensajeId?: string;
  error?: string;
}

export interface ProveedorMensajeria {
  nombre: string;
  enviar(m: MensajeAEnviar): Promise<ResultadoProveedor>;
}

/**
 * El simulado. Decide por el DESTINO, no al azar: un verificador con un
 * proveedor aleatorio no es un verificador.
 *
 *   * un destino que contiene "falla" → el envío falla;
 *   * cualquier otro → entregado, con un id reproducible.
 */
export class MensajeriaSimulada implements ProveedorMensajeria {
  nombre = "simulado";
  private contador = 0;

  async enviar(m: MensajeAEnviar): Promise<ResultadoProveedor> {
    this.contador += 1;
    if (m.destino.includes("falla")) {
      return { entregado: false, error: "El proveedor simulado rechazó este destino." };
    }
    return { entregado: true, proveedorMensajeId: `sim-${this.canalCorto(m.canal)}-${this.contador}` };
  }

  private canalCorto(c: Canal): string {
    return c === "whatsapp" ? "wa" : "mail";
  }
}

let proveedor: ProveedorMensajeria = new MensajeriaSimulada();

/**
 * Para el prompt que conecte Converza: se reemplaza acá y nada más
 * cambia.
 *
 * EN UN AMBIENTE LOCAL ESTO SE RECHAZA salvo que el proveedor sea
 * simulado o que alguien haya pedido envíos reales con
 * `ENVIOS_REALES=1`. Un WhatsApp es peor que un correo: llega al
 * teléfono de una persona y no hay bandeja de spam que lo amortigüe. La
 * puerta es la misma que la del correo, en `entorno.ts`.
 */
export function usarProveedorMensajeria(p: ProveedorMensajeria): void {
  if (p.nombre !== "simulado" && !enviosRealesHabilitados()) {
    throw new Error(
      `No se puede activar el proveedor de mensajería "${p.nombre}" en este ambiente. ` +
        explicacionDeSimulacion()
    );
  }
  proveedor = p;
}
export function proveedorMensajeria(): ProveedorMensajeria {
  return proveedor;
}

// ---------------------------------------------------------------------
// ENVIAR
//
// Esta función es la que une las dos mitades del prompt: pregunta al
// punto único si se puede, manda por el proveedor y DEJA EL REGISTRO en
// los dos casos. Un mensaje bloqueado también se guarda: el día que
// alguien pregunte "¿por qué no le avisaron?", la respuesta está.
// ---------------------------------------------------------------------

export interface ResultadoEnvio {
  enviado: boolean;
  mensajeId: string;
  motivo?: string;
  reprogramadoPara?: Date;
}

export async function enviarMensaje(
  db: PoolClient,
  tenantId: string,
  s: {
    propietarioId: string;
    pacienteId?: string | null;
    canal?: Canal;
    finalidad: Finalidad;
    tipo: string;
    texto: string;
    ahora?: Date;
  }
): Promise<ResultadoEnvio> {
  const veredicto = await puedeEnviar(db, {
    tenantId,
    propietarioId: s.propietarioId,
    pacienteId: s.pacienteId,
    canal: s.canal,
    finalidad: s.finalidad,
    tipo: s.tipo,
    ahora: s.ahora,
  });

  if (!veredicto.puede) {
    const estado = veredicto.motivo === "fuera_de_horario" ? "reprogramado" : "bloqueado";
    const m = await guardarMensaje(db, tenantId, {
      ...s,
      canal: veredicto.canal,
      estado,
      motivo: veredicto.explicacion ?? veredicto.motivo,
      reprogramadoPara: veredicto.reprogramarPara ?? null,
    });
    return {
      enviado: false,
      mensajeId: m,
      motivo: veredicto.motivo,
      reprogramadoPara: veredicto.reprogramarPara,
    };
  }

  const r = await proveedor.enviar({
    canal: veredicto.canal,
    destino: veredicto.destino!,
    texto: s.texto,
  });

  const mensajeId = await guardarMensaje(db, tenantId, {
    ...s,
    canal: veredicto.canal,
    estado: r.entregado ? "enviado" : "fallido",
    motivo: r.error ?? null,
    proveedorMensajeId: r.proveedorMensajeId ?? null,
  });

  if (r.entregado) {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "mensaje_enviado",
      propietarioId: s.propietarioId,
      pacienteId: s.pacienteId,
      origenTabla: "crm_mensajes",
      origenId: mensajeId,
      canal: veredicto.canal,
      finalidad: s.finalidad,
      resumen: `${s.tipo} por ${veredicto.canal}`,
    });
  }

  return { enviado: r.entregado, mensajeId, motivo: r.error };
}

async function guardarMensaje(
  db: PoolClient,
  tenantId: string,
  m: {
    propietarioId: string;
    pacienteId?: string | null;
    canal: Canal;
    finalidad: Finalidad;
    tipo: string;
    texto: string;
    estado: string;
    motivo?: string | null;
    reprogramadoPara?: Date | null;
    proveedorMensajeId?: string | null;
    correoEnviadoId?: string | null;
  }
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO crm_mensajes
       (tenant_id, propietario_id, paciente_id, canal, finalidad, tipo, estado, motivo,
        reprogramado_para, proveedor_mensaje_id, correo_enviado_id, contenido)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      tenantId,
      m.propietarioId,
      m.pacienteId ?? null,
      m.canal,
      m.finalidad,
      m.tipo,
      m.estado,
      (m.motivo ?? null) && String(m.motivo).slice(0, 200),
      m.reprogramadoPara ?? null,
      m.proveedorMensajeId ?? null,
      m.correoEnviadoId ?? null,
      m.texto,
    ]
  );
  return r.rows[0].id;
}

// ---------------------------------------------------------------------
// RECIBIR
//
// La respuesta del cliente entra por acá, venga del proveedor real o
// del simulado. Si es una palabra de baja, se retira el consentimiento
// de PROMOCIONES de ese canal al instante y se le confirma.
//
// El consentimiento de SALUD no se toca: nadie que escribe "baja" está
// renunciando a que le avisen de la vacuna de su perro. Si de verdad
// quiere eso, lo pide y la clínica lo registra desde la ficha.
// ---------------------------------------------------------------------

export interface RespuestaEntrante {
  canal: Canal;
  /** El teléfono o el correo desde donde contestaron. */
  remitente: string;
  texto: string;
}

export async function recibirRespuesta(
  db: PoolClient,
  tenantId: string,
  r: RespuestaEntrante
): Promise<{ respuestaId: string; accion: string | null; propietarioId: string | null }> {
  // ¿De quién es este teléfono o correo? Si no se sabe, la respuesta se
  // guarda igual: un mensaje de alguien que no está en la base es
  // justamente lo que hay que poder ver.
  const columna = r.canal === "correo" ? "email" : "telefono";
  const dueño = await db.query<{ id: string }>(
    r.canal === "correo"
      ? `SELECT id FROM propietarios WHERE lower(email) = lower($1) LIMIT 1`
      : `SELECT id FROM propietarios
          WHERE regexp_replace(COALESCE(telefono, ''), '\\D', '', 'g')
                = regexp_replace($1, '\\D', '', 'g')
          LIMIT 1`,
    [r.remitente]
  );
  void columna;
  const propietarioId = dueño.rows[0]?.id ?? null;

  const esBaja = await esPalabraDeBaja(db, tenantId, r.texto);
  const accion = esBaja && propietarioId ? "baja" : null;

  const guardada = await db.query<{ id: string }>(
    `INSERT INTO crm_respuestas (tenant_id, propietario_id, canal, remitente, texto, accion)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tenantId, propietarioId, r.canal, r.remitente, r.texto, accion]
  );

  if (propietarioId) {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "mensaje_respondido",
      propietarioId,
      origenTabla: "crm_respuestas",
      origenId: guardada.rows[0].id,
      canal: r.canal,
      resumen: r.texto.trim().slice(0, 120),
    });
  }

  if (accion === "baja" && propietarioId) {
    await registrarConsentimiento(db, tenantId, {
      propietarioId,
      canal: r.canal,
      finalidad: "promociones",
      otorgado: false,
      fuente: "respuesta_cliente",
      nota: `El cliente escribió "${r.texto.trim().slice(0, 60)}"`,
    });

    // La confirmación. Va por el mismo camino que todo: si el cliente
    // retiró las promociones, esto es un mensaje de SERVICIO —le estamos
    // confirmando algo que pidió—, no una promoción.
    await enviarMensaje(db, tenantId, {
      propietarioId,
      canal: r.canal,
      finalidad: "salud",
      tipo: "confirmacion_baja",
      texto:
        "Listo: no vas a recibir más promociones nuestras por este canal. " +
        "Los avisos de la salud de tu mascota —citas, vacunas, resultados— siguen llegando. " +
        "Si querés volver a recibir promociones, decíselo a la clínica.",
    });
  }

  return { respuestaId: guardada.rows[0].id, accion, propietarioId };
}

/**
 * Deja el correo de una notificación en el registro del CRM.
 *
 * `emitirNotificacion` manda sus correos por su propio camino —tiene sus
 * plantillas, su marca de la clínica y su tabla `correos_enviados`— y
 * este módulo no se mete en eso. Pero el TOPE y la VENTANA DE
 * DUPLICADOS cuentan sobre `crm_mensajes`, así que un correo que no
 * pasara por acá sería un mensaje que no se cuenta: dos recordatorios
 * iguales podrían salir el mismo día. Esto lo anota después de enviarlo,
 * apuntando al correo en vez de copiar su contenido.
 */
export async function anotarCorreoDeNotificacion(
  db: PoolClient,
  tenantId: string,
  datos: {
    propietarioId: string;
    pacienteId?: string | null;
    tipo: string;
    estado: "enviado" | "fallido" | "bloqueado";
    motivo?: string | null;
    correoEnviadoId?: string | null;
  }
): Promise<void> {
  const m = await guardarMensaje(db, tenantId, {
    propietarioId: datos.propietarioId,
    pacienteId: datos.pacienteId ?? null,
    canal: "correo",
    finalidad: "salud",
    tipo: datos.tipo,
    texto: "",
    estado: datos.estado,
    motivo: datos.motivo ?? null,
    correoEnviadoId: datos.correoEnviadoId ?? null,
  });
  if (datos.estado === "enviado") {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "mensaje_enviado",
      propietarioId: datos.propietarioId,
      pacienteId: datos.pacienteId ?? null,
      origenTabla: "crm_mensajes",
      origenId: m,
      canal: "correo",
      finalidad: "salud",
      resumen: datos.tipo,
    });
  }
}
