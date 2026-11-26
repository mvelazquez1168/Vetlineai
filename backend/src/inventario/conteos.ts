import { PoolClient } from "pg";
import { solicitarAjuste, LineaAjuste } from "./ajustes";

// ---------------------------------------------------------------------
// CONTEOS FÍSICOS.
//
// Abrir un conteo CONGELA lo que el sistema cree que hay, lote por
// lote. Ese número es el que después se compara con lo contado.
//
// Por qué se congela en vez de leerse al cerrar: entre que alguien
// empieza a contar el estante y termina, la clínica sigue vendiendo. Si
// la comparación se hiciera contra la existencia del momento de cerrar,
// cada venta hecha durante el conteo aparecería como una diferencia y
// el ajuste corregiría algo que no estaba mal.
//
// El conteo NO ajusta solo: al cerrarlo genera un AJUSTE con su motivo,
// que pasa por el mismo umbral de aprobación que cualquier otro. Un
// conteo que mueve stock por su cuenta sería una puerta trasera al
// control que los ajustes existen para dar.
// ---------------------------------------------------------------------

export interface ConteoAbierto {
  id: string;
  lineas: number;
}

/**
 * Abre un conteo y toma la foto de la existencia.
 *
 * `clasificacion` solo aplica al conteo cíclico (ABC). El total toma
 * todos los productos con existencia de la bodega.
 */
