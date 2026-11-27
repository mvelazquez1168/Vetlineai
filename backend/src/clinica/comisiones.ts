import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// HONORARIOS Y COMISIONES — prompt 11, §3.
//
// La base ya estaba y nadie la leía: `vta_cargos.realizado_por` y
// `.referido_por`, del 08b, dicen quién hizo cada cosa y quién la
// refirió. Lo que faltaba era la regla y la liquidación.
//
// GANA LA REGLA MÁS ESPECÍFICA, y el orden está escrito acá y en ningún
// otro lado. De más específica a más general:
//
//   1. esta persona + este servicio
//   2. esta persona + esta familia de productos
//   3. esta persona + esta línea de negocio
//   4. esta persona, sin más
//   5. este servicio, para cualquiera
//   6. esta familia, para cualquiera
//   7. esta línea, para cualquiera
//   8. la regla general de la clínica
//
// POR OMISIÓN SE PAGA SOBRE LO COBRADO. Una comisión pagada sobre una
// factura que el cliente nunca pagó es plata que puso la clínica. Es
// configurable porque hay clínicas que trabajan al revés y es su
// decisión.
//
// EL IVA NUNCA ES DEL MÉDICO: se descuenta siempre. Lo que es opcional
// es descontar además el costo de los insumos.
// ---------------------------------------------------------------------

export class ComisionInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ComisionInvalida";
  }
}

export interface Regla {
  id: string;
  persona_id: string | null;
  persona_nombre: string | null;
  servicio_id: string | null;
  servicio_nombre: string | null;
  familia_id: string | null;
  familia_nombre: string | null;
  linea_negocio: string | null;
  rol_en_el_cargo: "realizado" | "referido";
  tipo: "porcentaje" | "monto";
  valor: string;
  base: "cobrado" | "facturado";
  descontar_insumos: boolean;
  vigente_desde: string;
  vigente_hasta: string | null;
  activo: boolean;
}

export async function reglas(db: PoolClient, tenantId: string): Promise<Regla[]> {
  const r = await db.query<Regla>(
    `SELECT r.id, r.persona_id, p.nombre AS persona_nombre,
            r.servicio_id, s.nombre AS servicio_nombre,
            r.familia_id, f.nombre AS familia_nombre,
            r.linea_negocio, r.rol_en_el_cargo, r.tipo, r.valor::text, r.base,
            r.descontar_insumos, r.vigente_desde::text, r.vigente_hasta::text, r.activo
       FROM com_reglas r
       LEFT JOIN personas p ON p.id = r.persona_id
       LEFT JOIN inv_servicios s ON s.id = r.servicio_id
       LEFT JOIN inv_familias f ON f.id = r.familia_id
      WHERE r.tenant_id = $1
      ORDER BY r.activo DESC, p.nombre NULLS LAST, s.nombre NULLS LAST`,
    [tenantId]
  );
  return r.rows;
}

export async function guardarRegla(
  db: PoolClient,
  tenantId: string,
  datos: {
    id?: string;
    personaId?: string | null;
    servicioId?: string | null;
    familiaId?: string | null;
    lineaNegocio?: string | null;
    rolEnElCargo?: "realizado" | "referido";
    tipo: "porcentaje" | "monto";
    valor: number;
    base?: "cobrado" | "facturado";
    descontarInsumos?: boolean;
    vigenteDesde?: string;
    vigenteHasta?: string | null;
    activo?: boolean;
    personaQueRegistra: string;
  }
): Promise<{ id: string }> {
  if (!(datos.valor >= 0)) throw new ComisionInvalida("El valor no puede ser negativo.");
  if (datos.tipo === "porcentaje" && datos.valor > 100) {
    throw new ComisionInvalida("Un porcentaje mayor que 100 es un dedo que se resbaló.");
  }
  const valores = [
    tenantId,
    datos.personaId ?? null,
    datos.servicioId ?? null,
    datos.familiaId ?? null,
    datos.lineaNegocio ?? null,
    datos.rolEnElCargo ?? "realizado",
    datos.tipo,
    datos.valor,
    datos.base ?? "cobrado",
    datos.descontarInsumos ?? false,
    datos.vigenteDesde ?? null,
    datos.vigenteHasta ?? null,
  ];
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE com_reglas
          SET persona_id = $2, servicio_id = $3, familia_id = $4, linea_negocio = $5,
              rol_en_el_cargo = $6, tipo = $7, valor = $8, base = $9,
              descontar_insumos = $10,
              vigente_desde = COALESCE($11::date, vigente_desde), vigente_hasta = $12,
              activo = COALESCE($14, activo)
        WHERE id = $13 AND tenant_id = $1 RETURNING id`,
      [...valores, datos.id, datos.activo ?? null]
    );
    if (r.rows.length === 0) throw new ComisionInvalida("Esa regla no existe.");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO com_reglas
       (tenant_id, persona_id, servicio_id, familia_id, linea_negocio, rol_en_el_cargo,
        tipo, valor, base, descontar_insumos, vigente_desde, vigente_hasta, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::date, CURRENT_DATE),$12,$13)
     RETURNING id`,
    [...valores, datos.personaQueRegistra]
  );
  return r.rows[0];
}

