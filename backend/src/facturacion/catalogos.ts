// ---------------------------------------------------------------------
// Catálogos oficiales de comprobantes electrónicos de Costa Rica, v4.4.
//
// De dónde sale cada cosa, y por qué están acá y no en una migración:
//
//   * QUÉ CÓDIGOS EXISTEN lo decide el XSD oficial. Los XSD están en
//     `backend/esquemas/fe-cr/xml-schemas/` y enumeran, uno por uno, los
//     valores que Hacienda acepta. Este archivo NO es la autoridad sobre
//     eso: `scripts/verificar_catalogos_fe.ts` compara código por código
//     cada lista de abajo contra la enumeración del XSD real y falla si
//     sobra o falta uno. Esa comparación es la que atrapa un error de
//     transcripción; sin ella, esta tabla sería una lista de memoria.
//
//   * CÓMO SE LLAMA cada código sale de las notas del
//     `ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` (notas 4 a 20), que el XSD no
//     trae. Cada catálogo dice arriba de qué nota viene.
//
//   * Los nombres de las 168 monedas salen de `Codigodemoneda_V4.4.pdf`
//     (Nota 13.1).
//
//   * Las 101 unidades de medida salen de la Nota 15.
//
// Van en TypeScript y no dentro de una migración porque Hacienda
// actualiza los catálogos sin cambiar la versión: una migración queda
// aplicada para siempre, y `npm run cargar-catalogos-fe` se vuelve a
// correr. Mismo criterio que `tenant_modulos` (migración 086).
// ---------------------------------------------------------------------

export interface FilaCatalogo {
  codigo: string;
  nombre: string;
  /** El código obliga a completar un campo "OTRO" de texto libre. */
  exigeDetalle?: boolean;
}

// ---------------------------------------------------------------------
// Tipos de comprobante — Nota 2 del anexo, más el nombre del elemento
// raíz y del XSD, leídos de los nueve esquemas.
//
// `esComprobante: false` son los tres mensajes de confirmación: comparten
// la numeración consecutiva de 20 posiciones pero no tienen líneas ni
// totales, así que no son filas de `fact_comprobantes`.
// ---------------------------------------------------------------------
export interface FilaTipoComprobante {
  codigo: string;
  nombre: string;
  elementoRaiz: string | null;
  archivoXsd: string | null;
  esComprobante: boolean;
}

export const TIPOS_COMPROBANTE: FilaTipoComprobante[] = [
  {
    codigo: "01",
    nombre: "Factura electrónica",
    elementoRaiz: "FacturaElectronica",
    archivoXsd: "v4.4/facturaElectronica/FacturaElectronica_V4.4.xsd",
    esComprobante: true,
  },
  {
    codigo: "02",
    nombre: "Nota de débito electrónica",
    elementoRaiz: "NotaDebitoElectronica",
    archivoXsd: "v4.4/notaDebitoElectronica/NotaDebitoElectronica_V4.4.xsd",
    esComprobante: true,
  },
  {
    codigo: "03",
    nombre: "Nota de crédito electrónica",
    elementoRaiz: "NotaCreditoElectronica",
    archivoXsd: "v4.4/notaCreditoElectronica/NotaCreditoElectronica_V4.4.xsd",
    esComprobante: true,
  },
  {
    codigo: "04",
    nombre: "Tiquete electrónico",
    elementoRaiz: "TiqueteElectronico",
    archivoXsd: "v4.4/tiqueteElectronico/TiqueteElectronico_V4.4.xsd",
    esComprobante: true,
  },
  // Los tres mensajes de confirmación comparten UN solo esquema
  // (MensajeReceptor), y qué mensaje es lo dice el campo `Mensaje` (1, 2
  // o 3) adentro del XML, no el tipo de comprobante de la numeración.
  {
    codigo: "05",
    nombre: "Confirmación de aceptación del comprobante electrónico",
    elementoRaiz: "MensajeReceptor",
    archivoXsd: "v4.4/mensajeReceptor/MensajeReceptor_V4.4.xsd",
    esComprobante: false,
  },
  {
    codigo: "06",
    nombre: "Confirmación de aceptación parcial del comprobante electrónico",
    elementoRaiz: "MensajeReceptor",
    archivoXsd: "v4.4/mensajeReceptor/MensajeReceptor_V4.4.xsd",
    esComprobante: false,
  },
  {
    codigo: "07",
    nombre: "Confirmación de rechazo del comprobante electrónico",
    elementoRaiz: "MensajeReceptor",
    archivoXsd: "v4.4/mensajeReceptor/MensajeReceptor_V4.4.xsd",
    esComprobante: false,
  },
  {
    codigo: "08",
    nombre: "Factura electrónica de compra",
    elementoRaiz: "FacturaElectronicaCompra",
    archivoXsd: "v4.4/facturaElectronicaCompra/FacturaElectronicaCompra_V4.4.xsd",
    esComprobante: true,
  },
  {
    codigo: "09",
    nombre: "Factura electrónica de exportación",
    elementoRaiz: "FacturaElectronicaExportacion",
    archivoXsd: "v4.4/facturaElectronicaExportacion/FacturaElectronicaExportacion_V4.4.xsd",
    esComprobante: true,
  },
  {
    codigo: "10",
    nombre: "Recibo electrónico de pago",
    elementoRaiz: "ReciboElectronicoPago",
    archivoXsd: "v4.4/reciboElectronicoPago/ReciboElectronicoPago_V4.4.xsd",
    esComprobante: true,
  },
];

