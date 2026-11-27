// Los defectos de la revisión del 2026-11-27, con su regresión.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_revision_2026_11_27.ts
//
// SIN --transpile-only: con él, cuatro defectos reales quedaron tapados
// en el prompt 08b porque el verificador no compilaba de verdad.
//
// Lo que cubre:
//   1.1  la fecha y la hora son de la CLÍNICA, no de UTC. Se prueba con
//        una clínica en UTC+14 y otra en UTC−11 a la vez: cualquier
//        cálculo hecho en UTC falla en al menos una de las dos, sin
//        importar a qué hora se corra el verificador.
//   hooks el límite de error y su registro, por HTTP real.
//   token toda llamada del cliente de API viaja autenticada.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { crearInvitacion } from "../invitaciones";
import { buscarUsuarioKeycloakPorEmail, eliminarUsuarioKeycloak } from "../keycloakAdmin";
import { fechaEnZona, fechaHoyEnZona, horaAhoraEnZona, zonaDeLaClinica } from "../fecha";
import { validarDatosDeDocumento } from "../expediente/documentos";
import { abrirAtencion } from "../expediente/atencion";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API = process.env.API_URL ?? "http://localhost:4000/api";
const PREFIJO = "probe-rev1127";
const CLAVE = "ProbeRev2026!";

// Dos clínicas en los extremos del mundo. A cualquier hora del día, el
// día del calendario de una de las dos DIFIERE del día UTC: a las 02:00
// UTC, Kiritimati ya está en el día siguiente; a las 22:00 UTC, Midway
// todavía está en el anterior. Con una sola clínica el verificador
// pasaría 18 de cada 24 horas por casualidad.
const ZONA_ADELANTE = "Pacific/Kiritimati"; // UTC+14
const ZONA_ATRAS = "Pacific/Midway"; // UTC−11

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

const correo = (quien: string) => `${PREFIJO}-${quien}@probe.test`;

async function limpiar() {
  for (const quien of ["vet"]) {
    const id = await buscarUsuarioKeycloakPorEmail(correo(quien));
    if (id) await eliminarUsuarioKeycloak(id);
  }
  await pool.query(
    `DELETE FROM uso_api WHERE tenant_id IN (SELECT id FROM tenants WHERE nombre LIKE $1)`,
    [`${PREFIJO}%`]
  );
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

async function clinica(sufijo: string, zona: string): Promise<string> {
  const id = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo, zona_horaria)
       VALUES ($1,'activa',$2,'CR',$3) RETURNING id`,
      [`${PREFIJO}-${sufijo}`, `${PREFIJO}-${sufijo}@probe.test`, zona]
    )
  ).rows[0].id;
  for (const modulo of ["expediente", "ventas", "inventario"]) {
    await pool.query(
      `INSERT INTO tenant_modulos (tenant_id, modulo, estado)
       VALUES ($1,$2,'habilitado') ON CONFLICT DO NOTHING`,
      [id, modulo]
    );
  }
  return id;
}

async function alta(tenantId: string, quien: string, nombre: string): Promise<string> {
  const inv = await crearInvitacion(
    pool,
    tenantId,
    `${PREFIJO} clínica`,
    null,
    correo(quien),
    nombre,
    ["medico", "admin_clinica"]
  );
  if (!inv.ok) throw new Error(`no se pudo invitar a ${quien}: ${inv.motivo}`);
  const r = await fetch(`${API}/invitaciones/${inv.invitacion.token}/aceptar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre, colegiatura: `VET-${quien.toUpperCase()}`, password: CLAVE }),
  });
  const cuerpo = (await r.json()) as { access_token?: string; error?: string };
  if (!cuerpo.access_token) throw new Error(`sin token para ${quien}: ${cuerpo.error}`);
  return cuerpo.access_token;
}

/** El día UTC, que es lo que hacía el código viejo. */
const diaUtc = () => new Date().toISOString().slice(0, 10);

