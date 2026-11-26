// Verificación de la BASE DEL CRM (prompt 03).
//
//   docker compose exec backend npx ts-node src/scripts/verificar_crm.ts
//
// SIN --transpile-only a propósito.
//
// Lo que el prompt pide verificar:
//
//   * la reconstrucción crea los eventos con su FECHA REAL, coincide con
//     los orígenes y una segunda corrida no duplica nada;
//   * crear una cita, cerrar una atención, emitir un comprobante y
//     cobrar generan su evento EN LA MISMA TRANSACCIÓN; si el origen se
//     revierte, el evento tampoco queda;
//   * un mismo origen no genera dos eventos del mismo tipo;
//   * `puedeEnviar` bloquea con su motivo: promoción sin consentimiento,
//     cualquier mensaje sobre una mascota fallecida, cliente sin
//     contacto válido, fuera de horario (reprogramado), tope de
//     promociones superado y duplicado en la ventana; y deja pasar un
//     recordatorio de salud con consentimiento;
//   * una respuesta "BAJA" retira las promociones y queda registrada;
//   * la línea de tiempo del expediente y la del CRM muestran lo mismo;
//   * RLS: nada de otra clínica.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import {
  agregarNota,
  lineaDeInteracciones,
  registrarInteraccion,
} from "../crm/interacciones";
import {
  consentimientosDe,
  guardarPoliticas,
  historialDe,
  politicas,
  puedeEnviar,
  registrarConsentimiento,
} from "../crm/consentimientos";
import { enviarMensaje, recibirRespuesta } from "../crm/mensajeria";
import { reconstruirHistorial } from "../crm/reconstruccion";
import { lineaDeTiempo } from "../expediente/resumen";
import { crearCita } from "../routes/citas.routes";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-crm";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

let tenantId = "";
let otroTenantId = "";
let medicoId = "";
let clienteId = "";
let clienteSinCorreo = "";
let pacienteId = "";
let pacienteMuerto = "";