/**
 * Los cinco tipos que ESTE motor emite. La factura de compra (08) y la
 * de exportación (09) están fuera del prompt a propósito; los tres
 * mensajes (05/06/07) se emiten por el camino de `fact_recibidos`.
 */
export const TIPOS_QUE_EMITIMOS = ["01", "02", "03", "04", "10"] as const;

// ---------------------------------------------------------------------
// Tipos de identificación — Nota 4, con el relleno de la Nota 4.1.
//
// `largoEnClave` y `notaRelleno` son la regla de armado de las
// posiciones 10-21 de la clave numérica. Están acá, con el texto literal
// de la nota, para que el módulo de la clave la lea de un solo lugar.
//
// Los tipos 05 y 06 NO aparecen en la Nota 4.1: la nota solo describe
// física, jurídica, DIMEX y NITE. De ahí que su `largoEnClave` sea null
// — no es un olvido, es que la norma no lo dice.
// ---------------------------------------------------------------------
export interface FilaTipoIdentificacion {
  codigo: string;
  nombre: string;
  largoEnClave: number | null;
  notaRelleno: string | null;
}

export const TIPOS_IDENTIFICACION: FilaTipoIdentificacion[] = [
  {
    codigo: "01",
    nombre: "Cédula física",
    largoEnClave: 12,
    notaRelleno:
      "Se debe agregar tres ceros antes de iniciar con el número de cédula con el fin de completar 12 dígitos",
  },
  {
    codigo: "02",
    nombre: "Cédula jurídica",
    largoEnClave: 12,
    notaRelleno:
      "Se debe agregar dos ceros antes de iniciar con el número de cédula con el fin de completar 12 caracteres",
  },
  {
    codigo: "03",
    nombre: "DIMEX",
    largoEnClave: 12,
    notaRelleno:
      "En aquellos casos donde la cédula se encuentre compuesta de 11 dígitos se debe agregar un cero al inicio con el fin de completar 12 dígitos",
  },
  {
    codigo: "04",
    nombre: "NITE",
    largoEnClave: 12,
    notaRelleno:
      "Se debe agregar dos ceros antes de iniciar con el número de identificación con el fin de completar 12 dígitos",
  },
  { codigo: "05", nombre: "Extranjero no domiciliado", largoEnClave: null, notaRelleno: null },
  { codigo: "06", nombre: "No contribuyente", largoEnClave: null, notaRelleno: null },
];

// ---------------------------------------------------------------------
// Condiciones de venta — Nota 5.
//
// `soloEnRep`: los códigos 09 y 11 NO están en la enumeración del XSD de
// factura; el XSD del Recibo Electrónico de Pago enumera exactamente
// esos dos y nada más. Son los pagos de una factura con condición 08 y
// 10 respectivamente.
// ---------------------------------------------------------------------
export interface FilaCondicionVenta extends FilaCatalogo {
  soloEnRep?: boolean;
}

