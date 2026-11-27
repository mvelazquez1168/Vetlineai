import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// EL TIPO CLÍNICO DE UN PRODUCTO — defecto del 2026-11-27, punto 3.
//
// `tipo_clinico` decide en qué acción de la atención aparece un
// producto: «Vacuna» muestra las vacunas, «Desparasitación» los
// antiparasitarios, la receta los medicamentos. La migración 115 lo
// agregó y lo llenó solo donde era evidente por el nombre. Con el
// catálogo real cargado eso dio: 1.782 productos sin clasificar, UNA
// amoxicilina clasificada. La receta ofrecía un producto.
//
// La corrección de fondo es que la búsqueda muestre lo sin clasificar
// (ver `productosParaAtencion`). Este módulo es la otra mitad: poder
// clasificar de a muchos sin abrir 891 fichas.
//
// LO QUE ENCONTRÉ EN EL CATÁLOGO REAL, y cambia el diseño de la
// sugerencia: de los 897 productos de la clínica de `demo.medico`, solo
// 5 tienen categoría, 5 familia, 2 principio activo y NINGUNO forma
// farmacéutica. Lo único que todos tienen es el NOMBRE y el CÓDIGO.
//
// Así que la sugerencia tiene dos fuentes:
//   1. la categoría, como pedía el prompt — sirve para catálogos que la
//      tengan, y no sirve para el que está cargado hoy;
//   2. las palabras del nombre y del principio activo, que es lo único
//      que funciona con lo que hay.
//
// NUNCA SE APLICA SOLA. Devuelve la sugerencia y por qué; confirmarla es
// del usuario. Una clasificación automática equivocada manda un alimento
// a la receta y nadie se enteraría hasta que un médico lo receta.
// ---------------------------------------------------------------------

export type TipoClinicoProducto = "vacuna" | "antiparasitario" | "medicamento" | "insumo" | "otro";

export const TIPOS_CLINICOS: TipoClinicoProducto[] = [
  "vacuna",
  "antiparasitario",
  "medicamento",
  "insumo",
  "otro",
];

export const ETIQUETA_TIPO_CLINICO: Record<TipoClinicoProducto, string> = {
  vacuna: "Vacuna",
  antiparasitario: "Antiparasitario",
  medicamento: "Medicamento",
  insumo: "Insumo",
  otro: "Otro (alimento, accesorio, higiene)",
};

/** La categoría dice el tipo cuando la clínica la cargó. */
const POR_CATEGORIA: Array<{ patron: RegExp; tipo: TipoClinicoProducto }> = [
  { patron: /vacun|biolog/i, tipo: "vacuna" },
  { patron: /antiparasit|desparasit|pulga|garrapat|endectocid/i, tipo: "antiparasitario" },
  { patron: /antibiot|antiinflamat|analges|farmac|medicament|cardio|dermatolog|oftalm|hormona|anest|sedan/i, tipo: "medicamento" },
  { patron: /insumo|material|jeringa|sutura|gasa|quirurg|descartable/i, tipo: "insumo" },
  { patron: /aliment|concentrad|snack|accesori|juguete|higien|shampoo|collar|correa/i, tipo: "otro" },
];

/**
 * Palabras del nombre o del principio activo.
 *
 * El orden importa: se evalúa de arriba abajo y gana la primera. Las
 * vacunas y los antiparasitarios van antes que los medicamentos porque
 * son medicamentos también, y lo que el médico necesita es que
 * aparezcan en SU acción.
 *
 * Las listas son cortas a propósito. Una lista larga parece más
 * completa y acierta igual: lo que decide es que el usuario confirme.
 */
