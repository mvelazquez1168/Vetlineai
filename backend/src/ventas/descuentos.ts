import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// HASTA CUÁNTO SE PUEDE DESCONTAR, Y POR QUÉ — prompt 08b, A3.
//
// Antes había UN tope por clínica (`vta_parametros.descuento_maximo_pct`,
// 10 % por omisión) y nada más: el mismo límite para el administrador
// que para quien atiende el mostrador, y el mismo para una cirugía que
// para un saco de alimento con 4 % de margen.
//
// AHORA SON TRES NIVELES Y VALE EL MENOR:
//
//   1. el del producto o servicio;
//   2. el del rol de quien lo aplica;
//   3. el general de la clínica.
//
// «El menor» y no «el más específico» a propósito: si la clínica puso un
// tope general del 15 % y alguien carga un producto con tope del 50 %,
// lo que la clínica decidió sigue valiendo. Un tope que se puede
// agrandar desde la ficha de un producto no es un tope.
//
// NULL NO ES CERO: un tope en NULL significa «este nivel no opina». Es
// lo que hace que el administrador quede «sin tope» sin inventar un
// 100 % que se leería como una política.
// ---------------------------------------------------------------------

export interface TopeDeDescuento {
  /** El que rige, en porcentaje. `null` = sin tope. */
  topePct: number | null;
  /** De dónde salió el que rige, para poder explicarlo en la pantalla. */
  origen: "producto" | "servicio" | "rol" | "clinica" | "sin_tope";
  /** Los tres, para la pantalla de configuración. */
  detalle: {
    producto: number | null;
    servicio: number | null;
    rol: number | null;
    clinica: number | null;
  };
}

/**
 * El rol efectivo de una persona, en el texto que usa `vta_topes_descuento`.
 *
 * Hoy los roles de una clínica son dos booleanos de `personas` y no una
 * tabla. `admin_clinica` gana cuando la persona es las dos cosas —el
 * caso normal en una clínica chica— porque el tope del administrador es
 * el más alto y sería absurdo que ser médico se lo bajara.
 */
export async function rolEfectivo(db: PoolClient, personaId: string): Promise<string> {
  const r = await db.query<{ es_medico: boolean; es_admin_clinica: boolean }>(
    `SELECT es_medico, es_admin_clinica FROM personas WHERE id = $1`,
    [personaId]
  );
  if (r.rows.length === 0) return "desconocido";
  if (r.rows[0].es_admin_clinica) return "admin_clinica";
  if (r.rows[0].es_medico) return "medico";
  // El personal que no es médico ni administrador: hoy no hay ninguno
  // —el rol de recepción lo crea el prompt 04— y cuando lo haya, su
  // tope sale de su fila en `vta_topes_descuento`.
  return "otro";
}