export const CONDICIONES_VENTA: FilaCondicionVenta[] = [
  { codigo: "01", nombre: "Contado" },
  { codigo: "02", nombre: "Crédito" },
  { codigo: "03", nombre: "Consignación" },
  { codigo: "04", nombre: "Apartado" },
  { codigo: "05", nombre: "Arrendamiento con opción de compra" },
  { codigo: "06", nombre: "Arrendamiento en función financiera" },
  { codigo: "07", nombre: "Cobro a favor de un tercero" },
  { codigo: "08", nombre: "Servicios prestados al Estado" },
  { codigo: "09", nombre: "Pago de servicios prestados al Estado", soloEnRep: true },
  { codigo: "10", nombre: "Venta a crédito en IVA hasta 90 días (artículo 27, LIVA)" },
  {
    codigo: "11",
    nombre: "Pago de venta a crédito en IVA hasta 90 días (artículo 27, LIVA)",
    soloEnRep: true,
  },
  { codigo: "12", nombre: "Venta mercancía no nacionalizada" },
  { codigo: "13", nombre: "Venta bienes usados no contribuyente" },
  { codigo: "14", nombre: "Arrendamiento operativo" },
  { codigo: "15", nombre: "Arrendamiento financiero" },
  { codigo: "99", nombre: "Otros", exigeDetalle: true },
];

// ---------------------------------------------------------------------
// Medios de pago — Nota 6.
//
// El 06 es SINPE MÓVIL. Vale la aclaración porque la nota al pie 27 del
// anexo dice "El código 06, Recaudado por terceros", contradiciendo su
// propia tabla, donde "Recaudado por terceros" es el 05 y SINPE MÓVIL el
// 06. Manda la tabla: es la que el XSD respalda y la que se publica como
// catálogo.
// ---------------------------------------------------------------------
export const MEDIOS_PAGO: FilaCatalogo[] = [
  { codigo: "01", nombre: "Efectivo" },
  { codigo: "02", nombre: "Tarjeta" },
  { codigo: "03", nombre: "Cheque" },
  { codigo: "04", nombre: "Transferencia – depósito bancario" },
  { codigo: "05", nombre: "Recaudado por terceros" },
  { codigo: "06", nombre: "SINPE MÓVIL" },
  { codigo: "07", nombre: "Plataforma digital" },
  { codigo: "99", nombre: "Otros", exigeDetalle: true },
];

// ---------------------------------------------------------------------
// Códigos de impuesto — Nota 8.
//
// La numeración TIENE huecos: 09, 10 y 11 no existen. El XSD enumera
// 01..08, 12 y 99. Un bucle de 1 a 12 generaría tres códigos inválidos.
//
// `exigeDatosEspecificos`: los impuestos que se calculan por unidad o
// volumen y no por porcentaje usan el nodo `DatosImpuestoEspecifico`.
// ---------------------------------------------------------------------
export interface FilaCodigoImpuesto extends FilaCatalogo {
  exigeDatosEspecificos?: boolean;
}

export const CODIGOS_IMPUESTO: FilaCodigoImpuesto[] = [
  { codigo: "01", nombre: "Impuesto al valor agregado" },
  { codigo: "02", nombre: "Impuesto selectivo de consumo" },
  { codigo: "03", nombre: "Impuesto único a los combustibles", exigeDatosEspecificos: true },
  {
    codigo: "04",
    nombre: "Impuesto específico de bebidas alcohólicas",
    exigeDatosEspecificos: true,
  },
  {
    codigo: "05",
    nombre:
      "Impuesto específico sobre las bebidas envasadas sin contenido alcohólico y jabones de tocador",
    exigeDatosEspecificos: true,
  },
  { codigo: "06", nombre: "Impuesto a los productos de tabaco", exigeDatosEspecificos: true },
  { codigo: "07", nombre: "IVA (cálculo especial)" },
  { codigo: "08", nombre: "IVA régimen de bienes usados (factor)" },
  { codigo: "12", nombre: "Impuesto específico al cemento", exigeDatosEspecificos: true },
  { codigo: "99", nombre: "Otros", exigeDetalle: true },
];

// ---------------------------------------------------------------------
// Tarifas de IVA — Nota 8.1.
//
// TRES códigos distintos valen 0% y significan cosas fiscales
// diferentes:
//   01 → 0% del artículo 32 num. 1 RLIVA, CON derecho a crédito pleno
//   10 → exenta (Ley 9635, artículo 8)
//   11 → 0% SIN derecho a crédito (no sujeto)
// Elegir mal entre esos tres no cambia el monto cobrado, cambia la
// declaración de IVA del cliente. Por eso el motor nunca deduce el
// código desde la tarifa: va al revés.
//
// `soloEnNotas`: los transitorios 05, 06 y 07 son de uso exclusivo de
// notas de crédito y débito, según las notas al pie 30, 31 y 32.
// ---------------------------------------------------------------------
export interface FilaTarifaIva extends FilaCatalogo {
  tarifa: number;
  soloEnNotas?: boolean;
}

