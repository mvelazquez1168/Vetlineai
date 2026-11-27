// Verificación del prompt 16a — el banco de 40 preguntas de uso.
//
//   docker compose exec backend npx ts-node src/scripts/verificar_ayuda_16a.ts
//
// Y con el modelo de verdad, para tres preguntas:
//
//   docker compose exec backend npx ts-node src/scripts/verificar_ayuda_16a.ts --con-modelo
//
// QUÉ VERIFICA Y POR QUÉ ASÍ:
//
// La parte que puede mentir es la **búsqueda**: si trae la página
// equivocada, el modelo redacta muy bien una respuesta incorrecta. Por
// eso el banco de 40 verifica, para cada pregunta, que la página que la
// contesta esté entre las que la búsqueda encontró. Eso es determinista,
// se corre en segundos y no gasta un peso de crédito.
//
// LAS LLAMADAS AL MODELO SE CORREN CON `--con-modelo` y solo tres: cada
// llamada consume crédito de una clínica real, y correr 40 en cada
// verificación sería cobrarle a Medicavet por probar el sistema. Las
// tres alcanzan para comprobar lo que el modelo tiene que hacer: citar
// el manual, dar el camino de clics y **decir que no sabe** cuando no
// está.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { cargarAyuda } from "../ayuda/cargador";
import { buscarSecciones, palabrasDe, responder } from "../ayuda/agenteAyuda";

const PREFIJO = "probe-16a";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

/**
 * EL BANCO DE 40 PREGUNTAS DE USO.
 *
 * Son las que una clínica pregunta de verdad el primer mes, incluidas
 * las dudas que el prompt nombra: registrar la atención, las vacunas y
 * la receta; crear servicios; encontrar el expediente.
 *
 * `archivo` es la página del manual que tiene que aparecer entre las
 * encontradas. No se pide que sea la primera: «¿cómo cobro?» puede
 * traer primero la página de presupuestos y estar bien, mientras la de
 * caja esté ahí.
 */
