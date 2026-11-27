import { PoolClient } from "pg";
import { politicaNumero } from "../clinica/politicas";

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
 * Los roles de una persona, desde `persona_roles` (prompt 04).
 *
 * ANTES LEÍA LOS DOS BOOLEANOS, y por eso una recepcionista caía en
 * «otro» y su tope salía del general de la clínica en vez del de su rol.
 * Lo encontró el verificador del 04: el tope configurado para recepción
 * era 5 % y la caja le aplicaba 12 %.
 */
export async function rolesDe(db: PoolClient, personaId: string): Promise<string[]> {
  const r = await db.query<{ rol: string }>(
    `SELECT rol FROM persona_roles WHERE persona_id = $1`,
    [personaId]
  );
  return r.rows.map((f) => f.rol);
}

/**
 * El rol que gobierna el tope de descuento de una persona.
 *
 * CON VARIOS ROLES GANA EL MÁS PERMISIVO, y no el más restrictivo.
 * Alguien que es médica y administradora puede descontar lo que puede
 * descontar una administradora: tener un rol adicional no te quita
 * capacidades. Es al revés del «vale el menor» de los tres niveles
 * —producto, rol, clínica—, que son límites de distinta naturaleza
 * apilados sobre la misma persona.
 */
export async function rolEfectivo(db: PoolClient, personaId: string): Promise<string> {
  const roles = await rolesDe(db, personaId);
  if (roles.length === 0) return "desconocido";
  if (roles.includes("admin_clinica")) return "admin_clinica";
  return roles[0];
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
  // EL TOPE DEL ROL Y EL DE LA CLÍNICA SALEN DE LAS POLÍTICAS (prompt
  // 04, §4). Antes se leían de `vta_topes_descuento` y de
  // `vta_parametros`, que es donde nacieron en el 08b. La política lo
  // resuelve con el mismo orden —el del rol primero, el general
  // después— y con el respaldo en esas columnas mientras existan, así
  // que ninguna clínica cambia de comportamiento el día del despliegue.
  if (que.personaId) {
    const roles = await rolesDe(db, que.personaId);
    // SE PREGUNTA POR EL VALOR POR ROL A SECAS y no por `politica(...,
    // rol)`: si devolviera el general, un rol sin tope propio quedaría
    // con el de la clínica como si fuera suyo, y el detalle de la
    // pantalla mentiría sobre de dónde salió.
    //
    // CON VARIOS ROLES, EL MAYOR de los configurados: tener un rol
    // adicional no te quita capacidades. Y si alguno de sus roles no
    // tiene tope propio, ese rol no limita, así que tampoco limita la
    // persona: se deja `null` y rige el general.
    const propios = await db.query<{ rol: string; valor: string }>(
      `SELECT rol, valor FROM tenant_politicas
        WHERE tenant_id = $1 AND clave = 'descuento.maximo_sin_autorizacion'
          AND rol = ANY($2::varchar[])`,
      [tenantId, roles]
    );
    const todosTienenTope = roles.length > 0 && propios.rows.length === roles.length;
    if (todosTienenTope) {
      detalle.rol = Math.max(...propios.rows.map((f) => Number(f.valor)));
    }
  }
  detalle.clinica = await politicaNumero(db, tenantId, "descuento.maximo_sin_autorizacion");

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
  // SALE DEL PERMISO Y NO DE `vta_topes_descuento.puede_autorizar`
  // (prompt 04). Esa columna nació en el 08b, antes de que existiera un
  // modelo de permisos, y mantenerla sería una segunda fuente de la
  // misma respuesta: la clínica podría quitarle `caja.aprobar` a un rol
  // en la pantalla de roles y ese rol seguiría autorizando descuentos.
  //
  // `caja.aprobar` es «aprobar lo que otros solicitan», que es
  // exactamente esto, y es el mismo permiso con el que se resuelven las
  // anulaciones.
  const r = await db.query<{ puede: boolean }>(
    `SELECT EXISTS (
       WITH roles_de AS (SELECT rol FROM persona_roles WHERE persona_id = $2)
       SELECT 1
         FROM roles_de rd
        WHERE (
          EXISTS (SELECT 1 FROM rol_permisos rp
                   WHERE rp.rol = rd.rol AND rp.permiso = 'caja.aprobar')
            AND COALESCE((SELECT trp.concedido FROM tenant_rol_permiso trp
                           WHERE trp.tenant_id = $1 AND trp.rol = rd.rol
                             AND trp.permiso = 'caja.aprobar'), true)
        )
        OR COALESCE((SELECT trp.concedido FROM tenant_rol_permiso trp
                      WHERE trp.tenant_id = $1 AND trp.rol = rd.rol
                        AND trp.permiso = 'caja.aprobar'), false)
     ) AS puede`,
    [tenantId, personaId]
  );
  return r.rows[0].puede === true;
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
