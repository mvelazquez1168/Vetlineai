// Bloque A de la sesión nocturna — la respuesta tiene que salir DESPUÉS
// del COMMIT.
//
// EL DEFECTO que este script reproduce: `withTenantClient` confirma la
// transacción en `res.on("finish")`, o sea DESPUÉS de que la respuesta
// ya salió. Un 201 llega al cliente antes del COMMIT, así que una
// operación inmediata sobre la fila recién creada abre su propia
// transacción, no ve nada y responde 404.
//
// No es teórico: es el flujo central de Vetline Clinic ("Guardar y
// agendar cita" crea el paciente y en el mismo segundo agenda una cita
// con él).
//
// Este script hace exactamente eso N veces seguidas, SIN pausa entre el
// POST y lo que sigue, y cuenta cuántas veces la fila recién creada no
// se encuentra. Antes del arreglo tiene que FALLAR; después, pasar las N.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_respuesta_despues_del_commit.ts
//
// Clínica y usuario de Keycloak descartables, borrados al terminar.
// Nunca toca un usuario existente.
import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";

const BASE = "http://localhost:4000/api";
const SUFIJO = Date.now().toString(36);
const PASSWORD = `Vp${SUFIJO}!1`;
const VUELTAS = Number(process.env.VUELTAS ?? 50);

async function pedir(path: string, opts: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const texto = await res.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: res.status, json };
}

interface Fallo {
  vuelta: number;
  paso: string;
  status: number;
  detalle: unknown;
}

async function main() {
  let tenantId = "";
  let kcUserId = "";
  let personaId = "";
  const email = `verif.commit.${SUFIJO}@example.com`;
  const fallos: Fallo[] = [];
  const latencias: number[] = [];

  try {
    const tenantRes = await pool.query(
      `INSERT INTO tenants (nombre, estado_suscripcion, zona_horaria)
       VALUES ($1, 'activa', 'America/Costa_Rica') RETURNING id`,
      [`Clínica Verif Commit ${SUFIJO}`]
    );
    tenantId = tenantRes.rows[0].id;

    kcUserId = await crearUsuarioKeycloak({
      email,
      nombreCompleto: `Dra. Verif Commit ${SUFIJO}`,
      password: PASSWORD,
      tenantId,
      rol: "ADMIN",
    });

    const personaRes = await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
       VALUES ($1, 'Dra. Verif Commit', $2, 'x', true, true, $3, $4) RETURNING id`,
      [tenantId, email, kcUserId, `COL-CM-${SUFIJO}`]
    );
    personaId = personaRes.rows[0].id;

    const propRes = await pool.query(
      `INSERT INTO propietarios (tenant_id, nombre) VALUES ($1, 'Tutor Verif Commit') RETURNING id`,
      [tenantId]
    );
    const propietarioId = propRes.rows[0].id;

    const token = (await obtenerTokenParaUsuario(email, PASSWORD)).access_token;

    console.log(`=== ${VUELTAS} vueltas de POST + lectura/escritura inmediata ===\n`);

    for (let vuelta = 1; vuelta <= VUELTAS; vuelta++) {
      const t0 = Date.now();
      const alta = await pedir("/pacientes", {
        method: "POST",
        token,
        body: JSON.stringify({
          propietarioId,
          nombre: `Carrera ${SUFIJO}-${vuelta}`,
          especie: "Canino",
          sexo: "macho",
        }),
      });
      latencias.push(Date.now() - t0);

      if (alta.status !== 201) {
        fallos.push({ vuelta, paso: "POST /pacientes", status: alta.status, detalle: alta.json });
        continue;
      }
      const id = alta.json?.paciente?.id;

      // SIN pausa: es el punto del verificador. Si la respuesta salió
      // antes del COMMIT, esta lectura abre su propia transacción y no
      // ve la fila.
      const ficha = await pedir(`/pacientes/${id}`, { token });
      if (ficha.status !== 200) {
        fallos.push({ vuelta, paso: `GET /pacientes/${id}`, status: ficha.status, detalle: ficha.json });
        continue;
      }

      // El flujo real va más allá: agenda una cita con el paciente que
      // acaba de crear. Una cita exige que el paciente exista (FK), así
      // que acá la carrera se manifiesta como 500 por violación de FK,
      // no como 404.
      const cita = await pedir("/citas", {
        method: "POST",
        token,
        body: JSON.stringify({
          pacienteId: id,
          medicoId: personaId,
          fecha: "2026-12-01",
          horaInicio: `${String(7 + (vuelta % 12)).padStart(2, "0")}:00`,
          duracionMinutos: 15,
        }),
      });
      if (cita.status !== 201) {
        fallos.push({ vuelta, paso: "POST /citas con el paciente recién creado", status: cita.status, detalle: cita.json });
        continue;
      }

      // Y edita la ficha recién creada, que es el otro camino inmediato.
      const edicion = await pedir(`/pacientes/${id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ nombre: `Carrera ${SUFIJO}-${vuelta} editado`, especie: "Canino", sexo: "macho" }),
      });
      if (edicion.status !== 200) {
        fallos.push({ vuelta, paso: `PATCH /pacientes/${id}`, status: edicion.status, detalle: edicion.json });
      }
    }

    latencias.sort((a, b) => a - b);
    const p50 = latencias[Math.floor(latencias.length * 0.5)];
    const p95 = latencias[Math.floor(latencias.length * 0.95)];
    const promedio = Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length);

    console.log(`Latencia del POST /pacientes: promedio ${promedio} ms · p50 ${p50} ms · p95 ${p95} ms`);
    console.log(`(la medición vive acá para poder compararla antes y después del arreglo)\n`);

    if (fallos.length === 0) {
      console.log(`TODO OK — ${VUELTAS}/${VUELTAS} vueltas sin una sola carrera.`);
    } else {
      console.log(`FALLÓ — ${fallos.length} de ${VUELTAS} vueltas perdieron la carrera:\n`);
      for (const f of fallos.slice(0, 10)) {
        console.log(`  vuelta ${f.vuelta}: ${f.paso} → ${f.status} ${JSON.stringify(f.detalle)}`);
      }
      if (fallos.length > 10) console.log(`  … y ${fallos.length - 10} más.`);
      console.log(
        `\nEs el defecto: la respuesta salió antes del COMMIT, así que la operación` +
          `\nsiguiente abrió su propia transacción y no vio la fila.`
      );
    }

    process.exitCode = fallos.length === 0 ? 0 : 1;
  } finally {
    if (tenantId) {
      for (const t of ["uso_api", "notificaciones_uso", "eventos_facturacion", "documentos_fiscales"]) {
        await pool.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      }
      await pool
        .query(`DELETE FROM tenants WHERE id = $1`, [tenantId])
        .catch((err) => console.error("No se pudo borrar el tenant de prueba:", err.message));
    }
    if (kcUserId) await eliminarUsuarioKeycloak(kcUserId).catch(() => undefined);
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
