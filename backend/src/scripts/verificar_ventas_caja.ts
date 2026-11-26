// Verificación del módulo `ventas`: caja, cuentas, cobros, crédito,
// anticipos, aprobaciones y contingencia (prompt 08).
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/verificar_ventas_caja.ts
//
// Cubre, uno por uno, los puntos de la sección "Verificación" del
// prompt. Todo contra la base y el motor reales, con el proveedor
// SIMULADO de Hacienda.
import { pool, tenantPool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { generarCertificadoPrueba } from "../facturacion/certificadoPrueba";
import { guardarCredenciales } from "../facturacion/credenciales";
import { fijarEscenarioPorDefecto, reiniciarSimulado } from "../facturacion/haciendaSimulado";
import { exigirXmlValido } from "../facturacion/validacionXsd";
import { registrarMovimiento } from "../inventario/movimientos";
import {
  abrirSesion,
  cerrarSesion,
  esperadoDeSesion,
  registrarMovimientoEfectivo,
  registrarTipoCambio,
} from "../ventas/caja";
import { abrirCuenta, agregarCargo, totalDeCuenta } from "../ventas/cuentas";
import { cobrar, datosDeTiquete } from "../ventas/cobros";
import {
  deudorCliente,
  cuentaCorriente,
  puedeComprarACredito,
  registrarAbono,
  registrarAnticipo,
  aplicarAnticipos,
  saldoAFavor,
} from "../ventas/credito";
import { resolverAprobacion, solicitarAprobacion } from "../ventas/aprobaciones";
import { aExcel, aPdf } from "../exportacion/tabla";
import { reporteDeVentas } from "../ventas/reportes";
import { crearPerfil } from "../facturacion/perfilesFacturacion";
import {
  cancelar,
  crearEncargo,
  entregar,
  marcarAvisado,
  marcarRecibido,
  pedirAlProveedor,
} from "../ventas/encargos";
import { emitirTalonario, regularizarProvisional } from "../ventas/contingencia";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-ventas-caja";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}
async function debeFallar(descripcion: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(false, `${descripcion} — NO falló, y tenía que fallar`);
  } catch (err) {
    assert(true, `${descripcion} — rechazado`, (err as Error).message.slice(0, 110));
  }
}

let tenantId = "";
let bodegaId = "";
let cajaId = "";
let cajero = "";
let admin = "";
let clienteId = "";
let presCaja = "";
let presTableta = "";
let productoId = "";

