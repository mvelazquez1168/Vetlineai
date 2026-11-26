import { PoolClient } from "pg";
import { conAlcanceTenant } from "../alcanceTenant";
import { calcularComprobante } from "./calculo";
import { ResultadoEmision, crearBorradorEnTransaccion, emitir } from "./emision";
import {
  DocumentoVenta,
  LineaDocumento,
  TipoComprobanteEmitible,
} from "./tipos";

// ---------------------------------------------------------------------
// BORRADORES de comprobante.
//
// Un borrador es un comprobante que todavía NO tiene clave ni
// consecutivo (migración 094). Esa es toda la diferencia, y es la que
// importa: guardar y descartar borradores no deja huecos en la
// numeración, que es lo que la Nota 3 de Hacienda no perdona.
//
// POR QUÉ NO SE GUARDA EL JSON DEL DOCUMENTO: la tentación es serializar
// el `DocumentoVenta` en una columna y listo. Eso dejaría el mismo dato
// en dos lugares —las columnas normalizadas y el JSON— y lo caro no es
// la redundancia: es que al emitir se usaría el JSON y en la pantalla
// de listado se verían las columnas, y nadie notaría que divergieron.
// Así que hay UNA representación, la normalizada, y `documentoDeBorrador`
// la vuelve a armar cuando hace falta.
//
// EMITIR UN BORRADOR es leerlo, emitir ese documento, y recién
// entonces borrarlo. `emitir()` es el único camino que consume
// consecutivo, firma, valida contra el XSD y envía; hacer que un
// borrador "se convierta" en emitido por su cuenta sería una segunda
// implementación de ese camino.
//
// EL ORDEN IMPORTA y es emitir-y-después-borrar, no al revés. Las dos
// operaciones NO pueden ir en una transacción: emitir habla con
// Hacienda, y este módulo no sostiene una transacción abierta durante
// una llamada externa (es la regla que ya le costó a este proyecto una
// alerta de `idle in transaction`). Sin transacción común, si se
// borrara primero y la emisión fallara, el borrador se habría perdido.
// Al revés lo peor que pasa es que, por un instante, existan los dos.
// ---------------------------------------------------------------------

/** Lo que distingue a un borrador del resto. */
const ESTADO_BORRADOR = "borrador";

export interface ResultadoBorrador {
  id: string;
  estado: string;
}

/**
 * Reconstruye el `DocumentoVenta` de un borrador a partir de sus filas.
 *
 * Solo se usa con borradores: un comprobante emitido se lee por su XML
 * firmado, que es el documento de verdad.
 */
