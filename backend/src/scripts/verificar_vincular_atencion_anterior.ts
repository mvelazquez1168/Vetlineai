import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";
import { construirBloqueContextoCaso } from "../contextoCaso";

const BASE = "http://localhost:4000/api";
const SUFIJO = Date.now().toString(36);
let assertOk = 0;
let assertFail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    assertOk++;
    console.log(`OK   - ${label}`);
  } else {
    assertFail++;
    console.log(`FAIL - ${label}`);
  }
}

async function fetchJson(path: string, opts: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(rest.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function main() {
  let tenantId = "";
  let personaId = "";
  let propietarioId = "";
  let pacienteId = "";
  let agenteId = "";
  const citaIds: string[] = [];
  let casoAId = "";
  let casoBId = "";
  let kcUserId = "";
  const email = `verif.vincular.atencion.${SUFIJO}@example.com`;

  try {
    const tenantRes = await pool.query(
      `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
      [`Clínica Verif Vincular Atención ${SUFIJO}`]
    );
    tenantId = tenantRes.rows[0].id;

    kcUserId = await crearUsuarioKeycloak({
      email,
      nombreCompleto: `Dra. Verif Vincular ${SUFIJO}`,
      password: "Vp" + SUFIJO + "!1",
      tenantId,
      rol: "VETERINARIO",
    });

    const personaRes = await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
       VALUES ($1, 'Dra. Verif Vincular', $2, 'x', true, false, $3, 'COL-777')
       RETURNING id`,
      [tenantId, email, kcUserId]
    );
    personaId = personaRes.rows[0].id;

    const propRes = await pool.query(
      `INSERT INTO propietarios (tenant_id, nombre, telefono, email) VALUES ($1, 'Propietario Verif Vincular', '00000000', $2) RETURNING id`,
      [tenantId, `prop.vincular.${SUFIJO}@example.com`]
    );
    propietarioId = propRes.rows[0].id;

    const pacRes = await pool.query(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, estado) VALUES ($1, $2, 'Firulais Vincular', 'Canino', 'activo') RETURNING id`,
      [tenantId, propietarioId]
    );
    pacienteId = pacRes.rows[0].id;

    const agenteRes = await pool.query(`SELECT id FROM agentes WHERE system_prompt IS NOT NULL LIMIT 1`);
    agenteId = agenteRes.rows[0].id;
    await pool.query(`INSERT INTO medico_agente (persona_id, agente_id, habilitado) VALUES ($1, $2, true)`, [
      personaId,
      agenteId,
    ]);
    await pool.query(
      `INSERT INTO tenant_agentes (tenant_id, agente_id, estado) VALUES ($1, $2, 'habilitado')
       ON CONFLICT (tenant_id, agente_id) DO UPDATE SET estado = 'habilitado'`,
      [tenantId, agenteId]
    );

    const token = (await obtenerTokenParaUsuario(email, "Vp" + SUFIJO + "!1")).access_token;

    // Helper: crea una cita, la lleva a 'en_consulta' (transición real) y
    // registra una atención con nota/peso/temperatura — SIN caso.
    async function crearAtencionSinCaso(hora: string, nota: string, peso: number): Promise<string> {
      const { json: citaJson } = await fetchJson("/citas", {
        method: "POST",
        token,
        body: JSON.stringify({
          pacienteId,
          medicoId: personaId,
          fecha: new Date().toISOString().slice(0, 10),
          horaInicio: hora,
          duracionMinutos: 30,
        }),
      });
      if (!citaJson.cita) console.log("DEBUG citaJson", JSON.stringify(citaJson));
      const citaId = citaJson.cita.id;
      citaIds.push(citaId);
      for (const estado of ["confirmada", "registrada", "en_consulta"]) {
        await fetchJson(`/citas/${citaId}/estado`, { method: "PATCH", token, body: JSON.stringify({ estado }) });
      }
      const { json: atJson } = await fetchJson("/atenciones", { method: "POST", token, body: JSON.stringify({ citaId }) });
      await fetchJson(`/atenciones/${atJson.atencion.id}`, {
        method: "PUT",
        token,
        body: JSON.stringify({ notaMedica: nota, peso, temperatura: 38.5 }),
      });
      return citaId;
    }

    const citaVieja1 = await crearAtencionSinCaso("08:00", "Control de rutina, sin hallazgos.", 12.4);
    const citaVieja2 = await crearAtencionSinCaso("09:00", "Vómitos ocasionales hace una semana.", 12.1);

    // ------------------------------------------------------------------
    // Escenario A — el listado de candidatas trae ambas atenciones sin
    // caso, con nota/peso/temperatura.
    // ------------------------------------------------------------------
    const listaA = await fetchJson(`/pacientes/${pacienteId}/atenciones-sin-caso`, { token });
    assert(listaA.status === 200, "GET atenciones-sin-caso responde 200");
    assert(listaA.json.atenciones.length === 2, "lista 2 atenciones sin caso (ninguna tiene caso todavía)");
    const filaVieja2 = listaA.json.atenciones.find((a: any) => a.cita_id === citaVieja2);
    assert(filaVieja2?.nota_medica === "Vómitos ocasionales hace una semana.", "trae la nota médica real");
    assert(Number(filaVieja2?.peso) === 12.1, "trae el peso real");

    // ------------------------------------------------------------------
    // Escenario B — se crea el caso nuevo (motivo relacionado con lo que
    // pasó en la atención vieja) y se vincula esa atención al caso.
    // ------------------------------------------------------------------
    const { json: casoJson } = await fetchJson("/casos", {
      method: "POST",
      token,
      body: JSON.stringify({ pacienteId, agenteId, motivoConsulta: "Sigue con vómitos, ahora más frecuentes" }),
    });
    casoAId = casoJson.caso.id;

    const vinculoB = await fetchJson(`/citas/${citaVieja2}/caso`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ casoId: casoAId }),
    });
    assert(vinculoB.status === 200, "PATCH /citas/:id/caso vincula la atención vieja relevante");

    // ------------------------------------------------------------------
    // Escenario C — tras vincular, esa atención desaparece del listado
    // de "sin caso" (no se puede volver a robar), pero la OTRA (control
    // de rutina, sin relación) sigue apareciendo como candidata.
    // ------------------------------------------------------------------
    const listaC = await fetchJson(`/pacientes/${pacienteId}/atenciones-sin-caso`, { token });
    assert(listaC.json.atenciones.length === 1, "tras vincular, queda 1 sola atención sin caso");
    assert(listaC.json.atenciones[0].cita_id === citaVieja1, "la que queda es la NO vinculada (control de rutina)");

    // Reintentar vincular la misma (ya vinculada) a otro caso debe
    // rechazarse — nunca pisa un vínculo existente.
    const { json: casoBJson } = await fetchJson("/casos", {
      method: "POST",
      token,
      body: JSON.stringify({ pacienteId, agenteId, motivoConsulta: "Caso B, no relacionado" }),
    });
    casoBId = casoBJson.caso.id;
    const reintento = await fetchJson(`/citas/${citaVieja2}/caso`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ casoId: casoBId }),
    });
    assert(reintento.status === 409, "no se puede robar una atención ya vinculada a otro caso (409)");

    // ------------------------------------------------------------------
    // Escenario D — el bloque de contexto del caso A incluye la
    // atención vinculada (nota + peso), y el caso B (sin nada vinculado)
    // no trae ese bloque en absoluto.
    // ------------------------------------------------------------------
    const bloqueA = await construirBloqueContextoCaso(pool, casoAId);
    assert(bloqueA.includes("Atenciones anteriores vinculadas"), "el bloque del caso A menciona la sección nueva");
    assert(bloqueA.includes("Vómitos ocasionales hace una semana."), "el bloque del caso A incluye la nota real");
    assert(bloqueA.includes("peso 12.1 kg"), "el bloque del caso A incluye el peso real");
    assert(!bloqueA.includes("Control de rutina"), "el bloque del caso A NO incluye la atención que no se vinculó");

    const bloqueB = await construirBloqueContextoCaso(pool, casoBId);
    assert(!bloqueB.includes("Atenciones anteriores vinculadas"), "el caso B (sin vínculos) no trae la sección nueva");
  } finally {
    for (const cId of [casoAId, casoBId]) {
      if (!cId) continue;
      await pool.query(`DELETE FROM notificaciones WHERE caso_id = $1`, [cId]).catch(() => {});
      await pool.query(`DELETE FROM mensajes WHERE caso_id = $1`, [cId]).catch(() => {});
    }
    for (const cId of citaIds) {
      await pool.query(`UPDATE citas SET caso_id = NULL WHERE id = $1`, [cId]).catch(() => {});
    }
    await pool.query(`DELETE FROM atenciones WHERE tenant_id = $1`, [
      tenantId || "00000000-0000-0000-0000-000000000000",
    ]).catch(() => {});
    for (const cId of [casoAId, casoBId]) {
      if (cId) await pool.query(`DELETE FROM casos WHERE id = $1`, [cId]).catch(() => {});
    }
    for (const cId of citaIds) {
      await pool.query(`UPDATE notificaciones SET cita_id = NULL WHERE cita_id = $1`, [cId]).catch(() => {});
      await pool.query(`DELETE FROM citas WHERE id = $1`, [cId]).catch(() => {});
    }
    if (agenteId && tenantId) {
      await pool.query(`DELETE FROM tenant_agentes WHERE tenant_id = $1 AND agente_id = $2`, [tenantId, agenteId]).catch(
        () => {}
      );
    }
    if (agenteId && personaId) {
      await pool.query(`DELETE FROM medico_agente WHERE persona_id = $1 AND agente_id = $2`, [personaId, agenteId]).catch(
        () => {}
      );
    }
    if (pacienteId) await pool.query(`DELETE FROM pacientes WHERE id = $1`, [pacienteId]).catch(() => {});
    if (propietarioId) await pool.query(`DELETE FROM propietarios WHERE id = $1`, [propietarioId]).catch(() => {});
    if (personaId) {
      await pool.query(`DELETE FROM bitacora_auditoria WHERE persona_id = $1`, [personaId]).catch(() => {});
      await pool.query(`DELETE FROM personas WHERE id = $1`, [personaId]).catch(() => {});
    }
    if (tenantId) await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => {});
    if (kcUserId) await eliminarUsuarioKeycloak(kcUserId).catch(() => {});

    console.log(`\n${assertOk} OK, ${assertFail} FAIL`);
    await pool.end();
  }
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
