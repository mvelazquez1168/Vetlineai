import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// CUMPLIMIENTO, CONTROLADOS Y DESECHOS — prompt 11, §4.
//
// SOBRE LO QUE LA LEY EXIGE: este entorno no tiene acceso a las fuentes
// oficiales —Ministerio de Salud, SENASA, Colegio de Médicos
// Veterinarios—, así que **nada de lo que se siembra se presenta como
// obligación legal**. La lista nace marcada `sugerido`, y
// `fuente_confirmada` existe para que quien confirme deje dicho contra
// qué y cuándo.
//
// EL LIBRO DE CONTROLADOS NO ES UNA TABLA DE MOVIMIENTOS: se arma desde
// `inv_movimientos`, que ya guarda la entrada, la salida por paciente y
// el lote. Un segundo registro de lo mismo es un segundo registro que un
// día no coincide, y en un libro de controlados eso es un problema con
// el regente. Lo único propio es el cierre firmado.
// ---------------------------------------------------------------------

export class CumplimientoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CumplimientoInvalido";
  }
}

// --- Permisos y vencimientos de la clínica ---------------------------

export async function permisos(
  db: PoolClient,
  tenantId: string,
  incluirInactivos = false
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT c.id, c.nombre, c.organismo, c.numero, c.emitido_el::text, c.vence_el::text,
            c.dias_aviso, c.responsable_id, p.nombre AS responsable, c.archivo_clave,
            c.sugerido, c.fuente_confirmada, c.fuente_confirmada_en::text, c.activo,
            (c.vence_el - CURRENT_DATE)::int AS dias_para_vencer
       FROM cmp_permisos c
       LEFT JOIN personas p ON p.id = c.responsable_id
      WHERE c.tenant_id = $1 AND ($2 OR c.activo)
      ORDER BY c.vence_el NULLS LAST, c.nombre`,
    [tenantId, incluirInactivos]
  );
  return r.rows;
}

export async function guardarPermiso(
  db: PoolClient,
  tenantId: string,
  datos: {
    id?: string;
    nombre: string;
    organismo?: string | null;
    numero?: string | null;
    emitidoEl?: string | null;
    venceEl?: string | null;
    diasAviso?: number;
    responsableId?: string | null;
    archivoClave?: string | null;
    fuenteConfirmada?: string | null;
    activo?: boolean;
  }
): Promise<{ id: string }> {
  if (!datos.nombre?.trim()) throw new CumplimientoInvalido("El permiso necesita un nombre.");
  const dias = datos.diasAviso ?? 30;
  if (dias < 1 || dias > 365) {
    throw new CumplimientoInvalido("El aviso va de 1 a 365 días antes.");
  }
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE cmp_permisos
          SET nombre = $3, organismo = $4, numero = $5, emitido_el = $6, vence_el = $7,
              dias_aviso = $8, responsable_id = $9,
              archivo_clave = COALESCE($10, archivo_clave),
              -- CONFIRMAR LA FUENTE DEJA LA FECHA. Sin eso, «confirmado»
              -- es una palabra sin respaldo: dentro de un año nadie va a
              -- saber si se confirmó con la ley de hoy o con la de antes.
              fuente_confirmada = COALESCE($11, fuente_confirmada),
              fuente_confirmada_en = CASE
                WHEN $11 IS NOT NULL AND $11 IS DISTINCT FROM fuente_confirmada
                THEN CURRENT_DATE ELSE fuente_confirmada_en END,
              -- Lo que la clínica edita deja de ser una sugerencia del
              -- sistema: es un dato suyo.
              sugerido = false,
              activo = COALESCE($12, activo),
              avisado_en = CASE WHEN $7::date IS DISTINCT FROM vence_el THEN NULL ELSE avisado_en END
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [
        datos.id,
        tenantId,
        datos.nombre.trim(),
        datos.organismo ?? null,
        datos.numero ?? null,
        datos.emitidoEl ?? null,
        datos.venceEl ?? null,
        dias,
        datos.responsableId ?? null,
        datos.archivoClave ?? null,
        datos.fuenteConfirmada ?? null,
        datos.activo ?? null,
      ]
    );
    if (r.rows.length === 0) throw new CumplimientoInvalido("Ese permiso no existe.");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO cmp_permisos
       (tenant_id, nombre, organismo, numero, emitido_el, vence_el, dias_aviso,
        responsable_id, archivo_clave, sugerido)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false) RETURNING id`,
    [
      tenantId,
      datos.nombre.trim(),
      datos.organismo ?? null,
      datos.numero ?? null,
      datos.emitidoEl ?? null,
      datos.venceEl ?? null,
      dias,
      datos.responsableId ?? null,
      datos.archivoClave ?? null,
    ]
  );
  return r.rows[0];
}

// --- El libro de medicamentos controlados ----------------------------

export interface AsientoControlado {
  fecha: string;
  producto: string;
  producto_id: string;
  lote: string | null;
  tipo: string;
  motivo: string;
  cantidad: string;
  paciente: string | null;
  medico: string | null;
  documento: string | null;
}

/**
 * El libro: las entradas y las salidas de los productos controlados, en
 * orden.
 *
 * SALE DE `inv_movimientos`. No hay una tabla de libro porque el libro
 * es una **vista** de lo que el inventario ya registró. Si hubiera una
 * tabla propia, el día que no coincidan habría que decidir cuál miente.
 */
