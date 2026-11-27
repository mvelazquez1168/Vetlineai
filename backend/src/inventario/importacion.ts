import { PoolClient } from "pg";
import { abrirLibro, celdasDeFila, filasDeHoja } from "../facturacion/xlsx";
import { registrarMovimiento } from "./movimientos";

// ---------------------------------------------------------------------
// IMPORTACIÓN INICIAL del inventario desde una planilla.
//
// Es el camino para traer lo que la clínica ya tiene el día que empieza
// a usar el módulo.
//
// TRES PROPIEDADES, y las tres son el punto:
//
//   1. **Validación fila por fila, con el motivo.** No "la fila 37 es
//      inválida", sino "la fila 37: el factor 0 no sirve, una
//      presentación equivale al menos a una unidad base". Quien corrige
//      la planilla tiene que poder hacerlo sin adivinar.
//
//   2. **Vista previa antes de cargar.** `analizar()` no escribe nada.
//
//   3. **Carga ATÓMICA.** O entran todas las filas válidas o no entra
//      ninguna. Una importación a medias deja un inventario que parece
//      cargado y no lo está, y nadie sabe desde qué fila seguir.
//
// El lector de `.xlsx` es el de `facturacion/xlsx.ts` — el mismo que
// lee el CABYS y la codificación de ubicación. Tres planillas, un
// lector.
// ---------------------------------------------------------------------

/** Las columnas de la plantilla, en orden. Es también lo que se descarga. */
export const COLUMNAS_PLANTILLA = [
  "codigo",
  "nombre",
  "linea_negocio",
  "unidad_base",
  "categoria",
  "codigo_cabys",
  "codigo_tarifa_iva",
  "presentacion_codigo",
  "presentacion_nombre",
  "presentacion_factor",
  "presentacion_unidad_medida",
  "precio_venta",
  "minimo",
  "punto_reorden",
  "existencia_inicial",
  "lote",
  "vencimiento",
  "costo_unitario",
] as const;

/**
 * Columnas que la planilla PUEDE traer y que no son obligatorias.
 *
 * `tipo_clinico` se suma acá y no a la lista de arriba (defecto del
 * 2026-11-27, punto 3): si fuera obligatoria, toda planilla ya armada
 * por una clínica dejaría de importar con «le faltan columnas», y lo que
 * se quería era poder traer el dato, no romper lo que funciona.
 *
 * La plantilla que se descarga SÍ la trae: quien arranca de la plantilla
 * tiene la columna y se entera de que existe.
 */
export const COLUMNAS_OPCIONALES = ["tipo_clinico"] as const;

export const TIPOS_CLINICOS_PLANTILLA = [
  "vacuna",
  "antiparasitario",
  "medicamento",
  "insumo",
  "otro",
];

export type ColumnaPlantilla =
  | (typeof COLUMNAS_PLANTILLA)[number]
  | (typeof COLUMNAS_OPCIONALES)[number];

export interface FilaImportacion {
  numeroFila: number;
  valores: Record<string, string>;
  errores: string[];
}

export interface AnalisisImportacion {
  columnas: string[];
  filas: FilaImportacion[];
  validas: number;
  invalidas: number;
}

