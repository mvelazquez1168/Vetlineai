// Verificación del flujo de emisión completo con el proveedor SIMULADO
// (vetline-clinic-09a, puntos 2 y "Verificación").
//
// Lo que el prompt pide y este script comprueba:
//   * aceptado;
//   * rechazado con motivo, guardado tal cual;
//   * demora con respuesta posterior;
//   * sin respuesta → contingencia → reintento → aceptado, SIN envío
//     duplicado;
//   * dos emisiones simultáneas no repiten consecutivo;
//   * la misma clave de idempotencia devuelve el mismo comprobante.
//
// Y además, porque es lo que distingue este motor de uno que "parece
// funcionar": que lo que se le manda a Hacienda sea el XML FIRMADO, que
// la cola sea idempotente, y que la corrección de un enviado sea una
// nota y no una edición.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_emision_facturacion.ts
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { generarCertificadoPrueba } from "../facturacion/certificadoPrueba";
import { guardarCredenciales, leerCredencialPublica } from "../facturacion/credenciales";
import { emitir, intentarEnviar } from "../facturacion/emision";
import { emitirNota } from "../facturacion/notas";
import {
  fijarEscenarioPorDefecto,
  inspeccionar,
  reiniciarSimulado,
} from "../facturacion/haciendaSimulado";
import { ejecutarColaFacturacion } from "../jobs/facturacionCola.job";
import { verificarFirma } from "../facturacion/firma";
import { DocumentoVenta, LineaDocumento } from "../facturacion/tipos";

const PREFIJO = "probe-emision-fe";

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
    assert(true, `${descripcion} — rechazado`, (err as Error).message.slice(0, 130));
  }
}

