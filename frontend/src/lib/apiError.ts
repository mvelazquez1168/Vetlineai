// Aislado en su propio módulo (sin imports) para que tanto `api.ts` como
// `keycloakAuth.ts` puedan usarlo sin crear un ciclo de imports entre
// api.ts -> session.ts -> keycloakAuth.ts -> api.ts.
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