async function main() {
  exigirEntornoDeDesarrollo("verificar_revision_2026_11_27");
  await limpiar();

  const adelante = await clinica("adelante", ZONA_ADELANTE);
  const atras = await clinica("atras", ZONA_ATRAS);

  try {
    // =============================================================
    console.log("\n=== 1.1 La fecha y la hora son de la clínica ===");

    const hoyAdelante = fechaHoyEnZona(ZONA_ADELANTE);
    const hoyAtras = fechaHoyEnZona(ZONA_ATRAS);
    assert(
      hoyAdelante !== hoyAtras,
      "a cualquier hora, UTC+14 y UTC−11 están en días distintos",
      `${hoyAdelante} vs ${hoyAtras}`
    );
    assert(
      hoyAdelante !== diaUtc() || hoyAtras !== diaUtc(),
      "y al menos una de las dos NO coincide con el día UTC",
      `UTC=${diaUtc()}`
    );

    assert(
      (await zonaDeLaClinica(pool, adelante)) === ZONA_ADELANTE,
      "zonaDeLaClinica lee la zona guardada de la clínica"
    );
    assert(
      (await zonaDeLaClinica(pool, "00000000-0000-0000-0000-000000000000")) ===
        "America/Costa_Rica",
      "y para una clínica que no existe cae en el default, no en UTC"
    );

    const hora = horaAhoraEnZona(ZONA_ADELANTE);
    assert(/^\d{2}:\d{2}$/.test(hora), "horaAhoraEnZona devuelve HH:MM de 24 horas", hora);
    assert(
      hora !== new Date().toISOString().slice(11, 16),
      "y no es la hora UTC (UTC+14 nunca coincide)",
      `clínica=${hora} UTC=${new Date().toISOString().slice(11, 16)}`
    );

    // La atención sin cita: el defecto concreto que reportó la revisión.
    for (const [nombre, tenantId, zona] of [
      ["adelante", adelante, ZONA_ADELANTE],
      ["atras", atras, ZONA_ATRAS],
    ] as const) {
      const { pacienteId, medicoId } = await conAlcanceTenant(tenantId, async (db) => {
        const prop = await db.query<{ id: string }>(
          `INSERT INTO propietarios (tenant_id, nombre, telefono)
           VALUES ($1,'Dueño de prueba','88880000') RETURNING id`,
          [tenantId]
        );
        const pac = await db.query<{ id: string }>(
          `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
           VALUES ($1,$2,'Reloj','Canino',$3) RETURNING id`,
          [tenantId, prop.rows[0].id, 1]
        );
        const per = await db.query<{ id: string }>(
          // password_hash es NOT NULL y heredado del login propio de
          // antes de Keycloak: acá va un relleno, esta persona nunca
          // inicia sesión.
          `INSERT INTO personas (tenant_id, nombre, email, es_medico, colegiatura, password_hash)
           VALUES ($1,'Dra. Reloj',$2,true,'VET-RELOJ','sin-login-probe') RETURNING id`,
          [tenantId, `${PREFIJO}-${nombre}-medico@probe.test`]
        );
        return { pacienteId: pac.rows[0].id, medicoId: per.rows[0].id };
      });

      const cita = await conAlcanceTenant(tenantId, async (db) => {
        const r = await abrirAtencion(db, tenantId, {
          pacienteId,
          medicoId,
          motivoConsulta: "Atención sin cita previa",
        });
        const c = await db.query<{ fecha: string; hora_inicio: string }>(
          `SELECT fecha::text, hora_inicio::text FROM citas WHERE id = $1`,
          [r.citaId]
        );
        return c.rows[0];
      });

      assert(
        cita.fecha === fechaHoyEnZona(zona),
        `la atención sin cita de «${nombre}» nace con la fecha de la clínica`,
        `cita=${cita.fecha} clínica=${fechaHoyEnZona(zona)} UTC=${diaUtc()}`
      );
      assert(
        cita.hora_inicio.slice(0, 5) === horaAhoraEnZona(zona),
        `y con la hora de la clínica, no la de UTC`,
        `cita=${cita.hora_inicio.slice(0, 5)} clínica=${horaAhoraEnZona(zona)}`
      );
    }

    // La fecha del documento: «futura» se mide en la clínica.
    {
      // En UTC−11 el día de hoy puede ser AYER respecto de UTC: con el
      // código viejo, teclear la fecha de hoy de la clínica pasaba; lo
      // que fallaba era al revés, en UTC+14, donde hoy-de-la-clínica es
      // mañana-en-UTC y se rechazaba por futuro.
      let rechazada = false;
      try {
        validarDatosDeDocumento(
          { tipoDocumento: "radiografia", fechaDocumento: fechaHoyEnZona(ZONA_ADELANTE) },
          ZONA_ADELANTE
        );
      } catch {
        rechazada = true;
      }
      assert(
        !rechazada,
        "una radiografía fechada hoy en una clínica de UTC+14 se acepta (antes: «fecha futura»)",
        `hoy allá = ${fechaHoyEnZona(ZONA_ADELANTE)}, UTC = ${diaUtc()}`
      );

      let futura = false;
      try {
        validarDatosDeDocumento(
          { tipoDocumento: "radiografia", fechaDocumento: "2099-01-01" },
          ZONA_ADELANTE
        );
      } catch {
        futura = true;
      }
      assert(futura, "y una fecha de verdad futura se sigue rechazando");
    }

    assert(
      fechaEnZona(new Date("2026-03-01T04:30:00Z"), "America/Costa_Rica") === "2026-02-28",
      "fechaEnZona traduce un instante al día de la clínica (04:30Z = 22:30 del 28 en CR)"
    );

    // Que no queden rezagos: ningún `toISOString().slice(0, 10)` usado
    // como "hoy" en el código de la aplicación.
    {
      const sospechosos: string[] = [];
      const raiz = join(__dirname, "..");
      const recorrer = (dir: string) => {
        for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) {
            if (["scripts", "migrations", "node_modules", "seed"].includes(e.name)) continue;
            recorrer(p);
          } else if (e.name.endsWith(".ts")) {
            // Sin los comentarios: `fecha.ts` DOCUMENTA el patrón malo
            // para explicar por qué existe la utilidad, y eso no es un
            // uso.
            const texto = readFileSync(p, "utf8")
              .split(String.fromCharCode(10))
              .filter(
                (l: string) =>
                  !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")
              )
              .join(" ");
            if (/new Date\(\)\.toISOString\(\)\.slice\(0, 1[01]\)/.test(texto)) {
              sospechosos.push(p.slice(raiz.length + 1));
            }
          }
        }
      };
      recorrer(raiz);
      assert(
        sospechosos.length === 0,
        "no quedó ningún `new Date().toISOString().slice(...)` usado como hoy en el backend",
        sospechosos
      );
    }

    // =============================================================
    console.log("\n=== El registro de los errores de la interfaz ===");
    const token = await alta(adelante, "vet", "Dra. Reloj Interfaz");

    const sinSesion = await fetch(`${API}/errores-cliente`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pantalla: "/x", mensaje: "sin sesión" }),
    });
    assert(sinSesion.status === 401, "sin sesión no se puede escribir en el registro", sinSesion.status);

    const reporte = await fetch(`${API}/errores-cliente`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pantalla: "/pacientes/abc",
        ambito: "la pestaña Atención actual",
        mensaje: "Rendered more hooks than during the previous render.",
        pila: "Error: ...\n    at AtencionActual",
        pilaReact: "    at AtencionActual\n    at PestanasExpediente",
      }),
    });
    assert(reporte.status === 201, "el límite de error puede registrar lo que pasó", reporte.status);

    const fila = await conAlcanceTenant(adelante, async (db) => {
      const r = await db.query<{
        pantalla: string;
        ambito: string | null;
        mensaje: string;
        persona_id: string | null;
        agente_usuario: string | null;
      }>(
        `SELECT pantalla, ambito, mensaje, persona_id, agente_usuario
           FROM errores_cliente ORDER BY creado_en DESC LIMIT 1`
      );
      return r.rows[0];
    });
    assert(!!fila, "y queda guardado en la clínica que lo reportó");
    assert(
      fila?.ambito === "la pestaña Atención actual",
      "con el ámbito, que es lo que dice QUÉ pestaña explotó",
      fila?.ambito
    );
    assert(!!fila?.persona_id, "y con quién lo vio, para poder preguntarle qué estaba haciendo");

    let inmutable = false;
    try {
      await pool.query(`UPDATE errores_cliente SET mensaje = 'otro' WHERE tenant_id = $1`, [
        adelante,
      ]);
    } catch {
      inmutable = true;
    }
    assert(inmutable, "el registro no se puede editar: es lo que pasó, no una nota");

    // Aislamiento: la otra clínica no ve el error de esta.
    const ajeno = await conAlcanceTenant(atras, async (db) => {
      const r = await db.query(`SELECT count(*)::int AS n FROM errores_cliente`);
      return (r.rows[0] as { n: number }).n;
    });
    assert(ajeno === 0, "y la clínica de al lado no lo ve", ajeno);

    // =============================================================
    console.log("\n=== Los dashboards, con una sesión real ===");
    const hoyAdel = fechaHoyEnZona(ZONA_ADELANTE);
    const rango = `desde=${hoyAdel}&hasta=${hoyAdel}`;
    const pedir = async (ruta: string) => {
      const r = await fetch(`${API}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
      return { estado: r.status, cuerpo: await r.json().catch(() => null) };
    };

    for (const [que, ruta] of [
      ["el dashboard de la clínica", `/metricas/clinica?${rango}`],
      ["el dashboard del médico", `/metricas/medico?${rango}`],
      ["el diccionario de métricas", `/metricas/diccionario`],
    ] as const) {
      const r = await pedir(ruta);
      assert(r.estado === 200, `${que} responde con la sesión del médico`, r.estado);
      assert(
        !/token/i.test(JSON.stringify(r.cuerpo ?? {})),
        `y no contesta «falta el token» en ${que}`
      );
    }

    // Las fichas y la trazabilidad necesitan un id real; se piden con uno
    // inventado solo para comprobar que la ruta AUTENTICA (404, no 401).
    for (const [que, ruta] of [
      ["el resumen del cliente", `/metricas/cliente/00000000-0000-0000-0000-000000000000`],
      ["el resumen del paciente", `/metricas/paciente/00000000-0000-0000-0000-000000000000`],
      [
        "el consumo de un producto",
        `/metricas/producto/00000000-0000-0000-0000-000000000000/consumo?${rango}`,
      ],
      [
        "la trazabilidad de un lote",
        `/metricas/lote/00000000-0000-0000-0000-000000000000/trazabilidad`,
      ],
    ] as const) {
      const r = await pedir(ruta);
      assert(
        r.estado !== 401 && r.estado !== 403,
        `${que} acepta la sesión (no 401/403)`,
        r.estado
      );
    }

    const exportacion = await fetch(`${API}/metricas/clinica/exportar?${rango}&formato=excel`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(exportacion.status === 200, "la exportación del dashboard responde", exportacion.status);
    const bytes = Buffer.from(await exportacion.arrayBuffer());
    assert(
      bytes.length > 500 && bytes[0] === 0x50 && bytes[1] === 0x4b,
      "y lo que llega es un .xlsx de verdad (empieza con PK)",
      bytes.length
    );
    const nombre = exportacion.headers.get("content-disposition") ?? "";
    assert(
      nombre.includes(hoyAdel),
      "con la fecha de la clínica en el nombre del archivo, no la de UTC",
      `${nombre} · clínica=${hoyAdel} UTC=${diaUtc()}`
    );
  } finally {
    await limpiar();
    await pool.end();
  }

  console.log(ok ? "\nTodo OK." : "\nHAY FALLOS.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
