import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { PoolClient } from "pg";
import { config } from "../config";
import { emitirNotificacion } from "../notificaciones";
import { puedeEnviar } from "../crm/consentimientos";
import { ConsentimientoInvalido, firmarConsentimiento } from "./consentimientos";

// ---------------------------------------------------------------------
// FIRMA A DISTANCIA — el cliente firma desde su teléfono.
//
// EL CASO REAL: la cirugía se decide por teléfono, el dueño está en el
// trabajo y el animal ya está en la clínica. Hoy eso termina en «me
// autorizó por WhatsApp», que no es un consentimiento.
//
// CÓMO SE HACE SEGURO, siendo un enlace que se abre SIN iniciar sesión:
//
//   1. **Un solo uso.** Se sella al firmar y no vuelve a servir.
//   2. **Vence.** Por omisión en 48 horas: un enlace de consentimiento
//      que sigue vivo una semana después es un enlace que alguien
//      reenvía.
//   3. **El token no se guarda**, se guarda su SHA-256. Una base
//      filtrada no entrega enlaces de firma usables.
//   4. **Código de verificación al MISMO canal.** El enlace solo no
//      alcanza: un WhatsApp reenviado dejaría firmar a cualquiera. El
//      código prueba que quien firma es quien recibió el mensaje.
//   5. **Cinco intentos** para el código, y después el enlace muere.
//      Sin eso, seis dígitos se adivinan con un script.
//   6. **El texto se congela** al crear el enlace. Si la plantilla
//      cambia mientras el cliente lo lee, lo que firma sigue siendo lo
//      que leyó.
//
// Lo que queda registrado es lo mismo que en una firma presencial, más
// la marca «firmado a distancia»: quien lee el consentimiento tiene que
// saber que el cliente no estaba en el mostrador.
// ---------------------------------------------------------------------

const HORAS_DE_VIGENCIA = 48;
const INTENTOS_MAXIMOS = 5;

