import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// Búsqueda global de la paleta de comandos. Las PANTALLAS no vienen de
// acá: son un catálogo fijo del frontend (ver lib/comandos.ts) y
// filtrarlas no necesita un viaje de red.
export interface PacienteBuscado {
  id: string;
  nombre: string;
  numero_expediente: number;
  especie: string;
  microchip: string | null;
  estado: "activo" | "fallecido";
  raza: string | null;
  propietario_nombre: string;
  puntaje: number;
}

export interface PropietarioBuscado {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  numero_identificacion: string | null;
  tipo_identificacion_etiqueta: string | null;
  cantidad_pacientes: number;
  puntaje: number;
}

export interface ResultadoBusqueda {
  pacientes: PacienteBuscado[];
  propietarios: PropietarioBuscado[];
  consulta: string;
}

export const busquedaApi = {
  global: (q: string) =>
    apiFetch<ResultadoBusqueda>(`/busqueda?q=${encodeURIComponent(q)}`, {
      token: getStoredToken(),
    }),
};
