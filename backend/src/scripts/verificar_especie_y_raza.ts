// Regresión del defecto del 2026-11-27: «La raza seleccionada no
// corresponde a la especie indicada» al editar un paciente cuya especie
// estaba escrita de otra forma que «Canino».
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_especie_y_raza.ts
//
// SIN --transpile-only, como el resto.
//
// Lo que se afirma, y por qué cada cosa:
//
//   1. la comparación tolera mayúsculas, tildes y sinónimos → es lo que
//      arregla los pacientes que YA están en la base;
//   2. una especie que NO se reconoce devuelve `null` y no «Canino» →
//      aproximar es cómo el formulario le cambiaba la especie a un
//      animal sin avisar;
//   3. **no queda ninguna fila fuera del vocabulario único** → la
//      migración 165 corrió de verdad;
//   4. guardar un paciente con «perro» lo deja como «Canino» → la
//      escritura normaliza, así que el problema no vuelve con el próximo
//      alta;
//   5. una raza de la otra especie SIGUE siendo rechazada → tolerar no
//      es dejar pasar cualquier cosa, que sería el defecto opuesto.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import {
  ESPECIES_CANONICAS,
  especieCanonica,
  especieDeRaza,
  validarRazaParaEspecie,
} from "../especiePaciente";

const PREFIJO = "probe-especie";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_especie_y_raza");

  // --- 1. La comparación tolerante -------------------------------
  for (const texto of [
    "Canino",
    "canino",
    "CANINO",
    "  canino  ",
    "canina",
    "perro",
    "Perra",
    "cachorro",
  ]) {
    assert(especieCanonica(texto) === "Canino", `«${texto}» es Canino`, especieCanonica(texto));
  }
  for (const texto of ["Felino", "felino", "felina", "gato", "Gata", "minino", "michi"]) {
    assert(especieCanonica(texto) === "Felino", `«${texto}» es Felino`, especieCanonica(texto));
  }
  assert(especieDeRaza("perro") === "canina", "«perro» cruza con las razas caninas");
  assert(especieDeRaza("gata") === "felina", "«gata» cruza con las razas felinas");

  // --- 2. Lo que no se reconoce NO se aproxima --------------------
  for (const texto of ["Equino", "conejo", "ave", "", null, undefined, "tortuga"]) {
    assert(
      especieCanonica(texto) === null,
      `«${texto}» no se reconoce y devuelve null, no «Canino»`,
      especieCanonica(texto)
    );
  }

  // --- 3. La base quedó en un solo vocabulario -------------------
  const fuera = await pool.query<{ especie: string; n: string }>(
    `SELECT especie, count(*)::text AS n FROM pacientes
      WHERE especie <> ALL($1::text[]) GROUP BY especie`,
    [ESPECIES_CANONICAS as unknown as string[]]
  );
  assert(
    fuera.rows.length === 0,
    "ninguna fila de pacientes.especie quedó fuera del vocabulario único",
    fuera.rows
  );

  // --- 4 y 5. Contra la base, con una raza real ------------------
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@especie.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  try {
    await conAlcanceTenant(tenantId, async (db) => {
      const golden = await db.query<{ id: string; nombre: string }>(
        `SELECT id, nombre FROM razas
          WHERE especie = 'canina' AND nombre ILIKE '%golden%' LIMIT 1`
      );
      const siames = await db.query<{ id: string; nombre: string }>(
        `SELECT id, nombre FROM razas WHERE especie = 'felina' LIMIT 1`
      );
      assert(golden.rows.length === 1, "existe el golden retriever en el catálogo de razas");
      assert(siames.rows.length === 1, "y una raza felina para el caso cruzado");

      // EL CASO DEL DEFECTO, tal como se reportó: Kira, «Canino»,
      // golden retriever. Y las formas que fallaban antes.
      for (const especie of ["Canino", "canino", "perro", "canina"]) {
        const r = await validarRazaParaEspecie(db, golden.rows[0].id, especie);
        assert(
          r.ok === true,
          `un golden retriever se guarda con la especie escrita «${especie}»`,
          r.ok ? r.razaNombre : r.error
        );
      }

      // TOLERAR NO ES DEJAR PASAR CUALQUIER COSA.
      const cruzada = await validarRazaParaEspecie(db, siames.rows[0].id, "perro");
      assert(
        cruzada.ok === false,
        "una raza felina en un perro sigue rechazándose",
        cruzada.ok ? "pasó" : cruzada.error
      );
      assert(
        !cruzada.ok && /otra especie/.test(cruzada.error),
        "y el mensaje dice de qué especie es la raza, en vez de culpar al usuario",
        cruzada.ok ? "" : cruzada.error
      );

      // Una especie que no se reconoce: se dice, no se aproxima.
      const rara = await validarRazaParaEspecie(db, golden.rows[0].id, "Equino");
      assert(
        rara.ok === false && /no se reconoce/.test(rara.error),
        "con una especie desconocida no se asume perro: se explica qué pasa",
        rara.ok ? "pasó" : rara.error
      );

      // --- 4. La escritura normaliza ---------------------------
      const propietarioId = (
        await db.query<{ id: string }>(
          `INSERT INTO propietarios (tenant_id, nombre) VALUES ($1,'Dueña de prueba') RETURNING id`,
          [tenantId]
        )
      ).rows[0].id;
      const guardado = await db.query<{ especie: string }>(
        `INSERT INTO pacientes
           (tenant_id, propietario_id, nombre, especie, numero_expediente, estado)
         VALUES ($1,$2,'Kira',$3,'00001','activo') RETURNING especie`,
        [tenantId, propietarioId, especieCanonica("perro") ?? "perro"]
      );
      assert(
        guardado.rows[0].especie === "Canino",
        "un alta que manda «perro» queda guardada como «Canino»",
        guardado.rows[0].especie
      );
    });
  } finally {
    await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  }

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
