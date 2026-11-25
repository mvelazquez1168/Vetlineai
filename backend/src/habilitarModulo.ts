import { pool } from "./db";
import {
  ETIQUETA_MODULO,
  MODULOS,
  Modulo,
  esModuloValido,
  fijarEstadoModulo,
  modulosHabilitados,
} from "./tenantModulos";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 2 — comando de operación para habilitar o
// deshabilitar un módulo de Vetline Clinic en una clínica.
//
//   npm run habilitar-modulo -- <tenantId> <modulo> [--deshabilitar]
//   npm run habilitar-modulo -- --listar <tenantId>
//
// En producción, con la imagen compilada:
//   node dist/habilitarModulo.js <tenantId> <modulo>
//
// Por qué un comando versionado y no una migración ni un UPDATE a mano:
// el mismo criterio que ya se aplicó a `crearAdminPlataforma.ts`. Un paso
// que "solo se hace una vez" se hace distinto cada vez, y acá el dato que
// varía es un UUID de tenant — exactamente lo que no debe quedar escrito
// dentro de una migración.
//
// Usa el pool admin (no `tenantPool`): no hay sesión de usuario ni
// `app.tenant_id` que setear, y el rol de la aplicación no debería poder
// habilitarse módulos a sí mismo.
// ---------------------------------------------------------------------

function uso(): never {
  console.error(
    [
      "Uso:",
      "  npm run habilitar-modulo -- <tenantId> <modulo> [--deshabilitar]",
      "  npm run habilitar-modulo -- --listar <tenantId>",
      "",
      `Módulos válidos: ${MODULOS.join(", ")}`,
    ].join("\n")
  );
  process.exit(1);
}

async function listar(tenantId: string) {
  const tenant = await pool.query(`SELECT nombre FROM tenants WHERE id = $1`, [tenantId]);
  if (tenant.rows.length === 0) {
    console.error(`No existe ninguna clínica con el id ${tenantId}.`);
    process.exit(1);
  }
  const habilitados = await modulosHabilitados(pool, tenantId);
  console.log(`Clínica: ${tenant.rows[0].nombre} (${tenantId})`);
  for (const m of MODULOS) {
    const estado = habilitados.includes(m) ? "habilitado" : "no habilitado";
    console.log(`  ${habilitados.includes(m) ? "✓" : "·"} ${m.padEnd(12)} ${ETIQUETA_MODULO[m]} — ${estado}`);
  }
}

async function main() {
  // process.argv: [node, script, ...args]. `npm run ... -- a b` llega acá
  // como argv[2]=a, argv[3]=b.
  const args = process.argv.slice(2);
  if (args.length === 0) uso();

  if (args[0] === "--listar") {
    if (!args[1]) uso();
    await listar(args[1]);
    return;
  }

  const [tenantId, moduloCrudo] = args;
  if (!tenantId || !moduloCrudo) uso();

  if (!esModuloValido(moduloCrudo)) {
    console.error(`"${moduloCrudo}" no es un módulo válido. Módulos: ${MODULOS.join(", ")}`);
    process.exit(1);
  }
  const modulo: Modulo = moduloCrudo;
  const estado = args.includes("--deshabilitar") ? "deshabilitado" : "habilitado";

  const resultado = await fijarEstadoModulo(pool, tenantId, modulo, estado);
  if (!resultado.ok) {
    console.error(`No existe ninguna clínica con el id ${tenantId}.`);
    process.exit(1);
  }

  const tenant = await pool.query(`SELECT nombre FROM tenants WHERE id = $1`, [tenantId]);
  const nombre = tenant.rows[0].nombre;

  if (resultado.estadoAnterior === estado) {
    console.log(`"${ETIQUETA_MODULO[modulo]}" ya estaba ${estado} en ${nombre}. Sin cambios.`);
  } else {
    const desde = resultado.estadoAnterior === "ausente" ? "no habilitado" : resultado.estadoAnterior;
    console.log(`"${ETIQUETA_MODULO[modulo]}" en ${nombre}: ${desde} → ${estado}.`);
  }

  await listar(tenantId);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
