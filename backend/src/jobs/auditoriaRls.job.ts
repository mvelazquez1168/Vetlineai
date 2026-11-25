import cron from "node-cron";
import { Pool } from "pg";
import { pool } from "../db";
import {
  TABLAS_BORRADO_MANUAL_EN_PURGA,
  TABLAS_BORRADO_MANUAL_SIN_TENANT_ID,
  TABLAS_SIN_POLITICA_RLS_A_PROPOSITO,
} from "../tablasTenant";

// ---------------------------------------------------------------------
// Auditoría estructural de aislamiento por tenant.
//
// Versión original (prompt_code_auditoria_tenant): reportaba una sola
// cosa — tabla con columna `tenant_id` y RLS deshabilitado. Eso dejaba
// pasar tres defectos distintos, los tres encontrados a mano en el
// relevamiento de `docs/relevamientos/modelo-compartido-gestion.md`:
//
//   1. RLS habilitado pero NO FORZADO. `atenciones` estaba así: el
//      chequeo viejo la daba por buena porque solo miraba
//      `relrowsecurity`. Sin FORCE, el dueño de la tabla se saltea sus
//      propias políticas.
//   2. RLS habilitado y CERO políticas sin querer. Un lockout total es
//      un diseño válido (dos tablas lo usan a propósito), pero
//      indistinguible de "alguien habilitó RLS y se olvidó la política"
//      — y el síntoma es que la tabla deja de devolver filas en
//      silencio.
//   3. FK a `tenants` sin `ON DELETE CASCADE` que la purga no borra a
//      mano. Esto no es RLS, pero es el mismo tipo de brecha
//      estructural y el mismo momento para detectarla: hace que
//      `purga.ts::ejecutarPurgas` falle con violación de FK y haga
//      ROLLBACK, dentro de un catch, dejando clínicas que debían
//      eliminarse colgadas indefinidamente. Ya pasó una vez
//      (`notificaciones_callback`).
//   4. FK que traba la purga SIN apuntar a `tenants`. El punto 3 mide
//      algo más estrecho que el concepto que dice cubrir: la purga no se
//      traba solo por FK a `tenants`, sino por cualquier FK sin cascada
//      cuyo **destino** la purga borra — aunque el destino sea
//      `personas` y la tabla que apunta no tenga `tenant_id`. Ese agujero
//      dejó pasar D-006 (`mensajes.autor_persona_id` → `personas`)
//      durante meses, y con él a toda clínica cuyo médico escribió un
//      mensaje. Ahora el criterio es el concepto: se calcula qué tablas
//      borra la purga —el cierre transitivo de las cascadas desde
//      `tenants`, más las que borra a mano— y se mira toda FK que apunte
//      ahí dentro.
//
// Las excepciones viven en `tablasTenant.ts`, en un solo lugar y con el
// motivo escrito, nunca hardcodeadas acá.
// ---------------------------------------------------------------------

export interface HallazgosAuditoriaRls {
  /** Tabla con `tenant_id` y RLS deshabilitado. El chequeo original. */
  sinRls: string[];
  /** Tabla con `tenant_id`, RLS habilitado, pero sin FORCE. */
  sinForzar: string[];
  /** Tabla con `tenant_id`, RLS habilitado y ninguna política, sin estar en la lista de excepciones. */
  sinPolitica: string[];
  /** FK a `tenants` sin ON DELETE CASCADE que la purga no borra a mano. */
  fkSinCascada: { tabla: string; constraint: string }[];
  /**
   * FK que van a trabar la purga sin apuntar a `tenants` (D-006).
   * `remedio` dice cuál de las dos salidas aplica, que no es la misma:
   * diferir solo sirve si la fila que apunta también se borra.
   */
  fkTrabanPurga: {
    tabla: string;
    constraint: string;
    tablaDestino: string;
    remedio: "diferir" | "borrado_manual";
  }[];
}

/**
 * Las tres consultas sobre RLS en una sola pasada. El criterio sigue
 * siendo deliberadamente simple: cualquier tabla de `public` con columna
 * `tenant_id` tiene que tener RLS habilitado, forzado, y al menos una
 * política (salvo las excepciones nombradas).
 *
 * `relkind = 'r'` deja afuera vistas y tablas particionadas a propósito:
 * hoy no hay ninguna, y si aparecen conviene decidir su criterio en vez
 * de que este chequeo las trate como tablas comunes.
 */