/** Lee la planilla y devuelve las filas con sus errores. NO escribe. */
export async function analizarImportacion(
  db: PoolClient,
  ruta: string
): Promise<AnalisisImportacion> {
  const libro = abrirLibro(ruta, "el inventario inicial");
  const filasXml = filasDeHoja(libro.xmlDeHoja(0));
  if (filasXml.length === 0) throw new Error("La planilla no tiene ni una fila.");

  const encabezado = celdasDeFila(filasXml[0], libro.textos);
  const columnas = Object.keys(encabezado)
    .sort()
    .map((letra) => (encabezado[letra] ?? "").trim().toLowerCase());

  const faltan = COLUMNAS_PLANTILLA.filter((c) => !columnas.includes(c));
  if (faltan.length > 0) {
    throw new Error(
      `A la planilla le faltan columnas: ${faltan.join(", ")}. ` +
        `La plantilla se descarga desde la misma pantalla de importación.`
    );
  }
  const porNombre = new Map<string, string>();
  for (const [letra, valor] of Object.entries(encabezado)) {
    porNombre.set((valor ?? "").trim().toLowerCase(), letra);
  }

  // Los catálogos se leen UNA vez y se validan en memoria: una consulta
  // por fila contra cinco catálogos son cinco mil consultas en una
  // planilla de mil filas.
  const lineas = new Set(
    (await db.query<{ codigo: string }>(`SELECT codigo FROM lineas_negocio WHERE activo`)).rows.map(
      (r) => r.codigo
    )
  );
  const unidades = new Set(
    (
      await db.query<{ codigo: string }>(`SELECT codigo FROM fact_cat_unidad_medida WHERE activo`)
    ).rows.map((r) => r.codigo)
  );
  const tarifas = new Set(
    (await db.query<{ codigo: string }>(`SELECT codigo FROM fact_cat_tarifa_iva WHERE activo`)).rows.map(
      (r) => r.codigo
    )
  );

  const filas: FilaImportacion[] = [];
  const codigosVistos = new Set<string>();
  const presentacionesVistas = new Set<string>();

  for (let i = 1; i < filasXml.length; i++) {
    const c = celdasDeFila(filasXml[i], libro.textos);
    const leer = (col: ColumnaPlantilla) => (c[porNombre.get(col)!] ?? "").trim();

    const valores: Record<string, string> = {};
    for (const col of COLUMNAS_PLANTILLA) valores[col] = leer(col);
    // Las opcionales solo si la planilla las trae: `leer` indexa por la
    // letra de la columna y sin encabezado no hay letra.
    for (const col of COLUMNAS_OPCIONALES) {
      valores[col] = porNombre.has(col) ? leer(col) : "";
    }

    // Una fila entera vacía es el final de la planilla, no un error.
    if (Object.values(valores).every((v) => v === "")) continue;

    const errores: string[] = [];
    const exigir = (col: ColumnaPlantilla, queEs: string) => {
      if (valores[col] === "") errores.push(`falta ${queEs} (columna ${col})`);
    };
    exigir("codigo", "el código del producto");
    exigir("nombre", "el nombre");
    exigir("unidad_base", "la unidad base");
    exigir("presentacion_codigo", "el código de la presentación");
    exigir("presentacion_nombre", "el nombre de la presentación");

    // EL TIPO CLÍNICO, si vino. Un valor inventado se rechaza en vez de
    // guardarse: con `tipo_clinico = 'medicamentos'` el producto no
    // aparecería en ninguna acción y nadie sabría por qué.
    if (valores.tipo_clinico && !TIPOS_CLINICOS_PLANTILLA.includes(valores.tipo_clinico)) {
      errores.push(
        `el tipo clínico «${valores.tipo_clinico}» no existe (columna tipo_clinico; ` +
          `los válidos son ${TIPOS_CLINICOS_PLANTILLA.join(", ")})`
      );
    }

    if (valores.linea_negocio && !lineas.has(valores.linea_negocio)) {
      errores.push(
        `la línea de negocio "${valores.linea_negocio}" no existe; las válidas son ${[...lineas].join(", ")}`
      );
    } else if (!valores.linea_negocio) {
      errores.push("falta la línea de negocio");
    }

    const factor = Number(valores.presentacion_factor.replace(",", "."));
    if (!Number.isFinite(factor) || factor <= 0) {
      errores.push(
        `el factor "${valores.presentacion_factor}" no sirve: una presentación equivale al menos a una unidad base`
      );
    }

    if (valores.presentacion_unidad_medida && !unidades.has(valores.presentacion_unidad_medida)) {
      errores.push(
        `la unidad de medida "${valores.presentacion_unidad_medida}" no está en el catálogo de Hacienda (Nota 15)`
      );
    }
    if (valores.codigo_tarifa_iva && !tarifas.has(valores.codigo_tarifa_iva)) {
      errores.push(`la tarifa de IVA "${valores.codigo_tarifa_iva}" no está en el catálogo`);
    }
    if (valores.codigo_cabys && !/^[0-9]{13}$/.test(valores.codigo_cabys)) {
      errores.push(`el código CABYS "${valores.codigo_cabys}" no son 13 dígitos`);
    }

    for (const [col, queEs] of [
      ["precio_venta", "el precio de venta"],
      ["minimo", "el mínimo"],
      ["punto_reorden", "el punto de reorden"],
      ["existencia_inicial", "la existencia inicial"],
      ["costo_unitario", "el costo unitario"],
    ] as Array<[ColumnaPlantilla, string]>) {
      if (valores[col] === "") continue;
      const n = Number(valores[col].replace(",", "."));
      if (!Number.isFinite(n) || n < 0) errores.push(`${queEs} "${valores[col]}" no es un número válido`);
    }

    if (valores.existencia_inicial !== "" && Number(valores.existencia_inicial) > 0 && !valores.lote) {
      errores.push("hay existencia inicial pero no se dice de qué lote: toda entrada entra a un lote");
    }

    if (valores.vencimiento && !/^\d{4}-\d{2}-\d{2}$/.test(valores.vencimiento)) {
      errores.push(`el vencimiento "${valores.vencimiento}" tiene que ser AAAA-MM-DD`);
    }

    const clavePresentacion = valores.presentacion_codigo;
    if (clavePresentacion && presentacionesVistas.has(clavePresentacion)) {
      errores.push(`el código de presentación "${clavePresentacion}" se repite en la planilla`);
    }
    presentacionesVistas.add(clavePresentacion);
    codigosVistos.add(valores.codigo);

    filas.push({ numeroFila: i + 1, valores, errores });
  }

  return {
    columnas: [...COLUMNAS_PLANTILLA, ...COLUMNAS_OPCIONALES],
    filas,
    validas: filas.filter((f) => f.errores.length === 0).length,
    invalidas: filas.filter((f) => f.errores.length > 0).length,
  };
}

