// Abrir una atención desde la ficha del paciente, por HTTP, de punta a
// punta — prueba de regresión del bloqueante 1.1 de la revisión del
// 2026-11-27 («al pulsar Registrar atención la pantalla no se despliega»).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_atencion_extremo_a_extremo.ts
//
// POR QUÉ POR HTTP Y NO LLAMANDO AL DOMINIO: el dominio funcionaba. Se
// probó primero —`abrirAtencion()` devolvía la atención sin un error— y
// la pantalla igual no se desplegaba. Un verificador que llama a la
// función no puede ver eso: lo que falla está en el camino que recorre
// el navegador, que son **las cinco llamadas que la pestaña hace al
// montarse** más la de abrir.
//
// Crea su propio médico con un usuario descartable de Keycloak, por el
// flujo real de invitación, y lo borra al terminar. NUNCA toca las
// credenciales de un usuario existente.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { crearInvitacion } from "../invitaciones";
import { buscarUsuarioKeycloakPorEmail, eliminarUsuarioKeycloak } from "../keycloakAdmin";

const API = process.env.API_URL ?? "http://localhost:4000/api";
const PREFIJO = "probe-atencion-e2e";
const CLAVE = "ProbeAtencion2026!";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

const correo = `${PREFIJO}-vet@probe.test`;

