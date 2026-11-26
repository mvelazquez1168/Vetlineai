import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// Las LECTURAS del inventario: existencias, kardex, trazabilidad y
// alertas.
//
// Están juntas y separadas de los módulos que escriben porque todas
// responden a la misma pregunta desde ángulos distintos —"qué hay, de
// dónde salió, a dónde fue"— y porque la forma de mostrar una
// existencia ("3 cajas y 7 tabletas") tiene que ser UNA, no una por
// pantalla.
// ---------------------------------------------------------------------

export interface ExistenciaPresentada {
  cantidadBase: number;
  unidadBase: string;
  /** "3 cajas y 7 tabletas (67 tabletas)" */
  texto: string;
}

// ---------------------------------------------------------------------
// CÓMO SE NOMBRA UNA CANTIDAD: plural y núcleo de la presentación.
//
// "124 tableta" y "6 Caja de 20 tabletas y 4 tableta" son lo que sale
// de concatenar el nombre crudo, y las dos se leen mal. Lo que hace
// falta es el NÚCLEO del nombre ("Caja de 20 tabletas" → caja) y su
// plural ("tableta" → tabletas, "unidad" → unidades).
//
// POR QUÉ SE DERIVA Y NO SE GUARDA UN CAMPO: agregarle a cada producto
// un "nombre en plural" y a cada presentación un "nombre corto" sería
// pedirle a la clínica que escriba dos veces lo que ya escribió, y el
// día que no coincidan no se rompe nada visible — simplemente la
// pantalla miente. Las reglas del español alcanzan para esto.
//
// LOS SÍMBOLOS NO SE PLURALIZAN. "ml", "g", "kg", "mg" y los demás son
// símbolos de unidad, no palabras: se escriben igual en singular y en
// plural ("400 ml", nunca "400 mles"). Por eso hay una lista explícita
// y no un intento de adivinarlo por la forma.
// ---------------------------------------------------------------------

/** Símbolos de unidad: invariables por norma, no por excepción. */
const SIMBOLOS_INVARIABLES = new Set([
  "ml",
  "l",
  "cc",
  "g",
  "kg",
  "mg",
  "mcg",
  "ug",
  "ui",
  "mm",
  "cm",
  "m",
  "oz",
  "lb",
]);

/**
 * El plural castellano de un nombre de unidad o de presentación.
 *
 * Reglas aplicadas, en orden:
 *   1. cantidad 1 (o −1) → singular, sin tocar nada;
 *   2. símbolo de unidad → invariable;
 *   3. ya termina en -s o -x → invariable (dosis, tórax);
 *   4. termina en -z → -ces (lápiz → lápices);
 *   5. termina en vocal no acentuada → +s;
 *   6. termina en consonante → +es (unidad → unidades);
 *   7. más de una palabra → se pluraliza SOLO la primera, que es el
 *      núcleo ("bolsa de suero" → "bolsas de suero").
 */
export function pluralizar(nombre: string, cantidad: number): string {
  const limpio = (nombre ?? "").trim();
  if (!limpio) return limpio;
  if (Math.abs(cantidad) === 1) return limpio;

  const palabras = limpio.split(/\s+/);
  if (palabras.length > 1) {
    return [pluralizar(palabras[0], cantidad), ...palabras.slice(1)].join(" ");
  }

  const palabra = palabras[0];
  if (SIMBOLOS_INVARIABLES.has(palabra.toLowerCase())) return palabra;

  const ultima = palabra.slice(-1).toLowerCase();
  if (ultima === "s" || ultima === "x") return palabra;
  if (ultima === "z") return `${palabra.slice(0, -1)}ces`;
  if ("aeio".includes(ultima)) return `${palabra}s`;
  if (ultima === "u") return `${palabra}s`;
  return `${palabra}es`;
}

/**
 * El núcleo de un nombre de presentación: "Caja de 20 tabletas" → caja.
 *
 * Se corta en la primera preposición o en el primer número, que es
 * donde el nombre pasa de decir QUÉ ES a decir CUÁNTO TRAE. Lo que
 * queda se pone en minúscula porque va en medio de una frase
 * ("6 cajas y 4 tabletas"), no al principio.
 *
 * Si el corte deja algo vacío, se devuelve el nombre completo: es mejor
 * un nombre largo que una cantidad sin unidad.
 */