interface CargoLiquidable {
  cargo_id: string;
  descripcion: string;
  fecha: string;
  servicio_id: string | null;
  familia_id: string | null;
  linea_negocio: string | null;
  /** Neto sin IVA, ya con el descuento aplicado. */
  neto: string;
  /** Lo cobrado de la cuenta, proporcional a este cargo. */
  cobrado: string;
  costo_insumos: string;
  rol_en_el_cargo: "realizado" | "referido";
}

/**
 * Los cargos del período que le corresponden a una persona, por haberlos
 * realizado o referido.
 *
 * LO COBRADO SE PRORRATEA. Una cuenta de ₡100 000 con tres cargos de la
 * que el cliente pagó ₡50 000 no deja decidir «cuál de los tres se
 * pagó»: lo que corresponde es la mitad de cada uno. Cualquier otra
 * repartición es inventada.
 */
async function cargosDePersona(
  db: PoolClient,
  tenantId: string,
  personaId: string,
  desde: string,
  hasta: string
): Promise<CargoLiquidable[]> {
  const r = await db.query<CargoLiquidable>(
    `WITH cargos AS (
       SELECT c.id AS cargo_id,
              c.descripcion,
              c.creado_en::date::text AS fecha,
              c.servicio_id,
              pr.producto_id,
              p.familia_id,
              c.linea_negocio,
              c.cuenta_id,
              -- EL NETO SIN IVA. El IVA no es del médico: es de
              -- Hacienda y está de paso por la clínica.
              ((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0))
                / (1 + COALESCE(ti.tarifa, 0) / 100.0) AS neto,
              -- El costo de los insumos de ese cargo, cuando la regla
              -- pide descontarlo: sale del movimiento de inventario que
              -- el cargo generó.
              COALESCE((
                SELECT sum(m.cantidad_base * COALESCE(m.costo_unitario, 0))
                  FROM inv_movimientos m WHERE m.id = c.movimiento_id
              ), 0) AS costo_insumos,
              CASE WHEN c.realizado_por = $2 THEN 'realizado' ELSE 'referido' END
                AS rol_en_el_cargo
         FROM vta_cargos c
         LEFT JOIN inv_presentaciones pr ON pr.id = c.presentacion_id
         LEFT JOIN inv_productos p ON p.id = pr.producto_id
         LEFT JOIN fact_cat_tarifa_iva ti ON ti.codigo = c.codigo_tarifa_iva
        WHERE c.tenant_id = $1
          AND c.anulado_en IS NULL
          AND c.creado_en::date BETWEEN $3::date AND $4::date
          AND (c.realizado_por = $2 OR c.referido_por = $2)
     ),
     cobros_por_cuenta AS (
       SELECT co.cuenta_id, COALESCE(sum(co.total), 0) AS cobrado
         FROM vta_cobros co
        WHERE co.tenant_id = $1 AND co.estado <> 'anulado'
        GROUP BY co.cuenta_id
     ),
     totales_por_cuenta AS (
       SELECT c.cuenta_id, sum((c.cantidad * c.precio_unitario) - COALESCE(c.descuento, 0)) AS total
         FROM vta_cargos c
        WHERE c.tenant_id = $1 AND c.anulado_en IS NULL
        GROUP BY c.cuenta_id
     )
     SELECT g.cargo_id, g.descripcion, g.fecha, g.servicio_id, g.familia_id,
            g.linea_negocio, g.rol_en_el_cargo,
            g.neto::numeric(14,2)::text AS neto,
            g.costo_insumos::numeric(14,2)::text AS costo_insumos,
            -- Lo cobrado de ESTE cargo: su parte proporcional de lo que
            -- se cobró de su cuenta.
            (g.neto * LEAST(1, COALESCE(cc.cobrado, 0) / NULLIF(tc.total, 0)))
              ::numeric(14,2)::text AS cobrado
       FROM cargos g
       LEFT JOIN cobros_por_cuenta cc ON cc.cuenta_id = g.cuenta_id
       LEFT JOIN totales_por_cuenta tc ON tc.cuenta_id = g.cuenta_id
      ORDER BY g.fecha`,
    [tenantId, personaId, desde, hasta]
  );
  return r.rows;
}

