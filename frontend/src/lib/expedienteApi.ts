import { getStoredToken } from "../hooks/useAuth";
import { apiFetch, apiFetchFile } from "./api";

// ---------------------------------------------------------------------
// Cliente de la API del expediente clínico (prompt 07, bloque A).
//
// Mismo criterio que `inventarioApi` y `ventasApi`: tipos y llamadas,
// nada de lógica. La franja de alertas, la completitud, las banderas de
// laboratorio y la ficha racial las calcula el backend — si la pantalla
// las recalculara, el PDF y la pantalla podrían decir distinto.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}
function json<T>(path: string, metodo: string, cuerpo: unknown): Promise<T> {
  return pedir<T>(path, { method: metodo, body: JSON.stringify(cuerpo) });
}

export interface AlertaExpediente {
  tipo: "alergia" | "manejo" | "cronico" | "preventivo" | "saldo" | "hallazgo" | "estudio";
  severidad: "alta" | "media" | "baja";
  texto: string;
  detalle?: string;
}

export interface Problema {
  id: string;
  descripcion: string;
  estado: "activo" | "cronico" | "resuelto";
  fecha_inicio: string;
  fecha_resolucion: string | null;
  nota: string | null;
  atenciones: number;
}

export interface Alergia {
  id: string;
  tipo: string;
  sustancia: string;
  grupo: string | null;
  severidad: string;
  reaccion: string | null;
  nota: string | null;
  medicamento_nombre: string | null;
}

export interface EncabezadoExpediente {
  paciente: Record<string, string | number | boolean | null>;
  cliente: Record<string, string | null> | null;
  alertas: AlertaExpediente[];
  problemas: Problema[];
  alergias: Alergia[];
  medicacionActiva: Array<{
    receta_id: string;
    medicamento: string;
    dosis: string | null;
    frecuencia: string | null;
    duracion: string | null;
    fecha_fin: string | null;
    duracionEstructurada: boolean;
  }>;
  completitud: { porcentaje: number; faltan: string[] };
  pesoActual: number | null;
}

export interface EventoHistoria {
  tipo: string;
  fecha: string;
  titulo: string;
  detalle: string | null;
  medico: string | null;
  referencia_id: string;
}

export interface EstudioLab {
  id: string;
  tipo_estudio: string;
  estado: string;
  es_externo: boolean;
  laboratorio: string | null;
  fecha_solicitud: string;
  /** Cuándo se tomó la muestra (anexo 07-03, A6). */
  fecha_muestra: string | null;
  fecha_resultado: string | null;
  observaciones: string | null;
  solicitado_por_nombre: string | null;
  visto_en: string | null;
  /** Los archivos del resultado: uno o varios. */
  adjuntos: Array<{ id: string; nombre_archivo: string; tipo: string | null }>;
  resultados: Array<{
    analito: string;
    valor: number | string | null;
    valor_texto: string | null;
    unidad: string | null;
    ref_min: number | null;
    ref_max: number | null;
    bandera: "alto" | "bajo" | "normal" | null;
  }>;
}

export interface Tendencia {
  codigo: string;
  nombre: string | null;
  unidad: string | null;
  refMin: number | null;
  refMax: number | null;
  puntos: Array<{ fecha: string; valor: number; bandera: string | null; estudioId: string }>;
}

export interface GroomingRegistro {
  id: string;
  fecha: string;
  groomer_nombre: string | null;
  tipo_corte: string | null;
  comportamiento: string | null;
  observaciones: string | null;
  servicios: string[];
  hallazgos: Array<{ id: string; tipo: string; descripcion: string; atendido_en: string | null }>;
}

export interface FichaRacial {
  raza: string | null;
  especie: string;
  texto: string | null;
  coincidio: boolean;
  seccionAgrupada: boolean;
  motivo: string | null;
}

