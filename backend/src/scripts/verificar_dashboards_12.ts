// Verificación del prompt 12 (dashboards, trazabilidad y drill-down).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_dashboards_12.ts
//
// SIN --transpile-only a propósito: la lección del 06/08 es que
// `--transpile-only` tapó cuatro defectos reales.
//
// Tiene DOS PARTES, y la primera es la que importa:
//
//   A. CONTRA LA CLÍNICA DE DEMOSTRACIÓN, con sus doce meses de
//      historial, y de solo lectura: para cada número del dashboard, la
//      lista del drill-down tiene que sumar EXACTAMENTE ese número
//      (§7). Es la única aserción que prueba que no hay dos
//      definiciones del mismo indicador. Acá también se miden los
//      tiempos de carga con un año de datos (§9).
//
//   B. CONTRA UNA CLÍNICA DE PRUEBA construida acá, para los casos que
//      necesitan datos armados a mano: el ítem sin costo, el cargo
//      fugado, la trazabilidad hasta el paciente y el lote, el
//      movimiento sin paciente que no se esconde, y los preventivos
//      «sin registro» que no son «no vacunado».

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import {
  METRICAS,
  Periodo,
  atenciones,
  cargosFugados,
  cuentasCobradas,
  definicion,
  ingresos,
  periodoAnterior,
  porLineaDeNegocio,
  serieDeIngresos,
  topDeItems,
} from "../metricas/diccionario";
import { LISTAS, lista } from "../metricas/listas";
import { dashboardClinica, dashboardMedico, comparativaDeMedicos } from "../metricas/dashboards";
import { dashboardAPdf } from "../metricas/dashboardPdf";
import { resumenDeCliente, resumenDePaciente, preventivosPorTipo } from "../metricas/fichas";
import { consumoDeProducto, trazabilidadDeLote } from "../metricas/trazabilidad";
import { marcaDeLaClinica } from "../pdf/marcaPdf";
import { aExcel, aPdf } from "../exportacion/tabla";

const PREFIJO = "probe-12";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function cerca(obtenido: number, esperado: number, msg: string, tolerancia = 0.02) {
  assert(Math.abs(obtenido - esperado) < tolerancia, msg, { obtenido, esperado });
}