export async function libroDeControlados(
  db: PoolClient,
  tenantId: string,
  desde: string,
  hasta: string,
  productoId?: string
): Promise<AsientoControlado[]> {
  const r = await db.query<AsientoControlado>(
    `SELECT m.creado_en::date::text AS fecha,
            p.nombre AS producto, p.id AS producto_id,
            l.numero AS lote,
            m.tipo,
            COALESCE(mo.nombre, m.motivo) AS motivo,
            m.cantidad_base::text AS cantidad,
            pac.nombre AS paciente,
            per.nombre AS medico,
            -- De dónde vino: la compra o la atención.
            COALESCE(oc.numero::text, a.id::text) AS documento
       FROM inv_movimientos m
       JOIN inv_productos p ON p.id = m.producto_id
       LEFT JOIN inv_lotes l ON l.id = m.lote_id
       LEFT JOIN inv_motivos mo ON mo.codigo = m.motivo
       LEFT JOIN pacientes pac ON pac.id = m.paciente_id
       LEFT JOIN personas per ON per.id = m.persona_id
       LEFT JOIN inv_ordenes_compra oc ON oc.id = m.compra_id
       LEFT JOIN atenciones a ON a.id = m.atencion_id
      WHERE m.tenant_id = $1
        AND p.es_controlado
        AND m.creado_en::date BETWEEN $2::date AND $3::date
        AND ($4::uuid IS NULL OR p.id = $4::uuid)
      ORDER BY m.creado_en`,
    [tenantId, desde, hasta, productoId ?? null]
  );
  return r.rows;
}

/** El saldo por producto y lote, que es lo que el regente compara. */
export async function saldosDeControlados(
  db: PoolClient,
  tenantId: string,
  hasta?: string
): Promise<Array<{ producto: string; producto_id: string; lote: string | null; saldo: string }>> {
  const r = await db.query<{
    producto: string;
    producto_id: string;
    lote: string | null;
    saldo: string;
  }>(
    `SELECT p.nombre AS producto, p.id AS producto_id, l.numero AS lote,
            sum(m.cantidad_base)::text AS saldo
       FROM inv_movimientos m
       JOIN inv_productos p ON p.id = m.producto_id
       LEFT JOIN inv_lotes l ON l.id = m.lote_id
      WHERE m.tenant_id = $1 AND p.es_controlado
        AND ($2::date IS NULL OR m.creado_en::date <= $2::date)
      GROUP BY p.nombre, p.id, l.numero
     HAVING sum(m.cantidad_base) <> 0
      ORDER BY p.nombre, l.numero`,
    [tenantId, hasta ?? null]
  );
  return r.rows;
}

/**
 * El cierre del período, firmado por el regente.
 *
 * ES LO ÚNICO PROPIO DEL LIBRO: el hecho de que una persona con
 * responsabilidad legal mire el saldo, lo compare con el estante y
 * firme. Queda congelado lo que vio.
 *
 * SOLO DE AGREGAR: el trigger de la base impide editarlo o borrarlo. Un
 * error se corrige con un cierre nuevo que lo explique.
 */
export async function cerrarLibro(
  db: PoolClient,
  tenantId: string,
  datos: { desde: string; hasta: string; regenteId: string; observaciones?: string | null }
): Promise<{ id: string; productos: number }> {
  const saldos = await saldosDeControlados(db, tenantId, datos.hasta);
  const r = await db.query<{ id: string }>(
    `INSERT INTO cmp_controlados_cierres
       (tenant_id, desde, hasta, firmado_por, saldos, observaciones)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     RETURNING id`,
    [
      tenantId,
      datos.desde,
      datos.hasta,
      datos.regenteId,
      JSON.stringify(saldos),
      datos.observaciones ?? null,
    ]
  );
  return { id: r.rows[0].id, productos: saldos.length };
}

export async function cierresDeControlados(
  db: PoolClient,
  tenantId: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT c.id, c.desde::text, c.hasta::text, c.firmado_en, p.nombre AS firmado_por,
            c.observaciones, jsonb_array_length(c.saldos) AS productos
       FROM cmp_controlados_cierres c
       JOIN personas p ON p.id = c.firmado_por
      WHERE c.tenant_id = $1
      ORDER BY c.hasta DESC`,
    [tenantId]
  );
  return r.rows;
}

// --- Desechos bioinfecciosos -----------------------------------------

export async function desechos(
  db: PoolClient,
  tenantId: string,
  desde?: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT d.id, d.fecha::text, d.tipo, d.peso_kg::text, d.volumen_l::text,
            d.gestor, d.gestor_autorizacion, d.archivo_clave, p.nombre AS registrado_por
       FROM cmp_desechos d
       LEFT JOIN personas p ON p.id = d.registrado_por
      WHERE d.tenant_id = $1 AND d.fecha >= COALESCE($2::date, CURRENT_DATE - 365)
      ORDER BY d.fecha DESC`,
    [tenantId, desde ?? null]
  );
  return r.rows;
}

export async function registrarDesecho(
  db: PoolClient,
  tenantId: string,
  datos: {
    fecha: string;
    tipo: string;
    pesoKg?: number | null;
    volumenL?: number | null;
    gestor: string;
    gestorAutorizacion?: string | null;
    archivoClave?: string | null;
    personaId: string;
  }
): Promise<{ id: string }> {
  if (!datos.gestor?.trim()) {
    throw new CumplimientoInvalido("Hace falta el gestor autorizado que se los lleva.");
  }
  if (!datos.pesoKg && !datos.volumenL) {
    throw new CumplimientoInvalido(
      "Hace falta el peso o el volumen: un retiro sin cantidad no sirve para una inspección."
    );
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO cmp_desechos
       (tenant_id, fecha, tipo, peso_kg, volumen_l, gestor, gestor_autorizacion,
        archivo_clave, registrado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      tenantId,
      datos.fecha,
      datos.tipo,
      datos.pesoKg ?? null,
      datos.volumenL ?? null,
      datos.gestor.trim(),
      datos.gestorAutorizacion ?? null,
      datos.archivoClave ?? null,
      datos.personaId,
    ]
  );
  return r.rows[0];
}