const BANCO: Array<{ pregunta: string; archivo: string }> = [
  // --- La atención ---
  { pregunta: "¿Cómo registro una vacuna?", archivo: "atencion-vacunas-y-desparasitaciones.md" },
  { pregunta: "¿Dónde pongo el lote de la vacuna que apliqué?", archivo: "atencion-vacunas-y-desparasitaciones.md" },
  { pregunta: "¿Cómo registro una desparasitación?", archivo: "atencion-vacunas-y-desparasitaciones.md" },
  { pregunta: "¿Cómo hago una receta?", archivo: "atencion-receta.md" },
  { pregunta: "¿Cómo calculo la dosis por peso?", archivo: "atencion-receta.md" },
  { pregunta: "¿Cómo cierro la atención?", archivo: "atencion-cierre.md" },
  { pregunta: "¿Qué pasa cuando firmo la consulta?", archivo: "atencion-cierre.md" },
  { pregunta: "¿Cómo pido un estudio de laboratorio?", archivo: "atencion-estudios.md" },
  { pregunta: "¿La consulta se guarda sola?", archivo: "atencion-autoguardado.md" },
  { pregunta: "Se me cayó internet mientras escribía la consulta", archivo: "atencion-autoguardado.md" },
  { pregunta: "¿Cómo registro una vacuna que se puso en otra clínica?", archivo: "registro-historico.md" },
  // --- Dictado ---
  { pregunta: "¿Cómo dicto la consulta por voz?", archivo: "dictado-consulta-completa.md" },
  { pregunta: "¿Cómo uso el micrófono en un campo?", archivo: "dictado-en-un-campo.md" },
  { pregunta: "¿En qué navegadores funciona el dictado?", archivo: "dictado-en-un-campo.md" },
  // --- Paciente y cliente ---
  { pregunta: "¿Cómo doy de alta un paciente?", archivo: "paciente-datos-y-baja.md" },
  { pregunta: "¿Cómo doy de baja una mascota que falleció?", archivo: "paciente-datos-y-baja.md" },
  { pregunta: "¿Dónde encuentro el expediente de un paciente?", archivo: "paciente-datos-y-baja.md" },
  { pregunta: "¿Cómo cargo el correo y el teléfono de un cliente?", archivo: "clientes-datos-y-contacto.md" },
  { pregunta: "¿Cómo sé por dónde le puedo escribir al cliente?", archivo: "clientes-datos-y-contacto.md" },
  { pregunta: "Tengo el mismo cliente dos veces, ¿cómo los junto?", archivo: "clientes-duplicados.md" },
  // --- Caja y facturación ---
  { pregunta: "¿Cómo hago un presupuesto?", archivo: "presupuestos.md" },
  { pregunta: "¿Cómo cobro un anticipo?", archivo: "presupuestos.md" },
  { pregunta: "¿Cómo cierro la caja?", archivo: "caja-arqueo-vales-y-datafono.md" },
  { pregunta: "¿Qué hago con los vales de caja?", archivo: "caja-arqueo-vales-y-datafono.md" },
  { pregunta: "¿Cómo aplico un descuento?", archivo: "descuentos.md" },
  { pregunta: "¿Por qué me pide autorización para descontar?", archivo: "descuentos.md" },
  { pregunta: "¿Qué hago con la factura que me mandó un proveedor?", archivo: "facturas-de-proveedores.md" },
  { pregunta: "¿Qué actividad económica va en el comprobante?", archivo: "actividad-economica.md" },
  // --- Finanzas (10a) ---
  { pregunta: "¿Dónde veo lo que le debo a los proveedores?", archivo: "finanzas-cuentas-por-pagar.md" },
  { pregunta: "¿Cómo registro un pago a un proveedor?", archivo: "finanzas-cuentas-por-pagar.md" },
  { pregunta: "¿Cómo registro el recibo de la luz?", archivo: "finanzas-gastos.md" },
  { pregunta: "¿Cómo cargo el alquiler todos los meses?", archivo: "finanzas-gastos.md" },
  { pregunta: "¿Cómo le recuerdo a un cliente que me debe?", archivo: "finanzas-cobranza-y-cierre.md" },
  { pregunta: "¿Cómo concilio los SINPE del día?", archivo: "finanzas-cobranza-y-cierre.md" },
  // --- Administración (04 y 11) ---
  { pregunta: "¿Cómo invito a una recepcionista?", archivo: "personal-y-roles.md" },
  { pregunta: "¿Cómo le quito el acceso a alguien que se fue?", archivo: "personal-y-roles.md" },
  { pregunta: "¿Cómo configuro el horario de la clínica?", archivo: "horario-y-feriados.md" },
  { pregunta: "¿Cómo marco que trabajamos un feriado?", archivo: "horario-y-feriados.md" },
  { pregunta: "¿Dónde cambio el tope de descuento?", archivo: "politicas-de-la-clinica.md" },
  { pregunta: "¿Cómo armo los turnos de la semana?", archivo: "turnos-ausencias-y-comisiones.md" },
  { pregunta: "¿Cómo liquido las comisiones del mes?", archivo: "turnos-ausencias-y-comisiones.md" },
  { pregunta: "¿Dónde veo quién anuló un cobro?", archivo: "cumplimiento-y-auditoria.md" },
  { pregunta: "¿Cómo creo una familia de productos?", archivo: "catalogos-y-clasificacion.md" },
];

