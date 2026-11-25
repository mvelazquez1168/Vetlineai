import {
  CERO,
  aMonto,
  deMonto,
  multiplicar,
  porcentajeDe,
  redondearDivision,
  restar,
  sumar,
} from "./decimal";
import { CODIGOS_IMPUESTO, TARIFAS_IVA } from "./catalogos";
import { DocumentoVenta, LineaDocumento } from "./tipos";

// ---------------------------------------------------------------------
// Cálculo de impuestos, descuentos y totales de un comprobante.
//
// Cada fórmula de este archivo está copiada del Anexo 1 del
// `ANEXOS_Y_ESTRUCTURAS_V4.4.pdf`, con la definición del campo citada en
// el comentario. No hay ninguna fórmula deducida: Hacienda VALIDA los
// totales contra la suma de las líneas y rechaza el comprobante si no
// cuadran, así que "parece razonable" no alcanza.
//
// Todo lo monetario es BigInt en cienmilésimas (ver `decimal.ts`): con
// punto flotante una factura de veinte líneas puede quedar desviada un
// céntimo, y el rechazo de Hacienda no dice dónde.
// ---------------------------------------------------------------------

/**
 * Los códigos de impuesto que suman a la BASE IMPONIBLE del IVA.
 *
 * Anexo, campo "Base Imponible": "Se obtiene de la suma entre el campo
 * Subtotal, más el impuesto selectivo de consumo (02), el Impuesto
 * específico de Bebidas Alcohólicas (04), el Impuesto Específico sobre
 * las bebidas envasadas sin contenido alcohólico y jabones de tocador
 * (05) y el impuesto al cemento (12), cuando corresponda."
 *
 * O sea: el IVA se cobra SOBRE esos impuestos. No está el 03
 * (combustibles) y eso no es un olvido de la transcripción — la norma no
 * lo lista.
 */
const IMPUESTOS_QUE_SUMAN_A_LA_BASE = ["02", "04", "05", "12"];

/** Código de impuesto del IVA. */
const IMPUESTO_IVA = "01";
/** IVA con cálculo especial: la base imponible la manda quien factura. */
const IMPUESTO_IVA_ESPECIAL = "07";
/** IVA del régimen de bienes usados: se calcula con un factor sobre el subtotal. */
const IMPUESTO_IVA_FACTOR = "08";

/**
 * Códigos de la Nota 20 que vuelven obligatorio el "impuesto asumido por
 * el emisor". Anexo, campo "ImpuestoAsumidoEmisorFabrica": obligatorio
 * cuando la línea usa "los códigos 01 de Regalías o código 03 de
 * Bonificaciones".
 */
const DESCUENTOS_CON_IMPUESTO_ASUMIDO = ["01", "03"];

/** Nota 8.1: el código 10 es "tarifa exenta". */
const TARIFA_EXENTA = "10";
/**
 * Nota 8.1 + Anexo, campo "TotalServNoSujeto": no sujeto son los códigos
 * de tarifa **01 y 11**. Los dos valen 0%, igual que el 10, y los tres
 * suman en totales DISTINTOS del resumen.
 */
const TARIFAS_NO_SUJETO = ["01", "11"];

/**
 * Anexo, campo "TotalServGravados": "En caso que en el campo Código de
 * bien o servicio se utilicen códigos que empiecen con: 5,6,7,8,9 del
 * CAByS". Ese primer dígito es lo único que distingue un servicio de una
 * mercancía, y de eso depende en qué total suma la línea.
 */
const PRIMEROS_DIGITOS_CABYS_SERVICIO = ["5", "6", "7", "8", "9"];

export function esServicio(codigoCabys: string | undefined): boolean {
  if (!codigoCabys) {
    // Sin CABYS no se puede clasificar. Pasa en el Recibo Electrónico de
    // Pago, cuyas líneas no llevan CABYS y cuyo resumen no tiene los
    // totales por servicio/mercancía. Tratarlo como mercancía "porque
    // hay que elegir" pondría montos en un total que el REP no debería
    // llevar.
    return false;
  }
  return PRIMEROS_DIGITOS_CABYS_SERVICIO.includes(codigoCabys[0]);
}

function tarifaDeCodigo(codigoTarifa: string): bigint {
  const fila = TARIFAS_IVA.find((t) => t.codigo === codigoTarifa);
  if (!fila) {
    throw new Error(
      `Código de tarifa de IVA "${codigoTarifa}" desconocido. Los de la Nota 8.1 son ${TARIFAS_IVA.map((t) => t.codigo).join(", ")}.`
    );
  }
  return aMonto(fila.tarifa);
}

