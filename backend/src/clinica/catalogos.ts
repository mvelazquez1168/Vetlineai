import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// LOS CATÁLOGOS DE LA CLÍNICA — prompt 11, §1.
//
// UN SOLO PUNTO DE ENTRADA, no una copia. Este módulo sabe **qué
// catálogos existen y dónde vive cada uno**: los que tienen su pantalla
// en su módulo se enlazan, y solo los que nacieron acá se editan acá.
//
// Esa distinción es el módulo entero. Sin ella, Catálogos se vuelve una
// segunda pantalla de bodegas, de servicios y de razas, y la clínica
// termina con dos lugares donde editar lo mismo.
//
// LOS QUE SE EDITAN ACÁ comparten comportamiento —búsqueda, activar o
// desactivar en vez de borrar, orden manual, exportar e importar— y por
// eso comparten una sola implementación: `listar`, `guardar` y
// `alternarActivo` trabajan sobre cualquiera de ellos.
// ---------------------------------------------------------------------

export class CatalogoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CatalogoInvalido";
  }
}

export type GrupoCatalogo =
  | "inventario"
  | "veterinaria"
  | "recetas"
  | "clientes"
  | "agenda"
  | "documentos";

export interface CatalogoDeclarado {
  clave: string;
  nombre: string;
  grupo: GrupoCatalogo;
  descripcion: string;
  /** Dónde se edita. `aqui` = en esta pantalla. */
  donde: "aqui" | string;
}

/**
 * EL MAPA DE CATÁLOGOS. Es la respuesta a «¿dónde se edita esto?», y
 * está escrito una sola vez.
 *
 * `donde` es la ruta de la pantalla que ya lo edita. Cuando dice
 * `"aqui"`, el catálogo vive en esta pantalla porque no tiene otra.
 */
