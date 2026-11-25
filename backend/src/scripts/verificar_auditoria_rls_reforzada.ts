// Verificación de la auditoría de RLS reforzada (vetline-clinic-01,
// punto 1). El criterio es el de la guía rectora: un verificador no vale
// nada hasta que FALLA contra el defecto que dice detectar.
//
// Así que no alcanza con correr el job sobre el esquema real y ver que
// sale limpio — eso también pasaría con un job roto que no reporta nada.
// Este script crea en desarrollo tres tablas con exactamente los tres
// defectos nuevos, confirma que el job señala cada una en su categoría y
// no en las otras, y después las borra y confirma que vuelve a quedar
// limpio.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_auditoria_rls_reforzada.ts
import { pool } from "../db";
import { auditarRlsPorTenant } from "../jobs/auditoriaRls.job";
import { TABLAS_SIN_POLITICA_RLS_A_PROPOSITO } from "../tablasTenant";

const T_SIN_FORZAR = "_audit_probe_sin_forzar";
const T_SIN_POLITICA = "_audit_probe_sin_politica";
const T_FK_SIN_CASCADA = "_audit_probe_fk_sin_cascada";
const PROBES = [T_SIN_FORZAR, T_SIN_POLITICA, T_FK_SIN_CASCADA];

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function borrarProbes() {
  for (const t of PROBES) {
    await pool.query(`DROP TABLE IF EXISTS ${t}`);
  }
}

