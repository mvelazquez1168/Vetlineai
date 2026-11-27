import { apiFetch, apiFetchBlob } from "./api";

// ---------------------------------------------------------------------
// DASHBOARDS Y DRILL-DOWN — prompt 12.
//
// Los tipos son los que devuelve el backend, sin traducción: lo que la
// pantalla muestra es lo que el diccionario calculó. Acá NO se calcula
// nada —ni una suma, ni un promedio, ni una variación—, porque un
// número calculado en el navegador es el segundo número que el prompt
// 12 existe para evitar.
// ---------------------------------------------------------------------

export interface DefinicionMetrica {
  clave: string;
  nombre: string;
  descripcion: string;
  formula: string;
  fuente: string;
  excluye: string;
  imputacion: string;
  formato: "dinero" | "entero" | "porcentaje";
  requierePermiso?: string;
  drillDown?: string;
}

export interface Tarjeta {
  clave: string;
  valor: number | null;
  anterior: number | null;
  variacion: number | null;
  detalle?: string;
  serie?: Array<{ fecha: string; valor: number }>;
}

export interface DashboardClinica {
  periodo: { desde: string; hasta: string };
  comparado: { desde: string; hasta: string };
  tarjetas: Tarjeta[];
  porLinea: Array<{
    linea: string;
    ingresos: number;
    costo: number;
    margen: number;
    sin_costo: number;
  }>;
  verCostos: boolean;
  sinCosto: number;
  tendencia: Array<{ fecha: string; valor: number }>;
  topPorIngresos: ItemTop[];
  topPorMargen: ItemTop[] | null;
  inventarioCritico: { bajoMinimo: number; porVencer: number; vencidosConExistencia: number };
  agenda: {
    porMedico: Array<{ medico: string; citas: number; minutos: number; noShow: number }>;
    porSala: Array<{ sala: string; citas: number; minutos: number }>;
    inasistenciasPorMotivo: Array<{ motivo: string; cantidad: number }>;
  };
  clientes: { nuevos: number; recurrentes: number; retencion: number | null };
  cobrosPorMedio: Array<{ medio: string; monto: number; cantidad: number }>;
  campanas: Array<{ campana: string; enviados: number; respondieron: number }> | null;
}

export interface ItemTop {
  item: string;
  tipo: "producto" | "servicio";
  cantidad: number;
  ingresos: number;
  costo: number;
  margen: number;
  sin_costo: boolean;
}

export interface DashboardMedico {
  medicoId: string;
  medico: string;
  periodo: { desde: string; hasta: string };
  tarjetas: Tarjeta[];
  agendaHoy: Array<Record<string, unknown>>;
  agendaSemana: Array<{ fecha: string; citas: number }>;
  seguimientos: Array<Record<string, unknown>>;
  recomendacionesNoAgendadas: Array<Record<string, unknown>>;
  laboratorioSinVer: Array<Record<string, unknown>>;
  porLinea: Array<{ linea: string; ingresos: number }>;
  topServicios: Array<{ item: string; cantidad: number; ingresos: number }>;
}

export interface ListaMetrica {
  clave: string;
  titulo: string;
  metrica: string;
  columnas: Array<{ clave: string; etiqueta: string; tipo?: string }>;
  columnaSuma: string | null;
  sinPeriodo: boolean;
  total: number;
  filas: Array<Record<string, unknown>>;
  cantidad: number;
  pagina: number;
  porPagina: number;
}

export interface ResumenCliente {
  propietarioId: string;
  gastoAcumulado: number;
  gastoPorLinea: Array<{ linea: string; monto: number }>;
  tendencia: Array<{ mes: string; monto: number }>;
  visitas: number;
  primeraVisita: string | null;
  ultimaVisita: string | null;
  frecuenciaDias: number | null;
  saldoPendiente: number;
  saldoVencido: number;
  valor: { ingresos: number; margen: number | null; sinCosto: number };
  mascotas: Array<{
    id: string;
    nombre: string;
    especie: string;
    estado: string;
    preventivosVencidos: number;
    ultimaVisita: string | null;
  }>;
  preventivosPendientes: Array<{
    paciente: string;
    pacienteId: string;
    tipo: string;
    detalle: string | null;
    fecha: string;
    dias: number;
  }>;
}

