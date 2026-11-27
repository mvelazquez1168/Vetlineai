// Verificación del prompt 04 POR HTTP REAL, con usuarios reales de
// Keycloak y roles reales.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_administracion_04_http.ts
//
// POR QUÉ EXISTE, además del verificador de módulos: ese prueba las
// funciones —`permisosDePersona`, `exigirPermiso` con un `req` armado a
// mano—, y deja sin cubrir justo la cadena que decide si una persona
// entra o no: **token de Keycloak → `resolverPrincipal` → `req.auth` →
// la guarda de la ruta**. Un error ahí no lo ve ninguna aserción de
// módulo, y es el que deja a la recepción sin poder trabajar.
//
// CÓMO CONSIGUE LOS USUARIOS: por el camino de verdad, la invitación.
// Crea una invitación con roles, la acepta contra el endpoint público
// —que crea el usuario en Keycloak y devuelve sus tokens— y usa esos
// tokens. De paso queda probado el camino nuevo de alta de personal.
//
// NO TOCA NINGÚN USUARIO EXISTENTE: crea los suyos con correos
// `probe-04-http-*` y los borra al terminar, en Keycloak y en la base.
// Es re-corrible.

import { pool } from "../db";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { crearInvitacion } from "../invitaciones";
import {
  buscarUsuarioKeycloakPorEmail,
  eliminarUsuarioKeycloak,
} from "../keycloakAdmin";

const PREFIJO = "probe-04-http";
const API = "http://localhost:4000/api";
const CLAVE = "ProbeHttp-04-2026!";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

const correoDe = (quien: string) => `${PREFIJO}-${quien}@probe.test`;