export const expedienteApi = {
  encabezado: (pacienteId: string) =>
    pedir<EncabezadoExpediente>(`/expediente/pacientes/${pacienteId}`),

  lineaDeTiempo: (pacienteId: string, filtros: Record<string, string> = {}) =>
    pedir<{ eventos: EventoHistoria[] }>(
      `/expediente/pacientes/${pacienteId}/linea-de-tiempo?${new URLSearchParams(filtros)}`
    ),

  buscar: (pacienteId: string, q: string) =>
    pedir<{
      coincidencias: Array<{
        tipo: string;
        fecha: string;
        donde: string;
        fragmento: string;
        referencia_id: string;
      }>;
    }>(`/expediente/pacientes/${pacienteId}/buscar?q=${encodeURIComponent(q)}`),

  evolucion: (pacienteId: string) =>
    pedir<{
      puntos: Array<{ fecha: string; peso: string | null; temperatura: string | null; medico: string | null }>;
    }>(`/expediente/pacientes/${pacienteId}/evolucion`),

  fichaRacial: (pacienteId: string) =>
    pedir<FichaRacial>(`/expediente/pacientes/${pacienteId}/ficha-racial`),

  problemas: (pacienteId: string) =>
    pedir<{ problemas: Problema[] }>(`/expediente/pacientes/${pacienteId}/problemas`),
  agregarProblema: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/pacientes/${pacienteId}/problemas`, "POST", d),
  cambiarProblema: (problemaId: string, d: Record<string, unknown>) =>
    json<{ ok: true }>(`/expediente/problemas/${problemaId}`, "PUT", d),

  alergias: (pacienteId: string) =>
    pedir<{ alergias: Alergia[] }>(`/expediente/pacientes/${pacienteId}/alergias`),
  registrarAlergia: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/pacientes/${pacienteId}/alergias`, "POST", d),
  /** ¿Es alérgico a esto? Se consulta ANTES de confirmar una receta. */
  avisosDeAlergia: (pacienteId: string, farmaco: Record<string, string>) =>
    pedir<{ avisos: Array<{ alergia: Alergia; porque: string }> }>(
      `/expediente/pacientes/${pacienteId}/avisos-alergia?${new URLSearchParams(farmaco)}`
    ),

  adendas: (atencionId: string) =>
    pedir<{
      adendas: Array<{
        id: string;
        motivo: string;
        texto: string;
        autor_nombre: string | null;
        creado_en: string;
      }>;
    }>(`/expediente/atenciones/${atencionId}/adendas`),
  agregarAdenda: (atencionId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/atenciones/${atencionId}/adendas`, "POST", d),
  cerrarAtencion: (atencionId: string) =>
    json<{ ok: true }>(`/expediente/atenciones/${atencionId}/cerrar`, "POST", {}),

  laboratorio: (pacienteId: string) =>
    pedir<{
      estudios: EstudioLab[];
      analitos: Array<{ codigo: string; nombre: string; unidad: string; mediciones: number }>;
    }>(`/expediente/pacientes/${pacienteId}/laboratorio`),
  tendencia: (pacienteId: string, codigo: string) =>
    pedir<Tendencia>(`/expediente/pacientes/${pacienteId}/laboratorio/tendencia/${codigo}`),
  solicitarEstudio: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/pacientes/${pacienteId}/laboratorio`, "POST", d),
  cargarResultados: (estudioId: string, d: Record<string, unknown>) =>
    json<{ cargados: number; conBandera: number }>(
      `/expediente/laboratorio/${estudioId}/resultados`,
      "POST",
      d
    ),
  marcarVisto: (estudioId: string) =>
    json<{ ok: true }>(`/expediente/laboratorio/${estudioId}/visto`, "POST", {}),
  estudiosSinVer: () =>
    pedir<{
      estudios: Array<{
        id: string;
        tipo_estudio: string;
        fecha_resultado: string;
        paciente: string;
        paciente_id: string;
        alterados: number;
      }>;
    }>("/expediente/laboratorio/sin-ver"),

  grooming: (pacienteId: string) =>
    pedir<{ grooming: GroomingRegistro[] }>(`/expediente/pacientes/${pacienteId}/grooming`),
  registrarGrooming: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string; hallazgos: number }>(
      `/expediente/pacientes/${pacienteId}/grooming`,
      "POST",
      d
    ),
  atenderHallazgo: (hallazgoId: string, d: Record<string, unknown> = {}) =>
    json<{ ok: true }>(`/expediente/grooming/hallazgos/${hallazgoId}/atender`, "POST", d),

  plantillasConsentimiento: () =>
    pedir<{
      plantillas: Array<{ id: string; tipo: string; titulo: string; cuerpo: string; activo: boolean }>;
    }>("/expediente/consentimientos/plantillas"),
  sembrarPlantillasBase: () =>
    json<{ creadas: number }>("/expediente/consentimientos/plantillas/base", "POST", {}),
  prepararConsentimiento: (pacienteId: string, plantillaId: string, procedimiento = "") =>
    pedir<{ titulo: string; texto: string; firmanteSugerido: string; identificacion: string | null }>(
      `/expediente/pacientes/${pacienteId}/consentimientos/preparar?plantilla=${plantillaId}&procedimiento=${encodeURIComponent(procedimiento)}`
    ),
  consentimientos: (pacienteId: string) =>
    pedir<{
      consentimientos: Array<{
        id: string;
        titulo: string;
        firmante_nombre: string;
        firmante_identificacion: string | null;
        firmado_en: string;
        testigo: string | null;
        /** false en los firmados con la imagen de relleno (ver migración 167). */
        firma_valida: boolean;
        firma_invalida_motivo: string | null;
        firmado_a_distancia: boolean;
        firmante_relacion: string | null;
        /** Si tiene huella y por lo tanto se puede comprobar su integridad. */
        verificable: boolean;
      }>;
    }>(`/expediente/pacientes/${pacienteId}/consentimientos`),
  firmarConsentimiento: (pacienteId: string, d: Record<string, unknown>) =>
    json<{
      id: string;
      huella: string;
      /** Si el PDF se le pudo mandar al cliente, y si no, por qué. */
      envio?: { enviado: boolean; motivo?: string };
    }>(`/expediente/pacientes/${pacienteId}/consentimientos`, "POST", d),

  /** El PDF del consentimiento firmado, con la evidencia y la huella. */
  consentimientoPdf: (id: string) =>
    apiFetchFile(`/expediente/consentimientos/${id}/pdf`, { token: getStoredToken() }),

  /**
   * Le manda al cliente el enlace para firmar desde su teléfono.
   *
   * NO devuelve el enlace: el que tiene que abrirlo es el cliente, por
   * su canal. Devolverlo acá invitaría a abrirlo desde el mostrador y
   * firmar por él, que es lo que la firma a distancia evita.
   */
  firmaADistancia: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string; canal: string; destino: string; vence: string }>(
      `/expediente/pacientes/${pacienteId}/consentimientos/a-distancia`,
      "POST",
      d
    ),

  // --- Anexo del 07 -------------------------------------------------

  /** Peso, temperatura y condición corporal por visita (A1). */
  tendenciaSignos: (pacienteId: string) =>
    pedir<{ tendencias: TendenciaSigno[] }>(`/expediente/pacientes/${pacienteId}/tendencia-signos`),

  /** Quién está en la clínica ahora (A2). No es del paciente: es de la clínica. */
  enLaClinica: () => pedir<{ pacientes: PacienteEnLaClinica[] }>("/expediente/en-la-clinica"),
};