export interface PreventivoPorTipo {
  tipo: string;
  subtipo: string | null;
  estado: "al_dia" | "por_vencer" | "vencido" | "sin_registro";
  ultima: string | null;
  proxima: string | null;
  historico: boolean;
  dias: number | null;
}

export interface ResumenPaciente {
  pacienteId: string;
  preventivos: PreventivoPorTipo[];
  gastoAcumulado: number;
  gastoPorLinea: Array<{ linea: string; monto: number }>;
  casosAbiertos: Array<{ id: string; motivo: string; estado: string; creado: string }>;
  signos: Array<Record<string, unknown>>;
}

export interface ConsumoProducto {
  productoId: string;
  producto: string;
  unidadBase: string;
  presentacion: { nombre: string; factor: number } | null;
  totalBase: number;
  totalPresentacion: number | null;
  porOrigen: Array<{
    origen: string;
    nombre: string;
    conPaciente: boolean;
    cantidadBase: number;
    movimientos: number;
  }>;
  tendencia: Array<{ fecha: string; cantidadBase: number }>;
  pacientes: Array<{
    pacienteId: string;
    paciente: string;
    cliente: string | null;
    fecha: string;
    cantidadBase: number;
    lote: string | null;
    loteId: string | null;
    atencionId: string | null;
  }>;
}

export interface TrazabilidadLote {
  loteId: string;
  numero: string;
  producto: string;
  vencimiento: string | null;
  pacientes: Array<{
    pacienteId: string;
    paciente: string;
    propietarioId: string | null;
    cliente: string | null;
    telefono: string | null;
    email: string | null;
    fecha: string;
    cantidadBase: number;
    atencionId: string | null;
    sePuedeAvisar: boolean;
    motivoSiNo: string | null;
  }>;
  sinPaciente: Array<{ origen: string; nombre: string; cantidadBase: number; fecha: string }>;
}

const rango = (desde: string, hasta: string) =>
  `desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`;

export const metricasApi = {
  diccionario: () =>
    apiFetch<{ metricas: DefinicionMetrica[]; listas: Array<{ clave: string; titulo: string }> }>(
      "/metricas/diccionario"
    ),

  clinica: (desde: string, hasta: string) =>
    apiFetch<DashboardClinica>(`/metricas/clinica?${rango(desde, hasta)}`),

  medico: (desde: string, hasta: string, medicoId?: string | null) =>
    apiFetch<DashboardMedico>(
      `/metricas/medico?${rango(desde, hasta)}${medicoId ? `&medicoId=${medicoId}` : ""}`
    ),

  comparativa: (desde: string, hasta: string) =>
    apiFetch<{
      medicos: Array<{
        medicoId: string;
        medico: string;
        atenciones: number;
        facturado: number;
        ticket: number;
        noShow: number;
      }>;
    }>(`/metricas/medicos/comparativa?${rango(desde, hasta)}`),

  lista: (clave: string, desde: string, hasta: string, pagina = 1, porPagina = 50) =>
    apiFetch<ListaMetrica>(
      `/metricas/listas/${clave}?${rango(desde, hasta)}&pagina=${pagina}&porPagina=${porPagina}`
    ),

  cliente: (id: string) => apiFetch<ResumenCliente>(`/metricas/cliente/${id}`),

  paciente: (id: string) => apiFetch<ResumenPaciente>(`/metricas/paciente/${id}`),

  consumoProducto: (id: string, desde: string, hasta: string) =>
    apiFetch<ConsumoProducto>(`/metricas/producto/${id}/consumo?${rango(desde, hasta)}`),

  trazabilidadLote: (id: string) =>
    apiFetch<TrazabilidadLote>(`/metricas/lote/${id}/trazabilidad`),

  // LAS EXPORTACIONES SE PIDEN AL BACKEND, nunca se arman acá: el
  // archivo tiene que salir con los mismos filtros y el mismo alcance
  // de clínica que la consulta, y un CSV hecho en el navegador exporta
  // solo la página que está cargada.
  exportarDashboard: (desde: string, hasta: string, formato: "excel" | "pdf") =>
    apiFetchBlob(`/metricas/clinica/exportar?${rango(desde, hasta)}&formato=${formato}`),

  exportarLista: (clave: string, desde: string, hasta: string, formato: "excel" | "pdf") =>
    apiFetchBlob(`/metricas/listas/${clave}/exportar?${rango(desde, hasta)}&formato=${formato}`),
};
