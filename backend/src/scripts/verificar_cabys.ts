// Verificación de la carga del catálogo CABYS desde la planilla oficial
// del Banco Central.
//
// Lo que importa comprobar, y por qué:
//
//   * que la lectura del `.xlsx` sea CORRECTA, no solo que no explote.
//     El parser es propio (fflate + el XML de la hoja), así que la
//     garantía no puede ser "confío en la librería": tiene que ser que
//     los códigos y las descripciones que entran a la base son los que
//     dice la planilla.
//   * que un cambio de formato DETENGA la carga en vez de cargar basura.
//     Se prueba mutilando el archivo a propósito.
//   * que ningún código quede con una tarifa inventada.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_cabys.ts
import fs from "fs";
import os from "os";
import path from "path";
import { unzipSync, zipSync } from "fflate";
import { pool } from "../db";
import { RUTA_CABYS, cargarCabys, leerCabys } from "../facturacion/cabys";
import { TARIFAS_IVA } from "../facturacion/catalogos";

let ok = 0;
let fail = 0;
function assert(cond: boolean, label: string, detalle?: unknown) {
  if (cond) {
    ok++;
    console.log(`OK   - ${label}`, detalle === undefined ? "" : detalle);
  } else {
    fail++;
    console.log(`FAIL - ${label}`, detalle === undefined ? "" : JSON.stringify(detalle).slice(0, 300));
  }
}

async function debeFallar(descripcion: string, fn: () => unknown, textoEsperado: string) {
  try {
    await fn();
    assert(false, `${descripcion} — NO falló, y tenía que fallar`);
  } catch (err) {
    const msg = (err as Error).message;
    assert(
      msg.includes(textoEsperado),
      `${descripcion} — rechazado, y el mensaje dice por qué`,
      msg.split("\n")[0].slice(0, 120)
    );
  }
}

/**
 * Hace una copia de la planilla con una celda cambiada, para probar que
 * la validación muerde.
 *
 * Reempaqueta el `.xlsx` de verdad en vez de simular: lo que se quiere
 * comprobar es que el lector real rechaza un archivo real mal formado.
 */
function planillaMutada(reemplazos: Array<[string, string]>): string {
  const zip = unzipSync(new Uint8Array(fs.readFileSync(RUTA_CABYS)));
  let xml = Buffer.from(zip["xl/sharedStrings.xml"]).toString("utf-8");
  for (const [de, a] of reemplazos) {
    if (!xml.includes(de)) throw new Error(`La planilla no contiene "${de}"; la prueba no mediría nada.`);
    xml = xml.replace(de, a);
  }
  zip["xl/sharedStrings.xml"] = new Uint8Array(Buffer.from(xml, "utf-8"));
  const destino = path.join(os.tmpdir(), `cabys-mutada-${Date.now()}.xlsx`);
  fs.writeFileSync(destino, Buffer.from(zipSync(zip)));
  return destino;
}

