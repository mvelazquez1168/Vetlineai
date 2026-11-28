// CADA ROL LLEGA A LO SUYO Y A NADA MÁS — punto 1 del paquete de la
// noche del 2026-11-27.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_acceso_por_rol.ts
//
// SIN --transpile-only. Entra al conjunto de antes del despliegue.
//
// POR QUÉ EXISTE. Juanita entró con rol Recepción y su menú mostraba
// Personas, Catálogos y cumplimiento, Casos clínicos y Casos sin
// actividad. Ninguna le corresponde. El menú ya quedó corregido y lo
// cuida `verificar_menu_con_permisos.mjs`; esto cuida la otra mitad, la
// que importa de verdad: que el BACKEND diga 403 a quien no le toca,
// aunque la pantalla se abra por cualquier razón.
//
// LO QUE SE ESPERA NO ESTÁ ESCRITO ACÁ: sale de `rol_permisos`, la misma
// tabla que usa el backend. Para cada endpoint se declara QUÉ PERMISO
// pide, y la prueba calcula sola, rol por rol, si tiene que pasar o que
// dar 403. Una lista de expectativas escrita a mano sería una segunda
// matriz, y un día no coincidiría con la primera — que es justamente el
// defecto que esto viene a evitar.

import { pool } from "../db";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { crearInvitacion } from "../invitaciones";
import { buscarUsuarioKeycloakPorEmail, eliminarUsuarioKeycloak } from "../keycloakAdmin";

const API = process.env.API_URL ?? "http://localhost:4000/api";
const PREFIJO = "probe-roles";
const CLAVE = "ProbeRoles2026!";
const UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Endpoints de lectura, con el permiso que piden.
 *
 * Son de LECTURA a propósito: una prueba que recorre ocho roles por
 * endpoints de escritura deja ocho veces más basura que lo que verifica.
 * El permiso se resuelve en el mismo middleware para GET y para POST.
 */
const ENDPOINTS: Array<{ ruta: string; permiso: string; que: string }> = [
  { ruta: "/metricas/clinica?desde=2026-11-01&hasta=2026-11-30", permiso: "reportes.ver", que: "el dashboard de la clínica" },
  { ruta: `/metricas/cliente/${UUID}`, permiso: "cliente.ver", que: "el resumen de un cliente" },
  { ruta: `/metricas/paciente/${UUID}`, permiso: "expediente.ver", que: "el resumen de un paciente" },
  { ruta: `/metricas/producto/${UUID}/consumo`, permiso: "inventario.ver", que: "el consumo de un producto" },
  { ruta: "/administracion/auditoria", permiso: "auditoria.ver", que: "la auditoría" },
  { ruta: "/administracion/desechos", permiso: "cumplimiento.gestionar", que: "los desechos" },
  { ruta: "/administracion/comisiones/reglas", permiso: "comisiones.ver_todas", que: "las reglas de comisión" },
  { ruta: "/administracion/controlados/libro?desde=2026-11-01&hasta=2026-11-30", permiso: "controlados.registrar", que: "el libro de controlados" },
  { ruta: "/ayuda/sin-respuesta", permiso: "clinica.configurar", que: "la configuración de la clínica" },
];

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

const correo = (rol: string) => `${PREFIJO}-${rol}@probe.test`;

const ROLES = [
  "recepcion",
  "caja",
  "farmacia",
  "estetica",
  "asistente",
  "contador",
  "medico",
  "admin_clinica",
];

async function limpiar() {
  for (const rol of ROLES) {
    const id = await buscarUsuarioKeycloakPorEmail(correo(rol));
    if (id) await eliminarUsuarioKeycloak(id);
  }
  await pool.query(
    `DELETE FROM uso_api WHERE tenant_id IN (SELECT id FROM tenants WHERE nombre LIKE $1)`,
    [`${PREFIJO}%`]
  );
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_acceso_por_rol");
  await limpiar();

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa',$2,'CR') RETURNING id`,
      [`${PREFIJO}-clinica`, `${PREFIJO}@probe.test`]
    )
  ).rows[0].id;
  for (const m of ["expediente", "inventario", "ventas", "facturacion", "finanzas", "crm"]) {
    await pool.query(
      `INSERT INTO tenant_modulos (tenant_id, modulo, estado)
       VALUES ($1,$2,'habilitado') ON CONFLICT DO NOTHING`,
      [tenantId, m]
    );
  }

  // LA MATRIZ, DE LA BASE. Es la fuente, y es la misma que resuelve el
  // backend en cada solicitud.
  const matriz = new Map<string, Set<string>>();
  const filas = await pool.query<{ rol: string; permiso: string }>(
    `SELECT rol, permiso FROM rol_permisos`
  );
  for (const f of filas.rows) {
    if (!matriz.has(f.rol)) matriz.set(f.rol, new Set());
    matriz.get(f.rol)!.add(f.permiso);
  }

  try {
    for (const rol of ROLES) {
      console.log(["", `=== ${rol} ===`].join("\n"));

      const inv = await crearInvitacion(
        pool,
        tenantId,
        `${PREFIJO} clínica`,
        null,
        correo(rol),
        `Prueba ${rol}`,
        [rol]
      );
      if (!inv.ok) throw new Error(`no se pudo invitar a ${rol}: ${inv.motivo}`);
      const aceptar = await fetch(`${API}/invitaciones/${inv.invitacion.token}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: `Prueba ${rol}`,
          colegiatura: rol === "medico" ? `VET-${rol.toUpperCase()}` : undefined,
          password: CLAVE,
        }),
      });
      const cuerpo = (await aceptar.json()) as { access_token?: string; error?: string };
      if (!cuerpo.access_token) throw new Error(`sin token para ${rol}: ${cuerpo.error}`);
      const token = cuerpo.access_token;

      const suyos = matriz.get(rol) ?? new Set<string>();

      for (const e of ENDPOINTS) {
        const resp = await fetch(`${API}${e.ruta}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const deberiaPasar = suyos.has(e.permiso);
        const paso = resp.status !== 403;

        assert(
          paso === deberiaPasar,
          deberiaPasar
            ? `${rol} entra a ${e.que} (tiene ${e.permiso})`
            : `${rol} NO entra a ${e.que} (no tiene ${e.permiso})`,
          `HTTP ${resp.status}`
        );
      }
    }

    // Y una comprobación de la matriz misma: si todos los roles tuvieran
    // los mismos permisos, lo de arriba pasaría sin probar nada.
    const tamaños = ROLES.map((r) => (matriz.get(r) ?? new Set()).size);
    assert(
      new Set(tamaños).size > 1,
      "la matriz distingue de verdad entre roles (si no, la prueba de arriba no probaría nada)",
      ROLES.map((r, i) => `${r}:${tamaños[i]}`).join(" ")
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
