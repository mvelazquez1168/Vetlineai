// Siembra de datos de DEMOSTRACIÓN del módulo `ventas`.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/sembrar_demo_ventas.ts <tenantId>
//
// Deja la caja lista para mirar: una caja configurada, el tipo de
// cambio del día, una sesión abierta con su fondo, dos cobros (uno con
// pago mixto en dólares y vuelto), un cliente con crédito y una
// factura a crédito con su abono y su REP, un anticipo, un encargo,
// una solicitud de aprobación pendiente y un talonario de
// provisionales.
//
// TODO pasa por el dominio: `abrirSesion`, `agregarCargo`, `cobrar`,
// `registrarAbono`… No hay un INSERT suelto a `vta_cobros`, porque los
// datos de demostración tienen que ser los que el código produce.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { abrirSesion, registrarMovimientoEfectivo, registrarTipoCambio } from "../ventas/caja";
import { abrirCuenta, agregarCargo } from "../ventas/cuentas";
import { cobrar } from "../ventas/cobros";
import { deudorCliente, registrarAbono, registrarAnticipo } from "../ventas/credito";
import { solicitarAprobacion } from "../ventas/aprobaciones";
import { emitirTalonario } from "../ventas/contingencia";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

function paso(t: string) {
  console.log(`\n=== ${t} ===`);
}

