// Aislado en su propio módulo (sin imports) para que tanto `api.ts` como
// `keycloakAuth.ts` puedan usarlo sin crear un ciclo de imports entre
// api.ts -> session.ts -> keycloakAuth.ts -> api.ts.
/**
 * Lo que se le dice a la persona cuando no hubo respuesta del servidor.
 *
 * DEFECTO DEL 2026-11-27 (caso Kira): al cerrar una atención con el
 * backend reiniciándose, la pantalla mostró dos avisos que decían
 * «Failed to fetch». Es el mensaje que pone el navegador, en inglés y
 * sin decir lo único que importa: si se guardó algo o no.
 *
 * Acá se dice. Y se dice que NO se guardó nada, que es cierto: si el
 * servidor no contestó, la transacción nunca llegó a confirmarse.
 */
export const MENSAJE_SIN_CONEXION =
  "No se pudo conectar con el servidor. No se guardó nada; intente de nuevo.";

/**
 * ¿Esto es «no hubo respuesta», y no «el servidor dijo que no»?
 *
 * `fetch` rechaza con un `TypeError` cuyo texto depende del navegador:
 * «Failed to fetch» en Chrome, «NetworkError when attempting to fetch
 * resource» en Firefox, «Load failed» en Safari. Ninguno se le muestra
 * a nadie.
 */
export function esErrorDeRed(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0;
  if (!(err instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed|network request failed/i.test(err.message);
}

export class ApiError extends Error {
  status: number;
  // Cuerpo completo de la respuesta de error — algunos endpoints (ej. el
  // 402 de límite de uso alcanzado) devuelven datos útiles junto al
  // mensaje de error (el mensaje del médico que sí quedó guardado).
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
