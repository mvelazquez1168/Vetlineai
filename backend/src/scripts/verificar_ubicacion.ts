// Verificación de la codificación oficial de ubicación (provincia,
// cantón, distrito, barrio) cargada desde la planilla de Hacienda.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/verificar_ubicacion.ts
//
// Qué comprueba, y por qué cada cosa:
//   * las cuatro cantidades son las de la división territorial real de
//     Costa Rica — es lo que delata una columna corrida;
//   * la jerarquía cierra: todo cantón cuelga de una provincia que
//     existe, todo distrito de un cantón, todo barrio de un distrito;
//   * los códigos están con ceros a la izquierda, que es como viajan en
//     el XML y como los guarda `fact_emisores`;
//   * la clave foránea RECHAZA de verdad una ubicación inventada, y
//     ACEPTA una real — probado contra la base, no leyendo el DDL;
//   * las dos FK quedaron VALIDADAS (no `NOT VALID`), que es lo que
//     cierra la revisión de las filas que ya existían;
//   * un caso conocido a mano: 1 / 01 / 01 es San José, San José,
//     Carmen.
import { pool } from "../db";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function uno<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await pool.query(sql, params);
  return r.rows[0] as T;
}

async function main() {
  console.log("=== 1. Cantidades ===");
  for (const [tabla, esperado] of [
    ["fact_cat_provincia", 7],
    ["fact_cat_canton", 84],
    ["fact_cat_distrito", 492],
    ["fact_cat_barrio", 7087],
  ] as Array<[string, number]>) {
    const { n } = await uno<{ n: string }>(`SELECT count(*)::text AS n FROM ${tabla}`);
    assert(Number(n) === esperado, `${tabla} tiene ${esperado} filas`, n);
  }

  console.log("\n=== 2. La jerarquía cierra ===");
  // Las FK ya lo garantizan, pero se comprueba igual: una FK se puede
  // haber creado NOT VALID y no haber revisado nunca lo que ya estaba.
  const huerfanos = await uno<{ n: string }>(
    `SELECT (
       (SELECT count(*) FROM fact_cat_canton c
         WHERE NOT EXISTS (SELECT 1 FROM fact_cat_provincia p WHERE p.codigo = c.provincia))
       + (SELECT count(*) FROM fact_cat_distrito d
           WHERE NOT EXISTS (SELECT 1 FROM fact_cat_canton c
                              WHERE c.provincia = d.provincia AND c.codigo = d.canton))
       + (SELECT count(*) FROM fact_cat_barrio b
           WHERE NOT EXISTS (SELECT 1 FROM fact_cat_distrito d
                              WHERE d.provincia = b.provincia AND d.canton = b.canton
                                AND d.codigo = b.distrito))
     )::text AS n`
  );
  assert(huerfanos.n === "0", "ningún cantón, distrito ni barrio cuelga de algo que no existe", huerfanos.n);

  console.log("\n=== 3. Los códigos van con ceros a la izquierda ===");
  const malFormados = await uno<{ n: string }>(
    `SELECT (
       (SELECT count(*) FROM fact_cat_provincia WHERE codigo !~ '^[1-7]$')
       + (SELECT count(*) FROM fact_cat_canton   WHERE codigo !~ '^[0-9]{2}$')
       + (SELECT count(*) FROM fact_cat_distrito WHERE codigo !~ '^[0-9]{2}$')
       + (SELECT count(*) FROM fact_cat_barrio   WHERE codigo !~ '^[0-9]{2}$')
     )::text AS n`
  );
  assert(malFormados.n === "0", "todos los códigos tienen el ancho que exige el XML", malFormados.n);

  console.log("\n=== 4. Un caso conocido a mano ===");
  const carmen = await uno<{ provincia: string; canton: string; distrito: string }>(
    `SELECT p.nombre AS provincia, c.nombre AS canton, d.nombre AS distrito
       FROM fact_cat_distrito d
       JOIN fact_cat_canton c ON c.provincia = d.provincia AND c.codigo = d.canton
       JOIN fact_cat_provincia p ON p.codigo = d.provincia
      WHERE d.provincia = '1' AND d.canton = '01' AND d.codigo = '01'`
  );
  assert(
    carmen?.provincia === "San José" && carmen?.canton === "San José" && carmen?.distrito === "Carmen",
    "1 / 01 / 01 es San José, San José, Carmen",
    carmen
  );

  console.log("\n=== 5. Las dos claves foráneas quedaron VALIDADAS ===");
  const noValidadas = await pool.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint
      WHERE conname IN ('fact_emisores_ubicacion_fkey',
                        'fact_comprobantes_receptor_ubicacion_fkey')
        AND NOT convalidated`
  );
  assert(
    noValidadas.rows.length === 0,
    "ninguna de las dos sigue en NOT VALID",
    noValidadas.rows.map((r) => r.conname)
  );

  console.log("\n=== 6. La clave foránea rechaza de verdad ===");
  // Contra la base, no leyendo el DDL: una FK puede existir y estar
  // deshabilitada, y el DDL se vería igual.
  const t = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
     VALUES ('probe-ubicacion-fe', 'activa', 'probe@ubicacion.test', 'CR') RETURNING id`
  );
  const tenantId = t.rows[0].id;
  const insertarEmisor = (prov: string, cant: string, dist: string) =>
    pool.query(
      `INSERT INTO fact_emisores (
         tenant_id, tipo_identificacion, numero_identificacion, nombre,
         codigo_actividad_economica, ubicacion_provincia, ubicacion_canton,
         ubicacion_distrito, ubicacion_otras_senas, correo, proveedor_sistemas
       ) VALUES ($1,'02','3101999001','Probe Ubicacion S.A.','750000',$2,$3,$4,
                 '100 metros al sur','probe@ubicacion.test','3101999999')
       ON CONFLICT (tenant_id) DO UPDATE SET
         ubicacion_provincia = EXCLUDED.ubicacion_provincia,
         ubicacion_canton    = EXCLUDED.ubicacion_canton,
         ubicacion_distrito  = EXCLUDED.ubicacion_distrito`,
      [tenantId, prov, cant, dist]
    );

  try {
    // Provincia que no existe.
    try {
      await insertarEmisor("9", "99", "99");
      assert(false, "una ubicación inventada (9/99/99) NO fue rechazada, y tenía que serlo");
    } catch (err) {
      assert(true, "una ubicación inventada (9/99/99) se rechaza", (err as Error).message.slice(0, 90));
    }

    // Combinación donde cada código existe por separado pero no juntos:
    // el distrito 16 existe (en otro cantón), no en el cantón 01 de San
    // José. Es el caso que una validación por formato deja pasar.
    try {
      await insertarEmisor("1", "01", "16");
      assert(false, "una combinación cruzada (1/01/16) NO fue rechazada, y tenía que serlo");
    } catch (err) {
      assert(
        true,
        "una combinación cruzada (1/01/16) se rechaza: el distrito existe, pero no en ese cantón",
        (err as Error).message.slice(0, 90)
      );
    }

    // Y una real pasa.
    await insertarEmisor("1", "01", "01");
    assert(true, "una ubicación real (1/01/01) se acepta");
  } finally {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }

  console.log(ok ? "\nTODO OK" : "\nHAY FALLAS");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
