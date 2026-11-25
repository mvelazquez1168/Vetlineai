import { Pool, PoolClient } from "pg";
import {
  CODIGOS_DESCUENTO,
  CODIGOS_IMPUESTO,
  CODIGOS_REFERENCIA,
  CONDICIONES_IMPUESTO,
  CONDICIONES_VENTA,
  MEDIOS_PAGO,
  MONEDAS,
  TARIFAS_IVA,
  TIPOS_COMPROBANTE,
  TIPOS_DOC_REFERENCIA,
  TIPOS_IDENTIFICACION,
  UNIDADES_MEDIDA,
} from "./catalogos";
import { ResultadoCargaCabys, cargarCabys } from "./cabys";

// ---------------------------------------------------------------------
// Carga de los catálogos oficiales en las tablas `fact_cat_*`.
//
// Idempotente por diseño: todo es `INSERT ... ON CONFLICT (codigo) DO
// UPDATE`. Correrlo dos veces no cambia nada; correrlo después de que
// Hacienda actualice un catálogo actualiza los nombres sin tocar las
// filas que ya referencian esos códigos.
//
// Qué NO hace, a propósito:
//
//   * No borra códigos que ya no estén en la lista. Un comprobante viejo
//     puede referenciar un código que Hacienda discontinuó, y borrarlo
//     rompería la FK o —peor— obligaría a borrar el comprobante. Lo que
//     hace es marcarlos `activo = false`: dejan de ofrecerse para emitir
//     y siguen sirviendo para leer lo ya emitido. Es el mismo criterio
//     que el estado "discontinuado" de los agentes (migración 062).
//
//   * CABYS se carga, pero de OTRA fuente y por eso tiene su propio
//     módulo (`cabys.ts`): no viene en los anexos de Hacienda sino en una
//     planilla del Banco Central. Entra por acá para que sea el mismo
//     comando idempotente que el resto, que es lo que hace que
//     actualizarlo sea una sola cosa y no dos.
// ---------------------------------------------------------------------

export interface ResultadoCarga {
  tabla: string;
  insertados: number;
  actualizados: number;
  desactivados: number;
}

type Ejecutor = Pool | PoolClient;

/**
 * Un catálogo. `codigo` y `nombre` son el contrato mínimo; `extra` lleva
 * las columnas propias de cada tabla, con el nombre de columna como
 * llave, para no escribir doce funciones de carga casi iguales.
 */
interface EntradaGenerica {
  codigo: string;
  nombre: string;
  extra?: Record<string, unknown>;
}

async function cargarTabla(
  db: Ejecutor,
  tabla: string,
  columnaNombre: string,
  filas: EntradaGenerica[]
): Promise<ResultadoCarga> {
  const columnasExtra = Array.from(
    new Set(filas.flatMap((f) => Object.keys(f.extra ?? {})))
  ).sort();

  const columnas = ["codigo", columnaNombre, ...columnasExtra, "activo"];
  let insertados = 0;
  let actualizados = 0;

  for (const fila of filas) {
    const valores: unknown[] = [
      fila.codigo,
      fila.nombre,
      ...columnasExtra.map((c) => fila.extra?.[c] ?? null),
      true,
    ];
    const marcadores = valores.map((_, i) => `$${i + 1}`).join(", ");
    const asignaciones = columnas
      .slice(1)
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");

    // `xmax = 0` distingue un INSERT real de un UPDATE: es el truco
    // estándar sobre el sistema de versiones de fila de Postgres. Sirve
    // para que el script diga qué cambió de verdad en vez de "12 filas",
    // que es lo mismo la primera vez y la décima.
    const r = await db.query<{ insertado: boolean }>(
      `INSERT INTO ${tabla} (${columnas.join(", ")})
       VALUES (${marcadores})
       ON CONFLICT (codigo) DO UPDATE SET ${asignaciones}
       RETURNING (xmax = 0) AS insertado`,
      valores
    );
    if (r.rows[0]?.insertado) insertados++;
    else actualizados++;
  }

  // Lo que está en la tabla y ya no está en el catálogo oficial: se
  // desactiva, nunca se borra.
  const codigos = filas.map((f) => f.codigo);
  const desactivados = await db.query(
    `UPDATE ${tabla} SET activo = false
     WHERE activo = true AND codigo <> ALL($1::text[])
     RETURNING codigo`,
    [codigos]
  );

  return { tabla, insertados, actualizados, desactivados: desactivados.rowCount ?? 0 };
}