export const TARIFAS_IVA: FilaTarifaIva[] = [
  { codigo: "01", nombre: "Tarifa 0% (artículo 32, num. 1, RLIVA)", tarifa: 0 },
  { codigo: "02", nombre: "Tarifa reducida 1%", tarifa: 1 },
  { codigo: "03", nombre: "Tarifa reducida 2%", tarifa: 2 },
  { codigo: "04", nombre: "Tarifa reducida 4%", tarifa: 4 },
  { codigo: "05", nombre: "Transitorio 0%", tarifa: 0, soloEnNotas: true },
  { codigo: "06", nombre: "Transitorio 4%", tarifa: 4, soloEnNotas: true },
  { codigo: "07", nombre: "Tarifa transitoria 8%", tarifa: 8, soloEnNotas: true },
  { codigo: "08", nombre: "Tarifa general 13%", tarifa: 13 },
  { codigo: "09", nombre: "Tarifa reducida 0,5%", tarifa: 0.5 },
  { codigo: "10", nombre: "Tarifa exenta", tarifa: 0 },
  { codigo: "11", nombre: "Tarifa 0% sin derecho a crédito", tarifa: 0 },
];

/** La tarifa general: el 13% del código 08. Es el caso normal de una clínica. */
export const CODIGO_TARIFA_GENERAL = "08";
/** Exenta: el código 10. NO es el 01 ni el 11, que también valen 0%. */
export const CODIGO_TARIFA_EXENTA = "10";

// ---------------------------------------------------------------------
// Códigos de descuento (lo que el prompt llama "naturaleza del
// descuento") — Nota 20. Obligatorio en 4.4 (bitácora de ajustes #52).
// ---------------------------------------------------------------------
export const CODIGOS_DESCUENTO: FilaCatalogo[] = [
  { codigo: "01", nombre: "Descuento por regalía" },
  { codigo: "02", nombre: "Descuento por regalía o bonificación. IVA cobrado al cliente" },
  { codigo: "03", nombre: "Descuento por bonificación" },
  { codigo: "04", nombre: "Descuento por volumen" },
  { codigo: "05", nombre: "Descuento por temporada (estacional)" },
  { codigo: "06", nombre: "Descuento promocional" },
  { codigo: "07", nombre: "Descuento comercial" },
  { codigo: "08", nombre: "Descuento por frecuencia" },
  { codigo: "09", nombre: "Descuento sostenido" },
  { codigo: "99", nombre: "Otros descuentos", exigeDetalle: true },
];

// ---------------------------------------------------------------------
// Tipos de documento de referencia — Nota 10.
// ---------------------------------------------------------------------
export const TIPOS_DOC_REFERENCIA: FilaCatalogo[] = [
  { codigo: "01", nombre: "Factura electrónica" },
  { codigo: "02", nombre: "Nota de débito electrónica" },
  { codigo: "03", nombre: "Nota de crédito electrónica" },
  { codigo: "04", nombre: "Tiquete electrónico" },
  { codigo: "05", nombre: "Nota de despacho" },
  { codigo: "06", nombre: "Contrato" },
  { codigo: "07", nombre: "Procedimiento" },
  { codigo: "08", nombre: "Comprobante emitido en contingencia" },
  { codigo: "09", nombre: "Devolución de mercadería" },
  { codigo: "10", nombre: "Comprobante electrónico rechazado por el Ministerio de Hacienda" },
  { codigo: "11", nombre: "Sustituye factura rechazada por el receptor del comprobante" },
  { codigo: "12", nombre: "Sustituye factura de exportación" },
  { codigo: "13", nombre: "Facturación mes vencido" },
  { codigo: "14", nombre: "Comprobante aportado por contribuyente de régimen especial" },
  { codigo: "15", nombre: "Sustituye una factura electrónica de compra" },
  { codigo: "16", nombre: "Comprobante de proveedor no domiciliado" },
  { codigo: "17", nombre: "Nota de crédito a factura electrónica de compra" },
  { codigo: "18", nombre: "Nota de débito a factura electrónica de compra" },
  { codigo: "19", nombre: "Factura electrónica de exportación" },
  { codigo: "20", nombre: "Recibo electrónico de pago" },
  { codigo: "99", nombre: "Otros", exigeDetalle: true },
];