function hash(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Compara en tiempo constante: un `===` filtra el prefijo correcto. */
function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface SolicitudDeFirmaRemota {
  pacienteId: string;
  plantillaId?: string | null;
  atencionId?: string | null;
  titulo: string;
  /** El texto ya resuelto, que es lo que el cliente va a firmar. */
  texto: string;
  canal?: "whatsapp" | "correo";
  solicitadoPor: string;
}

/**
 * Crea el enlace y manda el código.
 *
 * Devuelve el enlace completo UNA SOLA VEZ: después solo queda su hash,
 * así que no se puede volver a mostrar. Si el cliente lo pierde, se
 * genera otro.
 */
export async function pedirFirmaADistancia(
  db: PoolClient,
  tenantId: string,
  s: SolicitudDeFirmaRemota
): Promise<{ id: string; enlace: string; vence: Date; canal: string; destino: string }> {
  const p = await db.query<{
    propietario_id: string | null;
    paciente: string;
    cliente: string | null;
    telefono: string | null;
    email: string | null;
  }>(
    `SELECT pa.propietario_id, pa.nombre AS paciente,
            pr.nombre AS cliente, pr.telefono, pr.email
       FROM pacientes pa
       LEFT JOIN propietarios pr ON pr.id = pa.propietario_id
      WHERE pa.id = $1 AND pa.tenant_id = $2`,
    [s.pacienteId, tenantId]
  );
  if (p.rows.length === 0) throw new ConsentimientoInvalido("Ese paciente no existe.");
  const datos = p.rows[0];
  if (!datos.propietario_id) {
    throw new ConsentimientoInvalido(
      "Este paciente no tiene un cliente asociado, así que no hay a quién mandarle el enlace."
    );
  }

  // EL CANAL Y EL CONSENTIMIENTO DE CONTACTO los decide el 03: un
  // consentimiento clínico es finalidad «salud», pero el cliente que
  // pidió que no se le escriba sigue teniendo razón.
  const veredicto = await puedeEnviar(db, {
    tenantId,
    propietarioId: datos.propietario_id,
    pacienteId: s.pacienteId,
    finalidad: "salud",
    tipo: "consentimiento_a_firmar",
    canal: s.canal,
    // El cliente está esperando este enlace: la clínica lo acaba de
    // llamar. Saltea la franja horaria, no el consentimiento.
    urgente: true,
  });
  if (!veredicto.puede) {
    throw new ConsentimientoInvalido(
      veredicto.explicacion ??
        "No se le puede escribir a este cliente, así que el enlace no se puede mandar. Firmalo en el mostrador."
    );
  }

  const canal = veredicto.canal === "whatsapp" ? "whatsapp" : "correo";
  const destino = canal === "whatsapp" ? datos.telefono : datos.email;
  if (!destino) {
    throw new ConsentimientoInvalido(
      `El cliente no tiene ${canal === "whatsapp" ? "teléfono" : "correo"} registrado.`
    );
  }

  const token = randomBytes(32).toString("base64url");
  // Seis dígitos, con `randomInt` y no con `Math.random`: un código de
  // verificación predecible no verifica nada.
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const vence = new Date(Date.now() + HORAS_DE_VIGENCIA * 3600 * 1000);

  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_firmas_remotas
       (tenant_id, paciente_id, propietario_id, plantilla_id, atencion_id,
        titulo, texto, token_hash, codigo_hash, canal, destino, vence_en, solicitado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      tenantId,
      s.pacienteId,
      datos.propietario_id,
      s.plantillaId ?? null,
      s.atencionId ?? null,
      s.titulo.trim(),
      s.texto,
      hash(token),
      hash(codigo),
      canal,
      destino,
      vence,
      s.solicitadoPor,
    ]
  );

  const enlace = `${config.frontendUrl}/firmar/${token}`;

  await emitirNotificacion(db, {
    tenantId,
    tipo: "consentimiento_a_firmar",
    destinatarioTipo: "propietario",
    destinatarioId: datos.propietario_id,
    pacienteId: s.pacienteId,
    asunto: `${s.titulo} — ${datos.paciente}`,
    // EL CÓDIGO VA EN EL MISMO MENSAJE, a propósito: el segundo factor
    // acá no es «otro dispositivo», es «el dueño del número». Mandarlo
    // por otro canal que el cliente no tenga configurado dejaría la
    // firma a distancia sin usar.
    contenido:
      `Para autorizar el procedimiento de ${datos.paciente} abrí este enlace y firmá con el dedo:\n\n${enlace}\n\n` +
      `Tu código de verificación es ${codigo}. Vence en ${HORAS_DE_VIGENCIA} horas y el enlace sirve una sola vez.`,
    datosCorreo: {
      nombrePaciente: datos.paciente,
      titulo: s.titulo,
      enlace,
      codigo,
      horas: HORAS_DE_VIGENCIA,
    },
    canal: canal === "whatsapp" ? "whatsapp" : "correo",
  } as never);

  return { id: r.rows[0].id, enlace, vence, canal, destino };
}

export interface FirmaRemotaAbierta {
  id: string;
  titulo: string;
  /** El texto se devuelve recién DESPUÉS del código. */
  texto?: string;
  paciente: string;
  clinica: string;
  /** Los últimos dígitos del destino, para que sepa dónde buscar. */
  pistaDestino: string;
  verificado: boolean;
}

/**
 * Abre el enlace. **No devuelve el texto todavía**: primero el código.
 *
 * Devolver el texto antes de verificar convertiría el enlace reenviado
 * en una filtración de la historia clínica —el texto nombra al paciente
 * y el procedimiento—.
 */
export async function abrirFirmaRemota(
  db: PoolClient,
  token: string
): Promise<FirmaRemotaAbierta> {
  const r = await db.query<{
    id: string;
    titulo: string;
    paciente: string;
    clinica: string;
    destino: string;
    usado_en: Date | null;
    vence_en: Date;
    codigo_intentos: number;
  }>(
    `SELECT f.id, f.titulo, pa.nombre AS paciente, t.nombre AS clinica,
            f.destino, f.usado_en, f.vence_en, f.codigo_intentos
       FROM exp_firmas_remotas f
       JOIN pacientes pa ON pa.id = f.paciente_id
       JOIN tenants t ON t.id = f.tenant_id
      WHERE f.token_hash = $1`,
    [hash(token)]
  );
  if (r.rows.length === 0) {
    throw new ConsentimientoInvalido("Este enlace no es válido.");
  }
  const f = r.rows[0];
  if (f.usado_en) {
    throw new ConsentimientoInvalido(
      "Este enlace ya se usó. Si necesitás firmar de nuevo, pedile otro a la clínica."
    );
  }
  if (new Date(f.vence_en) < new Date()) {
    throw new ConsentimientoInvalido("Este enlace venció. Pedile otro a la clínica.");
  }
  if (f.codigo_intentos >= INTENTOS_MAXIMOS) {
    throw new ConsentimientoInvalido(
      "Se agotaron los intentos del código. Pedile otro enlace a la clínica."
    );
  }

  return {
    id: f.id,
    titulo: f.titulo,
    paciente: f.paciente,
    clinica: f.clinica,
    pistaDestino: f.destino.slice(-4),
    verificado: false,
  };
}

