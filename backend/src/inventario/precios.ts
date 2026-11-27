import { fechaEnZona, fechaHoyEnZona } from "../fecha";
import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// LISTAS DE PRECIO — prompt 06, sección 2.
//
// El modelo (`inv_listas_precio`, `inv_lista_precio_items`) se creó con
// la migración 095 y quedó SIN un solo lector: el cargo y la venta de
// mostrador tomaban `inv_presentaciones.precio_venta` y
// `inv_servicios.precio` siempre. Dos tablas que prometen un precio
// distinto y que nadie consulta son peores que no tenerlas, porque la
// clínica configura una lista "nocturno" y cobra igual sin que nada
// avise. Este archivo es el lector que faltaba.
//
// PUNTO ÚNICO. `precioVigente` es el único lugar donde se decide qué
// precio corresponde. Lo llaman `agregarCargo` (caja), la venta de
// mostrador y la vista previa de la actualización masiva. Si el criterio
// cambia —por ejemplo, que dos listas vigentes se resuelvan por
// prioridad en vez de por elección explícita— se cambia acá y los tres
// lo heredan.
//
// LA REGLA: la lista REEMPLAZA el precio base, no lo ajusta. Un ítem de
// lista es un precio final. El motivo es que un porcentaje guardado se
// recalcularía sobre un base que cambia, y el precio que el cliente vio
// ayer dejaría de ser reconstruible. La actualización masiva por
// porcentaje de acá abajo CALCULA y GUARDA el precio resultante, no
// guarda el porcentaje.
//
// VIGENCIA. Una lista aplica si está activa y el momento cae dentro de
// su vigencia. `vigente_desde`/`vigente_hasta` en NULL significan
// "siempre" por ese lado. Una lista vencida no aplica NUNCA, ni siquiera
// si alguien la eligió en la pantalla: el precio de una lista vencida no
// es un precio, y cobrarlo sería cobrar mal.
// ---------------------------------------------------------------------

export interface PrecioResuelto {
  precio: number;
  /** De dónde salió, para poder explicarlo en pantalla y auditarlo. */
  origen: "lista" | "base";
  listaId: string | null;
  listaNombre: string | null;
}

export interface Lista {
  id: string;
  codigo: string;
  nombre: string;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  activo: boolean;
  items: number;
  vigenteHoy: boolean;
}

/** Lo que se está tasando: una presentación de producto o un servicio. */
export type Tasable = { presentacionId: string } | { servicioId: string };

function esPresentacion(t: Tasable): t is { presentacionId: string } {
  return (t as { presentacionId?: string }).presentacionId !== undefined;
}

/**
 * El precio que corresponde cobrar.
 *
 * `listaId` es la lista elegida para esta venta (nocturno, convenio…).
 * Sin lista, o con una lista que no cubre este ítem, o con una lista
 * fuera de vigencia, devuelve el precio base.
 */
export async function precioVigente(
  db: PoolClient,
  tasable: Tasable,
  opciones: { listaId?: string | null; momento?: Date; zonaHoraria?: string | null } = {}
): Promise<PrecioResuelto> {
  const base = await precioBase(db, tasable);

  if (!opciones.listaId) return { precio: base, origen: "base", listaId: null, listaNombre: null };

  // La vigencia de la lista se mide por el DÍA DE LA CLÍNICA. Con el de
  // UTC, una lista que arranca mañana ya se aplicaba hoy a las 18:00.
  const dia = opciones.momento
    ? fechaEnZona(opciones.momento, opciones.zonaHoraria)
    : fechaHoyEnZona(opciones.zonaHoraria);
  const columna = esPresentacion(tasable) ? "presentacion_id" : "servicio_id";
  const id = esPresentacion(tasable) ? tasable.presentacionId : tasable.servicioId;

  const r = await db.query<{ precio: string; nombre: string }>(
    `SELECT i.precio, l.nombre
       FROM inv_lista_precio_items i
       JOIN inv_listas_precio l ON l.id = i.lista_id
      WHERE i.lista_id = $1
        AND i.${columna} = $2
        AND l.activo
        AND (l.vigente_desde IS NULL OR l.vigente_desde <= $3::date)
        AND (l.vigente_hasta IS NULL OR l.vigente_hasta >= $3::date)`,
    [opciones.listaId, id, dia]
  );

  if (r.rows.length === 0) {
    return { precio: base, origen: "base", listaId: null, listaNombre: null };
  }
  return {
    precio: Number(r.rows[0].precio),
    origen: "lista",
    listaId: opciones.listaId,
    listaNombre: r.rows[0].nombre,
  };
}