export const CATALOGOS: CatalogoDeclarado[] = [
  // --- Inventario ---
  {
    clave: "familias",
    nombre: "Familias y subfamilias",
    grupo: "inventario",
    descripcion: "La clasificación de los productos. Reemplaza la categoría en texto libre.",
    donde: "aqui",
  },
  {
    clave: "marcas",
    nombre: "Marcas",
    grupo: "inventario",
    descripcion: "De qué laboratorio o fabricante es cada producto.",
    donde: "aqui",
  },
  {
    clave: "ubicaciones",
    nombre: "Ubicaciones físicas",
    grupo: "inventario",
    descripcion: "Dónde hay que ir a buscarlo: estante 3, refrigerador de vacunas.",
    donde: "aqui",
  },
  {
    clave: "unidades",
    nombre: "Unidades de medida",
    grupo: "inventario",
    descripcion:
      "La unidad base de los productos. Las de Hacienda no se editan: son suyas y están en el catálogo oficial.",
    donde: "aqui",
  },
  {
    clave: "bodegas",
    nombre: "Bodegas",
    grupo: "inventario",
    descripcion: "Dónde se guardan las existencias.",
    donde: "/inventario?tab=bodegas",
  },
  {
    clave: "servicios",
    nombre: "Servicios",
    grupo: "inventario",
    descripcion: "Lo que la clínica cobra y no es un producto.",
    donde: "/inventario?tab=servicios",
  },
  {
    clave: "insumos_por_servicio",
    nombre: "Insumos por servicio",
    grupo: "inventario",
    descripcion: "Qué consume cada servicio, para descontarlo al cobrarlo.",
    donde: "/inventario?tab=servicios",
  },
  {
    clave: "motivos_movimiento",
    nombre: "Motivos de movimiento",
    grupo: "inventario",
    descripcion: "Por qué entra o sale algo del inventario.",
    donde: "/inventario?tab=parametros",
  },
  {
    clave: "categorias_gasto",
    nombre: "Categorías de gasto",
    grupo: "inventario",
    descripcion: "En qué se clasifica cada egreso de la clínica.",
    donde: "/finanzas?tab=gastos",
  },
  // --- Veterinaria ---
  {
    clave: "motivo_consulta",
    nombre: "Motivos de consulta",
    grupo: "veterinaria",
    descripcion: "Por qué vino el paciente.",
    donde: "aqui",
  },
  {
    clave: "corte_grooming",
    nombre: "Tipos de corte",
    grupo: "veterinaria",
    descripcion: "Los cortes que la estética ofrece.",
    donde: "aqui",
  },
  {
    clave: "caracter",
    nombre: "Carácter",
    grupo: "veterinaria",
    descripcion: "Cómo se comporta el paciente en la clínica.",
    donde: "aqui",
  },
  {
    clave: "pelaje",
    nombre: "Mantos y pelaje",
    grupo: "veterinaria",
    descripcion: "El tipo de manto, para la estética y la ficha.",
    donde: "aqui",
  },
  {
    clave: "habitat",
    nombre: "Hábitat",
    grupo: "veterinaria",
    descripcion: "Dónde vive el paciente.",
    donde: "aqui",
  },
  {
    clave: "tipo_dieta",
    nombre: "Tipo de alimentación",
    grupo: "veterinaria",
    descripcion: "Qué come.",
    donde: "aqui",
  },
  {
    clave: "motivo_baja",
    nombre: "Motivos de baja",
    grupo: "veterinaria",
    descripcion: "Por qué un paciente deja de estar activo.",
    donde: "aqui",
  },
  {
    clave: "especies",
    nombre: "Especies y razas",
    grupo: "veterinaria",
    descripcion: "El catálogo de la plataforma, compartido por todas las clínicas.",
    donde: "/pacientes",
  },
  {
    clave: "protocolos",
    nombre: "Protocolos de vacunación",
    grupo: "veterinaria",
    descripcion: "Qué vacunas y cada cuánto, por especie.",
    donde: "/admin/clinica",
  },
  // --- Recetas ---
  {
    clave: "via_administracion",
    nombre: "Vías de administración",
    grupo: "recetas",
    descripcion: "Oral, tópica, subcutánea…",
    donde: "aqui",
  },
  {
    clave: "frecuencia",
    nombre: "Frecuencias",
    grupo: "recetas",
    descripcion: "Cada cuánto se da.",
    donde: "aqui",
  },
  {
    clave: "duracion_receta",
    nombre: "Duraciones",
    grupo: "recetas",
    descripcion: "Por cuántos días.",
    donde: "aqui",
  },
  {
    clave: "unidad_dosis",
    nombre: "Unidades de dosis",
    grupo: "recetas",
    descripcion: "En qué se mide la dosis.",
    donde: "aqui",
  },
  // --- Clientes ---
  {
    clave: "tipos_cliente",
    nombre: "Tipos de cliente",
    grupo: "clientes",
    descripcion: "Particular, criador, albergue, empresa.",
    donde: "aqui",
  },
  {
    clave: "zonas",
    nombre: "Zonas",
    grupo: "clientes",
    descripcion: "De dónde viene el cliente. Sirve para las campañas del CRM.",
    donde: "aqui",
  },
  {
    clave: "fuentes_referencia",
    nombre: "Cómo nos conoció",
    grupo: "clientes",
    descripcion: "Las fuentes de referencia del CRM.",
    donde: "/admin/clinica",
  },
  // --- Agenda ---
  {
    clave: "tipos_cita",
    nombre: "Tipos de cita",
    grupo: "agenda",
    descripcion: "Con su duración, su color y su servicio.",
    donde: "/admin/configuracion-agenda?tab=tipos",
  },
  {
    clave: "salas",
    nombre: "Salas",
    grupo: "agenda",
    descripcion: "Los consultorios y el quirófano.",
    donde: "/agenda/horarios",
  },
  {
    clave: "feriados",
    nombre: "Feriados y bloqueos",
    grupo: "agenda",
    descripcion: "Cuándo la clínica no atiende.",
    donde: "/admin/configuracion-agenda?tab=excepciones",
  },
  // --- Documentos ---
  {
    clave: "plantillas_documento",
    nombre: "Plantillas de documentos clínicos",
    grupo: "documentos",
    descripcion: "Consentimientos, certificados, alta. Con variables y marca de la clínica.",
    donde: "aqui",
  },
  {
    clave: "plantillas_atencion",
    nombre: "Plantillas de atención",
    grupo: "documentos",
    descripcion: "Lo que precarga una consulta según su tipo.",
    donde: "/admin/clinica",
  },
  {
    clave: "plantillas_mensaje",
    nombre: "Plantillas de mensajes",
    grupo: "documentos",
    descripcion: "Los textos de los avisos y las campañas.",
    donde: "/admin/notificaciones",
  },
];

/**
 * Los catálogos que se editan en esta pantalla, con la tabla donde
 * viven.
 *
 * Los `exp_catalogos_clinicos` comparten tabla y se distinguen por
 * `tipo`: son listas de palabras y tener trece tablas de dos columnas
 * sería el error que el anexo 07-03 ya evitó.
 */