export async function auditarRlsPorTenant(db: Pool): Promise<HallazgosAuditoriaRls> {
  const tablas = await db.query<{
    tabla: string;
    rls_habilitado: boolean;
    rls_forzado: boolean;
    politicas: number;
  }>(
    `SELECT c.relname                                   AS tabla,
            c.relrowsecurity                            AS rls_habilitado,
            c.relforcerowsecurity                       AS rls_forzado,
            (SELECT count(*) FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS politicas
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns ic
         WHERE ic.table_schema = 'public'
           AND ic.table_name = c.relname
           AND ic.column_name = 'tenant_id'
       )
     ORDER BY c.relname`
  );

  const sinRls: string[] = [];
  const sinForzar: string[] = [];
  const sinPolitica: string[] = [];

  for (const fila of tablas.rows) {
    if (!fila.rls_habilitado) {
      // Sin RLS no tiene sentido reportar además que no está forzada ni
      // que no tiene política: es el mismo defecto, y repetirlo tres
      // veces por tabla vuelve el log ilegible.
      sinRls.push(fila.tabla);
      continue;
    }
    if (!fila.rls_forzado) sinForzar.push(fila.tabla);
    if (fila.politicas === 0 && !(fila.tabla in TABLAS_SIN_POLITICA_RLS_A_PROPOSITO)) {
      sinPolitica.push(fila.tabla);
    }
  }

  // `confdeltype` es el código de la acción ON DELETE de la FK:
  // 'c' = CASCADE, 'a' = NO ACTION, 'r' = RESTRICT, 'n' = SET NULL,
  // 'd' = SET DEFAULT. Se compara contra 'c' y no contra 'a' porque
  // cualquier cosa que no sea cascada hace fallar el DELETE del tenant.
  const fks = await db.query<{ tabla: string; constraint: string }>(
    `SELECT con.conrelid::regclass::text AS tabla, con.conname AS constraint
     FROM pg_constraint con
     WHERE con.contype = 'f'
       AND con.confrelid = 'tenants'::regclass
       AND con.confdeltype <> 'c'
     ORDER BY 1`
  );
  const borradoManual = new Set<string>(TABLAS_BORRADO_MANUAL_EN_PURGA);
  const fkSinCascada = fks.rows.filter((f) => !borradoManual.has(f.tabla));

  // ---- Hallazgo 4: FK que traban la purga sin apuntar a `tenants`.
  //
  // `borra` es el conjunto de tablas que la purga vacía para un tenant:
  // las semillas (el propio `tenants` y las que borra a mano) más el
  // cierre transitivo de las cascadas que salen de ellas.
  //
  // Una FK traba si su DESTINO está en ese conjunto y su acción no es
  // cascada. Se filtra por 'a' (NO ACTION) y 'r' (RESTRICT) y no por
  // "distinto de 'c'" porque SET NULL y SET DEFAULT no traban nada: la
  // fila que apunta se queda, pero sin apuntar.
  //
  // El remedio depende de si el ORIGEN también se borra:
  //   * se borra  -> diferir alcanza, porque al COMMIT ya no existe
  //                  ninguna de las dos filas. Es lo que hizo la
  //                  migración 092 con 42 constraints.
  //   * no se borra -> diferir NO alcanza, y hay que borrarla a mano.
  const semillas = [
    "tenants",
    ...TABLAS_BORRADO_MANUAL_EN_PURGA,
    ...TABLAS_BORRADO_MANUAL_SIN_TENANT_ID.map((t) => t.tabla),
  ];
  const trabas = await db.query<{
    tabla: string;
    constraint: string;
    tabla_destino: string;
    origen_se_borra: boolean;
  }>(
    `WITH RECURSIVE borra AS (
       SELECT c.oid AS tabla
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       UNION
       SELECT con.conrelid
         FROM pg_constraint con
         JOIN borra b ON b.tabla = con.confrelid
        WHERE con.contype = 'f' AND con.confdeltype = 'c'
     )
     SELECT con.conrelid::regclass::text  AS tabla,
            con.conname                   AS constraint,
            con.confrelid::regclass::text AS tabla_destino,
            (con.conrelid IN (SELECT tabla FROM borra)) AS origen_se_borra
       FROM pg_constraint con
       JOIN pg_class cl      ON cl.oid = con.conrelid
       JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
      WHERE con.contype = 'f'
        AND ns.nspname = 'public'
        AND con.confdeltype IN ('a', 'r')
        AND con.confrelid IN (SELECT tabla FROM borra)
        AND con.confrelid <> 'tenants'::regclass
        AND NOT (con.condeferrable AND con.conrelid IN (SELECT tabla FROM borra))
      ORDER BY 1, 2`,
    [semillas]
  );
  // Las que la purga YA borra a mano no traban nada: para cuando corre
  // el DELETE FROM tenants, su tabla está vacía para ese tenant.
  const borradoManualSinTenant = new Set(TABLAS_BORRADO_MANUAL_SIN_TENANT_ID.map((t) => t.tabla));
  const fkTrabanPurga = trabas.rows
    .filter((f) => !borradoManual.has(f.tabla) && !borradoManualSinTenant.has(f.tabla))
    .map((f) => ({
      tabla: f.tabla,
      constraint: f.constraint,
      tablaDestino: f.tabla_destino,
      remedio: (f.origen_se_borra ? "diferir" : "borrado_manual") as "diferir" | "borrado_manual",
    }));

  return { sinRls, sinForzar, sinPolitica, fkSinCascada, fkTrabanPurga };
}