async function precioBase(db: PoolClient, tasable: Tasable): Promise<number> {
  if (esPresentacion(tasable)) {
    const r = await db.query<{ precio_venta: string | null }>(
      `SELECT precio_venta FROM inv_presentaciones WHERE id = $1`,
      [tasable.presentacionId]
    );
    if (r.rows.length === 0) throw new Error("Esa presentación no existe.");
    return Number(r.rows[0].precio_venta ?? 0);
  }
  const r = await db.query<{ precio: string }>(`SELECT precio FROM inv_servicios WHERE id = $1`, [
    tasable.servicioId,
  ]);
  if (r.rows.length === 0) throw new Error("Ese servicio no existe.");
  return Number(r.rows[0].precio);
}

// ---------------------------------------------------------------------
// Administración de las listas
// ---------------------------------------------------------------------

export async function listas(db: PoolClient, tenantId: string): Promise<Lista[]> {
  const r = await db.query<{
    id: string;
    codigo: string;
    nombre: string;
    vigente_desde: Date | null;
    vigente_hasta: Date | null;
    activo: boolean;
    items: string;
    vigente_hoy: boolean;
  }>(
    `SELECT l.id, l.codigo, l.nombre, l.vigente_desde, l.vigente_hasta, l.activo,
            count(i.id)::text AS items,
            (l.activo
              AND (l.vigente_desde IS NULL OR l.vigente_desde <= current_date)
              AND (l.vigente_hasta IS NULL OR l.vigente_hasta >= current_date)) AS vigente_hoy
       FROM inv_listas_precio l
       LEFT JOIN inv_lista_precio_items i ON i.lista_id = l.id
      WHERE l.tenant_id = $1
      GROUP BY l.id
      ORDER BY l.activo DESC, l.nombre`,
    [tenantId]
  );
  return r.rows.map((f) => ({
    id: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    vigenteDesde: f.vigente_desde ? f.vigente_desde.toISOString().slice(0, 10) : null,
    vigenteHasta: f.vigente_hasta ? f.vigente_hasta.toISOString().slice(0, 10) : null,
    activo: f.activo,
    items: Number(f.items),
    vigenteHoy: f.vigente_hoy,
  }));
}

export async function crearLista(
  db: PoolClient,
  tenantId: string,
  datos: {
    codigo: string;
    nombre: string;
    vigenteDesde?: string | null;
    vigenteHasta?: string | null;
  }
): Promise<{ id: string }> {
  if (!datos.codigo?.trim() || !datos.nombre?.trim()) {
    throw new Error("Una lista de precio necesita código y nombre.");
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO inv_listas_precio (tenant_id, codigo, nombre, vigente_desde, vigente_hasta)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      tenantId,
      datos.codigo.trim().toUpperCase(),
      datos.nombre.trim(),
      datos.vigenteDesde || null,
      datos.vigenteHasta || null,
    ]
  );
  return { id: r.rows[0].id };
}