export function nucleoDePresentacion(nombre: string): string {
  const limpio = (nombre ?? "").trim();
  if (!limpio) return limpio;

  const palabras = limpio.split(/\s+/);
  const nucleo: string[] = [];
  for (const palabra of palabras) {
    const sinPuntuacion = palabra.replace(/[.,;:]+$/, "");
    if (/^(de|del|por|con|x)$/i.test(sinPuntuacion)) break;
    if (/^[0-9]/.test(sinPuntuacion)) break;
    nucleo.push(sinPuntuacion);
  }
  const texto = (nucleo.length > 0 ? nucleo : palabras).join(" ");
  // Solo se baja la primera letra si la palabra no es una sigla: "UI"
  // en minúscula deja de ser una unidad.
  return texto === texto.toUpperCase() && texto.length <= 3 ? texto : texto.toLowerCase();
}

/**
 * La existencia en la presentación natural MÁS la unidad base.
 *
 * La "presentación natural" es la de mayor factor que sirva para
 * vender: la caja antes que la tableta. Mostrar solo "67 tabletas"
 * obliga a dividir mentalmente cada vez que alguien quiere saber
 * cuántas cajas hay en el estante.
 *
 * El resto NO se redondea ni se esconde: 67 tabletas son 3 cajas y 7
 * tabletas, no "3,35 cajas" ni "3 cajas".
 */
export function presentarExistencia(
  cantidadBase: number,
  unidadBase: string,
  presentacionMayor?: { nombre: string; factor: number } | null
): ExistenciaPresentada {
  const base = `${formatearCantidad(cantidadBase)} ${pluralizar(unidadBase, cantidadBase)}`;
  if (!presentacionMayor || presentacionMayor.factor <= 1) {
    return { cantidadBase, unidadBase, texto: base };
  }

  const signo = cantidadBase < 0 ? -1 : 1;
  const abs = Math.abs(cantidadBase);
  const enteras = Math.floor(abs / presentacionMayor.factor);
  const resto = abs - enteras * presentacionMayor.factor;

  if (enteras === 0) return { cantidadBase, unidadBase, texto: base };

  const cuantas = signo * enteras;
  const partes = [
    `${cuantas} ${pluralizar(nucleoDePresentacion(presentacionMayor.nombre), cuantas)}`,
  ];
  if (resto > 0) partes.push(`${formatearCantidad(resto)} ${pluralizar(unidadBase, resto)}`);
  return { cantidadBase, unidadBase, texto: `${partes.join(" y ")} (${base})` };
}

/** Sin decimales cuando es entero; con los que haga falta cuando no. */
function formatearCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

export interface ExistenciaProducto {
  productoId: string;
  nombre: string;
  unidadBase: string;
  bodegaId: string;
  bodegaNombre: string;
  cantidad: number;
  presentacion: ExistenciaPresentada;
}

/** Existencia por bodega de un producto, ya presentada. */
export async function existenciasDeProducto(
  db: PoolClient,
  productoId: string
): Promise<ExistenciaProducto[]> {
  const p = await db.query<{ nombre: string; unidad_base: string }>(
    `SELECT nombre, unidad_base FROM inv_productos WHERE id = $1`,
    [productoId]
  );
  if (p.rows.length === 0) throw new Error(`No existe el producto ${productoId}.`);

  const mayor = await db.query<{ nombre: string; factor: string }>(
    `SELECT nombre, factor FROM inv_presentaciones
      WHERE producto_id = $1 AND activo AND para_venta AND factor > 1
      ORDER BY factor DESC LIMIT 1`,
    [productoId]
  );
  const presentacionMayor =
    mayor.rows.length > 0
      ? { nombre: mayor.rows[0].nombre, factor: Number(mayor.rows[0].factor) }
      : null;

  const r = await db.query<{ bodega_id: string; bodega: string; cantidad: string }>(
    `SELECT b.id AS bodega_id, b.nombre AS bodega, COALESCE(sum(l.cantidad), 0)::text AS cantidad
       FROM inv_bodegas b
       LEFT JOIN inv_lotes l ON l.bodega_id = b.id AND l.producto_id = $1
      WHERE b.activo
      GROUP BY b.id, b.nombre
      ORDER BY b.nombre`,
    [productoId]
  );

  return r.rows.map((f) => ({
    productoId,
    nombre: p.rows[0].nombre,
    unidadBase: p.rows[0].unidad_base,
    bodegaId: f.bodega_id,
    bodegaNombre: f.bodega,
    cantidad: Number(f.cantidad),
    presentacion: presentarExistencia(
      Number(f.cantidad),
      p.rows[0].unidad_base,
      presentacionMayor
    ),
  }));
}

