import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// TIPOS DE CITA Y NUMERACIONES — prompt 04, §3.
//
// Dos cosas chicas que comparten un archivo porque comparten la
// pantalla: «Configuración de la agenda». Separarlas en dos módulos de
// cuarenta líneas no agrega nada.
//
// LAS NUMERACIONES SON HOY INFORMATIVAS y así lo dice la migración 144:
// cada módulo sigue calculando su consecutivo. Lo que esta pantalla
// cambia es el prefijo y los dígitos con los que se muestra.
// ---------------------------------------------------------------------

export class ConfiguracionInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ConfiguracionInvalida";
  }
}

export async function tiposDeCita(
  db: PoolClient,
  tenantId: string,
  incluirInactivos = false
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT tc.id, tc.nombre, tc.duracion_minutos, tc.color, tc.sala_id,
            tc.linea_negocio, tc.servicio_id, tc.activo, tc.orden,
            s.nombre AS sala_nombre, sv.nombre AS servicio_nombre
       FROM tipos_cita tc
       LEFT JOIN salas s ON s.id = tc.sala_id
       LEFT JOIN inv_servicios sv ON sv.id = tc.servicio_id
      WHERE tc.tenant_id = $1 AND ($2 OR tc.activo)
      ORDER BY tc.orden, tc.nombre`,
    [tenantId, incluirInactivos]
  );
  return r.rows;
}

export async function guardarTipoDeCita(
  db: PoolClient,
  tenantId: string,
  datos: {
    id?: string;
    nombre: string;
    duracionMinutos: number;
    color?: string | null;
    salaId?: string | null;
    lineaNegocio?: string | null;
    servicioId?: string | null;
    activo?: boolean;
    orden?: number;
  }
): Promise<{ id: string }> {
  if (!datos.nombre?.trim()) {
    throw new ConfiguracionInvalida("El tipo de cita necesita un nombre.");
  }
  if (!(datos.duracionMinutos > 0)) {
    throw new ConfiguracionInvalida("La duración tiene que ser mayor que cero.");
  }
  const valores = [
    tenantId,
    datos.nombre.trim(),
    datos.duracionMinutos,
    datos.color || null,
    datos.salaId || null,
    datos.lineaNegocio || null,
    datos.servicioId || null,
    datos.activo ?? true,
    datos.orden ?? 100,
  ];
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE tipos_cita
          SET nombre = $2, duracion_minutos = $3, color = $4, sala_id = $5,
              linea_negocio = $6, servicio_id = $7, activo = $8, orden = $9
        WHERE id = $10 AND tenant_id = $1
        RETURNING id`,
      [...valores, datos.id]
    );
    if (r.rows.length === 0) throw new ConfiguracionInvalida("Ese tipo de cita no existe.");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO tipos_cita
       (tenant_id, nombre, duracion_minutos, color, sala_id, linea_negocio,
        servicio_id, activo, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    valores
  );
  return r.rows[0];
}

/**
 * Un tipo de cita no se borra: se desactiva.
 *
 * Las citas que ya se agendaron con ese tipo lo siguen mostrando, y
 * borrarlo las dejaría sin tipo (`ON DELETE SET NULL`), o sea perdiendo
 * un dato del historial para limpiar una lista.
 */
export async function desactivarTipoDeCita(
  db: PoolClient,
  tenantId: string,
  id: string
): Promise<void> {
  await db.query(`UPDATE tipos_cita SET activo = false WHERE id = $1 AND tenant_id = $2`, [
    id,
    tenantId,
  ]);
}

export async function numeraciones(
  db: PoolClient,
  tenantId: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT documento, prefijo, siguiente, digitos, actualizado_en
       FROM clinica_numeraciones WHERE tenant_id = $1 ORDER BY documento`,
    [tenantId]
  );
  return r.rows;
}

export async function guardarNumeracion(
  db: PoolClient,
  tenantId: string,
  datos: { documento: string; prefijo?: string | null; digitos?: number }
): Promise<void> {
  const digitos = datos.digitos ?? 5;
  if (digitos < 1 || digitos > 12) {
    throw new ConfiguracionInvalida("Los dígitos van de 1 a 12.");
  }
  // EL SIGUIENTE NÚMERO NO SE EDITA DESDE ACÁ, a propósito: bajarlo
  // genera números repetidos en documentos que ya se entregaron. La
  // pantalla lo muestra y no lo deja escribir, y acá tampoco se acepta
  // aunque venga en el cuerpo.
  const r = await db.query(
    `UPDATE clinica_numeraciones
        SET prefijo = $3, digitos = $4, actualizado_en = now()
      WHERE tenant_id = $1 AND documento = $2`,
    [tenantId, datos.documento, datos.prefijo || null, digitos]
  );
  if (r.rowCount === 0) {
    throw new ConfiguracionInvalida(`No hay una numeración de «${datos.documento}».`);
  }
}
