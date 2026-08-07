// Verifica que el enlace real de una invitación de médico usa
// config.frontendUrl (la IP de red local), no CORS_ORIGIN, y confirma que
// el frontend responde en esa IP:puerto desde este mismo host (la prueba
// real "desde el teléfono" queda para el usuario, fuera del alcance de
// lo que un script puede verificar).
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_url_correos_lan.ts
import { pool } from "../db";
import { crearInvitacion } from "../invitaciones";
import { urlInvitacion } from "../correos";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();
let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function main() {
  const tipoId = await pool.query(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
  );
  const tipoIdentificacionId = tipoId.rows[0].id;
  const agenteResult = await pool.query(`SELECT id FROM agentes WHERE nombre = 'Medicina General / Triage'`);
  const agenteId = agenteResult.rows[0].id;

  const emailAdmin = `verif.url.${sufijo}@vetlineai-test.com`;
  const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica UrlTest ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${sufijo}-7777`,
      nombreFiscal: `Clinica UrlTest ${sufijo}`,
      nombreTitular: "Dra UrlTest",
      email: emailAdmin,
      telefono: "88887777",
      password: "ClaveTest123!",
      esMedico: true,
      colegiatura: `COL-URLTEST-${sufijo}`,
      agenteId,
    }),
  });
  const dataReg = (await respReg.json()) as any;
  if (respReg.status !== 201) {
    console.error("No se pudo registrar", dataReg);
    process.exit(1);
  }
  const me = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${dataReg.access_token}` },
  });
  const tenantId = ((await me.json()) as any).auth.tenantId as string;

  let token = "";
  try {
    const client = await pool.connect();
    let resultado;
    try {
      resultado = await crearInvitacion(
        client,
        tenantId,
        `Clinica UrlTest ${sufijo}`,
        null,
        `verif.invitado.${sufijo}@vetlineai-test.com`,
        "Dr Invitado Test"
      );
    } finally {
      client.release();
    }
    if (!resultado.ok) {
      console.error("No se pudo crear la invitación", resultado.motivo);
      process.exit(1);
    }
    token = resultado.invitacion.token;

    // Llama la misma función real que usa invitaciones.ts (no un valor
    // reconstruido a mano) — confirma que TODO el camino real usa
    // FRONTEND_URL, no un supuesto sobre cómo debería verse.
    const enlaceReal = urlInvitacion(token);
    console.log(`\nEnlace real de la invitación: ${enlaceReal}`);
    assert(enlaceReal.startsWith("http://192.168.100.94:5174/invitacion/"), "El enlace usa la IP de red local, no localhost", {
      enlaceReal,
    });

    console.log("\nProbando reachability real de esa IP:puerto desde este host...");
    try {
      const respFrontend = await fetch(enlaceReal, { signal: AbortSignal.timeout(5000) });
      assert(respFrontend.status === 200, "El frontend responde 200 en la IP de red local", {
        status: respFrontend.status,
      });
    } catch (err) {
      assert(false, "No se pudo conectar al frontend por la IP de red local", err instanceof Error ? err.message : err);
    }
  } finally {
    console.log("\n=== Limpieza ===");
    const personaKc = await pool.query(`SELECT keycloak_user_id FROM personas WHERE tenant_id = $1`, [tenantId]);
    for (const fila of personaKc.rows) {
      if (fila.keycloak_user_id) await eliminarUsuarioKeycloak(fila.keycloak_user_id);
    }
    await pool.query(`DELETE FROM invitaciones_medico WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    console.log(`Tenant ${tenantId} y usuarios Keycloak eliminados.`);
  }

  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