async function limpiar() {
  const id = await buscarUsuarioKeycloakPorEmail(correo);
  if (id) await eliminarUsuarioKeycloak(id);
  await pool.query(
    `DELETE FROM uso_api WHERE tenant_id IN (SELECT id FROM tenants WHERE nombre LIKE $1)`,
    [`${PREFIJO}%`]
  );
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

interface Respuesta {
  estado: number;
  cuerpo: any;
  ms: number;
}

async function llamar(
  token: string,
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown } = {}
): Promise<Respuesta> {
  const t0 = Date.now();
  const r = await fetch(`${API}${ruta}`, {
    method: opciones.metodo ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opciones.cuerpo ? { "Content-Type": "application/json" } : {}),
    },
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  const texto = await r.text();
  let cuerpo: any = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    /* un HTML de error no es JSON, y eso también se quiere ver */
  }
  return { estado: r.status, cuerpo, ms: Date.now() - t0 };
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_atencion_extremo_a_extremo");
  await limpiar();

  // --- La clínica de prueba, con los módulos de gestión -----------
  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@atencion.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  for (const modulo of ["expediente", "ventas", "inventario"]) {
    await pool.query(
      `INSERT INTO tenant_modulos (tenant_id, modulo, estado)
       VALUES ($1,$2,'habilitado') ON CONFLICT DO NOTHING`,
      [tenantId, modulo]
    );
  }

  const inv = await crearInvitacion(
    pool,
    tenantId,
    `${PREFIJO} clínica`,
    null,
    correo,
    "Dra. Prueba E2E",
    ["medico"]
  );
  if (!inv.ok) throw new Error(`no se pudo invitar: ${inv.motivo}`);
  const alta = await fetch(`${API}/invitaciones/${inv.invitacion.token}/aceptar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: "Dra. Prueba E2E",
      colegiatura: "VET-E2E",
      password: CLAVE,
    }),
  });
  const cuerpoAlta = (await alta.json()) as { access_token?: string; error?: string };
  assert(alta.status === 201, "la médica de prueba completa su alta", cuerpoAlta.error ?? "");
  const token = cuerpoAlta.access_token;
  if (!token) throw new Error("sin token");

  // --- El paciente ------------------------------------------------
  const { pacienteId } = await conAlcanceTenant(tenantId, async (db) => {
    const prop = await db.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, telefono, email)
       VALUES ($1,'Dueña E2E','88880000','e2e@probe.test') RETURNING id`,
      [tenantId]
    );
    const pac = await db.query<{ id: string }>(
      `INSERT INTO pacientes
         (tenant_id, propietario_id, nombre, especie, sexo, numero_expediente, estado)
       VALUES ($1,$2,'Rocky E2E','Canino','macho','00001','activo') RETURNING id`,
      [tenantId, prop.rows[0].id]
    );
    return { pacienteId: pac.rows[0].id };
  });

  try {
    // =================================================================
    // 1. LO QUE LA PESTAÑA PIDE AL MONTARSE
    // =================================================================
    console.log("\n=== Las llamadas que hace la pestaña al abrirse ===");
    const alMontar = [
      "/expediente/atenciones/plantillas",
      "/inventario/servicios",
      "/inventario/productos?porPagina=100",
      `/expediente/pacientes/${pacienteId}/atencion-en-curso`,
      `/expediente/pacientes/${pacienteId}`,
    ];
    for (const ruta of alMontar) {
      const r = await llamar(token, ruta);
      assert(
        r.estado === 200,
        `GET ${ruta}`,
        r.estado === 200 ? `${r.ms} ms` : { estado: r.estado, cuerpo: r.cuerpo }
      );
    }

    // =================================================================
    // 2. ABRIR LA ATENCIÓN — el gesto del botón
    // =================================================================
    console.log("\n=== Registrar atención ===");
    const abierta = await llamar(token, "/expediente/atenciones", {
      metodo: "POST",
      cuerpo: { pacienteId, tipoConsulta: "consulta_general" },
    });
    assert(
      abierta.estado === 201 || abierta.estado === 200,
      "POST /expediente/atenciones abre la atención",
      abierta.estado < 300
        ? `${abierta.ms} ms · atención ${String(abierta.cuerpo?.atencion?.id).slice(0, 8)}`
        : { estado: abierta.estado, cuerpo: abierta.cuerpo }
    );
    const atencionId = abierta.cuerpo?.atencion?.id as string | undefined;
    assert(!!atencionId, "y devuelve su id");
    if (!atencionId) throw new Error("sin atención: el resto no se puede probar");

    // LA CITA QUE SE CREA SOLA, y su FECHA: el bloqueante 1.1 incluye
    // que la hora se calculaba en UTC, así que después de las 18:00 de
    // Costa Rica la cita quedaba con la fecha del día siguiente.
    const cita = await conAlcanceTenant(tenantId, (db) =>
      db.query<{ fecha: string; hora_inicio: string; estado: string }>(
        `SELECT c.fecha::text, c.hora_inicio::text, c.estado
           FROM citas c JOIN atenciones a ON a.cita_id = c.id WHERE a.id = $1`,
        [atencionId]
      )
    );
    assert(cita.rows.length === 1, "la atención sin turno creó su cita");
    if (cita.rows.length === 1) {
      const hoyEnLaClinica = new Date()
        .toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
      assert(
        cita.rows[0].fecha === hoyEnLaClinica,
        "y la cita quedó con la fecha de HOY en la zona de la clínica, no en UTC",
        { cita: cita.rows[0].fecha, hoyEnLaClinica }
      );
      assert(
        cita.rows[0].estado === "en_consulta",
        "y la cita quedó en consulta",
        cita.rows[0].estado
      );
    }

    // =================================================================
    // 3. EL DETALLE, QUE ES LO QUE PINTA LA PANTALLA
    // =================================================================
    const detalle = await llamar(token, `/expediente/atenciones/${atencionId}`);
    assert(detalle.estado === 200, "GET el detalle de la atención", {
      estado: detalle.estado,
      ms: detalle.ms,
    });

    // =================================================================
    // 4. ESCRIBIR Y CERRAR
    // =================================================================
    console.log("\n=== Escribir y cerrar ===");
    const guardado = await llamar(token, `/expediente/atenciones/${atencionId}`, {
      metodo: "PATCH",
      cuerpo: {
        motivoConsulta: "Control de rutina",
        anamnesis: "Sin novedades.",
        evaluacion: "Paciente sano.",
        planTratamiento: "Control en seis meses.",
      },
    });
    assert(guardado.estado === 200, "PATCH guarda la nota médica", {
      estado: guardado.estado,
      cuerpo: guardado.estado === 200 ? undefined : guardado.cuerpo,
    });

    const cerrada = await llamar(token, `/expediente/atenciones/${atencionId}/cerrar`, {
      metodo: "POST",
      cuerpo: {},
    });
    assert(
      cerrada.estado === 200 || cerrada.estado === 201,
      "POST cierra la atención",
      cerrada.estado < 300 ? `${cerrada.ms} ms` : { estado: cerrada.estado, cuerpo: cerrada.cuerpo }
    );

    const final = await conAlcanceTenant(tenantId, (db) =>
      db.query<{ estado: string; cita_estado: string }>(
        `SELECT a.estado, c.estado AS cita_estado
           FROM atenciones a JOIN citas c ON c.id = a.cita_id WHERE a.id = $1`,
        [atencionId]
      )
    );
    assert(final.rows[0]?.estado === "cerrada", "la atención quedó cerrada", final.rows[0]?.estado);
    assert(
      final.rows[0]?.cita_estado === "completada",
      "y su cita quedó completada por el punto único de citas",
      final.rows[0]?.cita_estado
    );
  } finally {
    await limpiar();
  }

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await limpiar().catch(() => {});
  await pool.end();
  process.exit(1);
});
