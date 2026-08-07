// Auditoría de aislamiento multi-tenant (prompt_code_auditoria_tenant) —
// Pasos 4 y 5: prueba EMPÍRICA de acceso cruzado (no solo lectura de
// código) e imputación real del consumo del motor de crédito con 2
// clínicas descartables. Sin correcciones — solo lecturas y la creación
// de datos propios, descartables, para poder intentar el cruce.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/auditoria_aislamiento_tenant.ts
import { Pool } from "pg";
import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();
let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function registrarClinica(nombre: string, numeroSufijo: string, agenteId: string, tipoIdentificacionId: string) {
  const email = `verif.aislamiento.${numeroSufijo}@vetlineai-test.com`;
  const resp = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: nombre,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${numeroSufijo}-9999`,
      nombreFiscal: nombre,
      nombreTitular: "Dra Aislamiento Test",
      email,
      telefono: "88880000",
      password: "ClaveTest123!",
      esMedico: true,
      colegiatura: `COL-AISLA-${numeroSufijo}`,
      agenteId,
    }),
  });
  const data = (await resp.json()) as any;
  if (resp.status !== 201) throw new Error(`No se pudo registrar ${nombre}: ${JSON.stringify(data)}`);
  const token = data.access_token as string;
  const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meData = (await me.json()) as any;
  const tenantId = meData.auth.tenantId as string;
  const userId = meData.auth.userId as string;
  await pool.query(`UPDATE saldos_ia SET credito_plan_usd = 20 WHERE tenant_id = $1`, [tenantId]);
  return { token, tenantId, userId, email };
}

async function crearPacienteYCaso(token: string, agenteId: string, nombrePaciente: string) {
  const respProp = await fetch(`${BASE_URL}/api/propietarios`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nombre: `Propietario de ${nombrePaciente}` }),
  });
  const propietarioId = ((await respProp.json()) as any).propietario.id;
  const respPac = await fetch(`${BASE_URL}/api/pacientes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ propietarioId, nombre: nombrePaciente, especie: "Canino" }),
  });
  const pacienteId = ((await respPac.json()) as any).paciente.id;
  const respCaso = await fetch(`${BASE_URL}/api/workspace/casos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pacienteId, agenteId, motivo: "Chequeo general de rutina." }),
  });
  const caso = ((await respCaso.json()) as any).caso;
  return { propietarioId, pacienteId, casoId: caso.id as string };
}

async function limpiarTenant(tenantId: string) {
  await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function main() {
  console.log("=".repeat(70));
  console.log("PASO 4 — Prueba empírica de acceso cruzado");
  console.log("PASO 5 — Imputación del consumo del motor de crédito");
  console.log("=".repeat(70));

  const tipoId = await pool.query(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
  );
  const tipoIdentificacionId = tipoId.rows[0].id;
  const agenteResult = await pool.query(`SELECT id FROM agentes WHERE nombre = 'Medicina General / Triage'`);
  const agenteId = agenteResult.rows[0].id;

  const clinicaA = await registrarClinica(`Clinica Aislamiento A ${sufijo}`, `${sufijo}a`, agenteId, tipoIdentificacionId);
  const clinicaB = await registrarClinica(`Clinica Aislamiento B ${sufijo}`, `${sufijo}b`, agenteId, tipoIdentificacionId);
  console.log(`Tenant A: ${clinicaA.tenantId}`);
  console.log(`Tenant B: ${clinicaB.tenantId}`);

  const casoA = await crearPacienteYCaso(clinicaA.token, agenteId, "PacienteConfidencialA");
  const casoB = await crearPacienteYCaso(clinicaB.token, agenteId, "PacienteConfidencialB");

  try {
    // -----------------------------------------------------------------
    // Fixture: una receta EMITIDA real para el paciente de A — el
    // endpoint de historial farmacológico (pacientes.routes.ts) no
    // filtra por tenant_id en su propio WHERE, depende 100% de RLS.
    // -----------------------------------------------------------------
    const medicamento = await pool.query(`SELECT id FROM medicamentos LIMIT 1`);
    const recetaResult = await pool.query(
      `INSERT INTO recetas (tenant_id, caso_id, paciente_id, medico_id, estado, emitido_en)
       VALUES ($1, $2, $3, $4, 'emitida', now()) RETURNING id`,
      [clinicaA.tenantId, casoA.casoId, casoA.pacienteId, clinicaA.userId]
    );
    await pool.query(
      `INSERT INTO receta_items (receta_id, medicamento_id, dosis, frecuencia, duracion, via_administracion)
       VALUES ($1, $2, '1 comprimido', 'cada 12 horas', '7 días', 'oral')`,
      [recetaResult.rows[0].id, medicamento.rows[0].id]
    );

    // -----------------------------------------------------------------
    // PASO 4a — GET /admin/casos/:id — filtra por tenant_id (no por
    // médico específico), el test más directo de aislamiento por CLÍNICA.
    // Autenticado como B, pidiendo el caso de A.
    // -----------------------------------------------------------------
    const respCasoAdmin = await fetch(`${BASE_URL}/api/admin/casos/${casoA.casoId}`, {
      headers: { Authorization: `Bearer ${clinicaB.token}` },
    });
    assert(
      respCasoAdmin.status === 404,
      `GET /admin/casos/:id de OTRA clínica devuelve 404 (no el dato)`,
      { status: respCasoAdmin.status }
    );

    // -----------------------------------------------------------------
    // PASO 4b — GET /workspace/casos/:id — autenticado como B, pidiendo
    // el caso de A directamente por id.
    // -----------------------------------------------------------------
    const respCasoWorkspace = await fetch(`${BASE_URL}/api/workspace/casos/${casoA.casoId}`, {
      headers: { Authorization: `Bearer ${clinicaB.token}` },
    });
    assert(
      respCasoWorkspace.status === 404,
      `GET /workspace/casos/:id de OTRA clínica devuelve 404 (no el dato)`,
      { status: respCasoWorkspace.status }
    );

    // -----------------------------------------------------------------
    // PASO 4c — GET /pacientes/:id/historial-farmacologico — SIN filtro
    // de tenant_id en el WHERE del propio endpoint (confirmado leyendo
    // el código); si RLS no aplicara de verdad, esto devolvería la
    // receta real de A. Autenticado como B, pidiendo el paciente de A.
    // -----------------------------------------------------------------
    const respHistorial = await fetch(`${BASE_URL}/api/pacientes/${casoA.pacienteId}/historial-farmacologico`, {
      headers: { Authorization: `Bearer ${clinicaB.token}` },
    });
    const dataHistorial = (await respHistorial.json()) as any;
    const filtroExplicito = Array.isArray(dataHistorial?.recetas) ? dataHistorial.recetas.length === 0 : true;
    assert(
      respHistorial.status === 200 && filtroExplicito,
      `GET /pacientes/:id/historial-farmacologico de OTRA clínica NO devuelve la receta real (sin filtro propio — depende 100% de RLS)`,
      { status: respHistorial.status, recetas: dataHistorial?.recetas?.length ?? dataHistorial }
    );

    // -----------------------------------------------------------------
    // PASO 4d — uso_api no tiene ningún endpoint que acepte un id
    // directo (no hay superficie HTTP para esta tabla) — la prueba real
    // es contra la conexión que efectivamente usa la app: el rol
    // vetplatform_app con app.tenant_id seteado a B, intentando leer una
    // fila de uso_api de A directo por id (se genera más abajo, en el
    // Paso 5, y se prueba después).
    // -----------------------------------------------------------------

    // -----------------------------------------------------------------
    // PASO 5 — mensaje real en cada clínica, y comprobación de que la
    // imputación (uso_api, saldos_ia, movimientos_credito) corresponde
    // a la clínica correcta.
    // -----------------------------------------------------------------
    console.log("\nEnviando mensaje real en Clínica A...");
    const respMsgA = await fetch(`${BASE_URL}/api/workspace/casos/${casoA.casoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clinicaA.token}` },
      body: JSON.stringify({ contenido: "Chequeo general de rutina, sin hallazgos relevantes." }),
    });
    assert(respMsgA.status === 201, "Mensaje real en Clínica A procesado", { status: respMsgA.status });

    console.log("Enviando mensaje real en Clínica B...");
    const respMsgB = await fetch(`${BASE_URL}/api/workspace/casos/${casoB.casoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clinicaB.token}` },
      body: JSON.stringify({ contenido: "Chequeo general de rutina, sin hallazgos relevantes." }),
    });
    assert(respMsgB.status === 201, "Mensaje real en Clínica B procesado", { status: respMsgB.status });

    const usoA = await pool.query(
      `SELECT id, tenant_id, costo_usd_calculado FROM uso_api WHERE caso_id = $1 ORDER BY timestamp DESC LIMIT 1`,
      [casoA.casoId]
    );
    const usoB = await pool.query(
      `SELECT id, tenant_id, costo_usd_calculado FROM uso_api WHERE caso_id = $1 ORDER BY timestamp DESC LIMIT 1`,
      [casoB.casoId]
    );
    assert(usoA.rows[0]?.tenant_id === clinicaA.tenantId, "uso_api de la Clínica A tiene tenant_id correcto (A, no B)", usoA.rows[0]);
    assert(usoB.rows[0]?.tenant_id === clinicaB.tenantId, "uso_api de la Clínica B tiene tenant_id correcto (B, no A)", usoB.rows[0]);

    const saldoA = await pool.query(`SELECT credito_plan_usd FROM saldos_ia WHERE tenant_id = $1`, [clinicaA.tenantId]);
    const saldoB = await pool.query(`SELECT credito_plan_usd FROM saldos_ia WHERE tenant_id = $1`, [clinicaB.tenantId]);
    assert(Number(saldoA.rows[0].credito_plan_usd) < 20, "El saldo de la Clínica A se descontó (no quedó en 20 intacto)", saldoA.rows[0]);
    assert(Number(saldoB.rows[0].credito_plan_usd) < 20, "El saldo de la Clínica B se descontó (no quedó en 20 intacto)", saldoB.rows[0]);

    const movA = await pool.query(
      `SELECT tenant_id FROM movimientos_credito WHERE referencia_id = $1 OR tenant_id = $2 ORDER BY creado_en DESC LIMIT 1`,
      [usoA.rows[0]?.id, clinicaA.tenantId]
    );
    const movB = await pool.query(
      `SELECT tenant_id FROM movimientos_credito WHERE referencia_id = $1 OR tenant_id = $2 ORDER BY creado_en DESC LIMIT 1`,
      [usoB.rows[0]?.id, clinicaB.tenantId]
    );
    assert(movA.rows[0]?.tenant_id === clinicaA.tenantId, "movimientos_credito de la Clínica A corresponde a A", movA.rows[0]);
    assert(movB.rows[0]?.tenant_id === clinicaB.tenantId, "movimientos_credito de la Clínica B corresponde a B", movB.rows[0]);

    // -----------------------------------------------------------------
    // PASO 4d (ahora con datos reales) — conexión real vetplatform_app +
    // app.tenant_id=B, leyendo por id la fila de uso_api que pertenece a A.
    // -----------------------------------------------------------------
    const tenantPoolDirecto = new Pool({ connectionString: process.env.TENANT_DATABASE_URL });
    const clienteDirecto = await tenantPoolDirecto.connect();
    try {
      await clienteDirecto.query("BEGIN");
      await clienteDirecto.query("SELECT set_config('app.tenant_id', $1, true)", [clinicaB.tenantId]);
      const intentoCruzado = await clienteDirecto.query(`SELECT id FROM uso_api WHERE id = $1`, [usoA.rows[0]?.id]);
      assert(
        intentoCruzado.rows.length === 0,
        "Conectado como vetplatform_app con app.tenant_id=B, la fila de uso_api de A es invisible (RLS real, no de código)",
        { filas: intentoCruzado.rows.length }
      );
      await clienteDirecto.query("ROLLBACK");
    } finally {
      clienteDirecto.release();
      await tenantPoolDirecto.end();
    }
  } finally {
    console.log("\n=== Limpieza ===");
    for (const clinica of [clinicaA, clinicaB]) {
      const personaKc = await pool.query(`SELECT keycloak_user_id FROM personas WHERE tenant_id = $1`, [clinica.tenantId]);
      for (const fila of personaKc.rows) {
        if (fila.keycloak_user_id) await eliminarUsuarioKeycloak(fila.keycloak_user_id);
      }
      await limpiarTenant(clinica.tenantId);
    }
    console.log("Tenants A y B y usuarios Keycloak eliminados.");
  }

  console.log(`\n${ok ? "PASOS 4-5: TODO OK" : "PASOS 4-5: HAY FALLOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
