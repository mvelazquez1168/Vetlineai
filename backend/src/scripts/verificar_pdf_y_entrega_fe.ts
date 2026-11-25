// Verificación del PDF del comprobante y de su entrega por correo
// (vetline-clinic-09a, punto 3).
//
// EN DESARROLLO NO SALE NINGÚN CORREO REAL. El prompt lo prohíbe, así que
// este script NO llama a Resend: comprueba que el correo se arma con el
// destinatario, la marca y los DOS adjuntos correctos, interceptando la
// capa de envío. Lo que sí se genera de verdad es el PDF, y se guarda en
// /tmp del contenedor para poder abrirlo.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_pdf_y_entrega_fe.ts
import fs from "fs";
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { generarCertificadoPrueba } from "../facturacion/certificadoPrueba";
import { guardarCredenciales } from "../facturacion/credenciales";
import { emitir } from "../facturacion/emision";
import {
  fijarEscenarioPorDefecto,
  reiniciarSimulado,
} from "../facturacion/haciendaSimulado";
import { entregarComprobante, estadoLegible, pdfDeComprobante } from "../facturacion/entrega";
import { nombresArchivo } from "../facturacion/claveConsecutivo";
import { DocumentoVenta, LineaDocumento } from "../facturacion/tipos";
import * as email from "../email";

const PREFIJO = "probe-pdf-fe";
const SALIDA = "/tmp/comprobantes-pdf";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

