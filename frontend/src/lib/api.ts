import { ApiError } from "./apiError";
import { obtenerEnv } from "./runtimeEnv";
import { obtenerTokenValido, redirigirABloqueada } from "./session";

// Vetline_Ai_Suspension_Bloqueo.md — señal que manda authenticate() cuando
// la clínica del token está bloqueada (ver middleware/auth.ts). Se
// intercepta acá, en el único lugar por el que pasa cualquier request
// autenticado, para que la pantalla de bloqueo se muestre sin importar
// qué pantalla estaba disparando el request (login inicial, o una sesión
// que ya estaba abierta cuando Platform Admin bloqueó la clínica).
function interceptarClinicaBloqueada(data: unknown): void {
  if (data && typeof data === "object" && (data as { code?: string }).code === "CLINICA_BLOQUEADA") {
    redirigirABloqueada();
  }
}

const API_URL = obtenerEnv("VITE_API_URL") ?? "http://localhost:4000/api";

// Para armar URLs absolutas hacia archivos servidos por /uploads (rutas
// relativas tipo "/uploads/x.png" que vienen de la DB) — API_URL apunta a
// .../api, pero /uploads cuelga de la raíz del backend, no de /api.
export const API_ORIGIN = API_URL.replace(/\/api\/?$/, "");

// Re-exportada desde su propio módulo (ver apiError.ts, que no importa
// nada — evita un ciclo api.ts -> session.ts -> keycloakAuth.ts -> api.ts)
// para no romper los `import { ApiError } from "../lib/api"` ya existentes
// en toda la app.
export { ApiError };

interface RequestOptions extends RequestInit {
  token?: string | null;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, headers, body, ...rest } = options;
  // FormData (subida de archivos) necesita que el browser arme su propio
  // Content-Type con el boundary del multipart — si lo forzamos acá, el
  // servidor no puede parsear el body.
  const esFormData = typeof FormData !== "undefined" && body instanceof FormData;

  // `token` acá es solo la señal de "este llamado va autenticado" — el
  // valor real que se manda es siempre el más fresco posible, resuelto acá
  // (y refrescado automáticamente si estaba por vencer, ver session.ts).
  // Los módulos de API (adminApi, workspaceApi, etc.) siguen pasando
  // `token: getStoredToken()` como antes; no hace falta tocarlos.
  const authToken = token ? await obtenerTokenValido() : null;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    body,
    headers: {
      ...(esFormData ? {} : { "Content-Type": "application/json" }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    interceptarClinicaBloqueada(data);
    throw new ApiError(data?.error ?? "Error de red inesperado.", response.status, data);
  }

  return data as T;
}

// Para archivos (vista previa/descarga): un <iframe> o <a href> no puede
// mandar el header Authorization, así que se trae el archivo como blob
// autenticado por fetch y se arma un object URL en el cliente.
export async function apiFetchBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const { token, headers, ...rest } = options;
  const authToken = token ? await obtenerTokenValido() : null;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
  });

  if (!response.ok) {
    throw new ApiError("No pudimos obtener el archivo.", response.status);
  }

  return response.blob();
}

// Para descargas que el backend genera bajo demanda y devuelve como
// binario directo (ej. el .docx del informe) — a diferencia de
// apiFetchBlob, acá SÍ importa propagar el mensaje real del error (ej.
// "el caso no tiene información suficiente") en vez de uno genérico, y
// se extrae el nombre de archivo real del Content-Disposition que ya
// arma el backend en vez de inventar uno en el cliente.
export async function apiFetchFile(
  path: string,
  options: RequestOptions = {}
): Promise<{ blob: Blob; filename: string | null }> {
  const { token, headers, body, ...rest } = options;
  const authToken = token ? await obtenerTokenValido() : null;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    body,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    interceptarClinicaBloqueada(data);
    throw new ApiError(data?.error ?? "Error de red inesperado.", response.status, data);
  }

  const disposition = response.headers.get("Content-Disposition");
  const match = disposition ? /filename="?([^"]+)"?/.exec(disposition) : null;

  return { blob: await response.blob(), filename: match ? match[1] : null };
}

/**
 * La URL de un archivo servido por el backend (logos, adjuntos).
 *
 * Con S3 el servidor ya devuelve una URL absoluta y esto no la toca.
 * En desarrollo devuelve una ruta relativa ("/uploads/logos/x.png"),
 * que hay que colgar del origen de la API y no del de la interfaz:
 * son puertos distintos. Vive acá y no en cada pantalla porque ya
 * habia dos copias de este `if` y una de las dos se olvidaba la barra.
 */
export function urlDeArchivo(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (/^https?:\/\//.test(valor)) return valor;
  return `${API_ORIGIN}${valor.startsWith("/") ? "" : "/"}${valor}`;
}