export async function editarLista(
  db: PoolClient,
  tenantId: string,
  listaId: string,
  datos: {
    nombre?: string;
    vigenteDesde?: string | null;
    vigenteHasta?: string | null;
    activo?: boolean;
  }
): Promise<void> {
  const r = await db.query(
    `UPDATE inv_listas_precio
        SET nombre        = COALESCE($3, nombre),
            vigente_desde = CASE WHEN $4::boolean THEN $5::date ELSE vigente_desde END,
            vigente_hasta = CASE WHEN $6::boolean THEN $7::date ELSE vigente_hasta END,
            activo        = COALESCE($8, activo)
      WHERE id = $1 AND tenant_id = $2`,
    [
      listaId,
      tenantId,
      datos.nombre?.trim() ?? null,
      datos.vigenteDesde !== undefined,
      datos.vigenteDesde || null,
      datos.vigenteHasta !== undefined,
      datos.vigenteHasta || null,
      datos.activo ?? null,
    ]
  );
  if (r.rowCount === 0) throw new Error("Esa lista de precio no existe.");
}

export interface ItemDeLista {
  id: string | null;
  presentacionId: string | null;
  servicioId: string | null;
  etiqueta: string;
  lineaNegocio: string | null;
  precioBase: number;
  precioLista: number | null;
}

/**
 * Lo que la lista cubre y lo que no, en una sola tabla: toda
 * presentación vendible y todo servicio activo, con su precio base y
 * —si lo tiene— el de la lista. Mostrar solo los ítems cargados haría
 * invisible lo que falta, que es justo lo que se va a revisar.
 */
export async function itemsDeLista(
  db: PoolClient,
  tenantId: string,
  listaId: string
): Promise<ItemDeLista[]> {
  const r = await db.query<{
    id: string | null;
    presentacion_id: string | null;
    servicio_id: string | null;
    etiqueta: string;
    linea_negocio: string | null;
    precio_base: string | null;
    precio_lista: string | null;
  }>(
    `SELECT i.id, pr.id AS presentacion_id, NULL::uuid AS servicio_id,
            p.nombre || ' — ' || pr.nombre AS etiqueta,
            p.linea_negocio, pr.precio_venta AS precio_base, i.precio AS precio_lista
       FROM inv_presentaciones pr
       JOIN inv_productos p ON p.id = pr.producto_id
       LEFT JOIN inv_lista_precio_items i
              ON i.presentacion_id = pr.id AND i.lista_id = $2
      WHERE pr.tenant_id = $1 AND pr.activo AND pr.para_venta
     UNION ALL
     SELECT i.id, NULL::uuid, s.id,
            s.nombre, s.linea_negocio, s.precio, i.precio
       FROM inv_servicios s
       LEFT JOIN inv_lista_precio_items i
              ON i.servicio_id = s.id AND i.lista_id = $2
      WHERE s.tenant_id = $1 AND s.activo
      ORDER BY etiqueta`,
    [tenantId, listaId]
  );
  return r.rows.map((f) => ({
    id: f.id,
    presentacionId: f.presentacion_id,
    servicioId: f.servicio_id,
    etiqueta: f.etiqueta,
    lineaNegocio: f.linea_negocio,
    precioBase: Number(f.precio_base ?? 0),
    precioLista: f.precio_lista === null ? null : Number(f.precio_lista),
  }));
}

/** Fija (o quita, con `precio` en null) el precio de un ítem en la lista. */
export async function fijarItem(
  db: PoolClient,
  tenantId: string,
  listaId: string,
  item: Tasable & { precio: number | null }
): Promise<void> {
  const columna = esPresentacion(item) ? "presentacion_id" : "servicio_id";
  const id = esPresentacion(item) ? item.presentacionId : item.servicioId;

  if (item.precio === null) {
    await db.query(
      `DELETE FROM inv_lista_precio_items
        WHERE tenant_id = $1 AND lista_id = $2 AND ${columna} = $3`,
      [tenantId, listaId, id]
    );
    return;
  }
  if (item.precio < 0) throw new Error("Un precio no puede ser negativo.");

  await db.query(
    `INSERT INTO inv_lista_precio_items (tenant_id, lista_id, ${columna}, precio)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (lista_id, ${columna}) WHERE ${columna} IS NOT NULL
     DO UPDATE SET precio = EXCLUDED.precio`,
    [tenantId, listaId, id, item.precio]
  );
}

