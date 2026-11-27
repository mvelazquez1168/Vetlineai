import { getStoredToken } from "../hooks/useAuth";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------
// ADMINISTRACIÓN COMPLETA — prompt 11.
//
// Catálogos, personal y turnos, comisiones, cumplimiento, auditoría y
// procedimientos. Aparte de `clinicaApi` (el 04: personas, roles,
// políticas y horario) por el mismo motivo que los routers: son seis
// temas más.
// ---------------------------------------------------------------------

function pedir<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, token: getStoredToken() });
}

function enviar<T>(path: string, metodo: string, cuerpo?: unknown): Promise<T> {
  return pedir<T>(path, {
    method: metodo,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

export interface CatalogoDeclarado {
  clave: string;
  nombre: string;
  grupo: "inventario" | "veterinaria" | "recetas" | "clientes" | "agenda" | "documentos";
  descripcion: string;
  donde: "aqui" | string;
}

export interface ItemCatalogo {
  id: string;
  nombre: string;
  codigo?: string | null;
  padre_id?: string | null;
  orden: number;
  activo: boolean;
}

export interface Turno {
  id: string;
  persona_id: string;
  persona_nombre: string;
  fecha: string;
  hora_desde: string;
  hora_hasta: string;
  tipo: string;
  nota: string | null;
}

export interface Ausencia {
  id: string;
  tipo: string;
  nombre: string;
  desde: string;
  hasta: string;
  medico_id: string | null;
  medico_nombre: string | null;
  estado: string;
  bloquea: boolean;
  citas_afectadas: number;
}

export interface Credencial {
  id: string;
  persona_id: string;
  persona_nombre: string;
  tipo: string;
  numero: string | null;
  emitida_el: string | null;
  vence_el: string | null;
  activo: boolean;
  dias_para_vencer: number | null;
}

export interface PorVencer {
  clase: "credencial" | "permiso";
  id: string;
  titulo: string;
  de_quien: string | null;
  vence_el: string;
  dias_para_vencer: number;
}

export interface ReglaComision {
  id: string;
  persona_id: string | null;
  persona_nombre: string | null;
  servicio_id: string | null;
  servicio_nombre: string | null;
  familia_id: string | null;
  familia_nombre: string | null;
  linea_negocio: string | null;
  rol_en_el_cargo: "realizado" | "referido";
  tipo: "porcentaje" | "monto";
  valor: string;
  base: "cobrado" | "facturado";
  descontar_insumos: boolean;
  vigente_desde: string;
  vigente_hasta: string | null;
  activo: boolean;
}

export interface Liquidacion {
  id: string;
  persona_id: string;
  persona: string;
  desde: string;
  hasta: string;
  estado: "borrador" | "aprobada";
  total: string;
  aprobado_en: string | null;
  aprobado_por: string | null;
  lineas: number;
}

export interface PermisoCumplimiento {
  id: string;
  nombre: string;
  organismo: string | null;
  numero: string | null;
  emitido_el: string | null;
  vence_el: string | null;
  dias_aviso: number;
  responsable: string | null;
  responsable_id: string | null;
  sugerido: boolean;
  fuente_confirmada: string | null;
  activo: boolean;
  dias_para_vencer: number | null;
}

export interface AsientoControlado {
  fecha: string;
  producto: string;
  producto_id: string;
  lote: string | null;
  tipo: string;
  motivo: string;
  cantidad: string;
  paciente: string | null;
  medico: string | null;
}

export interface EventoAuditoria {
  fuente: string;
  tipo: string;
  modulo: string;
  cuando: string;
  quien: string | null;
  quien_id: string | null;
  sobre: string | null;
  entidad_id: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  detalle: string | null;
}

export interface Procedimiento {
  id: string;
  categoria: string;
  titulo: string;
  version: string;
  vigente_desde: string;
  roles: string[];
  exige_lectura: boolean;
  activo: boolean;
  resumen: string | null;
  lecturas: number;
}

export const administracionApi = {
  // --- Catálogos ------------------------------------------------------
  catalogos: () => pedir<{ catalogos: CatalogoDeclarado[] }>("/administracion/catalogos"),
  items: (clave: string, todos = false) =>
    pedir<{ items: ItemCatalogo[] }>(
      `/administracion/catalogos/${clave}${todos ? "?todos=1" : ""}`
    ),
  guardarItem: (
    clave: string,
    datos: { id?: string; nombre: string; codigo?: string; padreId?: string | null; orden?: number }
  ) => enviar<{ id: string }>(`/administracion/catalogos/${clave}`, "POST", datos),
  alternarItem: (clave: string, id: string, activo: boolean) =>
    enviar<{ ok: boolean }>(`/administracion/catalogos/${clave}/${id}/activo`, "POST", { activo }),
  revisarImportacion: (clave: string, filas: Array<Record<string, unknown>>) =>
    enviar<{
      validas: Array<{ fila: number; nombre: string }>;
      conError: Array<{ fila: number; nombre: string; error?: string }>;
    }>(`/administracion/catalogos/${clave}/importar/revisar`, "POST", { filas }),
  importar: (clave: string, filas: Array<Record<string, unknown>>) =>
    enviar<{ cargadas: number; conError: Array<{ fila: number; error?: string }> }>(
      `/administracion/catalogos/${clave}/importar`,
      "POST",
      { filas }
    ),
  urlExportarCatalogo: (clave: string) => `/administracion/catalogos/${clave}/exportar.xlsx`,

  // --- Personal -------------------------------------------------------
  turnos: (desde: string, hasta: string, personaId?: string) =>
    pedir<{ turnos: Turno[] }>(
      `/administracion/turnos?desde=${desde}&hasta=${hasta}${personaId ? `&personaId=${personaId}` : ""}`
    ),
  guardarTurno: (datos: {
    personaId: string;
    fecha: string;
    horaDesde: string;
    horaHasta: string;
    tipo?: string;
    nota?: string;
  }) => enviar<{ id: string }>("/administracion/turnos", "POST", datos),
  borrarTurno: (id: string) => enviar<{ borrado: boolean }>(`/administracion/turnos/${id}`, "DELETE"),
  copiarSemana: (desdeLunes: string, haciaLunes: string) =>
    enviar<{ copiados: number }>("/administracion/turnos/copiar-semana", "POST", {
      desdeLunes,
      haciaLunes,
    }),
  ausencias: () => pedir<{ ausencias: Ausencia[] }>("/administracion/ausencias"),
  pedirAusencia: (datos: {
    personaId?: string;
    tipo: string;
    desde: string;
    hasta: string;
    nota?: string;
    aprobarYa?: boolean;
  }) => enviar<{ id: string; citasAfectadas: number }>("/administracion/ausencias", "POST", datos),
  resolverAusencia: (id: string, aprobar: boolean) =>
    enviar<{ ok: boolean }>(`/administracion/ausencias/${id}/resolver`, "POST", { aprobar }),
  credenciales: () =>
    pedir<{ credenciales: Credencial[]; porVencer: PorVencer[] }>("/administracion/credenciales"),
  guardarCredencial: (datos: {
    id?: string;
    personaId: string;
    tipo: string;
    numero?: string;
    emitidaEl?: string;
    venceEl?: string;
  }) => enviar<{ id: string }>("/administracion/credenciales", "POST", datos),
  urlPlanilla: (desde: string, hasta: string) =>
    `/administracion/planilla.xlsx?desde=${desde}&hasta=${hasta}`,

  // --- Comisiones -----------------------------------------------------
  reglas: () => pedir<{ reglas: ReglaComision[] }>("/administracion/comisiones/reglas"),
  guardarRegla: (datos: {
    id?: string;
    personaId?: string | null;
    servicioId?: string | null;
    familiaId?: string | null;
    lineaNegocio?: string | null;
    rolEnElCargo?: string;
    tipo: string;
    valor: number;
    base?: string;
    descontarInsumos?: boolean;
    activo?: boolean;
  }) => enviar<{ id: string }>("/administracion/comisiones/reglas", "POST", datos),
  liquidaciones: (personaId?: string) =>
    pedir<{ liquidaciones: Liquidacion[]; puedeVerTodas: boolean }>(
      `/administracion/comisiones/liquidaciones${personaId ? `?personaId=${personaId}` : ""}`
    ),
  liquidacion: (id: string) =>
    pedir<{
      liquidacion: Liquidacion;
      lineas: Array<{
        id: string;
        descripcion: string;
        base: string;
        porcentaje: string | null;
        monto: string;
        es_ajuste: boolean;
        motivo: string | null;
      }>;
    }>(`/administracion/comisiones/liquidaciones/${id}`),
  generarBorrador: (personaId: string, desde: string, hasta: string) =>
    enviar<{ id: string; total: number; lineas: number; yaLiquidados: number }>(
      "/administracion/comisiones/borrador",
      "POST",
      { personaId, desde, hasta }
    ),
  ajustar: (id: string, datos: { descripcion: string; monto: number; motivo: string }) =>
    enviar<{ ok: boolean }>(`/administracion/comisiones/liquidaciones/${id}/ajuste`, "POST", datos),
  aprobarLiquidacion: (id: string) =>
    enviar<{ total: number }>(`/administracion/comisiones/liquidaciones/${id}/aprobar`, "POST"),
  ajustesPendientes: (personaId: string) =>
    pedir<{ ajustes: Array<{ cargo_id: string; descripcion: string; monto: string }> }>(
      `/administracion/comisiones/ajustes-pendientes/${personaId}`
    ),
  aplicarAjustes: (id: string, personaId: string) =>
    enviar<{ aplicados: number; monto: number }>(
      `/administracion/comisiones/liquidaciones/${id}/aplicar-ajustes`,
      "POST",
      { personaId }
    ),

  // --- Cumplimiento ---------------------------------------------------
  permisosCumplimiento: () =>
    pedir<{ permisos: PermisoCumplimiento[] }>("/administracion/cumplimiento/permisos"),
  guardarPermisoCumplimiento: (datos: {
    id?: string;
    nombre: string;
    organismo?: string;
    numero?: string;
    emitidoEl?: string;
    venceEl?: string;
    diasAviso?: number;
    responsableId?: string | null;
    fuenteConfirmada?: string;
    activo?: boolean;
  }) => enviar<{ id: string }>("/administracion/cumplimiento/permisos", "POST", datos),
  libroControlados: (desde: string, hasta: string) =>
    pedir<{
      asientos: AsientoControlado[];
      saldos: Array<{ producto: string; lote: string | null; saldo: string }>;
      cierres: Array<{
        id: string;
        desde: string;
        hasta: string;
        firmado_por: string;
        firmado_en: string;
        observaciones: string | null;
      }>;
    }>(`/administracion/controlados/libro?desde=${desde}&hasta=${hasta}`),
  cerrarLibro: (desde: string, hasta: string, observaciones?: string) =>
    enviar<{ id: string; productos: number }>("/administracion/controlados/cerrar", "POST", {
      desde,
      hasta,
      observaciones,
    }),
  desechos: () =>
    pedir<{
      desechos: Array<{
        id: string;
        fecha: string;
        tipo: string;
        peso_kg: string | null;
        volumen_l: string | null;
        gestor: string;
        registrado_por: string | null;
      }>;
    }>("/administracion/desechos"),
  registrarDesecho: (datos: {
    fecha: string;
    tipo: string;
    pesoKg?: number;
    volumenL?: number;
    gestor: string;
    gestorAutorizacion?: string;
  }) => enviar<{ id: string }>("/administracion/desechos", "POST", datos),

  // --- Auditoría ------------------------------------------------------
  auditoria: (filtros: {
    desde?: string;
    hasta?: string;
    personaId?: string;
    modulo?: string;
    tipo?: string;
    entidadId?: string;
  }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
    const s = q.toString();
    return pedir<{
      eventos: EventoAuditoria[];
      tipos: Array<{ tipo: string; modulo: string; cantidad: number }>;
    }>(`/administracion/auditoria${s ? `?${s}` : ""}`);
  },
  urlAuditoriaExcel: (desde: string, hasta: string) =>
    `/administracion/auditoria.xlsx?desde=${desde}&hasta=${hasta}`,

  // --- Documentos y procedimientos ------------------------------------
  plantillas: () =>
    pedir<{
      plantillas: Array<{ id: string; tipo: string; titulo: string; cuerpo: string; activo: boolean }>;
      variables: Array<{ clave: string; descripcion: string }>;
    }>("/administracion/plantillas-documento"),
  guardarPlantilla: (datos: {
    id?: string;
    tipo?: string;
    titulo: string;
    cuerpo: string;
    activo?: boolean;
  }) =>
    enviar<{ id: string; variablesDesconocidas: string[] }>(
      "/administracion/plantillas-documento",
      "POST",
      datos
    ),
  revisarPlantilla: (cuerpo: string) =>
    enviar<{ desconocidas: string[] }>("/administracion/plantillas-documento/revisar", "POST", {
      cuerpo,
    }),
  urlPdfPlantilla: (id: string, pacienteId: string, medicoId?: string) =>
    `/administracion/plantillas-documento/${id}/pdf?pacienteId=${pacienteId}${medicoId ? `&medicoId=${medicoId}` : ""}`,
  procedimientos: (rol?: string) =>
    pedir<{ procedimientos: Procedimiento[] }>(
      `/administracion/procedimientos${rol ? `?rol=${rol}` : ""}`
    ),
  procedimiento: (id: string) =>
    pedir<{
      procedimiento: Record<string, unknown>;
      lecturas: Array<{ persona: string; version: string; leido_en: string }>;
    }>(`/administracion/procedimientos/${id}`),
  guardarProcedimiento: (datos: {
    id?: string;
    categoria: string;
    titulo: string;
    contenido?: string;
    version?: string;
    roles?: string[];
    exigeLectura?: boolean;
    activo?: boolean;
  }) => enviar<{ id: string }>("/administracion/procedimientos", "POST", datos),
  marcarLeido: (id: string) =>
    enviar<{ version: string }>(`/administracion/procedimientos/${id}/leido`, "POST"),
};