/**
 * El consumo del período, desglosado POR ORIGEN, con drill-down a los
 * pacientes.
 *
 * Es la sección 4.5 de la guía rectora, literal: los movimientos
 * ligados a paciente se listan con su paciente y su atención; los que
 * NO tienen paciente **aparecen como su propio grupo con su origen**
 * ("Venta de mostrador", "Consumo interno", "Merma"), nunca escondidos
 * ni repartidos entre los demás.
 *
 * Que un movimiento no tenga paciente es normal, no un dato faltante.
 */
export interface ConsumoPorOrigen {
  tipo: string;
  tipoNombre: string;
  cantidad: number;
  movimientos: number;
  /** Los pacientes, cuando el movimiento los tiene. Vacío si no. */
  pacientes: Array<{
    pacienteId: string;
    nombre: string;
    atencionId: string | null;
    cantidad: number;
  }>;
}

export async function consumoDeProducto(
  db: PoolClient,
  productoId: string,
  desde: string,
  hasta: string
): Promise<ConsumoPorOrigen[]> {
  const grupos = await db.query<{
    tipo: string;
    tipo_nombre: string;
    cantidad: string;
    movimientos: string;
  }>(
    `SELECT m.tipo, t.nombre AS tipo_nombre,
            sum(m.cantidad_base)::text AS cantidad,
            count(*)::text AS movimientos
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento t ON t.codigo = m.tipo
      WHERE m.producto_id = $1
        AND t.direccion = 'salida'
        AND m.creado_en >= $2::date
        AND m.creado_en < ($3::date + interval '1 day')
      GROUP BY m.tipo, t.nombre, t.orden
      ORDER BY t.orden`,
    [productoId, desde, hasta]
  );

  const pacientes = await db.query<{
    tipo: string;
    paciente_id: string;
    nombre: string;
    atencion_id: string | null;
    cantidad: string;
  }>(
    `SELECT m.tipo, m.paciente_id, p.nombre, m.atencion_id,
            sum(m.cantidad_base)::text AS cantidad
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento t ON t.codigo = m.tipo
       JOIN pacientes p ON p.id = m.paciente_id
      WHERE m.producto_id = $1
        AND t.direccion = 'salida'
        AND m.paciente_id IS NOT NULL
        AND m.creado_en >= $2::date
        AND m.creado_en < ($3::date + interval '1 day')
      GROUP BY m.tipo, m.paciente_id, p.nombre, m.atencion_id
      ORDER BY p.nombre`,
    [productoId, desde, hasta]
  );

  return grupos.rows.map((g) => ({
    tipo: g.tipo,
    tipoNombre: g.tipo_nombre,
    cantidad: Number(g.cantidad),
    movimientos: Number(g.movimientos),
    pacientes: pacientes.rows
      .filter((p) => p.tipo === g.tipo)
      .map((p) => ({
        pacienteId: p.paciente_id,
        nombre: p.nombre,
        atencionId: p.atencion_id,
        cantidad: Number(p.cantidad),
      })),
  }));
}

export interface FiltrosKardex {
  productoId?: string;
  desde?: string;
  hasta?: string;
  tipo?: string;
  bodegaId?: string;
  personaId?: string;
  /** Para la exportación, que no se corta en 500. */
  limite?: number;
}