const TABLAS: Record<string, { tabla: string; tipo?: string; conCodigo?: boolean }> = {
  familias: { tabla: "inv_familias" },
  marcas: { tabla: "inv_marcas" },
  ubicaciones: { tabla: "inv_ubicaciones" },
  unidades: { tabla: "inv_unidades", conCodigo: true },
  tipos_cliente: { tabla: "crm_tipos_cliente" },
  zonas: { tabla: "crm_zonas" },
  motivo_consulta: { tabla: "exp_catalogos_clinicos", tipo: "motivo_consulta" },
  corte_grooming: { tabla: "exp_catalogos_clinicos", tipo: "corte_grooming" },
  caracter: { tabla: "exp_catalogos_clinicos", tipo: "caracter" },
  pelaje: { tabla: "exp_catalogos_clinicos", tipo: "pelaje" },
  habitat: { tabla: "exp_catalogos_clinicos", tipo: "habitat" },
  tipo_dieta: { tabla: "exp_catalogos_clinicos", tipo: "tipo_dieta" },
  motivo_baja: { tabla: "exp_catalogos_clinicos", tipo: "motivo_baja" },
  via_administracion: { tabla: "exp_catalogos_clinicos", tipo: "via_administracion" },
  frecuencia: { tabla: "exp_catalogos_clinicos", tipo: "frecuencia" },
  duracion_receta: { tabla: "exp_catalogos_clinicos", tipo: "duracion_receta" },
  unidad_dosis: { tabla: "exp_catalogos_clinicos", tipo: "unidad_dosis" },
};

export interface ItemCatalogo {
  id: string;
  nombre: string;
  codigo?: string | null;
  padre_id?: string | null;
  orden: number;
  activo: boolean;
  /** Cuántas filas lo usan: decide si se puede borrar o solo desactivar. */
  en_uso?: number;
}

function tablaDe(clave: string) {
  const t = TABLAS[clave];
  if (!t) {
    throw new CatalogoInvalido(
      `«${clave}» no es un catálogo que se edite acá. Mirá dónde vive en la lista de catálogos.`
    );
  }
  return t;
}

export async function listar(
  db: PoolClient,
  tenantId: string,
  clave: string,
  incluirInactivos = false
): Promise<ItemCatalogo[]> {
  const t = tablaDe(clave);
  if (t.tabla === "exp_catalogos_clinicos") {
    const r = await db.query<ItemCatalogo>(
      `SELECT id, etiqueta AS nombre, codigo, orden, activo
         FROM exp_catalogos_clinicos
        WHERE tenant_id = $1 AND tipo = $2 AND ($3 OR activo)
        ORDER BY orden, etiqueta`,
      [tenantId, t.tipo, incluirInactivos]
    );
    return r.rows;
  }
  const columnas = t.conCodigo
    ? "id, nombre, codigo, orden, activo"
    : t.tabla === "inv_familias"
      ? "id, nombre, padre_id, orden, activo"
      : "id, nombre, orden, activo";
  const r = await db.query<ItemCatalogo>(
    `SELECT ${columnas} FROM ${t.tabla}
      WHERE tenant_id = $1 AND ($2 OR activo)
      ORDER BY orden, nombre`,
    [tenantId, incluirInactivos]
  );
  return r.rows;
}