// ---------------------------------------------------------------------
// Actualización masiva por porcentaje, con vista previa
// ---------------------------------------------------------------------

export interface AlcanceMasivo {
  /** `base` toca el precio del catálogo; una lista toca solo esa lista. */
  destino: "base" | "lista";
  listaId?: string | null;
  porcentaje: number;
  /** Qué se incluye. Sin filtros, todo lo vendible y todo servicio. */
  lineaNegocio?: string | null;
  categoria?: string | null;
  incluirProductos?: boolean;
  incluirServicios?: boolean;
  /** Redondeo del resultado: al colón, a la decena o a los 5 colones. */
  redondeo?: "ninguno" | "colon" | "decena" | "cinco";
}

export interface FilaMasiva {
  presentacionId: string | null;
  servicioId: string | null;
  etiqueta: string;
  actual: number;
  nuevo: number;
}

function redondear(valor: number, modo: AlcanceMasivo["redondeo"]): number {
  switch (modo) {
    case "colon":
      return Math.round(valor);
    case "decena":
      return Math.round(valor / 10) * 10;
    case "cinco":
      return Math.round(valor / 5) * 5;
    default:
      // Cuatro decimales es la escala de las columnas de precio. Sin
      // este recorte, un 10% sobre 1234,5678 propone un número que la
      // base va a redondear sola al guardar, y la vista previa diría
      // una cosa y la base otra.
      return Math.round(valor * 10000) / 10000;
  }
}

/**
 * LA VISTA PREVIA Y LA APLICACIÓN COMPARTEN ESTE CÁLCULO.
 *
 * Es el punto del pedido ("vista previa antes de aplicar"): si la
 * previa se calculara aparte, el día que una de las dos cambie el
 * redondeo o el filtro, la gente autorizaría una cosa y se aplicaría
 * otra, sin error visible.
 */
async function calcularMasiva(
  db: PoolClient,
  tenantId: string,
  a: AlcanceMasivo
): Promise<FilaMasiva[]> {
  if (!Number.isFinite(a.porcentaje)) throw new Error("El porcentaje no es un número.");
  if (a.porcentaje <= -100) {
    throw new Error("Un −100% o menos dejaría los precios en cero o negativos.");
  }
  if (a.destino === "lista" && !a.listaId) {
    throw new Error("Para actualizar una lista hay que decir cuál.");
  }

  const incluirProductos = a.incluirProductos !== false;
  const incluirServicios = a.incluirServicios !== false;
  if (!incluirProductos && !incluirServicios) {
    throw new Error("Hay que incluir productos, servicios o los dos.");
  }

  const factor = 1 + a.porcentaje / 100;
  const filas: FilaMasiva[] = [];

  if (incluirProductos) {
    // El precio de partida depende del destino: actualizar la lista
    // parte del precio que la lista ya tiene, y si no tiene ninguno,
    // del base. Así "subir un 10% la lista nocturno" funciona tanto en
    // la lista recién creada como en la que ya se venía usando.
    const r = await db.query<{
      presentacion_id: string;
      etiqueta: string;
      actual: string | null;
    }>(
      `SELECT pr.id AS presentacion_id,
              p.nombre || ' — ' || pr.nombre AS etiqueta,
              CASE WHEN $2::boolean THEN COALESCE(i.precio, pr.precio_venta)
                   ELSE pr.precio_venta END AS actual
         FROM inv_presentaciones pr
         JOIN inv_productos p ON p.id = pr.producto_id
         LEFT JOIN inv_lista_precio_items i
                ON i.presentacion_id = pr.id AND i.lista_id = $3::uuid
        WHERE pr.tenant_id = $1 AND pr.activo AND pr.para_venta
          AND ($4::varchar IS NULL OR p.linea_negocio = $4::varchar)
          AND ($5::varchar IS NULL OR p.categoria = $5::varchar)
        ORDER BY etiqueta`,
      [tenantId, a.destino === "lista", a.listaId ?? null, a.lineaNegocio ?? null, a.categoria ?? null]
    );
    for (const f of r.rows) {
      const actual = Number(f.actual ?? 0);
      filas.push({
        presentacionId: f.presentacion_id,
        servicioId: null,
        etiqueta: f.etiqueta,
        actual,
        nuevo: redondear(actual * factor, a.redondeo),
      });
    }
  }

  if (incluirServicios) {
    const r = await db.query<{ servicio_id: string; etiqueta: string; actual: string }>(
      `SELECT s.id AS servicio_id, s.nombre AS etiqueta,
              CASE WHEN $2::boolean THEN COALESCE(i.precio, s.precio) ELSE s.precio END AS actual
         FROM inv_servicios s
         LEFT JOIN inv_lista_precio_items i
                ON i.servicio_id = s.id AND i.lista_id = $3::uuid
        WHERE s.tenant_id = $1 AND s.activo
          AND ($4::varchar IS NULL OR s.linea_negocio = $4::varchar)
        ORDER BY etiqueta`,
      [tenantId, a.destino === "lista", a.listaId ?? null, a.lineaNegocio ?? null]
    );
    for (const f of r.rows) {
      const actual = Number(f.actual);
      filas.push({
        presentacionId: null,
        servicioId: f.servicio_id,
        etiqueta: f.etiqueta,
        actual,
        nuevo: redondear(actual * factor, a.redondeo),
      });
    }
  }

  return filas;
}

