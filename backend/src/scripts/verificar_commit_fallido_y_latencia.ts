// Bloque A, las otras dos verificaciones: qué pasa si el COMMIT falla, y
// cuánto cuesta esperarlo.
//
// 1) COMMIT FALLIDO FORZADO. Se agrega temporalmente a `pacientes` una
//    restricción UNIQUE `DEFERRABLE INITIALLY DEFERRED` sobre
//    (tenant_id, microchip). Con eso, el INSERT pasa y la violación recién
//    aparece al confirmar — que es exactamente el caso difícil: la ruta
//    terminó bien, no hay excepción que atrapar, y el error aparece en el
//    COMMIT.
//
//    Se elige `microchip` y no otra columna porque está en NULL en todas
//    las filas existentes y los NULL no colisionan en un UNIQUE, así que
//    agregar la restricción no puede fallar por datos previos ni afectar
//    a nadie más mientras dura la prueba.
//
//    Lo que tiene que pasar: el cliente recibe un ERROR, no un éxito, y
//    la fila no queda. ANTES del arreglo este caso devolvía 201 y el dato
//    no se guardaba — el peor de los dos mundos.
//
// 2) LATENCIA. Ahora toda respuesta espera su COMMIT, así que hay que
//    medir que no haya regresión apreciable. Se mide una ruta simple
//    (GET /auth/me, que pasa por withTenantClient y hace una sola
//    consulta) con N repeticiones, y el POST de un paciente.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_commit_fallido_y_latencia.ts
import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";

const BASE = "http://localhost:4000/api";
const SUFIJO = Date.now().toString(36);
const PASSWORD = `Vp${SUFIJO}!1`;
const REPETICIONES = Number(process.env.REPETICIONES ?? 100);
const CONSTRAINT = "probe_commit_diferido";

let ok = 0;
let fail = 0;
function assert(cond: boolean, label: string, detalle?: unknown) {
  if (cond) {
    ok++;
    console.log(`OK   - ${label}`);
  } else {
    fail++;
    console.log(`FAIL - ${label}`, detalle === undefined ? "" : JSON.stringify(detalle));
  }
}

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

function percentiles(ms: number[]) {
  const orden = [...ms].sort((a, b) => a - b);
  return {
    promedio: Math.round(orden.reduce((a, b) => a + b, 0) / orden.length),
    p50: orden[Math.floor(orden.length * 0.5)],
    p95: orden[Math.floor(orden.length * 0.95)],
    p99: orden[Math.floor(orden.length * 0.99)],
    max: orden[orden.length - 1],
  };
}

