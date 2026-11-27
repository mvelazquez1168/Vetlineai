// Verificación del prompt 10a (finanzas, parte operativa).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_finanzas_10a.ts
//
// SIN --transpile-only a propósito: la lección del 06/08 es que
// `--transpile-only` tapó cuatro defectos reales.
//
// Es re-corrible: borra su clínica de prueba al empezar.
//
// Los escenarios son los que pide el prompt:
//
//   * un comprobante de proveedor a 30 días nace con su cuenta y su
//     vencimiento correcto;
//   * otro aceptado parcialmente: lo exigible es menos que el total;
//   * dos cuentas del mismo proveedor pagadas con una transferencia;
//   * una pagada en efectivo desde la caja abierta, y el arqueo la ve;
//   * una cuenta en dólares pagada con su tipo de cambio;
//   * anular un pago devuelve el saldo;
//   * un recibo de electricidad clasificado como gasto desde la bandeja,
//     y la sugerencia de categoría en el siguiente del mismo proveedor;
//   * el alquiler recurrente conciliado con su comprobante;
//   * un recordatorio de saldo a un deudor que NO es el dueño del
//     paciente;
//   * el cierre del día con dos SINPE y un depósito;
//   * la exportación del mes.
//
// Y las invariantes de dinero, que son lo que no puede fallar: no se
// puede pagar por encima del saldo, ni dejar una cuenta negativa.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import {
  conciliarComprobanteConCuenta,
  crearCuentaPorPagar,
  cuentaDesdeComprobanteRecibido,
  cuentasPorPagar,
  detalleDeCuenta,
  resumenPorPagar,
} from "../finanzas/cuentasPagar";
import { anularPago, guardarCuentaBanco, registrarPago } from "../finanzas/pagos";
import {
  categoriaSugerida,
  categoriasDeGasto,
  conciliarRecurrente,
  gastoDesdeComprobante,
  gastos,
  generarPendientes,
  guardarRecurrente,
  registrarGasto,
  resumenDeGastos,
} from "../finanzas/gastos";
import { deudores, porQueNoSePuedeRecordar, recordarSaldo, resumenPorCobrar } from "../finanzas/cobranza";
import {
  cerrarDia,
  cierreDelDia,
  conciliarSinpe,
  registrarDeposito,
} from "../finanzas/cierreDiario";
import { CUADERNOS, tablaContable } from "../finanzas/exportacionContable";
import { aExcel } from "../exportacion/tabla";
import { guardarPolitica } from "../clinica/politicas";
import { registrarConsentimiento } from "../crm/consentimientos";