export async function abrirConteo(
  db: PoolClient,
  tenantId: string,
  datos: {
    bodegaId: string;
    tipo: "total" | "ciclico";
    clasificacion?: "A" | "B" | "C";
    creadoPor?: string;
    /** Para el cíclico: qué productos entran. */
    productoIds?: string[];
  }
): Promise<ConteoAbierto> {
  if (datos.tipo === "ciclico" && (!datos.productoIds || datos.productoIds.length === 0)) {
    throw new Error("Un conteo cíclico tiene que decir qué productos se cuentan.");
  }

  const c = await db.query<{ id: string }>(
    `INSERT INTO inv_conteos (tenant_id, bodega_id, tipo, clasificacion, creado_por)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [tenantId, datos.bodegaId, datos.tipo, datos.clasificacion ?? null, datos.creadoPor ?? null]
  );
  const conteoId = c.rows[0].id;

  const valores: unknown[] = [tenantId, conteoId, datos.bodegaId];
  const filtroProducto = datos.tipo === "ciclico" ? "AND l.producto_id = ANY($4::uuid[])" : "";
  if (datos.tipo === "ciclico") valores.push(datos.productoIds);

  const insertadas = await db.query(
    `INSERT INTO inv_conteo_lineas (tenant_id, conteo_id, producto_id, lote_id, cantidad_sistema)
     SELECT $1, $2, l.producto_id, l.id, l.cantidad
       FROM inv_lotes l
      WHERE l.bodega_id = $3 ${filtroProducto}
     RETURNING id`,
    valores
  );

  return { id: conteoId, lineas: insertadas.rowCount ?? 0 };
}

/**
 * Anota lo contado de una línea, en la presentación en que se contó.
 *
 * La conversión a unidad base se hace acá y no en la pantalla: es la
 * misma razón por la que los movimientos convierten en un solo lugar.
 */
export async function anotarConteo(
  db: PoolClient,
  conteoId: string,
  lineaId: string,
  datos: { presentacionId?: string; cantidad: string | number }
): Promise<{ cantidadBase: number }> {
  const estado = await db.query<{ estado: string }>(
    `SELECT estado FROM inv_conteos WHERE id = $1`,
    [conteoId]
  );
  if (estado.rows[0]?.estado !== "abierto") {
    throw new Error("El conteo ya no está abierto.");
  }

  const cantidad = Number(String(datos.cantidad).replace(",", "."));
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    throw new Error("La cantidad contada no puede ser negativa ni dejar de ser un número.");
  }

  let factor = 1;
  if (datos.presentacionId) {
    const p = await db.query<{ factor: string }>(
      `SELECT factor FROM inv_presentaciones WHERE id = $1`,
      [datos.presentacionId]
    );
    if (p.rows.length === 0) throw new Error("Esa presentación no existe.");
    factor = Number(p.rows[0].factor);
  }

  const base = cantidad * factor;
  await db.query(
    `UPDATE inv_conteo_lineas
        SET presentacion_id = $2, cantidad_contada_presentacion = $3, cantidad_contada_base = $4
      WHERE id = $1 AND conteo_id = $5`,
    [lineaId, datos.presentacionId ?? null, cantidad, base, conteoId]
  );
  return { cantidadBase: base };
}

export interface ResultadoCierre {
  diferencias: Array<{
    productoId: string;
    loteId: string | null;
    sistema: number;
    contado: number;
    diferencia: number;
  }>;
  ajustePositivoId?: string;
  ajusteNegativoId?: string;
  sinContar: number;
}

/**
 * Cierra el conteo y pide los ajustes que correspondan.
 *
 * Se generan HASTA DOS ajustes y no uno: sobrantes y faltantes son
 * direcciones distintas, y un ajuste tiene una sola. Mezclarlos
 * obligaría a que el ajuste llevara signo por línea, que es
 * exactamente lo que la dirección fija del catálogo viene a evitar.
 *
 * Las líneas SIN contar no se tocan: no contar algo no es decir que
 * hay cero.
 */
export async function cerrarConteo(
  db: PoolClient,
  tenantId: string,
  conteoId: string,
  cerradoPor?: string
): Promise<ResultadoCierre> {
  const c = await db.query<{ estado: string; bodega_id: string }>(
    `SELECT estado, bodega_id FROM inv_conteos WHERE id = $1`,
    [conteoId]
  );
  if (c.rows.length === 0) throw new Error(`No existe el conteo ${conteoId}.`);
  if (c.rows[0].estado !== "abierto") throw new Error("El conteo ya está cerrado.");

  const lineas = await db.query<{
    producto_id: string;
    lote_id: string | null;
    cantidad_sistema: string;
    cantidad_contada_base: string | null;
  }>(
    `SELECT producto_id, lote_id, cantidad_sistema, cantidad_contada_base
       FROM inv_conteo_lineas WHERE conteo_id = $1`,
    [conteoId]
  );

  const sinContar = lineas.rows.filter((l) => l.cantidad_contada_base === null).length;
  const diferencias = lineas.rows
    .filter((l) => l.cantidad_contada_base !== null)
    .map((l) => ({
      productoId: l.producto_id,
      loteId: l.lote_id,
      sistema: Number(l.cantidad_sistema),
      contado: Number(l.cantidad_contada_base),
      diferencia: Number(l.cantidad_contada_base) - Number(l.cantidad_sistema),
    }))
    .filter((d) => d.diferencia !== 0);

  const aLineaAjuste = (d: (typeof diferencias)[number]): LineaAjuste => ({
    productoId: d.productoId,
    bodegaId: c.rows[0].bodega_id,
    loteId: d.loteId ?? undefined,
    cantidadBase: Math.abs(d.diferencia),
  });

  const sobrantes = diferencias.filter((d) => d.diferencia > 0);
  const faltantes = diferencias.filter((d) => d.diferencia < 0);

  let ajustePositivoId: string | undefined;
  let ajusteNegativoId: string | undefined;

  if (sobrantes.length > 0) {
    const r = await solicitarAjuste(db, tenantId, {
      tipo: "positivo",
      motivo: "diferencia_conteo",
      lineas: sobrantes.map(aLineaAjuste),
      solicitadoPor: cerradoPor,
      conteoId,
    });
    ajustePositivoId = r.id;
  }
  if (faltantes.length > 0) {
    const r = await solicitarAjuste(db, tenantId, {
      tipo: "negativo",
      motivo: "diferencia_conteo",
      lineas: faltantes.map(aLineaAjuste),
      solicitadoPor: cerradoPor,
      conteoId,
    });
    ajusteNegativoId = r.id;
  }

  await db.query(
    `UPDATE inv_conteos SET estado = 'cerrado', cerrado_en = now() WHERE id = $1`,
    [conteoId]
  );

  return { diferencias, ajustePositivoId, ajusteNegativoId, sinContar };
}
