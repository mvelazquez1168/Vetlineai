import { PoolClient } from "pg";
import { registrarInteraccion } from "../crm/interacciones";
import { conAlcanceTenant } from "../alcanceTenant";
import { emitir } from "../facturacion/emision";
import { DocumentoVenta } from "../facturacion/tipos";
import { tipoDeCambioDelDia } from "./caja";
import { lineasParaFacturar, totalDeCuenta } from "./cuentas";
import { Deudor, aplicarAnticipos, deudorCliente, saldoAFavor } from "./credito";
import { EleccionReceptor, resolverReceptor } from "../facturacion/perfilesFacturacion";

// ---------------------------------------------------------------------
// COBROS.
//
// Un cobro paga una cuenta, total o parcialmente, y puede combinar
// varios medios (pago mixto). El comprobante lo emite el facturador por
// su API; acá queda la referencia.
//
// DÓLARES. El cliente entrega dólares, el sistema los convierte al tipo
// del día y **el vuelto se da en colones**, que es como cobra la
// clínica. Por eso cada medio guarda su moneda, su tipo de cambio y su
// equivalente en colones: el arqueo necesita los dólares por separado
// (se cuentan dólares) y el total de la cuenta necesita los colones.
//
// EL TIPO DE CAMBIO SE CONGELA EN EL COBRO. Guardarlo en la fila y no
// mirarlo después significa que un cobro de la semana pasada sigue
// diciendo a cuánto se convirtió, aunque hoy el dólar esté en otro
// valor.
//
// EL ORDEN: primero se emite el comprobante, después se registra el
// cobro. Si se registrara primero y la emisión fallara, habría dinero
// cobrado sin comprobante y nadie lo notaría hasta el cierre.
// ---------------------------------------------------------------------

export interface MedioCobro {
  /** Código de Hacienda (Nota 6) o `anticipo`/`credito`. */
  medio: string;
  moneda?: string;
  /** Lo que entrega el cliente, en SU moneda. */
  monto: number;
  referencia?: string;
}

export interface SolicitudCobro {
  cuentaId: string;
  sesionId: string;
  medios: MedioCobro[];
  /**
   * A NOMBRE DE QUIÉN SALE LA FACTURA (sección 3 bis del prompt 08).
   *
   * Las cuatro opciones las resuelve `resolverReceptor`, el mismo punto
   * único que usa la pantalla "Emitir" del facturador: el dueño, un
   * perfil guardado de ese cliente, cualquier cliente o perfil
   * existente, o uno nuevo. Sin elección se usa `receptor` tal como
   * venga (lo que ya hacía), y sin ninguno de los dos sale tiquete.
   */
  eleccionReceptor?: EleccionReceptor;
  /** `01` factura (exige receptor identificado) o `04` tiquete. */
  tipoComprobante?: "01" | "04";
  /**
   * LA MONEDA DEL COMPROBANTE. Por defecto colones, "salvo que el
   * cliente pida factura en dólares" (prompt 08, §3).
   *
   * Es independiente de la moneda con la que PAGA: se puede pagar en
   * colones una factura en dólares y al revés. Los montos del
   * comprobante se convierten con el tipo de cambio del día, el mismo
   * que usa el arqueo, y ese tipo queda guardado en el comprobante —
   * Hacienda lo exige y además es lo que hace la factura reconstruible.
   */
  monedaComprobante?: string;
  /** Para una venta a crédito: condición 02 o 10, con su plazo. */
  condicionVenta?: string;
  plazoCreditoDias?: number;
  receptor?: DocumentoVenta["receptor"];
  observaciones?: string;
  personaId?: string;
}

export interface ResultadoCobro {
  cobroId: string;
  total: number;
  recibidoCrc: number;
  vueltoCrc: number;
  comprobanteId?: string;
  consecutivo?: string;
  estadoComprobante?: string;
}

/** Los dos medios que NO son de Hacienda: saldan sin entregar dinero. */
const MEDIOS_INTERNOS = new Set(["anticipo", "credito"]);

/**
 * Cobra una cuenta.
 *
 * `db` es la transacción de quien llama **solo para leer y escribir el
 * cobro**: la emisión del comprobante abre sus propias transacciones
 * cortas (habla con Hacienda y no puede hacerlo con una transacción
 * sostenida). Por eso recibe también `tenantId`.
 */
