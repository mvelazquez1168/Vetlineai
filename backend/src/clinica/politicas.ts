import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// LAS POLÍTICAS DE LA CLÍNICA, LEÍDAS DE UN SOLO LUGAR — prompt 04, §4.
//
// `politica(db, tenantId, clave)` es la única función que los módulos
// llaman. Antes, cada módulo leía su propia tabla: el CRM su
// `crm_politicas`, la caja su `vta_parametros`, los descuentos su
// `vta_topes_descuento`. Tres lugares, tres pantallas y nadie sabiendo
// dónde se cambia algo.
//
// EL RESPALDO EN LA COLUMNA VIEJA, y por qué existe: sin él, el día del
// despliegue toda clínica que no haya abierto la pantalla nueva volvería
// al valor por omisión, y una que tenía el tope de descuento en 25 %
// pasaría a 10 % sin que nadie lo cambiara. Con el respaldo, el
// comportamiento del primer día es idéntico al del día anterior.
//
// El orden es: la fila de la clínica → la columna vieja → el valor por
// omisión del catálogo. Las tres existen a propósito y el informe dice
// cuándo se puede borrar la del medio.
//
// LA CACHÉ ES POR CLÍNICA Y SE INVALIDA AL GUARDAR. Las políticas se
// leen en caminos calientes —cada cargo con descuento, cada mensaje al
// cliente— y cambian una vez por mes.
// ---------------------------------------------------------------------

interface Valor {
  valor: string;
  /** De dónde salió, para poder explicarlo y para el verificador. */
  origen: "clinica" | "columna_anterior" | "por_omision";
}

const cache = new Map<string, { en: number; valores: Map<string, Valor> }>();
const VIDA_CACHE_MS = 60_000;

export function olvidarPoliticas(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** Las columnas viejas, con la consulta que las lee. */
const RESPALDOS: Record<string, { sql: string; columna: string }> = {
  "descuento.maximo_sin_autorizacion": {
    sql: `SELECT descuento_maximo_pct::text AS v FROM vta_parametros WHERE tenant_id = $1`,
    columna: "vta_parametros.descuento_maximo_pct",
  },
  "arqueo.umbral_diferencia": {
    sql: `SELECT umbral_diferencia_arqueo::text AS v FROM vta_parametros WHERE tenant_id = $1`,
    columna: "vta_parametros.umbral_diferencia_arqueo",
  },
  "presupuesto.vigencia_dias": {
    sql: `SELECT presupuesto_vigencia_dias::text AS v FROM vta_parametros WHERE tenant_id = $1`,
    columna: "vta_parametros.presupuesto_vigencia_dias",
  },
  "mensajes.tope_promociones_mes": {
    sql: `SELECT tope_promociones_mes::text AS v FROM crm_politicas WHERE tenant_id = $1`,
    columna: "crm_politicas.tope_promociones_mes",
  },
};

/**
 * El valor de una política para esta clínica.
 *
 * `rol` solo aplica a las políticas que admiten valor por rol —hoy, el
 * descuento máximo—. Con rol, busca primero la fila de ese rol y después
 * la general: así un rol sin tope propio hereda el de la clínica, que es
 * lo que la caja ya hacía.
 */
export async function politica(
  db: PoolClient,
  tenantId: string,
  clave: string,
  rol?: string | null
): Promise<string> {
  const llave = rol ? `${clave}|${rol}` : clave;
  const guardado = cache.get(tenantId);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MS) {
    const v = guardado.valores.get(llave);
    if (v) return v.valor;
  }

  const resuelto = await resolver(db, tenantId, clave, rol ?? null);
  const mapa = guardado && Date.now() - guardado.en < VIDA_CACHE_MS
    ? guardado.valores
    : new Map<string, Valor>();
  mapa.set(llave, resuelto);
  cache.set(tenantId, { en: guardado?.en ?? Date.now(), valores: mapa });
  return resuelto.valor;
}

/** Igual que `politica`, pero diciendo de dónde salió el valor. */
export async function politicaConOrigen(
  db: PoolClient,
  tenantId: string,
  clave: string,
  rol?: string | null
): Promise<Valor> {
  return resolver(db, tenantId, clave, rol ?? null);
}

