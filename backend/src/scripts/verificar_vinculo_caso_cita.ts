import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";

// ---------------------------------------------------------------------
// Verificación real del plan "vincular caso↔cita para el reporte de
// atenciones". Clínica disposable, limpiada al final (tenant + usuario
// Keycloak).
// ---------------------------------------------------------------------

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();

async function main() {
  let tenantId: string | null = null;
  const email = `verif.vinculo.${sufijo}@vetlineai-test.com`;
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
        nombreComercial: `Clinica Vinculo Test ${sufijo}`,
        tipoPersona: "fisica",
        tipoIdentificacionId,
        numeroIdentificacion: `1-${sufijo}-7777`,
        nombreFiscal: `Clinica Vinculo Test ${sufijo}`,
        nombreTitular: "Dra. Vinculo Registrante",
        email,
        telefono: "88882222",
        password: "ClaveTest123!",
        esMedico: true,
        colegiatura: `COL-VIN-${sufijo}`,
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
      body: JSON.stringify({ nombre: "Tutor Vínculo", telefono: "87652222", email: "tutor.vinculo.test@example.com" }),
    });
    const dataProp = (await respProp.json()) as any;
    reportar("Propietario creado", respProp.status === 201, dataProp);
    const propietarioId = dataProp.propietario.id;

    const razaResult = await pool.query(`SELECT id FROM razas WHERE especie = 'canina' LIMIT 1`);
    const razaId = razaResult.rows[0].id;

    const crearPaciente = async (nombre: string) => {
      const resp = await fetch(`${BASE_URL}/api/pacientes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ propietarioId, nombre, especie: "Canino", razaId }),
      });
      const data = (await resp.json()) as any;
      if (resp.status !== 201) throw new Error(`No se pudo crear paciente ${nombre}: ${JSON.stringify(data)}`);
      return data.paciente.id as string;
    };

    const hoy = new Date().toISOString().slice(0, 10);

    // ===============================================================
    // Escenario 1 — caso sin vincular cita.
    // ===============================================================
    const pacienteAId = await crearPaciente("SinCita");
    const respCasoA = await fetch(`${BASE_URL}/api/casos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pacienteId: pacienteAId, agenteId, motivoConsulta: "Consulta sin cita" }),
    });
    const dataCasoA = (await respCasoA.json()) as any;
    reportar("Escenario 1: caso creado sin citaId", respCasoA.status === 201, dataCasoA);
    const casoAId = dataCasoA.caso.id;
    const expedienteA = dataCasoA.caso.numero_expediente;

    // ===============================================================
    // Escenario 2 — vincular una cita EXISTENTE de hoy.
    // ===============================================================
    const pacienteBId = await crearPaciente("EligeCita");
    const respCitaB = await fetch(`${BASE_URL}/api/citas`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pacienteId: pacienteBId,
        medicoId,
        fecha: hoy,
        horaInicio: "09:00",
        duracionMinutos: 30,
        motivoConsulta: "Cita agendada de antemano",
      }),
    });
    const dataCitaB = (await respCitaB.json()) as any;
    reportar("Cita B creada (sin caso todavía)", respCitaB.status === 201, dataCitaB);
    const citaBId = dataCitaB.cita.id;

    // GET /citas con paciente_id — confirma el filtro nuevo.
    const respListadoB = await fetch(
      `${BASE_URL}/api/citas?desde=${hoy}&hasta=${hoy}&medico_id=${medicoId}&paciente_id=${pacienteBId}`,
      { headers }
    );
    const dataListadoB = (await respListadoB.json()) as any;
    reportar(
      "GET /citas?paciente_id= devuelve solo la cita de ese paciente",
      dataListadoB.citas.length === 1 && dataListadoB.citas[0].id === citaBId,
      dataListadoB.citas
    );

    const respCasoB = await fetch(`${BASE_URL}/api/casos`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pacienteId: pacienteBId,
        agenteId,
        motivoConsulta: "Consulta con cita elegida",
        citaId: citaBId,
      }),
    });
    const dataCasoB = (await respCasoB.json()) as any;
    reportar(
      "Escenario 2: caso creado y citaVinculada=true",
      respCasoB.status === 201 && dataCasoB.citaVinculada === true,
      dataCasoB
    );
    const casoBId = dataCasoB.caso.id;

    const citaBEnBase = await pool.query(`SELECT caso_id FROM citas WHERE id = $1`, [citaBId]);
    reportar("citas.caso_id quedó seteado en la base", citaBEnBase.rows[0].caso_id === casoBId);

    // Marcarla completada (transición válida) para que caiga en la tabla
    // de atenciones.
    await fetch(`${BASE_URL}/api/citas/${citaBId}/estado`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ estado: "confirmada" }),
    });
    await fetch(`${BASE_URL}/api/citas/${citaBId}/estado`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ estado: "registrada" }),
    });
    await fetch(`${BASE_URL}/api/citas/${citaBId}/estado`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ estado: "en_consulta" }),
    });
    const respCompletarB = await fetch(`${BASE_URL}/api/citas/${citaBId}/estado`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ estado: "completada" }),
    });
    reportar("Cita B marcada completada", respCompletarB.status === 200);

    // ===============================================================
    // Escenario 3 — crear una cita NUEVA ya vinculada al caso (casoId en
    // POST /citas).
    // ===============================================================
    const pacienteCId = await crearPaciente("CreaCitaAhora");
    const respCasoC = await fetch(`${BASE_URL}/api/casos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pacienteId: pacienteCId, agenteId, motivoConsulta: "Consulta walk-in" }),
    });
    const dataCasoC = (await respCasoC.json()) as any;
    const casoCId = dataCasoC.caso.id;

    const respCitaC = await fetch(`${BASE_URL}/api/citas`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pacienteId: pacienteCId,
        medicoId,
        fecha: hoy,
        horaInicio: "14:00",
        duracionMinutos: 20,
        motivoConsulta: "Consulta walk-in",
        casoId: casoCId,
      }),
    });
    const dataCitaC = (await respCitaC.json()) as any;
    reportar(
      "Escenario 3: cita creada ya con caso_id",
      respCitaC.status === 201 && dataCitaC.cita.caso_id === casoCId,
      dataCitaC.cita
    );
    const citaCId = dataCitaC.cita.id;

    for (const estado of ["confirmada", "registrada", "en_consulta", "completada"]) {
      await fetch(`${BASE_URL}/api/citas/${citaCId}/estado`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ estado }),
      });
    }

    // ===============================================================
    // Escenario 4 — el nuevo PATCH /:id/caso: 409 si ya está vinculada.
    // ===============================================================
    const respDobleVinculo = await fetch(`${BASE_URL}/api/citas/${citaBId}/caso`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ casoId: casoAId }),
    });
    reportar("PATCH /citas/:id/caso devuelve 409 si ya estaba vinculada", respDobleVinculo.status === 409);

    // Y confirma que SÍ vincula cuando está libre.
    const pacienteDId = await crearPaciente("VinculoDirecto");
    const respCitaD = await fetch(`${BASE_URL}/api/citas`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pacienteId: pacienteDId,
        medicoId,
        fecha: hoy,
        horaInicio: "16:00",
        duracionMinutos: 15,
      }),
    });
    const dataCitaD = (await respCitaD.json()) as any;
    const respCasoD = await fetch(`${BASE_URL}/api/casos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pacienteId: pacienteDId, agenteId, motivoConsulta: "Vínculo directo" }),
    });
    const dataCasoD = (await respCasoD.json()) as any;
    const respVinculoDirecto = await fetch(`${BASE_URL}/api/citas/${dataCitaD.cita.id}/caso`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ casoId: dataCasoD.caso.id }),
    });
    reportar("PATCH /citas/:id/caso vincula cuando está libre", respVinculoDirecto.status === 200);

    // ===============================================================
    // Escenario 5 — el reporte de atenciones tiene EXACTAMENTE 5 campos
    // por fila en 'atenciones', y 'casosSinCita' solo id/numero_expediente.
    // ===============================================================
    const respReporte = await fetch(
      `${BASE_URL}/api/admin/reporte-atenciones?desde=${hoy}&hasta=${hoy}`,
      { headers }
    );
    const dataReporte = (await respReporte.json()) as any;
    reportar("GET /admin/reporte-atenciones responde 200", respReporte.status === 200, {
      atenciones: dataReporte.atenciones?.length,
      casosSinCita: dataReporte.casosSinCita?.length,
    });

    const filaAtencionB = dataReporte.atenciones.find((a: any) => a.numero_expediente === dataCasoB.caso.numero_expediente);
    reportar("Caso B (cita elegida, completada) aparece en 'atenciones'", !!filaAtencionB, filaAtencionB);
    if (filaAtencionB) {
      // medico_id/medico_nombre siguen viajando en el JSON crudo (los usa
      // el bloque de totales por médico, aparte de la tabla) — lo que
      // importa es que paciente_nombre, el campo que se filtró sin
      // pedirlo, ya no está, y que los 5 campos pedidos sí están.
      const camposReales = Object.keys(filaAtencionB);
      reportar(
        "Fila de atención NO trae paciente_nombre (el campo filtrado que no se pidió)",
        !("paciente_nombre" in filaAtencionB),
        camposReales
      );
      reportar(
        "Fila de atención trae los 5 campos pedidos: fecha, hora_inicio, hora_fin, numero_expediente, colegiatura",
        ["fecha", "hora_inicio", "hora_fin", "numero_expediente", "colegiatura"].every((k) => k in filaAtencionB),
        camposReales
      );
      reportar("Hora de inicio/fin no vacías", !!filaAtencionB.hora_inicio && !!filaAtencionB.hora_fin, filaAtencionB);
    }

    const filaAtencionC = dataReporte.atenciones.find((a: any) => a.numero_expediente === dataCasoC.caso.numero_expediente);
    reportar("Caso C (cita creada ahora, completada) aparece en 'atenciones'", !!filaAtencionC, filaAtencionC);

    const filaSinCitaA = dataReporte.casosSinCita.find((c: any) => c.numero_expediente === expedienteA);
    reportar("Caso A (sin cita) aparece en 'casosSinCita'", !!filaSinCitaA, filaSinCitaA);
    if (filaSinCitaA) {
      const camposEsperados = ["id", "numero_expediente"].sort();
      const camposReales = Object.keys(filaSinCitaA).sort();
      reportar(
        "Fila de 'casosSinCita' tiene EXACTAMENTE id + numero_expediente",
        JSON.stringify(camposReales) === JSON.stringify(camposEsperados),
        camposReales
      );
    }

    // PDF — solo confirma que se genera y trae encabezado válido.
    const respPdf = await fetch(`${BASE_URL}/api/admin/reporte-atenciones/pdf?desde=${hoy}&hasta=${hoy}`, {
      headers,
    });
    const pdfBuffer = Buffer.from(await respPdf.arrayBuffer());
    reportar(
      "PDF del reporte se genera con encabezado %PDF válido",
      respPdf.status === 200 && pdfBuffer.slice(0, 4).toString() === "%PDF",
      { status: respPdf.status, primerosBytes: pdfBuffer.slice(0, 8).toString() }
    );
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
