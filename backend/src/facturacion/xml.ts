import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import { TIPOS_COMPROBANTE } from "./catalogos";
import { ComprobanteCalculado, LineaCalculada } from "./calculo";
import { aMonto, deMonto } from "./decimal";
import { DocumentoVenta } from "./tipos";

// ---------------------------------------------------------------------
// Armado del XML v4.4.
//
// El ORDEN de los elementos importa: los XSD de Hacienda usan
// `xs:sequence`, así que un campo correcto en el lugar equivocado
// invalida el comprobante. Cada función de este archivo escribe los
// elementos en el orden exacto de su XSD, y el orden está escrito como
// comentario arriba de cada una — sacado del esquema real, no de la
// documentación en prosa.
//
// La librería es `xmlbuilder2`: conserva el orden de inserción, escapa
// el contenido y maneja el namespace por defecto. Armar el XML
// concatenando strings sería más corto hasta el primer nombre de clínica
// con un `&`.
//
// Lo que este módulo NO hace: no calcula (eso es `calculo.ts`), no firma
// (eso es `firma.ts`) y no valida (eso es `validacionXsd.ts`). Recibe
// datos ya calculados y los escribe.
// ---------------------------------------------------------------------

const NS_BASE = "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4";

export interface EmisorXml {
  nombre: string;
  tipoIdentificacion: string;
  numeroIdentificacion: string;
  nombreComercial?: string | null;
  registroFiscal8707?: string | null;
  codigoActividadEconomica: string;
  ubicacionProvincia: string;
  ubicacionCanton: string;
  ubicacionDistrito: string;
  ubicacionBarrio?: string | null;
  ubicacionOtrasSenas: string;
  telefonoCodigoPais?: string | null;
  telefonoNumero?: string | null;
  correo: string;
  proveedorSistemas: string;
}

export interface DatosXml {
  clave: string;
  consecutivo: string;
  tipoComprobante: string;
  fechaEmision: Date;
  emisor: EmisorXml;
  documento: DocumentoVenta;
  calculo: ComprobanteCalculado;
}

/**
 * `xs:dateTime` con el desplazamiento de Costa Rica explícito.
 *
 * No se usa `toISOString()` —que da `...Z`— porque la fecha de emisión
 * es la del hecho generador en Costa Rica y el comprobante se lee en
 * Costa Rica: una factura emitida a las 20:00 del día 25 se vería como
 * las 02:00 del 26 si se manda en UTC, contradiciendo el día que lleva
 * la propia clave numérica.
 */