async function main() {
  // Arrancar de cero: si una corrida anterior se cortó a la mitad, las
  // tablas de prueba podrían seguir ahí y el primer chequeo (esquema
  // limpio) fallaría por un motivo que no es el real.
  await borrarProbes();

  try {
    // -----------------------------------------------------------------
    console.log("=== 1. El esquema real está limpio en los 4 chequeos ===");
    const antes = await auditarRlsPorTenant(pool);
    assert(antes.sinRls.length === 0, "0 tablas con tenant_id y RLS deshabilitado", antes.sinRls);
    assert(antes.sinForzar.length === 0, "0 tablas con tenant_id y RLS sin forzar", antes.sinForzar);
    assert(antes.sinPolitica.length === 0, "0 tablas con tenant_id, RLS y sin política", antes.sinPolitica);
    assert(antes.fkSinCascada.length === 0, "0 FK a tenants sin cascada fuera de la lista de purga", antes.fkSinCascada);

    // Que el esquema esté limpio tiene que ser porque las excepciones se
    // respetan, no porque el chequeo no mire nada: las dos tablas sin
    // política a propósito TIENEN que existir y TIENEN que estar en RLS
    // sin política. Si alguien les agregara una política, esta aserción
    // avisa de que la excepción quedó obsoleta.
    for (const tabla of Object.keys(TABLAS_SIN_POLITICA_RLS_A_PROPOSITO)) {
      const estado = await pool.query(
        `SELECT c.relrowsecurity AS rls,
                (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)::int AS politicas
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname=$1`,
        [tabla]
      );
      const fila = estado.rows[0];
      assert(
        !!fila && fila.rls === true && fila.politicas === 0,
        `excepción "${tabla}": sigue con RLS habilitado y 0 políticas (la excepción sigue siendo necesaria)`,
        fila
      );
      assert(
        !antes.sinPolitica.includes(tabla),
        `excepción "${tabla}": el job NO la reporta como defecto`
      );
    }

    // -----------------------------------------------------------------
    console.log("\n=== 2. Tres tablas con los tres defectos ===");

    // Defecto A: RLS habilitado, con política, pero SIN FORCE.
    await pool.query(`CREATE TABLE ${T_SIN_FORZAR} (id serial PRIMARY KEY, tenant_id uuid NOT NULL)`);
    await pool.query(`ALTER TABLE ${T_SIN_FORZAR} ENABLE ROW LEVEL SECURITY`);
    await pool.query(
      `CREATE POLICY ${T_SIN_FORZAR}_isolation ON ${T_SIN_FORZAR}
         USING (tenant_id::text = current_setting('app.tenant_id', true))`
    );

    // Defecto B: RLS habilitado y forzado, pero CERO políticas, sin
    // estar en la lista de excepciones.
    await pool.query(`CREATE TABLE ${T_SIN_POLITICA} (id serial PRIMARY KEY, tenant_id uuid NOT NULL)`);
    await pool.query(`ALTER TABLE ${T_SIN_POLITICA} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${T_SIN_POLITICA} FORCE ROW LEVEL SECURITY`);

    // Defecto C: RLS impecable, pero FK a tenants sin ON DELETE CASCADE
    // y sin estar en la lista de borrado manual de la purga.
    await pool.query(
      `CREATE TABLE ${T_FK_SIN_CASCADA} (
         id serial PRIMARY KEY,
         tenant_id uuid NOT NULL REFERENCES tenants(id)
       )`
    );
    await pool.query(`ALTER TABLE ${T_FK_SIN_CASCADA} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${T_FK_SIN_CASCADA} FORCE ROW LEVEL SECURITY`);
    await pool.query(
      `CREATE POLICY ${T_FK_SIN_CASCADA}_isolation ON ${T_FK_SIN_CASCADA}
         USING (tenant_id::text = current_setting('app.tenant_id', true))`
    );

    const conDefectos = await auditarRlsPorTenant(pool);
    console.log("hallazgos:", JSON.stringify(conDefectos, null, 2));

    assert(
      conDefectos.sinForzar.includes(T_SIN_FORZAR),
      `"${T_SIN_FORZAR}" se reporta como RLS sin forzar`
    );
    assert(
      conDefectos.sinPolitica.includes(T_SIN_POLITICA),
      `"${T_SIN_POLITICA}" se reporta como RLS sin política`
    );
    assert(
      conDefectos.fkSinCascada.some((f) => f.tabla === T_FK_SIN_CASCADA),
      `"${T_FK_SIN_CASCADA}" se reporta como FK a tenants sin cascada`
    );

    // Cada defecto en su categoría y en ninguna otra — si el job mete
    // todo en una sola bolsa, el mensaje de error no dice qué arreglar.
    assert(
      !conDefectos.sinForzar.includes(T_SIN_POLITICA) && !conDefectos.sinForzar.includes(T_FK_SIN_CASCADA),
      "la tabla sin política y la de FK no aparecen como 'sin forzar' (están forzadas)"
    );
    assert(
      !conDefectos.sinPolitica.includes(T_SIN_FORZAR) && !conDefectos.sinPolitica.includes(T_FK_SIN_CASCADA),
      "la tabla sin forzar y la de FK no aparecen como 'sin política' (tienen política)"
    );
    assert(
      !conDefectos.fkSinCascada.some((f) => f.tabla === T_SIN_FORZAR || f.tabla === T_SIN_POLITICA),
      "las dos tablas sin FK real a tenants no aparecen como 'FK sin cascada'"
    );
    assert(conDefectos.sinRls.length === 0, "ninguna de las tres cuenta como 'RLS deshabilitado'", conDefectos.sinRls);

    // -----------------------------------------------------------------
    console.log("\n=== 3. Un cuarto defecto: RLS deshabilitado del todo ===");
    // El chequeo original tiene que seguir funcionando: se reusa la
    // tabla del defecto A quitándole el RLS, así se confirma de paso que
    // una tabla sin RLS se reporta UNA sola vez y no tres.
    await pool.query(`ALTER TABLE ${T_SIN_FORZAR} DISABLE ROW LEVEL SECURITY`);
    const sinRlsDelTodo = await auditarRlsPorTenant(pool);
    assert(
      sinRlsDelTodo.sinRls.includes(T_SIN_FORZAR),
      `"${T_SIN_FORZAR}" sin RLS se reporta como 'RLS deshabilitado'`
    );
    assert(
      !sinRlsDelTodo.sinForzar.includes(T_SIN_FORZAR) && !sinRlsDelTodo.sinPolitica.includes(T_SIN_FORZAR),
      "una tabla sin RLS se reporta UNA vez, no también como 'sin forzar' y 'sin política'"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 4. Borradas las tablas de prueba, el job vuelve a quedar limpio ===");
    await borrarProbes();
    const despues = await auditarRlsPorTenant(pool);
    assert(despues.sinRls.length === 0, "0 tablas con RLS deshabilitado", despues.sinRls);
    assert(despues.sinForzar.length === 0, "0 tablas con RLS sin forzar", despues.sinForzar);
    assert(despues.sinPolitica.length === 0, "0 tablas con RLS sin política", despues.sinPolitica);
    assert(despues.fkSinCascada.length === 0, "0 FK a tenants sin cascada", despues.fkSinCascada);
  } finally {
    // Pase lo que pase, las tablas de prueba no se quedan en la base.
    await borrarProbes();
    await pool.end();
  }

  console.log(ok ? "\nTODO OK" : "\nHUBO FALLOS");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
