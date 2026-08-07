import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak } from "../keycloakAdmin";

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();

async function main() {
  const limpiezaTenants: string[] = [];
  const limpiezaKeycloak: string[] = [];
  let ok = true;
  const reportar = (nombre: string, cond: boolean, detalle?: unknown) => {
    console.log(`[${cond ? "OK" : "FALLO"}] ${nombre}`, detalle ?? "");
    if (!cond) ok = false;
  };

  const tipoId = await pool.query(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
  );
  const tipoIdentificacionId = tipoId.rows[0].id;

  const agenteResult = await pool.query(`SELECT id, nombre FROM agentes WHERE estado_catalogo = 'disponible' AND estado = 'activo' LIMIT 1`);
  const agenteId = agenteResult.rows[0].id;
  const agenteNombre = agenteResult.rows[0].nombre;
  console.log(`Agente elegido para la prueba: ${agenteNombre} (${agenteId})`);

  // ---------------------------------------------------------------------
  // ESCENARIO 1 — registrante médico: entra al área de trabajo y ve su
  // agente asignado.
  // ---------------------------------------------------------------------
  console.log("\n=== Escenario 1: registrante médico ===");
  const emailA = `verif.urg.a.${sufijo}@vetlineai-test.com`;
  const respA = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica Urgente A ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${sufijo}-1111`,
      nombreFiscal: `Clinica Urgente A ${sufijo}`,
      nombreTitular: "Dra. Urgente Registrante",
      email: emailA,
      telefono: "88881111",
      password: "ClaveTest123!",
      esMedico: true,
      colegiatura: `COL-URG-A-${sufijo}`,
      agenteId,
    }),
  });
  const dataA = (await respA.json()) as any;
  if (respA.status !== 201) {
    reportar("Registro A (registrante médico) exitoso", false, { status: respA.status, dataA });
  } else {
    reportar("Registro A (registrante médico) exitoso", true);
    const tokenA = dataA.access_token;
    const meA = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const meAData = (await meA.json()) as any;
    const tenantAId = meAData.auth.tenantId;
    limpiezaTenants.push(tenantAId);

    const wsAgentesA = await fetch(`${BASE_URL}/api/workspace/agentes`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const wsAgentesAData = (await wsAgentesA.json()) as any;
    reportar(
      "El registrante-médico entra al área de trabajo y ve su agente asignado",
      wsAgentesA.status === 200 && wsAgentesAData.agentes?.length === 1 && wsAgentesAData.agentes[0].id === agenteId,
      wsAgentesAData
    );

    // -----------------------------------------------------------------
    // ESCENARIO 2 — desde el panel, invitar a un segundo médico: procede
    // (hay cupo gracias a trial.medicos_incluidos=2).
    // -----------------------------------------------------------------
    console.log("\n=== Escenario 2: invitar segundo médico (debe haber cupo) ===");
    const emailInvitado = `verif.urg.invitado.${sufijo}@vetlineai-test.com`;
    const respInvitar = await fetch(`${BASE_URL}/api/admin/medicos/invitar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ email: emailInvitado, nombre: "Dr. Urgente Invitado" }),
    });
    const dataInvitar = (await respInvitar.json()) as any;
    reportar(
      "Invitar un segundo médico procede (hay cupo)",
      respInvitar.status === 200 || respInvitar.status === 201,
      { status: respInvitar.status, dataInvitar }
    );

    // -----------------------------------------------------------------
    // ESCENARIO 3 (primera mitad) — aceptar la invitación. El médico
    // recién aceptado, ANTES de que se le asigne ningún agente, es el
    // mismo caso del Escenario 4 (sin agentes asignados) — se aprovecha
    // la misma cuenta para no gastar el cupo del trial dos veces.
    // -----------------------------------------------------------------
    console.log("\n=== Escenario 3a: aceptar la invitación ===");
    const invitacionRow = await pool.query(
      `SELECT token FROM invitaciones_medico WHERE tenant_id = $1 AND email = $2 ORDER BY creada_en DESC LIMIT 1`,
      [tenantAId, emailInvitado]
    );
    if (invitacionRow.rows.length === 0) {
      reportar("Invitación encontrada en base para aceptar", false);
    } else {
      const tokenInvitacion = invitacionRow.rows[0].token;
      const respAceptar = await fetch(`${BASE_URL}/api/invitaciones/${tokenInvitacion}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: "Dr. Urgente Invitado Aceptado",
          colegiatura: `COL-URG-INV-${sufijo}`,
          password: "ClaveTest123!",
        }),
      });
      const dataAceptar = (await respAceptar.json()) as any;
      reportar("Aceptar la invitación procede", respAceptar.status === 200 || respAceptar.status === 201, {
        status: respAceptar.status,
        dataAceptar,
      });

      if (respAceptar.status === 200 || respAceptar.status === 201) {
        const tokenInvitado = dataAceptar.access_token;

        // ESCENARIO 4 — médico sin agentes asignados: ve el estado
        // explicativo (workspace/agentes responde 200 con lista vacía, no
        // 403 — es lo que dispara el estado "sin agentes" en el frontend,
        // distinto de un error de permisos).
        console.log("\n=== Escenario 4: médico recién aceptado, sin agentes asignados ===");
        const wsAgentesInvitadoVacio = await fetch(`${BASE_URL}/api/workspace/agentes`, {
          headers: { Authorization: `Bearer ${tokenInvitado}` },
        });
        const wsAgentesInvitadoVacioData = (await wsAgentesInvitadoVacio.json()) as any;
        reportar(
          "Médico sin agentes: 200 con lista vacía (no 403 de permisos)",
          wsAgentesInvitadoVacio.status === 200 && wsAgentesInvitadoVacioData.agentes?.length === 0,
          wsAgentesInvitadoVacioData
        );

        // ESCENARIO 3 (segunda mitad) — asignarle el agente desde el panel.
        console.log("\n=== Escenario 3b: asignarle el agente desde el panel ===");
        const personaInvitado = await pool.query(`SELECT id FROM personas WHERE email = $1`, [emailInvitado]);
        const personaInvitadoId = personaInvitado.rows[0]?.id;
        if (!personaInvitadoId) {
          reportar("Persona del invitado encontrada en base", false);
        } else {
          const respAsignar = await fetch(`${BASE_URL}/api/admin/medicos/${personaInvitadoId}/accesos`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ accesos: [{ agenteId, habilitado: true }] }),
          });
          const dataAsignar = (await respAsignar.json()) as any;
          reportar("Asignarle el agente desde el panel procede", respAsignar.status === 200, {
            status: respAsignar.status,
            dataAsignar,
          });

          const wsAgentesInvitadoConAgente = await fetch(`${BASE_URL}/api/workspace/agentes`, {
            headers: { Authorization: `Bearer ${tokenInvitado}` },
          });
          const wsAgentesInvitadoConAgenteData = (await wsAgentesInvitadoConAgente.json()) as any;
          reportar(
            "Confirmación extra: tras asignarlo, el médico ya ve el agente en su workspace",
            wsAgentesInvitadoConAgente.status === 200 && wsAgentesInvitadoConAgenteData.agentes?.length === 1,
            wsAgentesInvitadoConAgenteData
          );
        }

        limpiezaKeycloak.push(emailInvitado);
      }
    }

    limpiezaKeycloak.push(emailA);
  }

  // ---------------------------------------------------------------------
  // ESCENARIO 5 — registrante NO médico: la invitación al primer
  // veterinario procede.
  // ---------------------------------------------------------------------
  console.log("\n=== Escenario 5: registrante NO médico ===");
  const emailB = `verif.urg.b.${sufijo}@vetlineai-test.com`;
  const emailPrimerVeterinario = `verif.urg.primervet.${sufijo}@vetlineai-test.com`;
  const respB = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica Urgente B ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${sufijo}-2222`,
      nombreFiscal: `Clinica Urgente B ${sufijo}`,
      nombreTitular: "Sr. Urgente Admin No Medico",
      email: emailB,
      telefono: "88882222",
      password: "ClaveTest123!",
      esMedico: false,
      correoMedicoInvitado: emailPrimerVeterinario,
      agenteId,
    }),
  });
  const dataB = (await respB.json()) as any;
  if (respB.status !== 201) {
    reportar("Registro B (registrante NO médico) exitoso", false, { status: respB.status, dataB });
  } else {
    reportar("Registro B (registrante NO médico) exitoso", true);
    const meB = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${dataB.access_token}` } });
    const meBData = (await meB.json()) as any;
    const tenantBId = meBData.auth.tenantId;
    limpiezaTenants.push(tenantBId);
    limpiezaKeycloak.push(emailB);

    const invitacionPrimerVet = await pool.query(
      `SELECT id, estado, token FROM invitaciones_medico WHERE tenant_id = $1 AND email = $2`,
      [tenantBId, emailPrimerVeterinario]
    );
    reportar(
      "La invitación al primer veterinario se creó y procede (queda pendiente)",
      invitacionPrimerVet.rows.length === 1 && invitacionPrimerVet.rows[0].estado === "pendiente",
      invitacionPrimerVet.rows[0]
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n=== Limpieza ===");
  for (const tenantId of limpiezaTenants) {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
  // Keycloak: buscar por email (no guardamos los IDs de todos los
  // creados por registro-publico/aceptar-invitacion).
  console.log(`Tenants eliminados: ${limpiezaTenants.length}`);

  console.log(`\n${ok ? "TODOS LOS ESCENARIOS PASARON" : "HAY ESCENARIOS FALLIDOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
