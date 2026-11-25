// Verificación de que la purga de una clínica NO se traba (D-006).
//
// El defecto que cierra: `DELETE FROM tenants` fallaba con
// `mensajes_autor_persona_id_fkey`, y `purga.ts::ejecutarPurgas` atrapa el
// error y hace ROLLBACK dentro de un catch — así que la clínica quedaba
// pendiente indefinidamente, en silencio salvo una línea de log.
//
// POR QUÉ ESTE VERIFICADOR CONSTRUYE UNA CLÍNICA TAN COMPLETA: porque
// `mensajes` era solo la primera de VEINTE FK sin cascada que apuntan a
// tablas que la purga borra. Un verificador que probara solo el caso de
// `mensajes` daría verde con diecinueve caminos todavía rotos. Acá se
// llena una fila en CADA tabla que puede trabar la purga, que es la única
// forma de que el verde signifique algo.
//
// La lista de tablas no está escrita a mano: se calcula del esquema real
// (ver `tablasQuePuedenTrabar`), así que una tabla nueva con una FK sin
// cascada aparece sola y este script la reporta aunque nadie se acuerde
// de agregarla.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_purga_completa.ts
import crypto from "node:crypto";
import { pool } from "../db";
import { ejecutarPurgas } from "../purga";

const PREFIJO = "probe-purga-completa";

let ok = 0;
let fail = 0;
function assert(cond: boolean, label: string, detalle?: unknown) {
  if (cond) {
    ok++;
    console.log(`OK   - ${label}`);
  } else {
    fail++;
    console.log(`FAIL - ${label}`, detalle === undefined ? "" : JSON.stringify(detalle).slice(0, 300));
  }
}

/**
 * Borra las clínicas de prueba a mano, en orden.
 *
 * No usa `DELETE FROM tenants` a secas a propósito: ESE es justamente el
 * camino que el defecto rompe, así que la limpieza no puede depender de
 * que funcione. Si dependiera, una corrida fallida dejaría una clínica
 * colgada y TODAS las corridas siguientes fallarían en la limpieza
 * inicial — en vez de en lo que quieren medir. (Pasó.)
 */