// ---------------------------------------------------------------------
// LA ATENCIÓN QUE GENERA CARGOS — bloque B
// ---------------------------------------------------------------------

export interface SistemaExaminado {
  sistema: string;
  estado: "normal" | "anormal" | "no_evaluado";
  nota: string | null;
}

export interface DiagnosticoAtencion {
  id: string;
  tipo: "presuntivo" | "definitivo";
  descripcion: string;
  problema_id: string | null;
  creado_por_nombre: string | null;
}

export interface ItemAtencion {
  id: string;
  tipo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento: number;
  total: number;
  cobrado: boolean;
  dispensado_aqui: boolean;
}

export interface AtencionDetalle {
  atencion: Record<string, string | number | null>;
  sistemas: SistemaExaminado[];
  diagnosticos: DiagnosticoAtencion[];
  items: ItemAtencion[];
  total: number;
}


/** Anexo del 07, A1 — la serie de un signo a lo largo de las visitas. */
export interface TendenciaSigno {
  signo: "peso" | "temperatura" | "condicion_corporal";
  etiqueta: string;
  unidad: string;
  puntos: Array<{ fecha: string; valor: number }>;
}

/** Anexo del 07, A1 — el examen ordenado para leerlo. */
export interface ResumenExamen {
  anormales: Array<{ sistema: string; hallazgo: string | null }>;
  normales: string[];
  noEvaluados: string[];
  textoCorrido: string;
  sinExaminar: boolean;
}

