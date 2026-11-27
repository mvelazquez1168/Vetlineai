import { PoolClient } from "pg";
import { registrarInteraccion } from "../crm/interacciones";
import { abrirCuenta, agregarCargo } from "./cuentas";
import { precioVigente } from "../inventario/precios";
import { politicaNumero } from "../clinica/politicas";
import { validarDescuento } from "./descuentos";

// ---------------------------------------------------------------------
// PRESUPUESTOS — prompt 08b, A1.
//
// El médico cotiza una cirugía, el dueño se lo lleva para decidir, y
// cuando acepta eso se vuelve la cuenta sin que nadie transcriba nada.
//
// TRES DECISIONES QUE VALE LA PENA DEJAR ESCRITAS:
//
//   1. **El precio se congela en la línea.** Es el que el cliente leyó
//      en el papel. Dentro de la vigencia se respeta sin preguntar;
//      vencido, se avisa y se puede elegir, y elegir el viejo requiere
//      el permiso de autorizar descuentos —porque cobrar menos de lo que
//      vale hoy es, exactamente, un descuento—.
//   2. **La conversión es total.** Si el dueño quiere la mitad, se edita
//      el presupuesto antes de convertirlo. Una conversión parcial
//      necesitaría decidir qué pasa con el resto —¿queda vigente? ¿se
//      vence?— y eso no estaba en el alcance.
//   3. **Convertir no cobra.** Deja los cargos en una cuenta abierta; el
//      cobro es el de siempre, con su anticipo aplicado. Convertir y
//      cobrar en un solo paso dejaría al cliente sin poder pagar en dos
//      veces, que es justo el caso de una cirugía.
// ---------------------------------------------------------------------

export type EstadoPresupuesto =
  | "borrador"
  | "enviado"
  | "aceptado"
  | "rechazado"
  | "vencido"
  | "convertido";

export interface LineaPresupuesto {
  presentacionId?: string | null;
  servicioId?: string | null;
  descripcion?: string;
  cantidad: number;
  /** Si no viene, sale del catálogo con la lista de precios vigente. */
  precioUnitario?: number;
  descuento?: number;
  /** El motivo del catálogo: de ahí sale el código del comprobante. */
  motivoDescuentoId?: string | null;
  /** Quién autorizó, cuando el descuento pasa el tope de quien cotiza. */
  descuentoAutorizadoPor?: string | null;
  nota?: string | null;
  codigoCabys?: string | null;
  codigoTarifaIva?: string | null;
  unidadMedida?: string | null;
  lineaNegocio?: string | null;
}

export interface SolicitudPresupuesto {
  propietarioId?: string | null;
  pacienteId?: string | null;
  atencionId?: string | null;
  observaciones?: string | null;
  vigenciaDias?: number;
  lineas: LineaPresupuesto[];
  personaId?: string;
}

export class PresupuestoVencido extends Error {
  constructor(
    mensaje: string,
    public readonly venceEl: string | null
  ) {
    super(mensaje);
    this.name = "PresupuestoVencido";
  }
}

/**
 * Lo que se va a cobrar por una línea, resuelto contra el catálogo.
 *
 * Reusa `precioVigente` —el mismo que usa la caja y la atención— en vez
 * de leer el precio base: si la clínica tiene una lista de precios
 * preseleccionada, el presupuesto tiene que cotizar con ESA, porque es
 * la que se va a cobrar.
 */