async function main() {
  exigirEntornoDeDesarrollo("verificar_ayuda_16a");
  const conModelo = (globalThis as { process?: { argv?: string[] } }).process?.argv?.includes(
    "--con-modelo"
  );

  // El consumo de IA no se va en cascada con el tenant —su FK es
  // RESTRICT, para que un borrado accidental no se lleve la
  // facturación—, así que la limpieza lo borra primero. Es lo mismo que
  // hace la purga real, en su orden.
  await pool.query(
    `DELETE FROM uso_api WHERE tenant_id IN (SELECT id FROM tenants WHERE nombre LIKE $1)`,
    [`${PREFIJO}%`]
  );
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  // El manual, cargado desde el disco. Que el verificador lo cargue es a
  // propósito: así verifica también el cargador.
  const carga = await cargarAyuda(pool);
  assert(carga.archivos >= 20, "el manual se carga desde docs/ayuda/", carga.archivos);
  assert(carga.secciones >= 100, "partido en secciones", carga.secciones);

  // Recargar no duplica.
  const otraVez = await cargarAyuda(pool);
  igual(otraVez.secciones, carga.secciones, "recargarlo da lo mismo: no duplica");

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@16a.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  // LA SUSCRIPCIÓN, para que la compuerta de crédito deje pasar al
  // modelo. Sin esto, `verificarAntesDeGenerar` rechaza con «la
  // suscripción no está activa» —que es su trabajo— y la prueba con
  // modelo no prueba nada.
  const plan = (
    await pool.query<{ id: string }>(`SELECT id FROM planes ORDER BY precio_mensual_usd LIMIT 1`)
  ).rows[0]?.id;
  if (plan) {
    const suscripcion = await pool.query<{ id: string }>(
      `INSERT INTO suscripciones
         (tenant_id, plan_id, periodicidad, precio_pactado_usd, credito_pactado_usd,
          medicos_contratados, estado, periodo_inicio, periodo_fin)
       VALUES ($1,$2,'mensual',49,10,2,'activa', now() - interval '5 days', now() + interval '25 days')
       RETURNING id`,
      [tenantId, plan]
    );
    await pool.query(`UPDATE tenants SET suscripcion_id = $1 WHERE id = $2`, [
      suscripcion.rows[0].id,
      tenantId,
    ]);
    await pool.query(
      `INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd) VALUES ($1, 50, 0)`,
      [tenantId]
    );
  }

  const personaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, estado)
       VALUES ($1,'Ana Admin',$2,'x',false,true,'activo') RETURNING id`,
      [tenantId, `${PREFIJO}-ana@probe.test`]
    )
  ).rows[0].id;

  // -------------------------------------------------------------------
  console.log("\n=== Las palabras de la pregunta ===");
  // -------------------------------------------------------------------
  igual(
    palabrasDe("¿Cómo registro una vacuna?"),
    ["registro", "vacuna"],
    "las palabras vacías no se buscan: «cómo» y «una» están en todas las páginas"
  );
  igual(palabrasDe("¿Qué hago?"), [], "una pregunta sin palabras propias no busca nada");

  // -------------------------------------------------------------------
  console.log("\n=== El banco de 40 preguntas ===");
  // -------------------------------------------------------------------
  let aciertos = 0;
  const fallidas: string[] = [];
  await conAlcanceTenant(tenantId, async (db) => {
    for (const caso of BANCO) {
      const secciones = await buscarSecciones(db, caso.pregunta, 5);
      const acerto = secciones.some((s) => s.archivo === caso.archivo);
      if (acerto) aciertos += 1;
      else fallidas.push(`${caso.pregunta} → esperaba ${caso.archivo}, trajo ${secciones.map((s) => s.archivo).join(", ") || "nada"}`);
    }
  });

  console.log(`    ${aciertos} de ${BANCO.length} preguntas encuentran su página.`);
  for (const f of fallidas) console.log(`    · ${f}`);
  // EL UMBRAL ES 40 DE 40 y no «la mayoría»: el prompt pide que el banco
  // se apruebe. Una pregunta que no encuentra su página es una respuesta
  // que el agente va a improvisar o no va a dar.
  assert(
    aciertos === BANCO.length,
    `el banco de ${BANCO.length} preguntas pasa entero`,
    `${aciertos}/${BANCO.length}`
  );

  // -------------------------------------------------------------------
  console.log("\n=== Lo que el manual no cubre ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const nada = await buscarSecciones(db, "cómo exporto la contabilidad a Monica 8.5", 5);
    assert(
      nada.length === 0 || !nada.some((s) => s.puntaje >= 4),
      "una pregunta que el manual no cubre no trae una página con puntaje alto",
      nada.map((s) => `${s.archivo}:${s.puntaje}`).join(", ")
    );

    // Y la respuesta: sin cobertura, no se llama al modelo.
    const r = await responder(db, {
      tenantId,
      personaId,
      permisos: new Set<string>(),
      pregunta: "zxqw plimbo frumioso",
      rutaActual: null,
    });
    assert(!r.respondio, "con una pregunta sin ninguna coincidencia, el agente dice que no sabe");
    igual(r.motivo, "sin_cobertura", "y deja el motivo");
    igual(r.modelo, undefined, "SIN llamar al modelo: no se gasta crédito en decir que no se sabe");

    const registradas = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ayuda_consultas
        WHERE tenant_id = $1 AND NOT respondio AND motivo = 'sin_cobertura'`,
      [tenantId]
    );
    assert(registradas.rows[0].n >= 1, "y la pregunta queda registrada: es lo que falta documentar");
  });

  // -------------------------------------------------------------------
  console.log("\n=== El rol de quien pregunta ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // Una página con permiso declarado: la de descuentos.
    await db.query(
      `UPDATE ayuda_paginas SET permisos = ARRAY['caja.descuento']::varchar[]
        WHERE archivo = 'descuentos.md'`
    );
    const conPermiso = await buscarSecciones(db, "cómo aplico un descuento", 3);
    assert(
      conPermiso[0]?.permisos.includes("caja.descuento"),
      "la página declara el permiso que su acción necesita"
    );
    // El aviso lo arma el código al responder: se verifica en la prueba
    // con modelo, abajo, porque antes de eso no hay texto que revisar.
  });

  // -------------------------------------------------------------------
  if (conModelo) {
    console.log("\n=== Con el modelo de verdad (tres preguntas) ===");
    await conAlcanceTenant(tenantId, async (db) => {
      const r1 = await responder(db, {
        tenantId,
        personaId,
        permisos: new Set(["caja.cobrar"]),
        pregunta: "¿Cómo registro una vacuna?",
        rutaActual: "/pacientes",
      });
      assert(r1.respondio, "contesta cómo se registra una vacuna", r1.texto.slice(0, 160));
      assert(
        r1.fuentes.some((f) => f.archivo === "atencion-vacunas-y-desparasitaciones.md"),
        "citando la página del manual que corresponde"
      );

      const r2 = await responder(db, {
        tenantId,
        personaId,
        permisos: new Set<string>(),
        pregunta: "¿Cómo aplico un descuento?",
        rutaActual: "/ventas",
      });
      assert(
        (r2.texto ?? "").includes("Tu rol no puede hacer esto"),
        "y a quien no tiene el permiso se lo dice",
        r2.texto.slice(-200)
      );

      const r3 = await responder(db, {
        tenantId,
        personaId,
        permisos: new Set<string>(),
        pregunta: "¿Cómo conecto Vetline con mi sistema de alarmas?",
        rutaActual: null,
      });
      assert(
        !r3.respondio || r3.texto.toLowerCase().includes("no está en el manual"),
        "lo que no está en el manual, no se inventa",
        r3.texto.slice(0, 160)
      );

      const consumo = await db.query<{ n: number; tokens: number }>(
        `SELECT count(*)::int AS n, COALESCE(sum(tokens_entrada + tokens_salida), 0)::int AS tokens
           FROM ayuda_consultas WHERE tenant_id = $1 AND modelo IS NOT NULL`,
        [tenantId]
      );
      console.log(
        `    ${consumo.rows[0].n} llamada(s) al modelo, ${consumo.rows[0].tokens} tokens en total.`
      );
    });
  } else {
    console.log("\n(Sin --con-modelo: no se llamó al modelo y no se consumió crédito.)");
  }

  // El consumo de IA no se va en cascada con el tenant —su FK es
  // RESTRICT, para que un borrado accidental no se lleve la
  // facturación—, así que la limpieza lo borra primero. Es lo mismo que
  // hace la purga real, en su orden.
  await pool.query(
    `DELETE FROM uso_api WHERE tenant_id IN (SELECT id FROM tenants WHERE nombre LIKE $1)`,
    [`${PREFIJO}%`]
  );
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS"}`);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = ok ? 0 : 1;
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
});
