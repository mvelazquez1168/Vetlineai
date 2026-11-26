import { SituacionComprobante } from "./claveConsecutivo";

// ---------------------------------------------------------------------
// EL CONTRATO DEL DOCUMENTO DE VENTA.
//
// Esto es lo que caja, ventas y compras le van a pasar al facturador. Es
// deliberadamente genérico: no sabe de pacientes, ni de consultas, ni de
// inventario. Recibe líneas con su código CABYS, su precio y su tarifa,
// y se ocupa de todo lo que exige Hacienda.
//
// Dos reglas de diseño que explican la forma:
//
//   1. **Lo que se puede calcular, no se recibe.** El documento de venta
//      NO trae subtotales, ni base imponible, ni montos de impuesto, ni
//      totales. Los calcula el motor (`calculo.ts`) según la norma. Si
//      los recibiera, habría dos fuentes para el mismo número y la que
//      Hacienda valida es la del motor.
//
//   2. **Los códigos son códigos, no texto.** `codigoTarifaIva: "08"` y
//      no `tarifa: 13`. Hay tres códigos distintos que valen 0% con
//      significados fiscales diferentes (ver `catalogos.ts`), así que
//      recibir el porcentaje perdería la información que importa.
//
// El contrato en prosa, para quien consuma la API sin leer este archivo,
// está en `docs/facturacion/contrato-api.md`.
// ---------------------------------------------------------------------

/** Los cinco tipos que este motor emite. */
export type TipoComprobanteEmitible = "01" | "02" | "03" | "04" | "10";

export interface IdentificacionDocumento {
  /** Nota 4: 01 física, 02 jurídica, 03 DIMEX, 04 NITE, 05 extranjero no domiciliado, 06 no contribuyente. */
  tipo: string;
  numero: string;
}

export interface UbicacionDocumento {
  provincia: string;
  canton: string;
  distrito: string;
  /** En v4.4 es texto de 5 a 50 caracteres, no un código. */
  barrio?: string;
  otrasSenas: string;
}

export interface TelefonoDocumento {
  codigoPais: string;
  numero: string;
}

export interface ReceptorDocumento {
  nombre: string;
  identificacion?: IdentificacionDocumento;
  nombreComercial?: string;
  ubicacion?: UbicacionDocumento;
  /** Para un receptor no domiciliado, que no tiene ubicación de Costa Rica. */
  otrasSenasExtranjero?: string;
  telefono?: TelefonoDocumento;
  /**
   * A dónde se le manda el PDF y el XML. Sin esto no hay entrega por
   * correo, y el comprobante igual se emite: es un dato de la entrega,
   * no de la validez fiscal.
   */
  correo?: string;
  /** Nota: el XML lo admite y es opcional. */
  codigoActividad?: string;
}

export interface DescuentoDocumento {
  /** Monto, no porcentaje: así lo pide el XML. */
  monto: string | number;
  /** Nota 20. Obligatorio en 4.4. */
  codigoDescuento: string;
  /** Obligatorio si el código es 99. */
  codigoDescuentoOtro?: string;
  /** Obligatoria si el código es 99. */
  naturaleza?: string;
}

export interface ExoneracionDocumento {
  /** Nota 10.1. */
  tipoDocumento: string;
  tipoDocumentoOtro?: string;
  numeroDocumento: string;
  articulo?: number;
  inciso?: number;
  /** Nota 23. */
  nombreInstitucion: string;
  nombreInstitucionOtros?: string;
  fechaEmision: string;
  /** El porcentaje exonerado, como entero: 13 para el 13%. */
  tarifaExonerada: string | number;
}

export interface ImpuestoDocumento {
  /** Nota 8: 01 IVA, 02 selectivo de consumo, 03..06 y 12 específicos, 07 IVA especial, 08 factor, 99 otros. */
  codigo: string;
  /** Obligatorio si el código es 99. */
  codigoOtro?: string;
  /** Nota 8.1. Obligatorio para los códigos de impuesto 01 y 07. */
  codigoTarifaIva?: string;
  /** El factor del régimen de bienes usados (código de impuesto 08). */
  factorCalculoIva?: string | number;
  /**
   * Para los impuestos específicos (03, 04, 05, 06, 12), que no se
   * calculan por porcentaje sino por unidad o volumen.
   */
  datosEspecificos?: {
    cantidadUnidadMedida: string | number;
    porcentaje?: string | number;
    proporcion?: string | number;
    volumenUnidadConsumo?: string | number;
    impuestoUnidad: string | number;
  };
  exoneracion?: ExoneracionDocumento;
}