async function resolverLinea(
  db: PoolClient,
  l: LineaPresupuesto
): Promise<{
  descripcion: string;
  precio: number;
  cabys: string | null;
  tarifa: string | null;
  unidad: string;
  linea: string | null;
}> {
  if (l.presentacionId) {
    const r = await db.query<{
      nombre: string;
      codigo_cabys: string | null;
      codigo_tarifa_iva: string | null;
      unidad: string | null;
      linea_negocio: string | null;
    }>(
      // La columna es `unidad_medida`, verificada contra el esquema.
      `SELECT pr.nombre, p.codigo_cabys, p.codigo_tarifa_iva,
              pr.unidad_medida AS unidad, p.linea_negocio
         FROM inv_presentaciones pr
         JOIN inv_productos p ON p.id = pr.producto_id
        WHERE pr.id = $1`,
      [l.presentacionId]
    );
    if (r.rows.length === 0) throw new Error("Esa presentación no existe.");
    const f = r.rows[0];
    const tasado =
      l.precioUnitario !== undefined
        ? null
        : await precioVigente(db, { presentacionId: l.presentacionId }, {});
    return {
      descripcion: l.descripcion?.trim() || f.nombre,
      precio: l.precioUnitario ?? tasado?.precio ?? 0,
      cabys: f.codigo_cabys,
      tarifa: f.codigo_tarifa_iva,
      unidad: f.unidad ?? "Unid",
      linea: f.linea_negocio,
    };
  }
  if (l.servicioId) {
    const r = await db.query<{
      nombre: string;
      codigo_cabys: string | null;
      codigo_tarifa_iva: string | null;
      linea_negocio: string | null;
    }>(
      `SELECT nombre, codigo_cabys, codigo_tarifa_iva, linea_negocio
         FROM inv_servicios WHERE id = $1`,
      [l.servicioId]
    );
    if (r.rows.length === 0) throw new Error("Ese servicio no existe.");
    const f = r.rows[0];
    const tasado =
      l.precioUnitario !== undefined
        ? null
        : await precioVigente(db, { servicioId: l.servicioId }, {});
    return {
      descripcion: l.descripcion?.trim() || f.nombre,
      precio: l.precioUnitario ?? tasado?.precio ?? 0,
      cabys: f.codigo_cabys,
      tarifa: f.codigo_tarifa_iva,
      unidad: "Sp",
      linea: f.linea_negocio,
    };
  }
  if (!l.descripcion?.trim()) {
    throw new Error("Una línea libre necesita su descripción: es lo que el cliente va a leer.");
  }
  if (l.precioUnitario === undefined) {
    throw new Error(`"${l.descripcion}" necesita su precio.`);
  }
  return {
    descripcion: l.descripcion.trim(),
    precio: l.precioUnitario,
    cabys: l.codigoCabys ?? null,
    tarifa: l.codigoTarifaIva ?? null,
    unidad: l.unidadMedida ?? "Unid",
    linea: l.lineaNegocio ?? null,
  };
}