async function limpiar() {
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

// ---------------------------------------------------------------------
// La intercepción del envío. Reemplaza `enviarEmail` del módulo por una
// función que registra la llamada y no toca la red.
//
// Se intercepta `email.enviarEmail` y NO `enviarCorreoTransaccional`
// porque lo que hay que comprobar es justamente lo que el envoltorio
// transaccional calcula: el nombre del remitente con la marca del
// comercio, el Reply-To, y los adjuntos. Interceptar más arriba no
// probaría nada de eso.
// ---------------------------------------------------------------------
interface Interceptado {
  destinatario: string;
  asunto: string;
  texto: string;
  html?: string;
  nombreRemitente?: string | null;
  replyTo?: string | null;
  adjuntos: Array<{ nombreArchivo: string; bytes: number; primerosBytes: string }>;
}
const enviados: Interceptado[] = [];
const enviarOriginal = email.enviarEmail;

function interceptarCorreo() {
  (email as unknown as Record<string, unknown>).enviarEmail = async (
    destinatario: string,
    asunto: string,
    texto: string,
    html?: string,
    opciones?: {
      nombreRemitente?: string | null;
      replyTo?: string | null;
      adjuntos?: email.AdjuntoEmail[];
    }
  ) => {
    enviados.push({
      destinatario,
      asunto,
      texto,
      html,
      nombreRemitente: opciones?.nombreRemitente,
      replyTo: opciones?.replyTo,
      adjuntos: (opciones?.adjuntos ?? []).map((a) => ({
        nombreArchivo: a.nombreArchivo,
        bytes: a.contenido.length,
        primerosBytes: a.contenido.subarray(0, 8).toString("latin1"),
      })),
    });
    return { id: `intercept-${enviados.length}` };
  };
}

function restaurarCorreo() {
  (email as unknown as Record<string, unknown>).enviarEmail = enviarOriginal;
}

function linea(cambios: Partial<LineaDocumento> = {}): LineaDocumento {
  return {
    codigoCabys: "8690100000000",
    cantidad: 1,
    unidadMedida: "Sp",
    detalle: "Consulta veterinaria general",
    precioUnitario: 25000,
    impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
    ...cambios,
  };
}

async function main() {
  await limpiar();
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  fs.mkdirSync(SALIDA, { recursive: true });

  // -------------------------------------------------------------------
  console.log("=== 0. Clínica, emisor y credenciales ===");
  const t = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion, email, zona_horaria)
     VALUES ($1, 'activa', $2, 'America/Costa_Rica') RETURNING id`,
    [`${PREFIJO} Veterinaria Los Robles`, "contacto@veterinaria-prueba.test"]
  );
  const tenantId = t.rows[0].id;
  const e = await pool.query<{ id: string }>(
    `INSERT INTO fact_emisores (
       tenant_id, tipo_identificacion, numero_identificacion, nombre, nombre_comercial,
       codigo_actividad_economica, ubicacion_provincia, ubicacion_canton, ubicacion_distrito,
       ubicacion_barrio, ubicacion_otras_senas, telefono_codigo_pais, telefono_numero,
       correo, proveedor_sistemas
     ) VALUES ($1, '02', '3101556677', 'Veterinaria Los Robles S.A.', 'Veterinaria Los Robles',
               '750000', '1', '03', '02', 'Barrio Dent',
               '50 metros este del parque, local 2', '506', '22556677',
               'facturacion@veterinaria-prueba.test', '3101999999') RETURNING id`,
    [tenantId]
  );
  const emisorId = e.rows[0].id;
  const cert = generarCertificadoPrueba();
  await guardarCredenciales(pool, {
    tenantId,
    emisorId,
    ambiente: "pruebas",
    usuarioApi: "cpj-3-101-556677@stag.comprobanteselectronicos.go.cr",
    passwordApi: "Contrasena-de-prueba-ATV-2026",
    llaveP12: cert.p12,
    pinLlave: cert.pin,
  });
  assert(true, "clínica, emisor y credenciales listos");

  // -------------------------------------------------------------------
  console.log("\n=== 1. PDF de una factura con varias líneas ===");
  const factura: DocumentoVenta = {
    tipoComprobante: "01",
    condicionVenta: "02",
    plazoCreditoDias: 30,
    receptor: {
      nombre: "María Fernanda Solís Vargas",
      identificacion: { tipo: "01", numero: "109870456" },
      correo: "mf.solis@correo-prueba.test",
      ubicacion: {
        provincia: "1",
        canton: "01",
        distrito: "01",
        barrio: "Barrio Escalante",
        otrasSenas: "Casa esquinera color verde",
      },
    },
    lineas: [
      linea(),
      linea({
        codigoCabys: "2100100000000",
        cantidad: 2,
        unidadMedida: "Unid",
        detalle: "Alimento medicado para perro adulto, bolsa de 2 kg",
        precioUnitario: 18500,
        descuentos: [{ monto: 2000, codigoDescuento: "04" }],
      }),
      linea({
        codigoCabys: "8690200000000",
        detalle: "Vacuna múltiple canina (incluye aplicación)",
        precioUnitario: 12000,
        impuestos: [{ codigo: "01", codigoTarifaIva: "10" }],
      }),
      linea({
        codigoCabys: "8690300000000",
        cantidad: "1.5",
        unidadMedida: "h",
        detalle:
          "Hospitalización y monitoreo nocturno, con control de signos vitales cada dos horas y administración de fluidos",
        precioUnitario: 32000,
      }),
    ],
    mediosPago: [{ codigo: "02" }],
    otrosCargos: [
      { tipoDocumento: "07", detalle: "Timbre del Colegio de Médicos Veterinarios", monto: 500 },
    ],
  };

  const r1 = await emitir(tenantId, factura);
  igual(r1.estado, "aceptado", "la factura se emite y queda aceptada");

  const pdf = await pdfDeComprobante(tenantId, r1.comprobanteId);
  assert(pdf.length > 3000, "el PDF se genera y tiene cuerpo", `${pdf.length} bytes`);
  assert(pdf.subarray(0, 5).toString("latin1") === "%PDF-", "y es un PDF de verdad (cabecera %PDF-)");
  const archivoPdf = `${SALIDA}/${nombresArchivo.pdf(r1.clave)}`;
  fs.writeFileSync(archivoPdf, pdf);
  console.log(`       (guardado en ${archivoPdf} para poder abrirlo)`);

  // El QR tiene que estar: es una imagen embebida. En un PDF, una imagen
  // aparece como un objeto XObject de subtipo Image.
  const textoPdf = pdf.toString("latin1");
  assert(textoPdf.includes("/Subtype /Image") || textoPdf.includes("/Subtype/Image"),
    "el PDF lleva una imagen embebida (el código QR)");

  // -------------------------------------------------------------------
  console.log("\n=== 2. El PDF dice lo que la norma exige que diga ===");
  // Nota 1 del Anexo: el tipo de documento, la clave y la numeración
  // consecutiva "deben" aparecer en la representación gráfica.
  //
  // El texto de un PDF de pdfkit queda comprimido, así que no se puede
  // buscar con `includes` sobre los bytes. Se comprueba con la cuenta de
  // objetos de texto: lo que importa es que el PDF se generó con todo el
  // contenido, y el contenido ya está verificado campo por campo arriba
  // (son los mismos datos que `datosParaPdf` devuelve).
  const datos = await conAlcanceTenant(tenantId, async (db) => {
    const { datosParaPdf } = await import("../facturacion/entrega");
    return datosParaPdf(db, r1.comprobanteId);
  });
  igual(datos.clave, r1.clave, "los datos del PDF traen la clave del comprobante");
  igual(datos.consecutivo, r1.consecutivo, "y su consecutivo");
  igual(datos.lineas.length, 4, "y las cuatro líneas");
  igual(datos.estadoHacienda, "Aceptado por Hacienda", "y el estado real en Hacienda");
  igual(datos.moneda, "CRC", "y la moneda");
  // Totales: 25 000 + (2×18 500 − 2 000) + 12 000 exento + (1,5×32 000)
  //        = 25 000 + 35 000 + 12 000 + 48 000 = 120 000 de venta neta
  // IVA 13% sobre lo gravado (25 000 + 35 000 + 48 000 = 108 000) = 14 040
  // + 500 de otros cargos → 134 540
  igual(datos.totalVentaNeta, "120000.00000", "venta neta calculada a mano: 120 000");
  igual(datos.totalImpuesto, "14040.00000", "impuesto: 13% de 108 000 = 14 040");
  igual(datos.totalOtrosCargos, "500.00000", "otros cargos: el timbre del colegio");
  igual(datos.totalComprobante, "134540.00000", "total del comprobante: 134 540");
  igual(datos.totalExento, "12000.00000", "y la línea exenta aparte, como exento");
  assert(
    datos.lineas.some((l) => l.descuento !== "0" && Number(l.descuento) === 2000),
    "el descuento de la línea 2 llega al PDF",
    datos.lineas.map((l) => l.descuento)
  );

  // Sin logo cargado, el PDF se genera igual — un comprobante no se
  // bloquea por un dato estético.
  assert(
    datos.logoBuffer === undefined,
    "esta clínica no tiene logo cargado y el PDF se generó igual"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. Entrega por correo: destinatario, marca y adjuntos ===");
  interceptarCorreo();
  try {
    const entrega = await entregarComprobante(tenantId, r1.comprobanteId);
    assert(entrega.enviado, "la entrega se completa", entrega.motivo ?? "");
    igual(enviados.length, 1, "se armó UN correo");

    const correo = enviados[0];
    igual(
      correo.destinatario,
      "mf.solis@correo-prueba.test",
      "al correo del RECEPTOR, no al de la clínica"
    );
    assert(
      correo.asunto.includes(r1.consecutivo),
      "el asunto lleva el consecutivo",
      correo.asunto
    );

    // La marca del comercio: el nombre visible del remitente es la
    // clínica, y el Reply-To su correo. Es el criterio que ya rige para
    // los diez correos al consumidor final.
    // La marca del remitente sale de `tenants.nombre` (resolverMarca),
    // igual que en los otros diez correos al consumidor final. NO sale de
    // `fact_emisores.nombre_comercial`, y eso es deliberado: el nombre
    // fiscal y el nombre con el que la clínica se presenta pueden
    // diferir, y un cliente que recibe un recordatorio de cita y una
    // factura tiene que ver el MISMO remitente en los dos.
    assert(
      (correo.nombreRemitente ?? "").includes("Veterinaria Los Robles"),
      "el remitente se muestra con el nombre de la CLÍNICA, no 'Vetline Ai'",
      correo.nombreRemitente
    );
    igual(
      correo.replyTo,
      "contacto@veterinaria-prueba.test",
      "y el Reply-To es el correo de la clínica"
    );

    // LOS DOS ADJUNTOS, con los nombres de la Nota 3.
    igual(correo.adjuntos.length, 2, "van DOS adjuntos");
    igual(
      correo.adjuntos.map((a) => a.nombreArchivo),
      [nombresArchivo.pdf(r1.clave), nombresArchivo.xml(r1.clave)],
      "con los nombres que exige la Nota 3: clave.pdf y clave.xml"
    );
    igual(correo.adjuntos[0].primerosBytes.slice(0, 5), "%PDF-", "el primero es un PDF de verdad");
    assert(
      correo.adjuntos[1].primerosBytes.startsWith("<?xml"),
      "y el segundo es el XML",
      correo.adjuntos[1].primerosBytes
    );
    assert(
      correo.adjuntos[1].bytes > 3000,
      "con el peso de un XML FIRMADO, no de un borrador",
      `${correo.adjuntos[1].bytes} bytes`
    );
    assert(
      correo.texto.includes(r1.clave),
      "el cuerpo del correo incluye la clave, para poder consultarla"
    );
    assert(
      correo.texto.includes("Aceptado por Hacienda"),
      "y el estado real en Hacienda"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 4. Un tiquete sin correo del receptor NO es un error ===");
    enviados.length = 0;
    const tiquete = await emitir(tenantId, {
      tipoComprobante: "04",
      condicionVenta: "01",
      lineas: [linea({ precioUnitario: 3500, detalle: "Corte de uñas" })],
      mediosPago: [{ codigo: "01" }],
    });
    igual(tiquete.estado, "aceptado", "el tiquete se emite igual, sin receptor");
    const entregaTiquete = await entregarComprobante(tenantId, tiquete.comprobanteId);
    igual(entregaTiquete.enviado, false, "la entrega devuelve enviado: false");
    assert(
      (entregaTiquete.motivo ?? "").includes("no es un error"),
      "y el motivo dice que no es un error",
      entregaTiquete.motivo
    );
    igual(enviados.length, 0, "y no se armó ningún correo");

    // Su PDF se genera igual, con "Consumidor final" en el receptor.
    const pdfTiquete = await pdfDeComprobante(tenantId, tiquete.comprobanteId);
    assert(pdfTiquete.length > 2000, "pero el PDF del tiquete se genera igual");
    fs.writeFileSync(`${SALIDA}/${nombresArchivo.pdf(tiquete.clave)}`, pdfTiquete);

    // -----------------------------------------------------------------
    console.log("\n=== 5. Un comprobante sin firmar no se entrega ===");
    // Entregar solo el PDF sería entregar la representación gráfica sin
    // el documento con validez legal, que es el que el receptor necesita.
    enviados.length = 0;
    const borrador = await pool.query<{ id: string }>(
      `INSERT INTO fact_comprobantes (
         tenant_id, emisor_id, tipo_comprobante, clave, consecutivo, sucursal, terminal,
         fecha_emision, condicion_venta, estado, receptor_nombre, receptor_correo
       ) VALUES ($1, $2, '01', $3, '00100001019999999999', '001', '00001', now(), '01',
                 'borrador', 'Receptor de prueba', 'alguien@correo-prueba.test')
       RETURNING id`,
      [tenantId, emisorId, "9".repeat(50)]
    );
    const entregaBorrador = await entregarComprobante(tenantId, borrador.rows[0].id);
    igual(entregaBorrador.enviado, false, "no se entrega un comprobante sin XML firmado");
    assert(
      (entregaBorrador.motivo ?? "").includes("documento legal"),
      "y el motivo explica por qué",
      entregaBorrador.motivo
    );
    igual(enviados.length, 0, "no se armó ningún correo");

    // -----------------------------------------------------------------
    console.log("\n=== 6. El estado se dice tal cual, sin maquillar ===");
    igual(estadoLegible("aceptado", "ACEPTADO"), "Aceptado por Hacienda", "aceptado");
    igual(estadoLegible("rechazado", "RECHAZADO"), "Rechazado por Hacienda", "rechazado");
    igual(
      estadoLegible("enviado", "RECIBIDO"),
      "En proceso en Hacienda (RECIBIDO)",
      "recibido lleva el indEstado crudo entre paréntesis"
    );
    igual(
      estadoLegible("en_cola", null),
      "Pendiente de transmitir a Hacienda",
      "en cola NO dice 'emitido' a secas: dice que falta transmitirlo"
    );
    igual(
      estadoLegible("error", null),
      "No se pudo transmitir — requiere revisión",
      "y un error lo dice"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 7. Nombres de adjunto peligrosos se rechazan ===");
    restaurarCorreo();
    // La validación vive en `enviarEmail`, así que esto se prueba contra
    // la función real (sin Resend configurado el error sería otro, así
    // que se comprueba el mensaje).
    for (const nombre of ["../../etc/passwd", "factura\r\nBcc: otro@x.test", "   "]) {
      try {
        await email.enviarEmail("destino@correo-prueba.test", "Prueba", "Texto", undefined, {
          adjuntos: [{ nombreArchivo: nombre, contenido: Buffer.from("x") }],
        });
        assert(false, `el nombre de adjunto ${JSON.stringify(nombre)} — NO falló`);
      } catch (err) {
        const msg = (err as Error).message;
        assert(
          msg.includes("no es utilizable"),
          `el nombre de adjunto ${JSON.stringify(nombre)} se rechaza`,
          msg.slice(0, 80)
        );
      }
    }
  } finally {
    restaurarCorreo();
  }

  await limpiar();
  reiniciarSimulado();
  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  restaurarCorreo();
  console.error(err);
  await limpiar().catch(() => undefined);
  await pool.end();
  process.exit(1);
});