async function resolver(
  db: PoolClient,
  tenantId: string,
  clave: string,
  rol: string | null
): Promise<Valor> {
  // 1. Lo que la clínica configuró: primero por rol, después general.
  if (rol) {
    const r = await db.query<{ valor: string }>(
      `SELECT valor FROM tenant_politicas
        WHERE tenant_id = $1 AND clave = $2 AND rol = $3`,
      [tenantId, clave, rol]
    );
    if (r.rows.length > 0) return { valor: r.rows[0].valor, origen: "clinica" };
  }
  const general = await db.query<{ valor: string }>(
    `SELECT valor FROM tenant_politicas
      WHERE tenant_id = $1 AND clave = $2 AND rol IS NULL`,
    [tenantId, clave]
  );
  if (general.rows.length > 0) return { valor: general.rows[0].valor, origen: "clinica" };

  // 2. La columna vieja, mientras exista.
  const respaldo = RESPALDOS[clave];
  if (respaldo) {
    const r = await db.query<{ v: string | null }>(respaldo.sql, [tenantId]);
    if (r.rows[0]?.v != null) {
      return { valor: r.rows[0].v, origen: "columna_anterior" };
    }
  }

  // 3. El valor por omisión del catálogo.
  const cat = await db.query<{ valor_por_omision: string }>(
    `SELECT valor_por_omision FROM politicas WHERE clave = $1`,
    [clave]
  );
  if (cat.rows.length === 0) {
    throw new Error(`No existe la política «${clave}».`);
  }
  return { valor: cat.rows[0].valor_por_omision, origen: "por_omision" };
}

/** Las de tipo número, ya convertidas. */
export async function politicaNumero(
  db: PoolClient,
  tenantId: string,
  clave: string,
  rol?: string | null
): Promise<number> {
  const v = await politica(db, tenantId, clave, rol);
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`La política «${clave}» tiene un valor que no es un número: «${v}».`);
  }
  return n;
}

export async function politicaBooleana(
  db: PoolClient,
  tenantId: string,
  clave: string
): Promise<boolean> {
  return (await politica(db, tenantId, clave)) === "true";
}

export interface PoliticaParaPantalla {
  clave: string;
  nombre: string;
  descripcion: string;
  tipo: string;
  modulo: string;
  minimo: string | null;
  maximo: string | null;
  valor: string;
  origen: string;
  /** Los valores por rol, cuando esta política los admite. */
  porRol: Array<{ rol: string; valor: string }>;
  /** El último cambio, para la pantalla. */
  ultimoCambio: { valor_anterior: string | null; cuando: string; quien: string | null } | null;
}

const ADMITEN_ROL = new Set(["descuento.maximo_sin_autorizacion"]);

export async function politicasDeLaClinica(
  db: PoolClient,
  tenantId: string
): Promise<PoliticaParaPantalla[]> {
  const cat = await db.query<{
    clave: string;
    nombre: string;
    descripcion: string;
    tipo: string;
    modulo: string;
    minimo: string | null;
    maximo: string | null;
  }>(
    `SELECT clave, nombre, descripcion, tipo, modulo, minimo::text, maximo::text
       FROM politicas ORDER BY orden, clave`
  );

  const salida: PoliticaParaPantalla[] = [];
  for (const p of cat.rows) {
    const v = await politicaConOrigen(db, tenantId, p.clave);
    const porRol = ADMITEN_ROL.has(p.clave)
      ? (
          await db.query<{ rol: string; valor: string }>(
            `SELECT rol, valor FROM tenant_politicas
              WHERE tenant_id = $1 AND clave = $2 AND rol IS NOT NULL
              ORDER BY rol`,
            [tenantId, p.clave]
          )
        ).rows
      : [];
    const h = await db.query<{
      valor_anterior: string | null;
      cuando: string;
      quien: string | null;
    }>(
      `SELECT h.valor_anterior, h.cambiado_en::text AS cuando, per.nombre AS quien
         FROM politicas_historial h
         LEFT JOIN personas per ON per.id = h.cambiado_por
        WHERE h.tenant_id = $1 AND h.clave = $2
        ORDER BY h.cambiado_en DESC LIMIT 1`,
      [tenantId, p.clave]
    );
    salida.push({
      ...p,
      valor: v.valor,
      origen: v.origen,
      porRol,
      ultimoCambio: h.rows[0] ?? null,
    });
  }
  return salida;
}