// ---------------------------------------------------------------------
// Resultado del cálculo
// ---------------------------------------------------------------------

export interface ImpuestoCalculado {
  codigo: string;
  codigoOtro?: string;
  codigoTarifaIva?: string;
  /** Porcentaje como entero: 13 para el 13%. */
  tarifa?: bigint;
  factorCalculoIva?: bigint;
  datosEspecificos?: {
    cantidadUnidadMedida: bigint;
    porcentaje?: bigint;
    proporcion?: bigint;
    volumenUnidadConsumo?: bigint;
    impuestoUnidad: bigint;
  };
  /** El monto del impuesto antes de exoneración. */
  monto: bigint;
  exoneracion?: {
    tarifaExonerada: bigint;
    monto: bigint;
  };
}

export interface LineaCalculada {
  numeroLinea: number;
  codigoCabys?: string;
  esServicio: boolean;
  cantidad: bigint;
  precioUnitario: bigint;
  montoTotal: bigint;
  totalDescuentos: bigint;
  subtotal: bigint;
  baseImponible: bigint;
  impuestos: ImpuestoCalculado[];
  /** Suma de los montos de impuesto de la línea, sin restar nada. */
  montoImpuesto: bigint;
  montoExonerado: bigint;
  impuestoAsumidoEmisorFabrica: bigint;
  impuestoNeto: bigint;
  montoTotalLinea: bigint;
}

export interface DesgloseImpuesto {
  codigo: string;
  codigoTarifaIva?: string;
  totalMontoImpuesto: bigint;
}

export interface ResumenCalculado {
  totalServGravados: bigint;
  totalServExentos: bigint;
  totalServExonerado: bigint;
  totalServNoSujeto: bigint;
  totalMercGravadas: bigint;
  totalMercExentas: bigint;
  totalMercExonerada: bigint;
  totalMercNoSujeta: bigint;
  totalGravado: bigint;
  totalExento: bigint;
  totalExonerado: bigint;
  totalNoSujeto: bigint;
  totalVenta: bigint;
  totalDescuentos: bigint;
  totalVentaNeta: bigint;
  desgloseImpuesto: DesgloseImpuesto[];
  totalImpuesto: bigint;
  totalImpAsumEmisorFabrica: bigint;
  totalIvaDevuelto: bigint;
  totalOtrosCargos: bigint;
  totalComprobante: bigint;
}

export interface ComprobanteCalculado {
  lineas: LineaCalculada[];
  resumen: ResumenCalculado;
}

// ---------------------------------------------------------------------
// Cálculo por línea
// ---------------------------------------------------------------------