export async function documentoDeBorrador(
  db: PoolClient,
  comprobanteId: string
): Promise<DocumentoVenta> {
  const c = await db.query(
    `SELECT tipo_comprobante, sucursal, terminal, situacion, fecha_emision,
            receptor_tipo_identificacion, receptor_numero_identificacion, receptor_nombre,
            receptor_nombre_comercial, receptor_correo,
            receptor_telefono_codigo_pais, receptor_telefono_numero,
            receptor_ubicacion_provincia, receptor_ubicacion_canton,
            receptor_ubicacion_distrito, receptor_ubicacion_barrio,
            receptor_ubicacion_otras_senas, receptor_otras_senas_extranjero,
            receptor_propietario_id, codigo_actividad_receptor,
            condicion_venta, condicion_venta_detalle, plazo_credito_dias,
            moneda, tipo_cambio, observaciones, estado
       FROM fact_comprobantes WHERE id = $1`,
    [comprobanteId]
  );
  const f = c.rows[0];
  if (!f) throw new Error(`No existe el comprobante ${comprobanteId}.`);
  if (f.estado !== ESTADO_BORRADOR) {
    throw new Error(
      `El comprobante ${comprobanteId} está en estado "${f.estado}", no es un borrador.`
    );
  }

  const lineas = await db.query(
    `SELECT id, numero_linea, codigo_cabys, codigo_comercial_tipo, codigo_comercial,
            cantidad, unidad_medida, unidad_medida_comercial, tipo_transaccion, detalle,
            registro_medicamento, forma_farmaceutica, precio_unitario, iva_cobrado_fabrica
       FROM fact_comprobante_lineas WHERE comprobante_id = $1 ORDER BY numero_linea`,
    [comprobanteId]
  );
  const impuestos = await db.query(
    `SELECT linea_id, codigo_impuesto, codigo_impuesto_otro, codigo_tarifa_iva,
            factor_calculo_iva
       FROM fact_linea_impuestos
      WHERE linea_id = ANY($1::uuid[])
      ORDER BY linea_id, id`,
    [lineas.rows.map((l) => l.id)]
  );
  const descuentos = await db.query(
    `SELECT linea_id, monto, codigo_descuento, codigo_descuento_otro, naturaleza
       FROM fact_linea_descuentos
      WHERE linea_id = ANY($1::uuid[])
      ORDER BY linea_id, id`,
    [lineas.rows.map((l) => l.id)]
  );
  const medios = await db.query(
    `SELECT codigo_medio_pago, medio_pago_otro, monto
       FROM fact_comprobante_medios_pago WHERE comprobante_id = $1`,
    [comprobanteId]
  );
  const referencias = await db.query(
    `SELECT tipo_documento, tipo_documento_otro, numero, fecha_emision, codigo,
            codigo_otro, razon
       FROM fact_comprobante_referencias WHERE comprobante_id = $1`,
    [comprobanteId]
  );

  const receptor = f.receptor_nombre
    ? {
        nombre: f.receptor_nombre,
        identificacion: f.receptor_tipo_identificacion
          ? {
              tipo: f.receptor_tipo_identificacion,
              numero: f.receptor_numero_identificacion,
            }
          : undefined,
        nombreComercial: f.receptor_nombre_comercial ?? undefined,
        correo: f.receptor_correo ?? undefined,
        codigoActividad: f.codigo_actividad_receptor ?? undefined,
        telefono:
          f.receptor_telefono_codigo_pais && f.receptor_telefono_numero
            ? {
                codigoPais: f.receptor_telefono_codigo_pais,
                numero: f.receptor_telefono_numero,
              }
            : undefined,
        ubicacion: f.receptor_ubicacion_provincia
          ? {
              provincia: f.receptor_ubicacion_provincia,
              canton: f.receptor_ubicacion_canton,
              distrito: f.receptor_ubicacion_distrito,
              barrio: f.receptor_ubicacion_barrio ?? undefined,
              otrasSenas: f.receptor_ubicacion_otras_senas ?? "",
            }
          : undefined,
        otrasSenasExtranjero: f.receptor_otras_senas_extranjero ?? undefined,
      }
    : undefined;

  return {
    tipoComprobante: f.tipo_comprobante as TipoComprobanteEmitible,
    sucursal: f.sucursal,
    terminal: f.terminal,
    situacion: f.situacion,
    receptor,
    receptorPropietarioId: f.receptor_propietario_id ?? undefined,
    condicionVenta: f.condicion_venta,
    condicionVentaDetalle: f.condicion_venta_detalle ?? undefined,
    plazoCreditoDias: f.plazo_credito_dias ?? undefined,
    moneda: f.moneda,
    tipoCambio: f.tipo_cambio,
    observaciones: f.observaciones ?? undefined,
    lineas: lineas.rows.map((l): LineaDocumento => ({
      codigoCabys: l.codigo_cabys ?? undefined,
      codigoComercial: l.codigo_comercial
        ? { tipo: l.codigo_comercial_tipo, codigo: l.codigo_comercial }
        : undefined,
      cantidad: l.cantidad,
      unidadMedida: l.unidad_medida,
      unidadMedidaComercial: l.unidad_medida_comercial ?? undefined,
      tipoTransaccion: l.tipo_transaccion ?? undefined,
      detalle: l.detalle,
      precioUnitario: l.precio_unitario,
      ivaCobradoFabrica: l.iva_cobrado_fabrica ?? undefined,
      registroMedicamento: l.registro_medicamento ?? undefined,
      formaFarmaceutica: l.forma_farmaceutica ?? undefined,
      descuentos: descuentos.rows
        .filter((d) => d.linea_id === l.id)
        .map((d) => ({
          monto: d.monto,
          codigoDescuento: d.codigo_descuento,
          codigoDescuentoOtro: d.codigo_descuento_otro ?? undefined,
          naturaleza: d.naturaleza ?? undefined,
        })),
      impuestos: impuestos.rows
        .filter((i) => i.linea_id === l.id)
        .map((i) => ({
          codigo: i.codigo_impuesto,
          codigoOtro: i.codigo_impuesto_otro ?? undefined,
          codigoTarifaIva: i.codigo_tarifa_iva ?? undefined,
          factorCalculoIva: i.factor_calculo_iva ?? undefined,
        })),
    })),
    mediosPago: medios.rows.map((m) => ({
      codigo: m.codigo_medio_pago,
      otro: m.medio_pago_otro ?? undefined,
      monto: m.monto ?? undefined,
    })),
    referencias: referencias.rows.map((r) => ({
      tipoDocumento: r.tipo_documento,
      tipoDocumentoOtro: r.tipo_documento_otro ?? undefined,
      numero: r.numero ?? undefined,
      fechaEmision: (r.fecha_emision as Date).toISOString(),
      codigo: r.codigo ?? undefined,
      codigoOtro: r.codigo_otro ?? undefined,
      razon: r.razon ?? undefined,
    })),
  };
}