export interface LineaKardex {
  id: string;
  tipo: string;
  tipo_nombre: string;
  direccion: "entrada" | "salida";
  producto: string;
  producto_id: string;
  unidad_base: string;
  cantidad_base: string;
  costo_unitario: string | null;
  creado_en: Date;
  bodega: string;
  lote: string | null;
  presentacion: string | null;
  cantidad_presentacion: string | null;
  motivo: string | null;
  motivo_detalle: string | null;
  persona: string | null;
  paciente: string | null;
  atencion_id: string | null;
}

/**
 * EL KARDEX, con el producto como UN FILTRO MÁS.
 *
 * Antes esta consulta exigía un producto, y por eso no había forma de
 * ver "todos los movimientos de ayer" ni "todas las mermas del mes":
 * había que entrar producto por producto. El producto pasó a ser
 * opcional y se agregaron los filtros de persona y producto; la
 * consulta es la MISMA para la pantalla, la ficha del producto y la
 * exportación, así que las tres no pueden mostrar números distintos.
 *
 * El tope por defecto es 500 filas para la pantalla; la exportación
 * pide el suyo, porque un archivo cortado en silencio es peor que uno
 * grande.
 */
export async function kardex(
  db: PoolClient,
  filtros: FiltrosKardex = {}
): Promise<LineaKardex[]> {
  const condiciones: string[] = ["true"];
  const valores: unknown[] = [];
  const agregar = (sql: string, valor: unknown) => {
    valores.push(valor);
    condiciones.push(sql.replace("$?", `$${valores.length}`));
  };
  if (filtros.productoId) agregar("m.producto_id = $?", filtros.productoId);
  if (filtros.desde) agregar("m.creado_en >= $?::date", filtros.desde);
  if (filtros.hasta) agregar("m.creado_en < ($?::date + interval '1 day')", filtros.hasta);
  if (filtros.tipo) agregar("m.tipo = $?", filtros.tipo);
  if (filtros.bodegaId) agregar("m.bodega_id = $?", filtros.bodegaId);
  if (filtros.personaId) agregar("m.persona_id = $?", filtros.personaId);

  const limite = Math.min(Math.max(filtros.limite ?? 500, 1), 20000);

  const r = await db.query<LineaKardex>(
    `SELECT m.id, m.tipo, t.nombre AS tipo_nombre, t.direccion,
            p.nombre AS producto, p.id AS producto_id, p.unidad_base,
            m.cantidad_base, m.costo_unitario, m.creado_en,
            b.nombre AS bodega, l.numero AS lote,
            pr.nombre AS presentacion, m.cantidad_presentacion,
            mo.nombre AS motivo, m.motivo_detalle,
            per.nombre AS persona, pa.nombre AS paciente, m.atencion_id
       FROM inv_movimientos m
       JOIN inv_tipos_movimiento t ON t.codigo = m.tipo
       JOIN inv_productos p ON p.id = m.producto_id
       JOIN inv_bodegas b ON b.id = m.bodega_id
       LEFT JOIN inv_lotes l ON l.id = m.lote_id
       LEFT JOIN inv_presentaciones pr ON pr.id = m.presentacion_id
       LEFT JOIN inv_motivos mo ON mo.codigo = m.motivo
       LEFT JOIN personas per ON per.id = m.persona_id
       LEFT JOIN pacientes pa ON pa.id = m.paciente_id
      WHERE ${condiciones.join(" AND ")}
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT ${limite}`,
    valores
  );
  return r.rows;
}

/** El kardex de un producto. Es el general con el producto fijado. */
export async function kardexDeProducto(
  db: PoolClient,
  productoId: string,
  filtros: { desde?: string; hasta?: string; tipo?: string; bodegaId?: string } = {}
) {
  return kardex(db, { ...filtros, productoId });
}