export function calcularLinea(linea: LineaDocumento, numeroLinea: number): LineaCalculada {
  if (!linea.impuestos || linea.impuestos.length === 0) {
    throw new Error(
      `La línea ${numeroLinea} no tiene ningún impuesto. El XSD exige al menos uno: una línea exenta va con código de impuesto 01 y código de tarifa 10, no sin impuesto.`
    );
  }

  const cantidad = aMonto(linea.cantidad);
  const precioUnitario = aMonto(linea.precioUnitario);

  // Anexo, "MontoTotal": cantidad × precio unitario.
  const montoTotal = multiplicar(cantidad, precioUnitario);

  // Anexo, "TotalDescuentos": suma de los montos de descuento.
  const descuentos = (linea.descuentos ?? []).map((d) => aMonto(d.monto));
  const totalDescuentos = sumar(...descuentos);
  if (totalDescuentos > montoTotal) {
    throw new Error(
      `La línea ${numeroLinea} tiene ${deMonto(totalDescuentos)} de descuento sobre un monto total de ${deMonto(montoTotal)}: el subtotal quedaría negativo.`
    );
  }

  // Anexo, "SubTotal": monto total − descuentos.
  const subtotal = restar(montoTotal, totalDescuentos);

  // Anexo, "Base Imponible": subtotal + los impuestos 02, 04, 05 y 12 de
  // la misma línea. Se calculan primero porque el IVA se cobra sobre
  // ellos.
  const especificos = linea.impuestos.filter((i) =>
    IMPUESTOS_QUE_SUMAN_A_LA_BASE.includes(i.codigo)
  );
  const montosEspecificos = especificos.map((i) => calcularMontoEspecifico(i, cantidad, numeroLinea));
  const baseCalculada = sumar(subtotal, ...montosEspecificos);

  // La norma permite EDITAR la base imponible en dos casos y solo en
  // esos dos: código de impuesto 07, o IVA cobrado a nivel de fábrica
  // código 01. Fuera de ahí, recibirla es un error — serían dos fuentes
  // para el mismo número y Hacienda valida la del cálculo.
  const puedeEditarBase =
    linea.impuestos.some((i) => i.codigo === IMPUESTO_IVA_ESPECIAL) ||
    linea.ivaCobradoFabrica === "01";
  if (linea.baseImponibleEditada !== undefined && !puedeEditarBase) {
    throw new Error(
      `La línea ${numeroLinea} manda una base imponible editada, pero la norma solo lo permite con el código de impuesto 07 o con IVA cobrado a nivel de fábrica código 01. En cualquier otro caso la base imponible se calcula.`
    );
  }
  if (puedeEditarBase && linea.baseImponibleEditada === undefined) {
    throw new Error(
      `La línea ${numeroLinea} usa el código de impuesto 07 o IVA cobrado a nivel de fábrica código 01, que obligan a indicar la base imponible (Anexo, campo "Base Imponible": "deberá incluirse un valor mayor a cero").`
    );
  }
  const baseImponible =
    linea.baseImponibleEditada !== undefined ? aMonto(linea.baseImponibleEditada) : baseCalculada;

  // Los códigos de descuento 01 (regalías) y 03 (bonificaciones) cambian
  // la base del IVA: Anexo, campo "Monto": "Al utilizar el código de
  // Naturaleza del Descuento 01 correspondiente a Regalías o 03 de
  // Bonificaciones y el código de impuesto 01, se debe utilizar para el
  // cálculo del impuesto el campo denominado Monto Total y la Tarifa".
  // Es decir: sobre el monto SIN descontar.
  const hayRegaliaOBonificacion = (linea.descuentos ?? []).some((d) =>
    DESCUENTOS_CON_IMPUESTO_ASUMIDO.includes(d.codigoDescuento)
  );

  const impuestos: ImpuestoCalculado[] = linea.impuestos.map((imp) => {
    const indiceEspecifico = especificos.indexOf(imp);
    const monto =
      indiceEspecifico >= 0
        ? montosEspecificos[indiceEspecifico]
        : calcularMontoIva(imp, {
            numeroLinea,
            baseImponible,
            subtotal,
            montoTotal,
            hayRegaliaOBonificacion,
          });

    const calculado: ImpuestoCalculado = {
      codigo: imp.codigo,
      codigoOtro: imp.codigoOtro,
      codigoTarifaIva: imp.codigoTarifaIva,
      tarifa: imp.codigoTarifaIva ? tarifaDeCodigo(imp.codigoTarifaIva) : undefined,
      factorCalculoIva: imp.factorCalculoIva !== undefined ? aMonto(imp.factorCalculoIva) : undefined,
      monto,
    };

    if (imp.datosEspecificos) {
      calculado.datosEspecificos = {
        cantidadUnidadMedida: aMonto(imp.datosEspecificos.cantidadUnidadMedida),
        porcentaje:
          imp.datosEspecificos.porcentaje !== undefined
            ? aMonto(imp.datosEspecificos.porcentaje)
            : undefined,
        proporcion:
          imp.datosEspecificos.proporcion !== undefined
            ? aMonto(imp.datosEspecificos.proporcion)
            : undefined,
        volumenUnidadConsumo:
          imp.datosEspecificos.volumenUnidadConsumo !== undefined
            ? aMonto(imp.datosEspecificos.volumenUnidadConsumo)
            : undefined,
        impuestoUnidad: aMonto(imp.datosEspecificos.impuestoUnidad),
      };
    }

    if (imp.exoneracion) {
      // Anexo, campo "MontoExoneracion": "Dicho monto se obtiene de la
      // multiplicación del campo Tarifa exonerada por el campo Subtotal
      // o base imponible en caso de contar con esta."
      const tarifaExonerada = aMonto(imp.exoneracion.tarifaExonerada);
      let montoExoneracion = porcentajeDe(baseImponible, tarifaExonerada);
      // "el mismo no podrá ser superior al campo monto del impuesto".
      if (montoExoneracion > monto) montoExoneracion = monto;
      calculado.exoneracion = { tarifaExonerada, monto: montoExoneracion };
    }

    return calculado;
  });

  const montoImpuesto = sumar(...impuestos.map((i) => i.monto));
  const montoExonerado = sumar(...impuestos.map((i) => i.exoneracion?.monto ?? CERO));

  // Anexo, "ImpuestoAsumidoEmisorFabrica": "Se obtiene de la sumatoria
  // del Monto de los Impuestos calculados a productos definidos como:
  // Regalías o bonificaciones, Con IVA cobrado a nivel de fábrica,
  // Impuestos específicos cobrados a nivel de fábrica. En caso de no
  // aplicarse estos impuestos, se deberá agregar el valor 0 y en caso de
  // aplicarse una exoneración se calculará como la resta entre el Monto
  // del Impuesto menos el Monto Exonerado."
  const ivaDeLaLinea = sumar(
    ...impuestos
      .filter((i) => i.codigo === IMPUESTO_IVA || i.codigo === IMPUESTO_IVA_ESPECIAL)
      .map((i) => restar(i.monto, i.exoneracion?.monto ?? CERO))
  );
  const impuestoAsumidoEmisorFabrica =
    hayRegaliaOBonificacion || linea.ivaCobradoFabrica === "01" ? ivaDeLaLinea : CERO;

  // Anexo, "ImpuestoNeto": "Este monto se obtiene al restar el campo
  // Monto del Impuesto menos Monto del Impuesto Exonerado o el campo
  // Impuestos Asumidos por el Emisor o cobrado a Nivel de Fábrica cuando
  // corresponda."
  const impuestoNeto = restar(restar(montoImpuesto, montoExonerado), impuestoAsumidoEmisorFabrica);

  // Anexo, "MontoTotalLinea": "Es la sumatoria de los campos Subtotal e
  // Impuesto Neto." (Bitácora 4.4.0 #95 lo ajustó a exactamente esos
  // dos: antes la descripción admitía otra lectura.)
  const montoTotalLinea = sumar(subtotal, impuestoNeto);

  return {
    numeroLinea,
    codigoCabys: linea.codigoCabys,
    esServicio: esServicio(linea.codigoCabys),
    cantidad,
    precioUnitario,
    montoTotal,
    totalDescuentos,
    subtotal,
    baseImponible,
    impuestos,
    montoImpuesto,
    montoExonerado,
    impuestoAsumidoEmisorFabrica,
    impuestoNeto,
    montoTotalLinea,
  };
}

