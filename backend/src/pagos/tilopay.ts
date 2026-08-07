import { config } from "../config";
import { obtenerCredencialesPais, paisTieneCredenciales, PaisSinCredencialesError } from "./credencialesPasarela";

// ---------------------------------------------------------------------
// Integración con Tilopay (ver capa-pagos-tilopay.md) — cobro único e
// inmediato, sin guardar tarjeta: la tokenización de Tilopay (InitTokenize)
// solo está disponible en su ambiente de producción, confirmado contra el
// sandbox real durante la Fase 1 (ver memoria de la sesión). La
// recurrencia queda fuera de alcance por decisión de producto — se
// resuelve en producción, no acá.
//
// Motor de cobros — las credenciales YA NO son globales (config.tilopay*):
// cada función recibe paisCodigo y resuelve las suyas con
// obtenerCredencialesPais(), igual que el resto del motor de cobros. Antes
// esto leía config.tilopayApiKey/ApiUser/ApiPassword directo — dejarlo así
// habría creado un segundo camino de credenciales, global, conviviendo con
// el resolver por país del resto del motor (el día que se habilite un
// país nuevo, estas dos funciones habrían seguido cobrando con las
// credenciales de Costa Rica sin que nadie lo notara).
// ---------------------------------------------------------------------

const BASE_URL = "https://app.tilopay.com/api/v1";

export class TilopayNoConfiguradoError extends Error {
  constructor(paisCodigo: string) {
    super(`Tilopay no está configurado para el país "${paisCodigo}" (falta PASARELA_${paisCodigo}_API_KEY/API_USER/API_PASSWORD).`);
    this.name = "TilopayNoConfiguradoError";
  }
}

export function tilopayConfigurado(paisCodigo: string): boolean {
  return paisTieneCredenciales(paisCodigo);
}

function requerirCredenciales(paisCodigo: string) {
  try {
    const { apiKey, apiUser, apiPassword } = obtenerCredencialesPais(paisCodigo);
    return { key: apiKey, apiuser: apiUser, password: apiPassword };
  } catch (err) {
    if (err instanceof PaisSinCredencialesError) throw new TilopayNoConfiguradoError(paisCodigo);
    throw err;
  }
}

// ---------------------------------------------------------------------
// Token corto para el SDK del navegador (POST /loginSdk). El frontend
// nunca ve apiuser/apipassword — solo este token de sesión, que se pide
// de nuevo en cada intento de cobro (no se cachea: dura minutos).
// ---------------------------------------------------------------------
export async function obtenerTokenSdk(paisCodigo: string): Promise<{ accessToken: string; expiresIn: string }> {
  const { key, apiuser, password } = requerirCredenciales(paisCodigo);

  const response = await fetch(`${BASE_URL}/loginSdk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiuser, password, key }),
  });

  const data = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: string } | null;
  if (!response.ok || !data?.access_token) {
    throw new Error(`Tilopay loginSdk falló (HTTP ${response.status}): ${JSON.stringify(data)}`);
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? "" };
}

// ---------------------------------------------------------------------
// Bearer de la API general (POST /login, distinto de loginSdk) — lo
// necesita consultTransactions para verificar un cobro server-side.
// ---------------------------------------------------------------------
async function obtenerTokenApi(paisCodigo: string): Promise<string> {
  const { apiuser, password } = requerirCredenciales(paisCodigo);

  const response = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiuser, password }),
  });

  const data = (await response.json().catch(() => null)) as { access_token?: string } | null;
  if (!response.ok || !data?.access_token) {
    throw new Error(`Tilopay login falló (HTTP ${response.status}): ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

export interface TransaccionTilopay {
  id: number;
  orderNumber: string;
  code: string;
  amount: string;
  currency: string;
}

// ---------------------------------------------------------------------
// Verificación server-side de un cobro por orderNumber — NUNCA se confía
// en el querystring que Tilopay le manda al navegador del cliente (es
// spoofeable), esto es lo único que realmente decide si un pago se
// aprueba del lado del backend. Busca en una ventana de 2 días hacia
// atrás desde ahora (de sobra para el flujo de registro, que confirma
// segundos después de crear el cobro).
// ---------------------------------------------------------------------
export async function buscarTransaccionPorOrden(paisCodigo: string, orderNumber: string): Promise<TransaccionTilopay | null> {
  const { key } = requerirCredenciales(paisCodigo);
  const token = await obtenerTokenApi(paisCodigo);

  const ahora = new Date();
  const hace2Dias = new Date(ahora.getTime() - 2 * 24 * 60 * 60 * 1000);
  const formatoFecha = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

  const response = await fetch(`${BASE_URL}/consultTransactions`, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      startDate: formatoFecha(hace2Dias),
      endDate: formatoFecha(ahora),
      // 0 = producción, 1 = pruebas — sin esto Tilopay no devuelve las
      // transacciones de sandbox (confirmado contra la API real: sin
      // este campo, la consulta no encontraba transacciones de prueba
      // recién creadas).
      environment: config.tilopayModoPruebas ? 1 : 0,
      // NO se manda `orderNumber` acá — Tilopay le antepone un prefijo
      // propio del comercio (ej. "PFC029300-") al que nosotros mandamos
      // en processPayment/Init, así que filtrar server-side por el
      // orderNumber exacto que generamos nunca matchea. Se trae todo el
      // rango de fecha y se filtra del lado nuestro con `endsWith` más
      // abajo (la ventana de 2 días es chica, no hay volumen real todavía).
    }),
  });

  const data = (await response.json().catch(() => null)) as { response?: TransaccionTilopay[] } | null;
  if (!response.ok || !data?.response) {
    throw new Error(`Tilopay consultTransactions falló (HTTP ${response.status}): ${JSON.stringify(data)}`);
  }

  return data.response.find((t) => t.orderNumber.endsWith(orderNumber)) ?? null;
}