async function limpiar() {
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

function linea(cambios: Partial<LineaDocumento> = {}): LineaDocumento {
  return {
    codigoCabys: "8690100000000",
    cantidad: 1,
    unidadMedida: "Sp",
    detalle: "Consulta veterinaria general",
    precioUnitario: 10000,
    impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
    ...cambios,
  };
}

function documento(cambios: Partial<DocumentoVenta> = {}): DocumentoVenta {
  return {
    tipoComprobante: "01",
    condicionVenta: "01",
    receptor: {
      nombre: "Ana María Rodríguez Jiménez",
      identificacion: { tipo: "01", numero: "112345678" },
      correo: "ana.rodriguez@correo-prueba.test",
    },
    lineas: [linea()],
    mediosPago: [{ codigo: "06" }],
    ...cambios,
  };
}

/** Lee el estado de un comprobante y su historia de eventos. */
async function estadoDe(tenantId: string, comprobanteId: string) {
  return conAlcanceTenant(tenantId, async (db) => {
    const c = await db.query(
      `SELECT estado, clave, consecutivo, intentos_envio, proximo_intento_en,
              respuesta_ind_estado, respuesta_detalle,
              (xml_firmado IS NOT NULL) AS tiene_xml,
              (respuesta_xml IS NOT NULL) AS tiene_respuesta,
              octet_length(xml_firmado) AS bytes_xml
         FROM fact_comprobantes WHERE id = $1`,
      [comprobanteId]
    );
    const e = await db.query(
      `SELECT tipo_evento FROM fact_comprobante_eventos
        WHERE comprobante_id = $1 ORDER BY creado_en, id`,
      [comprobanteId]
    );
    return { ...c.rows[0], eventos: e.rows.map((f) => f.tipo_evento) };
  });
}

async function main() {
  await limpiar();
  reiniciarSimulado();

  // -------------------------------------------------------------------
  console.log("=== 0. Preparar una clínica con emisor y credenciales ===");
  const t = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion, email) VALUES ($1, 'activa', $2) RETURNING id`,
    [`${PREFIJO}-clinica`, "clinica@prueba-fe.test"]
  );
  const tenantId = t.rows[0].id;

  const e = await pool.query<{ id: string }>(
    `INSERT INTO fact_emisores (
       tenant_id, tipo_identificacion, numero_identificacion, nombre, nombre_comercial,
       codigo_actividad_economica, ubicacion_provincia, ubicacion_canton, ubicacion_distrito,
       ubicacion_barrio, ubicacion_otras_senas, telefono_codigo_pais, telefono_numero,
       correo, proveedor_sistemas, ambiente_activo
     ) VALUES ($1, '02', '3101123456', 'Clínica Veterinaria de Prueba S.A.', 'Vetline Demo',
               '750000', '1', '01', '01', 'Barrio Escalante',
               '200 metros norte de la iglesia', '506', '22334455',
               'facturacion@prueba-fe.test', '3101999999', 'pruebas')
     RETURNING id`,
    [tenantId]
  );
  const emisorId = e.rows[0].id;
  assert(!!emisorId, "emisor creado");

  const cert = generarCertificadoPrueba({ nombreComun: "PRUEBA EMISION VETLINE (FIRMA)" });
  const guardada = await guardarCredenciales(pool, {
    tenantId,
    emisorId,
    ambiente: "pruebas",
    usuarioApi: "cpj-3-101-123456@stag.comprobanteselectronicos.go.cr",
    passwordApi: "Contrasena-ATV-de-prueba-2026!",
    llaveP12: cert.p12,
    pinLlave: cert.pin,
    llaveNombreArchivo: "llave-prueba.p12",
  });
  assert(
    guardada.publica.usuarioApi.startsWith("cpj-3-101-123456@"),
    "credenciales guardadas; el usuario de la API sí se puede ver"
  );
  assert(
    guardada.publica.llaveVenceEn === "2028-01-01",
    "y la fecha de vencimiento se leyó del propio certificado, no se recibió",
    guardada.publica.llaveVenceEn
  );
  // Lo que la parte pública NUNCA trae.
  const publica = await leerCredencialPublica(pool, emisorId, "pruebas");
  const camposPublicos = Object.keys(publica ?? {}).join(",");
  assert(
    !/password|p12|pin|cifrad/i.test(camposPublicos),
    "la credencial pública no tiene ningún campo de secreto",
    camposPublicos
  );

  // -------------------------------------------------------------------
  console.log("\n=== 1. Camino feliz: Hacienda acepta ===");
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const r1 = await emitir(tenantId, documento());
  igual(r1.estado, "aceptado", "el comprobante queda ACEPTADO");
  igual(r1.indEstado, "ACEPTADO", "con el indEstado crudo de Hacienda");
  assert(r1.clave.length === 50, "con su clave de 50 dígitos", r1.clave);
  igual(r1.consecutivo, "00100001010000000001", "y el primer consecutivo de la clínica");

  const est1 = await estadoDe(tenantId, r1.comprobanteId);
  assert(est1.tiene_xml, "el XML firmado quedó guardado", `${est1.bytes_xml} bytes`);
  assert(est1.tiene_respuesta, "y la respuesta de Hacienda también");
  igual(
    est1.eventos,
    ["creado", "firmado", "enviado", "respuesta_recibida"],
    "la historia de eventos cuenta los cuatro pasos"
  );

  // Lo que se le mandó a Hacienda TIENE que ser el XML firmado, no el
  // borrador. Es la clase de defecto que no se nota nunca: Hacienda
  // rechazaría por falta de firma y el motor diría "rechazado" sin más.
  const enviadoAlSimulado = inspeccionar(r1.clave)?.xmlRecibido;
  assert(!!enviadoAlSimulado, "el proveedor recibió un XML");
  const firmaDelEnviado = await verificarFirma(enviadoAlSimulado!);
  assert(
    firmaDelEnviado.valida,
    "y ese XML está FIRMADO y su firma se verifica",
    firmaDelEnviado.motivo ?? ""
  );
  assert(
    enviadoAlSimulado!.includes(r1.clave),
    "y es el del comprobante correcto (lleva su clave)"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. Rechazo: el motivo se guarda tal cual ===");
  const MOTIVO =
    "El código CABYS indicado no corresponde con el servicio facturado (validación 108).";
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "rechaza", motivo: MOTIVO });
  const r2 = await emitir(tenantId, documento());
  igual(r2.estado, "rechazado", "el comprobante queda RECHAZADO");
  igual(r2.indEstado, "RECHAZADO", "con el indEstado crudo");
  igual(r2.detalle, MOTIVO, "y el motivo EXACTO que devolvió Hacienda, sin reescribir");
  const est2 = await estadoDe(tenantId, r2.comprobanteId);
  igual(est2.respuesta_detalle, MOTIVO, "guardado así en la base");
  assert(est2.tiene_respuesta, "con el XML de respuesta completo guardado");

  // Un rechazado NO se corrige con una nota: se corrige con un
  // comprobante nuevo. Hacienda no tiene el rechazado, así que no hay
  // nada que ajustar.
  await debeFallar("emitir una nota de crédito contra un comprobante RECHAZADO", () =>
    emitirNota(tenantId, r2.comprobanteId, {
      tipo: "credito",
      codigoReferencia: "01",
      razon: "Intento de corregir un rechazado",
    })
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. Demora: Hacienda responde después ===");
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "demora", vueltas: 2 });
  const r3 = await emitir(tenantId, documento());
  igual(r3.estado, "enviado", "tras emitir queda ENVIADO, sin veredicto todavía");
  igual(r3.indEstado, "RECIBIDO", "con el indEstado 'RECIBIDO' de Hacienda");

  const est3a = await estadoDe(tenantId, r3.comprobanteId);
  assert(!!est3a.proximo_intento_en, "y con un próximo intento agendado");

  // La cola lo vuelve a consultar. Primera vuelta: sigue RECIBIDO.
  await adelantarReintento(tenantId, r3.comprobanteId);
  const c1 = await ejecutarColaFacturacion(pool);
  assert(c1.procesados >= 1, "la cola lo procesa", c1);
  const est3b = await estadoDe(tenantId, r3.comprobanteId);
  igual(est3b.estado, "enviado", "sigue ENVIADO en la segunda consulta");

  // Segunda vuelta: ahora sí resuelve.
  await adelantarReintento(tenantId, r3.comprobanteId);
  await ejecutarColaFacturacion(pool);
  const est3c = await estadoDe(tenantId, r3.comprobanteId);
  igual(est3c.estado, "aceptado", "en la tercera consulta queda ACEPTADO");
  // Y, lo importante: NUNCA se envió dos veces.
  igual(inspeccionar(r3.clave)?.intentos, 1, "el comprobante se envió UNA sola vez");
  igual(inspeccionar(r3.clave)?.consultas, 3, "y se consultó tres veces");

  // -------------------------------------------------------------------
  console.log("\n=== 4. Contingencia: sin respuesta → reintento → aceptado ===");
  reiniciarSimulado();
  // Los dos primeros envíos no obtienen respuesta; el tercero entra.
  fijarEscenarioPorDefecto({ escenario: "sin_respuesta_luego_acepta", vueltas: 2 });
  const r4 = await emitir(tenantId, documento());
  igual(r4.estado, "en_cola", "si Hacienda no responde, el comprobante queda EN COLA");
  assert(r4.clave.length === 50, "LA VENTA NO SE BLOQUEA: la clave ya existe", r4.clave);

  const est4a = await estadoDe(tenantId, r4.comprobanteId);
  assert(est4a.tiene_xml, "y el XML ya está FIRMADO, esperando transmisión");
  igual(est4a.intentos_envio, 1, "con un intento registrado");
  assert(est4a.eventos.includes("contingencia"), "y un evento de contingencia", est4a.eventos);

  // Primer reintento de la cola: tampoco hay respuesta.
  await adelantarReintento(tenantId, r4.comprobanteId);
  await ejecutarColaFacturacion(pool);
  const est4b = await estadoDe(tenantId, r4.comprobanteId);
  igual(est4b.estado, "en_cola", "el primer reintento tampoco obtiene respuesta");
  igual(est4b.intentos_envio, 2, "y queda registrado como segundo intento");

  // Segundo reintento: ahora entra y Hacienda acepta.
  await adelantarReintento(tenantId, r4.comprobanteId);
  await ejecutarColaFacturacion(pool);
  const est4c = await estadoDe(tenantId, r4.comprobanteId);
  igual(est4c.estado, "aceptado", "el segundo reintento entra y queda ACEPTADO");
  igual(
    inspeccionar(r4.clave)?.intentos,
    3,
    "se intentó enviar tres veces (dos sin respuesta + la que entró)"
  );

  // SIN ENVÍO DUPLICADO: correr la cola otra vez no lo vuelve a mandar.
  const intentosAntes = inspeccionar(r4.clave)?.intentos;
  await adelantarReintento(tenantId, r4.comprobanteId);
  await ejecutarColaFacturacion(pool);
  igual(
    inspeccionar(r4.clave)?.intentos,
    intentosAntes,
    "correr la cola de nuevo NO lo vuelve a enviar (es idempotente)"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. Sin respuesta nunca: se agota y queda para revisar ===");
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "sin_respuesta" });
  const r5 = await emitir(tenantId, documento());
  igual(r5.estado, "en_cola", "primer intento: en cola");
  // Siete intentos es el tope (ESPERA_REINTENTOS_MIN). Después queda en
  // 'error' para que alguien lo mire, no reintentando para siempre.
  //
  // El bucle corta EN CUANTO llega a 'error' y no da vueltas fijas: la
  // primera versión daba 8 vueltas y en cada una adelantaba el reloj, así
  // que el propio verificador volvía a armar el `proximo_intento_en`
  // DESPUÉS de que el motor lo había puesto en NULL — y la aserción
  // fallaba por culpa de la prueba, no del código.
  let est5 = await estadoDe(tenantId, r5.comprobanteId);
  for (let i = 0; i < 10 && est5.estado !== "error"; i++) {
    await adelantarReintento(tenantId, r5.comprobanteId);
    await ejecutarColaFacturacion(pool);
    est5 = await estadoDe(tenantId, r5.comprobanteId);
  }
  igual(est5.estado, "error", "tras agotar los reintentos queda en ERROR, no reintentando sin fin");
  igual(est5.intentos_envio, 7, "con los siete intentos registrados");
  assert(
    est5.proximo_intento_en === null,
    "y sin próximo intento: deja de intentarse solo",
    est5.proximo_intento_en
  );
  assert(est5.tiene_xml, "pero el XML firmado sigue guardado: se puede reenviar a mano");

  // Reenviar a mano funciona, si Hacienda ya responde.
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const reenvio = await intentarEnviar(tenantId, r5.comprobanteId);
  igual(reenvio.estado, "aceptado", "el reenvío manual lo deja ACEPTADO");

  // -------------------------------------------------------------------
  console.log("\n=== 6. Idempotencia: la misma solicitud no emite dos veces ===");
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const CLAVE_IDEM = "venta-caja-2026-11-25-0042";
  const a = await emitir(tenantId, documento({ claveIdempotencia: CLAVE_IDEM }));
  const b = await emitir(tenantId, documento({ claveIdempotencia: CLAVE_IDEM }));
  igual(b.comprobanteId, a.comprobanteId, "la segunda llamada devuelve EL MISMO comprobante");
  igual(b.clave, a.clave, "con la misma clave");
  igual(b.yaExistia, true, "y avisa que ya existía");
  const cuantos = await conAlcanceTenant(tenantId, (db) =>
    db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fact_comprobantes WHERE clave_idempotencia = $1`,
      [CLAVE_IDEM]
    )
  );
  igual(cuantos.rows[0].n, "1", "hay UN solo comprobante con esa clave de idempotencia");

  // Sin clave de idempotencia, dos llamadas son dos comprobantes: es lo
  // correcto cuando quien emite es una persona apretando un botón.
  const s1 = await emitir(tenantId, documento());
  const s2 = await emitir(tenantId, documento());
  assert(s1.comprobanteId !== s2.comprobanteId, "sin clave de idempotencia, son dos comprobantes");

  // -------------------------------------------------------------------
  console.log("\n=== 7. Dos emisiones simultáneas no repiten consecutivo ===");
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const simultaneas = await Promise.all(
    Array.from({ length: 8 }, () => emitir(tenantId, documento()))
  );
  const consecutivos = simultaneas.map((r) => r.consecutivo);
  const claves = simultaneas.map((r) => r.clave);
  igual(new Set(consecutivos).size, 8, "8 emisiones simultáneas dan 8 consecutivos distintos");
  igual(new Set(claves).size, 8, "y 8 claves distintas");
  assert(
    consecutivos.every((c) => c.startsWith("0010000101")),
    "todos con el prefijo de sucursal, terminal y tipo correcto"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 8. Nota de crédito contra un comprobante aceptado ===");
  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });
  const original = await emitir(tenantId, documento());
  igual(original.estado, "aceptado", "el original queda aceptado");

  const nota = await emitirNota(tenantId, original.comprobanteId, {
    tipo: "credito",
    // Nota 9, código 01: anula el documento de referencia.
    codigoReferencia: "01",
    razon: "Anulación por error en el monto facturado",
  });
  igual(nota.estado, "aceptado", "la nota de crédito se emite y queda aceptada");
  assert(
    nota.consecutivo.startsWith("0010000103"),
    "con su propio consecutivo, de la serie del tipo 03",
    nota.consecutivo
  );

  const vinculo = await conAlcanceTenant(tenantId, (db) =>
    db.query<{ ref: string | null; numero: string }>(
      `SELECT c.comprobante_referencia_id AS ref, r.numero
         FROM fact_comprobantes c
         JOIN fact_comprobante_referencias r ON r.comprobante_id = c.id
        WHERE c.id = $1`,
      [nota.comprobanteId]
    )
  );
  igual(vinculo.rows[0].numero, original.clave, "la referencia del XML apunta a la clave original");
  igual(
    vinculo.rows[0].ref,
    original.comprobanteId,
    "y el atajo interno apunta al comprobante original"
  );

  // Y el original sigue intacto: no se editó para "anularlo".
  const estOriginal = await estadoDe(tenantId, original.comprobanteId);
  igual(estOriginal.estado, "aceptado", "el comprobante original NO cambió de estado");
  await debeFallar("editar el total del comprobante original aceptado", () =>
    conAlcanceTenant(tenantId, (db) =>
      db.query(`UPDATE fact_comprobantes SET total_comprobante = 1 WHERE id = $1`, [
        original.comprobanteId,
      ])
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 9. Sin credenciales no se emite ===");
  const t2 = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
    [`${PREFIJO}-sin-credenciales`]
  );
  const tenantSin = t2.rows[0].id;
  await pool.query(
    `INSERT INTO fact_emisores (
       tenant_id, tipo_identificacion, numero_identificacion, nombre,
       codigo_actividad_economica, ubicacion_provincia, ubicacion_canton, ubicacion_distrito,
       ubicacion_otras_senas, correo, proveedor_sistemas
     ) VALUES ($1, '02', '3109876543', 'Clínica sin credenciales S.A.', '750000',
               '1', '01', '01', '100 metros sur', 'x@y.test', '3101999999')`,
    [tenantSin]
  );
  await debeFallar("emitir en una clínica sin credenciales de Hacienda cargadas", () =>
    emitir(tenantSin, documento())
  );
  // Y el consecutivo igual no se desperdicia en silencio: el comprobante
  // quedó creado en borrador, visible, en vez de desaparecer.
  const borradores = await conAlcanceTenant(tenantSin, (db) =>
    db.query<{ n: string; estado: string }>(
      `SELECT count(*)::text AS n, min(estado) AS estado FROM fact_comprobantes WHERE tenant_id = $1`,
      [tenantSin]
    )
  );
  igual(
    borradores.rows[0].estado,
    "borrador",
    "el comprobante quedó en BORRADOR, visible para corregir y reintentar"
  );

  const tSinEmisor = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
    [`${PREFIJO}-sin-emisor`]
  );
  await debeFallar("emitir en una clínica sin emisor configurado", () =>
    emitir(tSinEmisor.rows[0].id, documento())
  );

  // -------------------------------------------------------------------
  console.log("\n=== 10. Lo que no se puede emitir, no se emite ===");
  await debeFallar("emitir un documento sin líneas", () =>
    emitir(tenantId, documento({ lineas: [] }))
  );
  await debeFallar("emitir una factura sin receptor", () =>
    emitir(tenantId, documento({ receptor: undefined }))
  );
  await debeFallar("emitir una línea con una unidad de medida inventada", () =>
    emitir(tenantId, documento({ lineas: [linea({ unidadMedida: "XYZ" })] }))
  );

  await limpiar();
  reiniciarSimulado();
  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  if (!ok) process.exit(1);
}

/**
 * Pone el próximo intento en el pasado para que la cola lo tome ya.
 *
 * Es el único atajo del script y es necesario: las esperas reales son de
 * 1, 5, 15… minutos, y un verificador que las respetara tardaría horas.
 * Lo que se adelanta es el RELOJ, no el comportamiento: el camino que
 * recorre la cola es el mismo.
 */
async function adelantarReintento(tenantId: string, comprobanteId: string) {
  await conAlcanceTenant(tenantId, (db) =>
    db.query(
      `UPDATE fact_comprobantes SET proximo_intento_en = now() - interval '1 minute' WHERE id = $1`,
      [comprobanteId]
    )
  );
}

main().catch(async (err) => {
  console.error(err);
  await limpiar().catch(() => undefined);
  await pool.end();
  process.exit(1);
});