const POR_PALABRA: Array<{ patron: RegExp; tipo: TipoClinicoProducto; porque: string }> = [
  {
    patron: /\b(vacuna|vanguard|nobivac|recombitek|eurican|defensor|bronchicine|felocell|puppy dp|triple felina|quintuple|polivalente|antirrabic)/i,
    tipo: "vacuna",
    porque: "el nombre menciona una vacuna o una marca de vacunas",
  },
  {
    patron: /\b(bravecto|nexgard|simparic|frontline|advantage|revolution|drontal|endogard|ivermectin|praziquantel|fenbendazol|milbemicin|afoxolaner|fluralaner|sarolaner|seresto|capstar|panacur)/i,
    tipo: "antiparasitario",
    porque: "el nombre menciona un antiparasitario conocido",
  },
  {
    patron: /\b(amoxicilin|cefalexin|enrofloxacin|metronidazol|doxiciclin|meloxicam|carprofen|prednisolon|dexametason|tramadol|gabapentin|omeprazol|maropitant|furosemid|ketamin|propofol|lidocain|acepromacin|atropin|dipiron|tolfenamic|clindamicin|marbofloxacin|itraconazol|ketoconazol|mg\b|ml\s+frasco|suspension|tableta|comprimid|inyectabl|ampoll)/i,
    tipo: "medicamento",
    porque: "el nombre menciona un principio activo, una dosis o una forma farmacéutica",
  },
  {
    patron: /\b(jeringa|aguja|gasa|venda|sutura|cateter|bistur[ií]|guante|alcohol|clorhexidin|yodo|suero|solucion fisiolog|hartmann|equipo de venoclisis|sonda|microchip)/i,
    tipo: "insumo",
    porque: "el nombre menciona un insumo de uso clínico",
  },
  {
    patron: /\b(choice|royal canin|hills|pro ?plan|eukanuba|purina|dog|cat|gato|perro|kg\b|alimento|snack|premio|juguete|collar|correa|arena|shampoo|champ[uú]|acondicionador|cepillo|comedero|transportador)/i,
    tipo: "otro",
    porque: "el nombre parece de alimento, accesorio o higiene",
  },
];

export interface SugerenciaTipo {
  tipo: TipoClinicoProducto;
  /** Por qué, en una frase, para que el usuario pueda discutirla. */
  porque: string;
}

export function tipoSugerido(p: {
  nombre: string | null;
  categoria?: string | null;
  principioActivo?: string | null;
}): SugerenciaTipo | null {
  if (p.categoria) {
    for (const r of POR_CATEGORIA) {
      if (r.patron.test(p.categoria)) {
        return { tipo: r.tipo, porque: `la categoría «${p.categoria}»` };
      }
    }
  }
  const texto = `${p.nombre ?? ""} ${p.principioActivo ?? ""}`;
  for (const r of POR_PALABRA) {
    if (r.patron.test(texto)) return { tipo: r.tipo, porque: r.porque };
  }
  return null;
}

export interface ProductoSinClasificar {
  id: string;
  codigo: string | null;
  nombre: string;
  categoria: string | null;
  familia: string | null;
  principioActivo: string | null;
  sugerencia: SugerenciaTipo | null;
}

/**
 * Cuántos productos activos no tienen tipo clínico.
 *
 * Es el número del indicador del Inventario. Va aparte de la lista
 * porque la pantalla lo muestra sin pedir la lista entera.
 */