/**
 * Compatibilidad con el nombre anterior — lo usa el script de
 * verificación de la auditoría original. Se mantiene en vez de
 * renombrarlo en 2 lados para que ese script siga sirviendo como
 * verificación independiente de este chequeo.
 */
export async function auditarTablasTenantSinRls(db: Pool): Promise<string[]> {
  return (await auditarRlsPorTenant(db)).sinRls;
}

export async function ejecutarJobAuditoriaRls(db: Pool): Promise<HallazgosAuditoriaRls> {
  const hallazgos = await auditarRlsPorTenant(db);

  // Un console.error por tipo de hallazgo, no uno por tabla: el motivo y
  // el arreglo son distintos para cada tipo, y el mensaje tiene que decir
  // qué hacer, no solo qué está mal.
  if (hallazgos.sinRls.length > 0) {
    console.error(
      `[auditoriaRls.job] ${hallazgos.sinRls.length} tabla(s) con tenant_id y RLS DESHABILITADO ` +
        `(falta ENABLE + FORCE ROW LEVEL SECURITY y su política): ${hallazgos.sinRls.join(", ")}`
    );
  }
  if (hallazgos.sinForzar.length > 0) {
    console.error(
      `[auditoriaRls.job] ${hallazgos.sinForzar.length} tabla(s) con tenant_id y RLS SIN FORZAR ` +
        `(el dueño de la tabla se saltea sus propias políticas; falta FORCE ROW LEVEL SECURITY): ` +
        `${hallazgos.sinForzar.join(", ")}`
    );
  }
  if (hallazgos.sinPolitica.length > 0) {
    console.error(
      `[auditoriaRls.job] ${hallazgos.sinPolitica.length} tabla(s) con tenant_id y RLS habilitado ` +
        `pero SIN NINGUNA POLÍTICA (no devuelve ninguna fila a ningún tenant; si el bloqueo total ` +
        `es a propósito, agregala a TABLAS_SIN_POLITICA_RLS_A_PROPOSITO en tablasTenant.ts con su ` +
        `motivo): ${hallazgos.sinPolitica.join(", ")}`
    );
  }
  if (hallazgos.fkSinCascada.length > 0) {
    console.error(
      `[auditoriaRls.job] ${hallazgos.fkSinCascada.length} FK a tenants SIN ON DELETE CASCADE que la ` +
        `purga no borra a mano (ejecutarPurgas va a fallar con violación de FK y la clínica no se ` +
        `va a eliminar nunca; poné la FK en CASCADE, o agregá la tabla a ` +
        `TABLAS_BORRADO_MANUAL_EN_PURGA en tablasTenant.ts): ` +
        hallazgos.fkSinCascada.map((f) => `${f.tabla} (${f.constraint})`).join(", ")
    );
  }
  const aDiferir = hallazgos.fkTrabanPurga.filter((f) => f.remedio === "diferir");
  const aBorrar = hallazgos.fkTrabanPurga.filter((f) => f.remedio === "borrado_manual");
  if (aDiferir.length > 0) {
    console.error(
      `[auditoriaRls.job] ${aDiferir.length} FK va(n) a TRABAR LA PURGA (D-006): apuntan a una tabla ` +
        `que la purga borra, sin ON DELETE CASCADE y sin ser DEFERRABLE, así que el chequeo corre al ` +
        `final de la sentencia y la rama que borra el destino puede ir antes que la que borra el ` +
        `origen. Arreglo: ALTER TABLE ... ALTER CONSTRAINT ... DEFERRABLE INITIALLY DEFERRED, como la ` +
        `migración 092. Son: ` +
        aDiferir.map((f) => `${f.tabla}.${f.constraint} -> ${f.tablaDestino}`).join(", ")
    );
  }
  if (aBorrar.length > 0) {
    console.error(
      `[auditoriaRls.job] ${aBorrar.length} FK va(n) a TRABAR LA PURGA y diferirlas NO alcanza: la fila ` +
        `que apunta SOBREVIVE al borrado del tenant, así que la FK se viola igual en el COMMIT. La ` +
        `purga tiene que borrarlas a mano: agregalas a TABLAS_BORRADO_MANUAL_SIN_TENANT_ID en ` +
        `tablasTenant.ts con su DELETE. Son: ` +
        aBorrar.map((f) => `${f.tabla}.${f.constraint} -> ${f.tablaDestino}`).join(", ")
    );
  }

  return hallazgos;
}

// Diario alcanza — es una verificación estructural, no algo que cambie
// varias veces por día. Corre también una vez al arrancar (mismo patrón
// que validarCredencialesPaisesHabilitados en index.ts) para no esperar
// hasta el próximo horario programado.
export function iniciarJobAuditoriaRls() {
  ejecutarJobAuditoriaRls(pool).catch((err) => console.error("[auditoriaRls.job] Error en el chequeo inicial", err));
  cron.schedule("0 9 * * *", () => {
    ejecutarJobAuditoriaRls(pool).catch((err) => console.error("[auditoriaRls.job] Error en el job", err));
  });
}