async function main() {
  exigirEntornoDeDesarrollo("sembrar_demo_ventas");

  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: … sembrar_demo_ventas.ts <tenantId>");
    process.exit(1);
  }

  const t = await pool.query<{ nombre: string }>(`SELECT nombre FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  if (t.rows.length === 0) {
    console.error(`No existe la clínica ${tenantId}.`);
    process.exit(1);
  }
  console.log(`Clínica: ${t.rows[0].nombre} — ${tenantId}`);

  const yaHay = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM vta_cajas WHERE tenant_id = $1`,
    [tenantId]
  );
  if (Number(yaHay.rows[0].n) > 0) {
    console.log(
      "\nEsta clínica ya tiene caja configurada. No se siembra nada: un cierre de caja es " +
        "inmutable por diseño y volver a sembrar duplicaría los cobros."
    );
    return;
  }

  // -------------------------------------------------------------------
  paso("1. Caja, parámetros y tipo de cambio");
  const bodega = (
    await pool.query<{ id: string }>(
      `SELECT id FROM inv_bodegas WHERE tenant_id = $1 AND es_default LIMIT 1`,
      [tenantId]
    )
  ).rows[0]?.id;
  if (!bodega) {
    console.error(
      "La clínica no tiene bodega predeterminada. Sembrá primero el inventario: la caja descuenta de una bodega."
    );
    process.exit(1);
  }

  const caja = (
    await pool.query<{ id: string }>(
      `INSERT INTO vta_cajas (tenant_id, nombre, bodega_id, sucursal, terminal, imprime_tiquete)
       VALUES ($1,'Caja principal',$2,'001','00002',true) RETURNING id`,
      [tenantId, bodega]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO vta_parametros (tenant_id, umbral_diferencia_arqueo, descuento_maximo_pct)
     VALUES ($1, 3000, 10) ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );

  const persona = (
    await pool.query<{ id: string }>(
      `SELECT id FROM personas WHERE tenant_id = $1 AND estado = 'activo' ORDER BY creado_en LIMIT 1`,
      [tenantId]
    )
  ).rows[0]?.id;

  await conAlcanceTenant(tenantId, (db) =>
    registrarTipoCambio(db, tenantId, { valor: 521.45, fuente: "manual", personaId: persona })
  );
  console.log("  caja 'Caja principal' (terminal 00002), umbral ₡3 000, dólar a ₡521,45");

  // La terminal 00002 a propósito: la 00001 la usa la emisión manual
  // del facturador, y dos emisores con la misma terminal se pelearían
  // el consecutivo.

  // -------------------------------------------------------------------
  paso("2. Sesión abierta con fondo");
  const sesion = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId: caja, fondoCrc: 75000, fondoUsd: 200, personaId: persona })
  );
  console.log(`  sesión ${sesion.id} con fondo de ₡75 000 y $200`);

  const cliente = (
    await pool.query<{ id: string; nombre: string; numero_identificacion: string | null }>(
      `SELECT id, nombre, numero_identificacion FROM propietarios WHERE tenant_id = $1
        ORDER BY creado_en LIMIT 1`,
      [tenantId]
    )
  ).rows[0];
  if (!cliente) {
    console.error("La clínica no tiene clientes. Sembrá primero el inventario, que crea uno.");
    process.exit(1);
  }

  // Una FACTURA exige la identificación del receptor (el XSD la define
  // obligatoria). Si el cliente de demostración no la tiene, se le pone
  // una: sin eso, la mitad de la demostración serían tiquetes y no se
  // podría mostrar ni el crédito ni el abono, que exigen factura.
  let identificacion = cliente.numero_identificacion;
  if (!identificacion) {
    identificacion = "112345678";
    await pool.query(
      `UPDATE propietarios
          SET numero_identificacion = $2,
              tipo_identificacion_id = (SELECT id FROM tipos_identificacion
                                         WHERE pais_codigo = 'CR' AND codigo = '01')
        WHERE id = $1`,
      [cliente.id, identificacion]
    );
    console.log(`  al cliente de demostración se le puso la cédula ${identificacion}`);
  }

  const receptor = {
    nombre: cliente.nombre,
    identificacion: { tipo: "01", numero: identificacion },
  };

  const presentaciones = await pool.query<{ id: string; nombre: string; producto: string }>(
    `SELECT pr.id, pr.nombre, p.nombre AS producto
       FROM inv_presentaciones pr JOIN inv_productos p ON p.id = pr.producto_id
      WHERE pr.tenant_id = $1 AND pr.para_venta AND pr.activo
      ORDER BY pr.factor DESC`,
    [tenantId]
  );
  if (presentaciones.rows.length === 0) {
    console.error("No hay presentaciones vendibles. Sembrá primero el inventario.");
    process.exit(1);
  }
  const caja20 = presentaciones.rows.find((p) => p.nombre.includes("Caja")) ?? presentaciones.rows[0];
  const suelta =
    presentaciones.rows.find((p) => p.nombre === "Tableta" || p.nombre === "Unidad") ??
    presentaciones.rows[presentaciones.rows.length - 1];

  // -------------------------------------------------------------------
  paso("3. Un cobro de contado con pago mixto en dólares");
  const cuenta1 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: cliente.id, sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, async (db) => {
    await agregarCargo(db, tenantId, {
      cuentaId: cuenta1.id, origen: "mostrador", presentacionId: caja20.id, cantidad: 1,
      personaId: persona,
    });
    await agregarCargo(db, tenantId, {
      cuentaId: cuenta1.id, origen: "mostrador", presentacionId: suelta.id, cantidad: 2,
      personaId: persona,
    });
  });
  const cobro1 = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuenta1.id, sesionId: sesion.id, tipoComprobante: "01", receptor,
      medios: [
        { medio: "01", moneda: "USD", monto: 15 },
        { medio: "02", moneda: "CRC", monto: 5000, referencia: "AUTH-284471" },
      ],
      personaId: persona,
    })
  );
  console.log(
    `  cobro ${cobro1.consecutivo}: recibido ₡${cobro1.recibidoCrc}, aplicado ₡${cobro1.total}, vuelto ₡${cobro1.vueltoCrc}`
  );

  // -------------------------------------------------------------------
  paso("4. Un tiquete en efectivo");
  const cuenta2 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta2.id, origen: "mostrador", presentacionId: suelta.id, cantidad: 4,
      personaId: persona,
    })
  );
  const cobro2 = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuenta2.id, sesionId: sesion.id, tipoComprobante: "04",
      medios: [{ medio: "01", moneda: "CRC", monto: 5000 }],
      personaId: persona,
    })
  );
  console.log(`  tiquete ${cobro2.consecutivo}, vuelto ₡${cobro2.vueltoCrc}`);

  // -------------------------------------------------------------------
  paso("5. Crédito, una factura a crédito y su abono con REP");
  await pool.query(
    `INSERT INTO vta_credito_cliente (propietario_id, tenant_id, habilitado, limite, plazo_dias)
     VALUES ($1,$2,true,150000,30)
     ON CONFLICT (propietario_id) DO UPDATE SET habilitado = true, limite = 150000`,
    [cliente.id, tenantId]
  );

  const cuenta3 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: cliente.id, sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta3.id, origen: "mostrador", presentacionId: caja20.id, cantidad: 3,
      personaId: persona,
    })
  );
  const cobroCredito = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuenta3.id, sesionId: sesion.id, tipoComprobante: "01", receptor,
      condicionVenta: "10", plazoCreditoDias: 30,
      medios: [{ medio: "credito", monto: 30510 }],
      personaId: persona,
    })
  );
  console.log(`  factura a crédito ${cobroCredito.consecutivo} (condición 10, 30 días)`);

  if (cobroCredito.comprobanteId) {
    const abono = await conAlcanceTenant(tenantId, (db) =>
      registrarAbono(db, tenantId, {
        deudor: deudorCliente(cliente.id),
        sesionId: sesion.id,
        aplicaciones: [{ comprobanteId: cobroCredito.comprobanteId!, monto: 10000 }],
        medios: [{ codigo: "01", monto: 10000 }],
        personaId: persona,
      })
    );
    console.log(`  abono de ₡10 000 con Recibo Electrónico de Pago ${abono.repConsecutivo}`);
  }

  // -------------------------------------------------------------------
  paso("6. Un anticipo, un encargo y un movimiento de efectivo");
  await conAlcanceTenant(tenantId, (db) =>
    registrarAnticipo(db, tenantId, {
      deudor: deudorCliente(cliente.id), sesionId: sesion.id,
      motivo: "Anticipo de la castración de Nina", monto: 25000, personaId: persona,
    })
  );
  const producto = (
    await pool.query<{ id: string }>(
      `SELECT id FROM inv_productos WHERE tenant_id = $1 ORDER BY nombre LIMIT 1`,
      [tenantId]
    )
  ).rows[0]?.id;
  await pool.query(
    `INSERT INTO vta_encargos (tenant_id, propietario_id, producto_id, descripcion, cantidad,
                               estado, creado_por)
     VALUES ($1,$2,$3,'Alimento renal 7,5 kg',1,'recibido',$4)`,
    [tenantId, cliente.id, producto ?? null, persona ?? null]
  );
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimientoEfectivo(db, tenantId, {
      sesionId: sesion.id, tipo: "retiro_caja_fuerte", monto: 30000,
      motivo: "Retiro del mediodía a la caja fuerte", personaId: persona,
    })
  );
  console.log("  anticipo de ₡25 000, un encargo recibido por avisar y un retiro de ₡30 000");

  // -------------------------------------------------------------------
  paso("7. Una aprobación pendiente y el talonario");
  await conAlcanceTenant(tenantId, (db) =>
    solicitarAprobacion(db, tenantId, {
      tipo: "anular_cobro",
      referenciaId: cobro2.cobroId,
      monto: cobro2.total,
      motivo: "El cliente se arrepintió y devolvió el producto sin abrir",
      solicitadaPor: persona,
    })
  );
  const talonario = await conAlcanceTenant(tenantId, (db) =>
    emitirTalonario(db, tenantId, { cajaId: caja, cantidad: 25 })
  );
  console.log(
    `  una solicitud de anulación pendiente y un talonario del ${talonario.desde} al ${talonario.hasta}`
  );

  // -------------------------------------------------------------------
  paso("Resumen");
  const resumen = await pool.query(
    `SELECT cm.medio, cm.moneda, sum(cm.monto)::text AS total
       FROM vta_cobro_medios cm JOIN vta_cobros c ON c.id = cm.cobro_id
      WHERE c.sesion_id = $1 AND c.estado = 'aplicado'
      GROUP BY cm.medio, cm.moneda ORDER BY cm.medio`,
    [sesion.id]
  );
  console.table(resumen.rows);
  console.log(`\nSesión abierta: ${sesion.id}`);
  console.log(`Caja del día:  /ventas/caja/${sesion.id}`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