// ---------------------------------------------------------------------
// ALERTAS
//
// Las seis que pide el prompt, en UNA consulta por tipo y no una
// pantalla que las calcule: el dashboard, el correo y la pantalla
// tienen que ver lo mismo.
// ---------------------------------------------------------------------
export interface Alertas {
  bajoMinimo: Array<Record<string, unknown>>;
  enPuntoReorden: Array<Record<string, unknown>>;
  porVencer30: Array<Record<string, unknown>>;
  porVencer60: Array<Record<string, unknown>>;
  porVencer90: Array<Record<string, unknown>>;
  envasesAbiertosVencidos: Array<Record<string, unknown>>;
  lotesVencidosConExistencia: Array<Record<string, unknown>>;
}

export async function alertasDeInventario(db: PoolClient): Promise<Alertas> {
  // Existencia total por producto, una sola vez: las dos primeras
  // alertas la necesitan y calcularla dos veces daría dos números si
  // alguien cambia una y no la otra.
  const stock = await db.query<{
    id: string;
    nombre: string;
    unidad_base: string;
    existencia: string;
    minimo: string;
    punto_reorden: string;
  }>(
    `SELECT p.id, p.nombre, p.unidad_base, p.minimo, p.punto_reorden,
            COALESCE(sum(l.cantidad), 0)::text AS existencia
       FROM inv_productos p
       LEFT JOIN inv_lotes l ON l.producto_id = p.id
      WHERE p.activo
      GROUP BY p.id
      ORDER BY p.nombre`
  );

  const porVencer = async (dias: number) =>
    (
      await db.query(
        `SELECT l.id, l.numero, l.vencimiento_efectivo, l.cantidad, p.nombre AS producto,
                p.unidad_base, b.nombre AS bodega
           FROM inv_lotes l
           JOIN inv_productos p ON p.id = l.producto_id
           JOIN inv_bodegas b ON b.id = l.bodega_id
          WHERE l.cantidad > 0
            AND l.vencimiento_efectivo IS NOT NULL
            AND l.vencimiento_efectivo >= CURRENT_DATE
            AND l.vencimiento_efectivo <= CURRENT_DATE + ($1 || ' days')::interval
          ORDER BY l.vencimiento_efectivo`,
        [dias]
      )
    ).rows;

  const envasesAbiertosVencidos = (
    await db.query(
      `SELECT l.id, l.numero, l.fecha_apertura, l.vencimiento_apertura, l.cantidad,
              p.nombre AS producto, b.nombre AS bodega
         FROM inv_lotes l
         JOIN inv_productos p ON p.id = l.producto_id
         JOIN inv_bodegas b ON b.id = l.bodega_id
        WHERE l.cantidad > 0
          AND l.vencimiento_apertura IS NOT NULL
          AND l.vencimiento_apertura < CURRENT_DATE
        ORDER BY l.vencimiento_apertura`
    )
  ).rows;

  const lotesVencidosConExistencia = (
    await db.query(
      `SELECT l.id, l.numero, l.vencimiento_efectivo, l.cantidad,
              p.nombre AS producto, b.nombre AS bodega
         FROM inv_lotes l
         JOIN inv_productos p ON p.id = l.producto_id
         JOIN inv_bodegas b ON b.id = l.bodega_id
        WHERE l.cantidad > 0
          AND l.vencimiento_efectivo IS NOT NULL
          AND l.vencimiento_efectivo < CURRENT_DATE
        ORDER BY l.vencimiento_efectivo`
    )
  ).rows;

  return {
    bajoMinimo: stock.rows.filter((p) => Number(p.existencia) < Number(p.minimo)),
    // "En punto de reorden" es distinto de "bajo mínimo": el reorden es
    // el aviso de que hay que pedir; el mínimo, el de que ya es tarde.
    // Un producto bajo el mínimo no se repite acá.
    enPuntoReorden: stock.rows.filter(
      (p) =>
        Number(p.existencia) >= Number(p.minimo) &&
        Number(p.existencia) <= Number(p.punto_reorden) &&
        Number(p.punto_reorden) > 0
    ),
    porVencer30: await porVencer(30),
    porVencer60: await porVencer(60),
    porVencer90: await porVencer(90),
    envasesAbiertosVencidos,
    lotesVencidosConExistencia,
  };
}