const PREFIJO = "probe-10a";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}
function cerca(obtenido: number, esperado: number, msg: string) {
  assert(Math.abs(obtenido - esperado) < 0.02, msg, { obtenido, esperado });
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_finanzas_10a");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@10a.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  const persona = await pool.query<{ id: string }>(
    `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, estado)
     VALUES ($1,'Ana Administradora',$2,'x',false,true,'activo') RETURNING id`,
    [tenantId, `${PREFIJO}-ana@probe.test`]
  );
  const personaId = persona.rows[0].id;

  // El emisor de facturación, que la bandeja de recibidos necesita.
  const emisor = await pool.query<{ id: string }>(
    `INSERT INTO fact_emisores
       (tenant_id, nombre, tipo_identificacion, numero_identificacion,
        ubicacion_provincia, ubicacion_canton, ubicacion_distrito, ubicacion_otras_senas,
        telefono_codigo_pais, telefono_numero, correo, proveedor_sistemas, ambiente_activo,
        codigo_actividad_economica)
     VALUES ($1,'Clínica 10a','02','3101234567','1','01','01','Frente al parque',
             '506','22223333','fact@10a.test','Vetline Ai','pruebas','862001')
     RETURNING id`,
    [tenantId]
  );

  const proveedorA = await pool.query<{ id: string }>(
    `INSERT INTO inv_proveedores
       (tenant_id, nombre, tipo_identificacion, numero_identificacion, dias_credito)
     VALUES ($1,'Distribuidora Veterinaria','02','3101111111',30) RETURNING id`,
    [tenantId]
  );
  const proveedorLuz = await pool.query<{ id: string }>(
    `INSERT INTO inv_proveedores (tenant_id, nombre, numero_identificacion, dias_credito)
     VALUES ($1,'Compañía de Electricidad','4000042139',0) RETURNING id`,
    [tenantId]
  );

  const recibido = async (consecutivo: string, total: number, moneda = "CRC", emisorNombre?: string, identificacion?: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO fact_recibidos
           (tenant_id, emisor_id, clave, xml_recibido, emisor_nombre, emisor_identificacion,
            tipo_comprobante, consecutivo, fecha_emision, total_comprobante, total_impuesto,
            moneda, validacion_ok, receptor_es_la_clinica)
         VALUES ($1,$2,$3,'<xml/>',$4,$5,'01',$6, CURRENT_DATE, $7, 0, $8, true, true)
         RETURNING id`,
        [
          tenantId,
          emisor.rows[0].id,
          // La clave de Hacienda son 50 alfanuméricos exactos (CHECK real).
          `506011226260031011111110010000100010000000001${consecutivo}`.padEnd(50, '0').slice(0, 50),
          emisorNombre ?? "Distribuidora Veterinaria",
          identificacion ?? "3101111111",
          consecutivo,
          total,
          moneda,
        ]
      )
    ).rows[0].id;

  const recibidoA = await recibido("0001", 100000);
  const recibidoB = await recibido("0002", 60000);
  const recibidoUsd = await recibido("0003", 500, "USD");
  const recibidoLuz = await recibido("0004", 85000, "CRC", "Compañía de Electricidad", "4000042139");
  const recibidoLuz2 = await recibido("0005", 91000, "CRC", "Compañía de Electricidad", "4000042139");
  const recibidoAlquiler = await recibido("0006", 420000, "CRC", "Inmobiliaria del Este", "3101999999");

  // El tipo de cambio que ya usa el sistema (08).
  await pool.query(
    `INSERT INTO vta_tipos_cambio (tenant_id, fecha, moneda, valor, fuente)
     VALUES ($1, CURRENT_DATE, 'USD', 520.50, 'manual')
     ON CONFLICT DO NOTHING`,
    [tenantId]
  );

  // -------------------------------------------------------------------
  console.log("\n=== Las cuentas por pagar nacen del comprobante ===");
  // -------------------------------------------------------------------
  let cuentaA = "";
  let cuentaB = "";
  let cuentaUsd = "";
  await conAlcanceTenant(tenantId, async (db) => {
    const a = await cuentaDesdeComprobanteRecibido(db, tenantId, {
      recibidoId: recibidoA,
      proveedorId: proveedorA.rows[0].id,
      personaId,
    });
    cuentaA = a.id;
    assert(!a.yaExistia, "la cuenta nace del comprobante aceptado");

    const detalle = await detalleDeCuenta(db, tenantId, cuentaA);
    igual(detalle.cuenta.monto, "100000.00", "con el monto del comprobante, sin retipear nada");
    igual(detalle.cuenta.documento, "0001", "y con su número de documento");
    const dias = await db.query<{ d: number }>(
      `SELECT (vencimiento - fecha)::int AS d FROM fin_cuentas_pagar WHERE id = $1`,
      [cuentaA]
    );
    igual(dias.rows[0].d, 30, "el vencimiento sale de los 30 días de crédito del proveedor");
    igual(detalle.cuenta.estado, "pendiente", "y nace pendiente");
    assert(detalle.comprobante !== null, "desde la cuenta se llega a su comprobante");

    // NO SE REGISTRA DOS VECES.
    const otraVez = await cuentaDesdeComprobanteRecibido(db, tenantId, {
      recibidoId: recibidoA,
      proveedorId: proveedorA.rows[0].id,
      personaId,
    });
    assert(otraVez.yaExistia, "el mismo comprobante no genera una segunda cuenta");
    igual(otraVez.id, cuentaA, "devuelve la que ya existía");

    // ACEPTACIÓN PARCIAL: lo exigible es menos que el total.
    const b = await cuentaDesdeComprobanteRecibido(db, tenantId, {
      recibidoId: recibidoB,
      proveedorId: proveedorA.rows[0].id,
      montoAceptado: 45000,
      personaId,
    });
    cuentaB = b.id;
    const dB = await detalleDeCuenta(db, tenantId, cuentaB);
    igual(dB.cuenta.monto, "60000.00", "el documento sigue diciendo 60 000");
    igual(dB.cuenta.exigible, "45000.00", "y lo exigible es lo aceptado: 45 000");
    igual(dB.cuenta.saldo, "45000.00", "el saldo arranca en lo exigible, no en el total");

    const usd = await cuentaDesdeComprobanteRecibido(db, tenantId, {
      recibidoId: recibidoUsd,
      proveedorId: proveedorA.rows[0].id,
      personaId,
    });
    cuentaUsd = usd.id;
    const dUsd = await detalleDeCuenta(db, tenantId, cuentaUsd);
    igual(dUsd.cuenta.moneda, "USD", "la cuenta en dólares conserva su moneda");

    // Lo exigible nunca puede pasar el monto del documento.
    let exagerado = "";
    try {
      await crearCuentaPorPagar(db, tenantId, {
        proveedorId: proveedorA.rows[0].id,
        fecha: "2026-11-01",
        monto: 1000,
        exigible: 2000,
        personaId,
      });
    } catch (err) {
      exagerado = err instanceof Error ? err.message : "";
    }
    assert(
      exagerado.includes("no puede ser mayor"),
      "no se puede reconocer más de lo que dice la factura",
      exagerado
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== Los indicadores y la antigüedad ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // Una cuenta vencida, para que la antigüedad tenga algo que mostrar.
    await crearCuentaPorPagar(db, tenantId, {
      proveedorId: proveedorA.rows[0].id,
      documento: "VIEJA-1",
      fecha: "2026-09-01",
      vencimiento: "2026-09-15",
      monto: 30000,
      personaId,
    });

    const r = await resumenPorPagar(db, tenantId);
    // 100 000 + 45 000 + 30 000 en colones, más 500 dólares a 520,50.
    cerca(r.total, 100000 + 45000 + 30000 + 500 * 520.5, "el total por pagar suma las cuatro cuentas");
    cerca(r.vencido, 30000, "y el vencido es solo la que ya venció");
    const masDe60 = r.antiguedad.find((t) => t.tramo === "mas_60")?.monto ?? 0;
    cerca(masDe60, 30000, "la de septiembre cae en el tramo de más de 60 días");
    assert(r.calendario.length > 0, "el calendario de pagos tiene semanas");
  });

  // -------------------------------------------------------------------
  console.log("\n=== Un pago cubre dos cuentas del mismo proveedor ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const banco = await guardarCuentaBanco(db, tenantId, {
      nombre: "Cuenta corriente",
      banco: "BAC",
      terminacion: "4321",
    });

    const pago = await registrarPago(db, tenantId, {
      proveedorId: proveedorA.rows[0].id,
      fecha: "2026-11-27",
      medio: "transferencia",
      cuentaBancoId: banco.id,
      referencia: "TRF-9001",
      aplicaciones: [
        { cuentaId: cuentaA, monto: 100000 },
        { cuentaId: cuentaB, monto: 20000 },
      ],
      personaId,
    });
    cerca(pago.total, 120000, "un solo pago por las dos facturas");

    const dA = await detalleDeCuenta(db, tenantId, cuentaA);
    igual(dA.cuenta.saldo, "0.00", "la primera queda en cero");
    igual(dA.cuenta.estado, "pagada", "y su estado pasa a pagada sin que nadie lo escriba");
    const dB = await detalleDeCuenta(db, tenantId, cuentaB);
    igual(dB.cuenta.saldo, "25000.00", "la segunda queda con su saldo parcial");
    igual(dB.cuenta.estado, "parcial", "y su estado lo dice");

    // LA INVARIANTE: no se puede pagar por encima del saldo.
    await db.query("SAVEPOINT antes_de_pasarse");
    let seExcedio = "";
    try {
      await registrarPago(db, tenantId, {
        proveedorId: proveedorA.rows[0].id,
        fecha: "2026-11-27",
        medio: "transferencia",
        aplicaciones: [{ cuentaId: cuentaB, monto: 999999 }],
        personaId,
      });
    } catch (err) {
      seExcedio = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT antes_de_pasarse");
    assert(
      seExcedio.includes("excede el saldo"),
      "pagar por encima del saldo lo rechaza la BASE, no el código",
      seExcedio
    );

    // Y un pago no puede cruzar dos proveedores.
    await db.query("SAVEPOINT antes_de_cruzar");
    let cruzado = "";
    try {
      const cuentaLuz = await crearCuentaPorPagar(db, tenantId, {
        proveedorId: proveedorLuz.rows[0].id,
        fecha: "2026-11-27",
        monto: 5000,
        personaId,
      });
      await registrarPago(db, tenantId, {
        proveedorId: proveedorA.rows[0].id,
        fecha: "2026-11-27",
        medio: "transferencia",
        aplicaciones: [{ cuentaId: cuentaLuz.id, monto: 5000 }],
        personaId,
      });
    } catch (err) {
      cruzado = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT antes_de_cruzar");
    assert(
      cruzado.includes("mismo proveedor"),
      "un pago no puede cruzar dos proveedores",
      cruzado
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== El efectivo sale de la caja, y el arqueo lo ve ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // La caja necesita su bodega: una venta de mostrador descuenta
    // existencias de algún lugar (modelo del 06/08).
    const bodega = await db.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,'PRINCIPAL','Bodega principal',true) RETURNING id`,
      [tenantId]
    );
    const caja = await db.query<{ id: string }>(
      `INSERT INTO vta_cajas (tenant_id, nombre, bodega_id) VALUES ($1,'Caja 1',$2) RETURNING id`,
      [tenantId, bodega.rows[0].id]
    );
    const sesion = await db.query<{ id: string }>(
      `INSERT INTO vta_sesiones_caja (tenant_id, caja_id, estado, abierta_por, fondo_crc)
       VALUES ($1,$2,'abierta',$3,50000) RETURNING id`,
      [tenantId, caja.rows[0].id, personaId]
    );

    const cuentaEfectivo = await crearCuentaPorPagar(db, tenantId, {
      proveedorId: proveedorLuz.rows[0].id,
      documento: "EFEC-1",
      fecha: "2026-11-27",
      monto: 12000,
      personaId,
    });

    // Sin caja abierta no se puede.
    await db.query("SAVEPOINT sin_caja");
    let sinCaja = "";
    try {
      await registrarPago(db, tenantId, {
        proveedorId: proveedorLuz.rows[0].id,
        fecha: "2026-11-27",
        medio: "efectivo",
        aplicaciones: [{ cuentaId: cuentaEfectivo.id, monto: 12000 }],
        personaId,
      });
    } catch (err) {
      sinCaja = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT sin_caja");
    assert(sinCaja.includes("caja abierta"), "pagar en efectivo sin caja abierta se rechaza", sinCaja);

    const pago = await registrarPago(db, tenantId, {
      proveedorId: proveedorLuz.rows[0].id,
      fecha: "2026-11-27",
      medio: "efectivo",
      sesionCajaId: sesion.rows[0].id,
      referencia: "recibo 55",
      aplicaciones: [{ cuentaId: cuentaEfectivo.id, monto: 12000 }],
      personaId,
    });
    assert(pago.movimientoEfectivoId !== null, "el pago en efectivo generó su movimiento de caja");

    const mov = await db.query<{ tipo: string; monto: string; sesion_id: string }>(
      `SELECT tipo, monto::text, sesion_id FROM vta_movimientos_efectivo WHERE id = $1`,
      [pago.movimientoEfectivoId]
    );
    igual(mov.rows[0].tipo, "pago_proveedor", "con su tipo propio, distinguible del gasto de caja chica");
    igual(mov.rows[0].monto, "12000.00", "y por el monto del pago");
    igual(mov.rows[0].sesion_id, sesion.rows[0].id, "en la sesión de caja que estaba abierta");

    // ANULAR: la cuenta recupera el saldo y, con la caja abierta, el
    // efectivo vuelve.
    const anulacion = await anularPago(db, tenantId, {
      pagoId: pago.id,
      motivo: "Se pagó dos veces por error",
      personaId,
    });
    const d = await detalleDeCuenta(db, tenantId, cuentaEfectivo.id);
    igual(d.cuenta.saldo, "12000.00", "anular el pago devuelve el saldo: no hay nada que ajustar a mano");
    assert(anulacion.contramovimiento !== null, "y el efectivo se reingresa a la caja abierta");

    let sinMotivo = "";
    try {
      await anularPago(db, tenantId, { pagoId: pago.id, motivo: "  ", personaId });
    } catch (err) {
      sinMotivo = err instanceof Error ? err.message : "";
    }
    assert(sinMotivo.includes("motivo"), "anular sin motivo se rechaza", sinMotivo);
  });

  // -------------------------------------------------------------------
  console.log("\n=== Una cuenta en dólares, con su tipo de cambio ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const pago = await registrarPago(db, tenantId, {
      proveedorId: proveedorA.rows[0].id,
      fecha: "2026-11-27",
      medio: "transferencia",
      moneda: "USD",
      aplicaciones: [{ cuentaId: cuentaUsd, monto: 500 }],
      personaId,
    });
    const tc = await db.query<{ tipo_cambio: string; moneda: string }>(
      `SELECT tipo_cambio::text, moneda FROM fin_pagos WHERE id = $1`,
      [pago.id]
    );
    igual(tc.rows[0].moneda, "USD", "el pago queda en dólares");
    cerca(
      Number(tc.rows[0].tipo_cambio),
      520.5,
      "con el tipo de cambio del día, el que ya usa el sistema"
    );
    const d = await detalleDeCuenta(db, tenantId, cuentaUsd);
    igual(d.cuenta.saldo, "0.00", "y la cuenta en dólares queda pagada en dólares");
  });

  // -------------------------------------------------------------------
  console.log("\n=== La nota de crédito del proveedor reduce la cuenta ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const cuenta = await crearCuentaPorPagar(db, tenantId, {
      proveedorId: proveedorA.rows[0].id,
      documento: "FAC-NC",
      fecha: "2026-11-20",
      monto: 50000,
      personaId,
    });
    await crearCuentaPorPagar(db, tenantId, {
      proveedorId: proveedorA.rows[0].id,
      documento: "NC-1",
      fecha: "2026-11-25",
      monto: 10000,
      reduceACuentaId: cuenta.id,
      personaId,
    });
    const d = await detalleDeCuenta(db, tenantId, cuenta.id);
    igual(d.cuenta.saldo, "40000.00", "la nota de crédito baja el saldo de la factura");
    igual(d.notas.length, 1, "y se ve dentro de la cuenta que reduce");

    const lista = await cuentasPorPagar(db, tenantId);
    assert(
      !lista.some((c) => c.documento === "NC-1"),
      "la nota de crédito NO aparece como una cuenta a pagar: no se le debe a nadie"
    );

    await db.query("SAVEPOINT nc_grande");
    let excede = "";
    try {
      await crearCuentaPorPagar(db, tenantId, {
        proveedorId: proveedorA.rows[0].id,
        documento: "NC-2",
        fecha: "2026-11-26",
        monto: 999999,
        reduceACuentaId: cuenta.id,
        personaId,
      });
    } catch (err) {
      excede = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT nc_grande");
    assert(
      excede.includes("a favor"),
      "una nota de crédito que deja la cuenta en negativo se rechaza",
      excede
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== El gasto que sale de la bandeja, sin retipear nada ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const cats = await categoriasDeGasto(db, tenantId);
    igual(cats.length, 13, "la clínica nace con las trece categorías");
    const electricidad = cats.find((c) => c.codigo === "electricidad")!.id as string;

    const g = await gastoDesdeComprobante(db, tenantId, {
      recibidoId: recibidoLuz,
      categoriaId: electricidad,
      proveedorId: proveedorLuz.rows[0].id,
      generaCuentaPorPagar: true,
      personaId,
    });
    assert(!g.yaExistia, "el recibo de electricidad se clasifica como gasto desde la bandeja");
    assert(g.cuentaPagarId !== null, "y genera su cuenta por pagar porque no vino pagado");

    const lista = await gastos(db, tenantId, {});
    const gasto = lista.find((x) => x.id === g.id)!;
    igual(gasto.monto, "85000.00", "con el monto del comprobante: nadie lo volvió a escribir");
    igual(gasto.sin_comprobante, false, "y con soporte fiscal");

    // LA SUGERENCIA PARA EL SIGUIENTE DEL MISMO PROVEEDOR.
    const sug = await categoriaSugerida(db, tenantId, proveedorLuz.rows[0].id);
    igual(sug?.categoria_id, electricidad, "el siguiente recibo de ese proveedor sugiere electricidad");
    igual(sug?.nombre, "Electricidad", "con su nombre, para mostrarlo");

    const g2 = await gastoDesdeComprobante(db, tenantId, {
      recibidoId: recibidoLuz2,
      categoriaId: sug!.categoria_id,
      proveedorId: proveedorLuz.rows[0].id,
      personaId,
    });
    assert(!g2.yaExistia, "el segundo recibo entra con la categoría sugerida");

    // Un comprobante dos veces, no.
    const otraVez = await gastoDesdeComprobante(db, tenantId, {
      recibidoId: recibidoLuz,
      categoriaId: electricidad,
      personaId,
    });
    assert(otraVez.yaExistia, "el mismo comprobante no se registra dos veces como gasto");

    // UNA COMPRA NO ES UN GASTO.
    await db.query(`UPDATE fact_recibidos SET registrado_en_inventario = now() WHERE id = $1`, [
      recibidoB,
    ]);
    await db.query("SAVEPOINT compra_como_gasto");
    let compra = "";
    try {
      await gastoDesdeComprobante(db, tenantId, {
        recibidoId: recibidoB,
        categoriaId: electricidad,
        personaId,
      });
    } catch (err) {
      compra = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT compra_como_gasto");
    assert(
      compra.includes("no es un gasto"),
      "un comprobante que ya entró al inventario no se puede contar como gasto",
      compra
    );

    // EL GASTO SIN COMPROBANTE: la planilla.
    const planilla = cats.find((c) => c.codigo === "planilla")!.id as string;
    const gp = await registrarGasto(db, tenantId, {
      fecha: "2026-11-27",
      categoriaId: planilla,
      descripcion: "Planilla de noviembre",
      monto: 1800000,
      sinComprobante: true,
      personaId,
    });
    const todos = await gastos(db, tenantId, {});
    igual(
      todos.find((x) => x.id === gp.id)?.sin_comprobante,
      true,
      "la planilla queda marcada sin comprobante, para el contador"
    );

    const resumen = await resumenDeGastos(db, tenantId, "2026-11-27");
    cerca(resumen.sinComprobante, 1800000, "el resumen del mes dice cuánto no tiene soporte fiscal");
    assert(resumen.porCategoria.length >= 2, "y agrupa por categoría", resumen.porCategoria.length);
  });

  // -------------------------------------------------------------------
  console.log("\n=== El alquiler recurrente se concilia, no se duplica ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const cats = await categoriasDeGasto(db, tenantId);
    const alquiler = cats.find((c) => c.codigo === "alquiler")!.id as string;

    const rec = await guardarRecurrente(db, tenantId, {
      categoriaId: alquiler,
      descripcion: "Alquiler del local",
      montoEstimado: 400000,
      diaDelMes: 1,
    });

    const g1 = await generarPendientes(db, tenantId, "2026-11-10", personaId);
    igual(g1.generados, 1, "se genera el estimado del mes");
    const g2 = await generarPendientes(db, tenantId, "2026-11-10", personaId);
    igual(g2.generados, 0, "y correrlo otra vez no lo duplica");

    const estimados = await gastos(db, tenantId, { estado: "estimado" });
    igual(estimados.length, 1, "hay un solo gasto estimado");
    const estimado = estimados[0];
    igual(estimado.monto, "400000.00", "con el monto estimado");

    const conc = await conciliarRecurrente(db, tenantId, {
      gastoEstimadoId: estimado.id as string,
      recibidoId: recibidoAlquiler,
      monto: 420000,
      personaId,
    });
    assert(conc.cambioElMonto, "el comprobante real vino por otro monto y se ajusta");
    cerca(conc.montoFinal, 420000, "el gasto queda por lo que de verdad se pagó");

    const despues = await gastos(db, tenantId, {});
    const delAlquiler = despues.filter((x) => x.recurrente_id === rec.id);
    igual(delAlquiler.length, 1, "y sigue habiendo UN solo gasto de alquiler, no dos");
    igual(delAlquiler[0].estado, "real", "ahora real");

    let yaReal = "";
    try {
      await conciliarRecurrente(db, tenantId, {
        gastoEstimadoId: estimado.id as string,
        personaId,
      });
    } catch (err) {
      yaReal = err instanceof Error ? err.message : "";
    }
    assert(yaReal.includes("ya es real"), "conciliar dos veces se rechaza", yaReal);
  });

  // -------------------------------------------------------------------
  console.log("\n=== Lo que deben los clientes, y el recordatorio ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // EL DEUDOR NO ES EL DUEÑO DEL PACIENTE: la empresa que paga por el
    // perro de su empleado. Es la regla del 08 y del anexo 07-03.
    const dueno = await db.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, telefono)
       VALUES ($1,'Dueña del perro','88881111') RETURNING id`,
      [tenantId]
    );
    const empresa = await db.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, email, telefono)
       VALUES ($1,'Empresa Pagadora S.A.',$2,'88882222') RETURNING id`,
      [tenantId, `${PREFIJO}-empresa@probe.test`]
    );
    const paciente = await db.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
       VALUES ($1,$2,'Rocky','perro', 910001) RETURNING id`,
      [tenantId, dueno.rows[0].id]
    );

    // Una factura a crédito a nombre de la EMPRESA, no de la dueña.
    await db.query(
      `INSERT INTO fact_comprobantes
         (tenant_id, emisor_id, tipo_comprobante, sucursal, terminal, clave, consecutivo,
          fecha_emision, receptor_nombre, receptor_propietario_id, condicion_venta,
          plazo_credito_dias, moneda, total_comprobante, total_impuesto, estado)
       VALUES ($1,$2,'01','001','00001',$3,'00100001010000000001', CURRENT_DATE - 45,
               'Empresa Pagadora S.A.', $4, '02', 30, 'CRC', 250000, 0, 'aceptado')`,
      [tenantId, emisor.rows[0].id, `50601122626003102345671001000019999000000000212345`.padEnd(50, '0').slice(0, 50), empresa.rows[0].id]
    );

    const lista = await deudores(db, tenantId);
    igual(lista.length, 1, "hay un deudor");
    igual(lista[0].nombre, "Empresa Pagadora S.A.", "y es el RECEPTOR de la factura, no la dueña del perro");
    cerca(Number(lista[0].saldo), 250000, "con su saldo");
    assert(lista[0].dias_mas_vencida > 0, "y los días de vencida", lista[0].dias_mas_vencida);

    const r = await resumenPorCobrar(db, tenantId);
    cerca(r.total, 250000, "el total por cobrar sale de las facturas del 08");
    cerca(r.vencido, 250000, "y está vencido");
    igual(r.clientes, 1, "un cliente con saldo");

    // El consentimiento, para que el recordatorio pueda salir.
    await registrarConsentimiento(db, tenantId, {
      propietarioId: empresa.rows[0].id,
      canal: "correo",
      finalidad: "salud",
      otorgado: true,
      fuente: "recepcion",
      personaId,
    });

    igual(
      await porQueNoSePuedeRecordar(db, tenantId, empresa.rows[0].id),
      null,
      "al principio se le puede recordar"
    );

    const envio = await recordarSaldo(db, tenantId, {
      propietarioId: empresa.rows[0].id,
      mensaje: "Cuando quieras pasá y lo arreglamos.",
      personaId,
    });
    assert(envio.enviado, "el recordatorio sale", envio.motivo ?? "");

    const anotado = await db.query<{ saldo: string; canal: string }>(
      `SELECT saldo::text, canal FROM fin_recordatorios_saldo WHERE propietario_id = $1`,
      [empresa.rows[0].id]
    );
    igual(anotado.rows[0]?.saldo, "250000.00", "y queda anotado cuánto debía cuando se le recordó");

    const enLaLinea = await db.query<{ tipo: string }>(
      `SELECT tipo FROM crm_interacciones
        WHERE propietario_id = $1 AND tipo = 'recordatorio_saldo'`,
      [empresa.rows[0].id]
    );
    igual(enLaLinea.rows.length, 1, "y en la línea de tiempo del CRM, con su propio tipo de evento");

    // LA POLÍTICA: no se le puede recordar todos los días.
    const bloqueo = await porQueNoSePuedeRecordar(db, tenantId, empresa.rows[0].id);
    assert(
      (bloqueo ?? "").includes("Ya se le recordó"),
      "y no se le puede volver a recordar al día siguiente",
      bloqueo
    );

    // Con la política en 1 día, el mismo día sigue bloqueado —hace menos
    // de un día— y pasados dos días deja de estarlo. Se mueve la fecha
    // del recordatorio en vez de esperar: es la única forma de probar una
    // regla de días sin esperar días.
    await guardarPolitica(db, tenantId, {
      clave: "cobranza.dias_entre_recordatorios",
      valor: "1",
      rol: null,
      personaId,
    });
    assert(
      (await porQueNoSePuedeRecordar(db, tenantId, empresa.rows[0].id)) !== null,
      "con la política en un día, el MISMO día sigue bloqueado"
    );
    await db.query(
      `UPDATE fin_recordatorios_saldo SET enviado_en = now() - interval '2 days'
        WHERE propietario_id = $1`,
      [empresa.rows[0].id]
    );
    igual(
      await porQueNoSePuedeRecordar(db, tenantId, empresa.rows[0].id),
      null,
      "y dos días después ya se le puede recordar otra vez"
    );

    // A quien no debe, no se le recuerda.
    const sinSaldo = await recordarSaldo(db, tenantId, {
      propietarioId: dueno.rows[0].id,
      personaId,
    });
    assert(
      !sinSaldo.enviado && (sinSaldo.motivo ?? "").includes("no tiene saldo"),
      "a la dueña del perro, que no debe nada, no se le manda nada",
      sinSaldo.motivo
    );
    void paciente;
  });

  // -------------------------------------------------------------------
  console.log("\n=== El cierre del día ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const hoy = (await db.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`)).rows[0].d;
    const caja = await db.query<{ id: string }>(
      `SELECT id FROM vta_cajas WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    const sesion = await db.query<{ id: string }>(
      `SELECT id FROM vta_sesiones_caja WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    const cuenta = await db.query<{ id: string }>(
      `INSERT INTO vta_cuentas (tenant_id, numero, cliente_nombre, estado, sesion_id)
       VALUES ($1, 9001, 'Cliente del día', 'abierta', $2) RETURNING id`,
      [tenantId, sesion.rows[0].id]
    );
    // El cargo que justifica el cobro: el trigger del 08 no deja cobrar
    // más de lo que la cuenta suma, y tiene razón.
    await db.query(
      `INSERT INTO vta_cargos
         (tenant_id, cuenta_id, origen, descripcion, cantidad, precio_unitario, linea_negocio)
       VALUES ($1,$2,'mostrador','Consulta del día',1,70000,'consulta')`,
      [tenantId, cuenta.rows[0].id]
    );
    const cobro = await db.query<{ id: string }>(
      `INSERT INTO vta_cobros (tenant_id, cuenta_id, sesion_id, cobrado_por, total, estado)
       VALUES ($1,$2,$3,$4,70000,'aplicado') RETURNING id`,
      [tenantId, cuenta.rows[0].id, sesion.rows[0].id, personaId]
    );
    const medio = async (m: string, monto: number, referencia?: string) =>
      (
        await db.query<{ id: string }>(
          `INSERT INTO vta_cobro_medios
             (tenant_id, cobro_id, medio, es_fiscal, moneda, monto, tipo_cambio, monto_crc, referencia)
           VALUES ($1,$2,$3,true,'CRC',$4,1,$4,$5) RETURNING id`,
          [tenantId, cobro.rows[0].id, m, monto, referencia ?? null]
        )
      ).rows[0].id;

    const sinpe1 = await medio("sinpe", 20000, "8888-1111");
    const sinpe2 = await medio("sinpe", 15000, "8888-2222");
    await medio("efectivo", 25000);
    await medio("tarjeta", 10000);

    const antes = await cierreDelDia(db, tenantId, hoy);
    cerca(antes.totalVentas, 70000, "el día ve las ventas de todas las sesiones");
    igual(antes.sinpe.length, 2, "con los dos cobros por SINPE, uno por uno");
    igual(antes.sinpe.filter((s) => s.conciliado).length, 0, "ninguno conciliado todavía");

    // Cerrar con diferencia exige justificación.
    let sinJustificar = "";
    try {
      await cerrarDia(db, tenantId, { fecha: hoy, personaId });
    } catch (err) {
      sinJustificar = err instanceof Error ? err.message : "";
    }
    assert(
      sinJustificar.includes("justificación"),
      "con SINPE sin conciliar, cerrar sin justificación se rechaza",
      sinJustificar
    );

    const banco = await db.query<{ id: string }>(
      `SELECT id FROM fin_cuentas_banco WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    await conciliarSinpe(db, tenantId, {
      cobroMedioId: sinpe1,
      cuentaBancoId: banco.rows[0].id,
      personaId,
    });
    await conciliarSinpe(db, tenantId, {
      cobroMedioId: sinpe2,
      cuentaBancoId: banco.rows[0].id,
      personaId,
    });

    let dosVeces = "";
    try {
      await conciliarSinpe(db, tenantId, { cobroMedioId: sinpe1, personaId });
    } catch (err) {
      dosVeces = err instanceof Error ? err.message : "";
    }
    assert(
      dosVeces.includes("ya estaba conciliado"),
      "el mismo SINPE no se concilia dos veces: dos personas marcando la misma lista lo contarían doble",
      dosVeces
    );

    // El efectivo del día, depositado.
    await registrarDeposito(db, tenantId, {
      fecha: hoy,
      monto: 25000,
      cuentaBancoId: banco.rows[0].id,
      referencia: "Depósito ventanilla",
      personaId,
    });

    const despues = await cierreDelDia(db, tenantId, hoy);
    igual(despues.sinpe.filter((s) => s.conciliado).length, 2, "los dos SINPE quedan marcados");
    assert(despues.sinpe[0].conciliado_por !== null, "con el nombre de quien los marcó");
    cerca(despues.depositado, 25000, "y el depósito del efectivo del día");
    cerca(despues.diferencia, 0, "ahora el día cuadra");
    assert(despues.datafono.length > 0, "el datáfono se compara contra lo cobrado con tarjeta");

    const cierre = await cerrarDia(db, tenantId, { fecha: hoy, personaId });
    cerca(cierre.diferencia, 0, "y el día se cierra sin diferencia");

    let otraVez = "";
    try {
      await cerrarDia(db, tenantId, { fecha: hoy, personaId });
    } catch (err) {
      otraVez = err instanceof Error ? err.message : "";
    }
    assert(otraVez.includes("ya está cerrado"), "un día no se cierra dos veces", otraVez);

    const guardado = await db.query<{ total_ventas: string; total_conciliado: string }>(
      `SELECT total_ventas::text, total_conciliado::text FROM fin_cierre_dia
        WHERE tenant_id = $1 AND fecha = $2::date`,
      [tenantId, hoy]
    );
    cerca(
      Number(guardado.rows[0].total_ventas),
      70000,
      "el cierre guardó los números que vio, congelados"
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== La exportación para el contador ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    for (const c of CUADERNOS) {
      const tabla = await tablaContable(db, tenantId, c.clave, "2026-01-01", "2026-12-31");
      assert(tabla.columnas.length > 0, `el cuaderno «${c.titulo}» tiene sus columnas fijas`);
      const xlsx = aExcel(tabla);
      assert(xlsx.length > 500, `y genera su Excel`, xlsx.length);
    }

    const gastosExp = await tablaContable(db, tenantId, "compras_gastos", "2026-01-01", "2026-12-31");
    assert(
      gastosExp.filas.some((f) => f.soporte === "Sin comprobante electrónico"),
      "la exportación distingue lo que no tiene soporte fiscal"
    );
    assert(
      (gastosExp.aviso ?? "").includes("soporte fiscal"),
      "y el aviso va DENTRO del archivo: el contador no vio la pantalla"
    );
    const pagosExp = await tablaContable(db, tenantId, "pagos", "2026-01-01", "2026-12-31");
    assert(pagosExp.filas.length >= 2, "los pagos del período salen con sus documentos", pagosExp.filas.length);
    assert(
      pagosExp.filas.some((f) => String(f.documentos ?? "").includes("0001")),
      "y se ve qué facturas pagó cada uno"
    );
  });

  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS"}`);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = ok ? 0 : 1;
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
});