// ---------------------------------------------------------------------
// Códigos de referencia — Nota 9.
//
// Otra numeración con hueco: el 03 NO existe. El 17 existe pero es de
// uso exclusivo del Recibo Electrónico de Pago (nota al pie 35), así que
// no está en la enumeración del XSD de factura.
// ---------------------------------------------------------------------
export interface FilaCodigoReferencia extends FilaCatalogo {
  soloEnRep?: boolean;
}

export const CODIGOS_REFERENCIA: FilaCodigoReferencia[] = [
  { codigo: "01", nombre: "Anula documento de referencia" },
  { codigo: "02", nombre: "Corrige monto" },
  { codigo: "04", nombre: "Referencia a otro documento" },
  { codigo: "05", nombre: "Sustituye comprobante provisional por contingencia" },
  { codigo: "06", nombre: "Devolución de mercancía" },
  { codigo: "07", nombre: "Sustituye comprobante electrónico" },
  { codigo: "08", nombre: "Factura endosada" },
  { codigo: "09", nombre: "Nota de crédito financiera" },
  { codigo: "10", nombre: "Nota de débito financiera" },
  { codigo: "11", nombre: "Proveedor no domiciliado" },
  {
    codigo: "12",
    nombre: "Nota de crédito financiera por exoneración posterior a la facturación",
  },
  { codigo: "13", nombre: "Anula documento de referencia por error material" },
  { codigo: "14", nombre: "Corrige monto por error material" },
  { codigo: "15", nombre: "Sustituye comprobante electrónico por error material" },
  { codigo: "16", nombre: "Sustituye comprobante electrónico rechazado" },
  { codigo: "17", nombre: "Pago a comprobante electrónico", soloEnRep: true },
  { codigo: "99", nombre: "Otros", exigeDetalle: true },
];

// ---------------------------------------------------------------------
// Condición del impuesto del mensaje receptor — Nota 18.
//
// Es lo que define si el IVA de una factura de proveedor es acreditable.
// Hoy el facturador solo lo guarda; cuentas por pagar y el IVA
// acreditable lo van a usar más adelante.
// ---------------------------------------------------------------------
export const CONDICIONES_IMPUESTO: FilaCatalogo[] = [
  { codigo: "01", nombre: "Genera crédito IVA" },
  { codigo: "02", nombre: "Genera crédito parcial del IVA" },
  { codigo: "03", nombre: "Bienes de capital" },
  { codigo: "04", nombre: "Gasto corriente no genera crédito" },
  { codigo: "05", nombre: "Proporcionalidad" },
];

// ---------------------------------------------------------------------
// Unidades de medida — Nota 15. Los 101 símbolos que enumera el XSD.
//
// El código ES el símbolo ('Kg', 'Unid', 'Sp', 'm³'…) y va literal al
// XML. Para una clínica veterinaria los que importan son 'Unid'
// (unidad), 'Sp' (servicios profesionales), 'Os' (otro tipo de
// servicio), 'mL', 'Kg' y 'G'.
// ---------------------------------------------------------------------
export interface FilaUnidadMedida {
  codigo: string;
  descripcion: string;
}

