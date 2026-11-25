// Compuerta previa al despliegue de la migración 089 — SOLO LECTURA.
//
// La 089 normaliza `pacientes.sexo` al vocabulario cerrado
// ('macho'|'hembra'|NULL) y después hace VALIDATE CONSTRAINT sobre
// `pacientes_sexo_check`, que la migración 087 dejó NOT VALID.
//
// Las conversiones de la 089 son EXPLÍCITAS y acotadas a los tres valores
// que existían en desarrollo ('Macho', 'Hembra', 'Macho castrado'), que
// venían del seed y no de carga clínica real — ningún endpoint escribía
// esa columna hasta vetline-clinic-01. Cualquier OTRO valor en producción
// no lo cubre esa migración, y entonces el VALIDATE falla y aborta el
// despliegue a mitad de camino.
//
// Este script existe para enterarse ANTES. Corre contra la base que se va
// a migrar, no escribe nada, y termina con:
//   * exit 0 — todo lo que hay es convertible o ya está normalizado:
//              la 089 se puede desplegar.
//   * exit 1 — hay valores que la 089 no cubre: NO desplegar la
//              validación. Reportar la lista y decidir qué significa cada
//              uno antes de tocar nada.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_sexo_paciente_normalizable.ts
//   (producción: node dist/scripts/... no existe — ver nota al final)
import { pool } from "../db";

/**
 * Los valores que la migración 089 sabe convertir, con su destino. Es la
 * MISMA lista que la migración: si ahí se agrega una conversión, se
 * agrega acá, porque este script existe para predecir exactamente lo que
 * esa migración va a hacer.
 */
const CONVERSIONES: Record<string, { sexo: string; estadoReproductivo?: string }> = {
  Macho: { sexo: "macho" },
  Hembra: { sexo: "hembra" },
  "Macho castrado": { sexo: "macho", estadoReproductivo: "castrado" },
};

const YA_NORMALIZADOS = new Set(["macho", "hembra"]);

async function main() {
  // Agrupado por valor crudo: es lo que hay que leer para decidir, y de
  // paso dice cuántas filas toca cada caso.
  const valores = await pool.query<{ sexo: string | null; filas: number }>(
    `SELECT sexo, count(*)::int AS filas
     FROM pacientes
     GROUP BY sexo
     ORDER BY filas DESC, sexo NULLS FIRST`
  );

  const total = valores.rows.reduce((acc, f) => acc + f.filas, 0);
  console.log(`${total} paciente(s) en total.\n`);
  console.log("Valores actuales de pacientes.sexo:");

  const noCubiertos: { sexo: string; filas: number }[] = [];

  for (const fila of valores.rows) {
    const etiqueta = fila.sexo === null ? "NULL" : `'${fila.sexo}'`;
    if (fila.sexo === null || YA_NORMALIZADOS.has(fila.sexo)) {
      console.log(`  ${String(fila.filas).padStart(6)}  ${etiqueta.padEnd(20)} ya normalizado`);
    } else if (CONVERSIONES[fila.sexo]) {
      const c = CONVERSIONES[fila.sexo];
      const destino = c.estadoReproductivo
        ? `→ '${c.sexo}' + estado_reproductivo '${c.estadoReproductivo}'`
        : `→ '${c.sexo}'`;
      console.log(`  ${String(fila.filas).padStart(6)}  ${etiqueta.padEnd(20)} la 089 lo convierte ${destino}`);
    } else {
      console.log(`  ${String(fila.filas).padStart(6)}  ${etiqueta.padEnd(20)} *** NO CUBIERTO ***`);
      noCubiertos.push({ sexo: fila.sexo, filas: fila.filas });
    }
  }

  if (noCubiertos.length === 0) {
    console.log("\n" + "─".repeat(72));
    console.log("Todo es convertible o ya está normalizado. La migración 089 se puede desplegar:");
    console.log("el VALIDATE CONSTRAINT va a pasar.");
    await pool.end();
    process.exit(0);
  }

  // Detalle fila por fila SOLO de lo no cubierto: es lo que una persona
  // necesita para decidir, y es poco por definición.
  console.log("\n" + "─".repeat(72));
  console.log(`${noCubiertos.length} valor(es) que la migración 089 NO cubre. Detalle:\n`);

  const detalle = await pool.query(
    `SELECT t.nombre AS clinica, p.numero_expediente, p.nombre, p.especie, p.sexo,
            p.estado_reproductivo, p.id
     FROM pacientes p
     JOIN tenants t ON t.id = p.tenant_id
     WHERE p.sexo IS NOT NULL AND p.sexo <> ALL($1::text[])
     ORDER BY t.nombre, p.numero_expediente`,
    [[...YA_NORMALIZADOS, ...Object.keys(CONVERSIONES)]]
  );

  for (const f of detalle.rows) {
    console.log(
      `  ${f.clinica} · expediente N.º ${f.numero_expediente} · ${f.nombre} (${f.especie})` +
        ` · sexo '${f.sexo}' · estado_reproductivo '${f.estado_reproductivo}'`
    );
    console.log(`    id: ${f.id}`);
  }

  console.log("\nNO desplegar la migración 089 así: el VALIDATE CONSTRAINT va a fallar y abortar");
  console.log("la migración. Hay que decidir qué significa cada uno de estos valores — no se");
  console.log("adivinan — y recién entonces agregar su conversión a la 089 (y a CONVERSIONES");
  console.log("en este script, que tienen que decir lo mismo).");

  await pool.end();
  process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

// NOTA SOBRE PRODUCCIÓN: `tsconfig.build.json` excluye `src/scripts/`, así
// que esto NO viaja compilado en la imagen de producción y `ts-node` no
// está instalada ahí. Para correrlo contra la base de producción, la forma
// es apuntar este mismo script a esa base desde un entorno que sí tenga
// las dependencias de desarrollo (DATABASE_URL de producción en el
// contenedor de desarrollo), que es además la única cosa que hace falta:
// una consulta de lectura. No se agrega a `npm run build` para no meter
// los scripts de un solo uso en la imagen.