export function fechaHoraXml(fecha: Date): string {
  const partes = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(fecha);
  const v = (t: string) => partes.find((p) => p.type === t)!.value;
  // Costa Rica no aplica horario de verano desde 1992, así que el
  // desplazamiento es -06:00 siempre. Si alguna vez cambiara, esto hay
  // que derivarlo de la zona; hoy derivarlo sería complejidad sin uso.
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}:${v("second")}-06:00`;
}

/** Agrega un elemento solo si el valor existe y no está vacío. */
function opcional(nodo: XMLBuilder, nombre: string, valor: string | number | null | undefined) {
  if (valor === null || valor === undefined || valor === "") return;
  nodo.ele(nombre).txt(String(valor));
}

export function armarXml(datos: DatosXml): string {
  const tipo = TIPOS_COMPROBANTE.find((t) => t.codigo === datos.tipoComprobante);
  if (!tipo?.elementoRaiz) {
    throw new Error(`Tipo de comprobante "${datos.tipoComprobante}" sin elemento raíz conocido.`);
  }

  const esRep = datos.tipoComprobante === "10";
  const esNota = datos.tipoComprobante === "02" || datos.tipoComprobante === "03";
  const { documento: doc, calculo, emisor } = datos;

  // El namespace por defecto es el del tipo de comprobante: cada uno
  // tiene el suyo (`.../v4.4/facturaElectronica`, `.../tiqueteElectronico`…).
  const raiz = create({ version: "1.0", encoding: "utf-8" }).ele(
    `${NS_BASE}/${nombreNamespace(tipo.elementoRaiz)}`,
    tipo.elementoRaiz
  );

  // -------------------------------------------------------------------
  // Orden del XSD (FacturaElectronica): Clave, ProveedorSistemas,
  // CodigoActividadEmisor, CodigoActividadReceptor?, NumeroConsecutivo,
  // FechaEmision, Emisor, Receptor, CondicionVenta, CondicionVentaOtros?,
  // PlazoCredito?, DetalleServicio?, OtrosCargos*, ResumenFactura,
  // InformacionReferencia*, Otros?, Signature.
  //
  // El REP no lleva CodigoActividad ni OtrosCargos ni Otros; las notas
  // tienen CodigoActividadEmisor opcional y la referencia obligatoria.
  // -------------------------------------------------------------------
  raiz.ele("Clave").txt(datos.clave);
  raiz.ele("ProveedorSistemas").txt(emisor.proveedorSistemas);
  if (!esRep) {
    raiz.ele("CodigoActividadEmisor").txt(emisor.codigoActividadEconomica);
    opcional(raiz, "CodigoActividadReceptor", doc.receptor?.codigoActividad);
  }
  raiz.ele("NumeroConsecutivo").txt(datos.consecutivo);
  raiz.ele("FechaEmision").txt(fechaHoraXml(datos.fechaEmision));

  escribirEmisor(raiz, emisor, esRep);
  escribirReceptor(raiz, doc, datos.tipoComprobante);

  raiz.ele("CondicionVenta").txt(doc.condicionVenta);
  if (!esRep) {
    opcional(raiz, "CondicionVentaOtros", doc.condicionVentaDetalle);
    opcional(raiz, "PlazoCredito", doc.plazoCreditoDias);
  }

  // DetalleServicio es opcional en factura/tiquete/notas y OBLIGATORIO
  // en el REP, pero el motor siempre emite líneas: un comprobante sin
  // detalle no es algo que este módulo deba poder producir.
  const detalle = raiz.ele("DetalleServicio");
  calculo.lineas.forEach((linea, i) => {
    escribirLinea(detalle, linea, doc.lineas[i], datos.tipoComprobante);
  });

  if (!esRep) {
    for (const cargo of doc.otrosCargos ?? []) {
      // Orden: TipoDocumentoOC, TipoDocumentoOTROS?, IdentificacionTercero?,
      // NombreTercero?, Detalle, PorcentajeOC?, MontoCargo.
      const n = raiz.ele("OtrosCargos");
      n.ele("TipoDocumentoOC").txt(cargo.tipoDocumento);
      opcional(n, "TipoDocumentoOTROS", cargo.tipoDocumentoOtros);
      if (cargo.tercero) {
        const id = n.ele("IdentificacionTercero");
        id.ele("Tipo").txt(cargo.tercero.identificacion.tipo);
        id.ele("Numero").txt(cargo.tercero.identificacion.numero);
        n.ele("NombreTercero").txt(cargo.tercero.nombre);
      }
      n.ele("Detalle").txt(cargo.detalle);
      opcional(n, "PorcentajeOC", cargo.porcentaje);
      n.ele("MontoCargo").txt(deMonto(aMonto(cargo.monto)));
    }
  }

  escribirResumen(raiz, datos, esRep);

  for (const ref of doc.referencias ?? []) {
    // Orden: TipoDocIR, TipoDocRefOTRO?, Numero?, FechaEmisionIR,
    // Codigo?, CodigoReferenciaOTRO?, Razon?.
    const n = raiz.ele("InformacionReferencia");
    n.ele("TipoDocIR").txt(ref.tipoDocumento);
    opcional(n, "TipoDocRefOTRO", ref.tipoDocumentoOtro);
    opcional(n, "Numero", ref.numero);
    n.ele("FechaEmisionIR").txt(fechaHoraXml(new Date(ref.fechaEmision)));
    opcional(n, "Codigo", ref.codigo);
    opcional(n, "CodigoReferenciaOTRO", ref.codigoOtro);
    opcional(n, "Razon", ref.razon);
  }

  if (esNota && (doc.referencias ?? []).length === 0) {
    throw new Error(
      `Un comprobante de tipo ${datos.tipoComprobante} (nota de ${datos.tipoComprobante === "02" ? "débito" : "crédito"}) exige al menos una referencia al comprobante que corrige: el XSD define InformacionReferencia con minOccurs="1".`
    );
  }
  if (esRep && (doc.referencias ?? []).length === 0) {
    throw new Error(
      "Un Recibo Electrónico de Pago exige al menos una referencia a la factura que cancela (el XSD define InformacionReferencia con minOccurs=\"1\")."
    );
  }

  // Otros/OtroTexto — las observaciones. Va DESPUÉS de
  // InformacionReferencia y antes de la firma, que es el orden del
  // XSD. El REP no tiene este nodo.
  //
  // `maxLength` 500 lo impone el tipo `restrictedString` del esquema;
  // se corta acá en vez de dejar que falle la validación, porque el
  // error del XSD sobre un texto largo no dice qué campo fue.
  if (!esRep && doc.observaciones && doc.observaciones.trim() !== "") {
    const otros = raiz.ele("Otros");
    otros.ele("OtroTexto").txt(doc.observaciones.trim().slice(0, 500));
  }

  // El XML se devuelve SIN la firma: la agrega `firma.ts`, que inserta
  // el nodo `ds:Signature` al final de la secuencia. Devolverlo firmado
  // desde acá mezclaría dos responsabilidades y haría imposible validar
  // contra el XSD antes de firmar, que es justo el orden que la norma
  // pide.
  return raiz.end({ prettyPrint: false });
}

/**
 * El `Barrio` del XSD v4.4 admite de 5 a 50 caracteres. Y la propia
 * lista oficial de barrios de Hacienda tiene 169 nombres de MENOS de 5
 * ("Amón", "Ana", "Cas"…): elegir un barrio real de su catálogo puede
 * producir un XML que su propio esquema rechaza.
 *
 * Esa contradicción no se resuelve inventando caracteres. Se detiene
 * acá, con un mensaje que dice qué pasa y qué hacer, en vez de dejar
 * que el error salga del validador del XSD diciendo "[facet
 * 'minLength'] The value has a length of '4'", que no le sirve a nadie.
 *
 * El campo es OPCIONAL, así que dejarlo vacío siempre es una salida.
 */
function exigirBarrioValido(valor: string | null | undefined, deQuien: string): void {
  if (valor === null || valor === undefined) return;
  const limpio = valor.trim();
  if (limpio === "") return;
  if (limpio.length < 5) {
    throw new Error(
      `El barrio ${deQuien} ("${limpio}") tiene ${limpio.length} caracteres y Hacienda exige al menos 5 ` +
        `(el XSD v4.4 define Barrio de 5 a 50). Es una contradicción del propio Hacienda: su lista oficial ` +
        `de barrios incluye nombres más cortos. Escribilo completo —por ejemplo "Barrio ${limpio}"— o dejalo ` +
        `vacío, que el campo es opcional.`
    );
  }
  if (limpio.length > 50) {
    throw new Error(
      `El barrio ${deQuien} tiene ${limpio.length} caracteres y el máximo del XSD v4.4 es 50.`
    );
  }
}

/** `FacturaElectronica` → `facturaElectronica`, que es el segmento del namespace. */
function nombreNamespace(elementoRaiz: string): string {
  return elementoRaiz[0].toLowerCase() + elementoRaiz.slice(1);
}

// ---------------------------------------------------------------------
// Emisor. Orden del XSD: Nombre, Identificacion(Tipo, Numero),
// Registrofiscal8707?, NombreComercial?, Ubicacion(Provincia, Canton,
// Distrito, Barrio?, OtrasSenas), Telefono?(CodigoPais, NumTelefono),
// CorreoElectronico+.
//
// En el REP el emisor es más corto: solo Nombre, Identificacion y
// CorreoElectronico.
// ---------------------------------------------------------------------
function escribirEmisor(raiz: XMLBuilder, emisor: EmisorXml, esRep: boolean) {
  const n = raiz.ele("Emisor");
  n.ele("Nombre").txt(emisor.nombre);
  const id = n.ele("Identificacion");
  id.ele("Tipo").txt(emisor.tipoIdentificacion);
  id.ele("Numero").txt(emisor.numeroIdentificacion);

  if (!esRep) {
    opcional(n, "Registrofiscal8707", emisor.registroFiscal8707);
    opcional(n, "NombreComercial", emisor.nombreComercial);
    const u = n.ele("Ubicacion");
    u.ele("Provincia").txt(emisor.ubicacionProvincia);
    u.ele("Canton").txt(emisor.ubicacionCanton);
    u.ele("Distrito").txt(emisor.ubicacionDistrito);
    exigirBarrioValido(emisor.ubicacionBarrio, "del emisor");
    opcional(u, "Barrio", emisor.ubicacionBarrio);
    u.ele("OtrasSenas").txt(emisor.ubicacionOtrasSenas);

    // El nodo Telefono es opcional, pero si está sus DOS hijos son
    // obligatorios: con uno solo el XML no valida.
    if (emisor.telefonoCodigoPais && emisor.telefonoNumero) {
      const t = n.ele("Telefono");
      t.ele("CodigoPais").txt(emisor.telefonoCodigoPais);
      t.ele("NumTelefono").txt(emisor.telefonoNumero);
    }
  }

  n.ele("CorreoElectronico").txt(emisor.correo);
}

// ---------------------------------------------------------------------
// Receptor. Orden: Nombre, Identificacion?, NombreComercial?,
// Ubicacion?, OtrasSenasExtranjero?, Telefono?, CorreoElectronico?.
//
// Obligatoriedad por tipo, leída del XSD:
//   factura (01) y REP (10) → el nodo Receptor es OBLIGATORIO y su
//                             Identificacion también;
//   tiquete (04) y notas (02, 03) → el nodo es opcional y, si está, la
//                             Identificacion es opcional.
// En el REP el receptor solo lleva Nombre, Identificacion y Correo.
// ---------------------------------------------------------------------
function escribirReceptor(raiz: XMLBuilder, doc: DocumentoVenta, tipoComprobante: string) {
  const esRep = tipoComprobante === "10";
  const receptorObligatorio = tipoComprobante === "01" || esRep;
  const receptor = doc.receptor;

  if (!receptor) {
    if (receptorObligatorio) {
      throw new Error(
        `Un comprobante de tipo ${tipoComprobante} exige los datos del receptor. Para una venta a un consumidor sin identificar, el comprobante que corresponde es el tiquete electrónico (04).`
      );
    }
    return;
  }

  if (receptorObligatorio && !receptor.identificacion) {
    throw new Error(
      `Un comprobante de tipo ${tipoComprobante} exige la identificación del receptor (el XSD la define obligatoria). Sin identificación, el comprobante que corresponde es el tiquete electrónico (04).`
    );
  }

  const n = raiz.ele("Receptor");
  n.ele("Nombre").txt(receptor.nombre);
  if (receptor.identificacion) {
    const id = n.ele("Identificacion");
    id.ele("Tipo").txt(receptor.identificacion.tipo);
    id.ele("Numero").txt(receptor.identificacion.numero);
  }

  if (!esRep) {
    opcional(n, "NombreComercial", receptor.nombreComercial);
    if (receptor.ubicacion) {
      const u = n.ele("Ubicacion");
      u.ele("Provincia").txt(receptor.ubicacion.provincia);
      u.ele("Canton").txt(receptor.ubicacion.canton);
      u.ele("Distrito").txt(receptor.ubicacion.distrito);
      exigirBarrioValido(receptor.ubicacion.barrio, "del receptor");
      opcional(u, "Barrio", receptor.ubicacion.barrio);
      u.ele("OtrasSenas").txt(receptor.ubicacion.otrasSenas);
    }
    opcional(n, "OtrasSenasExtranjero", receptor.otrasSenasExtranjero);
    if (receptor.telefono) {
      const t = n.ele("Telefono");
      t.ele("CodigoPais").txt(receptor.telefono.codigoPais);
      t.ele("NumTelefono").txt(receptor.telefono.numero);
    }
  }

  opcional(n, "CorreoElectronico", receptor.correo);
}

// ---------------------------------------------------------------------
// Línea de detalle. Orden del XSD (factura):
//   NumeroLinea, CodigoCABYS, CodigoComercial*, Cantidad, UnidadMedida,
//   TipoTransaccion?, UnidadMedidaComercial?, Detalle, NumeroVINoSerie*,
//   RegistroMedicamento?, FormaFarmaceutica?, DetalleSurtido?,
//   PrecioUnitario, MontoTotal, Descuento*, SubTotal, IVACobradoFabrica?,
//   BaseImponible, Impuesto+, ImpuestoAsumidoEmisorFabrica, ImpuestoNeto,
//   MontoTotalLinea.
//
// El tiquete NO tiene TipoTransaccion. El REP tiene una línea mucho más
// corta: NumeroLinea, Detalle, MontoTotal, SubTotal, Impuesto*,
// ImpuestoNeto, MontoTotalLinea.
//
// `DetalleSurtido` (productos de un combo o paquete) no se escribe: una
// clínica veterinaria no factura surtidos, y el nodo trae su propio
// árbol de impuestos y descuentos. Queda documentado como no construido
// en vez de medio hecho.
// ---------------------------------------------------------------------
function escribirLinea(
  detalle: XMLBuilder,
  calc: LineaCalculada,
  origen: DocumentoVenta["lineas"][number],
  tipoComprobante: string
) {
  const esRep = tipoComprobante === "10";
  const esTiquete = tipoComprobante === "04";
  const n = detalle.ele("LineaDetalle");

  n.ele("NumeroLinea").txt(String(calc.numeroLinea));

  if (esRep) {
    n.ele("Detalle").txt(origen.detalle);
    n.ele("MontoTotal").txt(deMonto(calc.montoTotal));
    n.ele("SubTotal").txt(deMonto(calc.subtotal));
    escribirImpuestos(n, calc, origen, esRep);
    n.ele("ImpuestoNeto").txt(deMonto(calc.impuestoNeto));
    n.ele("MontoTotalLinea").txt(deMonto(calc.montoTotalLinea));
    return;
  }

  if (!origen.codigoCabys) {
    throw new Error(
      `La línea ${calc.numeroLinea} no tiene código CABYS. Hacienda lo exige en cada línea de factura y tiquete (Nota 17), y es lo que decide si la línea suma como servicio o como mercancía.`
    );
  }
  n.ele("CodigoCABYS").txt(origen.codigoCabys);

  if (origen.codigoComercial) {
    const c = n.ele("CodigoComercial");
    c.ele("Tipo").txt(origen.codigoComercial.tipo);
    c.ele("Codigo").txt(origen.codigoComercial.codigo);
  }

  n.ele("Cantidad").txt(deMonto(calc.cantidad));
  n.ele("UnidadMedida").txt(origen.unidadMedida);
  if (!esTiquete) opcional(n, "TipoTransaccion", origen.tipoTransaccion);
  opcional(n, "UnidadMedidaComercial", origen.unidadMedidaComercial);
  n.ele("Detalle").txt(origen.detalle);
  opcional(n, "RegistroMedicamento", origen.registroMedicamento);
  opcional(n, "FormaFarmaceutica", origen.formaFarmaceutica);
  n.ele("PrecioUnitario").txt(deMonto(calc.precioUnitario));
  n.ele("MontoTotal").txt(deMonto(calc.montoTotal));

  for (const d of origen.descuentos ?? []) {
    // Orden: MontoDescuento, CodigoDescuento, CodigoDescuentoOTRO?,
    // NaturalezaDescuento?.
    const nd = n.ele("Descuento");
    nd.ele("MontoDescuento").txt(deMonto(aMonto(d.monto)));
    nd.ele("CodigoDescuento").txt(d.codigoDescuento);
    opcional(nd, "CodigoDescuentoOTRO", d.codigoDescuentoOtro);
    opcional(nd, "NaturalezaDescuento", d.naturaleza);
  }

  n.ele("SubTotal").txt(deMonto(calc.subtotal));
  opcional(n, "IVACobradoFabrica", origen.ivaCobradoFabrica);
  n.ele("BaseImponible").txt(deMonto(calc.baseImponible));
  escribirImpuestos(n, calc, origen, esRep);
  n.ele("ImpuestoAsumidoEmisorFabrica").txt(deMonto(calc.impuestoAsumidoEmisorFabrica));
  n.ele("ImpuestoNeto").txt(deMonto(calc.impuestoNeto));
  n.ele("MontoTotalLinea").txt(deMonto(calc.montoTotalLinea));
}

/**
 * Impuestos de la línea. Orden: Codigo, CodigoImpuestoOTRO?,
 * CodigoTarifaIVA?, Tarifa?, FactorCalculoIVA?,
 * DatosImpuestoEspecifico?, Monto, Exoneracion?.
 *
 * El REP no admite `DatosImpuestoEspecifico` ni `Exoneracion`.
 */
function escribirImpuestos(
  linea: XMLBuilder,
  calc: LineaCalculada,
  origen: DocumentoVenta["lineas"][number],
  esRep: boolean
) {
  calc.impuestos.forEach((imp, indice) => {
    const n = linea.ele("Impuesto");
    n.ele("Codigo").txt(imp.codigo);
    opcional(n, "CodigoImpuestoOTRO", imp.codigoOtro);
    opcional(n, "CodigoTarifaIVA", imp.codigoTarifaIva);
    if (imp.tarifa !== undefined) n.ele("Tarifa").txt(formatearTarifa(imp.tarifa));
    if (imp.factorCalculoIva !== undefined) {
      n.ele("FactorCalculoIVA").txt(formatearFactor(imp.factorCalculoIva));
    }

    if (!esRep && imp.datosEspecificos) {
      // Orden: CantidadUnidadMedida, Porcentaje?, Proporcion?,
      // VolumenUnidadConsumo?, ImpuestoUnidad.
      const d = n.ele("DatosImpuestoEspecifico");
      d.ele("CantidadUnidadMedida").txt(formatearDecimales(imp.datosEspecificos.cantidadUnidadMedida, 2));
      if (imp.datosEspecificos.porcentaje !== undefined) {
        d.ele("Porcentaje").txt(formatearDecimales(imp.datosEspecificos.porcentaje, 2));
      }
      if (imp.datosEspecificos.proporcion !== undefined) {
        d.ele("Proporcion").txt(deMonto(imp.datosEspecificos.proporcion));
      }
      if (imp.datosEspecificos.volumenUnidadConsumo !== undefined) {
        d.ele("VolumenUnidadConsumo").txt(
          formatearDecimales(imp.datosEspecificos.volumenUnidadConsumo, 2)
        );
      }
      d.ele("ImpuestoUnidad").txt(deMonto(imp.datosEspecificos.impuestoUnidad));
    }

    n.ele("Monto").txt(deMonto(imp.monto));

    if (!esRep && imp.exoneracion) {
      // El nodo Exoneracion va ADENTRO del impuesto, así que necesita a
      // la vez el monto calculado y los datos del documento (número de
      // resolución, institución, fechas). El cálculo no conserva esos
      // datos porque no los usa, así que se toman de la línea de origen
      // por índice: `calcularLinea` devuelve los impuestos en el mismo
      // orden en que los recibió, y la aserción de abajo lo comprueba en
      // vez de confiar.
      const origenImp = origen.impuestos[indice];
      if (!origenImp?.exoneracion || origenImp.codigo !== imp.codigo) {
        throw new Error(
          `No se pudo emparejar la exoneración del impuesto ${indice + 1} de la línea ${calc.numeroLinea} con su dato de origen.`
        );
      }
      const ex = origenImp.exoneracion;
      // Orden: TipoDocumentoEX1, TipoDocumentoOTRO?, NumeroDocumento,
      // Articulo?, Inciso?, NombreInstitucion, NombreInstitucionOtros?,
      // FechaEmisionEX, TarifaExonerada, MontoExoneracion.
      const ne = n.ele("Exoneracion");
      ne.ele("TipoDocumentoEX1").txt(ex.tipoDocumento);
      opcional(ne, "TipoDocumentoOTRO", ex.tipoDocumentoOtro);
      ne.ele("NumeroDocumento").txt(ex.numeroDocumento);
      opcional(ne, "Articulo", ex.articulo);
      opcional(ne, "Inciso", ex.inciso);
      ne.ele("NombreInstitucion").txt(ex.nombreInstitucion);
      opcional(ne, "NombreInstitucionOtros", ex.nombreInstitucionOtros);
      ne.ele("FechaEmisionEX").txt(fechaHoraXml(new Date(ex.fechaEmision)));
      ne.ele("TarifaExonerada").txt(formatearTarifa(imp.exoneracion.tarifaExonerada));
      ne.ele("MontoExoneracion").txt(deMonto(imp.exoneracion.monto));
    }
  });
}

/** `Tarifa` es `decimal(4,2)`: 13 va como "13.00". */
function formatearTarifa(tarifa: bigint): string {
  return formatearDecimales(tarifa, 2);
}

/** `FactorCalculoIVA` es `decimal(5,4)`. */
function formatearFactor(factor: bigint): string {
  return formatearDecimales(factor, 4);
}

/**
 * Un monto en cienmilésimas, con la cantidad de decimales que pide el
 * XSD para ese campo. Hace falta porque no todos los campos numéricos
 * del esquema son `decimal(18,5)`: `Tarifa` es (4,2) y mandarle 5
 * decimales lo invalida por `fractionDigits`.
 */
export function formatearDecimales(monto: bigint, decimales: number): string {
  const texto = deMonto(monto); // siempre con 5 decimales
  const [entera, decimal] = texto.split(".");
  if (decimales === 0) return entera;
  return `${entera}.${decimal.slice(0, decimales)}`;
}

// ---------------------------------------------------------------------
// Resumen. Orden del XSD: CodigoTipoMoneda(CodigoMoneda, TipoCambio),
// los ocho totales por servicio/mercancía, los cuatro agregados,
// TotalVenta, TotalDescuentos?, TotalVentaNeta, TotalDesgloseImpuesto*,
// TotalImpuesto?, TotalImpAsumEmisorFabrica?, TotalIVADevuelto?,
// TotalOtrosCargos?, MedioPago*, TotalComprobante.
//
// El REP tiene un resumen MUCHO más corto: CodigoTipoMoneda, TotalVenta,
// TotalVentaNeta, TotalDesgloseImpuesto*, TotalImpuesto?, MedioPago+,
// TotalComprobante.
//
// Los totales en cero NO se escriben: son `minOccurs="0"` y escribir
// "0.00000" en los ocho de servicio/mercancía ensucia el comprobante sin
// aportar nada. Los que sí van siempre (TotalVenta, TotalVentaNeta,
// TotalComprobante) son los tres obligatorios del esquema.
// ---------------------------------------------------------------------
function escribirResumen(raiz: XMLBuilder, datos: DatosXml, esRep: boolean) {
  const { resumen } = datos.calculo;
  const doc = datos.documento;
  const n = raiz.ele("ResumenFactura");

  const moneda = n.ele("CodigoTipoMoneda");
  moneda.ele("CodigoMoneda").txt(doc.moneda ?? "CRC");
  moneda.ele("TipoCambio").txt(deMonto(aMonto(doc.tipoCambio ?? 1)));

  const siNoCero = (nombre: string, valor: bigint) => {
    if (valor !== 0n) n.ele(nombre).txt(deMonto(valor));
  };

  if (!esRep) {
    siNoCero("TotalServGravados", resumen.totalServGravados);
    siNoCero("TotalServExentos", resumen.totalServExentos);
    siNoCero("TotalServExonerado", resumen.totalServExonerado);
    siNoCero("TotalServNoSujeto", resumen.totalServNoSujeto);
    siNoCero("TotalMercanciasGravadas", resumen.totalMercGravadas);
    siNoCero("TotalMercanciasExentas", resumen.totalMercExentas);
    siNoCero("TotalMercExonerada", resumen.totalMercExonerada);
    siNoCero("TotalMercNoSujeta", resumen.totalMercNoSujeta);
    siNoCero("TotalGravado", resumen.totalGravado);
    siNoCero("TotalExento", resumen.totalExento);
    siNoCero("TotalExonerado", resumen.totalExonerado);
    siNoCero("TotalNoSujeto", resumen.totalNoSujeto);
  }

  n.ele("TotalVenta").txt(deMonto(resumen.totalVenta));
  if (!esRep) siNoCero("TotalDescuentos", resumen.totalDescuentos);
  n.ele("TotalVentaNeta").txt(deMonto(resumen.totalVentaNeta));

  for (const d of resumen.desgloseImpuesto) {
    // Orden: Codigo, CodigoTarifaIVA?, TotalMontoImpuesto.
    const nd = n.ele("TotalDesgloseImpuesto");
    nd.ele("Codigo").txt(d.codigo);
    opcional(nd, "CodigoTarifaIVA", d.codigoTarifaIva);
    nd.ele("TotalMontoImpuesto").txt(deMonto(d.totalMontoImpuesto));
  }

  siNoCero("TotalImpuesto", resumen.totalImpuesto);
  if (!esRep) {
    siNoCero("TotalImpAsumEmisorFabrica", resumen.totalImpAsumEmisorFabrica);
    siNoCero("TotalIVADevuelto", resumen.totalIvaDevuelto);
    siNoCero("TotalOtrosCargos", resumen.totalOtrosCargos);
  }

  for (const m of doc.mediosPago ?? []) {
    // Orden: TipoMedioPago?, MedioPagoOtros?, TotalMedioPago?.
    const nm = n.ele("MedioPago");
    nm.ele("TipoMedioPago").txt(m.codigo);
    opcional(nm, "MedioPagoOtros", m.otro);
    if (m.monto !== undefined) nm.ele("TotalMedioPago").txt(deMonto(aMonto(m.monto)));
  }

  n.ele("TotalComprobante").txt(deMonto(resumen.totalComprobante));
}
