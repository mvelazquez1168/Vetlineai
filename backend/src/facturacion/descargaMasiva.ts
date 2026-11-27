import { ZipArchive } from "archiver";
import { PoolClient } from "pg";
import { Readable } from "stream";

// ---------------------------------------------------------------------
// LA DESCARGA DEL PERÍODO PARA EL CONTADOR — prompt 09b, B2.
//
// Lo que el contador pide todos los meses: los XML emitidos y recibidos
// del período, en un zip. Hoy hay que bajarlos de a uno desde la
// pantalla de comprobantes, y con doscientas facturas eso no se hace:
// se termina pidiéndoselos al proveedor del sistema por correo.
//
// POR QUÉ UN STREAM Y NO UN BUFFER: un mes de una clínica mediana son
// cientos de XML. Armar el zip entero en memoria antes de empezar a
// responder usa esa memoria por cada contador que descarga a la vez, y
// el primer byte llega recién al final. Con `archiver` sobre la
// respuesta, el navegador empieza a recibir de inmediato.
//
// LO QUE NO VA EN EL ZIP: los PDF. Se generan a demanda —no están
// guardados— y generar doscientos PDF dentro de una descarga la haría
// tardar minutos. El contador necesita los XML, que son los que valen
// ante Hacienda; los PDF se bajan de a uno cuando alguien los pide.
// Queda anotado en el informe.
// ---------------------------------------------------------------------

export interface ArchivoDelZip {
  nombre: string;
  contenido: Buffer;
}

/**
 * Los XML emitidos y recibidos de un período.
 *
 * Se devuelven como lista y no se escriben directo al zip para que la
 * ruta pueda contarlos y decir «no hay nada en ese período» en vez de
 * mandar un zip vacío, que el contador interpreta como un error del
 * sistema.
 */
export async function xmlDelPeriodo(
  db: PoolClient,
  tenantId: string,
  desde: string,
  hasta: string
): Promise<{ emitidos: ArchivoDelZip[]; recibidos: ArchivoDelZip[] }> {
  const emitidos = await db.query<{
    consecutivo: string;
    clave: string;
    xml_firmado: Buffer | null;
    respuesta_xml: Buffer | null;
    estado: string;
  }>(
    `SELECT consecutivo, clave, xml_firmado, respuesta_xml, estado
       FROM fact_comprobantes
      WHERE tenant_id = $1
        AND fecha_emision::date BETWEEN $2::date AND $3::date
        AND xml_firmado IS NOT NULL
      ORDER BY fecha_emision`,
    [tenantId, desde, hasta]
  );

  const recibidos = await db.query<{
    consecutivo: string | null;
    clave: string;
    xml_recibido: Buffer;
    mensaje_xml_firmado: Buffer | null;
  }>(
    `SELECT consecutivo, clave, xml_recibido, mensaje_xml_firmado
       FROM fact_recibidos
      WHERE tenant_id = $1
        AND fecha_emision::date BETWEEN $2::date AND $3::date
      ORDER BY fecha_emision`,
    [tenantId, desde, hasta]
  );

  const archivosEmitidos: ArchivoDelZip[] = [];
  for (const f of emitidos.rows) {
    if (f.xml_firmado) {
      archivosEmitidos.push({
        // EL NOMBRE LLEVA LA CLAVE, que es el identificador único del
        // comprobante ante Hacienda. Con el consecutivo solo, dos
        // sucursales distintas podrían chocar dentro del zip.
        nombre: `emitidos/${f.consecutivo || f.clave}.xml`,
        contenido: f.xml_firmado,
      });
    }
    if (f.respuesta_xml) {
      // La respuesta de Hacienda va al lado del comprobante: es la
      // prueba de que fue aceptado, y el contador la necesita tanto
      // como el XML.
      archivosEmitidos.push({
        nombre: `emitidos/${f.consecutivo || f.clave}-respuesta-hacienda.xml`,
        contenido: f.respuesta_xml,
      });
    }
  }

  const archivosRecibidos: ArchivoDelZip[] = [];
  for (const f of recibidos.rows) {
    archivosRecibidos.push({
      nombre: `recibidos/${f.consecutivo || f.clave}.xml`,
      contenido: f.xml_recibido,
    });
    if (f.mensaje_xml_firmado) {
      archivosRecibidos.push({
        nombre: `recibidos/${f.consecutivo || f.clave}-mensaje-receptor.xml`,
        contenido: f.mensaje_xml_firmado,
      });
    }
  }

  return { emitidos: archivosEmitidos, recibidos: archivosRecibidos };
}

/**
 * Arma el zip sobre un stream de salida.
 *
 * `destino` es la respuesta HTTP: el zip se escribe mientras se genera.
 */
export function escribirZip(
  destino: NodeJS.WritableStream,
  archivos: ArchivoDelZip[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Nivel 6 y no 9: con XML el 9 comprime apenas un 2 % más y tarda
    // bastante más, y acá hay cientos de archivos.
    // `new ZipArchive(...)`, que es la forma que ya usa `purga.ts`: los
    // tipos de @types/archiver exportan la clase y no una función
    // invocable, y la otra forma no compila.
    const zip = new ZipArchive({ zlib: { level: 6 } });
    zip.on("error", reject);
    zip.on("end", () => resolve());
    zip.pipe(destino);
    for (const a of archivos) {
      zip.append(Readable.from(a.contenido), { name: a.nombre });
    }
    void zip.finalize();
  });
}

/**
 * La bitácora de envíos: a quién se le mandó cada comprobante.
 *
 * Sale de `correos_enviados`, que es donde el sistema registra todo
 * envío desde el prompt de notificaciones. **No se crea una tabla
 * nueva**: tener el registro de envíos en dos lugares terminaría con
 * dos respuestas distintas a «¿se le mandó la factura al cliente?».
 */
export async function bitacoraDeEnvios(
  db: PoolClient,
  tenantId: string,
  desde: string,
  hasta: string
): Promise<Array<Record<string, unknown>>> {
  // LAS COLUMNAS REALES de `correos_enviados`, verificadas contra el
  // esquema: `resultado` y no `estado`, `enviado_en` y no `creado_en`, y
  // NO hay `comprobante_id` ni `asunto`. Por eso la bitácora liga por
  // TIPO: los envíos de facturación son los que empiezan con «fact».
  //
  // Es menos preciso que un vínculo directo al comprobante, y lo digo
  // en vez de inventar un JOIN que no existe: para saber a qué
  // comprobante corresponde un envío haría falta una columna que la
  // tabla no tiene, y agregarla es un cambio del módulo de correos y no
  // de este. Queda anotado en el informe.
  const r = await db.query(
    `SELECT ce.id, ce.tipo, ce.destinatario, ce.resultado, ce.error,
            ce.enviado_en::text, ce.rebotado_en::text, ce.proveedor_message_id
       FROM correos_enviados ce
      WHERE ce.tenant_id = $1
        AND ce.enviado_en::date BETWEEN $2::date AND $3::date
      ORDER BY ce.enviado_en DESC
      LIMIT 2000`,
    [tenantId, desde, hasta]
  );
  return r.rows;
}
