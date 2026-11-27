import { Pool, PoolClient } from "pg";
import { registrarInteraccion } from "./interacciones";

// ---------------------------------------------------------------------
// CONSENTIMIENTOS, PREFERENCIAS Y EL PUNTO ÚNICO ANTES DE ENVIAR
// — prompt 03, secciones 4 y 5.
//
// `puedeEnviar` es la pregunta que TODO envío hace antes de salir. No
// devuelve un booleano: devuelve el motivo, porque "no se envió" sin
// motivo es un reclamo que nadie puede contestar. Y cuando el problema
// es la hora, devuelve CUÁNDO sí se puede: la diferencia entre no
// mandarlo y mandarlo a las ocho de la mañana.
//
// LAS DOS FINALIDADES NO SE MEZCLAN. «salud» es lo que la clínica le
// debe al cliente —su cita, su vacuna, su comprobante—; «promociones» es
// lo que la clínica quiere venderle. El tope mensual y el consentimiento
// se aplican distinto a cada una, y confundirlas sería mandarle ofertas
// a quien solo pidió el recordatorio de la vacuna.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export type Canal = "correo" | "whatsapp";
export type Finalidad = "salud" | "promociones";

export interface Politicas {
  horaDesde: string;
  horaHasta: string;
  topePromocionesMes: number;
  ventanaDuplicadoHoras: number;
}

const POLITICAS_POR_DEFECTO: Politicas = {
  horaDesde: "08:00",
  horaHasta: "20:00",
  topePromocionesMes: 4,
  ventanaDuplicadoHoras: 48,
};

export async function politicas(db: EjecutorSql, tenantId: string): Promise<Politicas> {
  const r = await db.query<{
    hora_desde: string;
    hora_hasta: string;
    tope_promociones_mes: number;
    ventana_duplicado_horas: number;
  }>(
    `SELECT hora_desde::text, hora_hasta::text, tope_promociones_mes, ventana_duplicado_horas
       FROM crm_politicas WHERE tenant_id = $1`,
    [tenantId]
  );
  if (r.rows.length === 0) return POLITICAS_POR_DEFECTO;
  return {
    horaDesde: r.rows[0].hora_desde.slice(0, 5),
    horaHasta: r.rows[0].hora_hasta.slice(0, 5),
    topePromocionesMes: Number(r.rows[0].tope_promociones_mes),
    ventanaDuplicadoHoras: Number(r.rows[0].ventana_duplicado_horas),
  };
}

export async function guardarPoliticas(
  db: PoolClient,
  tenantId: string,
  p: Partial<Politicas>
): Promise<void> {
  const actual = await politicas(db, tenantId);
  const nueva = { ...actual, ...p };
  await db.query(
    `INSERT INTO crm_politicas (tenant_id, hora_desde, hora_hasta, tope_promociones_mes,
                                ventana_duplicado_horas)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id) DO UPDATE
       SET hora_desde = EXCLUDED.hora_desde,
           hora_hasta = EXCLUDED.hora_hasta,
           tope_promociones_mes = EXCLUDED.tope_promociones_mes,
           ventana_duplicado_horas = EXCLUDED.ventana_duplicado_horas,
           actualizado_en = now()`,
    [
      tenantId,
      nueva.horaDesde,
      nueva.horaHasta,
      nueva.topePromocionesMes,
      nueva.ventanaDuplicadoHoras,
    ]
  );
}

// ---------------------------------------------------------------------
// Consentimientos
// ---------------------------------------------------------------------

export interface Consentimiento {
  canal: Canal;
  finalidad: Finalidad;
  otorgado: boolean;
  actualizado_en: string;
}

export async function consentimientosDe(
  db: EjecutorSql,
  propietarioId: string
): Promise<Consentimiento[]> {
  const r = await db.query<Consentimiento>(
    `SELECT canal, finalidad, otorgado, actualizado_en
       FROM crm_consentimientos WHERE propietario_id = $1
      ORDER BY canal, finalidad`,
    [propietarioId]
  );
  return r.rows;
}