async function limpiar() {
  for (const quien of ["recep", "jefa", "vet"]) {
    const id = await buscarUsuarioKeycloakPorEmail(correoDe(quien));
    if (id) await eliminarUsuarioKeycloak(id);
  }
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

/** Invita con esos roles, acepta la invitación y devuelve el token. */
async function altaPorInvitacion(
  tenantId: string,
  quien: string,
  nombre: string,
  roles: string[],
  invitadoPor: string | null
): Promise<string> {
  const inv = await crearInvitacion(
    pool,
    tenantId,
    `${PREFIJO} clínica`,
    invitadoPor,
    correoDe(quien),
    nombre,
    roles
  );
  if (!inv.ok) throw new Error(`no se pudo invitar a ${quien}: ${inv.motivo}`);

  const resp = await fetch(`${API}/invitaciones/${inv.invitacion.token}/aceptar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre,
      // La colegiatura solo la manda quien es médico. Para la recepción
      // va ausente a propósito: es el caso que antes era imposible.
      colegiatura: roles.includes("medico") ? `VET-${quien.toUpperCase()}` : undefined,
      password: CLAVE,
    }),
  });
  const cuerpo = (await resp.json()) as {
    autoLogin?: boolean;
    access_token?: string;
    error?: string;
  };
  assert(resp.status === 201, `${nombre} completa su alta por la invitación`, cuerpo.error ?? "");
  if (!cuerpo.access_token) {
    throw new Error(`sin token para ${quien}: ${JSON.stringify(cuerpo)}`);
  }
  return cuerpo.access_token;
}

async function llamar(
  token: string,
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown } = {}
): Promise<{ estado: number; datos: Record<string, unknown> }> {
  const resp = await fetch(`${API}${ruta}`, {
    method: opciones.metodo ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opciones.cuerpo ? { "Content-Type": "application/json" } : {}),
    },
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  const datos = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return { estado: resp.status, datos };
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_administracion_04_http");

  // Que el backend esté arriba antes de empezar: si no, todas las
  // aserciones fallarían por la misma razón y el informe diría cualquier
  // cosa.
  const salud = await fetch(`${API}/health`).catch(() => null);
  if (!salud || !salud.ok) {
    console.log(
      "[FALLO] el backend no responde en http://localhost:4000 — este verificador necesita el servidor arriba"
    );
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
    await pool.end();
    return;
  }

  await limpiar();

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@04http.test','CR') RETURNING id`,
      [`${PREFIJO} clínica`]
    )
  ).rows[0].id;

  // Un médico para poder agendar: la cita necesita a quién.
  const medicoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico,
                             es_admin_clinica, colegiatura, estado)
       VALUES ($1,'Médico de guardia',$2,'x',true,false,'VET-GUARDIA','activo') RETURNING id`,
      [tenantId, correoDe("guardia")]
    )
  ).rows[0].id;

  // Un paciente con su dueño.
  const propietarioId = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, telefono)
       VALUES ($1,'Dueño de prueba','88880404') RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  const pacienteId = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
       VALUES ($1,$2,'Probe','perro',904001) RETURNING id`,
      [tenantId, propietarioId]
    )
  ).rows[0].id;

  console.log("\n=== El alta de personal por invitación, con roles ===");
  const tokenJefa = await altaPorInvitacion(
    tenantId,
    "jefa",
    "Jefa de la clínica",
    ["admin_clinica"],
    null
  );
  const tokenRecep = await altaPorInvitacion(
    tenantId,
    "recep",
    "Recepción de prueba",
    ["recepcion"],
    null
  );

  const recepEnBase = await pool.query<{ colegiatura: string | null; es_medico: boolean }>(
    `SELECT colegiatura, es_medico FROM personas WHERE email = $1`,
    [correoDe("recep")]
  );
  igual(
    recepEnBase.rows[0]?.colegiatura,
    null,
    "la recepción entró SIN colegiatura: es lo que antes era imposible"
  );
  igual(recepEnBase.rows[0]?.es_medico, false, "y no es médica");

  console.log("\n=== Los permisos que llegan en una sesión real ===");
  const misRecep = await llamar(tokenRecep, "/clinica/mis-permisos");
  igual(misRecep.estado, 200, "la recepción entra");
  igual(misRecep.datos.roles, ["recepcion"], "con su rol de la clínica");
  const permisosRecep = misRecep.datos.permisos as string[];
  assert(
    Array.isArray(permisosRecep) && permisosRecep.length > 0,
    "y con sus permisos: llegan como lista y no como objeto vacío",
    permisosRecep
  );
  assert(permisosRecep.includes("agenda.editar"), "puede agendar");
  assert(!permisosRecep.includes("caja.anular"), "y no puede anular");
  assert(
    !permisosRecep.includes("expediente.escribir"),
    "ni escribir en el expediente: eso es del médico"
  );

  // /auth/me es la que usa el navegador al iniciar sesión: ahí estaba el
  // defecto de `permisos: {}`.
  const me = await llamar(tokenRecep, "/auth/me");
  const auth = me.datos.auth as { permisos?: unknown; roles?: unknown; pantallaDelRol?: unknown };
  assert(
    Array.isArray(auth.permisos) && (auth.permisos as string[]).includes("agenda.ver"),
    "y /auth/me los devuelve también: es de donde el navegador los lee",
    auth.permisos
  );
  igual(auth.pantallaDelRol, "/agenda", "la recepción aterriza en la agenda, no en Médicos");

  const misJefa = await llamar(tokenJefa, "/clinica/mis-permisos");
  igual((misJefa.datos.roles as string[]) ?? [], ["admin_clinica"], "la jefa entra como administradora");
  assert(
    (misJefa.datos.permisos as string[]).includes("caja.anular"),
    "y ella sí puede anular"
  );

  console.log("\n=== Lo que cada rol puede y no puede, por la API ===");
  const recepConfigura = await llamar(tokenRecep, "/clinica/politicas", {
    metodo: "PUT",
    cuerpo: { clave: "descuento.maximo_sin_autorizacion", valor: "80" },
  });
  igual(recepConfigura.estado, 403, "la recepción no configura las políticas de la clínica");
  igual(
    recepConfigura.datos.permisoFaltante,
    "clinica.configurar",
    "y la respuesta dice qué permiso le falta"
  );

  const recepLee = await llamar(tokenRecep, "/clinica/politicas");
  igual(recepLee.estado, 200, "pero sí puede LEERLAS: necesita saber qué rige");

  const jefaConfigura = await llamar(tokenJefa, "/clinica/politicas", {
    metodo: "PUT",
    cuerpo: { clave: "descuento.maximo_sin_autorizacion", valor: "15" },
  });
  igual(jefaConfigura.estado, 200, "la jefa sí configura");

  const recepCambiaRoles = await llamar(tokenRecep, `/clinica/personas/${medicoId}/roles`, {
    metodo: "PUT",
    cuerpo: { roles: ["admin_clinica"] },
  });
  igual(recepCambiaRoles.estado, 403, "y no puede darse permisos a sí misma por la puerta de atrás");

  const recepVeElEquipo = await llamar(tokenRecep, "/clinica/personas");
  igual(recepVeElEquipo.estado, 200, "ver quién trabaja en la clínica sí es de todo el equipo");

  console.log("\n=== El horario de la clínica, por la API ===");
  // Un domingo: la clínica nace cerrada ese día.
  const domingo = "2026-12-06";
  const lunes = "2026-12-07";

  const enDomingo = await llamar(tokenRecep, "/citas", {
    metodo: "POST",
    cuerpo: {
      pacienteId,
      medicoId,
      fecha: domingo,
      horaInicio: "10:00",
      duracionMinutos: 30,
    },
  });
  igual(enDomingo.estado, 409, "agendar un domingo se frena");
  igual(enDomingo.datos.fueraDeHorario, true, "y se dice que es por el horario");
  assert(
    String(enDomingo.datos.error ?? "").includes("no abre los domingos"),
    "con el motivo en castellano",
    enDomingo.datos.error
  );
  igual(
    enDomingo.datos.puedeForzar,
    false,
    "y la recepción NO puede autorizarlo: el botón no se le ofrece"
  );

  const recepFuerza = await llamar(tokenRecep, "/citas", {
    metodo: "POST",
    cuerpo: {
      pacienteId,
      medicoId,
      fecha: domingo,
      horaInicio: "10:00",
      duracionMinutos: 30,
      forzarFueraDeHorario: { motivo: "porque quiero" },
    },
  });
  igual(recepFuerza.estado, 403, "y si lo manda igual por la API, se rechaza");

  const jefaVe = await llamar(tokenJefa, "/citas", {
    metodo: "POST",
    cuerpo: {
      pacienteId,
      medicoId,
      fecha: domingo,
      horaInicio: "10:00",
      duracionMinutos: 30,
    },
  });
  igual(jefaVe.estado, 409, "a la jefa también se le avisa primero");
  igual(jefaVe.datos.puedeForzar, true, "pero a ella sí se le ofrece autorizarlo");

  const jefaSinMotivo = await llamar(tokenJefa, "/citas", {
    metodo: "POST",
    cuerpo: {
      pacienteId,
      medicoId,
      fecha: domingo,
      horaInicio: "10:00",
      duracionMinutos: 30,
      forzarFueraDeHorario: { motivo: "" },
    },
  });
  igual(jefaSinMotivo.estado, 400, "sin motivo no se autoriza: el motivo queda registrado");

  const jefaAutoriza = await llamar(tokenJefa, "/citas", {
    metodo: "POST",
    cuerpo: {
      pacienteId,
      medicoId,
      fecha: domingo,
      horaInicio: "10:00",
      duracionMinutos: 30,
      forzarFueraDeHorario: { motivo: "El dueño viaja el lunes" },
    },
  });
  igual(jefaAutoriza.estado, 201, "con permiso y motivo, la cita se agenda");

  const guardada = await pool.query<{
    fuera_de_horario_motivo: string | null;
    fuera_de_horario_por: string | null;
  }>(
    `SELECT fuera_de_horario_motivo, fuera_de_horario_por FROM citas
      WHERE tenant_id = $1 AND fecha = $2::date`,
    [tenantId, domingo]
  );
  igual(
    guardada.rows[0]?.fuera_de_horario_motivo,
    "El dueño viaja el lunes",
    "y la cita guarda POR QUÉ se hizo la excepción"
  );
  const jefaId = (
    await pool.query<{ id: string }>(`SELECT id FROM personas WHERE email = $1`, [correoDe("jefa")])
  ).rows[0].id;
  igual(guardada.rows[0]?.fuera_de_horario_por, jefaId, "y quién la autorizó");

  // Dentro del horario, la recepción agenda sin ningún aviso.
  const enHorario = await llamar(tokenRecep, "/citas", {
    metodo: "POST",
    cuerpo: {
      pacienteId,
      medicoId,
      fecha: lunes,
      horaInicio: "10:00",
      duracionMinutos: 30,
    },
  });
  igual(enHorario.estado, 201, "un lunes a las 10 la recepción agenda sin pedirle nada a nadie");

  // Y el feriado, que es el caso del prompt.
  const navidad = await llamar(tokenRecep, "/citas", {
    metodo: "POST",
    cuerpo: {
      pacienteId,
      medicoId,
      fecha: "2026-12-25",
      horaInicio: "10:00",
      duracionMinutos: 30,
    },
  });
  igual(navidad.estado, 409, "el 25 de diciembre tampoco");
  assert(
    String(navidad.datos.error ?? "").includes("Navidad"),
    "y el motivo nombra el feriado",
    navidad.datos.error
  );

  console.log("\n=== La configuración de la agenda, por la API ===");
  const tipos = await llamar(tokenRecep, "/clinica/tipos-cita");
  igual(tipos.estado, 200, "los tipos de cita se leen desde recepción");
  assert(
    (tipos.datos.tipos as unknown[]).length >= 6,
    "y la clínica nueva nació con los seis",
    (tipos.datos.tipos as unknown[]).length
  );

  const recepEditaTipo = await llamar(tokenRecep, "/clinica/tipos-cita", {
    metodo: "POST",
    cuerpo: { nombre: "Inventado", duracionMinutos: 10 },
  });
  igual(recepEditaTipo.estado, 403, "pero no los edita");

  const jefaEditaTipo = await llamar(tokenJefa, "/clinica/tipos-cita", {
    metodo: "POST",
    cuerpo: { nombre: "Urgencia nocturna", duracionMinutos: 45 },
  });
  igual(jefaEditaTipo.estado, 201, "la jefa sí");

  const jefaAbreDomingo = await llamar(tokenJefa, "/clinica/horario/0", {
    metodo: "PUT",
    cuerpo: { abierto: true, bloques: [{ desde: "09:00", hasta: "12:00" }] },
  });
  igual(jefaAbreDomingo.estado, 200, "y puede abrir los domingos");

  const domingoAbierto = await llamar(tokenRecep, "/citas", {
    metodo: "POST",
    cuerpo: {
      pacienteId,
      medicoId,
      fecha: domingo,
      horaInicio: "10:00",
      duracionMinutos: 30,
    },
  });
  igual(
    domingoAbierto.estado,
    201,
    "y con el domingo abierto, la recepción agenda ahí sin autorización de nadie"
  );


  console.log("\n=== Una clínica que solo usa Vetline Ai sigue funcionando ===");
  //
  // Esta clínica de prueba NO tiene ningún módulo de gestión habilitado
  // (`tenant_modulos` vacío): es exactamente el caso de las clínicas que
  // hoy están en producción. El prompt pide comprobar que el modelo de
  // roles no les cambia nada.
  {
    const tokenVet = await altaPorInvitacion(
      tenantId,
      "vet",
      "Veterinaria de prueba",
      ["medico"],
      null
    );

    const mis = await llamar(tokenVet, "/clinica/mis-permisos");
    igual(mis.datos.roles, ["medico"], "la médica entra con su rol");
    assert(
      (mis.datos.permisos as string[]).includes("expediente.escribir"),
      "y puede escribir en el expediente"
    );
    assert(
      !(mis.datos.permisos as string[]).includes("clinica.configurar"),
      "y no configura la clínica: eso es del administrador"
    );

    const me = await llamar(tokenVet, "/auth/me");
    igual(
      (me.datos.auth as { pantallaDelRol?: string }).pantallaDelRol,
      "/workspace",
      "la médica aterriza en su área de trabajo, como antes del 04"
    );
    igual((me.datos.modulos as unknown[]).length, 0, "y la clínica no tiene módulos de gestión");

    const workspace = await llamar(tokenVet, "/workspace/me");
    igual(workspace.estado, 200, "su área de trabajo responde: nada cambió para ella");

    const expediente = await llamar(tokenVet, `/expediente/pacientes/${pacienteId}`);
    igual(expediente.estado, 200, "y el expediente del paciente también");

    // La recepción no entra al área de trabajo del médico: esa guarda es
    // de médicos y sigue siendo de médicos.
    const recepEnWorkspace = await llamar(tokenRecep, "/workspace/me");
    igual(recepEnWorkspace.estado, 403, "la recepción no entra al área de trabajo del médico");
  }

  await limpiar();
  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS"}`);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = ok ? 0 : 1;
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await limpiar().catch(() => {});
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
  await pool.end().catch(() => {});
});