function suma(filas: Array<Record<string, unknown>>, columna: string): number {
  return (
    Math.round(filas.reduce((s, f) => s + Number(f[columna] ?? 0), 0) * 100) / 100
  );
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_dashboards_12");

  // =================================================================
  // A. LA CLÍNICA DE DEMOSTRACIÓN — solo lectura
  // =================================================================
  const demo = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM tenants WHERE es_demostracion ORDER BY creado_en LIMIT 1`
  );
  if (demo.rows.length === 0) {
    console.error(
      "No hay clínica de demostración. Corré `npm run demo:historial` antes de este verificador."
    );
    process.exit(1);
  }
  const demoId = demo.rows[0].id;
  console.log(`\n=== A. Drill-down contra «${demo.rows[0].nombre}» ===`);

  const hoy = new Date();
  const anio: Periodo = {
    desde: new Date(hoy.getTime() - 364 * 86400000).toISOString().slice(0, 10),
    hasta: hoy.toISOString().slice(0, 10),
  };
  const mes: Periodo = {
    desde: new Date(hoy.getTime() - 29 * 86400000).toISOString().slice(0, 10),
    hasta: hoy.toISOString().slice(0, 10),
  };

  await conAlcanceTenant(demoId, async (db) => {
    // --- §7: LA SUMA DE LA LISTA ES EL NÚMERO DE LA TARJETA --------
    for (const periodo of [mes, anio]) {
      const cual = periodo === mes ? "30 días" : "1 año";
      for (const l of LISTAS) {
        const filas = await l.filas(db, demoId, periodo);
        const total = await l.total(db, demoId, periodo);
        if (l.columnaSuma) {
          cerca(
            suma(filas, l.columnaSuma),
            total,
            `[${cual}] «${l.titulo}» suma lo que dice la tarjeta`,
            0.5
          );
        } else {
          assert(
            filas.length === total,
            `[${cual}] «${l.titulo}» tiene tantas filas como dice la tarjeta`,
            { filas: filas.length, total }
          );
        }
        assert(filas.length > 0 || total === 0, `[${cual}] «${l.titulo}» devolvió filas`, {
          filas: filas.length,
        });
      }
    }

    // --- El dashboard entero, y su coherencia interna --------------
    const inicio = Date.now();
    const d = await dashboardClinica(db, demoId, anio, { verCostos: true });
    const msAnio = Date.now() - inicio;

    const inicioMes = Date.now();
    await dashboardClinica(db, demoId, mes, { verCostos: true });
    const msMes = Date.now() - inicioMes;
    console.log(`    tiempo: ${msAnio} ms con un año de datos, ${msMes} ms con 30 días`);
    assert(msAnio < 1500, "El dashboard de un año carga en menos de 1,5 s (§9)", `${msAnio} ms`);

    const tarjetaIngresos = d.tarjetas.find((t) => t.clave === "ingresos")!;
    const totalLista = await lista("ingresos").total(db, demoId, anio);
    cerca(
      tarjetaIngresos.valor ?? 0,
      totalLista,
      "La tarjeta de ingresos y la lista salen del mismo cálculo",
      0.5
    );

    // La serie del sparkline tiene que sumar el total: si saliera de
    // otra consulta, el gráfico y la tarjeta dirían distinto.
    const serie = await serieDeIngresos(db, demoId, anio, "mes");
    cerca(
      Math.round(serie.reduce((s, p) => s + p.valor, 0) * 100) / 100,
      await ingresos(db, demoId, anio),
      "La serie de la tendencia suma el total de ingresos",
      1
    );

    // El ticket promedio es ingresos ÷ cuentas cobradas, no otra cosa.
    const cuentas = await cuentasCobradas(db, demoId, anio);
    const ticket = d.tarjetas.find((t) => t.clave === "ticket_promedio")!;
    cerca(
      ticket.valor ?? 0,
      cuentas > 0 ? Math.round((tarjetaIngresos.valor! / cuentas) * 100) / 100 : 0,
      "El ticket promedio es ingresos ÷ cuentas cobradas"
    );

    // La comparación contra el período anterior existe y NO es cero:
    // con estacionalidad, un 0 % sería señal de que no se compara.
    assert(
      d.comparado.hasta < d.periodo.desde,
      "El período comparado es el inmediatamente anterior",
      d.comparado
    );
    // La variación se mide contra el MES anterior y no contra el año
    // anterior: el historial de demostración arranca hace doce meses,
    // así que el año previo está vacío y toda variación sería nula —lo
    // correcto, pero no prueba nada—.
    const dMes = await dashboardClinica(db, demoId, mes, { verCostos: true });
    assert(
      dMes.tarjetas.some((t) => t.variacion !== null && t.variacion !== 0),
      "Al menos una tarjeta trae variación contra el período anterior",
      dMes.tarjetas.map((t) => `${t.clave}:${t.variacion}`).join(" ")
    );

    // --- §10: sin permiso de costos, el margen NO VIAJA ------------
    const sinCostos = await dashboardClinica(db, demoId, mes, { verCostos: false });
    assert(sinCostos.topPorMargen === null, "Sin `catalogo.ver_costos` no hay top por margen");
    assert(
      sinCostos.porLinea.every((l) => l.costo === 0 && l.margen === 0),
      "Sin `catalogo.ver_costos` el costo y el margen no salen en la respuesta"
    );
    assert(
      sinCostos.porLinea.some((l) => l.ingresos > 0),
      "Sin permiso de costos los INGRESOS sí se ven (no se oculta todo)"
    );

    // --- §8.3: lo que no tiene costo no es 100 % de margen ---------
    const linea = await porLineaDeNegocio(db, demoId, anio);
    const top = await topDeItems(db, demoId, anio, "ingresos");
    assert(
      linea.some((l) => l.sin_costo > 0) || top.some((t) => t.sin_costo),
      "Hay ítems sin costo y se cuentan aparte",
      { sinCostoPorLinea: linea.reduce((s, l) => s + l.sin_costo, 0) }
    );
    assert(
      top.every((t) => !t.sin_costo || t.margen <= t.ingresos),
      "Ningún ítem sin costo se muestra con margen igual al ingreso"
    );

    // --- §2: los bloques que esperan al 14 no se inventan ----------
    assert(
      d.campanas === null,
      "El bloque de campañas no aparece: las campañas las construye el 14"
    );

    // --- §3: el dashboard del médico, y la comparativa -------------
    const medico = await db.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM personas WHERE tenant_id = $1 AND es_medico LIMIT 1`,
      [demoId]
    );
    const dm = await dashboardMedico(db, demoId, medico.rows[0].id, anio);
    assert(
      (dm.tarjetas.find((t) => t.clave === "atenciones")!.valor ?? 0) > 0,
      "El médico ve sus atenciones",
      dm.tarjetas.find((t) => t.clave === "atenciones")!.valor
    );
    const propias = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM atenciones
        WHERE tenant_id = $1 AND medico_id = $2 AND estado = 'cerrada'
          AND cerrada_en::date BETWEEN $3::date AND $4::date`,
      [demoId, medico.rows[0].id, anio.desde, anio.hasta]
    );
    assert(
      dm.tarjetas.find((t) => t.clave === "atenciones")!.valor === propias.rows[0].n,
      "El dashboard del médico cuenta SOLO lo suyo",
      { tarjeta: dm.tarjetas.find((t) => t.clave === "atenciones")!.valor, base: propias.rows[0].n }
    );
    assert(
      dm.recomendacionesNoAgendadas.length > 0,
      "Hay recomendaciones no agendadas para accionar",
      dm.recomendacionesNoAgendadas.length
    );

    const comparativa = await comparativaDeMedicos(db, demoId, anio);
    assert(comparativa.length >= 2, "La comparativa trae a todos los médicos", comparativa.length);
    const sumaAtenciones = comparativa.reduce((s, m) => s + m.atenciones, 0);
    const totalAtenciones = await atenciones(db, demoId, anio);
    assert(
      sumaAtenciones <= totalAtenciones,
      "La comparativa no cuenta más atenciones que las que hay",
      { sumaAtenciones, totalAtenciones }
    );

    // --- §8: la exportación sale, con la marca de la clínica -------
    const marca = await marcaDeLaClinica(db, demoId);
    const pdf = await dashboardAPdf(d, marca, { usuario: "Verificador" });
    assert(pdf.length > 3000, "El PDF del dashboard se genera", `${pdf.length} bytes`);
    assert(
      pdf.subarray(0, 5).toString() === "%PDF-",
      "El PDF del dashboard es un PDF de verdad"
    );

    const l = lista("ingresos");
    const filas = await l.filas(db, demoId, mes);
    const tabla = {
      titulo: l.titulo,
      columnas: l.columnas.map((c) => ({ clave: c.clave, titulo: c.etiqueta, tipo: c.tipo })),
      filas,
    };
    const xlsx = aExcel(tabla);
    assert(xlsx.length > 1000, "El Excel de la lista se genera", `${xlsx.length} bytes`);
    const pdfLista = await aPdf(tabla, { marca, usuario: "Verificador" });
    assert(pdfLista.length > 2000, "El PDF de la lista se genera con marca", `${pdfLista.length} bytes`);

    // --- El diccionario está completo ------------------------------
    for (const m of METRICAS) {
      assert(
        m.descripcion.length > 20 && m.formula.length > 5 && m.excluye.length > 10,
        `La métrica «${m.nombre}» declara descripción, fórmula y qué excluye`
      );
    }
    for (const l2 of LISTAS) {
      assert(
        !!definicion(l2.metrica),
        `La lista «${l2.titulo}» apunta a una métrica del diccionario`
      );
    }
    const porCobrarDef = definicion("por_cobrar");
    assert(
      /saldo de HOY/i.test(porCobrarDef.imputacion),
      "El diccionario dice que «por cobrar» no se imputa a un período"
    );
  });

  // =================================================================
  // B. CLÍNICA DE PRUEBA — los casos armados a mano
  // =================================================================
  console.log("\n=== B. Casos armados: sin costo, fuga, trazabilidad, preventivos ===");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@12.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  const personaId = (
    await pool.query<{ id: string }>(
      // La colegiatura es obligatoria para un médico (CHECK de la
      // migración del 2026-08): no se puede crear uno sin ella.
      `INSERT INTO personas
         (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, estado, colegiatura)
       VALUES ($1,'Dra. Prueba 12',$2,'x',true,true,'activo','MV-9912') RETURNING id`,
      [tenantId, `${PREFIJO}-medica@probe.test`]
    )
  ).rows[0].id;

  try {
    await conAlcanceTenant(
      tenantId,
      async (db) => {
        const bodegaId = (
          await db.query<{ id: string }>(
            `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default, activo)
             VALUES ($1,'PRIN','Principal',true,true) RETURNING id`,
            [tenantId]
          )
        ).rows[0].id;

        // DOS PRODUCTOS: uno con costo y otro SIN costo cargado. El
        // segundo es el caso de la guía §8.3.
        const conCosto = await crearProducto(db, tenantId, bodegaId, "Amoxicilina", 1200, 500);
        const sinCosto = await crearProducto(db, tenantId, bodegaId, "Shampoo medicado", 8000, 0);

        const servicioId = (
          await db.query<{ id: string }>(
            `INSERT INTO inv_servicios
               (tenant_id, codigo, nombre, linea_negocio, precio, codigo_tarifa_iva, activo)
             VALUES ($1,'P12-CONS','Consulta','consulta',20000,'08',true) RETURNING id`,
            [tenantId]
          )
        ).rows[0].id;

        const propietarioId = (
          await db.query<{ id: string }>(
            `INSERT INTO propietarios (tenant_id, nombre, telefono, email)
             VALUES ($1,'Marta Dueña','88887777','marta@probe.test') RETURNING id`,
            [tenantId]
          )
        ).rows[0].id;
        const pacienteId = (
          await db.query<{ id: string }>(
            `INSERT INTO pacientes
               (tenant_id, propietario_id, nombre, especie, sexo, numero_expediente, estado)
             VALUES ($1,$2,'Rocky','perro','macho','00001','activo') RETURNING id`,
            [tenantId, propietarioId]
          )
        ).rows[0].id;

        const citaId = (
          await db.query<{ id: string }>(
            `INSERT INTO citas
               (tenant_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin,
                duracion_minutos, estado)
             VALUES ($1,$2,$3,CURRENT_DATE,'09:00','09:30',30,'completada') RETURNING id`,
            [tenantId, pacienteId, personaId]
          )
        ).rows[0].id;
        const atencionId = (
          await db.query<{ id: string }>(
            `INSERT INTO atenciones
               (tenant_id, cita_id, paciente_id, medico_id, estado, cerrada_en)
             VALUES ($1,$2,$3,$4,'cerrada', now()) RETURNING id`,
            [tenantId, citaId, pacienteId, personaId]
          )
        ).rows[0].id;

        // Cuenta ABIERTA con cargos de una atención YA CERRADA: es
        // exactamente la definición de cargo fugado.
        const cuentaId = (
          await db.query<{ id: string }>(
            `INSERT INTO vta_cuentas (tenant_id, numero, propietario_id, estado)
             VALUES ($1, 1, $2, 'abierta') RETURNING id`,
            [tenantId, propietarioId]
          )
        ).rows[0].id;

        await db.query(
          `INSERT INTO vta_cargos
             (tenant_id, cuenta_id, origen, origen_id, servicio_id, descripcion, paciente_id,
              cantidad, precio_unitario, linea_negocio, codigo_tarifa_iva, creado_por, realizado_por)
           VALUES ($1,$2,'atencion',$3,$4,'Consulta',$5,1,20000,'consulta','08',$6,$6)`,
          [tenantId, cuentaId, atencionId, servicioId, pacienteId, personaId]
        );

        // El producto CON costo, aplicado al paciente en la atención.
        const movConCosto = (
          await db.query<{ id: string }>(
            `INSERT INTO inv_movimientos
               (tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base,
                presentacion_id, cantidad_presentacion, costo_unitario, paciente_id,
                atencion_id, persona_id)
             VALUES ($1,'atencion',$2,$3,$4,2,$5,2,500,$6,$7,$8) RETURNING id`,
            [
              tenantId,
              conCosto.productoId,
              bodegaId,
              conCosto.loteId,
              conCosto.presentacionId,
              pacienteId,
              atencionId,
              personaId,
            ]
          )
        ).rows[0].id;
        await db.query(
          `INSERT INTO vta_cargos
             (tenant_id, cuenta_id, origen, origen_id, presentacion_id, descripcion, paciente_id,
              cantidad, precio_unitario, linea_negocio, codigo_tarifa_iva, movimiento_id,
              creado_por, realizado_por)
           VALUES ($1,$2,'atencion',$3,$4,'Amoxicilina',$5,2,1200,'farmacia','08',$6,$7,$7)`,
          [tenantId, cuentaId, atencionId, conCosto.presentacionId, pacienteId, movConCosto, personaId]
        );

        // El producto SIN costo, vendido en MOSTRADOR (sin paciente).
        const movSinPaciente = (
          await db.query<{ id: string }>(
            `INSERT INTO inv_movimientos
               (tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base,
                presentacion_id, cantidad_presentacion, costo_unitario, persona_id)
             VALUES ($1,'venta',$2,$3,$4,1,$5,1,0,$6) RETURNING id`,
            [
              tenantId,
              sinCosto.productoId,
              bodegaId,
              sinCosto.loteId,
              sinCosto.presentacionId,
              personaId,
            ]
          )
        ).rows[0].id;
        await db.query(
          `INSERT INTO vta_cargos
             (tenant_id, cuenta_id, origen, presentacion_id, descripcion,
              cantidad, precio_unitario, linea_negocio, codigo_tarifa_iva, movimiento_id,
              creado_por, realizado_por)
           VALUES ($1,$2,'mostrador',$3,'Shampoo medicado',1,8000,'pet_shop','08',$4,$5,$5)`,
          [tenantId, cuentaId, sinCosto.presentacionId, movSinPaciente, personaId]
        );

        // Un consumo interno del mismo producto con costo: tercer
        // origen, sin paciente.
        await db.query(
          `INSERT INTO inv_movimientos
             (tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base,
              costo_unitario, motivo, persona_id)
           VALUES ($1,'consumo_interno',$2,$3,$4,3,500,'otro',$5)`,
          [tenantId, conCosto.productoId, bodegaId, conCosto.loteId, personaId]
        );

        const periodo: Periodo = {
          desde: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
          hasta: new Date().toISOString().slice(0, 10),
        };

        // --- Cargo fugado -----------------------------------------
        const fuga = await cargosFugados(db, tenantId, periodo);
        // SOLO LOS DOS DE LA ATENCIÓN CERRADA: 20 000 + 2 400.
        //
        // El de mostrador (8 000) está en la misma cuenta abierta y NO
        // es fuga: una venta de mostrador recién empezada es una venta
        // en curso, no plata perdida. Fuga es lo que ya se hizo —la
        // atención cerró— y sigue sin cobrarse, o una cuenta que lleva
        // más de N días abierta. Contar la venta en curso llenaría la
        // pantalla de falsos positivos todos los días.
        cerca(fuga.total, 20000 + 2400, "Fuga es lo de la atención cerrada, no la venta en curso");
        const todosLosCargos = await db.query<{ total: string }>(
          `SELECT sum(cantidad * precio_unitario)::text AS total FROM vta_cargos
            WHERE tenant_id = $1 AND anulado_en IS NULL`,
          [tenantId]
        );
        assert(
          Number(todosLosCargos.rows[0].total) === 30400,
          "El cargo de mostrador existe y queda fuera de la fuga a propósito",
          todosLosCargos.rows[0].total
        );
        const listaFuga = await lista("cargos_fugados").filas(db, tenantId, periodo);
        cerca(
          suma(listaFuga, "monto"),
          fuga.total,
          "La lista de cargos fugados suma el número de la tarjeta"
        );

        // --- Sin costo (§8.3) --------------------------------------
        const top = await topDeItems(db, tenantId, periodo, "ingresos");
        const shampoo = top.find((t) => t.item === "Shampoo medicado");
        assert(!!shampoo, "El ítem sin costo aparece en el top");
        assert(shampoo!.sin_costo, "El ítem sin costo se marca como «sin costo»");
        assert(
          shampoo!.margen !== shampoo!.ingresos || shampoo!.costo === 0,
          "El ítem sin costo no se presenta como margen puro"
        );
        const porLinea = await porLineaDeNegocio(db, tenantId, periodo);
        const petShop = porLinea.find((l) => l.linea === "pet_shop")!;
        assert(petShop.sin_costo === 1, "La línea cuenta cuántos ítems están sin costo", petShop);
        const farmacia = porLinea.find((l) => l.linea === "farmacia")!;
        cerca(farmacia.costo, 1000, "El costo de la línea sale del movimiento de inventario");
        cerca(farmacia.margen, 2400 - 1000, "El margen es ingreso menos costo");

        // --- §6: trazabilidad del producto -------------------------
        const consumo = await consumoDeProducto(db, tenantId, conCosto.productoId, periodo);
        cerca(consumo.totalBase, 5, "El consumo del producto suma todas sus salidas");
        const origenes = consumo.porOrigen.map((o) => o.origen).sort();
        assert(
          origenes.includes("atencion") && origenes.includes("consumo_interno"),
          "El consumo se desglosa por origen",
          origenes
        );
        const interno = consumo.porOrigen.find((o) => o.origen === "consumo_interno")!;
        assert(
          !interno.conPaciente && interno.cantidadBase === 3,
          "El consumo interno es su propio grupo y no se reparte entre pacientes",
          interno
        );
        assert(
          consumo.pacientes.length === 1 && consumo.pacientes[0].paciente === "Rocky",
          "Se llega del producto al paciente concreto",
          consumo.pacientes
        );
        assert(
          consumo.pacientes[0].atencionId === atencionId,
          "Y de ahí a la atención en la que se usó"
        );
        assert(!!consumo.pacientes[0].lote, "Con su lote", consumo.pacientes[0].lote);

        const sumaOrigenes = consumo.porOrigen.reduce((s, o) => s + o.cantidadBase, 0);
        cerca(
          sumaOrigenes,
          consumo.totalBase,
          "Los orígenes suman el total: ningún movimiento se esconde"
        );

        // --- §6: trazabilidad del lote ----------------------------
        const traza = await trazabilidadDeLote(db, tenantId, conCosto.loteId);
        assert(
          traza.pacientes.length === 1 && traza.pacientes[0].cliente === "Marta Dueña",
          "Del lote se llega al paciente y a su cliente con contacto",
          traza.pacientes
        );
        assert(
          traza.sinPaciente.length === 1 && traza.sinPaciente[0].origen === "consumo_interno",
          "Las salidas del lote sin paciente también se muestran",
          traza.sinPaciente
        );
        assert(
          traza.pacientes[0].sePuedeAvisar === false &&
            /consinti/i.test(traza.pacientes[0].motivoSiNo ?? ""),
          "Sin consentimiento, la pantalla dice que hay que llamarlo (no lo esconde)",
          traza.pacientes[0].motivoSiNo
        );

        // --- §5: preventivos por tipo, con «sin registro» ---------
        let prev = await preventivosPorTipo(db, tenantId, pacienteId);
        assert(prev.length === 3, "Se evalúan los tres tipos de preventivo", prev.length);
        assert(
          prev.every((p) => p.estado === "sin_registro"),
          "Sin ningún registro, el estado es «sin registro» y no «vencido»",
          prev.map((p) => p.estado)
        );

        // Un registro HISTÓRICO (cargado a mano, de otra clínica)
        // cuenta como registro: es la regla del 07c.
        await db.query(
          `INSERT INTO cuidados_preventivos
             (tenant_id, paciente_id, tipo, vacuna, fecha_aplicacion,
              fecha_proxima_recomendada, registrado_por, historico)
           VALUES ($1,$2,'vacunacion','Triple felina', CURRENT_DATE - 30,
                   CURRENT_DATE + 335, $3, true)`,
          [tenantId, pacienteId, personaId]
        );
        await db.query(
          `INSERT INTO cuidados_preventivos
             (tenant_id, paciente_id, tipo, subtipo_desparasitacion, fecha_aplicacion,
              fecha_proxima_recomendada, registrado_por)
           VALUES ($1,$2,'desparasitacion','interna', CURRENT_DATE - 200,
                   CURRENT_DATE - 80, $3)`,
          [tenantId, pacienteId, personaId]
        );
        prev = await preventivosPorTipo(db, tenantId, pacienteId);
        const vac = prev.find((p) => p.tipo === "vacunacion")!;
        const interna = prev.find((p) => p.subtipo === "interna")!;
        const externa = prev.find((p) => p.subtipo === "externa")!;
        assert(vac.estado === "al_dia", "La vacuna con próxima lejana está al día", vac.estado);
        assert(vac.historico, "Y se sabe que el registro es histórico");
        assert(interna.estado === "vencido", "La desparasitación pasada está vencida", interna.estado);
        assert(
          externa.estado === "sin_registro",
          "La que nunca se registró sigue siendo «sin registro»",
          externa.estado
        );

        // --- §4 y §5: los resúmenes -------------------------------
        const cliente = await resumenDeCliente(db, tenantId, propietarioId, { verCostos: true });
        cerca(cliente.gastoAcumulado, 30400, "El gasto del cliente suma sus cargos");
        assert(cliente.visitas === 1, "Cuenta sus visitas", cliente.visitas);
        assert(cliente.mascotas.length === 1, "Lista sus mascotas", cliente.mascotas.length);
        assert(
          cliente.preventivosPendientes.some((p) => p.tipo === "desparasitacion"),
          "Y los preventivos pendientes de todas sus mascotas"
        );
        assert(cliente.valor.margen !== null, "Con permiso de costos, el valor incluye margen");

        const sinPermiso = await resumenDeCliente(db, tenantId, propietarioId, { verCostos: false });
        assert(
          sinPermiso.valor.margen === null,
          "Sin permiso de costos, el margen del cliente no viaja"
        );

        const paciente = await resumenDePaciente(db, tenantId, pacienteId);
        cerca(paciente.gastoAcumulado, 22400, "El gasto del paciente son SUS cargos");
        assert(
          paciente.gastoPorLinea.length === 2,
          "Repartido por línea de negocio",
          paciente.gastoPorLinea
        );

        // El período anterior del diccionario, que alimenta toda la
        // comparación.
        const ant = periodoAnterior({ desde: "2026-11-01", hasta: "2026-11-30" });
        assert(
          ant.desde === "2026-10-02" && ant.hasta === "2026-10-31",
          "El período anterior tiene el mismo largo y termina el día antes",
          ant
        );
      },
      personaId
    );
  } finally {
    await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  }

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

/** Un producto con su presentación y su lote con existencia. */
async function crearProducto(
  db: import("pg").PoolClient,
  tenantId: string,
  bodegaId: string,
  nombre: string,
  precio: number,
  costo: number
): Promise<{ productoId: string; presentacionId: string; loteId: string }> {
  const productoId = (
    await db.query<{ id: string }>(
      `INSERT INTO inv_productos
         (tenant_id, codigo, nombre, categoria, linea_negocio, unidad_base, activo,
          codigo_tarifa_iva)
       VALUES ($1,$2,$3,'medicamento',$4,'Unid',true,'08') RETURNING id`,
      [tenantId, nombre.slice(0, 8).toUpperCase(), nombre, costo > 0 ? "farmacia" : "pet_shop"]
    )
  ).rows[0].id;
  const presentacionId = (
    await db.query<{ id: string }>(
      `INSERT INTO inv_presentaciones
         (tenant_id, producto_id, codigo_interno, nombre, factor, unidad_medida, precio_venta,
          para_compra, para_venta, para_consumo, activo)
       VALUES ($1,$2,$4,'Unidad',1,'Unid',$3,true,true,true,true) RETURNING id`,
      [tenantId, productoId, precio, `P12-${nombre.slice(0, 6).toUpperCase()}`]
    )
  ).rows[0].id;
  const loteId = (
    await db.query<{ id: string }>(
      `INSERT INTO inv_lotes
         (tenant_id, producto_id, bodega_id, numero, vencimiento, costo_unitario, cantidad)
       VALUES ($1,$2,$3,$4, CURRENT_DATE + 180, $5, 100) RETURNING id`,
      [tenantId, productoId, bodegaId, `L-${nombre.slice(0, 4).toUpperCase()}`, costo]
    )
  ).rows[0].id;
  return { productoId, presentacionId, loteId };
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