async function main() {
  const temporales: string[] = [];
  try {
    // -----------------------------------------------------------------
    console.log("=== 1. La planilla oficial está donde el cargador la busca ===");
    assert(fs.existsSync(RUTA_CABYS), `existe ${path.basename(RUTA_CABYS)}`);
    const bytes = fs.statSync(RUTA_CABYS).size;
    assert(bytes > 1_000_000, "y pesa lo que una planilla de veinte mil filas", `${bytes} bytes`);

    // -----------------------------------------------------------------
    console.log("\n=== 2. La lectura devuelve el catálogo completo ===");
    const lectura = leerCabys();
    assert(
      lectura.filas.length > 20_000,
      "más de veinte mil códigos leídos",
      lectura.filas.length
    );
    assert(
      lectura.filas.every((f) => /^[0-9]{13}$/.test(f.codigo)),
      "todos los códigos son de 13 dígitos exactos"
    );
    assert(
      new Set(lectura.filas.map((f) => f.codigo)).size === lectura.filas.length,
      "sin códigos repetidos"
    );
    assert(
      lectura.filas.every((f) => f.descripcion.length > 0),
      "todas las filas tienen descripción"
    );
    assert(
      lectura.tarifasDesconocidas.length === 0,
      "no hay valores de impuesto que el cargador no sepa traducir",
      lectura.tarifasDesconocidas
    );

    // Toda tarifa sugerida tiene que existir en la Nota 8.1. Si no, la FK
    // de la base fallaría — pero mejor decirlo acá, con el código.
    const codigosTarifa = new Set(TARIFAS_IVA.map((t) => t.codigo));
    const invalidas = lectura.filas
      .filter((f) => f.codigoTarifaIva !== null && !codigosTarifa.has(f.codigoTarifaIva))
      .slice(0, 5);
    assert(invalidas.length === 0, "toda tarifa sugerida es un código real de la Nota 8.1", invalidas);

    // -----------------------------------------------------------------
    console.log("\n=== 3. Un código conocido se lee con su dato exacto ===");
    // Tomados de la planilla real y comprobados a mano contra el archivo:
    // son la prueba de que las columnas Q, R y S son las correctas y no
    // están corridas.
    const casos: Array<{ codigo: string; descripcion: string; tarifa: string | null }> = [
      { codigo: "0111100000100", descripcion: "Trigo duro, para siembra (semillas)", tarifa: "02" },
      { codigo: "0134600000200", descripcion: "Ciruela roja, fresca o refrigerada", tarifa: "08" },
    ];
    for (const c of casos) {
      const fila = lectura.filas.find((f) => f.codigo === c.codigo);
      assert(!!fila, `el código ${c.codigo} está en el catálogo`);
      if (!fila) continue;
      assert(
        fila.descripcion === c.descripcion,
        `  su descripción es la de la planilla`,
        fila.descripcion
      );
      assert(
        fila.codigoTarifaIva === c.tarifa,
        `  y su tarifa sugerida es ${c.tarifa}`,
        fila.codigoTarifaIva
      );
    }

    // El caso que más importa de la traducción de tarifas: "Exento" NO es
    // lo mismo que 0% con crédito (01) ni que 0% sin crédito (11).
    const exento = lectura.filas.find((f) => f.impuestoCrudo === "Exento");
    assert(!!exento, "hay códigos marcados 'Exento' en la planilla");
    assert(
      exento?.codigoTarifaIva === "10",
      "y se traducen al código 10 (Tarifa Exenta), no al 01 ni al 11",
      exento?.codigoTarifaIva
    );

    // Los valores escritos como texto con porcentaje también se traducen:
    // un `Number()` ingenuo los habría dejado sin tarifa.
    const conPorcentaje = lectura.filas.filter((f) => f.impuestoCrudo.endsWith("%"));
    assert(
      conPorcentaje.length > 0,
      "la planilla trae valores de impuesto escritos como texto ('13%')",
      conPorcentaje.length
    );
    assert(
      conPorcentaje.every((f) => f.codigoTarifaIva !== null),
      "y todos quedaron con su tarifa, no en nulo"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 4. Un cambio de formato DETIENE la carga ===");
    // Sin esto, lo de arriba también pasaría con un lector que acierta
    // por casualidad sobre este archivo.
    // Dos caminos distintos, y los dos tienen que detener la carga:
    //
    // (a) cambia una columna del encabezado que NO se usa para ubicar la
    //     fila. La fila se encuentra, pero el encabezado ya no coincide:
    //     las columnas pueden estar corridas y seguir leyendo tomaría la
    //     descripción como código.
    const otraColumna = planillaMutada([
      ["<t>Descripción (categoría 9)</t>", "<t>Detalle del bien</t>"],
    ]);
    temporales.push(otraColumna);
    await debeFallar(
      "una planilla con una columna del encabezado renombrada",
      () => leerCabys(otraColumna),
      "encabezado de la planilla CABYS cambió"
    );

    // (b) cambia justamente la columna con la que se ubica el encabezado.
    //     Ahí ni se encuentra la fila — también se detiene, con otro
    //     mensaje, y por eso se prueban las dos por separado.
    const sinEncabezado = planillaMutada([["<t>Categoría 9</t>", "<t>Codigo CABYS</t>"]]);
    temporales.push(sinEncabezado);
    await debeFallar(
      "una planilla donde no se puede ni ubicar el encabezado",
      () => leerCabys(sinEncabezado),
      "No se encontró el encabezado"
    );

    const codigoRoto = planillaMutada([["<t>0111100000100</t>", "<t>ABC</t>"]]);
    temporales.push(codigoRoto);
    await debeFallar(
      "una planilla con un código que no son 13 dígitos",
      () => leerCabys(codigoRoto),
      "no son 13 dígitos"
    );

    await debeFallar(
      "una ruta que no existe",
      () => leerCabys("/tmp/no-existe-cabys.xlsx"),
      "No está la planilla"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 5. En la base quedó lo mismo que en la planilla ===");
    const enBase = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM fact_cat_cabys WHERE activo = true"
    );
    assert(
      Number(enBase.rows[0].n) === lectura.filas.length,
      "la cantidad en la base coincide con la de la planilla",
      { base: enBase.rows[0].n, planilla: lectura.filas.length }
    );

    // Una muestra real: que el dato de la base sea el de la planilla, no
    // solo que la cuenta cuadre.
    const muestra = await pool.query<{ codigo: string; descripcion: string; t: string | null }>(
      `SELECT codigo, descripcion, codigo_tarifa_iva_sugerido AS t
         FROM fact_cat_cabys WHERE codigo = ANY($1::text[]) ORDER BY codigo`,
      [casos.map((c) => c.codigo)]
    );
    for (const c of casos) {
      const f = muestra.rows.find((x) => x.codigo === c.codigo);
      assert(
        f?.descripcion === c.descripcion && f?.t === c.tarifa,
        `${c.codigo} quedó en la base con su descripción y su tarifa`,
        f
      );
    }

    // La FK a las tarifas existe de verdad.
    const huerfanas = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fact_cat_cabys c
        WHERE c.codigo_tarifa_iva_sugerido IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM fact_cat_tarifa_iva t WHERE t.codigo = c.codigo_tarifa_iva_sugerido)`
    );
    assert(huerfanas.rows[0].n === "0", "ninguna tarifa sugerida apunta a un código inexistente");

    // -----------------------------------------------------------------
    console.log("\n=== 6. La carga es idempotente ===");
    const segunda = await cargarCabys(pool);
    assert(segunda.insertados === 0, "una segunda corrida no inserta nada", segunda.insertados);
    assert(segunda.desactivados === 0, "ni desactiva nada", segunda.desactivados);
    assert(
      segunda.leidos === lectura.filas.length,
      "y lee la misma cantidad",
      segunda.leidos
    );

    // -----------------------------------------------------------------
    console.log("\n=== 7. Un código retirado se DESACTIVA, no se borra ===");
    // Es la misma regla que el resto de los catálogos: un comprobante
    // viejo puede referenciar un código que el BCCR retiró.
    await pool.query(
      `INSERT INTO fact_cat_cabys (codigo, descripcion, activo) VALUES ('9999999999999', 'Código de prueba', true)
       ON CONFLICT (codigo) DO UPDATE SET activo = true`
    );
    const tras = await cargarCabys(pool);
    assert(tras.desactivados === 1, "el código ajeno al catálogo queda desactivado", tras.desactivados);
    const sigue = await pool.query<{ activo: boolean }>(
      `SELECT activo FROM fact_cat_cabys WHERE codigo = '9999999999999'`
    );
    assert(sigue.rows.length === 1, "y NO se borró: la fila sigue ahí");
    assert(sigue.rows[0]?.activo === false, "con activo = false");
    await pool.query(`DELETE FROM fact_cat_cabys WHERE codigo = '9999999999999'`);

    // -----------------------------------------------------------------
    console.log("\n=== 8. La búsqueda de la pantalla encuentra algo ===");
    // El índice de trigramas sobre la descripción sin acentos es lo que
    // hace usable el selector de CABYS de la emisión manual.
    const busqueda = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fact_cat_cabys
        WHERE activo = true
          AND inmutable_unaccent(descripcion) ILIKE '%' || inmutable_unaccent($1) || '%'`,
      ["veterinar"]
    );
    assert(
      Number(busqueda.rows[0].n) > 0,
      "buscar 'veterinar' devuelve códigos",
      `${busqueda.rows[0].n} resultado(s)`
    );
  } finally {
    for (const t of temporales) fs.rmSync(t, { force: true });
  }

  console.log(`\n${ok} OK, ${fail} FAIL`);
  await pool.end();
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
