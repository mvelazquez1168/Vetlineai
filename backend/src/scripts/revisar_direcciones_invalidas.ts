// Diagnóstico SOLO LECTURA: qué direcciones ya cargadas no pasarían la
// validación que ahora aplica enviarEmail().
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/revisar_direcciones_invalidas.ts
//
// Usa la MISMA función que el envío (direccionValida) en vez de traducir
// el criterio a un regex de SQL: dos criterios que se parecen terminan
// divergiendo, y acá lo que importa es exactamente qué se va a rechazar.
//
// Las direcciones se muestran enmascaradas: alcanza para reconocer la
// fila y arreglarla, sin volcar el correo de nadie a un log.
import { pool } from "../db";
import { direccionValida } from "../email";

function enmascarar(valor: string): string {
  const visible = valor.replace(/[\r\n]/g, "\\n").slice(0, 6);
  return `${visible}…(${valor.length} car.)`;
}

async function main() {
  // -------------------------------------------------------------------
  // propietarios — el caso que motiva esto: se guardan con solo .trim()
  // y son el destinatario de los 8 avisos al tutor.
  // -------------------------------------------------------------------
  const propietarios = await pool.query(
    `SELECT p.id, p.nombre, p.email, t.nombre AS clinica, t.estado_suscripcion,
            (SELECT COUNT(*) FROM pacientes pa WHERE pa.propietario_id = p.id AND pa.estado = 'activo') AS pacientes_activos
     FROM propietarios p JOIN tenants t ON t.id = p.tenant_id
     WHERE p.email IS NOT NULL AND p.email <> ''`
  );

  const malos = propietarios.rows.filter((f) => direccionValida(f.email) === null);
  console.log(`\npropietarios con correo cargado: ${propietarios.rows.length}`);
  console.log(`  no pasan la validación:        ${malos.length}`);

  if (malos.length > 0) {
    console.log("\n  clínica | propietario | correo | pacientes activos | suscripción");
    for (const f of malos) {
      console.log(
        `  ${f.clinica} | ${f.nombre} | ${enmascarar(f.email)} | ${f.pacientes_activos} | ${f.estado_suscripcion}`
      );
    }
    // Lo que importa para "¿afecta a alguien hoy?": un propietario sin
    // pacientes activos no dispara ningún aviso, así que su fila mala es
    // deuda, no un correo que se está perdiendo.
    const afectados = malos.filter((f) => Number(f.pacientes_activos) > 0);
    console.log(`\n  de esos, con al menos un paciente activo (o sea, que HOY recibirían avisos): ${afectados.length}`);
  }

  // -------------------------------------------------------------------
  // personas y tenants — mismas cabeceras, otro origen. personas.email sí
  // se valida en el alta (admin.routes.ts:476) pero con un criterio más
  // laxo, y hay filas anteriores a esa validación.
  // -------------------------------------------------------------------
  for (const [tabla, columna, descripcion] of [
    ["personas", "email", "destinatario de los correos de cuenta/cobro"],
    ["tenants", "email", "origen del Reply-To de los avisos al tutor"],
  ] as [string, string, string][]) {
    const { rows } = await pool.query(
      `SELECT id, ${columna} AS valor FROM ${tabla} WHERE ${columna} IS NOT NULL AND ${columna} <> ''`
    );
    const invalidas = rows.filter((f) => direccionValida(f.valor) === null);
    console.log(`\n${tabla}.${columna} (${descripcion}): ${rows.length} cargadas, ${invalidas.length} no pasan`);
    for (const f of invalidas) console.log(`  ${f.id} → ${enmascarar(f.valor)}`);
  }

  // -------------------------------------------------------------------
  // ¿Alguna trae un intento de inyección, o son todas typos?
  // -------------------------------------------------------------------
  const conSaltoDeLinea = malos.filter((f) => /[\r\n]/.test(f.email));
  console.log(`\ndirecciones con salto de línea (inyección, no typo): ${conSaltoDeLinea.length}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
