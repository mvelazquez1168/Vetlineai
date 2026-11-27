import { apiFetch } from "./api";

// RUTAS PÚBLICAS: el backend las sirve sin sesión, y acá se declara con
// `publico: true`. Es la excepción del cliente de API (ver `api.ts`):
// toda llamada va autenticada salvo las que lo digan. En una ruta
// pública el token NO se resuelve a propósito, para no mandar al login a
// alguien que está abriendo un enlace sin sesión.

export interface Pais {
  codigo_iso: string;
  nombre: string;
  idioma_default: string;
  zona_horaria_default: string | null;
  zonas_horarias: string[];
}

// Catálogo público — no requiere token, igual que en el backend.
export const paisesApi = {
  listar: () => apiFetch<{ paises: Pais[] }>("/paises", { publico: true }),
};