/**
 * El monto de un impuesto específico (combustibles 03, bebidas
 * alcohólicas 04, bebidas sin alcohol y jabones 05, tabaco 06, cemento
 * 12).
 *
 * Anexo, "Cálculo Impuesto Único a los Combustibles": "Se obtiene de la
 * multiplicación del campo Cantidad de la unidad de medida a utilizar
 * por el campo Impuesto por Unidad". Los otros específicos siguen la
 * misma forma; el selectivo de consumo (02) la norma lo deja en "se debe
 * calcular conforme a la norma que regule este impuesto indicándose el
 * monto correspondiente" — o sea que el monto lo pone quien factura, y
 * acá se respeta en vez de inventarle una fórmula.
 */
function calcularMontoEspecifico(
  imp: { codigo: string; datosEspecificos?: { cantidadUnidadMedida: string | number; impuestoUnidad: string | number } },
  _cantidadLinea: bigint,
  numeroLinea: number
): bigint {
  const fila = CODIGOS_IMPUESTO.find((c) => c.codigo === imp.codigo);

  if (!imp.datosEspecificos) {
    if (fila?.exigeDatosEspecificos) {
      throw new Error(
        `La línea ${numeroLinea} usa el código de impuesto ${imp.codigo} (${fila.nombre}), que obliga el nodo de datos para impuestos específicos con la cantidad de unidad de medida y el impuesto por unidad.`
      );
    }
    // Selectivo de consumo (02) sin datos específicos: no hay fórmula en
    // la norma y no se puede inventar una. Se reporta en vez de poner 0.
    throw new Error(
      `La línea ${numeroLinea} usa el código de impuesto ${imp.codigo} sin datos para impuestos específicos. La norma no define una fórmula para calcularlo: hay que indicar la cantidad de unidad de medida y el impuesto por unidad.`
    );
  }

  return multiplicar(
    aMonto(imp.datosEspecificos.cantidadUnidadMedida),
    aMonto(imp.datosEspecificos.impuestoUnidad)
  );
}

