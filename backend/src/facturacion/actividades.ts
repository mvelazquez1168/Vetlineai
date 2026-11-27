import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// CON QUÉ ACTIVIDAD ECONÓMICA SALE UN COMPROBANTE — prompt 09b, B1.
//
// LO QUE DICE EL XSD v4.4, leído del archivo: `CodigoActividadEmisor`
// es un elemento de seis caracteres, obligatorio y **no repetible**.
// Entonces un comprobante declara UNA actividad, y punto.
//
// La consecuencia práctica, que es la que importa en el mostrador: una
// cuenta con un alimento y una consulta mezcla dos actividades, y no se
// puede facturar junta. El sistema lo dice ANTES de emitir y propone
// separarla, en vez de emitir con una de las dos y dejar la mitad de la
// venta declarada en la actividad equivocada.
//
// EL ORDEN DE PRECEDENCIA, de lo más específico a lo más general:
//
//   1. lo que eligió la persona en la pantalla de emisión;
//   2. la regla por línea de negocio de la clínica;
//   3. la actividad predeterminada del emisor;
//   4. `fact_emisores.codigo_actividad_economica`, que es la que había
//      antes de que existiera todo esto.
// ---------------------------------------------------------------------

export interface ActividadDelEmisor {
  id: string;
  codigo: string;
  descripcion: string | null;
  esPredeterminada: boolean;
}

export async function actividadesDelEmisor(
  db: PoolClient,
  emisorId: string
): Promise<ActividadDelEmisor[]> {
  const r = await db.query<{
    id: string;
    codigo: string;
    descripcion: string | null;
    es_predeterminada: boolean;
  }>(
    `SELECT id, codigo, descripcion, es_predeterminada
       FROM fact_emisor_actividades
      WHERE emisor_id = $1 AND activo
      ORDER BY es_predeterminada DESC, codigo`,
    [emisorId]
  );
  return r.rows.map((f) => ({
    id: f.id,
    codigo: f.codigo,
    descripcion: f.descripcion,
    esPredeterminada: f.es_predeterminada,
  }));
}

export interface ReglaDeActividad {
  lineaNegocio: string;
  actividadId: string;
  codigo: string;
}

export async function reglasDeActividad(
  db: PoolClient,
  tenantId: string
): Promise<ReglaDeActividad[]> {
  const r = await db.query<{ linea_negocio: string; actividad_id: string; codigo: string }>(
    `SELECT l.linea_negocio, l.actividad_id, a.codigo
       FROM fact_actividad_por_linea l
       JOIN fact_emisor_actividades a ON a.id = l.actividad_id
      WHERE l.tenant_id = $1
      ORDER BY l.linea_negocio`,
    [tenantId]
  );
  return r.rows.map((f) => ({
    lineaNegocio: f.linea_negocio,
    actividadId: f.actividad_id,
    codigo: f.codigo,
  }));
}

export async function guardarReglaDeActividad(
  db: PoolClient,
  tenantId: string,
  lineaNegocio: string,
  actividadId: string | null
): Promise<void> {
  if (!actividadId) {
    await db.query(
      `DELETE FROM fact_actividad_por_linea WHERE tenant_id = $1 AND linea_negocio = $2`,
      [tenantId, lineaNegocio]
    );
    return;
  }
  await db.query(
    `INSERT INTO fact_actividad_por_linea (tenant_id, linea_negocio, actividad_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, linea_negocio) DO UPDATE
       SET actividad_id = EXCLUDED.actividad_id, actualizado_en = now()`,
    [tenantId, lineaNegocio, actividadId]
  );
}

export class ActividadesMezcladas extends Error {
  constructor(
    mensaje: string,
    /** Qué actividad le toca a cada línea de negocio de la cuenta. */
    public readonly porLinea: Array<{ lineaNegocio: string; codigo: string }>
  ) {
    super(mensaje);
    this.name = "ActividadesMezcladas";
  }
}

export interface ActividadResuelta {
  codigo: string;
  /** De dónde salió, para poder explicarlo en la pantalla. */
  origen: "elegida" | "regla" | "predeterminada" | "emisor";
}

/**
 * La actividad con la que se emite, o el aviso de que no se puede.
 *
 * `lineasNegocio` son las de los cargos de la cuenta. Las líneas sin
 * línea de negocio cargada **no cuentan como una actividad distinta**:
 * un cargo manual sin clasificar no puede partir una factura en dos, y
 * cae en la actividad que resuelva el resto.
 */
export async function actividadParaEmitir(
  db: PoolClient,
  tenantId: string,
  emisorId: string,
  datos: { lineasNegocio?: Array<string | null>; actividadElegida?: string | null }
): Promise<ActividadResuelta> {
  // 1. LA ELEGIDA A MANO gana sobre todo, pero tiene que ser una de las
  //    inscritas: mandar un código cualquiera en el body facturaría con
  //    una actividad que el contribuyente no tiene.
  if (datos.actividadElegida) {
    const inscritas = await actividadesDelEmisor(db, emisorId);
    const existe = inscritas.find((a) => a.codigo === datos.actividadElegida);
    if (!existe) {
      throw new Error(
        `La actividad ${datos.actividadElegida} no está entre las inscritas de este emisor.`
      );
    }
    return { codigo: existe.codigo, origen: "elegida" };
  }

  // 2. LA REGLA POR LÍNEA DE NEGOCIO.
  const reglas = await reglasDeActividad(db, tenantId);
  const lineas = (datos.lineasNegocio ?? []).filter((l): l is string => Boolean(l));
  if (reglas.length > 0 && lineas.length > 0) {
    const porLinea = [...new Set(lineas)].map((l) => ({
      lineaNegocio: l,
      codigo: reglas.find((r) => r.lineaNegocio === l)?.codigo ?? "",
    }));
    const conRegla = porLinea.filter((x) => x.codigo);
    const distintas = [...new Set(conRegla.map((x) => x.codigo))];

    if (distintas.length > 1) {
      // UN COMPROBANTE, UNA ACTIVIDAD. No es una limitación nuestra: el
      // XSD tiene un solo `CodigoActividadEmisor`.
      throw new ActividadesMezcladas(
        `Esta cuenta mezcla ${distintas.length} actividades económicas (${distintas.join(", ")}) y un comprobante solo puede declarar una. Hay que separarla en dos comprobantes.`,
        porLinea
      );
    }
    if (distintas.length === 1) return { codigo: distintas[0], origen: "regla" };
  }

  // 3. LA PREDETERMINADA DEL EMISOR.
  const inscritas = await actividadesDelEmisor(db, emisorId);
  const predeterminada = inscritas.find((a) => a.esPredeterminada) ?? inscritas[0];
  if (predeterminada) return { codigo: predeterminada.codigo, origen: "predeterminada" };

  // 4. LA QUE SIEMPRE ESTUVO EN EL EMISOR.
  const e = await db.query<{ codigo_actividad_economica: string | null }>(
    `SELECT codigo_actividad_economica FROM fact_emisores WHERE id = $1`,
    [emisorId]
  );
  const vieja = e.rows[0]?.codigo_actividad_economica;
  if (vieja) return { codigo: vieja, origen: "emisor" };

  throw new Error(
    "El emisor no tiene ninguna actividad económica configurada, y el comprobante la exige."
  );
}