async function main() {
  exigirEntornoDeDesarrollo("verificar_ventas_caja");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });

  console.log("=== 0. Clínica con emisor, inventario, caja y dos personas ===");
  tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@ventas.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  const emisorId = (
    await pool.query<{ id: string }>(
      `INSERT INTO fact_emisores (tenant_id, tipo_identificacion, numero_identificacion, nombre,
                                  codigo_actividad_economica, ubicacion_provincia, ubicacion_canton,
                                  ubicacion_distrito, ubicacion_otras_senas, correo,
                                  proveedor_sistemas, ambiente_activo)
       VALUES ($1,'02','3101777888','Clínica de Prueba Caja S.A.','750000','1','01','01',
               '200 metros norte','probe@ventas.test','3101999999','pruebas') RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  const cert = generarCertificadoPrueba({ nombreComun: "PRUEBA CAJA (FIRMA)" });
  await guardarCredenciales(pool, {
    tenantId, emisorId, ambiente: "pruebas",
    usuarioApi: "cpj-3-101-777888@stag.comprobanteselectronicos.go.cr",
    passwordApi: "clave", llaveP12: cert.p12, pinLlave: cert.pin,
  });

  bodegaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,'FARM','Farmacia',true) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;

  cajero = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico)
       VALUES ($1,'Recepcionista',$2,'x',false,false) RETURNING id`,
      [tenantId, `${PREFIJO}-cajero@probe.test`]
    )
  ).rows[0].id;
  admin = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico)
       VALUES ($1,'Doctora administradora',$2,'x',true,false) RETURNING id`,
      [tenantId, `${PREFIJO}-admin@probe.test`]
    )
  ).rows[0].id;

  clienteId = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, telefono, numero_identificacion,
                                 tipo_identificacion_id)
       VALUES ($1,'Ana María Rodríguez Jiménez','88887777','112345678',
               (SELECT id FROM tipos_identificacion WHERE pais_codigo='CR' AND codigo='01'))
       RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;

  productoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                  codigo_cabys, codigo_tarifa_iva)
       VALUES ($1,'P-1','Amoxicilina 500 mg','farmacia','tableta','3564012000000','08')
       RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  presCaja = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                       unidad_medida, precio_venta, para_venta)
       VALUES ($1,$2,'C1','Caja de 20',20,'Unid',9000,true) RETURNING id`,
      [tenantId, productoId]
    )
  ).rows[0].id;
  presTableta = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                       unidad_medida, precio_venta, para_venta)
       VALUES ($1,$2,'C2','Tableta',1,'Unid',600,true) RETURNING id`,
      [tenantId, productoId]
    )
  ).rows[0].id;

  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId, bodegaId, cantidadBase: 500,
      lote: { numero: "L-1", vencimiento: "2028-06-30", costoUnitario: 300 },
    })
  );

  cajaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO vta_cajas (tenant_id, nombre, bodega_id, terminal)
       VALUES ($1,'Caja principal',$2,'00001') RETURNING id`,
      [tenantId, bodegaId]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO vta_parametros (tenant_id, umbral_diferencia_arqueo, descuento_maximo_pct)
     VALUES ($1, 2000, 10)`,
    [tenantId]
  );
  assert(!!cajaId, "clínica, emisor, inventario, caja, cajero y administradora");

  // -------------------------------------------------------------------
  console.log("\n=== 1. Abrir caja con fondo en colones y dólares ===");
  await conAlcanceTenant(tenantId, (db) =>
    registrarTipoCambio(db, tenantId, { valor: 520, fuente: "manual", personaId: admin })
  );
  const sesion = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId, fondoCrc: 50000, fondoUsd: 100, personaId: cajero })
  );
  assert(!!sesion.id, "sesión abierta con fondo de ₡50 000 y $100");

  await debeFallar("abrir una segunda sesión en la misma caja", () =>
    conAlcanceTenant(tenantId, (db) => abrirSesion(db, tenantId, { cajaId, personaId: admin }))
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. Venta de mostrador: una caja y una tableta suelta ===");
  const cuenta = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, async (db) => {
    await agregarCargo(db, tenantId, {
      cuentaId: cuenta.id, origen: "mostrador", presentacionId: presCaja, cantidad: 1,
      personaId: cajero,
    });
    await agregarCargo(db, tenantId, {
      cuentaId: cuenta.id, origen: "mostrador", presentacionId: presTableta, cantidad: 3,
      personaId: cajero,
    });
  });

  const stock = await pool.query<{ t: string }>(
    `SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE producto_id = $1`,
    [productoId]
  );
  igual(Number(stock.rows[0].t), 477, "vender 1 caja y 3 tabletas descontó 23 tabletas (500 → 477)");

  const tot = await conAlcanceTenant(tenantId, (db) => totalDeCuenta(db, cuenta.id));
  // 9 000 + 3 × 600 = 10 800; IVA 13% = 1 404; total 12 204.
  igual(tot.total, 12204, "la cuenta suma ₡12 204 con el 13%");

  // -------------------------------------------------------------------
  console.log("\n=== 3. Pago mixto: dólares con vuelto en colones, más tarjeta ===");
  // $10 × 520 = 5 200 · tarjeta 8 000 → recibido 13 200 para 12 204.
  // Vuelto 996, que sale del efectivo (los dólares).
  const cobro = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuenta.id,
      sesionId: sesion.id,
      tipoComprobante: "01",
      receptor: {
        nombre: "Ana María Rodríguez Jiménez",
        identificacion: { tipo: "01", numero: "112345678" },
      },
      medios: [
        { medio: "01", moneda: "USD", monto: 10 },
        { medio: "02", moneda: "CRC", monto: 8000, referencia: "AUTH-99120" },
      ],
      personaId: cajero,
    })
  );
  igual(cobro.recibidoCrc, 13200, "recibido en colones: $10 a 520 más ₡8 000");
  igual(cobro.total, 12204, "se aplicó exactamente el saldo");
  igual(cobro.vueltoCrc, 996, "y el vuelto de ₡996 se da en colones");
  assert(!!cobro.comprobanteId, "se emitió el comprobante", cobro.consecutivo);
  igual(cobro.estadoComprobante, "aceptado", "y Hacienda lo aceptó");

  await debeFallar("cobrar de nuevo una cuenta ya saldada", () =>
    conAlcanceTenant(tenantId, (db) =>
      cobrar(db, tenantId, {
        cuentaId: cuenta.id, sesionId: sesion.id,
        medios: [{ medio: "01", monto: 1000 }], personaId: cajero,
      })
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 4. La tarjeta exige el número de autorización ===");
  const cuenta2 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta2.id, origen: "mostrador", presentacionId: presTableta, cantidad: 1,
      personaId: cajero,
    })
  );
  await debeFallar("cobrar con tarjeta sin número de autorización", () =>
    conAlcanceTenant(tenantId, (db) =>
      cobrar(db, tenantId, {
        cuentaId: cuenta2.id, sesionId: sesion.id,
        medios: [{ medio: "02", monto: 678 }], personaId: cajero,
      })
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. Dos personas cobrando en la misma sesión ===");
  const cobro2 = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuenta2.id, sesionId: sesion.id, tipoComprobante: "04",
      medios: [{ medio: "01", monto: 678 }], personaId: admin,
    })
  );
  const responsables = await pool.query<{ cobrado_por: string }>(
    `SELECT cobrado_por FROM vta_cobros WHERE sesion_id = $1 ORDER BY creado_en`,
    [sesion.id]
  );
  igual(
    responsables.rows.map((r) => r.cobrado_por),
    [cajero, admin],
    "cada cobro guarda QUIÉN lo hizo, aunque la sesión sea la misma"
  );
  void cobro2;

  // -------------------------------------------------------------------
  console.log("\n=== 6. El descuento sobre el máximo pide autorización ===");
  const cuenta3 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesion.id })
  );
  await debeFallar("un descuento del 50% con un máximo del 10%", () =>
    conAlcanceTenant(tenantId, (db) =>
      agregarCargo(db, tenantId, {
        cuentaId: cuenta3.id, origen: "mostrador", presentacionId: presCaja, cantidad: 1,
        descuento: 4500, descuentoCodigo: "01", personaId: cajero,
      })
    )
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta3.id, origen: "mostrador", presentacionId: presCaja, cantidad: 1,
      descuento: 4500, descuentoCodigo: "01", descuentoNaturaleza: "Convenio",
      descuentoAutorizadoPor: admin, personaId: cajero,
    })
  );
  assert(true, "con la autorización de la administradora sí se aplica");

  // -------------------------------------------------------------------
  console.log("\n=== 7. Movimiento de efectivo y arqueo ===");
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimientoEfectivo(db, tenantId, {
      sesionId: sesion.id, tipo: "retiro_caja_fuerte", monto: 20000,
      motivo: "Retiro a la caja fuerte del mediodía", personaId: cajero,
    })
  );
  await debeFallar("un gasto de caja chica sin categoría", () =>
    conAlcanceTenant(tenantId, (db) =>
      registrarMovimientoEfectivo(db, tenantId, {
        sesionId: sesion.id, tipo: "gasto_caja_chica", monto: 3000,
        motivo: "Café", personaId: cajero,
      })
    )
  );

  const esperado = await conAlcanceTenant(tenantId, (db) => esperadoDeSesion(db, sesion.id));
  const efCrc = esperado.find((e) => e.medio === "efectivo" && e.moneda === "CRC")!;
  const efUsd = esperado.find((e) => e.medio === "efectivo" && e.moneda === "USD")!;
  const tarjeta = esperado.find((e) => e.medio === "tarjeta")!;
  // Efectivo CRC = 50 000 fondo + 678 del tiquete − 996 de vuelto − 20 000 de retiro
  igual(efCrc.esperado, 29682, "efectivo en colones esperado: fondo + cobros − vuelto − retiro");
  igual(efUsd.esperado, 110, "efectivo en dólares esperado: $100 de fondo + $10 cobrados");
  igual(tarjeta.esperado, 8000, "tarjeta esperada: ₡8 000");

  // -------------------------------------------------------------------
  console.log("\n=== 8. Una diferencia sin justificar no cierra ===");
  const declarar = (ajusteCrc = 0) =>
    esperado.map((e) => ({
      medio: e.medio,
      moneda: e.moneda,
      declarado: e.medio === "efectivo" && e.moneda === "CRC" ? e.esperado + ajusteCrc : e.esperado,
    }));

  await debeFallar("cerrar con una diferencia sin justificación", () =>
    conAlcanceTenant(tenantId, (db) =>
      cerrarSesion(db, tenantId, sesion.id, { lineas: declarar(-500), personaId: cajero })
    )
  );

  console.log("\n=== 9. Una diferencia sobre el umbral NO cierra sin aprobación ===");
  const intento = await conAlcanceTenant(tenantId, (db) =>
    cerrarSesion(db, tenantId, sesion.id, {
      lineas: declarar(-5000).map((l) =>
        l.medio === "efectivo" && l.moneda === "CRC"
          ? { ...l, justificacion: "Faltante que no se explica" }
          : l
      ),
      personaId: cajero,
    })
  );
  igual(intento.cerrada, false, "con ₡5 000 de diferencia y umbral ₡2 000, la caja NO cierra");
  assert(!!intento.aprobacionId, "y queda una solicitud de aprobación", intento.aprobacionId);
  const sigueAbierta = await pool.query<{ estado: string }>(
    `SELECT estado FROM vta_sesiones_caja WHERE id = $1`,
    [sesion.id]
  );
  igual(sigueAbierta.rows[0].estado, "abierta", "la sesión sigue abierta");

  console.log("\n=== 10. Quien pide no aprueba ===");
  await debeFallar("que el cajero apruebe su propia solicitud", () =>
    conAlcanceTenant(tenantId, (db) =>
      resolverAprobacion(db, tenantId, intento.aprobacionId!, {
        aprobar: true, resueltaPor: cajero,
      })
    )
  );

  console.log("\n=== 11. Con la aprobación, cierra; y después es inmutable ===");
  await conAlcanceTenant(tenantId, (db) =>
    resolverAprobacion(db, tenantId, intento.aprobacionId!, { aprobar: true, resueltaPor: admin })
  );
  const cierre = await conAlcanceTenant(tenantId, (db) =>
    cerrarSesion(db, tenantId, sesion.id, {
      lineas: declarar(-5000).map((l) =>
        l.medio === "efectivo" && l.moneda === "CRC"
          ? { ...l, justificacion: "Faltante que no se explica" }
          : l
      ),
      personaId: cajero,
      aprobadoPor: admin,
    })
  );
  igual(cierre.cerrada, true, "con la aprobación la caja cierra");
  igual(cierre.lineas.find((l) => l.medio === "efectivo" && l.moneda === "CRC")!.diferencia, -5000,
    "y el arqueo guarda la diferencia");

  await debeFallar("modificar una sesión cerrada desde la base", () =>
    pool.query(`UPDATE vta_sesiones_caja SET fondo_crc = 999 WHERE id = $1`, [sesion.id])
  );
  await debeFallar("borrar una sesión cerrada desde la base", () =>
    pool.query(`DELETE FROM vta_sesiones_caja WHERE id = $1`, [sesion.id])
  );
  await debeFallar("meter un cobro en una sesión cerrada", () =>
    pool.query(
      `INSERT INTO vta_cobros (tenant_id, sesion_id, total) VALUES ($1,$2,100)`,
      [tenantId, sesion.id]
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 11b. Conteo por denominación: el conteo ES el declarado ===");
  const sesionConteo = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId, fondoCrc: 25000, fondoUsd: 40, personaId: cajero })
  );
  const espConteo = await conAlcanceTenant(tenantId, (db) =>
    esperadoDeSesion(db, sesionConteo.id)
  );

  // Se declara a mano un número EQUIVOCADO a propósito, y además se
  // cuentan los billetes: lo que tiene que valer es el conteo.
  const cierreConteo = await conAlcanceTenant(tenantId, (db) =>
    cerrarSesion(db, tenantId, sesionConteo.id, {
      lineas: espConteo.map((e) => ({
        medio: e.medio,
        moneda: e.moneda,
        declarado: e.medio === "efectivo" && e.moneda === "CRC" ? 99999 : e.esperado,
      })),
      denominaciones: [
        { moneda: "CRC", valor: 10000, cantidad: 2 },
        { moneda: "CRC", valor: 5000, cantidad: 1 },
        { moneda: "USD", valor: 20, cantidad: 2 },
      ],
      personaId: cajero,
    })
  );
  const efConteo = cierreConteo.lineas.find(
    (l) => l.medio === "efectivo" && l.moneda === "CRC"
  )!;
  igual(
    [efConteo.declarado, efConteo.diferencia, efConteo.contadoPorDenominacion],
    [25000, 0, true],
    "2×10 000 + 1×5 000 = 25 000 declarados, y los 99 999 escritos a mano se ignoran"
  );
  const usdConteo = cierreConteo.lineas.find(
    (l) => l.medio === "efectivo" && l.moneda === "USD"
  )!;
  igual([usdConteo.declarado, usdConteo.diferencia], [40, 0], "y 2×$20 cuadran con el fondo");
  igual(cierreConteo.cerrada, true, "la caja cierra: el conteo cuadra con lo esperado");

  const guardadas = await pool.query<{ moneda: string; valor: string; cantidad: number }>(
    `SELECT moneda, valor, cantidad FROM vta_arqueo_denominaciones
      WHERE sesion_id = $1 ORDER BY moneda, valor DESC`,
    [sesionConteo.id]
  );
  igual(
    guardadas.rows.map((d) => `${d.moneda} ${Number(d.valor)}x${d.cantidad}`),
    ["CRC 10000x2", "CRC 5000x1", "USD 20x2"],
    "el detalle del conteo queda guardado, no solo el total"
  );

  const sesionMala = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId, fondoCrc: 1000, personaId: cajero })
  );
  const lineasMalas = (
    await conAlcanceTenant(tenantId, (db) => esperadoDeSesion(db, sesionMala.id))
  ).map((e) => ({ medio: e.medio, moneda: e.moneda, declarado: e.esperado }));

  await debeFallar("una denominación con cantidad fraccionaria", () =>
    conAlcanceTenant(tenantId, (db) =>
      cerrarSesion(db, tenantId, sesionMala.id, {
        lineas: lineasMalas,
        denominaciones: [{ moneda: "CRC", valor: 1000, cantidad: 1.5 }],
        personaId: cajero,
      })
    )
  );
  await debeFallar("una denominación de valor cero", () =>
    conAlcanceTenant(tenantId, (db) =>
      cerrarSesion(db, tenantId, sesionMala.id, {
        lineas: lineasMalas,
        denominaciones: [{ moneda: "CRC", valor: 0, cantidad: 3 }],
        personaId: cajero,
      })
    )
  );
  const siguePendiente = await pool.query<{ estado: string }>(
    `SELECT estado FROM vta_sesiones_caja WHERE id = $1`,
    [sesionMala.id]
  );
  igual(
    siguePendiente.rows[0].estado,
    "abierta",
    "y ninguno de los dos intentos dejó la sesión a medio cerrar"
  );

  // Esa sesión se cierra cuadrada: una caja no admite dos sesiones
  // abiertas, y dejarla abierta rompería la sección siguiente.
  await conAlcanceTenant(tenantId, (db) =>
    cerrarSesion(db, tenantId, sesionMala.id, { lineas: lineasMalas, personaId: cajero })
  );

  // -------------------------------------------------------------------
  console.log("\n=== 12. Crédito: dentro del límite y por encima ===");
  const sesion2 = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId, fondoCrc: 10000, personaId: cajero })
  );
  await pool.query(
    `INSERT INTO vta_credito_cliente (propietario_id, tenant_id, habilitado, limite, plazo_dias)
     VALUES ($1,$2,true,50000,30)`,
    [clienteId, tenantId]
  );

  const dentro = await conAlcanceTenant(tenantId, (db) =>
    puedeComprarACredito(db, deudorCliente(clienteId), 20000)
  );
  igual(dentro.puede, true, "20 000 contra un límite de 50 000: pasa");
  const fuera = await conAlcanceTenant(tenantId, (db) =>
    puedeComprarACredito(db, deudorCliente(clienteId), 80000)
  );
  igual(fuera.puede, false, "80 000 no pasa");
  assert(
    (fuera.motivo ?? "").includes("autorice un administrador"),
    "y el motivo dice qué hacer",
    fuera.motivo
  );

  // Una venta a crédito de verdad, con condición 10 (hasta 90 días).
  const cuentaCredito = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesion2.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuentaCredito.id, origen: "mostrador", presentacionId: presCaja, cantidad: 2,
      personaId: cajero,
    })
  );
  const cobroCredito = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuentaCredito.id, sesionId: sesion2.id, tipoComprobante: "01",
      condicionVenta: "10", plazoCreditoDias: 30,
      receptor: {
        nombre: "Ana María Rodríguez Jiménez",
        identificacion: { tipo: "01", numero: "112345678" },
      },
      medios: [{ medio: "credito", monto: 20340 }],
      personaId: cajero,
    })
  );
  assert(!!cobroCredito.comprobanteId, "la factura a crédito se emitió", cobroCredito.consecutivo);
  const condicion = await pool.query<{ condicion_venta: string; plazo_credito_dias: number }>(
    `SELECT condicion_venta, plazo_credito_dias FROM fact_comprobantes WHERE id = $1`,
    [cobroCredito.comprobanteId]
  );
  igual(
    [condicion.rows[0].condicion_venta, condicion.rows[0].plazo_credito_dias],
    ["10", 30],
    "con la condición 10 del Anexo 4.4 y su plazo"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 13. Abono con su REP, repartido entre dos facturas ===");
  // Una segunda venta a crédito para tener dos facturas.
  const cuentaCredito2 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesion2.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuentaCredito2.id, origen: "mostrador", presentacionId: presTableta, cantidad: 10,
      personaId: cajero,
    })
  );
  const cobroCredito2 = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuentaCredito2.id, sesionId: sesion2.id, tipoComprobante: "01",
      condicionVenta: "10", plazoCreditoDias: 30,
      receptor: {
        nombre: "Ana María Rodríguez Jiménez",
        identificacion: { tipo: "01", numero: "112345678" },
      },
      medios: [{ medio: "credito", monto: 6780 }],
      personaId: cajero,
    })
  );

  const abono = await conAlcanceTenant(tenantId, (db) =>
    registrarAbono(db, tenantId, {
      deudor: deudorCliente(clienteId),
      sesionId: sesion2.id,
      aplicaciones: [
        { comprobanteId: cobroCredito.comprobanteId!, monto: 10000 },
        { comprobanteId: cobroCredito2.comprobanteId!, monto: 3000 },
      ],
      personaId: cajero,
    })
  );
  igual(abono.aplicado, 13000, "el abono reparte 10 000 y 3 000 entre dos facturas");
  assert(!!abono.repId, "y emitió su Recibo Electrónico de Pago", abono.repConsecutivo);

  const rep = await pool.query<{
    tipo_comprobante: string;
    condicion_venta: string;
    estado: string;
    xml: string;
  }>(
    `SELECT tipo_comprobante, condicion_venta, estado, convert_from(xml_firmado,'UTF8') AS xml
       FROM fact_comprobantes WHERE id = $1`,
    [abono.repId]
  );
  igual(rep.rows[0].tipo_comprobante, "10", "el REP es el tipo 10");
  igual(
    rep.rows[0].condicion_venta,
    "11",
    "con la condición 11, que es uno de los DOS únicos códigos que el Anexo admite en un REP"
  );
  await exigirXmlValido(rep.rows[0].xml, "10");
  assert(true, "y su XML valida contra el XSD oficial del REP");
  const refs = (rep.rows[0].xml.match(/<InformacionReferencia>/g) ?? []).length;
  igual(refs, 2, "con una referencia por cada factura abonada");

  const cc = await conAlcanceTenant(tenantId, (db) => cuentaCorriente(db, deudorCliente(clienteId)));
  igual(cc.facturas.length, 2, "la cuenta corriente muestra las dos facturas a crédito");
  igual(
    cc.facturas.map((f) => Number(f.pendiente)),
    [10340, 3780],
    "con lo que le queda pendiente a cada una"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 14. Anticipo aplicado a la cuenta final ===");
  await conAlcanceTenant(tenantId, (db) =>
    registrarAnticipo(db, tenantId, {
      deudor: deudorCliente(clienteId), sesionId: sesion2.id,
      motivo: "Anticipo de la castración de Nina", monto: 25000, personaId: cajero,
    })
  );
  igual(await conAlcanceTenant(tenantId, (db) => saldoAFavor(db, deudorCliente(clienteId))), 25000,
    "el anticipo queda como saldo a favor");

  const anticipoComprobante = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM vta_anticipos
      WHERE propietario_id = $1 AND comprobante_id IS NOT NULL`,
    [clienteId]
  );
  igual(
    anticipoComprobante.rows[0].n,
    "0",
    "y NO emitió comprobante al recibirse (criterio conservador: las fuentes oficiales no lo tratan)"
  );

  const cuentaCirugia = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesion2.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuentaCirugia.id, origen: "manual", descripcion: "Castración de gata",
      cantidad: 1, precioUnitario: 55000, personaId: cajero,
      codigoCabys: "8351000000000", codigoTarifaIva: "04", unidadMedida: "Sp",
      lineaNegocio: "cirugia",
    })
  );
  const totCirugia = await conAlcanceTenant(tenantId, (db) => totalDeCuenta(db, cuentaCirugia.id));

  // Pagar con un anticipo que el cliente NO tiene: rechazado. Antes se
  // aceptaba, saldaba la cuenta y emitia la factura con plata
  // imaginaria, sin tocar el saldo a favor.
  await debeFallar("pagar con mas anticipo del que el cliente tiene", () =>
    conAlcanceTenant(tenantId, (db) =>
      cobrar(db, tenantId, {
        cuentaId: cuentaCirugia.id, sesionId: sesion2.id, tipoComprobante: "04",
        medios: [{ medio: "anticipo", monto: 99999 }],
        personaId: cajero,
      })
    )
  );
  const cobroCirugia = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuentaCirugia.id, sesionId: sesion2.id, tipoComprobante: "01",
      receptor: {
        nombre: "Ana María Rodríguez Jiménez",
        identificacion: { tipo: "01", numero: "112345678" },
      },
      medios: [
        { medio: "anticipo", monto: 25000 },
        { medio: "01", monto: totCirugia.total - 25000 },
      ],
      personaId: cajero,
    })
  );
  igual(cobroCirugia.total, totCirugia.total, "la cuenta se salda con el anticipo mas el efectivo");
  const totCirugiaFinal = await conAlcanceTenant(tenantId, (db) =>
    totalDeCuenta(db, cuentaCirugia.id)
  );
  igual(totCirugiaFinal.saldo, 0, "y la cuenta queda en cero: el anticipo bajo el saldo de verdad");
  igual(await conAlcanceTenant(tenantId, (db) => saldoAFavor(db, deudorCliente(clienteId))), 0,
    "y el saldo a favor queda en cero");

  // -------------------------------------------------------------------
  console.log("\n=== 15. Anulación: sin aprobación no pasa nada ===");
  const stockAntes = Number(
    (await pool.query<{ t: string }>(
      `SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE producto_id = $1`,
      [productoId]
    )).rows[0].t
  );
  const cargoADevolver = (
    await pool.query<{ id: string }>(
      `SELECT id FROM vta_cargos WHERE cuenta_id = $1 AND movimiento_id IS NOT NULL LIMIT 1`,
      [cuentaCredito.id]
    )
  ).rows[0].id;

  const solicitud = await conAlcanceTenant(tenantId, (db) =>
    solicitarAprobacion(db, tenantId, {
      tipo: "devolucion", referenciaId: cargoADevolver,
      motivo: "El cliente devolvió las cajas sin abrir", solicitadaPor: cajero,
    })
  );
  const stockDespuesDeSolicitar = Number(
    (await pool.query<{ t: string }>(
      `SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE producto_id = $1`,
      [productoId]
    )).rows[0].t
  );
  igual(stockDespuesDeSolicitar, stockAntes, "pedir la devolución NO movió stock");

  await conAlcanceTenant(tenantId, (db) =>
    resolverAprobacion(db, tenantId, solicitud.id, { aprobar: true, resueltaPor: admin })
  );
  const stockDespues = Number(
    (await pool.query<{ t: string }>(
      `SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE producto_id = $1`,
      [productoId]
    )).rows[0].t
  );
  igual(stockDespues, stockAntes + 40, "al aprobarla, las 2 cajas (40 tabletas) vuelven al lote");
  const volvioAlLote = await pool.query<{ numero: string }>(
    `SELECT l.numero FROM inv_movimientos m JOIN inv_lotes l ON l.id = m.lote_id
      WHERE m.tipo = 'devolucion_cliente' AND m.tenant_id = $1 ORDER BY m.creado_en DESC LIMIT 1`,
    [tenantId]
  );
  igual(volvioAlLote.rows[0].numero, "L-1", "y vuelven al MISMO lote del que salieron");

  console.log("\n=== 16. Anular un cobro emite la nota de crédito ===");
  const solicitudAnular = await conAlcanceTenant(tenantId, (db) =>
    solicitarAprobacion(db, tenantId, {
      tipo: "anular_cobro", referenciaId: cobroCredito2.cobroId,
      motivo: "Se facturó a la persona equivocada", solicitadaPor: cajero,
    })
  );
  const resultado = await conAlcanceTenant(tenantId, (db) =>
    resolverAprobacion(db, tenantId, solicitudAnular.id, { aprobar: true, resueltaPor: admin })
  );
  assert(!!resultado.detalle?.nota, "salió la nota de crédito", resultado.detalle);
  const cobroAnulado = await pool.query<{ estado: string }>(
    `SELECT estado FROM vta_cobros WHERE id = $1`,
    [cobroCredito2.cobroId]
  );
  igual(cobroAnulado.rows[0].estado, "anulado", "y el cobro quedó anulado");

  // -------------------------------------------------------------------
  console.log("\n=== 17. Tiquete térmico con todos sus datos ===");
  const tiquete = await conAlcanceTenant(tenantId, (db) => datosDeTiquete(db, cobro.cobroId));
  assert(!!tiquete.cobro.clave, "el tiquete trae la clave del comprobante");
  assert(!!tiquete.cobro.consecutivo, "y su consecutivo", tiquete.cobro.consecutivo);
  igual(tiquete.medios.length, 2, "los dos medios del pago mixto");
  igual(Number(tiquete.cobro.vuelto_crc), 996, "y el vuelto");
  assert(tiquete.lineas.length === 2, "con sus dos líneas", tiquete.lineas.length);

  // -------------------------------------------------------------------
  console.log("\n=== 18. Contingencia: provisional regularizado ===");
  const talonario = await conAlcanceTenant(tenantId, (db) =>
    emitirTalonario(db, tenantId, { cajaId, cantidad: 10 })
  );
  igual([talonario.desde, talonario.hasta], [1, 10], "talonario prenumerado del 1 al 10");

  const cuentaContingencia = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesion2.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuentaContingencia.id, origen: "mostrador", presentacionId: presTableta,
      cantidad: 5, personaId: cajero,
    })
  );
  const ayer = new Date(Date.now() - 86400000).toISOString();
  const regularizado = await conAlcanceTenant(tenantId, (db) =>
    regularizarProvisional(db, tenantId, {
      numeroProvisional: 3,
      cuentaId: cuentaContingencia.id,
      fechaVenta: ayer,
      tipoComprobante: "04",
    })
  );
  igual(regularizado.estado, "aceptado", "la venta en contingencia se regularizó");

  const xmlReg = await pool.query<{ xml: string; fecha: Date }>(
    `SELECT convert_from(xml_firmado,'UTF8') AS xml, fecha_emision AS fecha
       FROM fact_comprobantes WHERE id = $1`,
    [regularizado.comprobanteId]
  );
  assert(
    xmlReg.rows[0].xml.includes("<Codigo>05</Codigo>"),
    "con el código de referencia 05, 'Sustituye comprobante provisional por contingencia'"
  );
  assert(
    xmlReg.rows[0].xml.includes("<Numero>3</Numero>"),
    "y el número del provisional de papel"
  );
  igual(
    xmlReg.rows[0].fecha.toISOString().slice(0, 10),
    ayer.slice(0, 10),
    "emitido con la fecha REAL de la venta, no con la de hoy"
  );
  await exigirXmlValido(xmlReg.rows[0].xml, "04");
  assert(true, "y el XML valida contra el XSD oficial");

  await debeFallar("regularizar dos veces el mismo provisional", () =>
    conAlcanceTenant(tenantId, (db) =>
      regularizarProvisional(db, tenantId, {
        numeroProvisional: 3, cuentaId: cuentaContingencia.id, fechaVenta: ayer,
      })
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 19. Cuenta abierta varios días, dos mascotas, una sola cuenta ===");
  const otroPropietario = clienteId;
  const nina = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
       VALUES ($1,$2,'Nina','canino',
               (SELECT COALESCE(max(numero_expediente),0)+1 FROM pacientes WHERE tenant_id=$1))
       RETURNING id`,
      [tenantId, otroPropietario]
    )
  ).rows[0].id;
  const rocco = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
       VALUES ($1,$2,'Rocco','canino',
               (SELECT COALESCE(max(numero_expediente),0)+1 FROM pacientes WHERE tenant_id=$1))
       RETURNING id`,
      [tenantId, otroPropietario]
    )
  ).rows[0].id;

  const hosp = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: otroPropietario, sesionId: sesion2.id })
  );
  for (const [dia, paciente] of [
    [1, nina], [2, nina], [3, rocco],
  ] as Array<[number, string]>) {
    await conAlcanceTenant(tenantId, (db) =>
      agregarCargo(db, tenantId, {
        cuentaId: hosp.id, origen: "manual",
        descripcion: `Hospitalización día ${dia}`, cantidad: 1, precioUnitario: 18000,
        pacienteId: paciente, personaId: cajero,
        codigoCabys: "8351000000000", codigoTarifaIva: "04", unidadMedida: "Sp",
        lineaNegocio: "hospitalizacion",
      })
    );
  }
  const cargosHosp = await pool.query<{ paciente_id: string }>(
    `SELECT paciente_id FROM vta_cargos WHERE cuenta_id = $1 ORDER BY creado_en`,
    [hosp.id]
  );
  igual(
    cargosHosp.rows.map((c) => c.paciente_id),
    [nina, nina, rocco],
    "tres días en UNA cuenta, cada línea con su mascota"
  );
  const totHosp = await conAlcanceTenant(tenantId, (db) => totalDeCuenta(db, hosp.id));
  igual(totHosp.total, 56160, "y suma 56 160 (54 000 más el 4% de servicios veterinarios)");

  // -------------------------------------------------------------------
  console.log("\n=== 20. Encargo: anticipo, orden de compra, reserva, aviso y entrega ===");
  // La sesion del credito sigue abierta y una caja no admite dos: se
  // cierra cuadrada antes de empezar.
  const lineasSesion2 = (
    await conAlcanceTenant(tenantId, (db) => esperadoDeSesion(db, sesion2.id))
  ).map((e) => ({ medio: e.medio, moneda: e.moneda, declarado: e.esperado }));
  await conAlcanceTenant(tenantId, (db) =>
    cerrarSesion(db, tenantId, sesion2.id, { lineas: lineasSesion2, personaId: cajero })
  );

  const sesionEnc = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId, fondoCrc: 5000, personaId: cajero })
  );

  const proveedorId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_proveedores (tenant_id, nombre) VALUES ($1,'Distribuidora de prueba')
       RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;

  const encargo = await conAlcanceTenant(tenantId, (db) =>
    crearEncargo(db, tenantId, {
      propietarioId: clienteId,
      productoId,
      descripcion: "Amoxicilina para Nina",
      cantidad: 20,
      anticipo: 6000,
      sesionId: sesionEnc.id,
      personaId: cajero,
    })
  );
  assert(!!encargo.anticipoId, "el encargo nace con su anticipo", encargo.anticipoId);
  const saldoTrasAnticipo = await conAlcanceTenant(tenantId, (db) =>
    saldoAFavor(db, deudorCliente(clienteId))
  );
  igual(saldoTrasAnticipo, 6000, "y los 6 000 quedan como saldo a favor del cliente");
  const sinComprobante = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM vta_anticipos
      WHERE id = $1 AND comprobante_id IS NOT NULL`,
    [encargo.anticipoId]
  );
  igual(sinComprobante.rows[0].n, "0", "el anticipo NO emite comprobante al recibirse");

  // Un anticipo es plata que entra a la gaveta: el arqueo TIENE que
  // contarlo. No contarlo era un defecto real (ver la migración 098):
  // el billete estaba en la caja y el arqueo decía que sobraba.
  const espEnc = await conAlcanceTenant(tenantId, (db) => esperadoDeSesion(db, sesionEnc.id));
  const efEnc = espEnc.find((e) => e.medio === "efectivo" && e.moneda === "CRC")!;
  igual(
    efEnc.esperado,
    11000,
    "el anticipo en efectivo entra al esperado de la caja: 5 000 de fondo + 6 000"
  );

  await debeFallar("registrar un anticipo sin sesión de caja", () =>
    conAlcanceTenant(tenantId, (db) =>
      crearEncargo(db, tenantId, {
        propietarioId: clienteId,
        descripcion: "Encargo sin caja",
        cantidad: 1,
        anticipo: 1000,
      })
    )
  );

  // --- Pedido al proveedor = orden de compra de verdad
  const pedido = await conAlcanceTenant(tenantId, (db) =>
    pedirAlProveedor(db, tenantId, encargo.id, {
      proveedorId,
      bodegaId,
      presentacionId: presCaja,
      costoUnitario: 4000,
      personaId: cajero,
    })
  );
  assert(!!pedido.ordenCompraId, "pedirlo crea la orden de compra", pedido.numeroOrden);
  const ligada = await pool.query<{ orden: string | null; estado: string }>(
    `SELECT orden_compra_id AS orden, estado FROM vta_encargos WHERE id = $1`,
    [encargo.id]
  );
  igual(
    [ligada.rows[0].orden === pedido.ordenCompraId, ligada.rows[0].estado],
    [true, "pedido"],
    "y la orden queda ligada al encargo: el pedido no se carga dos veces"
  );
  const lineaOrden = await pool.query<{ cantidad_pedida: string; producto: string }>(
    `SELECT l.cantidad_pedida, l.producto_id AS producto FROM inv_orden_compra_lineas l
      WHERE l.orden_id = $1`,
    [pedido.ordenCompraId]
  );
  igual(
    [Number(lineaOrden.rows[0].cantidad_pedida), lineaOrden.rows[0].producto === productoId],
    [20, true],
    "la orden pide las 20 del encargo, del producto del encargo"
  );

  await debeFallar("saltar de 'pedido' a 'pedido' otra vez", () =>
    conAlcanceTenant(tenantId, (db) => pedirAlProveedor(db, tenantId, encargo.id, {}))
  );

  // --- Llegó: reserva
  const recibido = await conAlcanceTenant(tenantId, (db) =>
    marcarRecibido(db, encargo.id, { bodegaId })
  );
  igual(recibido.reservado, 20, "al recibirlo se reservan las 20 unidades");

  const existenciaAntes = await pool.query<{ t: string }>(
    `SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE id = $1`,
    [recibido.loteId]
  );

  // --- Y lo reservado NO se le vende a otro
  await debeFallar("vender el stock reservado para el encargo", () =>
    conAlcanceTenant(tenantId, (db) =>
      registrarMovimiento(db, tenantId, {
        tipo: "venta",
        productoId,
        bodegaId,
        loteId: recibido.loteId,
        cantidadBase: Number(existenciaAntes.rows[0].t),
        personaId: cajero,
      })
    )
  );
  const intactoTrasIntento = await pool.query<{ t: string }>(
    `SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE id = $1`,
    [recibido.loteId]
  );
  igual(
    intactoTrasIntento.rows[0].t,
    existenciaAntes.rows[0].t,
    "y el intento no movió una sola unidad"
  );

  // Lo que NO está reservado sigue vendiéndose: la reserva aparta 20, no el lote.
  const libres = Number(existenciaAntes.rows[0].t) - 20;
  if (libres > 0) {
    const vendeLibre = await conAlcanceTenant(tenantId, (db) =>
      registrarMovimiento(db, tenantId, {
        tipo: "venta",
        productoId,
        bodegaId,
        loteId: recibido.loteId,
        cantidadBase: 1,
        personaId: cajero,
      })
    );
    assert(vendeLibre.length === 1, "lo NO reservado del mismo lote se sigue vendiendo");
  }

  await conAlcanceTenant(tenantId, (db) => marcarAvisado(db, encargo.id));
  const avisado = await pool.query<{ estado: string; avisado_en: Date | null }>(
    `SELECT estado, avisado_en FROM vta_encargos WHERE id = $1`,
    [encargo.id]
  );
  igual(
    [avisado.rows[0].estado, avisado.rows[0].avisado_en !== null],
    ["avisado", true],
    "avisar queda registrado con su fecha (el aviso automático llega con el CRM)"
  );

  // --- Entrega: descarga el lote reservado, cobra y aplica el anticipo
  const cuentaEnc = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesionEnc.id })
  );
  const antesDeEntregar = Number(
    (
      await pool.query<{ t: string }>(`SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE id = $1`, [
        recibido.loteId,
      ])
    ).rows[0].t
  );
  const entrega = await conAlcanceTenant(tenantId, (db) =>
    entregar(db, tenantId, encargo.id, {
      cuentaId: cuentaEnc.id,
      presentacionId: presTableta,
      precioUnitario: 500,
      bodegaId,
      personaId: cajero,
    })
  );
  const despuesDeEntregar = Number(
    (
      await pool.query<{ t: string }>(`SELECT sum(cantidad)::text AS t FROM inv_lotes WHERE id = $1`, [
        recibido.loteId,
      ])
    ).rows[0].t
  );
  igual(
    antesDeEntregar - despuesDeEntregar,
    20,
    "la entrega descarga las 20 del lote RESERVADO, no por FEFO"
  );
  igual(
    entrega.anticipoDisponible,
    6000,
    "y deja los 6 000 del anticipo listos para aplicar al cobrar"
  );
  const totEnc = await conAlcanceTenant(tenantId, (db) => totalDeCuenta(db, cuentaEnc.id));
  igual(totEnc.total, 11300, "la cuenta suma 11 300: 20 tabletas a 500 más el 13% de IVA");
  igual(
    totEnc.cobrado,
    0,
    "entregar NO cobra: el saldo a favor se descuenta al cobrar, no al entregar"
  );

  // El anticipo se aplica EN EL COBRO, que es donde queda el registro
  // que baja el saldo de la cuenta.
  const cobroEnc = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuentaEnc.id,
      sesionId: sesionEnc.id,
      tipoComprobante: "04",
      medios: [
        { medio: "anticipo", monto: 6000 },
        { medio: "01", monto: 5300 },
      ],
      personaId: cajero,
    })
  );
  igual(cobroEnc.total, 11300, "el cobro aplica los 11 300 entre el anticipo y el efectivo");
  const totEncFinal = await conAlcanceTenant(tenantId, (db) => totalDeCuenta(db, cuentaEnc.id));
  igual(totEncFinal.saldo, 0, "y la cuenta del encargo queda en cero");
  const reservaLiberada = await pool.query<{ reservada: string; estado: string }>(
    `SELECT cantidad_reservada AS reservada, estado FROM vta_encargos WHERE id = $1`,
    [encargo.id]
  );
  igual(
    [Number(reservaLiberada.rows[0].reservada), reservaLiberada.rows[0].estado],
    [0, "entregado"],
    "la reserva se libera al entregar: si sobreviviera, inmovilizaría stock que ya no está"
  );
  const saldoTrasEntrega = await conAlcanceTenant(tenantId, (db) => saldoAFavor(db, deudorCliente(clienteId)));
  igual(saldoTrasEntrega, 0, "y despues del cobro al cliente no le queda saldo a favor");

  await debeFallar("entregar dos veces el mismo encargo", () =>
    conAlcanceTenant(tenantId, (db) =>
      entregar(db, tenantId, encargo.id, { cuentaId: cuentaEnc.id, personaId: cajero })
    )
  );

  // --- Cancelar: libera la reserva y NO se come el anticipo
  const encargo2 = await conAlcanceTenant(tenantId, (db) =>
    crearEncargo(db, tenantId, {
      propietarioId: clienteId,
      productoId,
      descripcion: "Alimento renal que el proveedor discontinuó",
      cantidad: 2,
      anticipo: 3000,
      sesionId: sesionEnc.id,
      personaId: cajero,
    })
  );
  const cancelado = await conAlcanceTenant(tenantId, (db) =>
    cancelar(db, encargo2.id, "El proveedor lo discontinuó")
  );
  igual(
    cancelado.saldoAFavorDelCliente,
    3000,
    "cancelar NO se come el anticipo: queda como saldo a favor del cliente"
  );
  const estadoCancelado = await pool.query<{ estado: string; reservada: string }>(
    `SELECT estado, cantidad_reservada AS reservada FROM vta_encargos WHERE id = $1`,
    [encargo2.id]
  );
  igual(
    [estadoCancelado.rows[0].estado, Number(estadoCancelado.rows[0].reservada)],
    ["cancelado", 0],
    "y queda cancelado sin reserva"
  );
  await debeFallar("revivir un encargo cancelado", () =>
    conAlcanceTenant(tenantId, (db) => marcarRecibido(db, encargo2.id, { bodegaId }))
  );

  // La sesión se cierra para no dejar la caja abierta.
  const lineasEnc = (
    await conAlcanceTenant(tenantId, (db) => esperadoDeSesion(db, sesionEnc.id))
  ).map((e) => ({ medio: e.medio, moneda: e.moneda, declarado: e.esperado }));
  await conAlcanceTenant(tenantId, (db) =>
    cerrarSesion(db, tenantId, sesionEnc.id, { lineas: lineasEnc, personaId: cajero })
  );

  // -------------------------------------------------------------------
  console.log("\n=== 21. Factura en DÓLARES, con sus montos en dólares ===");
  const sesionUsd = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId, fondoCrc: 10000, personaId: cajero })
  );
  const cuentaUsd = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesionUsd.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuentaUsd.id,
      origen: "manual",
      descripcion: "Consulta para cliente que pide factura en dólares",
      cantidad: 1,
      precioUnitario: 52000,
      personaId: cajero,
      codigoCabys: "8351000000000",
      codigoTarifaIva: "04",
      unidadMedida: "Sp",
      lineaNegocio: "consulta",
    })
  );
  const totalUsd = await conAlcanceTenant(tenantId, (db) => totalDeCuenta(db, cuentaUsd.id));

  const cobroUsd = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuentaUsd.id,
      sesionId: sesionUsd.id,
      tipoComprobante: "01",
      monedaComprobante: "USD",
      receptor: {
        nombre: "Ana María Rodríguez Jiménez",
        identificacion: { tipo: "01", numero: "112345678" },
      },
      // Paga en colones una factura en dólares: son dos cosas
      // distintas y el sistema no las confunde.
      medios: [{ medio: "01", monto: totalUsd.total }],
      personaId: cajero,
    })
  );
  igual(cobroUsd.estadoComprobante, "aceptado", "la factura en dólares se emite y Hacienda la acepta");

  const enDolares = await pool.query<{
    moneda: string;
    tipo_cambio: string;
    total_comprobante: string;
  }>(
    `SELECT moneda, tipo_cambio, total_comprobante FROM fact_comprobantes WHERE id = $1`,
    [cobroUsd.comprobanteId]
  );
  igual(
    [enDolares.rows[0].moneda, Number(enDolares.rows[0].tipo_cambio)],
    ["USD", 520],
    "el comprobante queda en USD con el tipo de cambio del día guardado"
  );
  // 54 080 colones / 520 = 104 dólares. El total del comprobante tiene
  // que estar EN DÓLARES: si se hubiera dejado en colones, la factura
  // diría 54 080 dólares.
  const totalEnDolares = Number(enDolares.rows[0].total_comprobante);
  assert(
    Math.abs(totalEnDolares - totalUsd.total / 520) < 0.05,
    "y su total está en dólares, no en colones",
    { enElComprobante: totalEnDolares, esperado: totalUsd.total / 520 }
  );
  assert(
    totalEnDolares < 200,
    "control de sanidad: un total de tres cifras en dólares, no de cinco",
    totalEnDolares
  );

  // EL TIQUETE TÉRMICO DE UNA FACTURA EN DÓLARES — defecto encontrado
  // revisándolo en el navegador: el neto y el impuesto salían del
  // comprobante (en dólares) y el total, del cobro (en colones), así que
  // el tiquete decía «Venta neta ₡0,48 · TOTAL ₡282,50».
  const tiqueteUsd = await conAlcanceTenant(tenantId, (db) =>
    datosDeTiquete(db, cobroUsd.cobroId)
  );
  assert(
    Math.abs(Number(tiqueteUsd.cobro.total_venta_neta) - 52000) < 1,
    "el tiquete de una factura en dólares muestra el neto EN COLONES",
    {
      enElTiquete: Number(tiqueteUsd.cobro.total_venta_neta),
      enElComprobante: totalEnDolares,
    }
  );
  igual(
    tiqueteUsd.cobro.moneda_comprobante,
    "USD",
    "y dice en qué moneda se emitió, para que el cliente reconozca el monto en el portal"
  );

  const cobrada = await conAlcanceTenant(tenantId, (db) => totalDeCuenta(db, cuentaUsd.id));
  igual(
    cobrada.saldo,
    0,
    "la cuenta se cobró completa en colones aunque la factura sea en dólares"
  );

  const lineasEnUsd = await pool.query<{ xml: string }>(
    `SELECT convert_from(xml_firmado, 'UTF8') AS xml FROM fact_comprobantes WHERE id = $1`,
    [cobroUsd.comprobanteId]
  );
  assert(
    lineasEnUsd.rows[0].xml.includes("<CodigoMoneda>USD</CodigoMoneda>"),
    "el XML declara la moneda USD"
  );
  assert(
    !lineasEnUsd.rows[0].xml.includes("<TotalComprobante>54080"),
    "y NO lleva el monto en colones con la etiqueta de dólares"
  );

  const lineasUsd = (
    await conAlcanceTenant(tenantId, (db) => esperadoDeSesion(db, sesionUsd.id))
  ).map((e) => ({ medio: e.medio, moneda: e.moneda, declarado: e.esperado }));
  await conAlcanceTenant(tenantId, (db) =>
    cerrarSesion(db, tenantId, sesionUsd.id, { lineas: lineasUsd, personaId: cajero })
  );

  // -------------------------------------------------------------------
  console.log("\n=== 22. Los cinco reportes, con sus columnas ===");
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  for (const cual of [
    "ventas",
    "lineas-negocio",
    "arqueos",
    "aprobaciones",
    "por-cobrar",
  ] as const) {
    const r = await conAlcanceTenant(tenantId, (db) =>
      reporteDeVentas(db, cual, hace30, hoy)
    );
    assert(
      r.columnas.length > 0 && !!r.titulo,
      `el reporte "${cual}" tiene título y columnas`,
      `${r.filas.length} fila(s)`
    );
    // Toda columna declarada tiene que existir en las filas: una
    // columna que el SQL no devuelve sale vacía en el Excel y nadie lo
    // nota hasta que alguien suma esa columna.
    if (r.filas.length > 0) {
      const faltantes = r.columnas.filter((c) => !(c.clave in r.filas[0]));
      igual(
        faltantes.map((c) => c.clave),
        [],
        `y todas sus columnas existen en los datos de "${cual}"`
      );
    }
  }

  const ventas = await conAlcanceTenant(tenantId, (db) =>
    reporteDeVentas(db, "ventas", hace30, hoy)
  );
  assert(
    ventas.filas.length > 0 && ventas.filas.some((f) => Number(f.total) > 0),
    "el reporte de ventas trae los cobros del período con su total",
    ventas.filas.length
  );

  const porLinea = await conAlcanceTenant(tenantId, (db) =>
    reporteDeVentas(db, "lineas-negocio", hace30, hoy)
  );
  assert(
    porLinea.filas.length > 0,
    "el de líneas de negocio agrupa lo cobrado",
    porLinea.filas.map((f) => `${f.linea}:${f.neto}`)
  );

  const arqueos = await conAlcanceTenant(tenantId, (db) =>
    reporteDeVentas(db, "arqueos", hace30, hoy)
  );
  assert(
    arqueos.filas.length > 0,
    "el de arqueos trae las sesiones cerradas con su diferencia",
    arqueos.filas.length
  );

  const aprobaciones = await conAlcanceTenant(tenantId, (db) =>
    reporteDeVentas(db, "aprobaciones", hace30, hoy)
  );
  assert(
    aprobaciones.filas.length > 0,
    "el de aprobaciones trae lo pedido y lo resuelto",
    aprobaciones.filas.map((f) => `${f.tipo}:${f.estado}`)
  );

  // EL QUE TENÍA EL DEFECTO: cuentas por cobrar tiene que incluir a los
  // perfiles de facturación, no solo a los clientes.
  const perfilDeudor = await conAlcanceTenant(tenantId, (db) =>
    crearPerfil(db, tenantId, {
      nombre: "Empresa Deudora S.A.",
      tipoIdentificacion: "02",
      numeroIdentificacion: "3101000111",
      propietarioId: clienteId,
    })
  );
  await pool.query(
    `INSERT INTO vta_credito_cliente (perfil_id, tenant_id, habilitado, limite, plazo_dias)
     VALUES ($1,$2,true,500000,30)`,
    [perfilDeudor.id, tenantId]
  );
  const sesionEmpresa = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId, fondoCrc: 1000, personaId: cajero })
  );
  const cuentaEmpresa = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: clienteId, sesionId: sesionEmpresa.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuentaEmpresa.id,
      origen: "manual",
      descripcion: "Atención facturada a la empresa",
      cantidad: 1,
      precioUnitario: 40000,
      personaId: cajero,
      codigoCabys: "8351000000000",
      codigoTarifaIva: "04",
      unidadMedida: "Sp",
      lineaNegocio: "consulta",
    })
  );
  await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuentaEmpresa.id,
      sesionId: sesionEmpresa.id,
      tipoComprobante: "01",
      condicionVenta: "10",
      plazoCreditoDias: 30,
      eleccionReceptor: { modo: "perfil", perfilId: perfilDeudor.id },
      medios: [{ medio: "credito", monto: 41600 }],
      personaId: cajero,
    })
  );

  const porCobrar = await conAlcanceTenant(tenantId, (db) =>
    reporteDeVentas(db, "por-cobrar", hace30, hoy)
  );
  assert(
    porCobrar.filas.some(
      (f) => f.deudor === "Empresa Deudora S.A." && f.tipo_deudor === "perfil de facturación"
    ),
    "LA DEUDA DE UN PERFIL aparece en cuentas por cobrar (antes se perdía)",
    porCobrar.filas.map((f) => `${f.tipo_deudor}:${f.deudor}:${f.pendiente}`)
  );
  igual(
    porCobrar.ignoraPeriodo,
    true,
    "y el reporte dice que el saldo no depende del período"
  );

  const lineasEmpresa = (
    await conAlcanceTenant(tenantId, (db) => esperadoDeSesion(db, sesionEmpresa.id))
  ).map((e) => ({ medio: e.medio, moneda: e.moneda, declarado: e.esperado }));
  await conAlcanceTenant(tenantId, (db) =>
    cerrarSesion(db, tenantId, sesionEmpresa.id, { lineas: lineasEmpresa, personaId: cajero })
  );

  // -------------------------------------------------------------------
  console.log("\n=== 23. La exportación de un reporte es un archivo de verdad ===");
  const tablaVentas = await conAlcanceTenant(tenantId, (db) =>
    reporteDeVentas(db, "ventas", hace30, hoy)
  );
  const xlsx = aExcel({
    titulo: tablaVentas.titulo,
    subtitulo: `Del ${hace30} al ${hoy}`,
    columnas: tablaVentas.columnas,
    filas: tablaVentas.filas,
  });
  igual(
    xlsx.slice(0, 2).toString("hex"),
    "504b",
    "el .xlsx empieza con la firma PK de un zip"
  );
  const pdf = await aPdf({
    titulo: tablaVentas.titulo,
    columnas: tablaVentas.columnas,
    filas: tablaVentas.filas,
  });
  igual(pdf.slice(0, 4).toString(), "%PDF", "y el PDF con su firma %PDF");
  assert(xlsx.length > 2000 && pdf.length > 1000, "los dos con contenido", {
    xlsx: xlsx.length,
    pdf: pdf.length,
  });

  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLAS");
  if (!ok) process.exitCode = 1;
}

main()
  .then(async () => {
    await pool.end();
    await tenantPool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    await tenantPool.end().catch(() => undefined);
    process.exit(1);
  });