export async function cuantosSinClasificar(db: PoolClient, tenantId: string): Promise<number> {
  const r = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM inv_productos
      WHERE tenant_id = $1 AND activo AND tipo_clinico IS NULL`,
    [tenantId]
  );
  return Number(r.rows[0].n);
}

export async function productosSinClasificar(
  db: PoolClient,
  tenantId: string,
  filtros: { categoria?: string; familiaId?: string; busqueda?: string; limite?: number } = {}
): Promise<{ productos: ProductoSinClasificar[]; total: number }> {
  const condiciones = ["p.tenant_id = $1", "p.activo", "p.tipo_clinico IS NULL"];
  const params: unknown[] = [tenantId];

  if (filtros.categoria) {
    params.push(filtros.categoria);
    condiciones.push(`p.categoria = $${params.length}`);
  }
  if (filtros.familiaId) {
    params.push(filtros.familiaId);
    condiciones.push(`p.familia_id = $${params.length}`);
  }
  if (filtros.busqueda) {
    params.push(`%${filtros.busqueda}%`);
    const n = params.length;
    condiciones.push(`(p.nombre ILIKE $${n} OR p.codigo ILIKE $${n})`);
  }

  const total = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM inv_productos p WHERE ${condiciones.join(" AND ")}`,
    params
  );

  params.push(Math.min(filtros.limite ?? 200, 500));
  const r = await db.query<{
    id: string;
    codigo: string | null;
    nombre: string;
    categoria: string | null;
    familia: string | null;
    principio_activo: string | null;
  }>(
    `SELECT p.id, p.codigo, p.nombre, p.categoria, f.nombre AS familia, p.principio_activo
       FROM inv_productos p
       LEFT JOIN inv_familias f ON f.id = p.familia_id
      WHERE ${condiciones.join(" AND ")}
      ORDER BY p.nombre
      LIMIT $${params.length}`,
    params
  );

  return {
    total: Number(total.rows[0].n),
    productos: r.rows.map((x) => ({
      id: x.id,
      codigo: x.codigo,
      nombre: x.nombre,
      categoria: x.categoria,
      familia: x.familia,
      principioActivo: x.principio_activo,
      sugerencia: tipoSugerido({
        nombre: x.nombre,
        categoria: x.categoria,
        principioActivo: x.principio_activo,
      }),
    })),
  };
}

export class ClasificacionInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ClasificacionInvalida";
  }
}

/**
 * Asigna el tipo clínico a varios productos de una vez.
 *
 * ESCRIBE SOLO LOS QUE NO TENÍAN TIPO, salvo que se pida lo contrario:
 * una clasificación masiva que pisa lo que alguien ya curó a mano es una
 * forma silenciosa de perder trabajo. Devuelve cuántos cambió.
 */
export async function clasificarEnLote(
  db: PoolClient,
  tenantId: string,
  productoIds: string[],
  tipo: TipoClinicoProducto,
  opciones: { pisarExistente?: boolean } = {}
): Promise<number> {
  if (!TIPOS_CLINICOS.includes(tipo)) {
    throw new ClasificacionInvalida(`«${tipo}» no es un tipo clínico válido.`);
  }
  if (!Array.isArray(productoIds) || productoIds.length === 0) {
    throw new ClasificacionInvalida("No se eligió ningún producto.");
  }
  if (productoIds.length > 500) {
    throw new ClasificacionInvalida(
      "Son demasiados productos de una vez (máximo 500). Filtrá y hacelo por tandas."
    );
  }

  const r = await db.query(
    `UPDATE inv_productos
        SET tipo_clinico = $3, actualizado_en = now()
      WHERE tenant_id = $1 AND id = ANY($2)
        ${opciones.pisarExistente ? "" : "AND tipo_clinico IS NULL"}`,
    [tenantId, productoIds, tipo]
  );
  return r.rowCount ?? 0;
}

/** Las categorías que hay entre los sin clasificar, para el filtro. */
export async function categoriasSinClasificar(
  db: PoolClient,
  tenantId: string
): Promise<Array<{ categoria: string; cantidad: number }>> {
  const r = await db.query<{ categoria: string; n: string }>(
    `SELECT p.categoria, count(*) AS n
       FROM inv_productos p
      WHERE p.tenant_id = $1 AND p.activo AND p.tipo_clinico IS NULL
        AND p.categoria IS NOT NULL
      GROUP BY p.categoria
      ORDER BY count(*) DESC, p.categoria`,
    [tenantId]
  );
  return r.rows.map((x) => ({ categoria: x.categoria, cantidad: Number(x.n) }));
}