export async function guardar(
  db: PoolClient,
  tenantId: string,
  clave: string,
  datos: {
    id?: string;
    nombre: string;
    codigo?: string | null;
    padreId?: string | null;
    orden?: number;
    activo?: boolean;
  }
): Promise<{ id: string }> {
  const t = tablaDe(clave);
  if (!datos.nombre?.trim()) throw new CatalogoInvalido("Hace falta el nombre.");
  const nombre = datos.nombre.trim();

  if (t.tabla === "exp_catalogos_clinicos") {
    if (datos.id) {
      const r = await db.query<{ id: string }>(
        `UPDATE exp_catalogos_clinicos
            SET etiqueta = $3, orden = COALESCE($4, orden), activo = COALESCE($5, activo)
          WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [datos.id, tenantId, nombre, datos.orden ?? null, datos.activo ?? null]
      );
      if (r.rows.length === 0) throw new CatalogoInvalido("Ese valor no existe.");
      return r.rows[0];
    }
    // El código se deriva del nombre: es para la API, no para teclear.
    const codigo = (datos.codigo ?? codigoDesde(nombre)).slice(0, 40);
    const r = await db.query<{ id: string }>(
      `INSERT INTO exp_catalogos_clinicos (tenant_id, tipo, codigo, etiqueta, orden)
       VALUES ($1,$2,$3,$4,COALESCE($5,100))
       ON CONFLICT (tenant_id, tipo, codigo) WHERE tenant_id IS NOT NULL
         DO UPDATE SET etiqueta = EXCLUDED.etiqueta, activo = true
       RETURNING id`,
      [tenantId, t.tipo, codigo, nombre, datos.orden ?? null]
    );
    return r.rows[0];
  }

  if (datos.id) {
    const extra = t.tabla === "inv_familias" ? ", padre_id = $6" : "";
    const valores: unknown[] = [
      datos.id,
      tenantId,
      nombre,
      datos.orden ?? null,
      datos.activo ?? null,
    ];
    if (t.tabla === "inv_familias") valores.push(datos.padreId ?? null);
    const r = await db.query<{ id: string }>(
      `UPDATE ${t.tabla}
          SET nombre = $3, orden = COALESCE($4, orden), activo = COALESCE($5, activo)${extra}
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      valores
    );
    if (r.rows.length === 0) throw new CatalogoInvalido("Ese valor no existe.");
    return r.rows[0];
  }

  if (t.conCodigo) {
    const codigo = (datos.codigo ?? codigoDesde(nombre)).slice(0, 20);
    const r = await db.query<{ id: string }>(
      `INSERT INTO ${t.tabla} (tenant_id, codigo, nombre, orden)
       VALUES ($1,$2,$3,COALESCE($4,100))
       ON CONFLICT (tenant_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true
       RETURNING id`,
      [tenantId, codigo, nombre, datos.orden ?? null]
    );
    return r.rows[0];
  }

  const columnas = t.tabla === "inv_familias" ? "(tenant_id, nombre, orden, padre_id)" : "(tenant_id, nombre, orden)";
  const valores: unknown[] = [tenantId, nombre, datos.orden ?? null];
  if (t.tabla === "inv_familias") valores.push(datos.padreId ?? null);
  const marcas = t.tabla === "inv_familias" ? "$1,$2,COALESCE($3,100),$4" : "$1,$2,COALESCE($3,100)";
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${t.tabla} ${columnas} VALUES (${marcas})
     ON CONFLICT (tenant_id, nombre) DO UPDATE SET activo = true
     RETURNING id`,
    valores
  );
  return r.rows[0];
}

/**
 * Se desactiva, no se borra, cuando algo lo usa.
 *
 * Borrar una familia que diez productos usan los dejaría sin
 * clasificación y nadie se enteraría hasta filtrar.
 */
export async function alternarActivo(
  db: PoolClient,
  tenantId: string,
  clave: string,
  id: string,
  activo: boolean
): Promise<void> {
  const t = tablaDe(clave);
  const r = await db.query(
    `UPDATE ${t.tabla} SET activo = $3 WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, activo]
  );
  if (r.rowCount === 0) throw new CatalogoInvalido("Ese valor no existe.");
}

function codigoDesde(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Lo que el catálogo exportado lleva, y lo que la importación acepta. */
export const COLUMNAS_IMPORTACION = ["nombre", "codigo", "orden", "activo"] as const;

export interface FilaImportada {
  fila: number;
  nombre: string;
  codigo?: string;
  orden?: number;
  activo?: boolean;
  error?: string;
}

/**
 * La vista previa de una importación: valida fila por fila y **no
 * escribe nada**.
 *
 * Es el mismo patrón que la importación de inventario del 06, y por el
 * mismo motivo: una importación que escribe mientras valida deja la
 * mitad cargada cuando la fila 40 está mal.
 */
export function revisarImportacion(
  filas: Array<Record<string, unknown>>
): { validas: FilaImportada[]; conError: FilaImportada[] } {
  const validas: FilaImportada[] = [];
  const conError: FilaImportada[] = [];
  const vistos = new Set<string>();

  filas.forEach((cruda, i) => {
    const fila: FilaImportada = {
      fila: i + 2, // +2: la 1 es el encabezado y las planillas cuentan desde 1
      nombre: String(cruda.nombre ?? "").trim(),
      codigo: cruda.codigo ? String(cruda.codigo).trim() : undefined,
      orden: cruda.orden === undefined || cruda.orden === "" ? undefined : Number(cruda.orden),
      activo:
        cruda.activo === undefined || cruda.activo === ""
          ? true
          : ["1", "si", "sí", "true", "verdadero"].includes(String(cruda.activo).toLowerCase()),
    };

    if (!fila.nombre) fila.error = "Sin nombre.";
    else if (fila.orden !== undefined && Number.isNaN(fila.orden)) fila.error = "El orden no es un número.";
    else if (vistos.has(fila.nombre.toLowerCase())) fila.error = "Repetido en la misma planilla.";

    vistos.add(fila.nombre.toLowerCase());
    (fila.error ? conError : validas).push(fila);
  });

  return { validas, conError };
}
