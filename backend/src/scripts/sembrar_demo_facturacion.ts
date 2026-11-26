// Siembra de datos de DEMOSTRACIÓN del facturador electrónico de Costa
// Rica, para poder mirar las cinco pantallas con contenido real.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/sembrar_demo_facturacion.ts <tenantId>
//
// Qué deja cargado, todo con el proveedor SIMULADO de Hacienda:
//
//   * un emisor de prueba con credenciales FICTICIAS (usuario ATV de
//     stag, contraseña inventada y un .p12 autofirmado que no sirve
//     contra Hacienda — ver certificadoPrueba.ts);
//   * una factura ACEPTADA;
//   * un tiquete electrónico aceptado, sin receptor identificado;
//   * una factura RECHAZADA, con el motivo tal cual lo devolvió Hacienda;
//   * una factura EN CONTINGENCIA (Hacienda no contestó, quedó en cola);
//   * una nota de crédito que corrige el monto de la factura aceptada;
//   * un comprobante RECIBIDO de un proveedor.
//
// Por qué pasa por `emitir()`/`emitirNota()`/`recibirComprobante()` y no
// por INSERTs: los estados que se quieren mostrar (clave de 50, firma
// XAdES, consecutivo, eventos, respuesta de Hacienda) los produce el
// motor. Un INSERT los inventaría, y la pantalla mostraría datos que el
// código nunca produciría.
//
// NO manda correos: la entrega al receptor la dispara la RUTA
// (`entregarComprobante` en facturacionCr.routes.ts), no `emitir()`. Acá
// se llama al motor directo, así que Resend no se toca.
//
// Volver a correrlo NO duplica nada: si la clínica ya tiene
// comprobantes, el script informa y se va sin tocar nada.
//
// Y no es que "todavía no se implementó el borrado": un comprobante
// enviado a Hacienda NO SE BORRA, y eso lo impone un trigger de la
// migración 091 (regla 1, `fact_impedir_borrado_enviado`). La única vía
// soportada para dejar la clínica limpia es la purga completa del
// tenant, donde la cascada sí puede. Un script de demostración no es
// motivo para debilitar esa regla.
import { pool } from "../db";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { conAlcanceTenant } from "../alcanceTenant";
import { config } from "../config";
import { generarCertificadoPrueba } from "../facturacion/certificadoPrueba";
import { guardarCredenciales } from "../facturacion/credenciales";
import { emitir } from "../facturacion/emision";
import { emitirNota } from "../facturacion/notas";
import { recibirComprobante } from "../facturacion/recibidos";
import {
  fijarEscenarioPorDefecto,
  reiniciarSimulado,
} from "../facturacion/haciendaSimulado";
import { proveedorHaciendaActivo } from "../facturacion/proveedorActivo";
import { haciendaSimulado } from "../facturacion/haciendaSimulado";
import { DocumentoVenta } from "../facturacion/tipos";

/** El proveedor del XML recibido. Se crea, se usa y se borra. */
const NOMBRE_PROVEEDOR_TEMPORAL = "demo-fe-proveedor-temporal";

/**
 * Códigos CABYS reales, del catálogo del Banco Central ya cargado en
 * `fact_cat_cabys`. No son de relleno a propósito: el código decide la
 * tarifa de IVA, y un código inventado haría que los totales de la
 * pantalla no se parezcan a los de una clínica de verdad.
 */
const CABYS = {
  consulta: "8351000000000", // Servicios veterinarios para animales domésticos (4%)
  vacuna: "3564012000000", // Vacunas, de uso veterinario (13%)
  alimento: "2331100000200", // Comida para perros y gatos, venta al por menor (13%)
};

function paso(titulo: string) {
  console.log(`\n=== ${titulo} ===`);
}