export async function historialDe(
  db: PoolClient,
  propietarioId: string
): Promise<
  Array<{
    canal: string;
    finalidad: string;
    otorgado: boolean;
    fuente: string;
    nota: string | null;
    creado_en: string;
    registrado_por_nombre: string | null;
  }>
> {
  const r = await db.query(
    `SELECT h.canal, h.finalidad, h.otorgado, h.fuente, h.nota, h.creado_en,
            p.nombre AS registrado_por_nombre
       FROM crm_consentimiento_historial h
       LEFT JOIN personas p ON p.id = h.registrado_por
      -- EL HISTORIAL DEL QUE SOBREVIVIÓ INCLUYE EL DE LOS ABSORBIDOS
      -- (anexo 07-03, B1). Esta tabla prohíbe UPDATE: las filas del
      -- absorbido no se mueven, se leen. Y hacen falta justamente acá:
      -- es la prueba de qué autorizó el cliente y cuándo, y una fusión
      -- no puede hacerla desaparecer de la pantalla.
      WHERE h.propietario_id IN (
              WITH RECURSIVE absorbidos AS (
                SELECT id FROM propietarios WHERE id = $1
                UNION
                SELECT t.id FROM propietarios t
                  JOIN absorbidos a ON t.unificado_hacia_id = a.id
              ) SELECT id FROM absorbidos
            )
      ORDER BY h.creado_en DESC`,
    [propietarioId]
  );
  return r.rows;
}

/**
 * Cambia un consentimiento y DEJA SU HUELLA.
 *
 * El historial no es un lujo de auditoría: es la respuesta a "yo nunca
 * autoricé esto". Por eso el valor actual y el historial se escriben en
 * la misma operación, y el historial no se puede editar.
 */
export async function registrarConsentimiento(
  db: PoolClient,
  tenantId: string,
  datos: {
    propietarioId: string;
    canal: Canal;
    finalidad: Finalidad;
    otorgado: boolean;
    fuente: "registro"
      | "recepcion"
      | "respuesta_cliente"
      | "importacion"
      | "existente_al_habilitar"
      /* Lo trajo una fusión de fichas duplicadas (anexo 07-03, B1). */
      | "unificacion";
    personaId?: string;
    nota?: string;
  }
): Promise<{ cambio: boolean }> {
  const antes = await db.query<{ otorgado: boolean }>(
    `SELECT otorgado FROM crm_consentimientos
      WHERE propietario_id = $1 AND canal = $2 AND finalidad = $3`,
    [datos.propietarioId, datos.canal, datos.finalidad]
  );
  const mismo = antes.rows.length > 0 && antes.rows[0].otorgado === datos.otorgado;

  await db.query(
    `INSERT INTO crm_consentimientos (tenant_id, propietario_id, canal, finalidad, otorgado)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (propietario_id, canal, finalidad)
       DO UPDATE SET otorgado = EXCLUDED.otorgado, actualizado_en = now()`,
    [tenantId, datos.propietarioId, datos.canal, datos.finalidad, datos.otorgado]
  );

  // Si el valor no cambió, no se escribe historial: diez filas iguales
  // no son una prueba más fuerte, son ruido que tapa el cambio real.
  if (mismo) return { cambio: false };

  const h = await db.query<{ id: string }>(
    `INSERT INTO crm_consentimiento_historial
       (tenant_id, propietario_id, canal, finalidad, otorgado, fuente, registrado_por, nota)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      tenantId,
      datos.propietarioId,
      datos.canal,
      datos.finalidad,
      datos.otorgado,
      datos.fuente,
      datos.personaId ?? null,
      datos.nota ?? null,
    ]
  );

  await registrarInteraccion(db, {
    tenantId,
    tipo: "consentimiento_cambiado",
    propietarioId: datos.propietarioId,
    origenTabla: "crm_consentimiento_historial",
    origenId: h.rows[0].id,
    personaId: datos.personaId ?? null,
    canal: datos.canal,
    finalidad: datos.finalidad,
    resumen: `${datos.otorgado ? "Autorizó" : "Retiró"} ${datos.finalidad} por ${datos.canal}`,
  });

  return { cambio: true };
}

export async function preferenciasDe(
  db: EjecutorSql,
  propietarioId: string
): Promise<{ canalPreferido: Canal | null; horaDesde: string | null; horaHasta: string | null }> {
  const r = await db.query<{
    canal_preferido: Canal | null;
    hora_desde: string | null;
    hora_hasta: string | null;
  }>(
    `SELECT canal_preferido, hora_desde::text, hora_hasta::text
       FROM crm_preferencias_contacto WHERE propietario_id = $1`,
    [propietarioId]
  );
  return {
    canalPreferido: r.rows[0]?.canal_preferido ?? null,
    horaDesde: r.rows[0]?.hora_desde?.slice(0, 5) ?? null,
    horaHasta: r.rows[0]?.hora_hasta?.slice(0, 5) ?? null,
  };
}

export async function guardarPreferencias(
  db: PoolClient,
  tenantId: string,
  propietarioId: string,
  p: { canalPreferido?: Canal | null; horaDesde?: string | null; horaHasta?: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO crm_preferencias_contacto
       (propietario_id, tenant_id, canal_preferido, hora_desde, hora_hasta)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (propietario_id) DO UPDATE
       SET canal_preferido = EXCLUDED.canal_preferido,
           hora_desde = EXCLUDED.hora_desde,
           hora_hasta = EXCLUDED.hora_hasta,
           actualizado_en = now()`,
    [
      propietarioId,
      tenantId,
      p.canalPreferido ?? null,
      p.horaDesde ?? null,
      p.horaHasta ?? null,
    ]
  );
}