export async function cobrar(
  db: PoolClient,
  tenantId: string,
  s: SolicitudCobro
): Promise<ResultadoCobro> {
  if (s.medios.length === 0) throw new Error("Un cobro necesita al menos un medio de pago.");

  const cuenta = await db.query<{
    estado: string;
    propietario_id: string | null;
    cliente_nombre: string | null;
  }>(`SELECT estado, propietario_id, cliente_nombre FROM vta_cuentas WHERE id = $1`, [s.cuentaId]);
  if (cuenta.rows.length === 0) throw new Error(`No existe la cuenta ${s.cuentaId}.`);
  if (cuenta.rows[0].estado === "anulada") throw new Error("Esa cuenta está anulada.");

  const totales = await totalDeCuenta(db, s.cuentaId);
  if (totales.saldo <= 0) {
    throw new Error("Esa cuenta ya está cobrada por completo.");
  }

  // --- A nombre de quién sale ---------------------------------------
  //
  // El receptor se resuelve ACÁ, antes de emitir, porque de él depende
  // quién es el deudor si la venta es a crédito.
  const resuelto = s.eleccionReceptor
    ? await resolverReceptor(db, tenantId, s.eleccionReceptor, cuenta.rows[0].propietario_id)
    : null;
  const receptorFinal = resuelto?.receptor ?? s.receptor;
  // El deudor por defecto es el dueño de la cuenta: es quien debe
  // cuando la factura sale a su nombre, que es el caso común.
  const deudor: Deudor | null =
    resuelto?.deudor ??
    (cuenta.rows[0].propietario_id ? deudorCliente(cuenta.rows[0].propietario_id) : null);

  // El saldo a favor pertenece a quien paga, no a la cuenta.
  const deudorDelAnticipo = deudor ?? deudorCliente(cuenta.rows[0].propietario_id ?? "");


  // --- Convertir cada medio a colones -------------------------------
  const convertidos: Array<MedioCobro & { tipoCambio: number; montoCrc: number; esFiscal: boolean }> =
    [];
  for (const m of s.medios) {
    if (!(m.monto > 0)) throw new Error(`El monto de ${m.medio} tiene que ser mayor que cero.`);
    const moneda = m.moneda ?? "CRC";
    const tipoCambio = moneda === "CRC" ? 1 : await tipoDeCambioDelDia(db, tenantId, moneda);
    if (m.medio === "02" && !m.referencia?.trim()) {
      throw new Error(
        "Un cobro con tarjeta lleva el número de autorización del datáfono: es lo que permite conciliar contra el cierre del BAC."
      );
    }
    if (m.medio === "06" && !m.referencia?.trim()) {
      throw new Error("Un cobro por SINPE Móvil lleva su número de referencia.");
    }
    convertidos.push({
      ...m,
      moneda,
      tipoCambio,
      montoCrc: Math.round(m.monto * tipoCambio * 100) / 100,
      esFiscal: !MEDIOS_INTERNOS.has(m.medio),
    });
  }

  // EL ANTICIPO SE VERIFICA Y SE CONSUME ACÁ.
  //
  // DEFECTO REAL QUE ESTO CIERRA: `anticipo` era un medio interno que
  // saldaba la cuenta sin mirar si el cliente tenía ese saldo a favor y
  // sin descontarlo. Es decir: se podía cerrar una cuenta con plata
  // imaginaria, emitir la factura, y el saldo a favor del cliente
  // quedaba intacto para volver a "usarlo" la próxima vez.
  const porAnticipo =
    Math.round(
      convertidos.filter((m) => m.medio === "anticipo").reduce((a, m) => a + m.montoCrc, 0) * 100
    ) / 100;
  if (porAnticipo > 0) {
    if (!cuenta.rows[0].propietario_id) {
      throw new Error(
        "Para pagar con anticipo la cuenta tiene que estar a nombre de un cliente: el saldo a favor es de alguien."
      );
    }
    // El saldo a favor es de QUIEN PAGA: si la empresa dejó un
    // anticipo, es el de la empresa. Por eso se mira el deudor y no el
    // dueño de la cuenta.
    const deAnticipo = deudorDelAnticipo;
    const disponible = await saldoAFavor(db, deAnticipo);
    if (porAnticipo > disponible + 0.01) {
      throw new Error(
        `Se quiere aplicar ${porAnticipo} de anticipo y el cliente tiene ${disponible} a favor.`
      );
    }
  }

  const recibidoCrc = Math.round(convertidos.reduce((a, m) => a + m.montoCrc, 0) * 100) / 100;

  // Lo que se aplica a la cuenta nunca supera el saldo: si el cliente
  // entrega de más, la diferencia es vuelto, no un cobro mayor.
  const aplicado = Math.min(recibidoCrc, totales.saldo);
  const vueltoCrc = Math.round((recibidoCrc - aplicado) * 100) / 100;

  // Solo el efectivo da vuelto. Pagar 50 000 con tarjeta por una cuenta
  // de 30 000 no es "vuelto de 20 000": es un error de digitación.
  if (vueltoCrc > 0) {
    const efectivo = convertidos
      .filter((m) => m.medio === "01")
      .reduce((a, m) => a + m.montoCrc, 0);
    if (vueltoCrc > efectivo + 0.01) {
      throw new Error(
        `Se recibieron ${recibidoCrc} para un saldo de ${totales.saldo}, y el vuelto de ${vueltoCrc} no sale del efectivo entregado (${efectivo}). Revisá los montos.`
      );
    }
  }

  // --- Emitir el comprobante ANTES de registrar el cobro ------------
  const esCredito = (s.condicionVenta ?? "01") !== "01";
  let comprobanteId: string | undefined;
  let consecutivo: string | undefined;
  let estadoComprobante: string | undefined;

  const lineas = await lineasParaFacturar(db, s.cuentaId);
  if (lineas.length === 0) throw new Error("La cuenta no tiene cargos: no hay nada que cobrar.");

  // Solo se factura la PRIMERA vez. Un pago parcial posterior no emite
  // otra factura por lo mismo: eso duplicaría el ingreso.
  const yaFacturada = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM vta_cobros
      WHERE cuenta_id = $1 AND estado = 'aplicado' AND comprobante_id IS NOT NULL`,
    [s.cuentaId]
  );
  const hayQueFacturar = yaFacturada.rows[0].n === "0";

  if (hayQueFacturar) {
    // SIN DATOS, TIQUETE. No es una degradación silenciosa: es lo que
    // el prompt pide, y la pantalla ya mostró qué falta para factura.
    const tipo = s.tipoComprobante ?? (receptorFinal?.identificacion ? "01" : "04");
    if (tipo === "01" && !receptorFinal?.identificacion) {
      throw new Error(
        "Para una factura hace falta la identificación del receptor. Elegí a quién se le factura, " +
          "cargale la identificación, o emití un tiquete."
      );
    }
    // El tipo de cambio del comprobante se resuelve ANTES de armarlo:
    // si la clínica no lo cargó hoy, se dice en vez de emitir una
    // factura en dólares con un tipo inventado.
    const monedaDoc = (s.monedaComprobante ?? "CRC").toUpperCase();
    let tipoCambioDoc = 1;
    if (monedaDoc !== "CRC") {
      tipoCambioDoc = await tipoDeCambioDelDia(db, tenantId, monedaDoc);
    }

    // LOS MONTOS DEL COMPROBANTE VAN EN SU MONEDA. Hacienda lee los
    // importes del XML en la moneda declarada y usa `TipoCambio` para
    // llevarlos a colones; poner el precio en colones con
    // CodigoMoneda=USD facturaría 520 veces el valor. Los cargos de la
    // cuenta están en colones, así que se dividen.
    const lineasEnMoneda =
      tipoCambioDoc === 1
        ? lineas
        : lineas.map((l) => ({
            ...l,
            precioUnitario: Math.round((Number(l.precioUnitario) / tipoCambioDoc) * 100000) / 100000,
            descuentos: l.descuentos?.map((d) => ({
              ...d,
              monto: Math.round((Number(d.monto) / tipoCambioDoc) * 100000) / 100000,
            })),
          }));

    const documento: DocumentoVenta = {
      tipoComprobante: tipo,
      moneda: monedaDoc,
      tipoCambio: tipoCambioDoc,
      condicionVenta: s.condicionVenta ?? "01",
      plazoCreditoDias: esCredito ? s.plazoCreditoDias : undefined,
      receptor: receptorFinal,
      // `receptor_propietario_id` significa "el receptor ES este
      // cliente", así que cuando el receptor es un perfil va NULL.
      //
      // La primera versión guardaba acá el dueño de la cuenta "para no
      // perder el vínculo", y el efecto fue que la factura de la
      // empresa aparecía ADEMÁS en la cuenta corriente del dueño: la
      // misma deuda cobrada a dos personas. El vínculo con el dueño ya
      // existe por otro lado y no se perdió: el cobro apunta a la
      // cuenta, y la cuenta es del dueño.
      receptorPropietarioId: deudor?.tipo === "cliente" ? deudor.id : undefined,
      receptorPerfilId: resuelto?.perfilId,
      observaciones: s.observaciones,
      lineas: lineasEnMoneda,
      // Los medios que van al XML son los FISCALES. El anticipo y el
      // crédito no son medios de pago de Hacienda.
      //
      // Y van por lo APLICADO, no por lo entregado: con dos o más
      // medios Hacienda valida que la suma dé exactamente el total del
      // comprobante, y el vuelto no es parte de la factura. El vuelto
      // se descuenta del EFECTIVO, que es de donde sale físicamente —
      // ya se comprobó más arriba que alcanza.
      mediosPago: (() => {
        const fiscales = convertidos.filter((m) => m.esFiscal);
        if (fiscales.length === 0) return [{ codigo: "99", otro: "Saldo a favor del cliente" }];

        let porDescontar = vueltoCrc;
        const declarados = fiscales.map((m) => {
          let monto = m.montoCrc;
          if (m.medio === "01" && porDescontar > 0) {
            const quita = Math.min(monto, porDescontar);
            monto = Math.round((monto - quita) * 100) / 100;
            porDescontar = Math.round((porDescontar - quita) * 100) / 100;
          }
          // En la moneda del COMPROBANTE: Hacienda valida que los
          // medios sumen su total, y ese total está en dólares cuando
          // la factura es en dólares.
          return {
            codigo: m.medio,
            monto:
              tipoCambioDoc === 1
                ? monto
                : Math.round((monto / tipoCambioDoc) * 100000) / 100000,
          };
        });

        // Un medio que quedó en cero tras el vuelto no se declara: el
        // cliente pagó 20 000 en efectivo por 12 204 y el resto es
        // vuelto, no un medio de pago de cero.
        const conMonto = declarados.filter((d) => d.monto > 0);
        if (conMonto.length === 1) return [{ codigo: conMonto[0].codigo }];
        return conMonto;
      })(),
      claveIdempotencia: `cuenta:${s.cuentaId}`,
    };

    const emitido = await emitir(tenantId, documento);
    comprobanteId = emitido.comprobanteId;
    consecutivo = emitido.consecutivo;
    estadoComprobante = emitido.estado;
  }

  // --- Registrar el cobro -------------------------------------------
  const c = await db.query<{ id: string }>(
    `INSERT INTO vta_cobros (tenant_id, cuenta_id, sesion_id, cobrado_por, total, vuelto_crc,
                             comprobante_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [tenantId, s.cuentaId, s.sesionId, s.personaId ?? null, aplicado, vueltoCrc, comprobanteId ?? null]
  );
  const cobroId = c.rows[0].id;

  // Consumido DESPUÉS de que el cobro existe: si la emisión del
  // comprobante hubiera fallado, el anticipo del cliente seguiría
  // disponible.
  if (porAnticipo > 0) {
    await aplicarAnticipos(db, deudorDelAnticipo, Math.min(porAnticipo, aplicado));
  }

  for (const m of convertidos) {
    await db.query(
      `INSERT INTO vta_cobro_medios (tenant_id, cobro_id, medio, es_fiscal, moneda, monto,
                                     tipo_cambio, monto_crc, referencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenantId, cobroId, m.medio, m.esFiscal, m.moneda, m.monto, m.tipoCambio, m.montoCrc,
        m.referencia ?? null,
      ]
    );
  }

  // Si quedó saldada, la cuenta se cierra.
  const despues = await totalDeCuenta(db, s.cuentaId);
  if (despues.saldo <= 0.01) {
    await db.query(
      `UPDATE vta_cuentas SET estado = 'cobrada', cerrada_en = now() WHERE id = $1`,
      [s.cuentaId]
    );
  }

  // CRM (prompt 03): el cobro y su comprobante, en la misma
  // transaccion. El cliente del evento es el DEUDOR cuando la venta fue
  // a credito a un perfil de facturacion, y el dueno de la cuenta en
  // cualquier otro caso: la linea de tiempo es de quien tiene la
  // relacion con la clinica.
  const clienteDelEvento =
    deudor?.tipo === "cliente" ? deudor.id : cuenta.rows[0].propietario_id;
  if (clienteDelEvento) {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "cobro",
      propietarioId: clienteDelEvento,
      origenTabla: "vta_cobros",
      origenId: cobroId,
      personaId: s.personaId ?? null,
      resumen: `${aplicado.toFixed(2)} en ${convertidos.length} medio(s)`,
    });
    if (comprobanteId) {
      await registrarInteraccion(db, {
        tenantId,
        tipo: "comprobante_emitido",
        propietarioId: clienteDelEvento,
        origenTabla: "fact_comprobantes",
        origenId: comprobanteId,
        personaId: s.personaId ?? null,
        resumen: consecutivo ?? null,
      });
      if (estadoComprobante === "aceptado" || estadoComprobante === "rechazado") {
        await registrarInteraccion(db, {
          tenantId,
          tipo: estadoComprobante === "aceptado" ? "comprobante_aceptado" : "comprobante_rechazado",
          propietarioId: clienteDelEvento,
          origenTabla: "fact_comprobantes",
          origenId: comprobanteId,
          resumen: consecutivo ?? null,
        });
      }
    }
  }

  return { cobroId, total: aplicado, recibidoCrc, vueltoCrc, comprobanteId, consecutivo, estadoComprobante };
}

/**
 * Lo que hay que mostrar en el tiquete térmico de un cobro.
 *
 * Una sola consulta y un solo tipo: el tiquete lo dibuja el navegador,
 * pero QUÉ dice lo decide el servidor. Si la pantalla lo armara, el
 * tiquete reimpreso podría decir algo distinto del original.
 */
export async function datosDeTiquete(db: PoolClient, cobroId: string) {
  const c = await db.query(
    `SELECT co.id, co.total, co.vuelto_crc, co.creado_en,
            cu.numero AS cuenta_numero, cu.cliente_nombre,
            per.nombre AS cajero,
            caja.nombre AS caja,
            cmp.clave, cmp.consecutivo, cmp.tipo_comprobante, cmp.estado AS estado_comprobante,
            cmp.total_impuesto, cmp.total_venta_neta, cmp.total_descuentos,
            cmp.total_comprobante, cmp.moneda AS moneda_comprobante, cmp.tipo_cambio,
            t.nombre AS clinica, t.logo_url,
            e.nombre AS emisor_nombre, e.numero_identificacion AS emisor_identificacion,
            e.ubicacion_otras_senas, e.telefono_numero, e.correo AS emisor_correo
       FROM vta_cobros co
       JOIN vta_sesiones_caja s ON s.id = co.sesion_id
       JOIN vta_cajas caja ON caja.id = s.caja_id
       LEFT JOIN vta_cuentas cu ON cu.id = co.cuenta_id
       LEFT JOIN personas per ON per.id = co.cobrado_por
       LEFT JOIN fact_comprobantes cmp ON cmp.id = co.comprobante_id
       LEFT JOIN tenants t ON t.id = co.tenant_id
       LEFT JOIN fact_emisores e ON e.tenant_id = co.tenant_id
      WHERE co.id = $1`,
    [cobroId]
  );
  if (c.rows.length === 0) throw new Error(`No existe el cobro ${cobroId}.`);

  const medios = await db.query(
    `SELECT cm.medio, cm.moneda, cm.monto, cm.monto_crc, cm.referencia, mp.nombre AS medio_nombre
       FROM vta_cobro_medios cm
       LEFT JOIN fact_cat_medio_pago mp ON mp.codigo = cm.medio
      WHERE cm.cobro_id = $1`,
    [cobroId]
  );

  const lineas = c.rows[0].cuenta_numero
    ? await db.query(
        `SELECT descripcion, cantidad, precio_unitario, descuento
           FROM vta_cargos
          WHERE cuenta_id = (SELECT cuenta_id FROM vta_cobros WHERE id = $1)
            AND anulado_en IS NULL
          ORDER BY creado_en`,
        [cobroId]
      )
    : { rows: [] };

  // EL TIQUETE TÉRMICO HABLA EN COLONES, porque es el documento de la
  // caja: las líneas salen de los cargos (colones) y el total, de lo que
  // se cobró (colones). Pero el neto, el impuesto y los descuentos salen
  // del COMPROBANTE, y el comprobante puede estar emitido en dólares.
  //
  // Con una factura en dólares eso daba un tiquete que decía
  // «Venta neta ₡0,48 · Impuesto ₡0,06 · TOTAL ₡282,50»: los dos
  // primeros eran dólares con el signo de colón. Se vio en el navegador,
  // no en la API. Acá se llevan a colones con el tipo de cambio del
  // propio comprobante, y la moneda de emisión se informa aparte.
  const cobro = c.rows[0];
  const tc = Number(cobro.tipo_cambio ?? 1) || 1;
  if (cobro.moneda_comprobante && cobro.moneda_comprobante !== "CRC") {
    for (const columna of ["total_venta_neta", "total_impuesto", "total_descuentos"]) {
      const valor = cobro[columna];
      if (valor !== null && valor !== undefined) {
        cobro[columna] = Math.round(Number(valor) * tc * 100) / 100;
      }
    }
  }

  return { cobro, medios: medios.rows, lineas: lineas.rows };
}
