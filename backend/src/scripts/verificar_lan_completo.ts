// Verificación real de los 3 valores del bloque "desarrollo con acceso
// desde la red local" (CORS_ORIGIN, FRONTEND_URL, VITE_API_URL) trabajando
// juntos: confirma que el bundle servido por la IP de red trae la URL de
// API correcta cableada, y que la API responde con los headers CORS que
// un navegador necesitaría para aceptar la respuesta desde ese origen.
// La prueba real "desde el teléfono" queda para el usuario — esto prueba
// todo lo que un script puede probar sin un segundo dispositivo físico.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_lan_completo.ts
import { pool } from "../db";
import { urlInvitacion } from "../correos";

const LAN_FRONTEND = "http://192.168.100.94:5174";
const LAN_API = "http://192.168.100.94:4000/api";
let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function main() {
  console.log("=== 1. El bundle servido por la IP de red trae la API de la IP de red cableada ===");
  const respHtml = await fetch(`${LAN_FRONTEND}/invitacion/token-inexistente`, { signal: AbortSignal.timeout(5000) });
  assert(respHtml.status === 200, "La página carga (200) desde la IP de red");
  const html = await respHtml.text();
  const scriptMatch = html.match(/src="(\/src\/main\.tsx|\/@vite\/client)"/);
  // El dev server de Vite sirve los módulos sin bundlear (ESM directo) —
  // alcanza con pedir el módulo que importa VITE_API_URL y confirmar que
  // el valor ya está sustituido en lo que el navegador recibiría.
  const respApiTs = await fetch(`${LAN_FRONTEND}/src/lib/api.ts`, { signal: AbortSignal.timeout(5000) });
  const apiTsTexto = await respApiTs.text();
  assert(
    apiTsTexto.includes("192.168.100.94:4000"),
    "src/lib/api.ts servido por la IP de red trae VITE_API_URL con la IP de red (no localhost)",
    { encontrado: apiTsTexto.includes("localhost:4000") ? "localhost:4000 (MAL)" : "192.168.100.94:4000 (bien)" }
  );

  console.log("\n=== 2. La API acepta un origen real (CORS) desde la IP de red del frontend ===");
  const respCors = await fetch(`${LAN_API}/health`, {
    headers: { Origin: LAN_FRONTEND },
    signal: AbortSignal.timeout(5000),
  });
  const allowOrigin = respCors.headers.get("access-control-allow-origin");
  assert(respCors.status === 200, "GET /api/health responde 200 pegándole por la IP de red");
  assert(allowOrigin === LAN_FRONTEND, "El header Access-Control-Allow-Origin coincide con el origen del frontend en la IP de red", {
    allowOrigin,
  });

  console.log("\n=== 3. Una invitación real, end-to-end, con el origen del teléfono simulado ===");
  const tipoId = await pool.query(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
  );
  const tipoIdentificacionId = tipoId.rows[0].id;
  const agenteResult = await pool.query(`SELECT id FROM agentes WHERE nombre = 'Medicina General / Triage'`);
  const agenteId = agenteResult.rows[0].id;
  const sufijo = Date.now();
  const emailAdmin = `verif.lan.${sufijo}@vetlineai-test.com`;

  const respReg = await fetch(`${LAN_API}/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: LAN_FRONTEND },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica LanTest ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${sufijo}-8888`,
      nombreFiscal: `Clinica LanTest ${sufijo}`,
      nombreTitular: "Dra LanTest",
      email: emailAdmin,
      telefono: "88888888",
      password: "ClaveTest123!",
      esMedico: true,
      colegiatura: `COL-LANTEST-${sufijo}`,
      agenteId,
    }),
  });
  const dataReg = (await respReg.json()) as any;
  assert(respReg.status === 201, "Registro real pegándole a la API por la IP de red, con Origin del frontend LAN", {
    status: respReg.status,
  });
  const corsRegistro = respReg.headers.get("access-control-allow-origin");
  assert(corsRegistro === LAN_FRONTEND, "La respuesta del registro trae el header CORS correcto para ese origen", {
    corsRegistro,
  });

  let tenantId = "";
  try {
    const me = await fetch(`${LAN_API}/auth/me`, {
      headers: { Authorization: `Bearer ${dataReg.access_token}`, Origin: LAN_FRONTEND },
    });
    tenantId = ((await me.json()) as any).auth.tenantId as string;

    // Invitar un segundo médico (mismo camino real que "Agregar Médico"
    // desde el panel) — su token es el enlace real que un veterinario
    // recibiría en el celular.
    const respMedicos = await fetch(`${LAN_API}/admin/medicos/invitar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dataReg.access_token}`, Origin: LAN_FRONTEND },
      body: JSON.stringify({ email: `verif.invitado.lan.${sufijo}@vetlineai-test.com`, nombre: "Dr Invitado Lan" }),
    });
    const dataMedicos = (await respMedicos.json()) as any;
    assert(respMedicos.status === 201, "Invitación real creada vía el endpoint real de admin", {
      status: respMedicos.status,
      body: dataMedicos,
    });

    if (respMedicos.status === 201) {
      const tokenReal = dataMedicos.invitacion.token as string;
      const enlaceReal = urlInvitacion(tokenReal);
      console.log(`\nEnlace real que recibiría el médico: ${enlaceReal}`);

      const respObtener = await fetch(`${LAN_API}/invitaciones/${tokenReal}`, {
        headers: { Origin: LAN_FRONTEND },
      });
      assert(respObtener.status === 200, "GET de los datos de la invitación (lo que hace la página al cargar) responde 200", {
        status: respObtener.status,
      });
      assert(
        respObtener.headers.get("access-control-allow-origin") === LAN_FRONTEND,
        "Esa respuesta también trae el header CORS correcto"
      );
    }
  } finally {
    console.log("\n=== Limpieza ===");
    if (tenantId) {
      const { eliminarUsuarioKeycloak } = await import("../keycloakAdmin");
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
  }

  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