export async function topeDeDescuento(
  db: PoolClient,
  tenantId: string,
  que: { presentacionId?: string | null; servicioId?: string | null; personaId?: string | null }
): Promise<TopeDeDescuento> {
  const detalle = {
    producto: null as number | null,
    servicio: null as number | null,
    rol: null as number | null,
    clinica: null as number | null,
  };

  if (que.presentacionId) {
    // El tope es del PRODUCTO y la línea trae la presentación: hay que
    // subir del envase al producto, que es donde vive la política.
    const r = await db.query<{ tope: string | null }>(
      `SELECT p.descuento_maximo_pct::text AS tope
         FROM inv_presentaciones pr
         JOIN inv_productos p ON p.id = pr.producto_id
        WHERE pr.id = $1`,
      [que.presentacionId]
    );
    if (r.rows[0]?.tope != null) detalle.producto = Number(r.rows[0].tope);
  }
  if (que.servicioId) {
    const r = await db.query<{ tope: string | null }>(
      `SELECT descuento_maximo_pct::text AS tope FROM inv_servicios WHERE id = $1`,
      [que.servicioId]
    );
    if (r.rows[0]?.tope != null) detalle.servicio = Number(r.rows[0].tope);
  }
  if (que.personaId) {
    const rol = await rolEfectivo(db, que.personaId);
    const r = await db.query<{ tope: string | null }>(
      `SELECT tope_pct::text AS tope FROM vta_topes_descuento
        WHERE tenant_id = $1 AND rol = $2`,
      [tenantId, rol]
    );
    if (r.rows.length > 0) {
      if (r.rows[0].tope != null) detalle.rol = Number(r.rows[0].tope);
      // Fila con tope en NULL = «este rol no tiene tope propio»: rige el
      // de la clínica. Es lo que hace al administrador «sin tope» sin
      // inventarle un 100 %.
    } else if (rol !== "admin_clinica") {
      // SIN FILA Y SIN SER ADMINISTRADOR: rige el de la clínica, que es
      // el que existía antes de que hubiera topes por rol. No se
      // inventa un cero, que dejaría a la clínica sin poder descontar
      // nada hasta que alguien configure la pantalla.
      detalle.rol = null;
    }
  }
  const par = await db.query<{ tope: string | null }>(
    `SELECT descuento_maximo_pct::text AS tope FROM vta_parametros WHERE tenant_id = $1`,
    [tenantId]
  );
  if (par.rows[0]?.tope != null) detalle.clinica = Number(par.rows[0].tope);

  const candidatos: Array<[TopeDeDescuento["origen"], number | null]> = [
    ["producto", detalle.producto],
    ["servicio", detalle.servicio],
    ["rol", detalle.rol],
    ["clinica", detalle.clinica],
  ];
  const conValor = candidatos.filter((c) => c[1] !== null) as Array<
    [TopeDeDescuento["origen"], number]
  >;
  if (conValor.length === 0) return { topePct: null, origen: "sin_tope", detalle };

  const menor = conValor.reduce((a, b) => (b[1] < a[1] ? b : a));
  return { topePct: menor[1], origen: menor[0], detalle };
}

export interface MotivoDescuento {
  id: string;
  etiqueta: string;
  codigo_hacienda: string;
  codigo_hacienda_otro: string | null;
  exige_autorizacion: boolean;
}

/** El catálogo: los de la plataforma más los que agregó la clínica. */
export async function motivosDeDescuento(db: PoolClient): Promise<MotivoDescuento[]> {
  const r = await db.query<MotivoDescuento>(
    `SELECT id, etiqueta, codigo_hacienda, codigo_hacienda_otro, exige_autorizacion
       FROM vta_motivos_descuento
      WHERE activo
      ORDER BY orden, etiqueta`
  );
  return r.rows;
}

/**
 * Quién puede autorizar un descuento por encima del tope.
 *
 * EL ADMINISTRADOR AUTORIZA POR OMISIÓN, y no es una comodidad: es lo
 * que significa ser administrador de la clínica. La configuración puede
 * AGREGAR roles que autoricen, o quitarle el permiso al administrador
 * poniéndole la fila en `false` explícitamente, pero una clínica recién
 * creada no puede quedar sin nadie que autorice.
 *
 * Lo encontró el verificador de caja: la semilla de la migración 131
 * corrió para los tenants que existían ese día, y una clínica creada
 * después quedaba sin ninguna fila. El resultado era que el
 * administrador no podía autorizar un descuento en su propia clínica.
 *
 * Los demás roles sí fallan cerrado: sin fila, no autorizan.
 */
export async function puedeAutorizarDescuento(
  db: PoolClient,
  tenantId: string,
  personaId: string
): Promise<boolean> {
  const rol = await rolEfectivo(db, personaId);
  const r = await db.query<{ puede: boolean }>(
    `SELECT puede_autorizar AS puede FROM vta_topes_descuento
      WHERE tenant_id = $1 AND rol = $2`,
    [tenantId, rol]
  );
  if (r.rows.length > 0) return r.rows[0].puede === true;
  return rol === "admin_clinica";
}

export class DescuentoSobreElTope extends Error {
  constructor(
    mensaje: string,
    public readonly topePct: number,
    public readonly pctPedido: number,
    public readonly origen: string
  ) {
    super(mensaje);
    this.name = "DescuentoSobreElTope";
  }
}

export interface ChequeoDescuento {
  /** Qué código va al comprobante (`CodigoDescuento`). */
  codigoHacienda: string;
  /** El texto que explica el código 99 (`CodigoDescuentoOTRO`). */
  codigoHaciendaOtro: string | null;
  /**
   * En qué consiste el descuento, en palabras (`NaturalezaDescuento`).
   *
   * Son TRES campos distintos del XSD y no dos: confundir el «otro» con
   * la naturaleza deja el comprobante con un código 99 sin explicar.
   */
  etiqueta: string | null;
  motivoId: string | null;
}