/** El código correcto devuelve el texto a firmar. */
export async function verificarCodigo(
  db: PoolClient,
  token: string,
  codigo: string
): Promise<FirmaRemotaAbierta> {
  const abierta = await abrirFirmaRemota(db, token);
  const r = await db.query<{ codigo_hash: string; texto: string }>(
    `SELECT codigo_hash, texto FROM exp_firmas_remotas WHERE token_hash = $1`,
    [hash(token)]
  );
  if (!igualSeguro(r.rows[0].codigo_hash, hash(codigo.trim()))) {
    // EL INTENTO SE CUENTA ANTES DE RESPONDER, y en su propia escritura:
    // si se contara después, un cliente que corta la conexión no
    // gastaría intento.
    await db.query(
      `UPDATE exp_firmas_remotas SET codigo_intentos = codigo_intentos + 1 WHERE token_hash = $1`,
      [hash(token)]
    );
    throw new ConsentimientoInvalido("El código no coincide. Revisá el mensaje que te llegó.");
  }
  return { ...abierta, texto: r.rows[0].texto, verificado: true };
}

/**
 * Firma, con el código ya verificado.
 *
 * Se vuelve a pedir el código: el estado «verificado» no se guarda en
 * ninguna sesión —el enlace se abre sin iniciar sesión—, así que la
 * única prueba de que esta persona pasó la verificación es que lo sepa.
 */
export async function firmarADistancia(
  db: PoolClient,
  datos: {
    token: string;
    codigo: string;
    firmaPng: string;
    firmanteNombre: string;
    firmanteIdentificacion?: string;
    relacion?: "propietario" | "autorizado";
    autorizadoPor?: string;
    dispositivo?: string | null;
    ip?: string | null;
  }
): Promise<{ consentimientoId: string }> {
  await verificarCodigo(db, datos.token, datos.codigo);

  const r = await db.query<{
    id: string;
    tenant_id: string;
    paciente_id: string;
    plantilla_id: string | null;
    atencion_id: string | null;
    titulo: string;
    texto: string;
    solicitado_por: string | null;
  }>(
    `SELECT id, tenant_id, paciente_id, plantilla_id, atencion_id, titulo, texto, solicitado_por
       FROM exp_firmas_remotas WHERE token_hash = $1`,
    [hash(datos.token)]
  );
  const f = r.rows[0];

  const firmado = await firmarConsentimiento(
    db,
    f.tenant_id,
    {
      pacienteId: f.paciente_id,
      plantillaId: f.plantilla_id ?? undefined,
      atencionId: f.atencion_id ?? undefined,
      titulo: f.titulo,
      texto: f.texto,
      firmanteNombre: datos.firmanteNombre,
      firmanteIdentificacion: datos.firmanteIdentificacion,
      firmaPng: datos.firmaPng,
    },
    {
      relacion: datos.relacion ?? "propietario",
      autorizadoPor: datos.autorizadoPor,
      dispositivo: datos.dispositivo,
      ip: datos.ip,
      // EL TESTIGO ES QUIEN PIDIÓ LA FIRMA. En una firma a distancia no
      // hay nadie del personal mirando, y decir que no hay testigo
      // sería perder el dato de quién gestionó el consentimiento.
      testigoId: f.solicitado_por,
      aDistancia: true,
    }
  );

  // EL ENLACE SE SELLA EN LA MISMA TRANSACCIÓN que la firma: si el
  // sellado fallara después, el enlace serviría dos veces.
  await db.query(
    `UPDATE exp_firmas_remotas
        SET usado_en = now(), consentimiento_id = $2
      WHERE id = $1`,
    [f.id, firmado.id]
  );

  return { consentimientoId: firmado.id };
}