/**
 * ¿Se puede sembrar, o ya está sembrado?
 *
 * Devuelve `false` cuando la clínica ya tiene comprobantes. NO los
 * borra: la migración 091 prohíbe borrar un comprobante que salió para
 * Hacienda, y es una regla que existe justamente para que nada
 * —tampoco un script de demostración— pueda hacer desaparecer la
 * constancia de lo que se emitió.
 *
 * Si quedó un emisor a medio sembrar (sin comprobantes, porque una
 * corrida anterior falló), eso sí se limpia: ahí no hay nada que
 * proteger.
 */
async function sePuedeSembrar(tenantId: string): Promise<boolean> {
  const c = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM fact_comprobantes WHERE tenant_id = $1`,
    [tenantId]
  );
  if (Number(c.rows[0].n) > 0) return false;

  // Restos de una corrida incompleta. Orden explícito en vez de confiar
  // en el ON DELETE del emisor: si mañana una tabla deja de colgar del
  // emisor, esto falla en vez de dejar basura.
  await pool.query(`DELETE FROM fact_recibidos WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM fact_consecutivos WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM fact_credenciales WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM fact_emisores WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM tenants WHERE nombre = $1`, [NOMBRE_PROVEEDOR_TEMPORAL]);
  return true;
}

async function contarLoSembrado(tenantId: string) {
  const r = await pool.query(
    `SELECT tipo_comprobante, consecutivo, estado, total_comprobante,
            coalesce(receptor_nombre, '(consumidor final)') AS receptor
       FROM fact_comprobantes WHERE tenant_id = $1
      ORDER BY consecutivo`,
    [tenantId]
  );
  return r.rows;
}

interface DatosEmisor {
  tipoIdentificacion: string;
  numeroIdentificacion: string;
  nombre: string;
  nombreComercial: string;
  correo: string;
  otrasSenas: string;
}

async function crearEmisorConCredenciales(
  tenantId: string,
  datos: DatosEmisor,
  nombreComunCertificado: string
): Promise<string> {
  const e = await pool.query<{ id: string }>(
    `INSERT INTO fact_emisores (
       tenant_id, tipo_identificacion, numero_identificacion, nombre, nombre_comercial,
       codigo_actividad_economica, ubicacion_provincia, ubicacion_canton, ubicacion_distrito,
       ubicacion_barrio, ubicacion_otras_senas, telefono_codigo_pais, telefono_numero,
       correo, proveedor_sistemas, ambiente_activo
     ) VALUES ($1, $2, $3, $4, $5,
               '750000', '1', '01', '01',
               'Barrio Escalante', $6, '506', '22551010',
               $7, $8, 'pruebas')
     RETURNING id`,
    [
      tenantId,
      datos.tipoIdentificacion,
      datos.numeroIdentificacion,
      datos.nombre,
      datos.nombreComercial,
      datos.otrasSenas,
      datos.correo,
      config.feCrProveedorSistemas ?? "3101999999",
    ]
  );
  const emisorId = e.rows[0].id;

  // Credenciales FICTICIAS. El .p12 es autofirmado: la firma XAdES se
  // construye y se verifica, y Hacienda lo rechazaría — que es
  // exactamente lo que tiene que pasar con una llave de demostración.
  const cert = generarCertificadoPrueba({ nombreComun: nombreComunCertificado });
  const guardada = await guardarCredenciales(pool, {
    tenantId,
    emisorId,
    ambiente: "pruebas",
    usuarioApi: `cpj-${datos.numeroIdentificacion.replace(
      /^(\d)(\d{3})(\d{6})$/,
      "$1-$2-$3"
    )}@stag.comprobanteselectronicos.go.cr`,
    passwordApi: "ATV-PRUEBAS-FICTICIA-NoEsUnaClaveReal-2026",
    llaveP12: cert.p12,
    pinLlave: cert.pin,
    llaveNombreArchivo: "llave-demostracion-ficticia.p12",
  });
  console.log(
    `  emisor ${datos.nombre} — usuario API ${guardada.publica.usuarioApi}, ` +
      `llave vence ${guardada.publica.llaveVenceEn}`
  );
  return emisorId;
}

async function main() {
  exigirEntornoDeDesarrollo("sembrar_demo_facturacion");

  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error(
      "Uso: npx ts-node --transpile-only src/scripts/sembrar_demo_facturacion.ts <tenantId>"
    );
    process.exit(1);
  }

  // Cortafuegos. Este script emite comprobantes; si el ambiente está
  // apuntando al proveedor REAL, saldrían hacia los servidores de
  // Hacienda con una llave autofirmada. Mejor no arrancar.
  if (proveedorHaciendaActivo() !== haciendaSimulado) {
    console.error(
      "FE_CR_PROVEEDOR no es 'simulado'. Este script siembra datos de demostración y " +
        "no debe correr contra los servidores de Hacienda. Abortado."
    );
    process.exit(1);
  }

  const t = await pool.query<{ nombre: string; pais_codigo: string }>(
    `SELECT nombre, pais_codigo FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (t.rows.length === 0) {
    console.error(`No existe ninguna clínica con el id ${tenantId}.`);
    process.exit(1);
  }
  console.log(`Clínica: ${t.rows[0].nombre} (${t.rows[0].pais_codigo}) — ${tenantId}`);

  reiniciarSimulado();

  if (!(await sePuedeSembrar(tenantId))) {
    console.log("");
    console.log("Esta clínica YA tiene comprobantes. No se siembra nada y no se borra nada:");
    console.log("un comprobante enviado a Hacienda no se borra (migración 091, regla 1).");
    console.log("Para empezar de cero hay que purgar la clínica entera.");
    console.log("");
    console.table(await contarLoSembrado(tenantId));
    return;
  }

  // -------------------------------------------------------------------
  paso("1. Emisor de prueba con credenciales ficticias");
  await crearEmisorConCredenciales(
    tenantId,
    {
      tipoIdentificacion: "02",
      numeroIdentificacion: "3101456789",
      nombre: "Clínica Veterinaria Demo Vetline S.A.",
      nombreComercial: "Vetline Clinic — Demostración",
      correo: "facturacion@demo-vetline.invalid",
      otrasSenas: "150 metros norte del Parque Francia, local 3",
    },
    "DEMOSTRACION VETLINE CLINIC (FIRMA) - NO VALIDA ANTE HACIENDA"
  );

  // -------------------------------------------------------------------
  paso("2. Factura ACEPTADA");
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const factura: DocumentoVenta = {
    tipoComprobante: "01",
    condicionVenta: "01",
    receptor: {
      nombre: "Ana María Rodríguez Jiménez",
      identificacion: { tipo: "01", numero: "112345678" },
      correo: "ana.rodriguez@demo-vetline.invalid",
    },
    lineas: [
      {
        codigoCabys: CABYS.consulta,
        cantidad: 1,
        unidadMedida: "Sp",
        detalle: "Consulta veterinaria general — Nina (canino, mestiza)",
        precioUnitario: 18500,
        impuestos: [{ codigo: "01", codigoTarifaIva: "04" }],
      },
      {
        codigoCabys: CABYS.vacuna,
        cantidad: 1,
        unidadMedida: "Unid",
        detalle: "Vacuna antirrábica",
        precioUnitario: 9800,
        impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
      },
    ],
    mediosPago: [{ codigo: "02" }],
  };
  const rFactura = await emitir(tenantId, factura);
  console.log(`  ${rFactura.consecutivo} — ${rFactura.estado} (${rFactura.indEstado})`);

  // -------------------------------------------------------------------
  paso("3. Tiquete electrónico (consumidor final)");
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const rTiquete = await emitir(tenantId, {
    tipoComprobante: "04",
    condicionVenta: "01",
    lineas: [
      {
        codigoCabys: CABYS.alimento,
        cantidad: 2,
        unidadMedida: "Unid",
        detalle: "Alimento seco para perro adulto, 2 kg",
        precioUnitario: 12500,
        impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
      },
    ],
    mediosPago: [{ codigo: "01" }],
  });
  console.log(`  ${rTiquete.consecutivo} — ${rTiquete.estado} (${rTiquete.indEstado})`);

  // -------------------------------------------------------------------
  paso("4. Factura RECHAZADA, con el motivo de Hacienda");
  const MOTIVO_RECHAZO =
    "Rechazado. El receptor indicado no se encuentra inscrito ante la Administración " +
    "Tributaria con el tipo de identificación declarado (validación 092).";
  fijarEscenarioPorDefecto({ escenario: "rechaza", motivo: MOTIVO_RECHAZO });
  const rRechazada = await emitir(tenantId, {
    tipoComprobante: "01",
    condicionVenta: "02",
    plazoCreditoDias: 30,
    receptor: {
      nombre: "Refugio Patitas Felices",
      identificacion: { tipo: "02", numero: "3002888777" },
      correo: "administracion@demo-patitas.invalid",
    },
    lineas: [
      {
        codigoCabys: CABYS.consulta,
        cantidad: 4,
        unidadMedida: "Sp",
        detalle: "Jornada de castración — 4 pacientes",
        precioUnitario: 32000,
        impuestos: [{ codigo: "01", codigoTarifaIva: "04" }],
      },
    ],
    mediosPago: [{ codigo: "04" }],
  });
  console.log(`  ${rRechazada.consecutivo} — ${rRechazada.estado}: ${rRechazada.detalle}`);

  // -------------------------------------------------------------------
  paso("5. Factura EN CONTINGENCIA (Hacienda no contestó)");
  fijarEscenarioPorDefecto({ escenario: "sin_respuesta" });
  const rContingencia = await emitir(tenantId, {
    tipoComprobante: "01",
    condicionVenta: "01",
    receptor: {
      nombre: "Luis Fernando Castro Mora",
      identificacion: { tipo: "01", numero: "203450678" },
      correo: "luis.castro@demo-vetline.invalid",
    },
    lineas: [
      {
        codigoCabys: CABYS.consulta,
        cantidad: 1,
        unidadMedida: "Sp",
        detalle: "Control postoperatorio — Rocco (canino, labrador)",
        precioUnitario: 15000,
        impuestos: [{ codigo: "01", codigoTarifaIva: "04" }],
      },
    ],
    mediosPago: [{ codigo: "06" }],
  });
  console.log(`  ${rContingencia.consecutivo} — ${rContingencia.estado} (quedó en cola)`);

  // El job `facturacionCola.job` corre cada minuto DENTRO del backend, y
  // ahí el simulado tiene su escenario por defecto ("acepta"): los
  // escenarios se programan en memoria y esa memoria es la de ESTE
  // proceso, no la del backend. Sin esto, la fila en contingencia se
  // resolvería sola en menos de un minuto y la pantalla perdería el
  // estado que se quiere mostrar. Se corre el próximo reintento, que es
  // el único campo que decide si el job la toma.
  await pool.query(
    `UPDATE fact_comprobantes
        SET proximo_intento_en = now() + interval '30 days'
      WHERE id = $1`,
    [rContingencia.comprobanteId]
  );
  console.log("  próximo reintento corrido a +30 días para que el job no la resuelva sola");

  // -------------------------------------------------------------------
  paso("6. Nota de crédito que corrige la factura aceptada");
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const rNota = await emitirNota(tenantId, rFactura.comprobanteId, {
    tipo: "credito",
    codigoReferencia: "02", // Corrige monto
    razon:
      "Corrección de monto: la vacuna antirrábica se facturó a ₡9.800 y la tarifa " +
      "vigente es ₡7.800. Se acredita la diferencia.",
    lineas: [
      {
        codigoCabys: CABYS.vacuna,
        cantidad: 1,
        unidadMedida: "Unid",
        detalle: "Ajuste de precio — vacuna antirrábica cobrada de más",
        precioUnitario: 2000,
        impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
      },
    ],
  });
  console.log(
    `  ${rNota.consecutivo} — ${rNota.estado}, referencia a ${rFactura.consecutivo}`
  );

  // -------------------------------------------------------------------
  paso("7. Comprobante RECIBIDO de un proveedor");
  // El XML tiene que ser un comprobante v4.4 de verdad, firmado y que
  // valide contra el XSD: se emite desde una clínica proveedora temporal
  // y se carga el XML que salió de ahí. Armarlo a mano daría un XML que
  // la pantalla mostraría como inválido.
  const tp = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
     VALUES ($1, 'activa', 'proveedor@demo-vetline.invalid', 'CR') RETURNING id`,
    [NOMBRE_PROVEEDOR_TEMPORAL]
  );
  const proveedorTenantId = tp.rows[0].id;

  await crearEmisorConCredenciales(
    proveedorTenantId,
    {
      tipoIdentificacion: "02",
      numeroIdentificacion: "3101222333",
      nombre: "Droguería Veterinaria del Valle S.A.",
      nombreComercial: "Drovet del Valle",
      correo: "facturacion@demo-drovet.invalid",
      otrasSenas: "Zona Industrial de Pavas, bodega 14",
    },
    "DEMOSTRACION DROVET (FIRMA) - NO VALIDA ANTE HACIENDA"
  );

  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const rProveedor = await emitir(proveedorTenantId, {
    tipoComprobante: "01",
    condicionVenta: "02",
    plazoCreditoDias: 30,
    receptor: {
      nombre: "Clínica Veterinaria Demo Vetline S.A.",
      identificacion: { tipo: "02", numero: "3101456789" },
      correo: "facturacion@demo-vetline.invalid",
    },
    lineas: [
      {
        codigoCabys: CABYS.vacuna,
        cantidad: 20,
        unidadMedida: "Unid",
        detalle: "Vacuna antirrábica canina, caja de 20 dosis",
        precioUnitario: 4100,
        impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
      },
      {
        codigoCabys: CABYS.alimento,
        cantidad: 10,
        unidadMedida: "Unid",
        detalle: "Alimento seco para perro adulto, 2 kg",
        precioUnitario: 8900,
        impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
      },
    ],
    mediosPago: [{ codigo: "04" }],
  });

  const xmlProveedor = await conAlcanceTenant(proveedorTenantId, async (db) => {
    const r = await db.query<{ xml_firmado: Buffer }>(
      `SELECT xml_firmado FROM fact_comprobantes WHERE id = $1`,
      [rProveedor.comprobanteId]
    );
    return r.rows[0].xml_firmado.toString("utf-8");
  });

  const recibido = await conAlcanceTenant(tenantId, async (db) => {
    const e = await db.query<{ id: string }>(
      `SELECT id FROM fact_emisores WHERE tenant_id = $1`,
      [tenantId]
    );
    return recibirComprobante(db, tenantId, e.rows[0].id, xmlProveedor);
  });
  console.log(
    `  recibido ${recibido.clave} de ${recibido.emisorNombre} — ` +
      `total ${recibido.total}, valida contra el XSD: ${recibido.validacionOk}`
  );

  // La clínica proveedora era un andamio: el XML ya está guardado en
  // `fact_recibidos` de la clínica demo, que no depende de ella.
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [proveedorTenantId]);
  console.log("  clínica proveedora temporal eliminada");

  // -------------------------------------------------------------------
  paso("Resumen de lo que quedó en la clínica");
  const resumen = await pool.query(
    `SELECT tipo_comprobante, consecutivo, estado, total_comprobante,
            coalesce(receptor_nombre, '(consumidor final)') AS receptor
       FROM fact_comprobantes WHERE tenant_id = $1
      ORDER BY consecutivo`,
    [tenantId]
  );
  console.table(resumen.rows);
  const recibidos = await pool.query(
    `SELECT emisor_nombre, consecutivo, total_comprobante, validacion_ok, mensaje_tipo, mensaje_ind_estado
       FROM fact_recibidos WHERE tenant_id = $1`,
    [tenantId]
  );
  console.table(recibidos.rows);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
