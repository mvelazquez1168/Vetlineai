import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------
// Cliente del dictado de la consulta — prompt 07d, fase 2.
//
// Módulo propio y no un bloque de `expedienteApi` porque la subida del
// audio es multipart, no JSON: es la única llamada del expediente que lo
// es, y mezclada ahí se lee como si fuera lo normal.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

export interface EstadoDictado {
  activo: boolean;
  retencionAudioHoras: number;
  proveedor: string;
  /** El proveedor simulado necesita el texto que reconoció el navegador. */
  necesitaTextoDelNavegador: boolean;
  proveedorListo: boolean;
  motivoNoListo: string | null;
}

export interface LineaRecetaDictada {
  nombreDicho: string;
  presentacionId: string | null;
  nombreEnCatalogo: string | null;
  dosisCantidad: number | null;
  dosisUnidad: string | null;
  dosisPorKg: boolean;
  viaCodigo: string | null;
  frecuenciaCodigo: string | null;
  duracionCantidad: number | null;
  duracionUnidad: "dias" | "semanas" | "meses" | null;
  explicacionDosis: string | null;
  dosisTotal: number | null;
  pesoUsadoKg: number | null;
  /** El peso de la cuenta viene del dictado y todavía no está aceptado. */
  pesoDelDictado: boolean;
  avisos: Array<{ porque: string; severidad: string; detalle: string }>;
  revisar: string[];
}

export interface BorradorDictado {
  motivoConsulta: string | null;
  anamnesis: string | null;
  signos: {
    temperatura: number | null;
    frecuenciaCardiaca: number | null;
    frecuenciaRespiratoria: number | null;
    peso: number | null;
    condicionCorporal: number | null;
  };
  restoNormal: boolean;
  sistemas: Array<{
    sistema: string;
    etiqueta: string;
    estado: "anormal" | "normal";
    hallazgo: string | null;
  }>;
  diagnosticos: Array<{ descripcion: string; tipo: "presuntivo" | "definitivo" }>;
  planTratamiento: string | null;
  indicacionesCliente: string | null;
  controlDias: number | null;
  controlMotivo: string | null;
  receta: LineaRecetaDictada[];
  estudios: Array<{ tipoEstudio: string; observaciones: string | null }>;
  revisar: string[];
}

export interface Dictado {
  id: string;
  atencionId: string;
  estado: "transcrito" | "ordenado" | "aplicado" | "descartado";
  proveedor: string;
  segundosAudio: number;
  textoTranscrito: string;
  borrador: BorradorDictado | null;
  camposAplicados: string[];
  creadoEn: string;
  costoUsd: number | null;
}

export const dictadoApi = {
  estado: () => pedir<EstadoDictado>("/dictado/estado"),

  deLaAtencion: (atencionId: string) =>
    pedir<{ dictado: Dictado | null }>(`/dictado/atenciones/${atencionId}`),

  /**
   * Manda el audio a transcribir y ordenar.
   *
   * `texto` es lo que reconoció el navegador y SOLO lo usa el proveedor
   * simulado de desarrollo (el real lo ignora: si no lo ignorara,
   * cualquiera podría mandar un texto inventado sin audio).
   */
  transcribir: (
    atencionId: string,
    datos: { audio?: Blob | null; texto?: string | null; segundos?: number | null }
  ) => {
    const cuerpo = new FormData();
    if (datos.audio) cuerpo.append("audio", datos.audio, "dictado.webm");
    if (datos.texto) cuerpo.append("texto", datos.texto);
    if (datos.segundos != null) cuerpo.append("segundos", String(Math.round(datos.segundos)));
    return pedir<{ dictado: Dictado | null; aviso: string | null }>(
      `/dictado/atenciones/${atencionId}`,
      { method: "POST", body: cuerpo }
    );
  },

  aplicar: (dictadoId: string, campos: string[]) =>
    pedir<{ aplicados: string[]; problemas: Array<{ campo: string; detalle: string }> }>(
      `/dictado/${dictadoId}/aplicar`,
      { method: "POST", body: JSON.stringify({ campos }) }
    ),

  descartar: (dictadoId: string) =>
    pedir<{ ok: true }>(`/dictado/${dictadoId}/descartar`, { method: "POST" }),
};
