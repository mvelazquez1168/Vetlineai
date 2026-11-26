import { NextFunction, Request, Response } from "express";
import { Pool, PoolClient } from "pg";
// `req.auth` y `req.db` los declara el `declare global` de este módulo.
// La importación es SOLO de tipos (no emite nada, así que no hay ciclo
// en tiempo de ejecución) y hace falta para que un script que importe
// este archivo sin pasar por las rutas compile igual: sin ella, el
// aumento de Express no entra en el programa y `req.auth` no existe.
import type {} from "./middleware/auth";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 2 — PUNTO ÚNICO de consulta de los módulos
// habilitados de una clínica.
//
// Nadie más lee `tenant_modulos`. El motivo no es estético: el gate de
// `tenant_agentes` (el mecanismo equivalente que ya existía) está
// escrito a mano dentro de `casos.routes.ts`, y la consulta a
// `tenant_agentes` aparece además en `cupos.ts`, `cambios.ts`,
// `platform.routes.ts` y `platform-admin.routes.ts` con cinco variantes
// del mismo SELECT. Mientras sean cinco, cambiar el criterio (por
// ejemplo, que un módulo en 'deshabilitado' pase a dar 402 en vez de
// 403) obliga a encontrar los cinco. Acá hay uno.
//
// Mismo patrón de módulo plano que medicoAgente.ts / cupos.ts, y mismo
// tipado `Pool | PoolClient` que correos.ts: se llama tanto desde un
// handler (con `req.db`, ya dentro de la transacción del request) como
// desde un comando de operación (con el pool crudo).
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

/**
 * Los cinco módulos de Vetline Clinic. Espejo exacto del CHECK de
 * `tenant_modulos.modulo` (migración 086, renombrado en la 088) — si se
 * agrega uno, se toca la migración y esta lista, nunca una sola de las
 * dos.
 *
 * `crm` incluye las campañas, los recordatorios comerciales y el motor
 * de oportunidades: son piezas del CRM, no módulos aparte (guía rectora
 * §7). Se llamaba `campanas` y el nombre describía la parte, no el todo.
 */
export const MODULOS = ["expediente", "inventario", "ventas", "facturacion", "crm"] as const;

export type Modulo = (typeof MODULOS)[number];

export function esModuloValido(valor: string): valor is Modulo {
  return (MODULOS as readonly string[]).includes(valor);
}

/**
 * Etiqueta de cada módulo tal como se le muestra a una persona. Vive acá
 * y no en el frontend porque el mensaje del gate (un 403 que lee el
 * administrador de la clínica) la necesita del lado del servidor, y
 * tener dos tablas de etiquetas que digan lo mismo es exactamente el
 * problema que este archivo viene a evitar.
 */
export const ETIQUETA_MODULO: Record<Modulo, string> = {
  expediente: "Expediente clínico",
  inventario: "Inventario y farmacia",
  ventas: "Ventas y caja",
  facturacion: "Facturación electrónica",
  crm: "CRM y fidelización",
};

/**
 * ¿Tiene esta clínica el módulo habilitado?
 *
 * Ausencia de fila = no habilitado. Es deliberado y es lo contrario del
 * default de `avisoActivo()` en notificaciones.ts (que ante la falta de
 * fila asume `true`): un aviso que no se configuró se manda igual porque
 * el default seguro es avisar; un módulo que nadie habilitó NO se
 * habilita solo. Ante la duda, un módulo de gestión está apagado.
 */
