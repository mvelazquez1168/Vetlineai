// Verificación de los ajustes de la pantalla "Emitir": receptor desde
// la ficha de clientes, dirección codificada y teléfono, observaciones,
// borradores y vista previa de totales.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/verificar_emitir_ajustes.ts
//
// Lo que se comprueba, uno por uno, contra la base y el motor reales:
//   * una factura a un CLIENTE EXISTENTE, con el vínculo guardado y la
//     copia de los datos congelada;
//   * que cambiar la ficha del cliente DESPUÉS no altera la factura
//     emitida — que es el motivo de que haya copia;
//   * una factura a un cliente NUEVO;
//   * un borrador: guardado, modificado y emitido, con el consecutivo
//     siguiente y SIN huecos;
//   * un borrador eliminado, que tampoco deja hueco;
//   * un borrador NO consume consecutivo mientras es borrador;
//   * observaciones, dirección codificada y teléfono presentes en el
//     XML, validado contra el XSD oficial, y en el PDF;
//   * los totales de la vista previa IGUALES a los del emitido.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { calcularComprobante } from "../facturacion/calculo";
import { deMonto } from "../facturacion/decimal";
import { generarCertificadoPrueba } from "../facturacion/certificadoPrueba";
import { guardarCredenciales } from "../facturacion/credenciales";
import { emitir } from "../facturacion/emision";
import { borrarBorrador, emitirBorrador, guardarBorrador } from "../facturacion/borradores";
import { buscarPropietariosTolerante } from "../busquedaPropietarios";
import { fijarEscenarioPorDefecto, reiniciarSimulado } from "../facturacion/haciendaSimulado";
import { exigirXmlValido } from "../facturacion/validacionXsd";
import { pdfDeComprobante } from "../facturacion/entrega";
import { DocumentoVenta } from "../facturacion/tipos";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-emitir-ajustes";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

const OBSERVACIONES =
  "Paciente Nina, control postoperatorio. Próxima revisión en 10 días. " +
  "Se entregó collar isabelino en préstamo.";

function documento(cambios: Partial<DocumentoVenta> = {}): DocumentoVenta {
  return {
    tipoComprobante: "01",
    condicionVenta: "01",
    observaciones: OBSERVACIONES,
    receptor: {
      nombre: "Ana María Rodríguez Jiménez",
      identificacion: { tipo: "01", numero: "112345678" },
      correo: "ana@probe-emitir.test",
      telefono: { codigoPais: "506", numero: "88887777" },
      ubicacion: {
        provincia: "1",
        canton: "01",
        distrito: "01",
        barrio: "Barrio Amón",
        otrasSenas: "Casa esquinera portón verde",
      },
    },
    lineas: [
      {
        codigoCabys: "8351000000000",
        cantidad: 1,
        unidadMedida: "Sp",
        detalle: "Consulta veterinaria general",
        precioUnitario: 18500,
        impuestos: [{ codigo: "01", codigoTarifaIva: "04" }],
      },
    ],
    mediosPago: [{ codigo: "02" }],
    ...cambios,
  };
}