// ---------------------------------------------------------------------
// EL PUNTO ÚNICO ANTES DE ENVIAR
// ---------------------------------------------------------------------

export type MotivoBloqueo =
  | "sin_consentimiento"
  /* Cubre los cuatro estados de baja, no solo el fallecimiento: se
     llamaba `mascota_fallecida` cuando ése era el único que existía
     (anexo del 07, A5). */
  | "mascota_de_baja"
  | "sin_contacto"
  | "fuera_de_horario"
  | "tope_promociones"
  | "duplicado"
  | "paciente_delicado";

export interface Veredicto {
  puede: boolean;
  motivo?: MotivoBloqueo;
  /** Para decírselo a una persona. */
  explicacion?: string;
  /** Cuando el problema es la hora: a partir de cuándo sí. */
  reprogramarPara?: Date;
  /** El canal que corresponde usar, resuelto por preferencia. */
  canal: Canal;
  /**
   * Se usó un canal distinto del preferido del cliente, porque el
   * preferido no estaba consentido o no tenía un dato de contacto
   * válido. La ficha lo advierte (anexo 07-03, B4).
   */
  canalAlternativo?: boolean;
  /** El dato de contacto al que iría. */
  destino?: string;
}

export interface SolicitudEnvio {
  tenantId: string;
  propietarioId: string;
  pacienteId?: string | null;
  canal?: Canal;
  finalidad: Finalidad;
  /** Para la ventana de duplicados. */
  tipo: string;
  /** Para probar la franja horaria sin esperar a mañana. */
  ahora?: Date;
}

/**
 * EL ORDEN EN QUE SE INTENTAN LOS CANALES — anexo 07-03, B4.
 *
 * Primero el que pidió quien llama (si lo pidió), después el preferido
 * del cliente, después el resto. El correo va último del resto porque
 * es el que toda clínica tiene configurado: es el que siempre funciona,
 * no el que el cliente eligió.
 */