export async function crearPresupuesto(
  db: PoolClient,
  tenantId: string,
  s: SolicitudPresupuesto
): Promise<{ id: string; numero: number; total: number }> {
  if (s.lineas.length === 0) {
    throw new Error("Un presupuesto sin líneas no es un presupuesto.");
  }

  // El consecutivo, con el mismo lock que las cuentas y las órdenes de
  // compra: `FOR UPDATE` no sirve con un agregado y bloquear la última
  // fila no sirve cuando no hay ninguna.
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':vta_presupuesto'))`, [tenantId]);
  const ultimo = await db.query<{ numero: number }>(
    `SELECT COALESCE(max(numero), 0) AS numero FROM vta_presupuestos WHERE tenant_id = $1`,
    [tenantId]
  );
  const numero = Number(ultimo.rows[0].numero) + 1;

  // La vigencia sale de la política (prompt 04, §4), con el respaldo en
  // `vta_parametros.presupuesto_vigencia_dias` mientras esa columna
  // exista.
  const vigencia =
    s.vigenciaDias ?? (await politicaNumero(db, tenantId, "presupuesto.vigencia_dias"));

  let nombre: string | null = null;
  if (s.propietarioId) {
    const p = await db.query<{ nombre: string }>(`SELECT nombre FROM propietarios WHERE id = $1`, [
      s.propietarioId,
    ]);
    nombre = p.rows[0]?.nombre ?? null;
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO vta_presupuestos
       (tenant_id, numero, propietario_id, cliente_nombre, paciente_id, atencion_id,
        observaciones, vigencia_dias, vence_el, creado_por)
     -- LA VIGENCIA VA DOS VECES, con su tipo en cada lugar: como
     -- smallint en la columna y como int en la suma de días. Un mismo
     -- parámetro en los dos lugares falla con «inconsistent types
     -- deduced for parameter», que es la quinta aparición de esta
     -- familia en el proyecto.
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::smallint, (CURRENT_DATE + $9::int), $10)
     RETURNING id`,
    [
      tenantId,
      numero,
      s.propietarioId ?? null,
      nombre,
      s.pacienteId ?? null,
      s.atencionId ?? null,
      s.observaciones?.trim() || null,
      vigencia,
      vigencia,
      s.personaId ?? null,
    ]
  );
  const id = r.rows[0].id;

  let total = 0;
  let orden = 0;
  for (const l of s.lineas) {
    const que = await resolverLinea(db, l);
    const descuento = l.descuento ?? 0;
    const bruto = que.precio * l.cantidad;
    if (descuento > bruto) {
      throw new Error(`El descuento de "${que.descripcion}" supera el valor de la línea.`);
    }

    // EL DESCUENTO SE CONTROLA ACÁ, al cotizar.
    //
    // Es el momento en que se decide cobrar menos: el cliente está
    // discutiendo el precio y hay a quién pedirle la autorización. La
    // conversión después no lo vuelve a pedir, porque el presupuesto
    // aceptado es el respaldo. Si el control estuviera solo en la
    // conversión, cualquiera podría cotizar un 90 % y después
    // convertirlo.
    let chequeo: Awaited<ReturnType<typeof validarDescuento>> | null = null;
    if (descuento > 0) {
      chequeo = await validarDescuento(db, tenantId, {
        bruto,
        descuento,
        presentacionId: l.presentacionId,
        servicioId: l.servicioId,
        personaId: s.personaId,
        motivoId: l.motivoDescuentoId,
        autorizadoPor: l.descuentoAutorizadoPor,
      });
    }

    await db.query(
      `INSERT INTO vta_presupuesto_lineas
         (tenant_id, presupuesto_id, orden, presentacion_id, servicio_id, descripcion, cantidad,
          precio_unitario, descuento, codigo_cabys, codigo_tarifa_iva, unidad_medida,
          linea_negocio, nota, motivo_descuento_id, descuento_codigo, descuento_codigo_otro,
          descuento_naturaleza, descuento_autorizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        tenantId,
        id,
        orden++,
        l.presentacionId ?? null,
        l.servicioId ?? null,
        que.descripcion,
        l.cantidad,
        que.precio,
        descuento,
        que.cabys,
        que.tarifa,
        que.unidad,
        que.linea,
        l.nota?.trim() || null,
        chequeo?.motivoId ?? null,
        chequeo?.codigoHacienda ?? null,
        chequeo?.codigoHaciendaOtro ?? null,
        chequeo?.etiqueta ?? null,
        l.descuentoAutorizadoPor ?? null,
      ]
    );
    total += bruto - descuento;
  }

  return { id, numero, total: Math.round(total * 100) / 100 };
}

export interface PresupuestoCompleto {
  id: string;
  numero: number;
  estado: EstadoPresupuesto;
  propietario_id: string | null;
  cliente_nombre: string | null;
  paciente_id: string | null;
  paciente_nombre: string | null;
  atencion_id: string | null;
  observaciones: string | null;
  vigencia_dias: number;
  vence_el: string | null;
  vencido: boolean;
  enviado_en: string | null;
  respondido_en: string | null;
  respondido_como: string | null;
  respuesta_nota: string | null;
  cuenta_id: string | null;
  cuenta_numero: number | null;
  creado_en: string;
  creado_por_nombre: string | null;
  lineas: Array<{
    id: string;
    descripcion: string;
    cantidad: string;
    precio_unitario: string;
    descuento: string;
    nota: string | null;
    presentacion_id: string | null;
    servicio_id: string | null;
    descuento_codigo: string | null;
    descuento_codigo_otro: string | null;
    descuento_naturaleza: string | null;
    descuento_autorizado_por: string | null;
  }>;
  /** El anticipo ya recibido sobre este presupuesto. */
  anticipado: number;
  total: number;
}

export async function verPresupuesto(
  db: PoolClient,
  id: string
): Promise<PresupuestoCompleto | null> {
  const r = await db.query(
    `SELECT p.*, pa.nombre AS paciente_nombre, per.nombre AS creado_por_nombre,
            c.numero AS cuenta_numero,
            -- VENCIDO SE CALCULA, no se lee del estado: el estado lo
            -- mueve un job y la pantalla no puede esperar a que corra.
            (p.estado IN ('borrador','enviado') AND p.vence_el < CURRENT_DATE) AS vencido,
            COALESCE((SELECT sum(a.monto - a.aplicado) FROM vta_anticipos a
                       WHERE a.presupuesto_id = p.id AND a.estado = 'disponible'), 0)::float
              AS anticipado
       FROM vta_presupuestos p
       LEFT JOIN pacientes pa ON pa.id = p.paciente_id
       LEFT JOIN personas per ON per.id = p.creado_por
       LEFT JOIN vta_cuentas c ON c.id = p.cuenta_id
      WHERE p.id = $1`,
    [id]
  );
  if (r.rows.length === 0) return null;
  const lineas = await db.query(
    `SELECT id, descripcion, cantidad::text, precio_unitario::text, descuento::text, nota,
            presentacion_id, servicio_id, descuento_codigo, descuento_codigo_otro,
            descuento_naturaleza, descuento_autorizado_por
       FROM vta_presupuesto_lineas WHERE presupuesto_id = $1 ORDER BY orden`,
    [id]
  );
  const total = lineas.rows.reduce(
    (t, l) => t + Number(l.cantidad) * Number(l.precio_unitario) - Number(l.descuento),
    0
  );
  return {
    ...(r.rows[0] as PresupuestoCompleto),
    lineas: lineas.rows as PresupuestoCompleto["lineas"],
    total: Math.round(total * 100) / 100,
  };
}

export async function listarPresupuestos(
  db: PoolClient,
  filtros: { estado?: string; propietarioId?: string; porVencer?: boolean } = {}
): Promise<Array<Record<string, unknown>>> {
  const cond: string[] = [];
  const val: unknown[] = [];
  if (filtros.estado) {
    val.push(filtros.estado);
    cond.push(`p.estado = $${val.length}`);
  }
  if (filtros.propietarioId) {
    val.push(filtros.propietarioId);
    cond.push(`p.propietario_id = $${val.length}`);
  }
  if (filtros.porVencer) {
    // «Por vencer» es lo que todavía se puede convertir y se va a caer
    // pronto: es la lista con la que la recepción llama a los clientes.
    cond.push(
      `p.estado IN ('borrador','enviado') AND p.vence_el BETWEEN CURRENT_DATE AND (CURRENT_DATE + 5)`
    );
  }
  const r = await db.query(
    `SELECT p.id, p.numero, p.estado, p.cliente_nombre, p.propietario_id, p.vence_el::text,
            p.creado_en::text, pa.nombre AS paciente_nombre,
            (p.estado IN ('borrador','enviado') AND p.vence_el < CURRENT_DATE) AS vencido,
            COALESCE((SELECT sum(l.cantidad * l.precio_unitario - l.descuento)
                        FROM vta_presupuesto_lineas l WHERE l.presupuesto_id = p.id), 0)::float
              AS total
       FROM vta_presupuestos p
       LEFT JOIN pacientes pa ON pa.id = p.paciente_id
      ${cond.length > 0 ? `WHERE ${cond.join(" AND ")}` : ""}
      ORDER BY p.creado_en DESC
      LIMIT 200`,
    val
  );
  return r.rows;
}

/** Marca el presupuesto como entregado al cliente. */
export async function marcarEnviado(
  db: PoolClient,
  tenantId: string,
  id: string,
  personaId?: string
): Promise<void> {
  const r = await db.query<{ propietario_id: string | null; numero: number; paciente_id: string | null }>(
    `UPDATE vta_presupuestos
        SET estado = CASE WHEN estado = 'borrador' THEN 'enviado' ELSE estado END,
            enviado_en = COALESCE(enviado_en, now()),
            actualizado_en = now()
      WHERE id = $1
      RETURNING propietario_id, numero, paciente_id`,
    [id]
  );
  if (r.rows.length === 0) throw new Error("Ese presupuesto no existe.");
  if (r.rows[0].propietario_id) {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "presupuesto_emitido",
      propietarioId: r.rows[0].propietario_id,
      pacienteId: r.rows[0].paciente_id ?? undefined,
      origenTabla: "vta_presupuestos",
      origenId: id,
      personaId,
      resumen: `Presupuesto N.º ${r.rows[0].numero}`,
    });
  }
}

/**
 * La respuesta del cliente, registrada por quien la recibió.
 *
 * NO HAY APROBACIÓN EN LÍNEA del cliente, y el prompt lo dice: eso queda
 * como mejora futura. Lo que hay es «me dijo que sí por teléfono», con
 * quién lo registró y cuándo, que es lo que la clínica puede sostener.
 */
export async function registrarRespuesta(
  db: PoolClient,
  tenantId: string,
  id: string,
  datos: {
    acepta: boolean;
    como: "telefono" | "whatsapp" | "correo" | "en_persona";
    nota?: string;
    personaId?: string;
  }
): Promise<void> {
  const actual = await db.query<{ estado: string }>(
    `SELECT estado FROM vta_presupuestos WHERE id = $1`,
    [id]
  );
  if (actual.rows.length === 0) throw new Error("Ese presupuesto no existe.");
  if (actual.rows[0].estado === "convertido") {
    throw new Error("Ese presupuesto ya se convirtió en cargos: no se puede cambiar la respuesta.");
  }
  const r = await db.query<{ propietario_id: string | null; numero: number; paciente_id: string | null }>(
    `UPDATE vta_presupuestos
        SET estado = $2, respondido_en = now(), respondido_como = $3,
            respuesta_nota = $4, registrado_por = $5, actualizado_en = now()
      WHERE id = $1
      RETURNING propietario_id, numero, paciente_id`,
    [id, datos.acepta ? "aceptado" : "rechazado", datos.como, datos.nota?.trim() || null, datos.personaId ?? null]
  );
  if (r.rows[0].propietario_id) {
    await registrarInteraccion(db, {
      tenantId,
      tipo: "presupuesto_respondido",
      propietarioId: r.rows[0].propietario_id,
      pacienteId: r.rows[0].paciente_id ?? undefined,
      origenTabla: "vta_presupuestos",
      origenId: id,
      personaId: datos.personaId,
      resumen: `Presupuesto N.º ${r.rows[0].numero}: ${datos.acepta ? "aceptado" : "rechazado"} (${datos.como.replace("_", " ")})`,
    });
  }
}

export interface ResultadoConversion {
  cuentaId: string;
  cuentaNumero: number;
  cargos: number;
  total: number;
  /** El anticipo que quedó disponible para aplicarse al cobrar. */
  anticipoDisponible: number;
  avisos: string[];
}

/**
 * Convierte un presupuesto aceptado en los cargos de una cuenta.
 *
 * `precioVencido: "cotizado" | "actual"` solo hace falta cuando la
 * vigencia ya pasó. Dentro de la vigencia **no se pregunta**: se respeta
 * lo cotizado, que es lo que el prompt pide y lo que el cliente leyó.
 */
export async function convertirPresupuesto(
  db: PoolClient,
  tenantId: string,
  id: string,
  opciones: {
    cuentaId?: string;
    sesionId?: string;
    personaId?: string;
    /**
     * De qué bodega sale el stock de las líneas de producto.
     *
     * Convertir un presupuesto con productos DESCUENTA INVENTARIO, igual
     * que venderlos en el mostrador: el cliente se los lleva. Si no
     * viene, `agregarCargo` lo resuelve por la caja de la sesión o por la
     * bodega predeterminada, y si no hay ninguna lo dice en vez de
     * descontar de un lugar cualquiera.
     */
    bodegaId?: string;
    precioVencido?: "cotizado" | "actual";
    /** Quién tiene permiso para mantener el precio vencido. */
    autorizadoPor?: string;
  } = {}
): Promise<ResultadoConversion> {
  const p = await verPresupuesto(db, id);
  if (!p) throw new Error("Ese presupuesto no existe.");
  if (p.estado === "convertido") {
    throw new Error(`El presupuesto N.º ${p.numero} ya se convirtió en la cuenta ${p.cuenta_numero}.`);
  }
  if (p.estado === "rechazado") {
    throw new Error("Ese presupuesto está rechazado. Registrá la aceptación antes de convertirlo.");
  }

  const avisos: string[] = [];
  let usarCotizado = true;

  if (p.vencido) {
    if (!opciones.precioVencido) {
      // NO SE DECIDE SOLO. Devolver un 409 con la fecha deja que la
      // pantalla pregunte; elegir por nuestra cuenta sería cobrarle al
      // cliente un precio que no acordó, o regalarle uno que ya no vale.
      throw new PresupuestoVencido(
        `El presupuesto N.º ${p.numero} venció el ${p.vence_el}. Hay que elegir si se respeta el precio cotizado o se usa el actual.`,
        p.vence_el
      );
    }
    if (opciones.precioVencido === "cotizado") {
      // MANTENER UN PRECIO VENCIDO ES UN DESCUENTO, y por eso lleva el
      // mismo permiso: alguien que no puede autorizar descuentos no
      // puede regalar la diferencia por la vía de un presupuesto viejo.
      const { puedeAutorizarDescuento } = await import("./descuentos");
      const quien = opciones.autorizadoPor ?? opciones.personaId;
      if (!quien || !(await puedeAutorizarDescuento(db, tenantId, quien))) {
        throw new Error(
          "Respetar el precio de un presupuesto vencido lo autoriza quien puede autorizar descuentos."
        );
      }
      avisos.push(
        `Se respetó el precio cotizado de un presupuesto vencido el ${p.vence_el}, autorizado.`
      );
    } else {
      usarCotizado = false;
      avisos.push("El presupuesto estaba vencido: se cobraron los precios actuales del catálogo.");
    }
  }

  let cuentaId = opciones.cuentaId;
  let cuentaNumero = 0;
  if (!cuentaId) {
    const cuenta = await abrirCuenta(db, tenantId, {
      propietarioId: p.propietario_id ?? undefined,
      sesionId: opciones.sesionId,
    });
    cuentaId = cuenta.id;
    cuentaNumero = cuenta.numero;
  } else {
    const n = await db.query<{ numero: number }>(`SELECT numero FROM vta_cuentas WHERE id = $1`, [
      cuentaId,
    ]);
    cuentaNumero = n.rows[0]?.numero ?? 0;
  }

  let total = 0;
  let cargos = 0;
  for (const l of p.lineas) {
    const cargo = await agregarCargo(db, tenantId, {
      cuentaId,
      origen: "presupuesto",
      origenId: id,
      presentacionId: l.presentacion_id ?? undefined,
      servicioId: l.servicio_id ?? undefined,
      descripcion: l.descripcion,
      pacienteId: p.paciente_id ?? undefined,
      cantidad: Number(l.cantidad),
      // El precio cotizado, salvo que se haya elegido el actual: en ese
      // caso no se pasa y `agregarCargo` lo resuelve del catálogo.
      precioUnitario: usarCotizado ? Number(l.precio_unitario) : undefined,
      descuento: Number(l.descuento) > 0 ? Number(l.descuento) : undefined,
      // EL DESCUENTO VIENE APROBADO DESDE EL PRESUPUESTO, con el código
      // y el autorizador que se guardaron al cotizar. No se vuelve a
      // pedir el tope: ya se pidió donde correspondía.
      descuentoYaAprobado: Number(l.descuento) > 0,
      descuentoCodigo:
        Number(l.descuento) > 0 ? (l.descuento_codigo ?? "07") : undefined,
      descuentoNaturaleza:
        Number(l.descuento) > 0
          ? (l.descuento_naturaleza ?? "Descuento del presupuesto aceptado")
          : undefined,
      descuentoAutorizadoPor: l.descuento_autorizado_por ?? undefined,
      personaId: opciones.personaId,
      bodegaId: opciones.bodegaId,
    });
    cargos += 1;
    total += cargo.total;
  }

  await db.query(
    `UPDATE vta_presupuestos
        SET estado = 'convertido', cuenta_id = $2, convertido_en = now(), actualizado_en = now()
      WHERE id = $1`,
    [id, cuentaId]
  );

  // EL ANTICIPO NO SE APLICA ACÁ: queda disponible y se aplica al
  // cobrar, que es donde `cobrar()` ya sabe hacerlo. Aplicarlo ahora
  // sería cobrar sin que nadie haya cobrado.
  const anticipo = await db.query<{ disponible: string }>(
    `SELECT COALESCE(sum(monto - aplicado), 0)::text AS disponible
       FROM vta_anticipos WHERE presupuesto_id = $1 AND estado = 'disponible'`,
    [id]
  );
  const anticipoDisponible = Number(anticipo.rows[0].disponible);
  if (anticipoDisponible > 0) {
    avisos.push(
      `El cliente tiene ${anticipoDisponible} de anticipo sobre este presupuesto: se aplica al cobrar.`
    );
  }

  return {
    cuentaId,
    cuentaNumero,
    cargos,
    total: Math.round(total * 100) / 100,
    anticipoDisponible,
    avisos,
  };
}

/**
 * Vence los presupuestos cuya vigencia pasó.
 *
 * Lo corre el job diario. La pantalla no depende de esto —calcula
 * `vencido` al leer— pero el estado guardado es lo que hace que la lista
 * filtrada por «vencidos» no tenga que recalcular 200 filas, y lo que
 * deja el dato para los números del dashboard.
 */
export async function vencerPresupuestos(db: PoolClient): Promise<number> {
  const r = await db.query(
    `UPDATE vta_presupuestos
        SET estado = 'vencido', actualizado_en = now()
      WHERE estado IN ('borrador', 'enviado') AND vence_el < CURRENT_DATE`
  );
  return r.rowCount ?? 0;
}