/** La regla que gana para este cargo, con el orden de especificidad. */
function reglaQueGana(
  todas: Regla[],
  cargo: CargoLiquidable,
  personaId: string,
  fecha: string
): Regla | null {
  const vigentes = todas.filter(
    (r) =>
      r.activo &&
      r.rol_en_el_cargo === cargo.rol_en_el_cargo &&
      r.vigente_desde <= fecha &&
      (!r.vigente_hasta || r.vigente_hasta >= fecha) &&
      (r.persona_id === null || r.persona_id === personaId) &&
      (r.servicio_id === null || r.servicio_id === cargo.servicio_id) &&
      (r.familia_id === null || r.familia_id === cargo.familia_id) &&
      (r.linea_negocio === null || r.linea_negocio === cargo.linea_negocio)
  );
  if (vigentes.length === 0) return null;

  // Puntaje de especificidad: la persona pesa más que el servicio, el
  // servicio más que la familia y la familia más que la línea. Es el
  // orden que el prompt pide, hecho número para poder ordenarlo.
  const puntaje = (r: Regla) =>
    (r.persona_id ? 8 : 0) + (r.servicio_id ? 4 : 0) + (r.familia_id ? 2 : 0) + (r.linea_negocio ? 1 : 0);
  return vigentes.sort((a, b) => puntaje(b) - puntaje(a))[0];
}

export interface LineaCalculada {
  cargoId: string;
  descripcion: string;
  fecha: string;
  reglaId: string;
  base: number;
  porcentaje: number | null;
  monto: number;
}

/**
 * El borrador de un período para una persona.
 *
 * NO ESCRIBE NADA: calcula. Lo que se guarda lo decide quien liquida.
 */
export async function calcularBorrador(
  db: PoolClient,
  tenantId: string,
  personaId: string,
  desde: string,
  hasta: string
): Promise<{ lineas: LineaCalculada[]; total: number; sinRegla: number }> {
  const todas = await reglas(db, tenantId);
  const cargos = await cargosDePersona(db, tenantId, personaId, desde, hasta);

  const lineas: LineaCalculada[] = [];
  let sinRegla = 0;

  for (const c of cargos) {
    const regla = reglaQueGana(todas, c, personaId, c.fecha);
    if (!regla) {
      sinRegla += 1;
      continue;
    }
    let base = Number(regla.base === "cobrado" ? c.cobrado : c.neto);
    if (regla.descontar_insumos) base = Math.max(0, base - Number(c.costo_insumos));
    if (base <= 0 && regla.tipo === "porcentaje") continue;

    const monto =
      regla.tipo === "porcentaje"
        ? Math.round(base * (Number(regla.valor) / 100) * 100) / 100
        : Number(regla.valor);

    lineas.push({
      cargoId: c.cargo_id,
      descripcion: c.descripcion,
      fecha: c.fecha,
      reglaId: regla.id,
      base: Math.round(base * 100) / 100,
      porcentaje: regla.tipo === "porcentaje" ? Number(regla.valor) : null,
      monto,
    });
  }

  return {
    lineas,
    total: Math.round(lineas.reduce((t, l) => t + l.monto, 0) * 100) / 100,
    sinRegla,
  };
}

/**
 * Guarda el borrador.
 *
 * Re-corrible: vuelve a calcular y reemplaza las líneas **del
 * borrador**. Si ya estaba aprobada, el trigger de la base lo impide.
 *
 * LOS CARGOS YA LIQUIDADOS EN UN PERÍODO ANTERIOR NO ENTRAN: el índice
 * único `(cargo_id, es_ajuste)` lo garantiza, y acá se filtran antes
 * para que el borrador muestre lo que de verdad se va a pagar en vez de
 * fallar al guardar.
 */