export async function moduloHabilitado(
  db: EjecutorSql,
  tenantId: string,
  modulo: Modulo
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM tenant_modulos
     WHERE tenant_id = $1 AND modulo = $2 AND estado = 'habilitado'`,
    [tenantId, modulo]
  );
  return result.rows.length > 0;
}

/**
 * Los módulos habilitados de una clínica, para que el frontend sepa qué
 * secciones mostrar. Lo consume `GET /api/auth/me`.
 */
export async function modulosHabilitados(db: EjecutorSql, tenantId: string): Promise<Modulo[]> {
  const result = await db.query(
    `SELECT modulo FROM tenant_modulos
     WHERE tenant_id = $1 AND estado = 'habilitado'
     ORDER BY modulo`,
    [tenantId]
  );
  return result.rows.map((f) => f.modulo as Modulo);
}

/**
 * Gate de ruta. Mismo estilo y mismo código de estado que el gate de
 * `tenant_agentes` en `casos.routes.ts` ("Este agente no está habilitado
 * para tu clínica."): 403 con un mensaje propio que nombra lo que falta.
 *
 * Se monta DESPUÉS de `authenticate` y `withTenantClient` — necesita
 * `req.auth.tenantId` y `req.db`. Si se monta antes, falla con un error
 * explicado en vez de dejar pasar el request.
 */
export function requiereModulo(modulo: Modulo) {
  return async function gateModulo(req: Request, res: Response, next: NextFunction) {
    if (!req.auth?.tenantId || !req.db) {
      console.error(
        `requiereModulo("${modulo}"): se montó antes de authenticate/withTenantClient — ` +
          `sin tenantId ni req.db no se puede resolver la habilitación.`
      );
      return res.status(500).json({ error: "Error interno de configuración de la ruta." });
    }

    try {
      if (!(await moduloHabilitado(req.db, req.auth.tenantId, modulo))) {
        return res.status(403).json({
          error: `El módulo "${ETIQUETA_MODULO[modulo]}" no está habilitado para tu clínica.`,
          code: "MODULO_NO_HABILITADO",
          modulo,
        });
      }
      next();
    } catch (err) {
      console.error(`requiereModulo("${modulo}")`, err);
      res.status(500).json({ error: "Error al verificar la habilitación del módulo." });
    }
  };
}

export type ResultadoHabilitar =
  | { ok: true; estadoAnterior: "ausente" | "habilitado" | "deshabilitado" }
  | { ok: false; motivo: "tenant_inexistente" };

/**
 * Habilita o deshabilita un módulo para una clínica. Idempotente: volver
 * a habilitar algo ya habilitado no es un error y no pisa
 * `habilitado_en` (la primera habilitación es el dato que importa).
 *
 * Único punto de escritura de `tenant_modulos`, por el mismo motivo que
 * `moduloHabilitado` es el único de lectura. Lo usa el comando de
 * operación (`habilitarModulo.ts`).
 */
export async function fijarEstadoModulo(
  db: EjecutorSql,
  tenantId: string,
  modulo: Modulo,
  estado: "habilitado" | "deshabilitado"
): Promise<ResultadoHabilitar> {
  const tenant = await db.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
  if (tenant.rows.length === 0) return { ok: false, motivo: "tenant_inexistente" };

  const actual = await db.query(`SELECT estado FROM tenant_modulos WHERE tenant_id = $1 AND modulo = $2`, [
    tenantId,
    modulo,
  ]);
  const estadoAnterior: "ausente" | "habilitado" | "deshabilitado" =
    actual.rows.length === 0 ? "ausente" : actual.rows[0].estado;

  // `$3::varchar` explícito en los tres usos, no por prolijidad: sin el
  // cast, Postgres ve el mismo parámetro una vez como valor de una
  // columna varchar y dos veces comparado contra un literal de texto, y
  // falla con "inconsistent types deduced for parameter $3" (42P08,
  // "text versus character varying"). Es la misma ambigüedad de tipo de
  // parámetro dentro de un CASE WHEN que ya apareció en los estados de
  // agentes por país. Encontrado al correr la verificación, no leyendo
  // el SQL.
  await db.query(
    `INSERT INTO tenant_modulos (tenant_id, modulo, estado, habilitado_en, deshabilitado_en)
     VALUES ($1, $2, $3::varchar,
             CASE WHEN $3::varchar = 'habilitado'    THEN now() ELSE NULL END,
             CASE WHEN $3::varchar = 'deshabilitado' THEN now() ELSE NULL END)
     ON CONFLICT (tenant_id, modulo) DO UPDATE SET
       estado = EXCLUDED.estado,
       -- COALESCE: conserva la fecha de la PRIMERA habilitación. Sin
       -- esto, deshabilitar y volver a habilitar borraría cuándo esta
       -- clínica empezó a usar el módulo.
       habilitado_en = CASE WHEN EXCLUDED.estado = 'habilitado'
                            THEN COALESCE(tenant_modulos.habilitado_en, now())
                            ELSE tenant_modulos.habilitado_en END,
       deshabilitado_en = CASE WHEN EXCLUDED.estado = 'deshabilitado'
                               THEN now() ELSE NULL END,
       actualizado_en = now()`,
    [tenantId, modulo, estado]
  );

  return { ok: true, estadoAnterior };
}
