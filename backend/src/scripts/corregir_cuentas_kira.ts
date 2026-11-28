// Corrección puntual de los restos del cierre fallido de Kira
// (2026-11-27, noche). Se corre UNA vez y queda como constancia.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/corregir_cuentas_kira.ts [--aplicar]
//
// SIN `--aplicar` solo informa. Nada se toca hasta pedirlo.
//
// QUÉ PASÓ. La atención `d73150ad` se cerró tres veces mientras el
// backend se reiniciaba. Como `abrirCuenta` creaba una cuenta nueva en
// cada intento —el defecto de fondo, ya corregido—, el cliente quedó
// con TRES cuentas abiertas:
//
//   · 619 — «Vacuna polivalente canina» ₡14 500 + «Desparasitante» ₡4 500
//   · 624 — «Castración de gata» ₡55 000
//   · 625 — vacía, y es la que la atención dice que es la suya
//
// Y la vacuna ya no tiene línea en la atención: el usuario la quitó, y
// con el código viejo quitarla no anulaba su cargo.
//
// QUÉ HACE ESTO, en una transacción:
//
//   1. ANULA la vacuna por el flujo correcto (`devolverCargo`, el mismo
//      que usa la caja): el cargo queda anulado —no borrado— y la dosis
//      vuelve a su lote.
//   2. JUNTA los cargos vivos en la cuenta 619, que es la más vieja del
//      cliente y la que `abrirCuenta` elegiría hoy.
//   3. ANULA las cuentas que quedan vacías. No se borran: un número de
//      cuenta que desaparece deja un hueco en el consecutivo.
//   4. APUNTA la atención a la cuenta que de verdad tiene sus cargos.
//
// NO SE BORRA NADA. Mover un cargo entre dos cuentas abiertas y sin
// cobrar del MISMO cliente es la corrección mínima; la alternativa
// —dejar la visita repartida en dos cuentas— es la que le cuesta plata
// a la clínica el día que cobre una sola.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { devolverCargo } from "../ventas/aprobaciones";

const TENANT = "6fe3d9f0-7823-4cd3-b48a-8a232ddff83b";
const ATENCION = "d73150ad-6da8-4d16-af57-6140916668f8";
const CUENTA_BUENA = "339e165d-b42d-4a94-9236-57ab568da5d8"; // la 619
const CARGO_HUERFANO = "bb6bcfe2-0534-4b55-8b64-8fe80de8a158"; // la vacuna sin línea

/**
 * Las tres cuentas del incidente, escritas a mano.
 *
 * Deducirlas de los cargos no alcanza: en cuanto una se vacía deja de
 * tener quién la señale, y queda abierta y vacía para siempre. (Pasó en
 * la primera corrida con la 624.) Son tres ids concretos de un incidente
 * concreto; enumerarlos es más honesto que una consulta que parece
 * general y no lo es.
 */
const CUENTAS_DEL_INCIDENTE = [
  "339e165d-b42d-4a94-9236-57ab568da5d8", // 619
  "73ca4bf5-cf20-4738-8aeb-a573ea0ebba7", // 624
  "db828c9d-7199-4906-981e-e0466d4b7459", // 625
];

const aplicar = process.argv.includes("--aplicar");

async function estado() {
  const r = await pool.query<{
    numero: number;
    cuenta_id: string;
    estado: string;
    descripcion: string | null;
    anulado_en: Date | null;
  }>(
    `SELECT v.numero, v.id AS cuenta_id, v.estado, g.descripcion, g.anulado_en
       FROM vta_cuentas v
       LEFT JOIN vta_cargos g ON g.cuenta_id = v.id
      WHERE v.id = ANY($1)
      ORDER BY v.numero, g.creado_en`,
    [CUENTAS_DEL_INCIDENTE]
  );
  for (const f of r.rows) {
    console.log(
      `  cuenta ${f.numero} (${f.estado}): ${f.descripcion ?? "— sin cargos —"}` +
        (f.anulado_en ? " [ANULADO]" : "")
    );
  }
  const a = await pool.query<{ cuenta_id: string | null }>(
    `SELECT cuenta_id FROM atenciones WHERE id = $1`,
    [ATENCION]
  );
  const n = await pool.query<{ numero: number }>(
    `SELECT numero FROM vta_cuentas WHERE id = $1`,
    [a.rows[0]?.cuenta_id ?? null]
  );
  console.log(`  la atención apunta a la cuenta ${n.rows[0]?.numero ?? "ninguna"}`);
}

async function main() {
  exigirEntornoDeDesarrollo("corregir_cuentas_kira");

  console.log("\n=== ANTES ===");
  await estado();

  if (!aplicar) {
    console.log("\n(Ensayo en vacío. Para aplicarlo: --aplicar)");
    await pool.end();
    return;
  }

  await conAlcanceTenant(TENANT, async (db) => {
    // 1. La vacuna que ya no está en la atención, anulada por el flujo
    //    correcto: el mismo que usa la caja.
    const yaAnulado = await db.query<{ anulado_en: Date | null }>(
      `SELECT anulado_en FROM vta_cargos WHERE id = $1`,
      [CARGO_HUERFANO]
    );
    if (yaAnulado.rows[0] && !yaAnulado.rows[0].anulado_en) {
      const r = await devolverCargo(
        db,
        TENANT,
        CARGO_HUERFANO,
        "resto del cierre que falló el 2026-11-27: la línea se quitó de la atención y el cargo quedó vivo"
      );
      console.log("\n  vacuna anulada y devuelta al lote:", JSON.stringify(r));
    }

    // 2. Los cargos vivos de esta atención, en una sola cuenta.
    const movidos = await db.query(
      `UPDATE vta_cargos
          SET cuenta_id = $1
        WHERE origen = 'atencion' AND origen_id = $2
          AND anulado_en IS NULL AND cuenta_id <> $1`,
      [CUENTA_BUENA, ATENCION]
    );
    console.log(`  cargos movidos a la cuenta 619: ${movidos.rowCount}`);

    // 3. Las cuentas que quedaron vacías, anuladas. No se borran.
    const vacias = await db.query(
      `UPDATE vta_cuentas v
          SET estado = 'anulada'
        WHERE v.tenant_id = $1 AND v.estado = 'abierta' AND v.id <> $2
          AND v.id = ANY($3)
          AND NOT EXISTS (SELECT 1 FROM vta_cargos g WHERE g.cuenta_id = v.id)
        RETURNING v.numero`,
      [TENANT, CUENTA_BUENA, CUENTAS_DEL_INCIDENTE]
    );
    console.log(
      `  cuentas vacías anuladas: ${vacias.rows.map((x) => (x as { numero: number }).numero).join(", ") || "ninguna"}`
    );

    // 4. La atención apunta a donde están sus cargos.
    await db.query(`UPDATE atenciones SET cuenta_id = $1 WHERE id = $2`, [CUENTA_BUENA, ATENCION]);
  });

  console.log("\n=== DESPUÉS ===");
  await estado();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