export async function generarBorrador(
  db: PoolClient,
  tenantId: string,
  datos: { personaId: string; desde: string; hasta: string; personaQueGenera: string }
): Promise<{ id: string; total: number; lineas: number; yaLiquidados: number }> {
  const calculo = await calcularBorrador(db, tenantId, datos.personaId, datos.desde, datos.hasta);

  const existente = await db.query<{ id: string; estado: string }>(
    `SELECT id, estado FROM com_liquidaciones
      WHERE tenant_id = $1 AND persona_id = $2 AND desde = $3::date AND hasta = $4::date`,
    [tenantId, datos.personaId, datos.desde, datos.hasta]
  );
  if (existente.rows[0]?.estado === "aprobada") {
    throw new ComisionInvalida(
      "Esa liquidación ya está aprobada y no se recalcula. Lo que haya cambiado va como ajuste en la siguiente."
    );
  }

  let liquidacionId = existente.rows[0]?.id;
  if (liquidacionId) {
    await db.query(`DELETE FROM com_liquidacion_lineas WHERE liquidacion_id = $1`, [liquidacionId]);
  } else {
    const r = await db.query<{ id: string }>(
      `INSERT INTO com_liquidaciones (tenant_id, persona_id, desde, hasta, creado_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tenantId, datos.personaId, datos.desde, datos.hasta, datos.personaQueGenera]
    );
    liquidacionId = r.rows[0].id;
  }

  // Los cargos que ya están en otra liquidación: no se pagan dos veces.
  const yaLiquidados = await db.query<{ cargo_id: string }>(
    `SELECT l.cargo_id FROM com_liquidacion_lineas l
      JOIN com_liquidaciones q ON q.id = l.liquidacion_id
     WHERE l.tenant_id = $1 AND l.cargo_id = ANY($2::uuid[]) AND q.id <> $3 AND NOT l.es_ajuste`,
    [tenantId, calculo.lineas.map((l) => l.cargoId), liquidacionId]
  );
  const excluidos = new Set(yaLiquidados.rows.map((r) => r.cargo_id));

  let total = 0;
  for (const l of calculo.lineas) {
    if (excluidos.has(l.cargoId)) continue;
    await db.query(
      `INSERT INTO com_liquidacion_lineas
         (tenant_id, liquidacion_id, cargo_id, regla_id, descripcion, base, porcentaje, monto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, liquidacionId, l.cargoId, l.reglaId, l.descripcion, l.base, l.porcentaje, l.monto]
    );
    total += l.monto;
  }

  total = Math.round(total * 100) / 100;
  await db.query(`UPDATE com_liquidaciones SET total = $2 WHERE id = $1`, [liquidacionId, total]);

  return {
    id: liquidacionId,
    total,
    lineas: calculo.lineas.length - excluidos.size,
    yaLiquidados: excluidos.size,
  };
}

export async function ajustar(
  db: PoolClient,
  tenantId: string,
  datos: { liquidacionId: string; descripcion: string; monto: number; motivo: string }
): Promise<void> {
  if (!datos.motivo?.trim()) {
    throw new ComisionInvalida("Un ajuste sin motivo es un número que nadie va a poder explicar.");
  }
  await db.query(
    `INSERT INTO com_liquidacion_lineas
       (tenant_id, liquidacion_id, descripcion, base, monto, es_ajuste, motivo)
     VALUES ($1,$2,$3,0,$4,true,$5)`,
    [tenantId, datos.liquidacionId, datos.descripcion, datos.monto, datos.motivo.trim()]
  );
  await db.query(
    `UPDATE com_liquidaciones q
        SET total = (SELECT COALESCE(sum(monto), 0) FROM com_liquidacion_lineas
                      WHERE liquidacion_id = q.id)
      WHERE q.id = $1`,
    [datos.liquidacionId]
  );
}

export async function aprobar(
  db: PoolClient,
  tenantId: string,
  datos: { liquidacionId: string; personaId: string }
): Promise<{ total: number }> {
  const r = await db.query<{ total: string }>(
    `UPDATE com_liquidaciones
        SET estado = 'aprobada', aprobado_por = $3, aprobado_en = now()
      WHERE id = $1 AND tenant_id = $2 AND estado = 'borrador'
      RETURNING total::text`,
    [datos.liquidacionId, tenantId, datos.personaId]
  );
  if (r.rows.length === 0) {
    throw new ComisionInvalida("Esa liquidación no existe o ya estaba aprobada.");
  }
  return { total: Number(r.rows[0].total) };
}

/**
 * Los ajustes que deja un cargo anulado DESPUÉS de haberse liquidado.
 *
 * La liquidación cerrada no se toca: lo que corresponde es restarlo en
 * la siguiente. Esta función encuentra esos cargos y arma el ajuste.
 */