export interface ResultadoImportacion {
  productos: number;
  presentaciones: number;
  movimientos: number;
  filasRechazadas: FilaImportacion[];
}

/**
 * Carga las filas válidas. Atómica: quien llama abre la transacción, y
 * si algo revienta a mitad no queda nada cargado.
 *
 * Varias filas con el mismo `codigo` de producto son el mismo producto
 * con varias presentaciones: así se describe una caja de 20 que también
 * se vende por tableta, que es el caso normal.
 */
export async function importarInventario(
  db: PoolClient,
  tenantId: string,
  analisis: AnalisisImportacion,
  bodegaId: string,
  personaId?: string
): Promise<ResultadoImportacion> {
  const validas = analisis.filas.filter((f) => f.errores.length === 0);
  const productosPorCodigo = new Map<string, string>();
  let presentaciones = 0;
  let movimientos = 0;

  for (const fila of validas) {
    const v = fila.valores;

    let productoId = productosPorCodigo.get(v.codigo);
    if (!productoId) {
      const existente = await db.query<{ id: string }>(
        `SELECT id FROM inv_productos WHERE tenant_id = $1 AND codigo = $2`,
        [tenantId, v.codigo]
      );
      if (existente.rows.length > 0) {
        productoId = existente.rows[0].id;
      } else {
        const p = await db.query<{ id: string }>(
          `INSERT INTO inv_productos (tenant_id, codigo, nombre, categoria, linea_negocio,
                                      codigo_cabys, codigo_tarifa_iva, unidad_base,
                                      minimo, punto_reorden, tipo_clinico)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            tenantId,
            v.codigo,
            v.nombre,
            v.categoria || null,
            v.linea_negocio,
            v.codigo_cabys || null,
            v.codigo_tarifa_iva || null,
            v.unidad_base,
            v.minimo === "" ? 0 : Number(v.minimo.replace(",", ".")),
            v.punto_reorden === "" ? 0 : Number(v.punto_reorden.replace(",", ".")),
            // Sin la columna queda NULL, que es «sin clasificar»: el
            // producto se ve igual en la búsqueda de la atención, con su
            // etiqueta, y se puede clasificar después en lote.
            v.tipo_clinico || null,
          ]
        );
        productoId = p.rows[0].id;
      }
      productosPorCodigo.set(v.codigo, productoId);
    }

    await db.query(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                       unidad_medida, precio_venta,
                                       para_compra, para_venta, para_consumo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,true)
       ON CONFLICT (tenant_id, codigo_interno) DO UPDATE SET
         nombre = EXCLUDED.nombre, factor = EXCLUDED.factor,
         unidad_medida = EXCLUDED.unidad_medida, precio_venta = EXCLUDED.precio_venta`,
      [
        tenantId,
        productoId,
        v.presentacion_codigo,
        v.presentacion_nombre,
        Number(v.presentacion_factor.replace(",", ".")),
        v.presentacion_unidad_medida || "Unid",
        v.precio_venta === "" ? null : Number(v.precio_venta.replace(",", ".")),
      ]
    );
    presentaciones++;

    const existencia = v.existencia_inicial === "" ? 0 : Number(v.existencia_inicial.replace(",", "."));
    if (existencia > 0) {
      await registrarMovimiento(db, tenantId, {
        tipo: "inventario_inicial",
        productoId,
        bodegaId,
        cantidadBase: existencia,
        lote: {
          numero: v.lote,
          vencimiento: v.vencimiento || null,
          costoUnitario: v.costo_unitario === "" ? 0 : Number(v.costo_unitario.replace(",", ".")),
        },
        personaId,
        motivoDetalle: `Importación inicial, fila ${fila.numeroFila}`,
      });
      movimientos++;
    }
  }

  return {
    productos: productosPorCodigo.size,
    presentaciones,
    movimientos,
    filasRechazadas: analisis.filas.filter((f) => f.errores.length > 0),
  };
}
