import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";

const BASE = "http://localhost:4000/api";
const SUFIJO = Date.now().toString(36);
let assertOk = 0;
let assertFail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    assertOk++;
    console.log(`OK   - ${label}`);
  } else {
    assertFail++;
    console.log(`FAIL - ${label}`);
  }
}

async function fetchJson(path: string, opts: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(rest.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function crearClinica(nombre: string) {
  const tenantRes = await pool.query(
    `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
    [nombre]
  );
  const tenantId = tenantRes.rows[0].id;
  const email = `verif.farmacos.${SUFIJO}.${Math.random().toString(36).slice(2, 6)}@example.com`;
  const kcUserId = await crearUsuarioKeycloak({
    email,
    nombreCompleto: `Dra. ${nombre}`,
    password: "Vp" + SUFIJO + "!1",
    tenantId,
    rol: "VETERINARIO",
  });
  const personaRes = await pool.query(
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
     VALUES ($1, $2, $3, 'x', true, false, $4, 'COL-321')
     RETURNING id`,
    [tenantId, nombre, email, kcUserId]
  );
  const token = (await obtenerTokenParaUsuario(email, "Vp" + SUFIJO + "!1")).access_token;
  return { tenantId, personaId: personaRes.rows[0].id, kcUserId, token };
}

async function main() {
  const clinicas: { tenantId: string; personaId: string; kcUserId: string; token: string }[] = [];
  let medicamentoPropioId = "";

  try {
    const clinicaA = await crearClinica(`Verif Farmacos A ${SUFIJO}`);
    const clinicaB = await crearClinica(`Verif Farmacos B ${SUFIJO}`);
    clinicas.push(clinicaA, clinicaB);

    // ------------------------------------------------------------------
    // Escenario A — las dos clínicas ven el catálogo de plataforma
    // completo (123 fármacos), aunque nunca crearon nada.
    // ------------------------------------------------------------------
    const listaA = await fetchJson("/medicamentos", { token: clinicaA.token });
    const listaB = await fetchJson("/medicamentos", { token: clinicaB.token });
    const plataformaA = listaA.json.medicamentos.filter((m: any) => m.tenant_id === null);
    const plataformaB = listaB.json.medicamentos.filter((m: any) => m.tenant_id === null);
    assert(plataformaA.length === 123, `clínica A ve las 123 filas de plataforma (vio ${plataformaA.length})`);
    assert(plataformaB.length === 123, `clínica B ve las 123 filas de plataforma (vio ${plataformaB.length})`);
    const amoxi = listaA.json.medicamentos.find((m: any) => m.nombre === "Amoxicilina");
    assert(amoxi?.clase === "Antibiótico", "trae la columna clase nueva con el valor real");
    assert(amoxi?.presentacion === null, "presentacion queda null (la completa cada clínica)");

    // ------------------------------------------------------------------
    // Escenario B — la clínica A crea un fármaco propio (preparado
    // magistral); la clínica B NO lo ve — el aislamiento entre clínicas
    // sigue funcionando igual que antes del cambio de política.
    // ------------------------------------------------------------------
    const crearPropio = await fetchJson("/medicamentos", {
      method: "POST",
      token: clinicaA.token,
      body: JSON.stringify({ nombre: `Preparado Magistral Verif ${SUFIJO}` }),
    });
    assert(crearPropio.status === 201, "clínica A crea su propio fármaco");
    medicamentoPropioId = crearPropio.json.medicamento.id;

    const listaA2 = await fetchJson("/medicamentos", { token: clinicaA.token });
    const listaB2 = await fetchJson("/medicamentos", { token: clinicaB.token });
    assert(
      listaA2.json.medicamentos.some((m: any) => m.id === medicamentoPropioId),
      "clínica A ve su propio fármaco"
    );
    assert(
      !listaB2.json.medicamentos.some((m: any) => m.id === medicamentoPropioId),
      "clínica B NO ve el fármaco propio de la clínica A (aislamiento intacto)"
    );
    assert(
      listaB2.json.medicamentos.filter((m: any) => m.tenant_id === null).length === 123,
      "clínica B sigue viendo las 123 de plataforma sin cambios"
    );

    // ------------------------------------------------------------------
    // Escenario C — la clínica A NO puede editar ni desactivar un
    // fármaco de PLATAFORMA (tenant_id NULL) — la política de escritura
    // separada lo bloquea (RLS lo hace invisible al UPDATE -> 404).
    // ------------------------------------------------------------------
    const editarPlataforma = await fetchJson(`/medicamentos/${amoxi.id}`, {
      method: "PUT",
      token: clinicaA.token,
      body: JSON.stringify({ nombre: "Amoxicilina hackeada" }),
    });
    assert(editarPlataforma.status === 404, "clínica A no puede editar un fármaco de plataforma (404)");

    const desactivarPlataforma = await fetchJson(`/medicamentos/${amoxi.id}/desactivar`, {
      method: "PATCH",
      token: clinicaA.token,
    });
    assert(desactivarPlataforma.status === 404, "clínica A no puede desactivar un fármaco de plataforma (404)");

    const verificarIntacto = await pool.query(`SELECT nombre, activo FROM medicamentos WHERE id = $1`, [amoxi.id]);
    assert(
      verificarIntacto.rows[0].nombre === "Amoxicilina" && verificarIntacto.rows[0].activo === true,
      "el fármaco de plataforma quedó intacto en la base tras los dos intentos"
    );

    // Clínica A SÍ puede editar el suyo propio.
    const editarPropio = await fetchJson(`/medicamentos/${medicamentoPropioId}`, {
      method: "PUT",
      token: clinicaA.token,
      body: JSON.stringify({ nombre: `Preparado Magistral Verif Editado ${SUFIJO}` }),
    });
    assert(editarPropio.status === 200, "clínica A SÍ puede editar su propio fármaco");
  } finally {
    if (medicamentoPropioId) {
      await pool.query(`DELETE FROM medicamentos WHERE id = $1`, [medicamentoPropioId]).catch(() => {});
    }
    for (const c of clinicas) {
      await pool.query(`DELETE FROM bitacora_auditoria WHERE persona_id = $1`, [c.personaId]).catch(() => {});
      await pool.query(`DELETE FROM personas WHERE id = $1`, [c.personaId]).catch(() => {});
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [c.tenantId]).catch(() => {});
      await eliminarUsuarioKeycloak(c.kcUserId).catch(() => {});
    }
    console.log(`\n${assertOk} OK, ${assertFail} FAIL`);
    await pool.end();
  }
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