function calcularMontoIva(
  imp: {
    codigo: string;
    codigoTarifaIva?: string;
    factorCalculoIva?: string | number;
  },
  ctx: {
    numeroLinea: number;
    baseImponible: bigint;
    subtotal: bigint;
    montoTotal: bigint;
    hayRegaliaOBonificacion: boolean;
  }
): bigint {
  // Código 08: régimen de bienes usados. Anexo, campo "Codigo": "Al
  // utilizar el código 08, se debe utilizar para el cálculo de factor del
  // IVA por el subtotal."
  if (imp.codigo === IMPUESTO_IVA_FACTOR) {
    if (imp.factorCalculoIva === undefined) {
      throw new Error(
        `La línea ${ctx.numeroLinea} usa el código de impuesto 08 (régimen de bienes usados) sin factor de cálculo del IVA, que es con lo que se calcula el impuesto.`
      );
    }
    return multiplicar(ctx.subtotal, aMonto(imp.factorCalculoIva));
  }

  if (imp.codigo === IMPUESTO_IVA || imp.codigo === IMPUESTO_IVA_ESPECIAL) {
    if (!imp.codigoTarifaIva) {
      throw new Error(
        `La línea ${ctx.numeroLinea} usa el código de impuesto ${imp.codigo} (IVA) sin código de tarifa. El XSD lo vuelve obligatorio para los códigos 01 y 07 de la Nota 8.`
      );
    }

    // "Cuando se utilice el código 10 de tarifa exenta, se deberá de
    // indicar 0 en este campo." La tarifa del código 10 ya es 0, así que
    // la multiplicación daría 0 igual; está explícito porque también
    // vale para los códigos 01 y 11, que valen 0 por otros motivos.
    const tarifa = tarifaDeCodigo(imp.codigoTarifaIva);
    if (tarifa === CERO) return CERO;

    // Regalías o bonificaciones: el IVA se calcula sobre el monto total,
    // sin descontar.
    const base = ctx.hayRegaliaOBonificacion ? ctx.montoTotal : ctx.baseImponible;
    return porcentajeDe(base, tarifa);
  }

  // Cualquier otro código (99 "Otros", o el 02/06 sin datos
  // específicos): la norma no da fórmula. Llegar acá es un error de
  // datos, no un 0.
  throw new Error(
    `La línea ${ctx.numeroLinea} usa el código de impuesto "${imp.codigo}" y la norma no define cómo calcular su monto a partir de una tarifa. Hay que indicar el monto por el nodo de datos para impuestos específicos.`
  );
}

// ---------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------

