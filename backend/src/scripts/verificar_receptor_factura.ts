// Verificación de la sección 3 bis del prompt 08: EL RECEPTOR DE LA
// FACTURA NO ES NECESARIAMENTE EL DUEÑO.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_receptor_factura.ts
//
// Lo que se comprueba, todo contra la base y el motor reales con el
// proveedor SIMULADO de Hacienda:
//
//   * un perfil de facturación es una entidad propia, con su dirección
//     codificada, y NO aparece como cliente;
//   * un perfil sirve a varios clientes, y un cliente puede tener
//     varios perfiles con uno predeterminado;
//   * las cuatro opciones al emitir resuelven al receptor correcto;
//   * sin datos sale TIQUETE y no un error;
//   * la cuenta sigue siendo del DUEÑO aunque la factura salga a nombre
//     de la empresa;
//   * el comprobante guarda la COPIA congelada: cambiar el perfil
//     después no altera la factura emitida;
//   * en una venta a crédito el deudor es el RECEPTOR: el límite se
//     mira contra la empresa, la cuenta por cobrar es de la empresa y
//     el abono con su REP sale a nombre de la empresa;
//   * la búsqueda encuentra clientes y perfiles juntos, tolerando
//     errores de tipeo;
//   * RLS: el perfil de otra clínica no existe para esta.
import { pool, tenantPool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { generarCertificadoPrueba } from "../facturacion/certificadoPrueba";
import { guardarCredenciales } from "../facturacion/credenciales";
import { fijarEscenarioPorDefecto, reiniciarSimulado } from "../facturacion/haciendaSimulado";
import {
  buscarReceptoresPosibles,
  crearPerfil,
  editarPerfil,
  ligarACliente,
  listarPerfiles,
  perfilesDeCliente,
  resolverReceptor,
} from "../facturacion/perfilesFacturacion";
import { abrirSesion } from "../ventas/caja";
import { abrirCuenta, agregarCargo } from "../ventas/cuentas";
import { cobrar } from "../ventas/cobros";
import { cuentaCorriente, estadoDeCredito, registrarAbono } from "../ventas/credito";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-receptor";

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
let otroTenantId = "";
let cajaId = "";
let cajero = "";
let duenoId = "";
let dueno2Id = "";
let presentacionId = "";
let bodegaId = "";

async function clinicaConFacturador(nombre: string, correo: string): Promise<string> {
  const t = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
     VALUES ($1,'activa',$2,'CR') RETURNING id`,
    [nombre, correo]
  );
  const id = t.rows[0].id;
  const emisor = await pool.query<{ id: string }>(
    `INSERT INTO fact_emisores (tenant_id, tipo_identificacion, numero_identificacion, nombre,
                                codigo_actividad_economica, ubicacion_provincia, ubicacion_canton,
                                ubicacion_distrito, ubicacion_otras_senas, correo,
                                proveedor_sistemas, ambiente_activo)
     VALUES ($1,'02','3101555444','Clínica del Receptor S.A.','750000','1','01','01',
             '50 metros sur','probe@receptor.test','3101999999','pruebas') RETURNING id`,
    [id]
  );
  const cert = generarCertificadoPrueba({ nombreComun: "PRUEBA RECEPTOR (FIRMA)" });
  await guardarCredenciales(pool, {
    tenantId: id,
    emisorId: emisor.rows[0].id,
    ambiente: "pruebas",
    usuarioApi: "cpj-3-101-555444@stag.comprobanteselectronicos.go.cr",
    passwordApi: "clave",
    llaveP12: cert.p12,
    pinLlave: cert.pin,
  });
  return id;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_receptor_factura");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });

  console.log("=== 0. Clínica, dos dueños, un producto y una caja ===");
  tenantId = await clinicaConFacturador(`${PREFIJO}-clinica`, "probe@receptor.test");
  otroTenantId = await clinicaConFacturador(`${PREFIJO}-otra`, "otra@receptor.test");

  cajero = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico)
       VALUES ($1,'Cajero de prueba',$2,'x',true,false) RETURNING id`,
      [tenantId, `${PREFIJO}@probe.test`]
    )
  ).rows[0].id;

  const tipoCedula = await pool.query<{ id: string }>(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND codigo = '01' LIMIT 1`
  );
  duenoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, email, telefono, tipo_identificacion_id,
                                 numero_identificacion)
       VALUES ($1,'Mariana Soto Vargas','mariana@correo.test','88887777',$2,'108880999')
       RETURNING id`,
      [tenantId, tipoCedula.rows[0].id]
    )
  ).rows[0].id;
  dueno2Id = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, tipo_identificacion_id, numero_identificacion)
       VALUES ($1,'Carlos Jiménez Mora',$2,'205550111') RETURNING id`,
      [tenantId, tipoCedula.rows[0].id]
    )
  ).rows[0].id;

  bodegaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,'FARM','Farmacia',true) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  const productoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                  codigo_cabys, codigo_tarifa_iva)
       VALUES ($1,'AMOX','Amoxicilina','farmacia','tableta','3521100000000','08') RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  presentacionId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                       unidad_medida, precio_venta, para_venta)
       VALUES ($1,$2,'AMOX-TAB','Tableta',1,'Unid',1000,true) RETURNING id`,
      [tenantId, productoId]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO inv_lotes (tenant_id, producto_id, bodega_id, numero, cantidad, costo_unitario)
     VALUES ($1,$2,$3,'L-1',500,300)`,
    [tenantId, productoId, bodegaId]
  );
  cajaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO vta_cajas (tenant_id, nombre, bodega_id, terminal)
       VALUES ($1,'Caja receptor',$2,'00001') RETURNING id`,
      [tenantId, bodegaId]
    )
  ).rows[0].id;
  assert(!!duenoId && !!cajaId, "clínica, dueños, producto y caja");

  // -------------------------------------------------------------------
  console.log("\n=== 1. Un perfil de facturación es una entidad propia ===");
  const empresa = await conAlcanceTenant(tenantId, (db) =>
    crearPerfil(db, tenantId, {
      nombre: "Transportes del Valle S.A.",
      tipoIdentificacion: "02",
      numeroIdentificacion: "3101234567",
      ubicacionProvincia: "1",
      ubicacionCanton: "01",
      ubicacionDistrito: "01",
      ubicacionOtrasSenas: "Oficentro La Sabana, piso 3",
      correo: "pagos@transportesdelvalle.test",
      telefonoCodigoPais: "506",
      telefonoNumero: "22334455",
      propietarioId: duenoId,
      esPredeterminado: true,
    })
  );
  assert(!!empresa.id, "el perfil se crea con su dirección codificada", empresa.id);

  const comoCliente = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM propietarios
      WHERE tenant_id = $1 AND numero_identificacion = '3101234567'`,
    [tenantId]
  );
  igual(
    comoCliente.rows[0].n,
    "0",
    "y NO aparece como cliente: un perfil no tiene mascotas ni expediente"
  );

  await debeFallar("crear un perfil sin identificación", () =>
    conAlcanceTenant(tenantId, (db) =>
      crearPerfil(db, tenantId, {
        nombre: "Sin cédula S.A.",
        tipoIdentificacion: "",
        numeroIdentificacion: "",
      })
    )
  );
  await debeFallar("crear dos perfiles con la MISMA identificación", () =>
    conAlcanceTenant(tenantId, (db) =>
      crearPerfil(db, tenantId, {
        nombre: "Otro nombre, misma cédula",
        tipoIdentificacion: "02",
        numeroIdentificacion: "3101234567",
      })
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. Un perfil sirve a varios clientes; un cliente tiene varios perfiles ===");
  await conAlcanceTenant(tenantId, (db) =>
    ligarACliente(db, tenantId, empresa.id, dueno2Id, true)
  );
  const fundacion = await conAlcanceTenant(tenantId, (db) =>
    crearPerfil(db, tenantId, {
      nombre: "Fundación Patitas",
      tipoIdentificacion: "02",
      numeroIdentificacion: "3002888777",
      propietarioId: duenoId,
    })
  );

  const delDueno = await conAlcanceTenant(tenantId, (db) => perfilesDeCliente(db, duenoId));
  igual(delDueno.length, 2, "el dueño tiene dos perfiles");
  igual(
    delDueno[0].nombre,
    "Transportes del Valle S.A.",
    "y el predeterminado va primero, que es el que la caja propone"
  );
  const delOtro = await conAlcanceTenant(tenantId, (db) => perfilesDeCliente(db, dueno2Id));
  igual(
    delOtro.map((p) => p.nombre),
    ["Transportes del Valle S.A."],
    "la misma empresa sirve al segundo cliente"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. Las cuatro opciones resuelven al receptor correcto ===");
  const porDueno = await conAlcanceTenant(tenantId, (db) =>
    resolverReceptor(db, tenantId, { modo: "dueno", propietarioId: duenoId }, duenoId)
  );
  igual(
    [porDueno.receptor?.nombre, porDueno.receptor?.identificacion?.numero, porDueno.deudor],
    ["Mariana Soto Vargas", "108880999", { tipo: "cliente", id: duenoId }],
    "opción 1, el dueño: sus datos y él como deudor"
  );

  const porPerfil = await conAlcanceTenant(tenantId, (db) =>
    resolverReceptor(db, tenantId, { modo: "perfil", perfilId: empresa.id }, duenoId)
  );
  igual(
    [
      porPerfil.receptor?.nombre,
      porPerfil.receptor?.identificacion?.numero,
      porPerfil.receptor?.ubicacion?.provincia,
      porPerfil.propietarioId,
      porPerfil.deudor,
    ],
    [
      "Transportes del Valle S.A.",
      "3101234567",
      "1",
      duenoId,
      { tipo: "perfil", id: empresa.id },
    ],
    "opción 2, un perfil del cliente: la cuenta sigue siendo del dueño y el deudor es el perfil"
  );

  const porExistente = await conAlcanceTenant(tenantId, (db) =>
    resolverReceptor(db, tenantId, { modo: "existente", tipo: "perfil", id: fundacion.id }, duenoId)
  );
  igual(
    porExistente.receptor?.nombre,
    "Fundación Patitas",
    "opción 3, cualquiera de los dos buscado"
  );

  const porNuevo = await conAlcanceTenant(tenantId, (db) =>
    resolverReceptor(
      db,
      tenantId,
      {
        modo: "nuevo",
        guardar: true,
        datos: {
          nombre: "Clínica Amiga S.A.",
          tipoIdentificacion: "02",
          numeroIdentificacion: "3101777666",
          propietarioId: duenoId,
        },
      },
      duenoId
    )
  );
  assert(
    !!porNuevo.perfilId,
    "opción 4, uno nuevo guardado: queda como perfil del cliente",
    porNuevo.perfilId
  );
  const trasGuardar = await conAlcanceTenant(tenantId, (db) => perfilesDeCliente(db, duenoId));
  igual(trasGuardar.length, 3, "y el cliente pasa a tener tres perfiles");

  const sinGuardar = await conAlcanceTenant(tenantId, (db) =>
    resolverReceptor(
      db,
      tenantId,
      {
        modo: "nuevo",
        guardar: false,
        datos: {
          nombre: "Alguien de paso",
          tipoIdentificacion: "01",
          numeroIdentificacion: "109990888",
        },
      },
      duenoId
    )
  );
  igual(
    [sinGuardar.receptor?.nombre, sinGuardar.perfilId ?? null],
    ["Alguien de paso", null],
    "y sin guardar, los datos van al comprobante y a ningún otro lado"
  );

  const sinDatos = await conAlcanceTenant(tenantId, (db) =>
    resolverReceptor(db, tenantId, { modo: "sin_datos" }, duenoId)
  );
  igual(
    [sinDatos.receptor ?? null, sinDatos.faltantes],
    [null, []],
    "y sin datos no es un error: es un tiquete"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 4. Facturar a la empresa: la cuenta queda del dueño ===");
  const sesion = await conAlcanceTenant(tenantId, (db) =>
    abrirSesion(db, tenantId, { cajaId, fondoCrc: 50000, personaId: cajero })
  );
  const cuenta = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: duenoId, sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta.id,
      origen: "mostrador",
      presentacionId,
      cantidad: 10,
      bodegaId,
      personaId: cajero,
    })
  );

  const cobro = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuenta.id,
      sesionId: sesion.id,
      tipoComprobante: "01",
      eleccionReceptor: { modo: "perfil", perfilId: empresa.id },
      medios: [{ medio: "01", monto: 11300 }],
      personaId: cajero,
    })
  );
  igual(cobro.estadoComprobante, "aceptado", "la factura sale a nombre de la empresa");

  const emitido = await pool.query<{
    receptor_nombre: string;
    receptor_numero_identificacion: string;
    receptor_perfil_id: string | null;
    receptor_propietario_id: string | null;
    receptor_ubicacion_otras_senas: string | null;
  }>(
    `SELECT receptor_nombre, receptor_numero_identificacion, receptor_perfil_id,
            receptor_propietario_id, receptor_ubicacion_otras_senas
       FROM fact_comprobantes WHERE id = $1`,
    [cobro.comprobanteId]
  );
  igual(
    [
      emitido.rows[0].receptor_nombre,
      emitido.rows[0].receptor_numero_identificacion,
      emitido.rows[0].receptor_perfil_id === empresa.id,
      emitido.rows[0].receptor_ubicacion_otras_senas,
    ],
    ["Transportes del Valle S.A.", "3101234567", true, "Oficentro La Sabana, piso 3"],
    "el comprobante guarda el nombre, la identificación, la dirección y de qué perfil salieron"
  );

  const deQuienEsLaCuenta = await pool.query<{ propietario_id: string }>(
    `SELECT propietario_id FROM vta_cuentas WHERE id = $1`,
    [cuenta.id]
  );
  igual(
    deQuienEsLaCuenta.rows[0].propietario_id,
    duenoId,
    "y LA CUENTA sigue siendo del dueño, no de la empresa"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. La copia es congelada: cambiar el perfil no cambia la factura ===");
  await conAlcanceTenant(tenantId, (db) =>
    editarPerfil(db, tenantId, empresa.id, {
      nombre: "Transportes del Valle Sociedad Anónima",
      ubicacionOtrasSenas: "Se mudaron a Escazú",
    })
  );
  const trasCambiar = await pool.query<{ receptor_nombre: string; senas: string | null }>(
    `SELECT receptor_nombre, receptor_ubicacion_otras_senas AS senas
       FROM fact_comprobantes WHERE id = $1`,
    [cobro.comprobanteId]
  );
  igual(
    [trasCambiar.rows[0].receptor_nombre, trasCambiar.rows[0].senas],
    ["Transportes del Valle S.A.", "Oficentro La Sabana, piso 3"],
    "la factura emitida quedó como estaba"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 6. A crédito, el deudor es el RECEPTOR ===");
  await pool.query(
    `INSERT INTO vta_credito_cliente (perfil_id, tenant_id, habilitado, limite, plazo_dias)
     VALUES ($1,$2,true,100000,30)`,
    [empresa.id, tenantId]
  );
  const creditoEmpresa = await conAlcanceTenant(tenantId, (db) =>
    estadoDeCredito(db, { tipo: "perfil", id: empresa.id })
  );
  igual(
    [creditoEmpresa.habilitado, creditoEmpresa.limite],
    [true, 100000],
    "la empresa tiene el crédito, con su límite"
  );
  const creditoDueno = await conAlcanceTenant(tenantId, (db) =>
    estadoDeCredito(db, { tipo: "cliente", id: duenoId })
  );
  igual(
    creditoDueno.habilitado,
    false,
    "y el dueño NO: el crédito es de quien debe, no de quien trae la mascota"
  );

  const cuenta2 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { propietarioId: duenoId, sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta2.id,
      origen: "mostrador",
      presentacionId,
      cantidad: 20,
      bodegaId,
      personaId: cajero,
    })
  );
  const aCredito = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuenta2.id,
      sesionId: sesion.id,
      tipoComprobante: "01",
      condicionVenta: "10",
      plazoCreditoDias: 30,
      eleccionReceptor: { modo: "perfil", perfilId: empresa.id },
      medios: [{ medio: "credito", monto: 22600 }],
      personaId: cajero,
    })
  );
  igual(aCredito.estadoComprobante, "aceptado", "la venta a crédito se emite a la empresa");

  const ccEmpresa = await conAlcanceTenant(tenantId, (db) =>
    cuentaCorriente(db, { tipo: "perfil", id: empresa.id })
  );
  igual(
    ccEmpresa.facturas.length,
    1,
    "la cuenta por cobrar está en la cuenta corriente de LA EMPRESA"
  );
  const ccDueno = await conAlcanceTenant(tenantId, (db) =>
    cuentaCorriente(db, { tipo: "cliente", id: duenoId })
  );
  igual(
    ccDueno.facturas.length,
    0,
    "y NO en la del dueño: cobrarle a él sería cobrarle a quien no debe"
  );

  const abono = await conAlcanceTenant(tenantId, (db) =>
    registrarAbono(db, tenantId, {
      deudor: { tipo: "perfil", id: empresa.id },
      sesionId: sesion.id,
      aplicaciones: [{ comprobanteId: aCredito.comprobanteId!, monto: 10000 }],
      medios: [{ codigo: "01", monto: 10000 }],
      personaId: cajero,
    })
  );
  igual(abono.repEstado, "aceptado", "el abono emite su Recibo Electrónico de Pago");
  const repDe = await pool.query<{ receptor_nombre: string; perfil: string | null }>(
    `SELECT receptor_nombre, receptor_perfil_id AS perfil FROM fact_comprobantes WHERE id = $1`,
    [abono.repId]
  );
  igual(
    [repDe.rows[0].receptor_nombre, repDe.rows[0].perfil === empresa.id],
    ["Transportes del Valle Sociedad Anónima", true],
    "y el REP sale a nombre de la EMPRESA, que es quien paga"
  );

  const trasAbonar = await conAlcanceTenant(tenantId, (db) =>
    estadoDeCredito(db, { tipo: "perfil", id: empresa.id })
  );
  igual(trasAbonar.usado, 12600, "el crédito usado baja con el abono: 22 600 − 10 000");

  // -------------------------------------------------------------------
  console.log("\n=== 7. Sin datos, tiquete ===");
  const cuenta3 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta3.id,
      origen: "mostrador",
      presentacionId,
      cantidad: 1,
      bodegaId,
      personaId: cajero,
    })
  );
  const tiquete = await conAlcanceTenant(tenantId, (db) =>
    cobrar(db, tenantId, {
      cuentaId: cuenta3.id,
      sesionId: sesion.id,
      eleccionReceptor: { modo: "sin_datos" },
      medios: [{ medio: "01", monto: 1130 }],
      personaId: cajero,
    })
  );
  const tipoEmitido = await pool.query<{ tipo_comprobante: string }>(
    `SELECT tipo_comprobante FROM fact_comprobantes WHERE id = $1`,
    [tiquete.comprobanteId]
  );
  igual(tipoEmitido.rows[0].tipo_comprobante, "04", "sin receptor sale tiquete, no un error");

  const cuenta4 = await conAlcanceTenant(tenantId, (db) =>
    abrirCuenta(db, tenantId, { sesionId: sesion.id })
  );
  await conAlcanceTenant(tenantId, (db) =>
    agregarCargo(db, tenantId, {
      cuentaId: cuenta4.id,
      origen: "mostrador",
      presentacionId,
      cantidad: 1,
      bodegaId,
      personaId: cajero,
    })
  );
  await debeFallar("pedir FACTURA sin identificación del receptor", () =>
    conAlcanceTenant(tenantId, (db) =>
      cobrar(db, tenantId, {
        cuentaId: cuenta4.id,
        sesionId: sesion.id,
        tipoComprobante: "01",
        eleccionReceptor: { modo: "sin_datos" },
        medios: [{ medio: "01", monto: 1130 }],
        personaId: cajero,
      })
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 8. La búsqueda trae clientes Y perfiles, tolerando el tipeo ===");
  const porNombre = await conAlcanceTenant(tenantId, (db) =>
    buscarReceptoresPosibles(db, tenantId, "transportes", 10)
  );
  assert(
    porNombre.some((r) => r.tipo === "perfil" && r.nombre.startsWith("Transportes")),
    "un perfil aparece buscando por su razón social",
    porNombre.map((r) => `${r.tipo}:${r.nombre}`)
  );

  const conTipeoMalo = await conAlcanceTenant(tenantId, (db) =>
    buscarReceptoresPosibles(db, tenantId, "mariena soto", 10)
  );
  assert(
    conTipeoMalo.some((r) => r.tipo === "cliente" && r.nombre.includes("Mariana")),
    "y un cliente aparece con el nombre mal tipeado (trigramas)",
    conTipeoMalo.map((r) => r.nombre)
  );

  const porCedula = await conAlcanceTenant(tenantId, (db) =>
    buscarReceptoresPosibles(db, tenantId, "3002888", 10)
  );
  assert(
    porCedula.some((r) => r.nombre === "Fundación Patitas"),
    "y por el prefijo de la cédula jurídica"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 9. RLS: el perfil de otra clínica no existe para esta ===");
  const ajeno = await conAlcanceTenant(otroTenantId, (db) =>
    crearPerfil(db, otroTenantId, {
      nombre: "Perfil de la otra clínica",
      tipoIdentificacion: "02",
      numeroIdentificacion: "3109999888",
    })
  );
  const visibles = await conAlcanceTenant(tenantId, (db) => listarPerfiles(db, tenantId));
  assert(
    !visibles.some((p) => p.id === ajeno.id),
    "no aparece en el listado",
    visibles.map((p) => p.nombre)
  );
  await debeFallar("resolver el receptor con el perfil de otra clínica", () =>
    conAlcanceTenant(tenantId, (db) =>
      resolverReceptor(db, tenantId, { modo: "perfil", perfilId: ajeno.id })
    )
  );
  await debeFallar("editar el perfil de otra clínica", () =>
    conAlcanceTenant(tenantId, (db) =>
      editarPerfil(db, tenantId, ajeno.id, { nombre: "Secuestrado" })
    )
  );

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