export class PoliticaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PoliticaInvalida";
  }
}

/**
 * Guarda una política y deja su huella.
 *
 * SE VALIDA CONTRA SU TIPO Y SU RANGO. Un tope de descuento del 400 % es
 * un dedo que se resbaló; aceptarlo y descubrirlo en una factura es
 * peor que rechazarlo acá.
 */
export async function guardarPolitica(
  db: PoolClient,
  tenantId: string,
  datos: { clave: string; valor: string; rol?: string | null; personaId?: string }
): Promise<{ valor: string }> {
  const cat = await db.query<{
    tipo: string;
    minimo: string | null;
    maximo: string | null;
    nombre: string;
  }>(`SELECT tipo, minimo::text, maximo::text, nombre FROM politicas WHERE clave = $1`, [
    datos.clave,
  ]);
  if (cat.rows.length === 0) throw new PoliticaInvalida(`No existe la política «${datos.clave}».`);
  const { tipo, minimo, maximo, nombre } = cat.rows[0];

  const valor = datos.valor.trim();
  if (tipo === "booleano") {
    if (valor !== "true" && valor !== "false") {
      throw new PoliticaInvalida(`«${nombre}» es sí o no.`);
    }
  } else if (tipo !== "texto") {
    const n = Number(valor);
    if (!Number.isFinite(n)) {
      throw new PoliticaInvalida(`«${nombre}» lleva un número y llegó «${valor}».`);
    }
    if (minimo !== null && n < Number(minimo)) {
      throw new PoliticaInvalida(`«${nombre}» no puede ser menor que ${minimo}.`);
    }
    if (maximo !== null && n > Number(maximo)) {
      throw new PoliticaInvalida(`«${nombre}» no puede ser mayor que ${maximo}.`);
    }
  }
  if (datos.rol && !ADMITEN_ROL.has(datos.clave)) {
    throw new PoliticaInvalida(`«${nombre}» no admite un valor distinto por rol.`);
  }

  const anterior = await politicaConOrigen(db, tenantId, datos.clave, datos.rol ?? null);

  if (datos.rol) {
    await db.query(
      `INSERT INTO tenant_politicas (tenant_id, clave, rol, valor, actualizado_por)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, clave, rol) WHERE rol IS NOT NULL
         DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now(),
                       actualizado_por = EXCLUDED.actualizado_por`,
      [tenantId, datos.clave, datos.rol, valor, datos.personaId ?? null]
    );
  } else {
    await db.query(
      `INSERT INTO tenant_politicas (tenant_id, clave, rol, valor, actualizado_por)
       VALUES ($1,$2,NULL,$3,$4)
       ON CONFLICT (tenant_id, clave) WHERE rol IS NULL
         DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now(),
                       actualizado_por = EXCLUDED.actualizado_por`,
      [tenantId, datos.clave, valor, datos.personaId ?? null]
    );
  }

  // EL HISTORIAL SE ESCRIBE SIEMPRE, incluso si el valor no cambió: que
  // alguien haya mirado y confirmado un valor es información, y
  // distinguirlo obligaría a comparar textos de tipos distintos.
  await db.query(
    `INSERT INTO politicas_historial
       (tenant_id, clave, rol, valor_anterior, valor_nuevo, cambiado_por)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tenantId, datos.clave, datos.rol ?? null, anterior.valor, valor, datos.personaId ?? null]
  );

  olvidarPoliticas(tenantId);
  return { valor };
}

export async function historialDePolitica(
  db: PoolClient,
  tenantId: string,
  clave: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT h.valor_anterior, h.valor_nuevo, h.rol, h.cambiado_en::text,
            per.nombre AS cambiado_por_nombre
       FROM politicas_historial h
       LEFT JOIN personas per ON per.id = h.cambiado_por
      WHERE h.tenant_id = $1 AND h.clave = $2
      ORDER BY h.cambiado_en DESC
      LIMIT 100`,
    [tenantId, clave]
  );
  return r.rows;
}