/**
 * Valida un descuento antes de que entre a la cuenta.
 *
 * Devuelve lo que hay que escribir en el cargo —el código que el
 * comprobante necesita— o lanza `DescuentoSobreElTope`, que la ruta
 * traduce a un 409 con el tope y el porcentaje pedido para que la
 * pantalla pueda ofrecer pedir autorización.
 *
 * EL AUTORIZADOR SE VERIFICA. Mandar un id cualquiera en
 * `autorizadoPor` saltaba el control: ahora se comprueba que esa
 * persona exista, sea de la clínica y tenga el permiso.
 */
export async function validarDescuento(
  db: PoolClient,
  tenantId: string,
  datos: {
    bruto: number;
    descuento: number;
    presentacionId?: string | null;
    servicioId?: string | null;
    personaId?: string | null;
    motivoId?: string | null;
    codigoHacienda?: string | null;
    autorizadoPor?: string | null;
  }
): Promise<ChequeoDescuento> {
  const pct = datos.bruto > 0 ? (datos.descuento / datos.bruto) * 100 : 0;

  // 1. EL MOTIVO. El cajero elige la etiqueta y el código sale del
  //    catálogo: así el comprobante lleva el código correcto sin que
  //    nadie en el mostrador tenga que conocer la tabla de Hacienda.
  let motivo: MotivoDescuento | null = null;
  if (datos.motivoId) {
    const r = await db.query<MotivoDescuento>(
      `SELECT id, etiqueta, codigo_hacienda, codigo_hacienda_otro, exige_autorizacion
         FROM vta_motivos_descuento WHERE id = $1 AND activo`,
      [datos.motivoId]
    );
    if (r.rows.length === 0) {
      throw new Error("Ese motivo de descuento no existe o está desactivado.");
    }
    motivo = r.rows[0];
  }
  const codigo = motivo?.codigo_hacienda ?? datos.codigoHacienda ?? null;
  if (!codigo) {
    throw new Error(
      "Un descuento lleva su motivo: de ahí sale el código que el comprobante electrónico exige (Nota 20 del Anexo 4.4)."
    );
  }

  // 2. EL AUTORIZADOR, si vino.
  let autorizado = false;
  if (datos.autorizadoPor) {
    if (datos.autorizadoPor === datos.personaId) {
      // Quien aplica no se autoriza. Es el mismo criterio que las
      // anulaciones de caja: «pedir autorización» no puede ser apretar
      // dos botones.
      throw new Error(
        "No se puede autorizar el propio descuento: tiene que autorizarlo otra persona con permiso."
      );
    }
    if (!(await puedeAutorizarDescuento(db, tenantId, datos.autorizadoPor))) {
      throw new Error("Esa persona no tiene permiso para autorizar descuentos.");
    }
    autorizado = true;
  }

  // 3. EL TOPE.
  const tope = await topeDeDescuento(db, tenantId, datos);
  if (!autorizado) {
    if (motivo?.exige_autorizacion) {
      throw new DescuentoSobreElTope(
        `«${motivo.etiqueta}» siempre lleva autorización, sin importar el porcentaje.`,
        tope.topePct ?? 100,
        pct,
        "motivo"
      );
    }
    if (tope.topePct !== null && pct > tope.topePct + 1e-9) {
      const deQuien =
        tope.origen === "producto" || tope.origen === "servicio"
          ? "de ese producto o servicio"
          : tope.origen === "rol"
            ? "de tu rol"
            : "de la clínica";
      throw new DescuentoSobreElTope(
        `El descuento es del ${pct.toFixed(1)} % y el máximo ${deQuien} es ${tope.topePct} %. Pedí autorización.`,
        tope.topePct,
        pct,
        tope.origen
      );
    }
  }

  return {
    codigoHacienda: codigo,
    codigoHaciendaOtro: motivo?.codigo_hacienda_otro ?? null,
    etiqueta: motivo?.etiqueta ?? null,
    motivoId: motivo?.id ?? null,
  };
}