export const UNIDADES_MEDIDA: FilaUnidadMedida[] = [
  { codigo: "1", descripcion: "uno (índice de refracción)" },
  { codigo: "´", descripcion: "minuto" },
  { codigo: "´´", descripcion: "segundo" },
  { codigo: "°C", descripcion: "grado Celsius" },
  { codigo: "1/m", descripcion: "1 por metro" },
  { codigo: "A", descripcion: "Ampere" },
  { codigo: "A/m", descripcion: "ampere por metro" },
  { codigo: "A/m²", descripcion: "ampere por metro cuadrado" },
  { codigo: "Acv", descripcion: "Activo Virtual" },
  { codigo: "Al", descripcion: "Alquiler de uso habitacional" },
  { codigo: "Alc", descripcion: "Alquiler de uso comercial" },
  { codigo: "B", descripcion: "bel" },
  { codigo: "Bq", descripcion: "Becquerel" },
  { codigo: "C", descripcion: "coulomb" },
  { codigo: "C/kg", descripcion: "coulomb por kilogramo" },
  { codigo: "C/m²", descripcion: "coulomb por metro cuadrado" },
  { codigo: "C/m³", descripcion: "coulomb por metro cúbico" },
  { codigo: "Cc", descripcion: "Cajuela de café" },
  { codigo: "Cd", descripcion: "Candela" },
  { codigo: "cd/m²", descripcion: "candela por metro cuadrado" },
  { codigo: "Cm", descripcion: "Comisiones" },
  { codigo: "cm", descripcion: "centímetro" },
  { codigo: "Cu", descripcion: "cuartillos de café" },
  { codigo: "D", descripcion: "día" },
  { codigo: "eV", descripcion: "electronvolt" },
  { codigo: "F", descripcion: "farad" },
  { codigo: "F/m", descripcion: "farad por metro" },
  { codigo: "Fa", descripcion: "fanega de café" },
  { codigo: "G", descripcion: "Gramo" },
  { codigo: "Gal", descripcion: "Galón" },
  { codigo: "Gy", descripcion: "gray" },
  { codigo: "Gy/s", descripcion: "gray por segundo" },
  { codigo: "h", descripcion: "hora" },
  { codigo: "H", descripcion: "henry" },
  { codigo: "H/m", descripcion: "henry por metro" },
  { codigo: "Hz", descripcion: "hertz" },
  { codigo: "I", descripcion: "Intereses" },
  { codigo: "J", descripcion: "Joule" },
  { codigo: "J/(kg·K)", descripcion: "joule por kilogramo kelvin" },
  { codigo: "J/(mol·K)", descripcion: "joule por mol kelvin" },
  { codigo: "J/K", descripcion: "joule por kelvin" },
  { codigo: "J/kg", descripcion: "joule por kilogramo" },
  { codigo: "J/m³", descripcion: "joule por metro cúbico" },
  { codigo: "J/mol", descripcion: "joule por mol" },
  { codigo: "K", descripcion: "Kelvin" },
  { codigo: "Kat", descripcion: "katal" },
  { codigo: "kat/m³", descripcion: "katal por metro cúbico" },
  { codigo: "Kg", descripcion: "Kilogramo" },
  { codigo: "kg/m³", descripcion: "kilogramo por metro cúbico" },
  { codigo: "Km", descripcion: "Kilometro" },
  { codigo: "Kw", descripcion: "kilovatios" },
  { codigo: "kWh", descripcion: "Kilovatios por hora" },
  { codigo: "L", descripcion: "litro" },
  { codigo: "Lm", descripcion: "lumen" },
  { codigo: "Ln", descripcion: "pulgada" },
  { codigo: "Lx", descripcion: "lux" },
  { codigo: "M", descripcion: "Metro" },
  { codigo: "m/s", descripcion: "metro por segundo" },
  { codigo: "m/s²", descripcion: "metro por segundo cuadrado" },
  { codigo: "m²", descripcion: "metro cuadrado" },
  { codigo: "m³", descripcion: "metro cúbico" },
  { codigo: "Min", descripcion: "minuto" },
  { codigo: "mL", descripcion: "mililitro" },
  { codigo: "Mm", descripcion: "Milímetro" },
  { codigo: "Mol", descripcion: "Mol" },
  { codigo: "mol/m³", descripcion: "mol por metro cúbico" },
  { codigo: "N", descripcion: "newton" },
  { codigo: "N/m", descripcion: "newton por metro" },
  { codigo: "N·m", descripcion: "newton metro" },
  { codigo: "Np", descripcion: "neper" },
  { codigo: "º", descripcion: "grado" },
  { codigo: "Os", descripcion: "Otro tipo de servicio" },
  { codigo: "Otros", descripcion: "Se debe indicar la descripción de la medida a utilizar" },
  { codigo: "Oz", descripcion: "Onzas" },
  { codigo: "Pa", descripcion: "pascal" },
  { codigo: "Pa·s", descripcion: "pascal segundo" },
  { codigo: "Qq", descripcion: "Quintal" },
  { codigo: "Rad", descripcion: "radián" },
  { codigo: "rad/s", descripcion: "radián por segundo" },
  { codigo: "rad/s²", descripcion: "radián por segundo cuadrado" },
  { codigo: "S", descripcion: "Segundo" },
  { codigo: "s", descripcion: "siemens" },
  { codigo: "Sp", descripcion: "Servicios Profesionales" },
  { codigo: "Spe", descripcion: "Servicios personales" },
  { codigo: "Sr", descripcion: "estereorradián" },
  { codigo: "St", descripcion: "Servicios técnicos" },
  { codigo: "Sv", descripcion: "sievert" },
  { codigo: "t", descripcion: "tesla" },
  { codigo: "T", descripcion: "tonelada" },
  { codigo: "U", descripcion: "unidad de masa atómica unificada" },
  { codigo: "Ua", descripcion: "unidad astronómica" },
  { codigo: "Unid", descripcion: "Unidad" },
  { codigo: "V", descripcion: "volt" },
  { codigo: "V/m", descripcion: "volt por metro" },
  { codigo: "W", descripcion: "Watt" },
  { codigo: "W/(m·K)", descripcion: "watt por metro kevin" },
  { codigo: "W/(m²·sr)", descripcion: "watt por metro cuadrado estereorradián" },
  { codigo: "W/m²", descripcion: "watt por metro cuadrado" },
  { codigo: "W/sr", descripcion: "watt por estereorradián" },
  { codigo: "Wb", descripcion: "weber" },
  { codigo: "Ω", descripcion: "ohm" },
];