/** Vista previa: calcula y NO escribe. */
export async function vistaPreviaMasiva(
  db: PoolClient,
  tenantId: string,
  a: AlcanceMasivo
): Promise<{ filas: FilaMasiva[]; cuantos: number; sinPrecio: number }> {
  const filas = await calcularMasiva(db, tenantId, a);
  return {
    filas,
    cuantos: filas.length,
    // Los que están en cero: el porcentaje sobre cero sigue siendo
    // cero, así que la masiva no los arregla y conviene decirlo en vez
    // de dejar filas que "no cambian" sin explicación.
    sinPrecio: filas.filter((f) => f.actual === 0).length,
  };
}

/**
 * Aplica la actualización. Recalcula con los mismos parámetros en vez
 * de recibir las filas de la pantalla: aceptar precios de un cliente
 * sería aceptar que alguien edite el JSON entre la previa y el aplicar.
 *
 * Devuelve las filas que efectivamente cambiaron, para que la pantalla
 * muestre lo aplicado y no lo pedido. Si alguien tocó un precio base en
 * el medio, se ve en esa diferencia.
 */
export async function aplicarMasiva(
  db: PoolClient,
  tenantId: string,
  a: AlcanceMasivo
): Promise<{ aplicadas: number; filas: FilaMasiva[] }> {
  const filas = await calcularMasiva(db, tenantId, a);
  const cambian = filas.filter((f) => f.nuevo !== f.actual);

  for (const f of cambian) {
    if (a.destino === "base") {
      if (f.presentacionId) {
        await db.query(
          `UPDATE inv_presentaciones SET precio_venta = $2 WHERE id = $1 AND tenant_id = $3`,
          [f.presentacionId, f.nuevo, tenantId]
        );
      } else {
        await db.query(`UPDATE inv_servicios SET precio = $2 WHERE id = $1 AND tenant_id = $3`, [
          f.servicioId,
          f.nuevo,
          tenantId,
        ]);
      }
    } else {
      await fijarItem(
        db,
        tenantId,
        a.listaId!,
        f.presentacionId
          ? { presentacionId: f.presentacionId, precio: f.nuevo }
          : { servicioId: f.servicioId!, precio: f.nuevo }
      );
    }
  }

  return { aplicadas: cambian.length, filas: cambian };
}