export interface LineaDocumento {
  /**
   * 13 dígitos del catálogo CABYS. Define si la línea es servicio
   * (códigos que empiezan con 5, 6, 7, 8 o 9) o mercancía, que es lo que
   * decide en qué total del resumen suma. No es opcional en factura ni
   * tiquete.
   */
  codigoCabys?: string;
  /** El código interno de la clínica para ese producto o servicio. */
  codigoComercial?: { tipo: string; codigo: string };
  cantidad: string | number;
  /** Nota 15: el símbolo, no un número. 'Unid', 'Sp', 'mL'… */
  unidadMedida: string;
  unidadMedidaComercial?: string;
  /** Nota 22. */
  tipoTransaccion?: string;
  detalle: string;
  precioUnitario: string | number;
  descuentos?: DescuentoDocumento[];
  /**
   * Al menos uno. Una línea exenta NO va sin impuesto: va con código 01
   * y código de tarifa 10. Es la diferencia entre "no cobré IVA" y "no
   * declaré nada sobre el IVA".
   */
  impuestos: ImpuestoDocumento[];
  /** Nota 21: 01 o 02, solo para el sistema especial de IVA a nivel de fábrica. */
  ivaCobradoFabrica?: string;
  /**
   * Para el código de impuesto 07 o el IVA cobrado a nivel de fábrica
   * código 01, donde la norma permite editar la base imponible. En
   * cualquier otro caso se calcula y pasarla es un error.
   */
  baseImponibleEditada?: string | number;
  registroMedicamento?: string;
  /** Nota 19. */
  formaFarmaceutica?: string;
}

export interface MedioPagoDocumento {
  /** Nota 6. SINPE MÓVIL es el 06. */
  codigo: string;
  /** Obligatorio si el código es 99. */
  otro?: string;
  /** Obligatorio desde el segundo medio de pago. */
  monto?: string | number;
}

export interface OtroCargoDocumento {
  /** Nota 16. */
  tipoDocumento: string;
  tipoDocumentoOtros?: string;
  tercero?: { identificacion: IdentificacionDocumento; nombre: string };
  detalle: string;
  porcentaje?: string | number;
  monto: string | number;
}

export interface ReferenciaDocumento {
  /** Nota 10. */
  tipoDocumento: string;
  tipoDocumentoOtro?: string;
  /** La clave de 50 del comprobante referenciado, o el número de un documento físico. */
  numero?: string;
  fechaEmision: string;
  /** Nota 9. */
  codigo?: string;
  codigoOtro?: string;
  razon?: string;
}

/**
 * El documento de venta genérico.
 *
 * `claveIdempotencia` es lo que impide que un reintento de la caja emita
 * dos facturas por la misma venta. La caja debería mandar su propio
 * identificador de venta; si no manda nada, el motor emite igual (dos
 * llamadas sin clave son dos comprobantes, y eso es lo correcto cuando
 * quien llama es una persona apretando un botón).
 */
export interface DocumentoVenta {
  tipoComprobante: TipoComprobanteEmitible;
  /** Por defecto, la del emisor. */
  sucursal?: string;
  terminal?: string;
  /** Por defecto '1' (normal). Ver la advertencia de `SITUACION_*`. */
  situacion?: SituacionComprobante;
  /** Por defecto, ahora. */
  fechaEmision?: string;

  receptor?: ReceptorDocumento;

  /** Nota 5. */
  condicionVenta: string;
  condicionVentaDetalle?: string;
  /** En días (entero), no texto libre: cambió en 4.4. */
  plazoCreditoDias?: number;

  /** Por defecto 'CRC' con tipo de cambio 1. */
  moneda?: string;
  tipoCambio?: string | number;

  lineas: LineaDocumento[];
  mediosPago?: MedioPagoDocumento[];
  otrosCargos?: OtroCargoDocumento[];
  referencias?: ReferenciaDocumento[];

  /**
   * Texto libre del emisor. Sale en el XML como `Otros/OtroTexto`, que
   * es el campo que el XSD v4.4 define para esto: opcional, repetible y
   * de hasta 500 caracteres (tipo `restrictedString`). No hay otro
   * lugar en el esquema para una observación.
   */
  observaciones?: string;

  /**
   * De qué ficha de cliente (`propietarios`) salieron los datos del
   * receptor. Es una REFERENCIA, no la fuente: lo que vale es la copia
   * que queda en el comprobante, para que corregir la ficha del cliente
   * mañana no altere una factura ya emitida.
   */
  receptorPropietarioId?: string;

  claveIdempotencia?: string;
}