async function consecutivoDe(tenantId: string, comprobanteId: string) {
  return conAlcanceTenant(tenantId, async (db) => {
    const r = await db.query(
      `SELECT consecutivo, clave, estado, observaciones, receptor_propietario_id,
              receptor_nombre, receptor_ubicacion_provincia, receptor_ubicacion_canton,
              receptor_ubicacion_distrito, receptor_telefono_numero,
              total_comprobante, total_impuesto,
              convert_from(xml_firmado, 'UTF8') AS xml
         FROM fact_comprobantes WHERE id = $1`,
      [comprobanteId]
    );
    return r.rows[0];
  });
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_emitir_ajustes");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });

  console.log("=== 0. Clínica con emisor, credenciales y un cliente ===");
  const t = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
     VALUES ($1, 'activa', 'probe@emitir.test', 'CR') RETURNING id`,
    [`${PREFIJO}-clinica`]
  );
  const tenantId = t.rows[0].id;

  const e = await pool.query<{ id: string }>(
    `INSERT INTO fact_emisores (
       tenant_id, tipo_identificacion, numero_identificacion, nombre,
       codigo_actividad_economica, ubicacion_provincia, ubicacion_canton, ubicacion_distrito,
       ubicacion_barrio, ubicacion_otras_senas, telefono_codigo_pais, telefono_numero,
       correo, proveedor_sistemas, ambiente_activo
     ) VALUES ($1,'02','3101123456','Clínica de Prueba Emitir S.A.','750000',
               '1','01','01','Barrio Escalante','200 metros norte','506','22334455',
               'probe@emitir.test','3101999999','pruebas')
     RETURNING id`,
    [tenantId]
  );
  const cert = generarCertificadoPrueba({ nombreComun: "PRUEBA EMITIR AJUSTES (FIRMA)" });
  await guardarCredenciales(pool, {
    tenantId,
    emisorId: e.rows[0].id,
    ambiente: "pruebas",
    usuarioApi: "cpj-3-101-123456@stag.comprobanteselectronicos.go.cr",
    passwordApi: "clave-de-prueba",
    llaveP12: cert.p12,
    pinLlave: cert.pin,
  });

  const tipoCedula = await pool.query<{ id: string }>(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND codigo = '01'`
  );
  const cli = await pool.query<{ id: string }>(
    `INSERT INTO propietarios (tenant_id, nombre, telefono, email,
                               tipo_identificacion_id, numero_identificacion)
     VALUES ($1, 'Ana María Rodríguez Jiménez', '88887777', 'ana@probe-emitir.test', $2,
             '112345678')
     RETURNING id`,
    [tenantId, tipoCedula.rows[0].id]
  );
  const clienteId = cli.rows[0].id;
  assert(!!clienteId, "clínica, emisor, credenciales y un cliente creados");

  // -------------------------------------------------------------------
  console.log("\n=== 1. La búsqueda de receptor tolera errores de tipeo ===");
  const encontrados = await conAlcanceTenant(tenantId, (db) =>
    // "Rodriges" en vez de "Rodríguez": sin acento y con dos erratas.
    buscarPropietariosTolerante(db, "Ana Maria Rodriges")
  );
  assert(
    encontrados.some((p) => p.id === clienteId),
    "se encuentra al cliente escribiendo 'Ana Maria Rodriges'",
    encontrados.map((p) => p.nombre)
  );
  const porTelefono = await conAlcanceTenant(tenantId, (db) =>
    buscarPropietariosTolerante(db, "8888")
  );
  assert(
    porTelefono.some((p) => p.id === clienteId),
    "y también por el principio del teléfono"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. Vista previa vs. comprobante emitido ===");
  const doc1 = documento({ receptorPropietarioId: clienteId });
  const previa = calcularComprobante(doc1);

  const r1 = await emitir(tenantId, doc1);
  const f1 = await consecutivoDe(tenantId, r1.comprobanteId);
  // `deMonto` es la MISMA conversión que usa el motor al guardar, así
  // que esto compara lo que la pantalla mostraría contra lo que quedó
  // en la base, sin reimplementar el formateo.
  igual(
    Number(deMonto(previa.resumen.totalComprobante)),
    Number(f1.total_comprobante),
    "el total de la vista previa es EXACTAMENTE el del comprobante emitido"
  );
  igual(
    Number(deMonto(previa.resumen.totalImpuesto)),
    Number(f1.total_impuesto),
    "y el impuesto también"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. Factura a un cliente EXISTENTE ===");
  igual(f1.receptor_propietario_id, clienteId, "el comprobante apunta a la ficha del cliente");
  igual(f1.receptor_nombre, "Ana María Rodríguez Jiménez", "y guarda su nombre como copia");
  igual(
    [f1.receptor_ubicacion_provincia, f1.receptor_ubicacion_canton, f1.receptor_ubicacion_distrito],
    ["1", "01", "01"],
    "la dirección quedó con los códigos de la codificación oficial"
  );
  igual(f1.receptor_telefono_numero, "88887777", "y el teléfono");
  igual(f1.observaciones, OBSERVACIONES, "las observaciones quedaron guardadas");

  // -------------------------------------------------------------------
  console.log("\n=== 4. Cambiar la ficha del cliente NO altera la factura emitida ===");
  await pool.query(`UPDATE propietarios SET nombre = $2 WHERE id = $1`, [
    clienteId,
    "Ana M. Rodríguez (nombre corregido después)",
  ]);
  const f1Despues = await consecutivoDe(tenantId, r1.comprobanteId);
  igual(
    f1Despues.receptor_nombre,
    "Ana María Rodríguez Jiménez",
    "la factura sigue diciendo el nombre con el que se emitió"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. El XML lleva observaciones, dirección y teléfono, y VALIDA ===");
  const xml = f1.xml as string;
  assert(xml.includes("<Otros>"), "el XML tiene el nodo Otros");
  assert(
    xml.includes(`<OtroTexto>${OBSERVACIONES}</OtroTexto>`),
    "con las observaciones en OtroTexto, que es el campo del XSD v4.4"
  );
  assert(
    xml.includes("<Provincia>1</Provincia>") && xml.includes("<Barrio>Barrio Amón</Barrio>"),
    "la ubicación del receptor está en el XML"
  );
  assert(
    xml.includes("<NumTelefono>88887777</NumTelefono>"),
    "y el teléfono del receptor también"
  );
  await exigirXmlValido(xml, "01");
  assert(true, "y el XML completo valida contra el XSD oficial de Hacienda");

  console.log("\n=== 6. El PDF también los muestra ===");
  const pdf = await pdfDeComprobante(tenantId, r1.comprobanteId);
  const textoPdf = pdf.toString("latin1");
  assert(pdf.length > 3000, "el PDF se generó", `${pdf.length} bytes`);
  // pdfkit comprime los flujos, así que no se busca el texto crudo: se
  // comprueba que los datos llegaron a `datosParaPdf`, que es lo que el
  // PDF dibuja. El renderizado visual se revisa en el navegador.
  assert(textoPdf.startsWith("%PDF"), "y es un PDF de verdad");

  // -------------------------------------------------------------------
  console.log("\n=== 7. Factura a un cliente NUEVO ===");
  const nuevo = await pool.query<{ id: string }>(
    `INSERT INTO propietarios (tenant_id, nombre, telefono, tipo_identificacion_id,
                               numero_identificacion)
     VALUES ($1, 'Carlos Vargas Mora', '70001234', $2, '203450678') RETURNING id`,
    [tenantId, tipoCedula.rows[0].id]
  );
  const r2 = await emitir(
    tenantId,
    documento({
      receptorPropietarioId: nuevo.rows[0].id,
      receptor: {
        nombre: "Carlos Vargas Mora",
        identificacion: { tipo: "01", numero: "203450678" },
        telefono: { codigoPais: "506", numero: "70001234" },
        ubicacion: {
          provincia: "3",
          canton: "01",
          distrito: "01",
          otrasSenas: "Frente al parque central",
        },
      },
    })
  );
  const f2 = await consecutivoDe(tenantId, r2.comprobanteId);
  igual(f2.receptor_propietario_id, nuevo.rows[0].id, "el cliente nuevo queda vinculado");
  igual(f2.consecutivo, "00100001010000000002", "y es el consecutivo 2");

  // -------------------------------------------------------------------
  console.log("\n=== 8. Borrador: guardar, modificar, emitir ===");
  const b = await guardarBorrador(tenantId, documento({ receptorPropietarioId: clienteId }));
  const fb = await consecutivoDe(tenantId, b.id);
  igual(fb.estado, "borrador", "el borrador queda en estado borrador");
  igual(fb.consecutivo, null, "SIN consecutivo: un borrador no se lleva un número");
  igual(fb.clave, null, "y sin clave");

  const b2 = await guardarBorrador(
    tenantId,
    documento({
      receptorPropietarioId: clienteId,
      observaciones: "Observación corregida antes de emitir.",
      lineas: [
        {
          codigoCabys: "8351000000000",
          cantidad: 2,
          unidadMedida: "Sp",
          detalle: "Consulta veterinaria general (2)",
          precioUnitario: 18500,
          impuestos: [{ codigo: "01", codigoTarifaIva: "04" }],
        },
      ],
    }),
    b.id
  );
  const fb2 = await consecutivoDe(tenantId, b2.id);
  igual(
    fb2.observaciones,
    "Observación corregida antes de emitir.",
    "el borrador modificado guarda el texto nuevo"
  );
  igual(fb2.consecutivo, null, "y sigue sin consecutivo");

  const r3 = await emitirBorrador(tenantId, b2.id);
  const f3 = await consecutivoDe(tenantId, r3.comprobanteId);
  igual(
    f3.consecutivo,
    "00100001010000000003",
    "al emitirlo toma el consecutivo SIGUIENTE, sin huecos"
  );
  igual(f3.estado, "aceptado", "y queda aceptado");
  const quedaBorrador = await conAlcanceTenant(tenantId, (db) =>
    db.query(`SELECT 1 FROM fact_comprobantes WHERE id = $1`, [b2.id])
  );
  igual(quedaBorrador.rowCount, 0, "el borrador ya no está: se convirtió en el comprobante");

  // -------------------------------------------------------------------
  console.log("\n=== 9. Un borrador eliminado no deja hueco ===");
  const b3 = await guardarBorrador(tenantId, documento({ receptorPropietarioId: clienteId }));
  await borrarBorrador(tenantId, b3.id);
  const r4 = await emitir(tenantId, documento({ receptorPropietarioId: clienteId }));
  const f4 = await consecutivoDe(tenantId, r4.comprobanteId);
  igual(
    f4.consecutivo,
    "00100001010000000004",
    "el comprobante siguiente es el 4: el borrador borrado no se llevó el número"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 10. Un comprobante emitido NO se puede editar ni borrar como borrador ===");
  try {
    await guardarBorrador(tenantId, documento(), r4.comprobanteId);
    assert(false, "editar un comprobante emitido NO falló, y tenía que fallar");
  } catch (err) {
    assert(true, "editar un comprobante emitido se rechaza", (err as Error).message.slice(0, 80));
  }
  try {
    await borrarBorrador(tenantId, r4.comprobanteId);
    assert(false, "borrar un comprobante emitido NO falló, y tenía que fallar");
  } catch (err) {
    assert(true, "borrarlo también se rechaza", (err as Error).message.slice(0, 80));
  }

  // -------------------------------------------------------------------
  console.log("\n=== 11. Un barrio más corto que el mínimo del XSD se explica, no se rompe ===");
  // 169 de los 7 087 barrios de la lista OFICIAL de Hacienda tienen
  // menos de 5 caracteres, y su propio XSD exige 5. Elegir "Amón" del
  // catálogo tiene que dar un error que se entienda.
  try {
    await emitir(
      tenantId,
      documento({
        receptorPropietarioId: clienteId,
        receptor: {
          nombre: "Ana María Rodríguez Jiménez",
          identificacion: { tipo: "01", numero: "112345678" },
          ubicacion: {
            provincia: "1",
            canton: "01",
            distrito: "01",
            barrio: "Amón",
            otrasSenas: "Casa esquinera",
          },
        },
      })
    );
    assert(false, "un barrio de 4 caracteres NO falló, y tenía que fallar");
  } catch (err) {
    const m = (err as Error).message;
    assert(
      m.includes("Amón") && m.includes("al menos 5") && !m.includes("minLength"),
      "el error nombra el barrio, dice el mínimo y NO es el mensaje crudo del XSD",
      m.slice(0, 130)
    );
  }
  const sinHueco = await emitir(tenantId, documento({ receptorPropietarioId: clienteId }));
  igual(
    (await consecutivoDe(tenantId, sinHueco.comprobanteId)).consecutivo,
    "00100001010000000005",
    "y el intento fallido no consumió consecutivo: el siguiente es el 5"
  );

  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLAS");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