function ordenDeCanales(pedido: Canal | undefined, preferido: Canal | null): Canal[] {
  const todos: Canal[] = ["whatsapp", "correo"];
  // Un canal pedido explícitamente NO se cambia: el que llama sabe por
  // qué lo pidió (una respuesta a un WhatsApp, por ejemplo).
  if (pedido) return [pedido];
  const orden = preferido ? [preferido, ...todos.filter((c) => c !== preferido)] : todos;
  return orden;
}

export async function puedeEnviar(db: EjecutorSql, s: SolicitudEnvio): Promise<Veredicto> {
  const pol = await politicas(db, s.tenantId);
  const pref = await preferenciasDe(db, s.propietarioId);

  // EL CANAL PREFERIDO ORDENA, NO HABILITA (anexo 07-03, B4).
  //
  // Antes era un fallback de una sola oportunidad: `pedido ?? preferido
  // ?? "correo"`, y si ese canal no estaba consentido, cortaba con
  // `sin_consentimiento` aunque el cliente sí hubiera consentido el
  // otro. Ahora se recorren los consentidos en orden y se usa el
  // primero que sirve; el preferido nunca habilita un envío que el
  // cliente no autorizó.
  const candidatos = ordenDeCanales(s.canal, pref.canalPreferido);
  let mejorRechazo: Veredicto | null = null;

  for (const canal of candidatos) {
    const veredicto = await evaluarCanal(db, s, pol, pref, canal);
    if (veredicto.puede || veredicto.motivo === "mascota_de_baja") {
      // Un bloqueo que NO depende del canal —la mascota de baja, el
      // cliente que no existe— no mejora probando otro: se devuelve ya.
      return {
        ...veredicto,
        canalAlternativo: veredicto.puede && canal !== (pref.canalPreferido ?? candidatos[0]),
      };
    }
    if (!mejorRechazo || etapaAlcanzada(veredicto.motivo) > etapaAlcanzada(mejorRechazo.motivo)) {
      mejorRechazo = veredicto;
    }
  }

  // NINGÚN CANAL SIRVIÓ: se devuelve el rechazo del canal que LLEGÓ MÁS
  // LEJOS, no el del preferido.
  //
  // Esto no es cosmético y costó un defecto propio en la verificación:
  // con el cliente que prefiere WhatsApp sin consentirlo y tiene el
  // correo consentido a las 23:46, el correo falla solo por la franja
  // horaria y devuelve `reprogramarPara`. Devolver en su lugar el
  // `sin_consentimiento` del WhatsApp le hacía perder al que llama el
  // único motivo sobre el que PUEDE actuar: el envío se descartaba en
  // vez de reprogramarse a las 08:00.
  return mejorRechazo!;
}

/**
 * Hasta qué control llegó un canal antes de que lo frenaran.
 *
 * Es el orden de los seis controles de `evaluarCanal`, y nada más: a
 * mayor etapa, más cerca estuvo de salir y más informativo es el
 * motivo. No es una escala de gravedad.
 */
function etapaAlcanzada(motivo: MotivoBloqueo | undefined): number {
  switch (motivo) {
    case "sin_consentimiento":
      return 2;
    case "sin_contacto":
      return 3;
    case "duplicado":
      return 4;
    case "tope_promociones":
      return 5;
    case "fuera_de_horario":
      return 6;
    default:
      return 1;
  }
}