async function main() {
  exigirEntornoDeDesarrollo("verificar_crm");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  // -------------------------------------------------------------------
  console.log("=== 0. Clínica con un cliente, dos mascotas y algo de historia ===");
  tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@crm.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  otroTenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','otra@crm.test','CR') RETURNING id`,
      [`${PREFIJO}-otra`]
    )
  ).rows[0].id;

  // Ningún correo real: la creación de una cita avisa al propietario.
  await pool.query(
    `INSERT INTO configuracion_notificaciones
       (tenant_id, confirmacion_cita_activo, recordatorio_cita_activo)
     VALUES ($1,false,false)`,
    [tenantId]
  );

  medicoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica,
                             colegiatura)
       VALUES ($1,'Dra. Laura Méndez',$2,'x',true,true,'VET-7788') RETURNING id`,
      [tenantId, `${PREFIJO}-medico@probe.test`]
    )
  ).rows[0].id;
  clienteId = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, email, telefono)
       VALUES ($1,'Don Luis',$2,'88887777') RETURNING id`,
      [tenantId, `${PREFIJO}-luis@probe.invalid`]
    )
  ).rows[0].id;
  clienteSinCorreo = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, telefono) VALUES ($1,'Sin Correo','')
       RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  pacienteId = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie)
       VALUES ($1,$2,1,'Toby','Canino') RETURNING id`,
      [tenantId, clienteId]
    )
  ).rows[0].id;
  pacienteMuerto = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie,
                              estado, fecha_fallecimiento)
       VALUES ($1,$2,2,'Nube','Felino','fallecido',CURRENT_DATE - 10) RETURNING id`,
      [tenantId, clienteId]
    )
  ).rows[0].id;

  // Historia ANTERIOR al CRM: una cita vieja y una atención vieja,
  // insertadas directo para que no tengan evento.
  const citaVieja = (
    await pool.query<{ id: string }>(
      `INSERT INTO citas (tenant_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin,
                          duracion_minutos, motivo_consulta, estado, creado_en)
       VALUES ($1,$2,$3,CURRENT_DATE - 200,'10:00','10:30',30,'Consulta de marzo','completada',
               now() - interval '200 days')
       RETURNING id`,
      [tenantId, pacienteId, medicoId]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO atenciones (tenant_id, cita_id, paciente_id, medico_id, nota_medica, estado,
                             cerrada_en, creado_en)
     VALUES ($1,$2,$3,$4,'Gastroenteritis leve.','cerrada', now() - interval '200 days',
             now() - interval '200 days')`,
    [tenantId, citaVieja, pacienteId, medicoId]
  );
  assert(!!pacienteId, "clínica, médico, dos clientes, dos mascotas y una visita vieja");

  // -------------------------------------------------------------------
  console.log("\n=== 1. La reconstrucción, con la fecha REAL ===");
  const r1 = await conAlcanceTenant(tenantId, (db) => reconstruirHistorial(db, tenantId));
  assert(r1.total > 0, "la primera corrida crea eventos", r1.porTipo);
  igual(
    [r1.porTipo.cita_agendada, r1.porTipo.atencion_cerrada, r1.porTipo.cliente_registrado],
    [1, 1, 2],
    "una cita, una atención y los dos clientes"
  );

  const fechaEvento = await pool.query<{ dias: string }>(
    `SELECT round(extract(epoch from (now() - ocurrido_en)) / 86400) AS dias
       FROM crm_interacciones
      WHERE tenant_id = $1 AND tipo = 'atencion_cerrada'`,
    [tenantId]
  );
  igual(
    Number(fechaEvento.rows[0].dias),
    200,
    "el evento de la visita vieja tiene la fecha de HACE 200 DÍAS, no la de hoy"
  );

  const r2 = await conAlcanceTenant(tenantId, (db) => reconstruirHistorial(db, tenantId));
  igual(r2.total, 0, "la segunda corrida no duplica NADA");
  assert(
    r2.consentimientosCreados === 0,
    "ni vuelve a registrar los consentimientos",
    r2.consentimientosCreados
  );

  const consent = await conAlcanceTenant(tenantId, (db) => consentimientosDe(db, clienteId));
  igual(
    consent.filter((c) => c.canal === "correo").map((c) => `${c.finalidad}:${c.otorgado}`),
    ["promociones:false", "salud:true"],
    "el cliente que ya existía quedó con SALUD por correo y sin promociones"
  );
  const hist = await conAlcanceTenant(tenantId, (db) => historialDe(db, clienteId));
  assert(
    hist.length === 4 && hist.every((h) => h.fuente === "existente_al_habilitar"),
    "y su historial dice de dónde salió ese consentimiento",
    hist.map((h) => `${h.canal}/${h.finalidad}=${h.otorgado}`)
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. El evento va en la MISMA transacción que el origen ===");
  //
  // Se abre una transacción, se crea una cita y se hace ROLLBACK. Si el
  // evento estuviera fuera de la transacción, quedaría un evento sin
  // cita: la línea de tiempo diría que pasó algo que no pasó.
  const cliente = await pool.connect();
  let citaFantasma = "";
  try {
    await cliente.query("BEGIN");
    await cliente.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const creada = await crearCita(cliente, tenantId, {
      pacienteId,
      medicoId,
      fecha: new Date().toISOString().slice(0, 10),
      horaInicio: "15:00",
      duracionMinutos: 30,
      motivoConsulta: "Esta cita se va a revertir",
    });
    citaFantasma = creada.cita.id;
    const dentro = await cliente.query<{ n: string }>(
      `SELECT count(*) AS n FROM crm_interacciones WHERE origen_id = $1`,
      [citaFantasma]
    );
    igual(dentro.rows[0].n, "1", "dentro de la transacción, la cita tiene su evento");
    await cliente.query("ROLLBACK");
  } finally {
    cliente.release();
  }

  const despuesDelRollback = await pool.query<{ citas: string; eventos: string }>(
    `SELECT (SELECT count(*) FROM citas WHERE id = $1) AS citas,
            (SELECT count(*) FROM crm_interacciones WHERE origen_id = $1) AS eventos`,
    [citaFantasma]
  );
  igual(
    [despuesDelRollback.rows[0].citas, despuesDelRollback.rows[0].eventos],
    ["0", "0"],
    "después del rollback no queda ni la cita NI su evento"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. Un mismo origen no genera dos eventos del mismo tipo ===");
  const citaReal = await conAlcanceTenant(tenantId, (db) =>
    crearCita(db, tenantId, {
      pacienteId,
      medicoId,
      fecha: new Date().toISOString().slice(0, 10),
      horaInicio: "16:00",
      duracionMinutos: 30,
      motivoConsulta: "Control",
    })
  );
  // Dos intentos más del mismo evento: el segundo y el tercero no
  // insertan nada.
  for (let i = 0; i < 2; i++) {
    await conAlcanceTenant(tenantId, (db) =>
      registrarInteraccion(db, {
        tenantId,
        tipo: "cita_agendada",
        pacienteId,
        origenTabla: "citas",
        origenId: citaReal.cita.id,
      })
    );
  }
  const cuantos = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM crm_interacciones
      WHERE tipo = 'cita_agendada' AND origen_id = $1`,
    [citaReal.cita.id]
  );
  igual(cuantos.rows[0].n, "1", "tres intentos, un solo evento");

  // -------------------------------------------------------------------
  console.log("\n=== 4. La línea de tiempo solo se agrega ===");
  const unEvento = await pool.query<{ id: string }>(
    `SELECT id FROM crm_interacciones WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  for (const [que, sql] of [
    ["editar un evento", `UPDATE crm_interacciones SET resumen = 'otra cosa' WHERE id = $1`],
    ["borrar un evento", `DELETE FROM crm_interacciones WHERE id = $1`],
  ] as const) {
    try {
      await pool.query(sql, [unEvento.rows[0].id]);
      assert(false, `${que} — NO falló, y tenía que fallar`);
    } catch (err) {
      assert(true, `${que} — rechazado`, (err as Error).message.slice(0, 90));
    }
  }

  // -------------------------------------------------------------------
  console.log("\n=== 5. puedeEnviar: lo que deja pasar y lo que bloquea ===");
  const manana = new Date();
  manana.setHours(10, 0, 0, 0);

  const salud = await conAlcanceTenant(tenantId, (db) =>
    puedeEnviar(db, {
      tenantId,
      propietarioId: clienteId,
      pacienteId,
      finalidad: "salud",
      tipo: "recordatorio_cita",
      ahora: manana,
    })
  );
  assert(salud.puede, "un recordatorio de SALUD con consentimiento pasa", salud);

  const promo = await conAlcanceTenant(tenantId, (db) =>
    puedeEnviar(db, {
      tenantId,
      propietarioId: clienteId,
      finalidad: "promociones",
      tipo: "campana",
      ahora: manana,
    })
  );
  igual(promo.motivo, "sin_consentimiento", "una PROMOCIÓN sin consentimiento se bloquea");

  const sobreMuerta = await conAlcanceTenant(tenantId, (db) =>
    puedeEnviar(db, {
      tenantId,
      propietarioId: clienteId,
      pacienteId: pacienteMuerto,
      finalidad: "salud",
      tipo: "vacunacion_proxima",
      ahora: manana,
    })
  );
  igual(
    sobreMuerta.motivo,
    "mascota_fallecida",
    "NINGÚN mensaje sobre una mascota fallecida, ni siquiera de salud"
  );

  const sinContacto = await conAlcanceTenant(tenantId, (db) =>
    puedeEnviar(db, {
      tenantId,
      propietarioId: clienteSinCorreo,
      finalidad: "salud",
      tipo: "recordatorio_cita",
      ahora: manana,
    })
  );
  igual(sinContacto.motivo, "sin_contacto", "un cliente sin correo válido se bloquea");

  const deNoche = new Date();
  deNoche.setHours(23, 30, 0, 0);
  const fueraDeHora = await conAlcanceTenant(tenantId, (db) =>
    puedeEnviar(db, {
      tenantId,
      propietarioId: clienteId,
      finalidad: "salud",
      tipo: "recordatorio_cita",
      ahora: deNoche,
    })
  );
  igual(fueraDeHora.motivo, "fuera_de_horario", "a las 23:30 no sale");
  assert(
    !!fueraDeHora.reprogramarPara && fueraDeHora.reprogramarPara.getHours() === 8,
    "y se REPROGRAMA para las 8:00 del día siguiente, no se descarta",
    fueraDeHora.reprogramarPara?.toISOString()
  );

  // -------------------------------------------------------------------
  console.log("\n=== 6. El tope de promociones y la ventana de duplicados ===");
  await conAlcanceTenant(tenantId, (db) =>
    registrarConsentimiento(db, tenantId, {
      propietarioId: clienteId,
      canal: "whatsapp",
      finalidad: "promociones",
      otorgado: true,
      fuente: "recepcion",
      personaId: medicoId,
    })
  );
  await conAlcanceTenant(tenantId, (db) =>
    registrarConsentimiento(db, tenantId, {
      propietarioId: clienteId,
      canal: "whatsapp",
      finalidad: "salud",
      otorgado: true,
      fuente: "recepcion",
      personaId: medicoId,
    })
  );
  await conAlcanceTenant(tenantId, (db) =>
    guardarPoliticas(db, tenantId, { topePromocionesMes: 2 })
  );
  igual(
    (await conAlcanceTenant(tenantId, (db) => politicas(db, tenantId))).topePromocionesMes,
    2,
    "el tope es de la clínica y se puede cambiar"
  );

  for (let i = 1; i <= 2; i++) {
    const env = await conAlcanceTenant(tenantId, (db) =>
      enviarMensaje(db, tenantId, {
        propietarioId: clienteId,
        canal: "whatsapp",
        finalidad: "promociones",
        tipo: `promo_${i}`,
        texto: `Promoción ${i}`,
        ahora: manana,
      })
    );
    assert(env.enviado, `la promoción ${i} de 2 sale`, env.motivo ?? "");
  }
  const tercera = await conAlcanceTenant(tenantId, (db) =>
    enviarMensaje(db, tenantId, {
      propietarioId: clienteId,
      canal: "whatsapp",
      finalidad: "promociones",
      tipo: "promo_3",
      texto: "Promoción 3",
      ahora: manana,
    })
  );
  igual(tercera.motivo, "tope_promociones", "la TERCERA no: el tope del mes es 2");

  // Y la de salud sigue pasando: los mensajes de servicio no cuentan
  // para el tope.
  const saludConTope = await conAlcanceTenant(tenantId, (db) =>
    enviarMensaje(db, tenantId, {
      propietarioId: clienteId,
      pacienteId,
      canal: "whatsapp",
      finalidad: "salud",
      tipo: "recordatorio_cita",
      texto: "Te esperamos mañana a las 10.",
      ahora: manana,
    })
  );
  assert(saludConTope.enviado, "un mensaje de SALUD pasa igual: no cuenta para el tope");

  const duplicado = await conAlcanceTenant(tenantId, (db) =>
    enviarMensaje(db, tenantId, {
      propietarioId: clienteId,
      pacienteId,
      canal: "whatsapp",
      finalidad: "salud",
      tipo: "recordatorio_cita",
      texto: "Te esperamos mañana a las 10.",
      ahora: manana,
    })
  );
  igual(duplicado.motivo, "duplicado", "el MISMO tipo sobre la misma mascota no sale dos veces");

  // -------------------------------------------------------------------
  console.log("\n=== 7. La baja con una palabra ===");
  const baja = await conAlcanceTenant(tenantId, (db) =>
    recibirRespuesta(db, tenantId, {
      canal: "whatsapp",
      remitente: "8888-7777",
      texto: "BAJA",
    })
  );
  igual(
    [baja.accion, baja.propietarioId === clienteId],
    ["baja", true],
    "la respuesta se reconoce y se asocia al cliente por su teléfono"
  );

  const trasBaja = await conAlcanceTenant(tenantId, (db) => consentimientosDe(db, clienteId));
  igual(
    trasBaja.find((c) => c.canal === "whatsapp" && c.finalidad === "promociones")?.otorgado,
    false,
    "las PROMOCIONES por WhatsApp quedaron retiradas"
  );
  igual(
    trasBaja.find((c) => c.canal === "whatsapp" && c.finalidad === "salud")?.otorgado,
    true,
    "y la SALUD sigue: nadie que escribe «baja» renuncia al aviso de la vacuna"
  );

  const histBaja = await conAlcanceTenant(tenantId, (db) => historialDe(db, clienteId));
  assert(
    histBaja.some((h) => h.fuente === "respuesta_cliente" && !h.otorgado),
    "queda en el historial, con fuente «respuesta del cliente»",
    histBaja.find((h) => h.fuente === "respuesta_cliente")?.nota
  );

  const enLinea = await conAlcanceTenant(tenantId, (db) =>
    lineaDeInteracciones(db, { propietarioId: clienteId }, true)
  );
  assert(
    enLinea.some((e) => e.tipo === "mensaje_respondido") &&
      enLinea.some((e) => e.tipo === "consentimiento_cambiado"),
    "y en la línea de tiempo: la respuesta y el cambio de consentimiento",
    enLinea.filter((e) => e.modulo === "crm").map((e) => e.tipo)
  );

  // -------------------------------------------------------------------
  console.log("\n=== 8. La nota de la recepción y el detalle clínico ===");
  await conAlcanceTenant(tenantId, (db) =>
    agregarNota(db, tenantId, {
      propietarioId: clienteId,
      texto: "Llamó para preguntar por el resultado del laboratorio.",
      personaId: medicoId,
    })
  );
  const conNota = await conAlcanceTenant(tenantId, (db) =>
    lineaDeInteracciones(db, { propietarioId: clienteId }, true)
  );
  const nota = conNota.find((e) => e.tipo === "nota_manual");
  assert(
    !!nota && nota.nota?.includes("resultado del laboratorio") === true,
    "la nota queda con su texto y su autor",
    nota?.persona_nombre
  );

  const comoRecepcion = await conAlcanceTenant(tenantId, (db) =>
    lineaDeInteracciones(db, { propietarioId: clienteId }, false)
  );
  const visitaClinica = comoRecepcion.find((e) => e.tipo === "atencion_cerrada");
  assert(
    !!visitaClinica && visitaClinica.resumen === "Detalle clínico: lo ve el personal médico",
    "para quien no es médico, el evento clínico se VE pero su detalle no",
    visitaClinica?.resumen
  );
  assert(
    comoRecepcion.length === conNota.length,
    "y no se oculta el evento: ocultarlo haría creer que ese día no pasó nada",
    { medico: conNota.length, recepcion: comoRecepcion.length }
  );

  // -------------------------------------------------------------------
  console.log("\n=== 9. El origen que ya no existe ===");
  const borrable = await conAlcanceTenant(tenantId, (db) =>
    crearCita(db, tenantId, {
      pacienteId,
      medicoId,
      fecha: new Date().toISOString().slice(0, 10),
      horaInicio: "17:00",
      duracionMinutos: 30,
      motivoConsulta: "Esta cita se borra",
    })
  );
  await pool.query(`DELETE FROM citas WHERE id = $1`, [borrable.cita.id]);
  const conHuerfano = await conAlcanceTenant(tenantId, (db) =>
    lineaDeInteracciones(db, { propietarioId: clienteId }, true)
  );
  const huerfano = conHuerfano.find((e) => e.origen_id === borrable.cita.id);
  assert(
    huerfano === undefined || huerfano.origen_existe === false,
    "un evento cuyo origen ya no está lo dice (o se fue con la cascada)",
    huerfano ? `origen_existe=${huerfano.origen_existe}` : "se fue en cascada"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 10. La línea del expediente y la del CRM son la misma ===");
  const delExpediente = await conAlcanceTenant(tenantId, (db) => lineaDeTiempo(db, pacienteId));
  const delCrm = await conAlcanceTenant(tenantId, (db) =>
    lineaDeInteracciones(db, { pacienteId }, true)
  );
  const TIPOS_DEL_EXPEDIENTE = new Set([
    "atencion_cerrada",
    "vacuna_aplicada",
    "desparasitacion",
    "receta_emitida",
    "estudio_laboratorio",
    "grooming",
    "documento_adjunto",
    "consentimiento_firmado",
    "caso_abierto",
  ]);
  const esperados = delCrm.filter((e) => TIPOS_DEL_EXPEDIENTE.has(e.tipo));
  igual(
    delExpediente.length,
    esperados.length,
    "las dos muestran la MISMA cantidad de hechos del paciente"
  );
  igual(
    delExpediente.map((e) => e.referencia_id).sort(),
    esperados.map((e) => e.origen_id).sort(),
    "y exactamente los mismos orígenes"
  );
  assert(
    delExpediente.some((e) => e.tipo === "visita" && e.detalle?.includes("Gastroenteritis")),
    "el DETALLE sale del origen, no del evento: la nota médica se lee de la atención",
    delExpediente.find((e) => e.tipo === "visita")?.detalle
  );

  // -------------------------------------------------------------------
  console.log("\n=== 11. RLS: nada de otra clínica ===");
  const desdeOtra = await conAlcanceTenant(otroTenantId, (db) =>
    db.query<{ n: string }>(`SELECT count(*) AS n FROM crm_interacciones`)
  );
  igual(desdeOtra.rows[0].n, "0", "desde otra clínica, cero interacciones");
  const consentAjeno = await conAlcanceTenant(otroTenantId, (db) =>
    db.query<{ n: string }>(`SELECT count(*) AS n FROM crm_consentimientos`)
  );
  igual(consentAjeno.rows[0].n, "0", "ni un consentimiento");

  // -------------------------------------------------------------------
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error("ERROR", err);
  await pool.end();
  process.exit(1);
});
