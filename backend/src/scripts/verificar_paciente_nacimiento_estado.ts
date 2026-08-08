import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";
import { construirBloqueContextoCaso } from "../contextoCaso";
import { ejecutarJobNotificaciones } from "../jobs/notificaciones.job";

// ---------------------------------------------------------------------
// Verificación real de prompt_code_paciente_nacimiento_estado.md — los 7
// puntos de VERIFICACIÓN. Clínica disposable, limpiada al final (tenant +
// usuario Keycloak). No genera uso de IA real: los puntos de edad se
// verifican llamando directo a construirBloqueContextoCaso (mismo bloque
// que se le manda a Claude), no con un mensaje real al agente.
// ---------------------------------------------------------------------

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();

async function main() {
  let tenantId: string | null = null;
  const email = `verif.paciente.${sufijo}@vetlineai-test.com`;
  let ok = true;
  const reportar = (nombre: string, cond: boolean, detalle?: unknown) => {
    console.log(`[${cond ? "OK" : "FALLO"}] ${nombre}`, detalle ?? "");
    if (!cond) ok = false;
  };

  try {
    // -------------------------------------------------------------
    // 0. Clínica disposable (registrante médico, agente GCIS).
    // -------------------------------------------------------------
    const tipoId = await pool.query(
      `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
    );
    const tipoIdentificacionId = tipoId.rows[0].id;
    const agenteResult = await pool.query(`SELECT id FROM agentes WHERE nombre = 'Medicina General / Triage'`);
    const agenteId = agenteResult.rows[0].id;

    const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paisCodigo: "CR",
        nombreComercial: `Clinica Nacimiento Estado Test ${sufijo}`,
        tipoPersona: "fisica",
        tipoIdentificacionId,
        numeroIdentificacion: `1-${sufijo}-8888`,
        nombreFiscal: `Clinica Nacimiento Estado Test ${sufijo}`,
        nombreTitular: "Dra. Nacimiento Registrante",
        email,
        telefono: "88881111",
        password: "ClaveTest123!",
        esMedico: true,
        colegiatura: `COL-NAC-${sufijo}`,
        agenteId,
      }),
    });
    const dataReg = (await respReg.json()) as any;
    if (respReg.status !== 201) {
      reportar("Registro disposable exitoso", false, { status: respReg.status, dataReg });
      throw new Error("No se pudo registrar");
    }
    reportar("Registro disposable exitoso", true);
    const token = dataReg.access_token;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    const meData = (await me.json()) as any;
    tenantId = meData.auth.tenantId;
    const medicoId = meData.auth.userId;

    const respProp = await fetch(`${BASE_URL}/api/propietarios`, {
      method: "POST",
      headers,
      body: JSON.stringify({ nombre: "Tutor de Prueba", telefono: "87651111", email: "tutor.nac.test@example.com" }),
    });
    const dataProp = (await respProp.json()) as any;
    reportar("Propietario creado", respProp.status === 201, dataProp);
    const propietarioId = dataProp.propietario.id;

    const razaResult = await pool.query(`SELECT id FROM razas WHERE especie = 'canina' LIMIT 1`);
    const razaId = razaResult.rows[0].id;

    const crearPaciente = async (nombre: string, fechaNacimiento?: string) => {
      const resp = await fetch(`${BASE_URL}/api/pacientes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ propietarioId, nombre, especie: "Canino", razaId, fechaNacimiento }),
      });
      const data = (await resp.json()) as any;
      if (resp.status !== 201) throw new Error(`No se pudo crear paciente ${nombre}: ${JSON.stringify(data)}`);
      return data.paciente.id as string;
    };

    const crearCasoPara = async (pacienteId: string, motivo: string) => {
      const resp = await fetch(`${BASE_URL}/api/workspace/casos`, {
        method: "POST",
        headers,
        body: JSON.stringify({ pacienteId, agenteId, motivo }),
      });
      const data = (await resp.json()) as any;
      if (resp.status !== 201) throw new Error(`No se pudo crear caso: ${JSON.stringify(data)}`);
      return data.caso.id as string;
    };

    const fechaISO = (d: Date) => d.toISOString().slice(0, 10);
    const hoy = new Date();

    // ===============================================================
    // Punto 3 — fecha de nacimiento registrada: la edad que recibe el
    // agente es correcta.
    // ===============================================================
    const fechaNacRocky = new Date(hoy);
    fechaNacRocky.setUTCFullYear(fechaNacRocky.getUTCFullYear() - 3);
    const rockyId = await crearPaciente("Rocky", fechaISO(fechaNacRocky));
    const casoRockyId = await crearCasoPara(rockyId, "Chequeo de rutina");
    const bloqueRocky = await construirBloqueContextoCaso(pool, casoRockyId);
    console.log("--- Bloque de contexto (Rocky, con fecha de nacimiento) ---\n" + bloqueRocky);
    reportar(
      "Punto 3: edad derivada de fecha_nacimiento es ~3 años",
      /- Edad: 3(\.0)? años/.test(bloqueRocky),
      bloqueRocky
    );

    // ===============================================================
    // Punto 4 — paciente sin fecha de nacimiento: procede, y la edad
    // sigue siendo utilizable (fallback a edad_anios).
    // ===============================================================
    const nubeId = await crearPaciente("Nube");
    await pool.query(`UPDATE pacientes SET edad_anios = 7 WHERE id = $1`, [nubeId]);
    const casoNubeId = await crearCasoPara(nubeId, "Chequeo de rutina");
    const bloqueNube = await construirBloqueContextoCaso(pool, casoNubeId);
    console.log("--- Bloque de contexto (Nube, sin fecha de nacimiento, edad_anios=7) ---\n" + bloqueNube);
    reportar(
      "Punto 4: sin fecha_nacimiento, sigue usando edad_anios (7 años)",
      /- Edad: 7 años/.test(bloqueNube),
      bloqueNube
    );

    // ===============================================================
    // Puntos 1 y 2 — desparasitación interna y externa distinguibles,
    // cada una con su producto, y el aviso se dispara por cada una por
    // separado (fechas próximas distintas, mismo paciente).
    // ===============================================================
    const tobyId = await crearPaciente("Toby");
    const casoTobyId = await crearCasoPara(tobyId, "Control preventivo");

    const proximaInterna = fechaISO(new Date(hoy.getTime() + 3 * 24 * 60 * 60 * 1000));
    const proximaExterna = fechaISO(new Date(hoy.getTime() + 5 * 24 * 60 * 60 * 1000));

    const respInterna = await fetch(`${BASE_URL}/api/pacientes/${tobyId}/cuidados-preventivos`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tipo: "desparasitacion",
        fechaAplicacion: fechaISO(hoy),
        fechaProximaRecomendada: proximaInterna,
        subtipoDesparasitacion: "interna",
        productoDesparasitacion: "Drontal",
      }),
    });
    const dataInterna = (await respInterna.json()) as any;
    reportar("Desparasitación interna registrada", respInterna.status === 201, dataInterna);

    const respExterna = await fetch(`${BASE_URL}/api/pacientes/${tobyId}/cuidados-preventivos`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tipo: "desparasitacion",
        fechaAplicacion: fechaISO(hoy),
        fechaProximaRecomendada: proximaExterna,
        subtipoDesparasitacion: "externa",
        productoDesparasitacion: "Nexgard",
      }),
    });
    const dataExterna = (await respExterna.json()) as any;
    reportar("Desparasitación externa registrada", respExterna.status === 201, dataExterna);

    const respListado = await fetch(`${BASE_URL}/api/pacientes/${tobyId}/cuidados-preventivos`, { headers });
    const dataListado = (await respListado.json()) as any;
    const filaInterna = dataListado.cuidadosPreventivos.find((c: any) => c.id === dataInterna.cuidadoPreventivo.id);
    const filaExterna = dataListado.cuidadosPreventivos.find((c: any) => c.id === dataExterna.cuidadoPreventivo.id);
    reportar(
      "Punto 1: las dos aparecen distinguibles (subtipo) con su producto",
      filaInterna?.subtipo_desparasitacion === "interna" &&
        filaInterna?.producto_desparasitacion === "Drontal" &&
        filaExterna?.subtipo_desparasitacion === "externa" &&
        filaExterna?.producto_desparasitacion === "Nexgard",
      { filaInterna, filaExterna }
    );

    // Caso con seguimiento clínico faltante (aviso al médico) — dashboard
    // en estado crítico, sin cita futura.
    await pool.query(
      `UPDATE casos SET dashboard_cache = '{"clinical_state": {"estado": "critico"}}'::jsonb WHERE id = $1`,
      [casoTobyId]
    );

    console.log("\nCorriendo el job de notificaciones (Toby activo)...");
    await ejecutarJobNotificaciones();

    const notifsTobyActivo = await pool.query(
      `SELECT tipo, destinatario_tipo, cuidado_preventivo_id FROM notificaciones WHERE paciente_id = $1`,
      [tobyId]
    );
    const tiposActivo = notifsTobyActivo.rows.map((r) => r.tipo);
    reportar(
      "Punto 2: el aviso de desparasitación se disparó por cada cuidado por separado",
      notifsTobyActivo.rows.filter((r) => r.tipo === "desparasitacion_proxima").length === 2,
      notifsTobyActivo.rows
    );
    reportar(
      "Con Toby activo, también se dispara seguimiento_faltante (al médico)",
      tiposActivo.includes("seguimiento_faltante"),
      tiposActivo
    );

    // ===============================================================
    // Punto 5 — marcar como fallecido: deja de recibir TODOS los avisos,
    // no solo el de cumpleaños. Se agregan condiciones NUEVAS (cuidado
    // preventivo nuevo + cita nueva) después del fallecimiento, para que
    // el dedupe no oculte el resultado real.
    // ===============================================================
    const respFallecer = await fetch(`${BASE_URL}/api/pacientes/${tobyId}/estado`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ estado: "fallecido", fechaFallecimiento: fechaISO(hoy) }),
    });
    const dataFallecer = (await respFallecer.json()) as any;
    reportar("Toby marcado como fallecido", respFallecer.status === 200, dataFallecer);

    const respVacunaPostFallecido = await fetch(`${BASE_URL}/api/pacientes/${tobyId}/cuidados-preventivos`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tipo: "vacunacion",
        fechaAplicacion: fechaISO(hoy),
        fechaProximaRecomendada: fechaISO(new Date(hoy.getTime() + 2 * 24 * 60 * 60 * 1000)),
        vacuna: "Polivalente",
      }),
    });
    reportar(
      "Se puede seguir registrando historial clínico de un paciente fallecido",
      respVacunaPostFallecido.status === 201
    );

    // Cita event-driven (confirmacion_cita) para el paciente ya fallecido.
    const respCitaFallecido = await fetch(`${BASE_URL}/api/citas`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pacienteId: tobyId,
        medicoId,
        fecha: fechaISO(new Date(hoy.getTime() + 24 * 60 * 60 * 1000)),
        horaInicio: "10:00",
        duracionMinutos: 30,
        motivoConsulta: "Control",
      }),
    });
    reportar("Se puede seguir agendando una cita para un paciente fallecido", respCitaFallecido.status === 201);

    console.log("\nCorriendo el job de notificaciones de nuevo (Toby ya fallecido)...");
    await ejecutarJobNotificaciones();

    // Total de notificaciones de Toby no debe haber crecido con la vacuna
    // nueva ni con la cita nueva, ambas registradas después del fallecimiento.
    const notifsTobyTotal = await pool.query(`SELECT tipo FROM notificaciones WHERE paciente_id = $1`, [tobyId]);
    reportar(
      "Punto 5: paciente fallecido no generó NINGÚN aviso nuevo (ni vacunación, ni cita, ni seguimiento)",
      notifsTobyTotal.rows.length === notifsTobyActivo.rows.length,
      { antes: notifsTobyActivo.rows, despues: notifsTobyTotal.rows }
    );

    // ===============================================================
    // Punto 6 — aviso de cumpleaños: solo para pacientes activos, con
    // fecha de nacimiento, en la fecha correcta.
    // ===============================================================
    const cumpleHoy = new Date(hoy);
    cumpleHoy.setUTCFullYear(cumpleHoy.getUTCFullYear() - 5);

    const ninaId = await crearPaciente("Nina", fechaISO(cumpleHoy));
    const kiwiId = await crearPaciente("Kiwi", fechaISO(cumpleHoy));
    await fetch(`${BASE_URL}/api/pacientes/${kiwiId}/estado`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ estado: "fallecido", fechaFallecimiento: fechaISO(hoy) }),
    });

    console.log("\nCorriendo el job de notificaciones (cumpleaños: Nina activa, Kiwi fallecido)...");
    await ejecutarJobNotificaciones();

    const notifNina = await pool.query(
      `SELECT id FROM notificaciones WHERE paciente_id = $1 AND tipo = 'cumpleanos'`,
      [ninaId]
    );
    const notifKiwi = await pool.query(
      `SELECT id FROM notificaciones WHERE paciente_id = $1 AND tipo = 'cumpleanos'`,
      [kiwiId]
    );
    reportar("Punto 6: paciente activo con cumpleaños hoy SÍ recibe el saludo", notifNina.rows.length === 1);
    reportar("Punto 6: paciente fallecido con cumpleaños hoy NO recibe el saludo", notifKiwi.rows.length === 0);

    // Punto 7 (selector de reportes oculto pero presente en el código) se
    // verifica aparte, por código + navegador — no es una condición de
    // datos que este script pueda comprobar.
  } finally {
    if (tenantId) {
      const personaKc = await pool.query(
        `SELECT keycloak_user_id FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true`,
        [tenantId]
      );
      const keycloakUserId = personaKc.rows[0]?.keycloak_user_id;
      if (keycloakUserId) {
        await eliminarUsuarioKeycloak(keycloakUserId);
        console.log(`Usuario Keycloak ${keycloakUserId} eliminado.`);
      }
      await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      console.log(`Tenant ${tenantId} eliminado.`);
    }
  }

  console.log(`\n${ok ? "TODO OK" : "HAY HALLAZGOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