// ---------------------------------------------------------------------
// Monedas — Nota 13.1 / `Codigodemoneda_V4.4.pdf`. Los 168 códigos ISO
// 4217 que enumera el XSD, con el nombre de moneda del documento
// oficial.
//
// Son 168 y no 178: el número salió de contar la enumeración real del
// XSD, no de una estimación.
// ---------------------------------------------------------------------
export const MONEDAS: Record<string, string> = {
  AED: "Dírham de los Emiratos Árabes Unidos",
  AFN: "Afghani",
  ALL: "Lek",
  AMD: "Dram armenio",
  ANG: "Florín antillano neerlandés",
  AOA: "Kwanza",
  ARS: "Peso Argentino",
  AUD: "Dólar australiano",
  AWG: "Florín arubeño",
  AZN: "Manat azerbaiyano",
  BAM: "Marco bosnioherzegovino",
  BBD: "Dólar de Barbados",
  BDT: "Taka",
  BGN: "Lev búlgaro",
  BHD: "Dinar de Bahrein",
  BIF: "Franco Burundi",
  BMD: "Dólar de Bermudas",
  BND: "Dólar de Brunei",
  BOB: "Boliviano",
  BOV: "Mvdol",
  BRL: "Real Brasileño",
  BSD: "Dólar de las Bahamas",
  BTN: "Ngultrum",
  BWP: "Pula",
  BYR: "Rublo bielorruso",
  BZD: "Dólar de Belice",
  CAD: "Dólar canadiense",
  CDF: "Franco congoleño",
  CHE: "Euro WIR",
  CHF: "Franco suizo",
  CHW: "Franco WIR",
  CLF: "Unidad de Fomento",
  CLP: "Peso chileno",
  CNY: "Yuan",
  COP: "Peso ColombianO",
  COU: "Unidad de Valor Real",
  CRC: "Colón costarricense",
  CUC: "Peso Convertible",
  CUP: "Peso Cubano",
  CVE: "Cabo Verde Escudo",
  CZK: "Corona checa",
  DJF: "Franco de Djibouti",
  DKK: "Corona danesa",
  DOP: "Peso Dominicano",
  DZD: "Dinar argelino",
  EGP: "Libra egipcia",
  ERN: "Nakfa",
  ETB: "Birr etíope",
  EUR: "Euro",
  FJD: "Dólar de Fiji",
  FKP: "Sin moneda universal ISLAS MALVINAS Libra malvinense",
  GBP: "Libra esterlina",
  GEL: "Lari",
  GHS: "Cedi de Ghana",
  GIP: "Libra de Gibraltar",
  GMD: "Dalasi",
  GNF: "Franco guineano",
  GTQ: "Quetzal",
  GYD: "Dólar guyanés",
  HKD: "Dolar de Hong Kong",
  HNL: "Lempira",
  HRK: "CROAcIA Kuna",
  HTG: "Gourde",
  HUF: "Florín",
  IDR: "Rupia",
  ILS: "Nuevo Shekel Israelí",
  INR: "Rupia india",
  IQD: "Dinar iraquí",
  IRR: "Rial iraní",
  ISK: "Corona islandesa",
  JMD: "Dólar jamaiquino",
  JOD: "Dinar jordano",
  JPY: "Yen",
  KES: "Chelín keniano",
  KGS: "Som",
  KHR: "Riel",
  KMF: "Franco Comoro",
  KPW: "Won norcoreano",
  KRW: "Won",
  KWD: "Dinar kuwaití",
  KYD: "Dólar de las Islas Caimán",
  KZT: "Tenge",
  LAK: "Kip",
  LBP: "Libra libanesa",
  LKR: "Rupia de Sri Lanka",
  LRD: "Dólar liberiano",
  LSL: "Loti",
  LYD: "Dinar libio",
  MAD: "Dirham marroquí",
  MDL: "Leu moldavo",
  MGA: "Ariary malgache",
  MKD: "(Ex República Yugoslava) Denar",
  MMK: "Kyat",
  MNT: "Tugrik",
  MOP: "Pataca",
  MRO: "Ouguiya",
  MUR: "Rupia de Mauricio",
  MVR: "Rufiyaa",
  MWK: "Kwacha",
  MXN: "Peso MexicanO",
  MXV: "Unidad de Inversion Mexicana (UDI)",
  MYR: "Ringgit malayo",
  MZN: "Metical mozambiqueño",
  NAD: "Dólar de Namibia",
  NGN: "Naira",
  NIO: "Cordoba Oro",
  NOK: "Corona noruega",
  NPR: "Rupia nepalí",
  NZD: "Dólar neozelandés",
  OMR: "Rial omaní",
  PAB: "PALESTINA, ESTADO DE Sin moneda universal PANAMÁ Balboa",
  PEN: "PERú Nuevo Sol",
  PGK: "Kina",
  PHP: "Peso filipino",
  PKR: "Rupia pakistaní",
  PLN: "Zloty",
  PYG: "Guaraní",
  QAR: "Riyal catarí",
  RON: "Leu rumano",
  RSD: "Dinar serbio",
  RUB: "Rublo ruso",
  RWF: "Franco ruandés",
  SAR: "Sin moneda universal ARABIA SAUDITA Riyal saudí",
  SBD: "Dólar de las Islas Salomón",
  SCR: "Rupia seychelense",
  SDG: "Libra sudanesa",
  SEK: "Corona sueca",
  SGD: "Dolar de Singapur",
  SHP: "ELENA, ASCENSIÓN Y TRISTÁN DE ACUÑA Libra de Santa Helena",
  SLL: "Leone",
  SOS: "Chelín somalí",
  SRD: "Dólar surinamés",
  SSP: "Libra sursudanesa",
  STD: "Dobra",
  SVC: "Colón",
  SYP: "Libra Siria",
  SZL: "Lilangeni",
  THB: "Baht",
  TJS: "Somoni",
  TMT: "Manat turcomano",
  TND: "Dinar tunecino",
  TOP: "Pa’anga",
  TRY: "Lira turca",
  TTD: "Dólar trinitense",
  TWD: "Nuevo dólar taiwanés",
  TZS: "TANZANIA, REPÚBLICA UNIDA DE Chelín tanzano",
  UAH: "Hryvnia",
  UGX: "Chelín ugandés",
  USD: "Dólar Americano",
  USN: "Dólar Americano (Next day)",
  UYI: "Uruguay Peso en Unidades Indexadas (URUIURUI)",
  UYU: "Peso Uruguayo",
  UZS: "Som uzbeko",
  VEF: "Bolívar",
  VND: "Dong",
  VUV: "Vatu",
  WST: "Tala",
  XAF: "Franco CFA BEAC",
  XCD: "Dólar del Caribe Oriental",
  XDR: "SDR (Derechos Especiales de Giro)",
  XOF: "Franco CFA BCEAO",
  XPF: "Franc",
  XSU: "Sucre",
  XUA: "Unidad de cuenta del BAD",
  YER: "Rial yemení",
  ZAR: "Rand",
  ZMW: "Kwacha zambiano",
  ZWL: "Dólar zimbabuense",
};

/** Moneda local. El `TipoCambio` del XML vale 1 cuando se factura en colones. */
export const MONEDA_LOCAL = "CRC";
