// Verificación con llamadas HTTP REALES de la validación del correo del
// propietario (POST y PATCH /api/propietarios). No alcanza con probar
// correoUtilizable(): lo que importa es que la ruta devuelva 400 con un
// mensaje accionable y que no escriba la fila.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_validacion_correo_propietario.ts
//
// Crea una clínica descartable vía el registro público y la borra al
// final. No toca ninguna fila existente.
import { pool } from "../db";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4000";

let ok = 0;
let fallos = 0;

function afirmar(condicion: boolean, descripcion: string, detalle?: unknown): void {
  if (condicion) {
    ok++;
    console.log(`  [OK]    ${descripcion}`);
  } else {
    fallos++;
    console.log(`  [FALLA] ${descripcion}${detalle ? `\n          ${JSON.stringify(detalle)}` : ""}`);
  }
}

async function main() {
  const sufijo = Date.now().toString().slice(-8);
  let tenantId: string | null = null;

  try {
    const tipoId = await pool.query(
      `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
    );
    const agente = await pool.query(`SELECT id FROM agentes LIMIT 1`);

    const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paisCodigo: "CR",
        nombreComercial: `Clinica Validacion ${sufijo}`,
        tipoPersona: "fisica",
        tipoIdentificacionId: tipoId.rows[0].id,
        numeroIdentificacion: `1-${sufijo}-1111`,
        nombreFiscal: `Clinica Validacion ${sufijo}`,
        nombreTitular: "Dra. Validacion",
        email: `validacion+${sufijo}@ejemplo.com`,
        telefono: "88889999",
        password: "ClaveTest123!",
        esMedico: true,
        colegiatura: `COL-VAL-${sufijo}`,
        agenteId: agente.rows[0].id,
      }),
    });
    const dataReg = (await respReg.json()) as any;
    afirmar(respReg.status === 201, "clínica descartable creada", { status: respReg.status });
    if (respReg.status !== 201) throw new Error("no se pudo registrar");

    const token: string = dataReg.access_token;
    const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    tenantId = ((await me.json()) as any).auth.tenantId;

    const crear = (body: Record<string, unknown>) =>
      fetch(`${BASE_URL}/api/propietarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    // ---------------------------------------------------------------
    console.log("\n1. POST — direcciones que no se pueden usar");
    // ---------------------------------------------------------------
    for (const [email, etiqueta] of [
      ["tutor@ejemplo.com\r\nBcc: espia@ejemplo.com", "salto de línea (inyección)"],
      ["tutor@ejemplo.com, espia@ejemplo.com", "dos direcciones por coma"],
      ["Tutor <tutor@ejemplo.com>", "con nombre y ángulos"],
      ["no es un correo", "texto libre"],
      ["tutor@ejemplo", "sin dominio de primer nivel"],
    ] as [string, string][]) {
      const resp = await crear({ nombre: `Rechazado ${etiqueta}`, email });
      const cuerpo = (await resp.json()) as any;
      afirmar(resp.status === 400, `POST con ${etiqueta} → 400`, { status: resp.status });
      afirmar(
        typeof cuerpo.error === "string" && cuerpo.error.includes("no parece válido"),
        `POST con ${etiqueta} → mensaje accionable`,
        cuerpo
      );
    }
    const cuantos = await pool.query(`SELECT COUNT(*) FROM propietarios WHERE tenant_id = $1`, [tenantId]);
    afirmar(Number(cuantos.rows[0].count) === 0, "ninguna de las direcciones rechazadas quedó escrita");

    // ---------------------------------------------------------------
    console.log("\n2. POST — el correo sigue siendo opcional");
    // ---------------------------------------------------------------
    const sinCorreo = await crear({ nombre: "Tutor Sin Correo" });
    afirmar(sinCorreo.status === 201, "POST sin correo → 201 (una urgencia no obliga a pedirlo)", {
      status: sinCorreo.status,
    });
    const vacio = await crear({ nombre: "Tutor Correo Vacío", email: "   " });
    afirmar(vacio.status === 201, "POST con correo en blanco → 201");

    const valido = await crear({ nombre: "Tutor Válido", email: "tutor+aviso@ejemplo.com.ar" });
    const creado = (await valido.json()) as any;
    afirmar(valido.status === 201, "POST con una dirección legítima → 201", { status: valido.status });
    afirmar(
      creado.propietario?.email === "tutor+aviso@ejemplo.com.ar",
      "y se guarda tal cual (con + y subdominio)",
      creado.propietario
    );

    // ---------------------------------------------------------------
    console.log("\n3. PATCH — la misma validación al editar");
    // ---------------------------------------------------------------
    const id = creado.propietario.id;
    const patch = (body: Record<string, unknown>) =>
      fetch(`${BASE_URL}/api/propietarios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    const patchMalo = await patch({ nombre: "Tutor Válido", email: "roto@" });
    afirmar(patchMalo.status === 400, "PATCH con una dirección rota → 400", { status: patchMalo.status });
    const sigueIgual = await pool.query(`SELECT email FROM propietarios WHERE id = $1`, [id]);
    afirmar(
      sigueIgual.rows[0].email === "tutor+aviso@ejemplo.com.ar",
      "y el correo anterior NO se pisó",
      sigueIgual.rows[0]
    );

    const patchBueno = await patch({ nombre: "Tutor Válido", email: "otro@ejemplo.com" });
    afirmar(patchBueno.status === 200, "PATCH con una dirección legítima → 200", { status: patchBueno.status });
    const patchVacio = await patch({ nombre: "Tutor Válido", email: "" });
    afirmar(patchVacio.status === 200, "PATCH borrando el correo → 200 (sigue siendo opcional)");
  } finally {
    if (tenantId) {
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      console.log("\n  (clínica descartable borrada)");
    }
  }

  console.log(`\n=== ${ok} OK, ${fallos} fallas ===`);
  await pool.end();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