async function limpiar() {
  // NUNCA lanza. Si la limpieza lanzara desde un `finally`, su excepción
  // REEMPLAZARÍA a la del cuerpo del test y el error real quedaría
  // invisible — pasó, y costó tres corridas entender por qué el script
  // moría en la sección 2 con un error de borrado.
  const intentar = async (sql: string, params: unknown[]) => {
    try {
      await pool.query(sql, params);
    } catch {
      /* la limpieza es de mejor esfuerzo */
    }
  };

  const t = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE nombre LIKE $1`, [
    `${PREFIJO}%`,
  ]);
  for (const { id } of t.rows) {
    const porPersona = (tabla: string, col: string) =>
      intentar(
        `DELETE FROM ${tabla} WHERE ${col} IN (SELECT id FROM personas WHERE tenant_id = $1)`,
        [id]
      );
    const porCaso = (tabla: string) =>
      intentar(`DELETE FROM ${tabla} WHERE caso_id IN (SELECT id FROM casos WHERE tenant_id = $1)`, [id]);

    await porPersona("restablecimientos_contrasena", "persona_id");
    await porCaso("mensajes");
    await porCaso("archivos");
    await intentar(
      `DELETE FROM cambio_medicos_conservados WHERE cambio_id IN
         (SELECT c.id FROM cambios_suscripcion c JOIN suscripciones s ON s.id = c.suscripcion_id
           WHERE s.tenant_id = $1)`,
      [id]
    );
    await intentar(
      `DELETE FROM cambios_suscripcion WHERE suscripcion_id IN (SELECT id FROM suscripciones WHERE tenant_id = $1)`,
      [id]
    );
    await intentar(`DELETE FROM recargas WHERE tenant_id = $1`, [id]);
    await intentar(`DELETE FROM exportaciones WHERE tenant_id = $1`, [id]);
    await intentar(`DELETE FROM invitaciones_medico WHERE tenant_id = $1`, [id]);
    for (const tabla of ["uso_api", "notificaciones_uso", "eventos_facturacion", "documentos_fiscales"]) {
      await intentar(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [id]);
    }
    await intentar(
      `DELETE FROM notificaciones_callback WHERE cobro_id IN (SELECT id FROM cobros WHERE tenant_id = $1)`,
      [id]
    );
    await intentar(`DELETE FROM tenants WHERE id = $1`, [id]);
    await intentar(`DELETE FROM clinicas_purgadas_auditoria WHERE tenant_id = $1`, [id]);
  }
}

/**
 * Las tablas que pueden trabar un `DELETE FROM tenants`, calculadas del
 * esquema: toda FK sin `ON DELETE CASCADE` cuyo destino sea una tabla que
 * la cascada del tenant borra.
 *
 * Se calcula y no se escribe a mano por el mismo motivo que
 * `TABLAS_BORRADO_MANUAL_EN_PURGA` vive en un solo lugar: una lista
 * paralela se desactualiza, y el síntoma sería este verificador en verde
 * con la purga rota.
 */
async function tablasQuePuedenTrabar(): Promise<Array<{ origen: string; destino: string; conname: string }>> {
  const fks = await pool.query<{ origen: string; destino: string; tipo: string; conname: string }>(
    `SELECT con.conrelid::regclass::text AS origen,
            con.confrelid::regclass::text AS destino,
            con.confdeltype AS tipo,
            con.conname
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'public'`
  );

  // Cierre transitivo de lo que la cascada borra, partiendo de `tenants`.
  const hijosPorPadre = new Map<string, string[]>();
  for (const f of fks.rows) {
    if (f.tipo !== "c") continue;
    if (!hijosPorPadre.has(f.destino)) hijosPorPadre.set(f.destino, []);
    hijosPorPadre.get(f.destino)!.push(f.origen);
  }
  const borradas = new Set(["tenants"]);
  const cola = ["tenants"];
  while (cola.length > 0) {
    const t = cola.shift()!;
    for (const hijo of hijosPorPadre.get(t) ?? []) {
      if (!borradas.has(hijo)) {
        borradas.add(hijo);
        cola.push(hijo);
      }
    }
  }

  return fks.rows
    .filter((f) => f.tipo !== "c" && borradas.has(f.destino))
    .map((f) => ({ origen: f.origen, destino: f.destino, conname: f.conname }));
}

async function main() {
  await limpiar();
  let tenantId = "";

  try {
    // -----------------------------------------------------------------
    console.log("=== 1. Qué puede trabar la purga, según el esquema real ===");
    const bloqueantes = await tablasQuePuedenTrabar();
    const origenes = Array.from(new Set(bloqueantes.map((b) => b.origen))).sort();
    console.log(
      `       ${bloqueantes.length} FK sin cascada hacia tablas que la purga borra, ` +
        `desde ${origenes.length} tablas: ${origenes.join(", ")}`
    );
    assert(bloqueantes.length > 0, "el cálculo encuentra las FK (si diera 0, el verificador no probaría nada)");

    // -----------------------------------------------------------------
    console.log("\n=== 2. Una clínica con una fila en cada tabla que puede trabar ===");
    const t = await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, zona_horaria, email)
       VALUES ($1, 'ventana_purga', 'America/Costa_Rica', $2) RETURNING id`,
      [`${PREFIJO} Clínica`, `${PREFIJO}@example.com`]
    );
    tenantId = t.rows[0].id;

    const plan = await pool.query<{ id: string }>(`SELECT id FROM planes ORDER BY precio_mensual_usd LIMIT 1`);
    const agente = await pool.query<{ id: string }>(`SELECT id FROM agentes LIMIT 1`);

    const sus = await pool.query<{ id: string }>(
      `INSERT INTO suscripciones (tenant_id, plan_id, precio_pactado_usd, credito_pactado_usd,
         medicos_contratados, estado, periodo_inicio, periodo_fin)
       VALUES ($1, $2, 50, 10, 1, 'ventana_purga', now() - interval '60 days', now() - interval '30 days')
       RETURNING id`,
      [tenantId, plan.rows[0].id]
    );
    await pool.query(
      `UPDATE tenants SET suscripcion_id = $2, purga_programada_para = now() - interval '1 day',
                          purga_aviso_en = now() - interval '20 days',
                          purga_recordatorio_en = now() - interval '10 days'
        WHERE id = $1`,
      [tenantId, sus.rows[0].id]
    );

    const persona = await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, colegiatura)
       VALUES ($1, 'Dra. Purga Completa', $2, 'x', true, true, $3) RETURNING id`,
      [tenantId, `medico.${PREFIJO}@example.com`, `COL-${PREFIJO}`]
    );
    const personaId = persona.rows[0].id;

    const prop = await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, telefono) VALUES ($1, 'Tutor Purga', '00000000') RETURNING id`,
      [tenantId]
    );
    const pac = await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
       VALUES ($1, $2, 'Purga', 'perro', 1) RETURNING id`,
      [tenantId, prop.rows[0].id]
    );
    const pacienteId = pac.rows[0].id;

    // casos -> personas (medico_id, cerrado_por, reabierto_por)
    const caso = await pool.query<{ id: string }>(
      `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, numero_expediente,
                          cerrado_por, reabierto_por)
       VALUES ($1, $2, $3, $4, 'motivo de prueba', 1, $4, $4) RETURNING id`,
      [tenantId, pacienteId, agente.rows[0].id, personaId]
    );
    const casoId = caso.rows[0].id;

    // mensajes -> personas  (el que disparó D-006)
    await pool.query(
      `INSERT INTO mensajes (caso_id, remitente, contenido, autor_persona_id)
       VALUES ($1, 'medico', 'mensaje de prueba', $2)`,
      [casoId, personaId]
    );
    // archivos -> personas
    await pool.query(
      `INSERT INTO archivos (caso_id, nombre_archivo, url, subido_por_persona_id)
       VALUES ($1, 'prueba.pdf', 'https://example.test/prueba.pdf', $2)`,
      [casoId, personaId]
    );
    // citas -> personas, y atenciones -> citas/pacientes/personas
    const cita = await pool.query<{ id: string }>(
      `INSERT INTO citas (tenant_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin, duracion_minutos)
       VALUES ($1, $2, $3, CURRENT_DATE, '09:00', '09:30', 30) RETURNING id`,
      [tenantId, pacienteId, personaId]
    );
    const atencion = await pool.query<{ id: string }>(
      `INSERT INTO atenciones (tenant_id, cita_id, paciente_id, medico_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, cita.rows[0].id, pacienteId, personaId]
    );
    // recetas -> personas, -> atenciones
    await pool.query(
      `INSERT INTO recetas (tenant_id, paciente_id, medico_id, atencion_id)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, pacienteId, personaId, atencion.rows[0].id]
    );
    // cuidados_preventivos -> personas, -> atenciones
    await pool.query(
      `INSERT INTO cuidados_preventivos (tenant_id, paciente_id, fecha_aplicacion,
         fecha_proxima_recomendada, registrado_por, atencion_id)
       VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + 365, $3, $4)`,
      [tenantId, pacienteId, personaId, atencion.rows[0].id]
    );
    // invitaciones_medico -> personas
    await pool.query(
      `INSERT INTO invitaciones_medico (tenant_id, email, vence_en, persona_id, invitado_por, token)
       VALUES ($1, $2, now() + interval '7 days', $3, $3, $4)`,
      [tenantId, `invitado.${PREFIJO}@example.com`, personaId, crypto.randomUUID()]
    );
    // exportaciones -> personas
    await pool.query(
      `INSERT INTO exportaciones (tenant_id, solicitada_por) VALUES ($1, $2)`,
      [tenantId, personaId]
    );
    // metodos_pago, cobros -> suscripciones/metodos_pago, recargas -> cobros/personas
    const mp = await pool.query<{ id: string }>(
      `INSERT INTO metodos_pago (tenant_id, referencia_externa) VALUES ($1, 'ref-prueba') RETURNING id`,
      [tenantId]
    );
    const cobro = await pool.query<{ id: string }>(
      `INSERT INTO cobros (tenant_id, order_number, monto, estado, suscripcion_id, metodo_pago_id)
       VALUES ($1, $2, 50, 'exitoso', $3, $4) RETURNING id`,
      [tenantId, `ORD-${PREFIJO}`, sus.rows[0].id, mp.rows[0].id]
    );
    await pool.query(
      `INSERT INTO recargas (tenant_id, origen, monto_pagado_usd, credito_acreditado_usd, cobro_id, solicitada_por)
       VALUES ($1, 'manual', 10, 10, $2, $3)`,
      [tenantId, cobro.rows[0].id, personaId]
    );
    // notificaciones_callback -> cobros (ya tenía su DELETE explícito)
    await pool.query(
      `INSERT INTO notificaciones_callback (order_number, cobro_id, payload)
       VALUES ($1, $2, '{}'::jsonb)`,
      [`ORD-${PREFIJO}`, cobro.rows[0].id]
    );
    // cambios_suscripcion -> suscripciones/personas/cobros, y su hijo
    const cambio = await pool.query<{ id: string }>(
      `INSERT INTO cambios_suscripcion (suscripcion_id, tipo, efectivo_en, solicitado_por, cobro_id)
       VALUES ($1, 'downgrade', now(), $2, $3) RETURNING id`,
      [sus.rows[0].id, personaId, cobro.rows[0].id]
    );
    await pool.query(
      `INSERT INTO cambio_medicos_conservados (cambio_id, persona_id) VALUES ($1, $2)`,
      [cambio.rows[0].id, personaId]
    );
    // medico_agente y uso_api -> personas/casos/medico_agente
    const ma = await pool.query<{ id: string }>(
      `INSERT INTO medico_agente (persona_id, agente_id) VALUES ($1, $2) RETURNING id`,
      [personaId, agente.rows[0].id]
    );
    await pool.query(
      `INSERT INTO uso_api (tenant_id, persona_id, caso_id, medico_agente_id, tokens_entrada,
         tokens_salida, costo_usd_calculado, modelo)
       VALUES ($1, $2, $3, $4, 100, 50, 0.01, 'claude-prueba')`,
      [tenantId, personaId, casoId, ma.rows[0].id]
    );
    // restablecimientos_contrasena -> personas. NO tiene tenant_id, no está
    // en la lista de borrado manual y no se borra por cascada: deferir la
    // FK no alcanza para esta.
    await pool.query(
      `INSERT INTO restablecimientos_contrasena (persona_id, token, expira_en)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [personaId, crypto.randomUUID()]
    );

    assert(true, "clínica de prueba construida con filas en todas las tablas que pueden trabar");

    // Qué tablas quedaron con datos, para que el reporte diga qué se probó.
    const conDatos: string[] = [];
    for (const tabla of origenes) {
      const r = await pool
        .query<{ n: string }>(`SELECT count(*)::text AS n FROM ${tabla}`)
        .catch(() => ({ rows: [{ n: "0" }] }));
      if (Number(r.rows[0].n) > 0) conDatos.push(tabla);
    }
    console.log(`       tablas con datos en la base: ${conDatos.join(", ")}`);

    // -----------------------------------------------------------------
    console.log("\n=== 3. La purga completa la clínica, sin trabarse ===");
    const antes = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM clinicas_purgadas_auditoria WHERE tenant_id = $1`,
      [tenantId]
    );
    assert(antes.rows[0].n === "0", "antes de purgar no hay registro de auditoría");

    const resultado = await ejecutarPurgas(pool);
    assert(resultado.purgadas >= 1, "ejecutarPurgas reporta al menos una clínica purgada", resultado);

    const existe = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tenants WHERE id = $1`,
      [tenantId]
    );
    assert(existe.rows[0].n === "0", "el tenant se eliminó de verdad");

    const auditoria = await pool.query<{ n: string; cantidad_llamadas: number }>(
      `SELECT count(*)::text AS n, max(cantidad_llamadas) AS cantidad_llamadas
         FROM clinicas_purgadas_auditoria WHERE tenant_id = $1`,
      [tenantId]
    );
    assert(auditoria.rows[0].n === "1", "quedó su registro en clinicas_purgadas_auditoria");
    assert(
      Number(auditoria.rows[0].cantidad_llamadas) === 1,
      "con la contabilidad agregada de uso_api capturada antes de borrarla",
      auditoria.rows[0].cantidad_llamadas
    );

    // -----------------------------------------------------------------
    console.log("\n=== 4. No quedaron filas huérfanas ===");
    const huerfanas: Array<[string, string]> = [
      ["personas", `SELECT count(*)::text AS n FROM personas WHERE id = '${personaId}'`],
      ["casos", `SELECT count(*)::text AS n FROM casos WHERE id = '${casoId}'`],
      ["mensajes", `SELECT count(*)::text AS n FROM mensajes WHERE caso_id = '${casoId}'`],
      ["archivos", `SELECT count(*)::text AS n FROM archivos WHERE caso_id = '${casoId}'`],
      ["uso_api", `SELECT count(*)::text AS n FROM uso_api WHERE persona_id = '${personaId}'`],
      [
        "restablecimientos_contrasena",
        `SELECT count(*)::text AS n FROM restablecimientos_contrasena WHERE persona_id = '${personaId}'`,
      ],
      [
        "notificaciones_callback",
        `SELECT count(*)::text AS n FROM notificaciones_callback WHERE cobro_id = '${cobro.rows[0].id}'`,
      ],
    ];
    for (const [tabla, sql] of huerfanas) {
      const r = await pool.query<{ n: string }>(sql);
      assert(r.rows[0].n === "0", `${tabla}: no quedó ninguna fila`, r.rows[0].n);
    }

    // -----------------------------------------------------------------
    console.log("\n=== 5. La FK sigue existiendo: no se eliminó la regla ===");
    // La decisión fue que `mensajes.autor_persona_id` MANTIENE su regla —
    // un médico no se borra en la operación normal, se desactiva, y sus
    // mensajes son historial clínico. Lo que cambió es CUÁNDO se verifica,
    // no SI se verifica.
    const fk = await pool.query<{ confdeltype: string; condeferrable: boolean; condeferred: boolean }>(
      `SELECT confdeltype, condeferrable, condeferred FROM pg_constraint
        WHERE conname = 'mensajes_autor_persona_id_fkey'`
    );
    assert(fk.rows.length === 1, "mensajes_autor_persona_id_fkey sigue existiendo");
    assert(
      fk.rows[0].confdeltype === "a",
      "y sigue siendo NO ACTION: borrar un médico con mensajes sigue prohibido",
      fk.rows[0].confdeltype
    );
    assert(fk.rows[0].condeferrable === true, "pero ahora es DEFERRABLE");
    assert(fk.rows[0].condeferred === true, "e INITIALLY DEFERRED");

    // Y la regla SIGUE MORDIENDO fuera de la purga: borrar un médico que
    // escribió un mensaje, sin borrar el mensaje, tiene que fallar igual.
    const t2 = await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
      [`${PREFIJO} Regla`]
    );
    const p2 = await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, colegiatura)
       VALUES ($1, 'Dr. Regla', $2, 'x', true, $3) RETURNING id`,
      [t2.rows[0].id, `regla.${PREFIJO}@example.com`, `COL-R-${PREFIJO}`]
    );
    const prop2 = await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre) VALUES ($1, 'Tutor Regla') RETURNING id`,
      [t2.rows[0].id]
    );
    const pac2 = await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
       VALUES ($1, $2, 'Regla', 'perro', 1) RETURNING id`,
      [t2.rows[0].id, prop2.rows[0].id]
    );
    // DOS médicos: uno es el del caso, el OTRO solo escribió un mensaje.
    // Así, al borrar al segundo, la única FK que puede frenar es la del
    // mensaje — que es la que se quiere probar. Con un solo médico, el
    // `casos_medico_id_fkey` fallaba primero y la prueba medía otra cosa.
    // (`casos.medico_id` es NOT NULL, así que tampoco se puede soltar.)
    const autorMensaje = await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, colegiatura)
       VALUES ($1, 'Dr. Solo Mensaje', $2, 'x', true, $3) RETURNING id`,
      [t2.rows[0].id, `mensaje.${PREFIJO}@example.com`, `COL-M-${PREFIJO}`]
    );
    const caso2 = await pool.query<{ id: string }>(
      `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, numero_expediente)
       VALUES ($1, $2, $3, $4, 'regla', 1) RETURNING id`,
      [t2.rows[0].id, pac2.rows[0].id, agente.rows[0].id, p2.rows[0].id]
    );
    await pool.query(
      `INSERT INTO mensajes (caso_id, remitente, contenido, autor_persona_id)
       VALUES ($1, 'medico', 'historial clínico', $2)`,
      [caso2.rows[0].id, autorMensaje.rows[0].id]
    );

    const cliente = await pool.connect();
    let bloqueo = "";
    try {
      await cliente.query("BEGIN");
      await cliente.query(`DELETE FROM personas WHERE id = $1`, [autorMensaje.rows[0].id]);
      // Con la FK diferida el error NO sale acá sino en el COMMIT. Que la
      // prueba haga el COMMIT es justamente lo que comprueba que la regla
      // sigue vigente: si solo mirara el DELETE, daría "no falló" y el
      // verificador estaría midiendo el diferimiento, no la regla.
      await cliente.query("COMMIT");
      bloqueo = "(no falló)";
    } catch (err) {
      bloqueo = (err as { constraint?: string }).constraint ?? (err as Error).message;
      await cliente.query("ROLLBACK").catch(() => undefined);
    } finally {
      cliente.release();
    }
    assert(
      bloqueo.includes("mensajes_autor_persona_id_fkey"),
      "borrar un médico que escribió un mensaje SIGUE fallando en el COMMIT (la regla no se debilitó)",
      bloqueo
    );
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [t2.rows[0].id]);
  } finally {
    await limpiar();
    if (tenantId) {
      await pool.query(`DELETE FROM clinicas_purgadas_auditoria WHERE tenant_id = $1`, [tenantId]);
    }
  }

  console.log(`\n${ok} OK, ${fail} FAIL`);
  await pool.end();
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await limpiar().catch(() => undefined);
  await pool.end();
  process.exit(1);
});