export interface ResultadoCatalogos {
  resultados: ResultadoCarga[];
  /** `null` si la planilla del BCCR no está; el detalle de la carga si sí. */
  cabys: ResultadoCargaCabys | null;
  /** Por qué no se pudo cargar CABYS, cuando no se pudo. */
  cabysMotivo?: string;
  cabysVacio: boolean;
}

export async function cargarCatalogosFacturacion(db: Ejecutor): Promise<ResultadoCatalogos> {
  const resultados: ResultadoCarga[] = [];

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_tipo_comprobante",
      "nombre",
      TIPOS_COMPROBANTE.map((t) => ({
        codigo: t.codigo,
        nombre: t.nombre,
        extra: {
          elemento_raiz: t.elementoRaiz,
          archivo_xsd: t.archivoXsd,
          es_comprobante: t.esComprobante,
        },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_tipo_identificacion",
      "nombre",
      TIPOS_IDENTIFICACION.map((t) => ({
        codigo: t.codigo,
        nombre: t.nombre,
        extra: { largo_en_clave: t.largoEnClave, nota_relleno: t.notaRelleno },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_condicion_venta",
      "nombre",
      CONDICIONES_VENTA.map((c) => ({
        codigo: c.codigo,
        nombre: c.nombre,
        extra: { exige_detalle: c.exigeDetalle ?? false, solo_en_rep: c.soloEnRep ?? false },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_medio_pago",
      "nombre",
      MEDIOS_PAGO.map((m) => ({
        codigo: m.codigo,
        nombre: m.nombre,
        extra: { exige_detalle: m.exigeDetalle ?? false },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_codigo_impuesto",
      "nombre",
      CODIGOS_IMPUESTO.map((c) => ({
        codigo: c.codigo,
        nombre: c.nombre,
        extra: {
          exige_detalle: c.exigeDetalle ?? false,
          exige_datos_especificos: c.exigeDatosEspecificos ?? false,
        },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_tarifa_iva",
      "nombre",
      TARIFAS_IVA.map((t) => ({
        codigo: t.codigo,
        nombre: t.nombre,
        extra: { tarifa: t.tarifa, solo_en_notas: t.soloEnNotas ?? false },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_unidad_medida",
      "descripcion",
      UNIDADES_MEDIDA.map((u) => ({ codigo: u.codigo, nombre: u.descripcion }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_moneda",
      "nombre",
      Object.entries(MONEDAS).map(([codigo, nombre]) => ({ codigo, nombre }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_codigo_descuento",
      "nombre",
      CODIGOS_DESCUENTO.map((c) => ({
        codigo: c.codigo,
        nombre: c.nombre,
        extra: { exige_detalle: c.exigeDetalle ?? false },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_tipo_doc_referencia",
      "nombre",
      TIPOS_DOC_REFERENCIA.map((t) => ({
        codigo: t.codigo,
        nombre: t.nombre,
        extra: { exige_detalle: t.exigeDetalle ?? false },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_codigo_referencia",
      "nombre",
      CODIGOS_REFERENCIA.map((c) => ({
        codigo: c.codigo,
        nombre: c.nombre,
        extra: { exige_detalle: c.exigeDetalle ?? false, solo_en_rep: c.soloEnRep ?? false },
      }))
    )
  );

  resultados.push(
    await cargarTabla(
      db,
      "fact_cat_condicion_impuesto",
      "nombre",
      CONDICIONES_IMPUESTO.map((c) => ({ codigo: c.codigo, nombre: c.nombre }))
    )
  );

  // CABYS va al final: es el más grande (más de veinte mil filas) y
  // depende de `fact_cat_tarifa_iva`, que se cargó más arriba — la FK de
  // `codigo_tarifa_iva_sugerido` apunta ahí.
  let cabys: ResultadoCargaCabys | null = null;
  let cabysMotivo: string | undefined;
  try {
    cabys = await cargarCabys(db);
  } catch (err) {
    // Que falte la planilla NO tumba la carga de los otros doce
    // catálogos: son independientes, y dejar los doce sin cargar por un
    // archivo ausente convertiría un problema chico en uno grande.
    cabysMotivo = (err as Error).message;
  }

  const cuenta = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM fact_cat_cabys WHERE activo = true"
  );
  return { resultados, cabys, cabysMotivo, cabysVacio: cuenta.rows[0].n === "0" };
}