/**
 * Guarda un borrador nuevo, o reemplaza uno existente.
 *
 * El documento se CALCULA antes de guardar aunque sea un borrador: así
 * un borrador con una línea imposible (una unidad de medida que no
 * existe, un impuesto sin tarifa) falla al guardarse y no tres días
 * después, cuando alguien intenta emitirlo con el cliente esperando.
 * Los totales guardados son los del motor, los mismos que va a tener el
 * comprobante emitido.
 */
export async function guardarBorrador(
  tenantId: string,
  documento: DocumentoVenta,
  borradorId?: string
): Promise<ResultadoBorrador> {
  // Valida y calcula fuera de toda transacción. Lanza si el documento
  // no se puede calcular.
  calcularComprobante(documento);

  return conAlcanceTenant(tenantId, async (db) => {
    if (borradorId) {
      const previo = await db.query<{ estado: string }>(
        `SELECT estado FROM fact_comprobantes WHERE id = $1`,
        [borradorId]
      );
      if (previo.rows.length === 0) {
        throw new Error(`No existe el borrador ${borradorId}.`);
      }
      if (previo.rows[0].estado !== ESTADO_BORRADOR) {
        throw new Error(
          `El comprobante ${borradorId} ya fue emitido (estado "${previo.rows[0].estado}"): no se puede editar. La corrección de un comprobante emitido es una nota.`
        );
      }
      // Reemplazar en vez de hacer un diff línea por línea: un borrador
      // no tiene historia que conservar, y un diff sobre líneas,
      // impuestos y descuentos sería mucho código para el mismo
      // resultado. La cascada se lleva los hijos.
      await db.query(`DELETE FROM fact_comprobantes WHERE id = $1`, [borradorId]);
    }

    const { id } = await crearBorradorEnTransaccion(db, tenantId, documento);
    return { id, estado: ESTADO_BORRADOR };
  });
}

/** Elimina un borrador. Un comprobante emitido no pasa por acá. */
export async function borrarBorrador(tenantId: string, borradorId: string): Promise<void> {
  await conAlcanceTenant(tenantId, async (db) => {
    const r = await db.query<{ estado: string }>(
      `SELECT estado FROM fact_comprobantes WHERE id = $1`,
      [borradorId]
    );
    if (r.rows.length === 0) throw new Error(`No existe el borrador ${borradorId}.`);
    if (r.rows[0].estado !== ESTADO_BORRADOR) {
      throw new Error(
        `El comprobante ${borradorId} está en estado "${r.rows[0].estado}" y no se puede eliminar: ya existe para Hacienda.`
      );
    }
    await db.query(`DELETE FROM fact_comprobantes WHERE id = $1`, [borradorId]);
  });
}

/**
 * Emite un borrador: le asigna recién ahora su consecutivo y su clave.
 *
 * Si la emisión falla, el borrador sigue estando para corregirlo — ver
 * la nota de arriba sobre por qué se borra al final y no al principio.
 */
export async function emitirBorrador(
  tenantId: string,
  borradorId: string
): Promise<ResultadoEmision> {
  const documento = await conAlcanceTenant(tenantId, (db) =>
    documentoDeBorrador(db, borradorId)
  );

  const resultado = await emitir(tenantId, documento);

  await conAlcanceTenant(tenantId, (db) =>
    db.query(`DELETE FROM fact_comprobantes WHERE id = $1 AND estado = $2`, [
      borradorId,
      ESTADO_BORRADOR,
    ])
  );

  return resultado;
}
