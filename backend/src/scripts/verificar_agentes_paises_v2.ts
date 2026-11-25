import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";
import { verificarAntesDeGenerar } from "../tarifas";
import { habilitarAgente, deshabilitarAgente } from "../cupos";

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();

async function main() {
  const limpieza: (() => Promise<void>)[] = [];
  let ok = true;
  const reportar = (nombre: string, cond: boolean, detalle?: unknown) => {
    console.log(`[${cond ? "OK" : "FALLO"}] ${nombre}`, detalle ?? "");
    if (!cond) ok = false;
  };

  // ---------------------------------------------------------------------
  // Setup: un agente descartable propio para esta verificación (no toca
  // ningún agente real del catálogo), país CR (ya habilitado), y un
  // super_admin descartable para las llamadas HTTP de platform-admin.
  // ---------------------------------------------------------------------
  const agente = await pool.query(
    `INSERT INTO agentes (nombre, slug, descripcion, icono, estado_catalogo, estado)
     VALUES ($1, $2, 'Agente de verificación descartable', 'test', 'disponible', 'activo')
     RETURNING id`,
    [`Verificación V2 ${sufijo}`, `verificacion-v2-${sufijo}`]
  );
  const agenteId = agente.rows[0].id;
  limpieza.push(async () => {
    await pool.query(`DELETE FROM agentes WHERE id = $1`, [agenteId]);
  });

  const tipoId = await pool.query(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
  );
  const tipoIdentificacionId = tipoId.rows[0].id;

  // Un agente activo cualquiera del catálogo real, solo para poder
  // registrar tenants vía el endpoint público (que valida estado='activo'
  // del agente elegido) — el agente bajo prueba (agenteId) se manipula
  // aparte, directo en tenant_agentes, sin depender de esta elección.
  const agenteActivoReal = await pool.query(`SELECT id FROM agentes WHERE estado = 'activo' AND id != $1 LIMIT 1`, [
    agenteId,
  ]);
  const agenteParaRegistro = agenteActivoReal.rows[0].id;

  async function registrarTenant(
    nombre: string,
    agenteRegistro: string = agenteParaRegistro
  ): Promise<{ tenantId: string; token: string; personaId: string }> {
    const email = `verif.v2.${nombre}.${sufijo}@vetlineai-test.com`;
    const resp = await fetch(`${BASE_URL}/api/registro-publico`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paisCodigo: "CR",
        nombreComercial: `Clinica Verif V2 ${nombre} ${sufijo}`,
        tipoPersona: "fisica",
        tipoIdentificacionId,
        numeroIdentificacion: `1-${sufijo}-${Math.floor(Math.random() * 1000)}`,
        nombreFiscal: `Clinica Verif V2 ${nombre} ${sufijo}`,
        nombreTitular: `Dr. Verif ${nombre}`,
        email,
        telefono: "88880000",
        password: "ClaveTest123!",
        esMedico: true,
        colegiatura: `COL-V2-${nombre}-${sufijo}`,
        agenteId: agenteRegistro,
      }),
    });
    const data = (await resp.json()) as any;
    if (resp.status !== 201) throw new Error(`Registro falló para ${nombre}: ${JSON.stringify(data)}`);
    const me = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const meData = (await me.json()) as any;
    return { tenantId: meData.auth.tenantId, token: data.access_token, personaId: meData.auth.userId };
  }

  // Tenant A: va a ser el que "tuvo y deshabilitó" el agente — se registra
  // CON el agente bajo prueba (agenteId), mientras todavía está 'activo'.
  const tenantA = await registrarTenant("A", agenteId);
  limpieza.push(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantA.tenantId]);
  });

  console.log("=== Escenario 1/2: discontinuar agente ===");
  await pool.query(`UPDATE agentes SET estado = 'discontinuado' WHERE id = $1`, [agenteId]);

  // Un tenant que NUNCA tuvo el agente no puede habilitarlo.
  const tenantB = await registrarTenant("B_admin_puro");
  limpieza.push(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantB.tenantId]);
  });
  // tenantB se registró con OTRO agente (el mismo agenteId discontinuado
  // no debería ni aparecer en /registro-publico/agentes) — se libera ese
  // cupo primero para que el intento de abajo falle por "discontinuado",
  // no por "sin cupo" (que también sería correcto, pero no es lo que se
  // está probando acá).
  await deshabilitarAgente(pool, tenantB.tenantId, agenteParaRegistro);
  const intentoNuevoAdoptante = await habilitarAgente(pool, tenantB.tenantId, agenteId);
  reportar(
    "Tenant que nunca tuvo el agente discontinuado NO puede habilitarlo",
    !intentoNuevoAdoptante.permitido && intentoNuevoAdoptante.motivo === "agente_discontinuado",
    intentoNuevoAdoptante
  );

  // El agente discontinuado ya no aparece en la selección de la prueba.
  const agentesPrueba = await pool.query(
    `SELECT id FROM agentes WHERE estado_catalogo = 'disponible' AND estado = 'activo' AND id = $1`,
    [agenteId]
  );
  reportar("Agente discontinuado no aparece en la selección de agentes de la prueba", agentesPrueba.rows.length === 0);

  // Tenant A (que YA lo tenía habilitado) sigue generando con normalidad
  // pese a estar discontinuado.
  const verifTenantA = await verificarAntesDeGenerar(pool, {
    tenantId: tenantA.tenantId,
    agenteId,
    tipoOperacion: "chat",
    disparadoPor: "sistema",
  });
  reportar(
    "Clínica que ya tenía el agente discontinuado sigue generando sin cambios",
    verifTenantA.permitido === true,
    verifTenantA
  );

  console.log("=== Escenario 2/2: tenant que lo tuvo y deshabilitó puede reactivarlo ===");
  const deshabilitarA = await deshabilitarAgente(pool, tenantA.tenantId, agenteId);
  reportar("Tenant A puede deshabilitar su agente (no está en mantenimiento)", deshabilitarA.permitido, deshabilitarA);
  const reactivarA = await habilitarAgente(pool, tenantA.tenantId, agenteId);
  reportar(
    "Tenant A (lo tuvo antes) SÍ puede reactivar un agente discontinuado",
    reactivarA.permitido === true,
    reactivarA
  );

  console.log("=== Escenario 3: mantenimiento bloquea generación para TODAS las clínicas ===");
  await pool.query(
    `UPDATE agentes SET estado = 'mantenimiento', motivo_mantenimiento = 'Prueba de verificación' WHERE id = $1`,
    [agenteId]
  );
  const verifMantenimientoA = await verificarAntesDeGenerar(pool, {
    tenantId: tenantA.tenantId,
    agenteId,
    tipoOperacion: "chat",
    disparadoPor: "sistema",
  });
  reportar(
    "Generación rechazada con motivo agente_en_mantenimiento (no agente_no_habilitado)",
    !verifMantenimientoA.permitido && verifMantenimientoA.motivo === "agente_en_mantenimiento",
    verifMantenimientoA
  );

  console.log("=== Escenario 4: no se puede desactivar un agente en mantenimiento ===");
  const desactivarMantenimiento = await deshabilitarAgente(pool, tenantA.tenantId, agenteId);
  reportar(
    "deshabilitarAgente rechaza con agente_en_mantenimiento",
    !desactivarMantenimiento.permitido && desactivarMantenimiento.motivo === "agente_en_mantenimiento",
    desactivarMantenimiento
  );

  console.log("=== Escenario 5: reactivar (mantenimiento -> activo) vuelve todo a la normalidad ===");
  await pool.query(
    `UPDATE agentes SET estado = 'activo', motivo_mantenimiento = NULL, retorno_estimado = NULL WHERE id = $1`,
    [agenteId]
  );
  const verifPostReactivar = await verificarAntesDeGenerar(pool, {
    tenantId: tenantA.tenantId,
    agenteId,
    tipoOperacion: "chat",
    disparadoPor: "sistema",
  });
  reportar("Tras reactivar, la generación vuelve a estar permitida", verifPostReactivar.permitido === true, verifPostReactivar);
  const limpiezaCampos = await pool.query(`SELECT motivo_mantenimiento, retorno_estimado FROM agentes WHERE id = $1`, [
    agenteId,
  ]);
  reportar(
    "Reactivar limpia motivo_mantenimiento y retorno_estimado",
    limpiezaCampos.rows[0].motivo_mantenimiento === null && limpiezaCampos.rows[0].retorno_estimado === null
  );

  // ---------------------------------------------------------------------
  // Escenario 6: inactivar país — tenants existentes siguen operando y
  // facturando igual, solo se bloquean altas nuevas. Se prueba vía
  // HTTP real con un super_admin descartable (necesita el router
  // completo: auth + gate + endpoint).
  // ---------------------------------------------------------------------
  console.log("=== Escenario 6: inactivar país + endpoints platform-admin vía HTTP real ===");
  const emailSuperAdmin = `verif.v2.superadmin.${sufijo}@vetlineai-test.com`;
  const keycloakIdSuperAdmin = await crearUsuarioKeycloak({
    email: emailSuperAdmin,
    nombreCompleto: "Verificacion SuperAdmin V2",
    password: "ClaveTest123!",
    rol: "SUPER_ADMIN",
  });
  const staffResult = await pool.query(
    // password_hash es una columna heredada de antes de Keycloak — ya no se
    // usa para autenticar (auth.ts resuelve por keycloak_user_id), pero
    // sigue siendo NOT NULL en el schema.
    `INSERT INTO staff_plataforma (nombre, email, password_hash, rol, keycloak_user_id)
     VALUES ($1, $2, 'no-usado-keycloak', 'super_admin', $3) RETURNING id`,
    ["Verificacion SuperAdmin V2", emailSuperAdmin, keycloakIdSuperAdmin]
  );
  const staffId = staffResult.rows[0].id;
  limpieza.push(async () => {
    // El middleware de auditoría registró cada PATCH hecho con este staff
    // descartable — hay que borrar esas filas antes que al propio staff
    // (fk_bitacora_staff_id no tiene CASCADE, correctamente).
    await pool.query(`DELETE FROM bitacora_auditoria WHERE staff_id = $1`, [staffId]);
    await pool.query(`DELETE FROM staff_plataforma WHERE id = $1`, [staffId]);
    await eliminarUsuarioKeycloak(keycloakIdSuperAdmin);
  });

  const tokensSuperAdmin = await obtenerTokenParaUsuario(emailSuperAdmin, "ClaveTest123!");
  const tokenSuperAdmin = tokensSuperAdmin.access_token;

  // 6a — PATCH /agentes/:id/estado vía HTTP real (discontinuar + mantenimiento + reactivar).
  const respDiscontinuar = await fetch(`${BASE_URL}/api/platform-admin/agentes/${agenteId}/estado`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({ estado: "discontinuado" }),
  });
  reportar("PATCH /platform-admin/agentes/:id/estado (discontinuar) responde 200", respDiscontinuar.status === 200);

  const respMantenimientoSinMotivo = await fetch(`${BASE_URL}/api/platform-admin/agentes/${agenteId}/estado`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({ estado: "mantenimiento" }),
  });
  reportar(
    "Mantenimiento SIN motivo se rechaza (400)",
    respMantenimientoSinMotivo.status === 400
  );

  const respMantenimientoConMotivo = await fetch(`${BASE_URL}/api/platform-admin/agentes/${agenteId}/estado`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({ estado: "mantenimiento", motivoMantenimiento: "Prueba HTTP" }),
  });
  reportar("Mantenimiento CON motivo se acepta (200)", respMantenimientoConMotivo.status === 200);

  const respReactivarHttp = await fetch(`${BASE_URL}/api/platform-admin/agentes/${agenteId}/estado`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({ estado: "activo" }),
  });
  reportar("Reactivar vía HTTP responde 200", respReactivarHttp.status === 200);

  // 6b — Inactivar país CR, confirmar tenants existentes siguen igual, y
  // que un registro NUEVO ahora entra en lista de espera.
  const detalleAntes = await fetch(`${BASE_URL}/api/platform-admin/paises/CR`, {
    headers: { Authorization: `Bearer ${tokenSuperAdmin}` },
  });
  const detalleAntesData = (await detalleAntes.json()) as any;
  reportar(
    "GET /paises/CR devuelve conteo de clínicas (clinicas.total > 0)",
    detalleAntes.status === 200 && detalleAntesData.clinicas?.total > 0,
    detalleAntesData.clinicas
  );

  // Se captura el estado que CR tenía ANTES de tocarlo: lo que hay que
  // dejar al terminar es eso, no un valor supuesto.
  const estadoCrOriginal = (await pool.query(`SELECT estado FROM paises WHERE codigo_iso = 'CR'`))
    .rows[0]?.estado as string | undefined;

  const respInactivar = await fetch(`${BASE_URL}/api/platform-admin/paises/CR/estado`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({ estado: "no_disponible", motivo: "Verificación V2" }),
  });
  reportar("PATCH /paises/CR/estado (inactivar) responde 200", respInactivar.status === 200);

  // El tenant A (existente) sigue pudiendo generar con su agente propio
  // (no el de esta prueba, que ya quedó reactivado arriba) — confirma que
  // el estado del país no afecta el consumo de tenants existentes.
  const verifTenantAPostInactivarPais = await verificarAntesDeGenerar(pool, {
    tenantId: tenantA.tenantId,
    agenteId,
    tipoOperacion: "chat",
    disparadoPor: "sistema",
  });
  reportar(
    "Tenant existente sigue pudiendo generar tras inactivar el país",
    verifTenantAPostInactivarPais.permitido === true,
    verifTenantAPostInactivarPais
  );

  // Un registro NUEVO contra CR ahora debe rechazarse (entra a lista de espera).
  const respRegistroNuevoPaisInactivo = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica Verif V2 rechazo pais ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId,
      numeroIdentificacion: `1-${sufijo}-9999`,
      nombreFiscal: `Clinica Verif V2 rechazo pais ${sufijo}`,
      nombreTitular: "Dr. Verif Rechazo",
      email: `verif.v2.rechazo.${sufijo}@vetlineai-test.com`,
      telefono: "88880001",
      password: "ClaveTest123!",
      esMedico: true,
      colegiatura: `COL-V2-RECHAZO-${sufijo}`,
      agenteId,
    }),
  });
  const dataRechazo = (await respRegistroNuevoPaisInactivo.json()) as any;
  reportar(
    "Registro nuevo contra país inactivo entra a lista de espera (202, no crea tenant)",
    respRegistroNuevoPaisInactivo.status === 202 && dataRechazo.listaEspera === true,
    { status: respRegistroNuevoPaisInactivo.status, data: dataRechazo }
  );

  // Devolver CR al estado en que estaba.
  //
  // ESTO ES CRITICO Y ANTES FALLABA EN SILENCIO. Este escenario inactiva
  // Costa Rica, que es el unico pais habilitado del ambiente de
  // desarrollo; mientras quede inactivo, TODO verificador que registre
  // una clinica recibe 202 ("entra a lista de espera") y falla por un
  // motivo que no tiene nada que ver con lo que esta probando. Paso: en
  // la sesion nocturna del 2026-11-25, cinco verificadores que venian
  // pasando empezaron a fallar y el rastro llevaba hasta aca.
  //
  // La version anterior disparaba el PATCH de re-habilitacion y
  // descartaba la respuesta. Y ese PATCH NO PUEDE funcionar: el endpoint
  // exige el checklist de habilitacion (pasarela, impuesto vigente,
  // proveedor de facturacion, idioma) y CR en desarrollo tiene
  // proveedor_facturacion en NULL, asi que devuelve 400. O sea que CR
  // estaba habilitado en dev en un estado que la propia API no permite
  // crear: alguien lo puso directo en la base. Eso es un defecto del
  // AMBIENTE, no de este script, y queda reportado.
  //
  // Mientras siga asi, la restauracion se hace por SQL y lo dice en voz
  // alta en cada corrida, en vez de dejar el ambiente roto.
  if (estadoCrOriginal) {
    const respRestaurar = await fetch(`${BASE_URL}/api/platform-admin/paises/CR/estado`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenSuperAdmin}` },
      body: JSON.stringify({ estado: estadoCrOriginal }),
    });

    if (respRestaurar.status !== 200) {
      const detalle = await respRestaurar.json().catch(() => null);
      console.log(
        `
  AVISO: la API rechazo devolver CR a '${estadoCrOriginal}' (HTTP ${respRestaurar.status}). ` +
          `Se restaura por SQL para no dejar el ambiente roto.
  Motivo: ${JSON.stringify(detalle)}
` +
          `  Significa que CR estaba en '${estadoCrOriginal}' sin cumplir el checklist de habilitacion: ` +
          `le falta completar proveedor_facturacion en la tabla paises.`
      );
      await pool.query(`UPDATE paises SET estado = $1 WHERE codigo_iso = 'CR'`, [estadoCrOriginal]);
    }

    const estadoFinalCr = (
      await pool.query(`SELECT estado FROM paises WHERE codigo_iso = 'CR'`)
    ).rows[0]?.estado;
    reportar(
      `CR volvio a quedar en '${estadoCrOriginal}' (si no, rompe a todos los demas verificadores)`,
      estadoFinalCr === estadoCrOriginal,
      { estadoEnBase: estadoFinalCr }
    );
  }

  console.log("\n=== Limpieza ===");
  for (const fn of limpieza.reverse()) {
    await fn();
  }
  console.log("Limpieza completa.");

  console.log(`\n${ok ? "TODOS LOS ESCENARIOS PASARON" : "HAY ESCENARIOS FALLIDOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