/** Anexo del 07, A2 — quién está adentro ahora. */
export interface PacienteEnLaClinica {
  atencionId: string;
  pacienteId: string;
  paciente: string;
  especie: string | null;
  propietario: string;
  medico: string | null;
  ingresoEn: string;
  minutosAdentro: number;
  esEstancia: boolean;
  estanciaMotivo: string | null;
  estadoAtencion: string;
}

export const atencionApi = {
  plantillas: () =>
    pedir<{
      plantillas: Array<{
        id: string;
        tipo_consulta: string;
        nombre: string;
        sistemas: string[];
        de_la_plataforma: boolean;
      }>;
    }>("/expediente/atenciones/plantillas"),

  abrir: (d: Record<string, unknown>) =>
    json<{ atencion: { id: string; citaId: string; estado: string; creada: boolean } }>(
      "/expediente/atenciones",
      "POST",
      d
    ),

  detalle: (atencionId: string) => pedir<AtencionDetalle>(`/expediente/atenciones/${atencionId}`),

  /** La atención empezada de este paciente, si hay alguna. */
  enCurso: (pacienteId: string) =>
    pedir<{ atencionId: string | null; detalle: AtencionDetalle | null }>(
      `/expediente/pacientes/${pacienteId}/atencion-en-curso`
    ),

  /**
   * Guardado de la atención (anexo 07-03, A4).
   *
   * `campos.version` viaja con el resto: el servidor compara y responde
   * 409 si otra sesión escribió en el medio, en vez de pisar.
   */
  guardar: (atencionId: string, campos: Record<string, unknown>) =>
    json<{ guardado: true; version: number; guardadoEn: string }>(
      `/expediente/atenciones/${atencionId}`,
      "PATCH",
      campos
    ),

  /** El examen en PDF, con la marca de la clínica (anexo 07-03, A1). */
  examenPdf: (atencionId: string) =>
    apiFetchFile(`/expediente/atenciones/${atencionId}/examen.pdf`, { token: getStoredToken() }),

  /** Tomar la atención o renovar el latido (anexo 07-03, A4). */
  latido: (atencionId: string) =>
    json<{
      mio: boolean;
      porPersonaId: string | null;
      porNombre: string | null;
      desde: string | null;
      contenido: Record<string, unknown>;
    }>(`/expediente/atenciones/${atencionId}/latido`, "POST", {}),

  /** Soltarla al salir de la pantalla. */
  soltarAtencion: (atencionId: string) =>
    pedir<{ ok: true }>(`/expediente/atenciones/${atencionId}/latido`, { method: "DELETE" }),

  aplicarPlantilla: (atencionId: string, tipoConsulta: string) =>
    json<{ plantillaId: string | null; sistemas: string[] }>(
      `/expediente/atenciones/${atencionId}/plantilla`,
      "POST",
      { tipoConsulta }
    ),

  marcarSistema: (
    atencionId: string,
    sistema: string,
    estado: string,
    nota?: string | null
  ) =>
    json<{ guardado: true }>(
      `/expediente/atenciones/${atencionId}/sistemas/${encodeURIComponent(sistema)}`,
      "PUT",
      { estado, nota }
    ),

  agregarDiagnostico: (atencionId: string, d: Record<string, unknown>) =>
    json<{ id: string; problemaId: string | null }>(
      `/expediente/atenciones/${atencionId}/diagnosticos`,
      "POST",
      d
    ),

  agregarItem: (atencionId: string, d: Record<string, unknown>) =>
    json<{ id: string; descripcion: string; precioUnitario: number; total: number }>(
      `/expediente/atenciones/${atencionId}/items`,
      "POST",
      d
    ),

  quitarItem: (atencionId: string, itemId: string) =>
    json<{ quitado: true }>(
      `/expediente/atenciones/${atencionId}/items/${itemId}`,
      "DELETE",
      {}
    ),

  cuenta: (atencionId: string) =>
    pedir<{ items: ItemAtencion[]; total: number; yaCobrado: number }>(
      `/expediente/atenciones/${atencionId}/cuenta`
    ),

  avisosReceta: (pacienteId: string, presentacionId: string) =>
    pedir<{ avisos: Array<{ porque: string; severidad: string; detalle: string }> }>(
      `/expediente/pacientes/${pacienteId}/avisos-receta?presentacionId=${presentacionId}`
    ),

  cerrar: (atencionId: string, d: Record<string, unknown> = {}) =>
    json<{
      cuentaId: string;
      cuentaNumero: number;
      cargos: number;
      total: number;
      movimientos: number;
      preventivos: number;
      controlCitaId: string | null;
      yaEstabaCerrada: boolean;
      recetaFirmada: boolean;
      recetaLineas: number;
    }>(`/expediente/atenciones/${atencionId}/cerrar`, "POST", d),

  // --- prompt 07c ----------------------------------------------------

  /** Los productos de una acción, ya filtrados por su tipo clínico. */
  catalogoClinico: (tipo?: TipoClinico, q?: string) =>
    pedir<{ productos: ProductoClinico[] }>(
      `/expediente/catalogo-clinico?${new URLSearchParams({
        ...(tipo ? { tipo } : {}),
        ...(q ? { q } : {}),
      }).toString()}`
    ),

  proximaSugerida: (p: {
    tipo: "vacunacion" | "desparasitacion";
    especie?: string;
    productoId?: string;
    nombre?: string;
  }) =>
    pedir<{ fecha: string | null; meses: number | null; origen: string | null }>(
      `/expediente/proxima-sugerida?${new URLSearchParams(
        Object.entries(p).filter(([, v]) => v) as [string, string][]
      ).toString()}`
    ),

  receta: (atencionId: string) =>
    pedir<RecetaDeAtencion>(`/expediente/atenciones/${atencionId}/receta`),

  agregarLineaReceta: (atencionId: string, d: Record<string, unknown>) =>
    json<LineaRecetaCalculada>(`/expediente/atenciones/${atencionId}/receta/lineas`, "POST", d),

  quitarLineaReceta: (atencionId: string, lineaId: string) =>
    json<{ quitada: true }>(
      `/expediente/atenciones/${atencionId}/receta/lineas/${lineaId}`,
      "DELETE",
      {}
    ),

  repetirReceta: (atencionId: string, recetaId: string) =>
    json<{ copiadas: number; recalculadas: number }>(
      `/expediente/atenciones/${atencionId}/receta/repetir`,
      "POST",
      { recetaId }
    ),

  recetasAnteriores: (pacienteId: string, excluirAtencion?: string) =>
    pedir<{
      recetas: Array<{ id: string; fecha: string; medico: string; lineas: number; resumen: string }>;
    }>(
      `/expediente/pacientes/${pacienteId}/recetas${
        excluirAtencion ? `?excluirAtencion=${excluirAtencion}` : ""
      }`
    ),


  enviarReceta: (atencionId: string) =>
    json<{ enviado: boolean; motivo: string | null; destinatario: string | null }>(
      `/expediente/atenciones/${atencionId}/receta/enviar`,
      "POST",
      {}
    ),

  pedirEstudio: (atencionId: string, d: Record<string, unknown>) =>
    json<{ id: string; conCargo: boolean }>(
      `/expediente/atenciones/${atencionId}/estudios`,
      "POST",
      d
    ),

  estudios: (atencionId: string) =>
    pedir<{
      estudios: Array<{
        id: string;
        tipo: string;
        externo: boolean;
        laboratorio: string | null;
        estado: string;
      }>;
    }>(`/expediente/atenciones/${atencionId}/estudios`),

  resumenCierre: (atencionId: string) =>
    pedir<ResumenCierre>(`/expediente/atenciones/${atencionId}/resumen-cierre`),

  /**
   * Adjuntar el resultado de un laboratorio (anexo 07-03, A6).
   *
   * Va al MISMO endpoint que el adjunto de un caso de Vetline Ai, con
   * el mismo límite de 25 MB, la misma tabla de tipos y el mismo
   * almacenamiento privado: lo único que cambia es a qué cuelga.
   */
  adjuntarAlEstudio: (estudioLabId: string, archivo: File) => {
    const cuerpo = new FormData();
    cuerpo.append("estudioLabId", estudioLabId);
    cuerpo.append("archivo", archivo);
    return pedir<{ archivo: { id: string; nombre_archivo: string; tipo: string } }>("/archivos", {
      method: "POST",
      body: cuerpo,
    });
  },

  /** Registrar un laboratorio FUERA de una atencion (anexo 07-03, A6). */
  registrarLaboratorioDePaciente: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string }>(`/expediente/pacientes/${pacienteId}/laboratorio`, "POST", d),

  /** Cerrar un pendiente con su resultado, sin crear otro registro. */
  cerrarPendienteConResultado: (
    estudioId: string,
    datos: { fechaMuestra?: string | null; observaciones?: string | null }
  ) => json<{ ok: true }>(`/expediente/laboratorio/${estudioId}/resultado`, "POST", datos),

  /** Los catálogos clínicos: vías, frecuencias, unidades de dosis. */
  catalogosClinicos: () =>
    pedir<Record<string, Array<{ id: string; codigo: string; etiqueta: string; horas: number | null }>>>(
      "/expediente/catalogos-clinicos"
    ),

  preventivoHistorico: (pacienteId: string, d: Record<string, unknown>) =>
    json<{ id: string; proxima: string }>(
      `/expediente/pacientes/${pacienteId}/preventivo-historico`,
      "POST",
      d
    ),

  // --- Anexo del 07, A1 y A2 ----------------------------------------

  /** El examen ordenado: primero lo anormal. */
  examen: (atencionId: string) => pedir<ResumenExamen>(`/expediente/atenciones/${atencionId}/examen`),

  registrarSalida: (atencionId: string) =>
    json<{ salidaEn: string }>(`/expediente/atenciones/${atencionId}/salida`, "POST", {}),

  deshacerSalida: (atencionId: string) =>
    pedir<{ ok: true }>(`/expediente/atenciones/${atencionId}/salida`, { method: "DELETE" }),

  marcarEstancia: (atencionId: string, esEstancia: boolean, motivo?: string | null) =>
    json<{ ok: true }>(`/expediente/atenciones/${atencionId}/estancia`, "PUT", { esEstancia, motivo }),
};