export function calcularComprobante(documento: DocumentoVenta): ComprobanteCalculado {
  if (!documento.lineas || documento.lineas.length === 0) {
    throw new Error("El documento de venta no tiene ninguna línea de detalle.");
  }
  if (documento.lineas.length > 1000) {
    throw new Error(
      `El documento de venta tiene ${documento.lineas.length} líneas y el XSD admite hasta 1000 (LineaDetalle maxOccurs="1000").`
    );
  }

  const lineas = documento.lineas.map((l, i) => calcularLinea(l, i + 1));
  const esRep = documento.tipoComprobante === "10";

  // -------------------------------------------------------------------
  // Los cuatro estados del IVA por línea: gravado, exento (tarifa 10),
  // no sujeto (tarifas 01 y 11) y exonerado (con documento de
  // exoneración). Son excluyentes para clasificar el monto de la línea,
  // y la exoneración es un REPARTO del monto gravado, no un quinto
  // estado: la norma lo define como "el porcentaje exonerado por el
  // monto total".
  // -------------------------------------------------------------------
  let totalServGravados = CERO;
  let totalServExentos = CERO;
  let totalServExonerado = CERO;
  let totalServNoSujeto = CERO;
  let totalMercGravadas = CERO;
  let totalMercExentas = CERO;
  let totalMercExonerada = CERO;
  let totalMercNoSujeta = CERO;

  for (const linea of lineas) {
    const codigosTarifa = linea.impuestos
      .map((i) => i.codigoTarifaIva)
      .filter((c): c is string => !!c);

    const exenta = codigosTarifa.length > 0 && codigosTarifa.every((c) => c === TARIFA_EXENTA);
    const noSujeta =
      codigosTarifa.length > 0 && codigosTarifa.every((c) => TARIFAS_NO_SUJETO.includes(c));

    // Anexo, "TotalServExonerado": "Se obtiene de la multiplicación del
    // porcentaje de la exoneración por el monto total del servicio.
    // Porcentaje de exoneración: (Suma de los montos exonerados / Suma
    // de los montos de impuesto)".
    //
    // Y "TotalServGravados": "En el caso que exista una exoneración este
    // campo se obtiene de la multiplicación (1 - porcentaje de
    // exoneración) por el monto total de la venta de servicios".
    //
    // Las dos partes se calculan a la vez y la gravada sale por RESTA,
    // no por su propia multiplicación: así la suma de las dos es
    // exactamente el monto de la línea y no queda un céntimo de
    // diferencia por redondeo doble — que es lo que Hacienda valida.
    let parteExonerada = CERO;
    if (linea.montoExonerado > CERO && linea.montoImpuesto > CERO) {
      // subtotal × (montoExonerado / montoImpuesto), en UNA sola
      // división y no en dos pasos. Calcular primero la proporción y
      // después multiplicar pierde precisión: la proporción solo tiene 5
      // decimales, y 10 000/13 000 = 0,769230769… redondeado a 0,76923
      // da 76 923,00000 en vez de 76 923,07692. Medido: fue el único
      // caso de cálculo que falló en la primera corrida del verificador.
      parteExonerada = redondearDivision(
        linea.subtotal * linea.montoExonerado,
        linea.montoImpuesto
      );
      if (parteExonerada > linea.subtotal) parteExonerada = linea.subtotal;
    }
    const parteGravada = restar(linea.subtotal, parteExonerada);

    if (linea.esServicio) {
      if (exenta) totalServExentos = sumar(totalServExentos, linea.subtotal);
      else if (noSujeta) totalServNoSujeto = sumar(totalServNoSujeto, linea.subtotal);
      else {
        totalServGravados = sumar(totalServGravados, parteGravada);
        totalServExonerado = sumar(totalServExonerado, parteExonerada);
      }
    } else if (!esRep) {
      if (exenta) totalMercExentas = sumar(totalMercExentas, linea.subtotal);
      else if (noSujeta) totalMercNoSujeta = sumar(totalMercNoSujeta, linea.subtotal);
      else {
        totalMercGravadas = sumar(totalMercGravadas, parteGravada);
        totalMercExonerada = sumar(totalMercExonerada, parteExonerada);
      }
    }
  }

  // Anexo: total gravado = servicios gravados + mercancías gravadas, y
  // así los cuatro.
  const totalGravado = sumar(totalServGravados, totalMercGravadas);
  const totalExento = sumar(totalServExentos, totalMercExentas);
  const totalExonerado = sumar(totalServExonerado, totalMercExonerada);
  const totalNoSujeto = sumar(totalServNoSujeto, totalMercNoSujeta);

  // Anexo, "TotalDescuentos": suma de todos los descuentos.
  const totalDescuentos = sumar(...lineas.map((l) => l.totalDescuentos));

  // Anexo, "TotalVenta": "sumatoria de los campos total gravado, total
  // exento, Total Exonerado y Total No Sujeto". Esos cuatro se calcularon
  // sobre el SUBTOTAL de cada línea (ya con descuento), así que para que
  // "TotalVentaNeta = TotalVenta − TotalDescuentos" cierre, el total de
  // venta tiene que ser el monto ANTES de descuentos.
  //
  // En el REP la norma lo define distinto: "se obtiene de la suma de los
  // montos totales de las líneas de detalle".
  const totalVenta = esRep
    ? sumar(...lineas.map((l) => l.montoTotal))
    : sumar(totalGravado, totalExento, totalExonerado, totalNoSujeto, totalDescuentos);

  // Anexo, "TotalVentaNeta": total venta − total descuentos.
  const totalVentaNeta = restar(totalVenta, totalDescuentos);

  // -------------------------------------------------------------------
  // Desglose por impuesto. Anexo, "TotalDesgloseImpuesto": "se obtiene
  // de la suma de los campos denominados Monto del impuesto de las
  // líneas que no poseen exoneración más todos los Impuestos Netos de
  // las líneas que sí poseen exoneración o se calculen en el campo
  // Impuestos Asumidos por el Emisor". "Se repetirán la cantidad de
  // códigos de impuestos que se hayan incluido en las líneas de
  // detalle", agrupando por código de impuesto Y código de tarifa.
  // -------------------------------------------------------------------
  const porClave = new Map<string, DesgloseImpuesto>();
  for (const linea of lineas) {
    for (const imp of linea.impuestos) {
      const clave = `${imp.codigo}|${imp.codigoTarifaIva ?? ""}`;
      const aporte = imp.exoneracion || linea.impuestoAsumidoEmisorFabrica > CERO
        ? restar(restar(imp.monto, imp.exoneracion?.monto ?? CERO), linea.impuestoAsumidoEmisorFabrica)
        : imp.monto;
      const existente = porClave.get(clave);
      if (existente) {
        existente.totalMontoImpuesto = sumar(existente.totalMontoImpuesto, aporte);
      } else {
        porClave.set(clave, {
          codigo: imp.codigo,
          codigoTarifaIva: imp.codigoTarifaIva,
          totalMontoImpuesto: aporte,
        });
      }
    }
  }
  const desgloseImpuesto = Array.from(porClave.values());

  // Anexo, "TotalImpuesto": la misma definición que el desglose, pero
  // sumado. Se calcula a partir del desglose para que las dos cifras no
  // puedan diferir — si se calculara aparte, un cambio en una sola de
  // las dos fórmulas pasaría desapercibido hasta que Hacienda rechace.
  const totalImpuesto = sumar(...desgloseImpuesto.map((d) => d.totalMontoImpuesto));

  // Anexo, "TotalImpAsumEmisorFabrica": suma de los de cada línea.
  const totalImpAsumEmisorFabrica = sumar(...lineas.map((l) => l.impuestoAsumidoEmisorFabrica));

  // Anexo, "TotalOtrosCargos": suma de los montos de cargo.
  const totalOtrosCargos = sumar(...(documento.otrosCargos ?? []).map((c) => aMonto(c.monto)));

  // "TotalIVADevuelto" es obligatorio al facturar SERVICIOS DE SALUD
  // pagados con tarjeta. Queda en 0 y no se calcula: el régimen de
  // devolución del IVA aplica a servicios de salud HUMANA, y los CABYS
  // de medicina veterinaria no están en ese supuesto. Si algún día una
  // clínica factura un servicio que sí califique, esto hay que
  // implementarlo con la fórmula del Anexo —
  // (monto pagado con tarjeta / venta neta) × monto del impuesto — y no
  // dejarlo en 0.
  const totalIvaDevuelto = CERO;

  // Anexo, "TotalComprobante": "se obtiene de la suma de los campos
  // total venta neta, monto total del impuesto y total otros cargos
  // menos total IVA devuelto". En el REP: "se obtiene de la suma de los
  // campos Total de la venta".
  const totalComprobante = esRep
    ? sumar(totalVentaNeta, totalImpuesto)
    : restar(sumar(totalVentaNeta, totalImpuesto, totalOtrosCargos), totalIvaDevuelto);

  // Si hay más de un medio de pago, la suma tiene que dar el total del
  // comprobante — Hacienda lo valida. Mejor fallar acá, donde se puede
  // decir cuánto falta, que recibir un rechazo sin detalle.
  const medios = documento.mediosPago ?? [];
  if (medios.length > 1) {
    const sumaMedios = sumar(...medios.map((m) => (m.monto !== undefined ? aMonto(m.monto) : CERO)));
    if (sumaMedios !== totalComprobante) {
      throw new Error(
        `Los medios de pago suman ${deMonto(sumaMedios)} y el total del comprobante es ${deMonto(totalComprobante)}. ` +
          `Con dos o más medios de pago, Hacienda valida que coincidan (Anexo, campo "TotalComprobante").`
      );
    }
  }

  return {
    lineas,
    resumen: {
      totalServGravados,
      totalServExentos,
      totalServExonerado,
      totalServNoSujeto,
      totalMercGravadas,
      totalMercExentas,
      totalMercExonerada,
      totalMercNoSujeta,
      totalGravado,
      totalExento,
      totalExonerado,
      totalNoSujeto,
      totalVenta,
      totalDescuentos,
      totalVentaNeta,
      desgloseImpuesto,
      totalImpuesto,
      totalImpAsumEmisorFabrica,
      totalIvaDevuelto,
      totalOtrosCargos,
      totalComprobante,
    },
  };
}
