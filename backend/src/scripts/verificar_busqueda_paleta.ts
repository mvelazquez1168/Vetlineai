// Verificación de la búsqueda de la paleta de comandos (bloque C.5).
//
// Tres cosas, que son las tres que el prompt pide:
//   1. "Tobi" encuentra al paciente "Toby"  (tolerancia a errores de tipeo)
//   2. "Mendez" encuentra a "Méndez"        (tolerancia a acentos)
//   3. Una clínica NO ve resultados de otra (aislamiento por tenant)
//
// Y, porque el objetivo declarado es responder en menos de un segundo,
// mide el tiempo real del endpoint.
//
// DOS clínicas descartables con datos deliberadamente iguales: el mismo
// nombre de paciente y de propietario en las dos. Así el aislamiento se
// prueba contra el caso que de verdad lo rompería — si la consulta
// filtrara mal, el resultado traería los dos y el script lo vería.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_busqueda_paleta.ts
import { pool } from "../db";
import { asignarNumeroExpedientePaciente } from "../expediente";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";

const BASE = "http://localhost:4000/api";
const SUFIJO = Date.now().toString(36);
const PASSWORD = `Vp${SUFIJO}!1`;

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

async function buscar(q: string, token: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/busqueda?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ms = Date.now() - t0;
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json, ms };
}

interface Clinica {
  tenantId: string;
  kcUserId: string;
  token: string;
  pacienteId: string;
}