async function evaluarCanal(
  db: EjecutorSql,
  s: SolicitudEnvio,
  pol: Awaited<ReturnType<typeof politicas>>,
  pref: Awaited<ReturnType<typeof preferenciasDe>>,
  canal: Canal
): Promise<Veredicto> {

  const cliente = await db.query<{
    email: string | null;
    telefono: string | null;
    nombre: string;
  }>(`SELECT email, telefono, nombre FROM propietarios WHERE id = $1`, [s.propietarioId]);
  if (cliente.rows.length === 0) {
    return { puede: false, motivo: "sin_contacto", explicacion: "Ese cliente no existe.", canal };
  }

  // 1. LA MASCOTA DADA DE BAJA. Primero que todo lo demás: ningún
  //    mensaje sobre una mascota muerta tiene una versión aceptable, ni
  //    siquiera uno de salud. Ya costó una corrección antes.
  //
  //    EL CHEQUEO ES «no está activa», no «está fallecida». Nació
  //    mirando solo 'fallecido', que era el único estado de baja que
  //    existía; la migración 111 agregó extraviado, transferido y
  //    baja_otro, y el chequeo quedó atrás: a un paciente transferido a
  //    otra clínica le seguía saliendo la receta por correo. Las otras
  //    dos capas (el SQL del job y los tres avisos por hecho) ya filtran
  //    por `estado = 'activo'`; ésta era la que no.
  if (s.pacienteId) {
    const p = await db.query<{ estado: string; nombre: string }>(
      `SELECT estado, nombre FROM pacientes WHERE id = $1`,
      [s.pacienteId]
    );
    const estadoPaciente = p.rows[0]?.estado;
    if (estadoPaciente && estadoPaciente !== "activo") {
      const comoSeLlama: Record<string, string> = {
        fallecido: "registrada como fallecida",
        extraviado: "registrada como extraviada",
        transferido: "transferida a otra clínica",
        baja_otro: "dada de baja",
      };
      return {
        puede: false,
        motivo: "mascota_de_baja",
        explicacion: `${p.rows[0].nombre} está ${comoSeLlama[estadoPaciente] ?? "dada de baja"}: no sale ningún mensaje sobre ella.`,
        canal,
      };
    }
    // El lugar preparado para «hospitalizada o en tratamiento delicado»:
    // ese estado todavía no existe en `pacientes`, y cuando exista se
    // decide acá, en el mismo punto, sin tocar a los que llaman.
  }

  // 2. EL CONSENTIMIENTO para ese canal y esa finalidad.
  //
  // QUÉ PASA CUANDO NO HAY FILA, que es la decisión más delicada de
  // este punto:
  //
  //   * PROMOCIONES: sin fila, NO. Es opt-in; nadie autorizó nada.
  //   * SALUD Y SERVICIO: sin fila, SÍ. Es el aviso de la cita que el
  //     cliente pidió, de la vacuna de su perro, de su comprobante: lo
  //     que la clínica le debe por ser su cliente. La clínica ya se los
  //     manda hoy, y el prompt es explícito en que eso tiene que seguir
  //     saliendo igual. Un cliente que NO los quiere queda con la fila
  //     en `false` —eso sí bloquea— y es lo que la recepción marca
  //     cuando el cliente lo pide.
  //
  // Los clientes que ya existían tienen su fila explícita, puesta por
  // la reconstrucción con fuente `existente_al_habilitar`: la regla de
  // arriba es para el cliente que se crea desde cualquier otro camino,
  // no para tapar la falta del registro.
  const c = await db.query<{ otorgado: boolean }>(
    `SELECT otorgado FROM crm_consentimientos
      WHERE propietario_id = $1 AND canal = $2 AND finalidad = $3`,
    [s.propietarioId, canal, s.finalidad]
  );
  const otorgado =
    c.rows.length > 0 ? c.rows[0].otorgado : s.finalidad === "salud";
  if (!otorgado) {
    return {
      puede: false,
      motivo: "sin_consentimiento",
      explicacion: `${cliente.rows[0].nombre} no autorizó ${s.finalidad} por ${canal}.`,
      canal,
    };
  }

  // 3. UN DATO DE CONTACTO VÁLIDO para ese canal.
  const destino = canal === "correo" ? cliente.rows[0].email : cliente.rows[0].telefono;
  if (!destino || !contactoValido(canal, destino)) {
    return {
      puede: false,
      motivo: "sin_contacto",
      explicacion: `${cliente.rows[0].nombre} no tiene ${canal === "correo" ? "un correo" : "un teléfono"} válido.`,
      canal,
    };
  }

  // 4. SIN DUPLICADOS en la ventana: el mismo tipo de mensaje sobre la
  //    misma mascota no sale dos veces.
  const dup = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM crm_mensajes
      WHERE propietario_id = $1 AND tipo = $2 AND estado = 'enviado'
        AND ($3::uuid IS NULL OR paciente_id = $3)
        AND creado_en > now() - ($4 || ' hours')::interval`,
    [s.propietarioId, s.tipo, s.pacienteId ?? null, pol.ventanaDuplicadoHoras]
  );
  if (Number(dup.rows[0].n) > 0) {
    return {
      puede: false,
      motivo: "duplicado",
      explicacion: `Ya salió un "${s.tipo}" en las últimas ${pol.ventanaDuplicadoHoras} horas.`,
      canal,
      destino,
    };
  }

  // 5. EL TOPE DE PROMOCIONES del mes. Los de salud no cuentan: son los
  //    que la clínica le debe al cliente.
  if (s.finalidad === "promociones") {
    const enviados = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM crm_mensajes
        WHERE propietario_id = $1 AND finalidad = 'promociones' AND estado = 'enviado'
          AND creado_en >= date_trunc('month', now())`,
      [s.propietarioId]
    );
    if (Number(enviados.rows[0].n) >= pol.topePromocionesMes) {
      return {
        puede: false,
        motivo: "tope_promociones",
        explicacion: `Ya se le mandaron ${enviados.rows[0].n} promociones este mes y el tope es ${pol.topePromocionesMes}.`,
        canal,
        destino,
      };
    }
  }

  // 6. LA FRANJA HORARIA. Acá no se bloquea: se reprograma. Un
  //    recordatorio de la cita de mañana que se descarta porque son las
  //    21:05 es un recordatorio perdido; a las 8:00 sirve igual.
  const ahora = s.ahora ?? new Date();
  const desde = pref.horaDesde ?? pol.horaDesde;
  const hasta = pref.horaHasta ?? pol.horaHasta;
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  const minDesde = aMinutos(desde);
  const minHasta = aMinutos(hasta);
  if (minutos < minDesde || minutos >= minHasta) {
    const proximo = new Date(ahora);
    if (minutos >= minHasta) proximo.setDate(proximo.getDate() + 1);
    proximo.setHours(Math.floor(minDesde / 60), minDesde % 60, 0, 0);
    return {
      puede: false,
      motivo: "fuera_de_horario",
      explicacion: `Fuera de la franja ${desde}–${hasta}. Se manda a las ${desde}.`,
      reprogramarPara: proximo,
      canal,
      destino,
    };
  }

  return { puede: true, canal, destino };
}

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Un contacto "válido" acá es mínimo a propósito: que tenga forma de
 * correo o de teléfono. Validar de verdad un correo es imposible sin
 * mandarlo, y el rebote ya se registra en `correos_enviados`. Lo que
 * esto evita es el caso real: el campo vacío, el "n/a", el "sin correo".
 */
function contactoValido(canal: Canal, destino: string): boolean {
  const limpio = destino.trim();
  if (canal === "correo") return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(limpio);
  // Teléfono: al menos 8 dígitos, que es el largo de Costa Rica.
  return limpio.replace(/\D/g, "").length >= 8;
}

// ---------------------------------------------------------------------
// LA BAJA CON UNA PALABRA
//
// Si el cliente contesta "BAJA", se retira el consentimiento de
// PROMOCIONES de ese canal —no el de salud: nadie que escribe "baja"
// está renunciando a que le avisen de la vacuna de su perro—. Queda en
// el historial, en la línea de tiempo, y se le confirma.
// ---------------------------------------------------------------------

export async function esPalabraDeBaja(
  db: EjecutorSql,
  tenantId: string,
  texto: string
): Promise<boolean> {
  const limpio = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const r = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM crm_palabras_baja
      WHERE (tenant_id IS NULL OR tenant_id = $1) AND palabra = $2`,
    [tenantId, limpio]
  );
  return Number(r.rows[0].n) > 0;
}
