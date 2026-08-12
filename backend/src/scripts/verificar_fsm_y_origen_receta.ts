import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";
import { almacenamientoPublico } from "../almacenamiento";

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
  let kcUserId = "";
  const email = `verif.fsm.${SUFIJO}@example.com`;

  try {
    const tenantRes = await pool.query(
      `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
      [`Clínica Verif FSM ${SUFIJO}`]
    );
    tenantId = tenantRes.rows[0].id;

    kcUserId = await crearUsuarioKeycloak({
      email,
      nombreCompleto: `Dra. Verif FSM ${SUFIJO}`,
      password: "Vp" + SUFIJO + "!1",
      tenantId,
      rol: "VETERINARIO",
    });

    const personaRes = await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
       VALUES ($1, 'Dra. Verif FSM', $2, 'x', true, false, $3, 'COL-888')
       RETURNING id`,
      [tenantId, email, kcUserId]
    );
    personaId = personaRes.rows[0].id;

    const propRes = await pool.query(
      `INSERT INTO propietarios (tenant_id, nombre, telefono, email) VALUES ($1, 'Propietario Verif FSM', '00000000', $2) RETURNING id`,
      [tenantId, `prop.fsm.${SUFIJO}@example.com`]
    );
    propietarioId = propRes.rows[0].id;

    const pacRes = await pool.query(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, estado) VALUES ($1, $2, 'Toby FSM', 'Canino', 'activo') RETURNING id`,
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

    const pngMinimo = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const claveLogo = `logos/verif-fsm-${SUFIJO}.png`;
    await almacenamientoPublico.guardar(claveLogo, pngMinimo, "image/png");
    await pool.query(`UPDATE tenants SET logo_url = $1 WHERE id = $2`, [claveLogo, tenantId]);

    const tokenData = await obtenerTokenParaUsuario(email, "Vp" + SUFIJO + "!1");
    const token = tokenData.access_token;

    // Helper: crea una cita y la mueve a un estado dado, respetando la
    // máquina real (nunca escribe estado directo por SQL).
    async function crearCitaEnEstado(hora: string, estadoDestino: string): Promise<string> {
      const { json } = await fetchJson("/citas", {
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
      const citaId = json.cita.id;
      citaIds.push(citaId);
      const cadena = ["programada", "confirmada", "registrada", "en_consulta", "completada"];
      const destinoIdx = cadena.indexOf(estadoDestino);
      for (let i = 1; i <= destinoIdx; i++) {
        await fetchJson(`/citas/${citaId}/estado`, {
          method: "PATCH",
          token,
          body: JSON.stringify({ estado: cadena[i] }),
        });
      }
      return citaId;
    }

    // ------------------------------------------------------------------
    // Escenario A — cita recién creada ('programada'), caso walk-in: tras
    // la decisión del usuario ("Ampliar las transiciones"), programada→
    // completada es ahora una transición válida, así que guardarAtencion
    // debe completar la cita pasando por esa transición real (no saltarla).
    // ------------------------------------------------------------------
    const citaProgramada = await crearCitaEnEstado("08:00", "programada");
    const atA = await fetchJson("/atenciones", { method: "POST", token, body: JSON.stringify({ citaId: citaProgramada }) });
    const guardarA = await fetchJson(`/atenciones/${atA.json.atencion.id}`, {
      method: "PUT",
      token,
      body: JSON.stringify({ notaMedica: "Nota sobre cita programada (walk-in)" }),
    });
    assert(guardarA.status === 200, "cita 'programada': guardar la atención SÍ procede (transición ampliada)");
    const estadoTrasA = await pool.query(`SELECT estado FROM citas WHERE id = $1`, [citaProgramada]);
    assert(estadoTrasA.rows[0].estado === "completada", "la cita queda 'completada' tras la transición ampliada");

    // ------------------------------------------------------------------
    // Escenario B — cita en 'en_consulta': transición válida hoy, debe
    // funcionar y completar.
    // ------------------------------------------------------------------
    const citaEnConsulta = await crearCitaEnEstado("09:00", "en_consulta");
    const atB = await fetchJson("/atenciones", { method: "POST", token, body: JSON.stringify({ citaId: citaEnConsulta }) });
    const guardarB = await fetchJson(`/atenciones/${atB.json.atencion.id}`, {
      method: "PUT",
      token,
      body: JSON.stringify({ notaMedica: "Nota sobre cita en consulta" }),
    });
    assert(guardarB.status === 200, "cita 'en_consulta': guardar la atención SÍ procede (transición válida)");
    const estadoTrasB = await pool.query(`SELECT estado FROM citas WHERE id = $1`, [citaEnConsulta]);
    assert(estadoTrasB.rows[0].estado === "completada", "la cita queda 'completada' tras la transición válida");

    // ------------------------------------------------------------------
    // Escenario C — cita 'cancelada': terminal, sin salida. Debe
    // rechazar — "probablemente un error del usuario".
    // ------------------------------------------------------------------
    const citaCancelResult = await fetchJson("/citas", {
      method: "POST",
      token,
      body: JSON.stringify({
        pacienteId,
        medicoId: personaId,
        fecha: new Date().toISOString().slice(0, 10),
        horaInicio: "10:00",
        duracionMinutos: 30,
      }),
    });
    const citaCancelada = citaCancelResult.json.cita.id;
    citaIds.push(citaCancelada);
    await fetchJson(`/citas/${citaCancelada}/estado`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ estado: "cancelada", motivoCancelacion: "Prueba" }),
    });
    const atC = await fetchJson("/atenciones", { method: "POST", token, body: JSON.stringify({ citaId: citaCancelada }) });
    const guardarC = await fetchJson(`/atenciones/${atC.json.atencion.id}`, {
      method: "PUT",
      token,
      body: JSON.stringify({ notaMedica: "Nota sobre cita cancelada" }),
    });
    assert(guardarC.status === 409, "cita 'cancelada': guardar la atención se RECHAZA (409)");

    // ------------------------------------------------------------------
    // Escenario D — reeditar una atención cuya cita YA está completada:
    // debe seguir funcionando (idempotente, no vuelve a exigir transición).
    // ------------------------------------------------------------------
    const guardarD = await fetchJson(`/atenciones/${atB.json.atencion.id}`, {
      method: "PUT",
      token,
      body: JSON.stringify({ notaMedica: "Nota corregida después de completar" }),
    });
    assert(guardarD.status === 200, "reeditar una atención ya completada sigue funcionando (idempotente)");

    // ------------------------------------------------------------------
    // Distinción visible de origen de receta: con_visita true/false.
    // ------------------------------------------------------------------
    const nuevoMed = await pool.query(
      `INSERT INTO medicamentos (tenant_id, nombre, presentacion) VALUES ($1, 'Medicamento Verif FSM', 'Comprimidos') RETURNING id`,
      [tenantId]
    );
    const medicamentoId = nuevoMed.rows[0].id;

    // Receta "con visita" — desde la atención B (ya completada).
    const recetaConVisita = await fetchJson(`/atenciones/${atB.json.atencion.id}/recetas`, {
      method: "POST",
      token,
      body: JSON.stringify({
        items: [{ medicamentoId, dosis: "1", frecuencia: "12h", duracion: "5 días", viaAdministracion: "oral" }],
      }),
    });
    await fetch(`${BASE}/recetas/${recetaConVisita.json.receta.id}/emitir`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    // Receta "ajuste sin visita" — necesita un caso. Lo creamos y emitimos
    // directo sin pasar por ninguna atención.
    const casoRes = await fetchJson("/casos", {
      method: "POST",
      token,
      body: JSON.stringify({ pacienteId, agenteId, motivoConsulta: "Motivo verif FSM" }),
    });
    const casoId = casoRes.json.caso.id;
    const recetaAjuste = await fetchJson(`/casos/${casoId}/recetas`, {
      method: "POST",
      token,
      body: JSON.stringify({
        items: [{ medicamentoId, dosis: "2", frecuencia: "24h", duracion: "3 días", viaAdministracion: "oral" }],
      }),
    });
    await fetch(`${BASE}/recetas/${recetaAjuste.json.receta.id}/emitir`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const historial = await fetchJson(`/pacientes/${pacienteId}/historial-farmacologico`, { token });
    const filaConVisita = historial.json.recetas.find((r: any) => r.id === recetaConVisita.json.receta.id);
    const filaAjuste = historial.json.recetas.find((r: any) => r.id === recetaAjuste.json.receta.id);
    assert(filaConVisita?.con_visita === true, "historial: receta desde atención marca con_visita=true");
    assert(filaAjuste?.con_visita === false, "historial: receta desde caso (sin atención) marca con_visita=false");

    // Limpieza del caso extra creado acá.
    await pool.query(`DELETE FROM notificaciones WHERE caso_id = $1`, [casoId]).catch(() => {});
    await pool.query(`DELETE FROM mensajes WHERE caso_id = $1`, [casoId]).catch(() => {});
    await pool.query(`DELETE FROM casos WHERE id = $1`, [casoId]).catch(() => {});
  } finally {
    await pool.query(`DELETE FROM receta_items WHERE receta_id IN (SELECT id FROM recetas WHERE tenant_id = $1)`, [
      tenantId || "00000000-0000-0000-0000-000000000000",
    ]).catch(() => {});
    await pool.query(`DELETE FROM recetas WHERE tenant_id = $1`, [tenantId || "00000000-0000-0000-0000-000000000000"]).catch(
      () => {}
    );
    await pool.query(`DELETE FROM atenciones WHERE tenant_id = $1`, [tenantId || "00000000-0000-0000-0000-000000000000"]).catch(
      () => {}
    );
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