async function main() {
  let tenantId = "";
  let kcUserId = "";
  let constraintPuesta = false;
  const email = `verif.commitfail.${SUFIJO}@example.com`;

  try {
    const tenantRes = await pool.query(
      `INSERT INTO tenants (nombre, estado_suscripcion, zona_horaria)
       VALUES ($1, 'activa', 'America/Costa_Rica') RETURNING id`,
      [`Clínica Verif CommitFail ${SUFIJO}`]
    );
    tenantId = tenantRes.rows[0].id;

    kcUserId = await crearUsuarioKeycloak({
      email,
      nombreCompleto: `Dra. Verif CommitFail ${SUFIJO}`,
      password: PASSWORD,
      tenantId,
      rol: "ADMIN",
    });
    await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
       VALUES ($1, 'Dra. Verif CommitFail', $2, 'x', true, true, $3, $4)`,
      [tenantId, email, kcUserId, `COL-CF-${SUFIJO}`]
    );
    const propRes = await pool.query(
      `INSERT INTO propietarios (tenant_id, nombre) VALUES ($1, 'Tutor CommitFail') RETURNING id`,
      [tenantId]
    );
    const propietarioId = propRes.rows[0].id;
    const token = (await obtenerTokenParaUsuario(email, PASSWORD)).access_token;

    // -----------------------------------------------------------------
    console.log("=== 1. COMMIT fallido forzado (restricción diferida) ===");

    const microchip = `DUP-${SUFIJO}`;
    const primera = await pedir("/pacientes", {
      method: "POST",
      token,
      body: JSON.stringify({ propietarioId, nombre: `Primero ${SUFIJO}`, especie: "Canino", microchip }),
    });
    assert(primera.status === 201, "el primer paciente se crea bien (201)", primera.json);

    await pool.query(
      `ALTER TABLE pacientes ADD CONSTRAINT ${CONSTRAINT}
         UNIQUE (tenant_id, microchip) DEFERRABLE INITIALLY DEFERRED`
    );
    constraintPuesta = true;
    console.log("  (restricción diferida puesta: el conflicto va a aparecer recién al confirmar)");

    const segunda = await pedir("/pacientes", {
      method: "POST",
      token,
      body: JSON.stringify({ propietarioId, nombre: `Segundo ${SUFIJO}`, especie: "Canino", microchip }),
    });

    assert(
      segunda.status >= 500,
      `el cliente recibe un ERROR, no un éxito (status ${segunda.status})`,
      segunda.json
    );
    assert(
      segunda.status !== 201,
      "y sobre todo NO recibe 201 con el dato sin guardar (era el agujero: éxito mentiroso)"
    );
    assert(
      typeof segunda.json?.error === "string" && segunda.json.error.length > 0,
      "con un mensaje que explica la salida",
      segunda.json
    );

    const quedo = await pool.query(`SELECT id, nombre FROM pacientes WHERE nombre = $1`, [
      `Segundo ${SUFIJO}`,
    ]);
    assert(quedo.rows.length === 0, "y no quedó ninguna fila del paciente que falló", quedo.rows);

    const quedoElPrimero = await pool.query(`SELECT id FROM pacientes WHERE nombre = $1`, [
      `Primero ${SUFIJO}`,
    ]);
    assert(quedoElPrimero.rows.length === 1, "el primero, que sí se había confirmado, sigue ahí");

    // El número de expediente se pide dentro de la misma transacción, así
    // que el ROLLBACK también tiene que haberlo devuelto: el contador no
    // se consume por un alta que falló.
    const contador = await pool.query(
      `SELECT paciente_expediente_ultimo_numero AS n FROM tenants WHERE id = $1`,
      [tenantId]
    );
    assert(
      Number(contador.rows[0].n) === 1,
      `el contador de expedientes no se consumió por el alta fallida (quedó en ${contador.rows[0].n}, esperado 1)`
    );

    await pool.query(`ALTER TABLE pacientes DROP CONSTRAINT ${CONSTRAINT}`);
    constraintPuesta = false;

    // Y después de quitar la restricción, la misma alta funciona: la
    // conexión no quedó envenenada por el COMMIT fallido.
    const tercera = await pedir("/pacientes", {
      method: "POST",
      token,
      body: JSON.stringify({ propietarioId, nombre: `Tercero ${SUFIJO}`, especie: "Canino", microchip }),
    });
    assert(
      tercera.status === 201,
      "quitada la restricción, el alta vuelve a funcionar (la conexión fallida se descartó bien)",
      tercera.json
    );

    // -----------------------------------------------------------------
    console.log(`\n=== 2. Latencia (${REPETICIONES} repeticiones) ===`);

    // Calentamiento: la primera llamada paga la resolución del JWKS y el
    // arranque del pool, y mezclarla con la medición la ensucia.
    for (let i = 0; i < 5; i++) await pedir("/auth/me", { token });

    const latGet: number[] = [];
    for (let i = 0; i < REPETICIONES; i++) {
      const t0 = Date.now();
      const r = await pedir("/auth/me", { token });
      latGet.push(Date.now() - t0);
      if (r.status !== 200) {
        assert(false, `GET /auth/me devolvió ${r.status} en la repetición ${i}`, r.json);
        break;
      }
    }

    const latPost: number[] = [];
    for (let i = 0; i < REPETICIONES; i++) {
      const t0 = Date.now();
      const r = await pedir("/pacientes", {
        method: "POST",
        token,
        body: JSON.stringify({ propietarioId, nombre: `Lat ${SUFIJO}-${i}`, especie: "Canino" }),
      });
      latPost.push(Date.now() - t0);
      if (r.status !== 201) {
        assert(false, `POST /pacientes devolvió ${r.status} en la repetición ${i}`, r.json);
        break;
      }
    }

    const g = percentiles(latGet);
    const p = percentiles(latPost);
    console.log(
      `  GET  /auth/me   promedio ${g.promedio} ms · p50 ${g.p50} · p95 ${g.p95} · p99 ${g.p99} · max ${g.max}`
    );
    console.log(
      `  POST /pacientes promedio ${p.promedio} ms · p50 ${p.p50} · p95 ${p.p95} · p99 ${p.p99} · max ${p.max}`
    );
    console.log(
      `\n  Comparar contra la misma corrida SIN el arreglo para decidir si hay regresión.\n` +
        `  Lo que se agregó por respuesta es una ida y vuelta de COMMIT a la base.`
    );
  } finally {
    // La restricción de prueba no se queda puesta pase lo que pase: es lo
    // único de este script que toca una tabla compartida.
    if (constraintPuesta) {
      await pool
        .query(`ALTER TABLE pacientes DROP CONSTRAINT ${CONSTRAINT}`)
        .catch((err) => console.error(`¡No se pudo quitar ${CONSTRAINT}!`, err.message));
    }
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

  console.log(`\n${ok} OK, ${fail} FALLO(S)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
