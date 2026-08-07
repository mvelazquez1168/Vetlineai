import { Pool } from "pg";

// ---------------------------------------------------------------------
// Motor de cobros, Paso 1 — credenciales de pasarela por país. La
// afiliación es por país (regulación bancaria), así que NO hay una
// configuración global única: cada país habilitado tiene su propio
// trío de credenciales, resuelto por variable de entorno con prefijo
// PASARELA_<ISO>_ — mismo patrón que ya usa el resto del proyecto para
// TODO secreto (Anthropic/Resend/Stripe/Tilopay: env var única, sin
// vault ni cifrado en base). Agregar un país nuevo es agregar 3 env
// vars, sin tocar código ni base de datos.
//
// PASARELA_CR_API_KEY / PASARELA_CR_API_USER / PASARELA_CR_API_PASSWORD
// PASARELA_PA_API_KEY / PASARELA_PA_API_USER / PASARELA_PA_API_PASSWORD
// ...
// ---------------------------------------------------------------------

export interface CredencialesPasarela {
  apiKey: string;
  apiUser: string;
  apiPassword: string;
}

export class PaisSinCredencialesError extends Error {
  constructor(public readonly codigoIso: string) {
    super(
      `El país "${codigoIso}" no tiene credenciales de pasarela configuradas ` +
        `(faltan PASARELA_${codigoIso}_API_KEY/API_USER/API_PASSWORD).`
    );
    this.name = "PaisSinCredencialesError";
  }
}

function credencialesDesdeEnv(codigoIso: string): CredencialesPasarela | null {
  const prefijo = `PASARELA_${codigoIso.toUpperCase()}_`;
  const apiKey = process.env[`${prefijo}API_KEY`];
  const apiUser = process.env[`${prefijo}API_USER`];
  const apiPassword = process.env[`${prefijo}API_PASSWORD`];
  if (!apiKey || !apiUser || !apiPassword) return null;
  return { apiKey, apiUser, apiPassword };
}

export function paisTieneCredenciales(codigoIso: string): boolean {
  return credencialesDesdeEnv(codigoIso) !== null;
}

export function obtenerCredencialesPais(codigoIso: string): CredencialesPasarela {
  const credenciales = credencialesDesdeEnv(codigoIso);
  if (!credenciales) throw new PaisSinCredencialesError(codigoIso);
  return credenciales;
}

// ---------------------------------------------------------------------
// Validación al arrancar (Paso 1, punto 3 pedido explícitamente): un
// país en estado 'habilitado' sin sus env vars configuradas tiene que
// detectarse ACÁ, no cuando le venza el primer cobro a un cliente real
// de ese país. No es fatal (mismo criterio que el resto de las
// integraciones opcionales del proyecto — Stripe/Anthropic/Resend/
// Tilopay arrancan igual sin credenciales) pero se loguea fuerte.
// ---------------------------------------------------------------------
export async function validarCredencialesPaisesHabilitados(db: Pool): Promise<{ paisesSinCredenciales: string[] }> {
  const result = await db.query(`SELECT codigo_iso, nombre FROM paises WHERE estado = 'habilitado'`);
  const faltantes = result.rows.filter((p) => !paisTieneCredenciales(p.codigo_iso));

  if (faltantes.length > 0) {
    console.error(
      `[pagos] ALERTA DE ARRANQUE: ${faltantes.length} país(es) habilitado(s) sin credenciales de pasarela — ` +
        `los tenants de ${faltantes.map((p) => `${p.nombre} (${p.codigo_iso})`).join(", ")} van a fallar en su ` +
        `primer cobro. Configurá PASARELA_<ISO>_API_KEY/API_USER/API_PASSWORD antes de que corresponda cobrarles.`
    );
  }

  return { paisesSinCredenciales: faltantes.map((p) => p.codigo_iso) };
}