export async function ajustesPendientes(
  db: PoolClient,
  tenantId: string,
  personaId: string
): Promise<Array<{ cargo_id: string; descripcion: string; monto: string; liquidacion: string }>> {
  const r = await db.query<{
    cargo_id: string;
    descripcion: string;
    monto: string;
    liquidacion: string;
  }>(
    `SELECT l.cargo_id, l.descripcion, l.monto::text, q.desde::text AS liquidacion
       FROM com_liquidacion_lineas l
       JOIN com_liquidaciones q ON q.id = l.liquidacion_id
       JOIN vta_cargos c ON c.id = l.cargo_id
      WHERE l.tenant_id = $1 AND q.persona_id = $2 AND q.estado = 'aprobada'
        AND NOT l.es_ajuste
        AND c.anulado_en IS NOT NULL
        -- Y que no se haya ajustado ya: el ajuste lleva el mismo cargo
        -- marcado como ajuste, que es para lo que sirve esa parte del
        -- índice único.
        AND NOT EXISTS (
          SELECT 1 FROM com_liquidacion_lineas a
           WHERE a.cargo_id = l.cargo_id AND a.es_ajuste
        )
      ORDER BY q.desde`,
    [tenantId, personaId]
  );
  return r.rows;
}

/** Aplica esos ajustes a la liquidación en borrador que se le indique. */
export async function aplicarAjustesPendientes(
  db: PoolClient,
  tenantId: string,
  datos: { liquidacionId: string; personaId: string }
): Promise<{ aplicados: number; monto: number }> {
  const pendientes = await ajustesPendientes(db, tenantId, datos.personaId);
  let monto = 0;
  for (const p of pendientes) {
    await db.query(
      `INSERT INTO com_liquidacion_lineas
         (tenant_id, liquidacion_id, cargo_id, descripcion, base, monto, es_ajuste, motivo)
       VALUES ($1,$2,$3,$4,0,$5,true,$6)`,
      [
        tenantId,
        datos.liquidacionId,
        p.cargo_id,
        `Ajuste: ${p.descripcion}`,
        -Number(p.monto),
        `El cargo se anuló después de la liquidación del ${p.liquidacion}`,
      ]
    );
    monto -= Number(p.monto);
  }
  if (pendientes.length > 0) {
    await db.query(
      `UPDATE com_liquidaciones q
          SET total = (SELECT COALESCE(sum(monto), 0) FROM com_liquidacion_lineas
                        WHERE liquidacion_id = q.id)
        WHERE q.id = $1`,
      [datos.liquidacionId]
    );
  }
  return { aplicados: pendientes.length, monto: Math.round(monto * 100) / 100 };
}

export async function liquidaciones(
  db: PoolClient,
  tenantId: string,
  filtros: { personaId?: string; soloPropias?: string } = {}
): Promise<Array<Record<string, unknown>>> {
  const persona = filtros.soloPropias ?? filtros.personaId ?? null;
  const r = await db.query(
    `SELECT q.id, q.persona_id, p.nombre AS persona, q.desde::text, q.hasta::text,
            q.estado, q.total::text, q.aprobado_en, ap.nombre AS aprobado_por,
            (SELECT count(*) FROM com_liquidacion_lineas l WHERE l.liquidacion_id = q.id)::int
              AS lineas
       FROM com_liquidaciones q
       JOIN personas p ON p.id = q.persona_id
       LEFT JOIN personas ap ON ap.id = q.aprobado_por
      WHERE q.tenant_id = $1 AND ($2::uuid IS NULL OR q.persona_id = $2::uuid)
      ORDER BY q.desde DESC, p.nombre`,
    [tenantId, persona]
  );
  return r.rows;
}

export async function detalleDeLiquidacion(
  db: PoolClient,
  tenantId: string,
  id: string
): Promise<{ liquidacion: Record<string, unknown>; lineas: Array<Record<string, unknown>> }> {
  const q = await db.query(
    `SELECT q.id, q.persona_id, p.nombre AS persona, q.desde::text, q.hasta::text,
            q.estado, q.total::text, q.aprobado_en, ap.nombre AS aprobado_por
       FROM com_liquidaciones q
       JOIN personas p ON p.id = q.persona_id
       LEFT JOIN personas ap ON ap.id = q.aprobado_por
      WHERE q.id = $1 AND q.tenant_id = $2`,
    [id, tenantId]
  );
  if (q.rows.length === 0) throw new ComisionInvalida("Esa liquidación no existe.");
  const l = await db.query(
    `SELECT l.id, l.descripcion, l.base::text, l.porcentaje::text, l.monto::text,
            l.es_ajuste, l.motivo, l.cargo_id
       FROM com_liquidacion_lineas l
      WHERE l.liquidacion_id = $1
      ORDER BY l.es_ajuste, l.creado_en`,
    [id]
  );
  return { liquidacion: q.rows[0], lineas: l.rows };
}