async function montarClinica(etiqueta: string): Promise<Clinica> {
  const email = `verif.busq.${etiqueta}.${SUFIJO}@example.com`;
  const tenantRes = await pool.query(
    `INSERT INTO tenants (nombre, estado_suscripcion, zona_horaria)
     VALUES ($1, 'activa', 'America/Costa_Rica') RETURNING id`,
    [`Clínica Verif Búsqueda ${etiqueta} ${SUFIJO}`]
  );
  const tenantId = tenantRes.rows[0].id;

  const kcUserId = await crearUsuarioKeycloak({
    email,
    nombreCompleto: `Dra. Verif Búsqueda ${etiqueta}`,
    password: PASSWORD,
    tenantId,
    rol: "ADMIN",
  });
  await pool.query(
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
     VALUES ($1, $2, $3, 'x', true, true, $4, $5)`,
    [tenantId, `Dra. Verif ${etiqueta}`, email, kcUserId, `COL-BQ-${etiqueta}-${SUFIJO}`]
  );

  // Mismo nombre de propietario en las dos clínicas, CON acento, y con
  // teléfono e identificación para probar los prefijos.
  const propRes = await pool.query(
    `INSERT INTO propietarios (tenant_id, nombre, telefono) VALUES ($1, 'Carolina Méndez', $2) RETURNING id`,
    [tenantId, `8${etiqueta === "A" ? "111" : "222"}5544`]
  );
  const propietarioId = propRes.rows[0].id;

  // Mismo nombre de paciente en las dos clínicas.
  const numero = await asignarNumeroExpedientePaciente(pool, tenantId);
  const pacRes = await pool.query(
    `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie, sexo, microchip)
     VALUES ($1, $2, $3, 'Toby', 'Canino', 'macho', $4) RETURNING id`,
    [tenantId, propietarioId, numero, `9001${etiqueta === "A" ? "11" : "22"}223344`]
  );

  const token = (await obtenerTokenParaUsuario(email, PASSWORD)).access_token;
  return { tenantId, kcUserId, token, pacienteId: pacRes.rows[0].id };
}

async function limpiar(c: Clinica | null) {
  if (!c) return;
  for (const t of ["uso_api", "notificaciones_uso", "eventos_facturacion", "documentos_fiscales"]) {
    await pool.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [c.tenantId]).catch(() => undefined);
  }
  await pool
    .query(`DELETE FROM tenants WHERE id = $1`, [c.tenantId])
    .catch((err) => console.error("No se pudo borrar el tenant:", err.message));
  await eliminarUsuarioKeycloak(c.kcUserId).catch(() => undefined);
}

async function main() {
  let a: Clinica | null = null;
  let b: Clinica | null = null;
  const tiempos: number[] = [];

  try {
    a = await montarClinica("A");
    b = await montarClinica("B");

    // -----------------------------------------------------------------
    console.log("=== 1. Tolerancia a errores de tipeo: 'Tobi' -> 'Toby' ===");
    const tipeo = await buscar("Tobi", a.token);
    tiempos.push(tipeo.ms);
    assert(tipeo.status === 200, "la búsqueda responde 200", tipeo.status);
    assert(
      tipeo.json?.pacientes?.some((p: any) => p.nombre === "Toby"),
      `"Tobi" encuentra a "Toby" (${tipeo.json?.pacientes?.length ?? 0} resultado(s), ${tipeo.ms} ms)`,
      tipeo.json?.pacientes?.map((p: any) => p.nombre)
    );

    // -----------------------------------------------------------------
    console.log("\n=== 2. Tolerancia a acentos: 'Mendez' -> 'Méndez' ===");
    const acento = await buscar("Mendez", a.token);
    tiempos.push(acento.ms);
    assert(
      acento.json?.propietarios?.some((p: any) => p.nombre === "Carolina Méndez"),
      `"Mendez" encuentra a "Carolina Méndez" (${acento.ms} ms)`,
      acento.json?.propietarios?.map((p: any) => p.nombre)
    );
    // Y al revés: quien tipea el acento tiene que encontrar igual.
    const acentoInverso = await buscar("Méndez", a.token);
    tiempos.push(acentoInverso.ms);
    assert(
      acentoInverso.json?.propietarios?.some((p: any) => p.nombre === "Carolina Méndez"),
      "y 'Méndez' con acento también lo encuentra"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 3. Aislamiento: una clínica no ve a la otra ===");
    // Las dos clínicas tienen un "Toby" y una "Carolina Méndez". Si la
    // consulta filtrara mal, cada una vería dos.
    const desdeA = await buscar("Toby", a.token);
    const desdeB = await buscar("Toby", b.token);
    tiempos.push(desdeA.ms, desdeB.ms);

    assert(desdeA.json?.pacientes?.length === 1, "la clínica A ve UN Toby, no dos", desdeA.json?.pacientes?.length);
    assert(desdeB.json?.pacientes?.length === 1, "la clínica B ve UN Toby, no dos", desdeB.json?.pacientes?.length);
    assert(
      desdeA.json.pacientes[0].id === a.pacienteId,
      "y el que ve A es EL SUYO (no el de B)",
      { vioA: desdeA.json.pacientes[0].id, suyoA: a.pacienteId }
    );
    assert(
      desdeB.json.pacientes[0].id === b.pacienteId,
      "y el que ve B es EL SUYO (no el de A)",
      { vioB: desdeB.json.pacientes[0].id, suyoB: b.pacienteId }
    );
    assert(
      desdeA.json.pacientes[0].id !== desdeB.json.pacientes[0].id,
      "los dos resultados son filas distintas (la prueba no se engañó sola)"
    );

    const propDesdeA = await buscar("Carolina", a.token);
    assert(
      propDesdeA.json?.propietarios?.length === 1,
      "lo mismo con propietarios: A ve una Carolina, no dos",
      propDesdeA.json?.propietarios?.length
    );

    // -----------------------------------------------------------------
    console.log("\n=== 4. Prefijos: microchip, teléfono, número de expediente ===");
    const porMicrochip = await buscar("900111", a.token);
    tiempos.push(porMicrochip.ms);
    // El paciente de A se saca a una constante: dentro del callback TS
    // ya no sabe que `a` dejó de ser null.
    const pacienteDeA = a.pacienteId;
    assert(
      porMicrochip.json?.pacientes?.some((p: any) => p.id === pacienteDeA),
      "el prefijo del microchip encuentra al paciente",
      porMicrochip.json?.pacientes?.map((p: any) => p.microchip)
    );
    assert(
      !porMicrochip.json?.pacientes?.some((p: any) => p.id === b?.pacienteId),
      "y NO trae el de la otra clínica (que tiene un microchip parecido)"
    );

    const porTelefono = await buscar("81115544", a.token);
    tiempos.push(porTelefono.ms);
    assert(
      porTelefono.json?.propietarios?.length === 1,
      "el teléfono encuentra a su propietario y solo a él",
      porTelefono.json?.propietarios?.length
    );

    const expediente = await pool.query(`SELECT numero_expediente FROM pacientes WHERE id = $1`, [
      a.pacienteId,
    ]);
    const porExpediente = await buscar(String(expediente.rows[0].numero_expediente), a.token);
    assert(
      porExpediente.json?.pacientes?.some((p: any) => p.id === a!.pacienteId),
      "el número de expediente exacto encuentra al paciente"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 5. Lo que NO tiene que encontrar ===");
    const nada = await buscar("Rocky", a.token);
    assert(
      !nada.json?.pacientes?.some((p: any) => p.nombre === "Toby"),
      "'Rocky' NO devuelve a Toby (el umbral no es un pasa-todo)",
      nada.json?.pacientes?.map((p: any) => p.nombre)
    );
    const unaLetra = await buscar("T", a.token);
    assert(
      unaLetra.json?.pacientes?.length === 0 && unaLetra.json?.propietarios?.length === 0,
      "una sola letra no busca nada (ni va a la base)"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 6. Tiempo de respuesta ===");
    const peor = Math.max(...tiempos);
    const promedio = Math.round(tiempos.reduce((x, y) => x + y, 0) / tiempos.length);
    console.log(`  ${tiempos.length} búsquedas: promedio ${promedio} ms, peor ${peor} ms`);
    assert(peor < 1000, `la peor búsqueda responde en menos de 1 s (${peor} ms)`);

    // El plan real, para confirmar que el índice se usa y no hay un
    // recorrido completo escondido detrás de un dataset chico.
    const plan = await pool.query(
      `EXPLAIN (FORMAT JSON)
       SELECT id FROM pacientes
       WHERE inmutable_unaccent(lower(nombre)) % inmutable_unaccent(lower('Tobi'))`
    );
    const planTexto = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
    console.log(`  plan: ${planTexto.includes("Bitmap") || planTexto.includes("Index") ? "usa índice" : "recorrido completo"}`);
    console.log(
      "  (con 20 filas el planificador puede elegir Seq Scan por costo, y está bien:\n" +
        "   lo que importa es que el índice EXISTA y sea elegible — ver migración 090)"
    );
  } finally {
    await limpiar(a);
    await limpiar(b);
    await pool.end();
  }

  console.log(`\n${ok} OK, ${fail} FALLO(S)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