// --- Tipos del prompt 07c ---------------------------------------------

export type TipoClinico = "vacuna" | "antiparasitario" | "medicamento" | "insumo" | "otro";

/** La posología que la clínica cargó para el producto (anexo 07-03, A3). */
export interface PosologiaSugerida {
  dosisPorKg: number | null;
  dosisFija: number | null;
  unidadDosis: string | null;
  viaAdministracion: string | null;
  frecuencia: string | null;
  duracionCantidad: number | null;
  duracionUnidad: "dias" | "semanas" | "meses" | null;
}

export interface ProductoClinico {
  presentacionId: string;
  productoId: string;
  nombre: string;
  presentacion: string;
  tipoClinico: TipoClinico | null;
  requiereReceta: boolean;
  precio: number | null;
  posologia: PosologiaSugerida | null;
  lotes: Array<{ id: string; numero: string; vence: string | null; cantidad: number }>;
}

export interface LineaRecetaCalculada {
  id: string;
  orden: number;
  nombre: string;
  medicamentoId?: string | null;
  presentacionId?: string | null;
  textoLibre?: string | null;
  dosisCantidad?: number | null;
  dosisUnidad?: string | null;
  dosisPorKg?: boolean;
  viaCodigo?: string | null;
  frecuenciaCodigo?: string | null;
  duracionCantidad?: number | null;
  duracionUnidad?: "dias" | "semanas" | "meses" | null;
  cantidadTotal?: number | null;
  indicaciones?: string | null;
  dispensadoAqui?: boolean;
  cantidadDispensada?: number | null;
  pesoBaseKg: number | null;
  dosisTotal: number | null;
  explicacionDosis: string | null;
  atencionItemId: string | null;
}

export interface RecetaDeAtencion {
  id: string | null;
  pesoKg: number | null;
  /** De dónde salió el peso y de cuándo es (anexo 07-03, A3). */
  pesoOrigen: "dictado" | "atencion_actual" | "ultima_atencion" | null;
  pesoFecha: string | null;
  pesoAntiguedadDias: number | null;
  pesoViejo: boolean;
  estado: string;
  lineas: LineaRecetaCalculada[];
  avisos: Array<{ porque: string; severidad: string; detalle: string; linea: string }>;
  sinGrupoFarmacologico: string[];
}

export interface ResumenCierre {
  cargos: Array<{ descripcion: string; cantidad: number; total: number }>;
  total: number;
  salidas: Array<{ descripcion: string; cantidad: number; lote: string | null }>;
  recordatorios: Array<{ que: string; cuando: string }>;
  control: { fecha: string; motivo: string | null } | null;
  receta: { lineas: number; dispensadas: number } | null;
  impedimentos: string[];
}
