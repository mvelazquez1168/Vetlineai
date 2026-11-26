import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { KpiCard, PageHeader, TiraIndicadores } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { getStoredToken } from "../../hooks/useAuth";
import { useAuth } from "../../hooks/useAuth";
import {
  Cita,
  citasApi,
  etiquetaEstadoCita,
  listarMedicosLigero,
  MedicoLigero,
  Sala,
  salasApi,
} from "../../lib/agendaApi";
import { workspaceApi } from "../../lib/workspaceApi";
import { CitaDetallePanel } from "./CitaDetallePanel";
import { NuevaCitaModal, PrellenadoCita } from "./NuevaCitaModal";
import { etiqueta } from "../../lib/etiquetas";

type Vista = "dia" | "semana" | "mes";

const PALETA_MEDICOS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-teal-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-indigo-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-orange-500",
];

const HORA_INICIO_GRID = 7;
const HORA_FIN_GRID = 20;
const PX_POR_HORA = 56;
const PX_POR_MINUTO = PX_POR_HORA / 60;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sumarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function diaSemanaISO(fechaISO: string): number {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function inicioDeSemana(fechaISO: string): string {
  const dow = diaSemanaISO(fechaISO);
  return sumarDias(fechaISO, dow === 0 ? -6 : 1 - dow);
}

function formatoCorto(fechaISO: string): string {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

function formatoDiaSemana(fechaISO: string): string {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function horaAMinutos(hhmmss: string): number {
  const [h, m] = hhmmss.split(":").map(Number);
  return h * 60 + m;
}

// Hash simple del medico_id — se usa como color de reserva para un médico
// que no aparece en la lista "medicos" cargada (ver comentario en
// colorMedico más abajo), así ese caso nunca cae en un color fijo
// compartido por todos los no encontrados (el bug original).
function hashColor(medicoId: string): string {
  let hash = 0;
  for (let i = 0; i < medicoId.length; i++) {
    hash = (hash * 31 + medicoId.charCodeAt(i)) >>> 0;
  }
  return PALETA_MEDICOS[hash % PALETA_MEDICOS.length];
}

export function Calendario() {
  // Los tres indicadores salen de `/inicio/indicadores`, la misma
  // consulta agregada del marco: el numero de citas de hoy tiene que
  // ser el mismo que muestra Inicio y que el contador del menu.
  const [indicadores, setIndicadores] = useState<{
    citas_hoy: number;
    citas_por_confirmar: number;
    en_sala_de_espera: number;
  } | null>(null);

  const { rol, user } = useAuth();
  const esAdminClinica = rol === "admin_clinica";

  const [vista, setVista] = useState<Vista>("semana");
  const [fechaBase, setFechaBase] = useState(hoyISO());

  const [medicos, setMedicos] = useState<MedicoLigero[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [medicosVisibles, setMedicosVisibles] = useState<Set<string>>(new Set());
  const [salasVisibles, setSalasVisibles] = useState<Set<string>>(new Set());

  const [citas, setCitas] = useState<Cita[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [citaSeleccionada, setCitaSeleccionada] = useState<Cita | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [citaEnEdicion, setCitaEnEdicion] = useState<Cita | null>(null);
  const [slotPrellenado, setSlotPrellenado] = useState<{ fecha: string; hora: string } | null>(null);

  useEffect(() => {
    apiFetch<{ citas_hoy: number; citas_por_confirmar: number; en_sala_de_espera: number }>(
      "/inicio/indicadores",
      { token: getStoredToken() }
    )
      .then(setIndicadores)
      .catch(() => setIndicadores(null));
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function cargarFiltros() {
      let nombrePropio: string | null = null;
      if (!esAdminClinica) {
        try {
          const me = await workspaceApi.obtenerMe();
          nombrePropio = me.persona?.persona_nombre ?? null;
        } catch {
          nombrePropio = null;
        }
      }
      const [listaMedicos, salasData] = await Promise.all([
        listarMedicosLigero(esAdminClinica, user ? { id: user.userId, nombre: nombrePropio ? `${nombrePropio} (usted)` : "Usted" } : null),
        salasApi.listar(),
      ]);
      if (cancelado) return;
      setMedicos(listaMedicos);
      setMedicosVisibles(new Set(listaMedicos.map((m) => m.id)));
      setSalas(salasData.salas);
      setSalasVisibles(new Set(salasData.salas.map((s) => s.id)));
    }
    cargarFiltros();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dias = useMemo(() => {
    if (vista === "dia") return [fechaBase];
    if (vista === "semana") {
      const lunes = inicioDeSemana(fechaBase);
      return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
    }
    return [];
  }, [vista, fechaBase]);

  const cargarCitas = () => {
    if (dias.length === 0) return;
    setCargando(true);
    setError(null);
    citasApi
      .listar({ desde: dias[0], hasta: dias[dias.length - 1] })
      .then((data) => setCitas(data.citas))
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar las citas."))
      .finally(() => setCargando(false));
  };

  useEffect(cargarCitas, [dias.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const citasVisibles = useMemo(
    () =>
      citas.filter(
        (c) => medicosVisibles.has(c.medico_id) && (!c.sala_id || salasVisibles.has(c.sala_id))
      ),
    [citas, medicosVisibles, salasVisibles]
  );

  // Color por médico: dentro de la lista "medicos" cargada (siempre
  // ordenada alfabéticamente, ver listarMedicosLigero en agendaApi.ts) se
  // asigna por índice fijo — esto garantiza cero colisiones entre los
  // médicos visibles mientras la paleta tenga más colores que médicos, y
  // es estable entre recargas porque el orden alfabético no cambia. Si el
  // medico_id no está en esa lista (rol médico ve una lista incompleta,
  // ver comentario en agendaApi.ts), se usa un color de reserva por hash
  // en vez de un default fijo compartido — así nunca colapsa a "el mismo
  // azul" para médicos distintos.
  const colorMedico = (medicoId: string): string => {
    const idx = medicos.findIndex((m) => m.id === medicoId);
    return idx >= 0 ? PALETA_MEDICOS[idx % PALETA_MEDICOS.length] : hashColor(medicoId);
  };

  const toggleMedico = (id: string) => {
    setMedicosVisibles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSala = (id: string) => {
    setSalasVisibles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const navegar = (direccion: -1 | 1) => {
    const salto = vista === "dia" ? 1 : 7;
    setFechaBase((prev) => sumarDias(prev, salto * direccion));
  };

  const abrirNuevaCita = (fecha?: string, hora?: string) => {
    setCitaEnEdicion(null);
    setSlotPrellenado(fecha && hora ? { fecha, hora } : null);
    setModalAbierto(true);
  };

  const abrirEdicion = (cita: Cita) => {
    setCitaSeleccionada(null);
    setCitaEnEdicion(cita);
    setSlotPrellenado(null);
    setModalAbierto(true);
  };

  const alGuardarCita = (_cita: Cita) => {
    cargarCitas();
  };

  const prellenadoModal: PrellenadoCita | undefined = undefined;

  // Grilla desktop: columnas por día, bloques posicionados por
  // hora_inicio/duracion_minutos dentro de una franja fija
  // (HORA_INICIO_GRID–HORA_FIN_GRID) — no hay vista Mes completa todavía,
  // queda como placeholder simple según lo acordado en el prompt.
  const horasGrid = Array.from({ length: HORA_FIN_GRID - HORA_INICIO_GRID }, (_, i) => HORA_INICIO_GRID + i);
  const alturaGrid = (HORA_FIN_GRID - HORA_INICIO_GRID) * PX_POR_HORA;

  return (
    <div className="flex flex-col gap-6">
      {/* «Confirmadas por WhatsApp» NO esta: el canal de WhatsApp sigue
          con el proveedor simulado (prompt 03) y no ha confirmado una
          sola cita. Un indicador que siempre dice cero ensena a ignorar
          los numeros. Queda dicho en el informe. */}
      <PageHeader
        titulo="Calendario"
        icono="cita"
        modulo="agenda"
        accion={<Button onClick={() => abrirNuevaCita()}>+ Nueva Cita</Button>}
        indicadores={
          indicadores && (
            <TiraIndicadores>
              <KpiCard
                titulo="Citas de hoy"
                valor={String(indicadores.citas_hoy)}
                icono="cita"
                modulo="agenda"
                variacionPorcentaje={null}
                detalle={
                  indicadores.citas_por_confirmar > 0
                    ? `${indicadores.citas_por_confirmar} sin confirmar`
                    : "Todas confirmadas"
                }
              />
              <KpiCard
                titulo="En sala de espera"
                valor={String(indicadores.en_sala_de_espera)}
                icono="hora"
                modulo="agenda"
                estado={indicadores.en_sala_de_espera > 0 ? "aviso" : undefined}
                variacionPorcentaje={null}
                detalle="Llegaron y todavía no entran a consulta"
              />
            </TiraIndicadores>
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-black/10 bg-surface p-1">
            {(["dia", "semana", "mes"] as Vista[]).map((v) => (
              <button
                key={v}
                onClick={() => setVista(v)}
                className={[
                  "rounded-md px-3 py-1.5 text-xs font-semibold capitalize",
                  vista === v ? "bg-primary text-white" : "text-text-muted hover:bg-black/5",
                ].join(" ")}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => navegar(-1)} className="rounded-lg px-2 py-1 text-text-muted hover:bg-black/5" aria-label="Anterior">
              ‹
            </button>
            <button onClick={() => setFechaBase(hoyISO())} className="rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/5">
              Hoy
            </button>
            <button onClick={() => navegar(1)} className="rounded-lg px-2 py-1 text-text-muted hover:bg-black/5" aria-label="Siguiente">
              ›
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        {/* Panel lateral: filtros de médicos/salas */}
        <aside className="hidden flex-col gap-6 lg:flex">
          <div className="rounded-2xl border border-black/5 bg-surface p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">Médicos</p>
            <div className="mt-3 flex flex-col gap-2">
              {medicos.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={medicosVisibles.has(m.id)} onChange={() => toggleMedico(m.id)} />
                  <span className={["h-2.5 w-2.5 rounded-full", colorMedico(m.id)].join(" ")} />
                  <span className="text-text-primary">{m.nombre}</span>
                </label>
              ))}
              {medicos.length === 0 && <p className="text-xs text-text-muted">Sin médicos configurados.</p>}
            </div>
          </div>
          <div className="rounded-2xl border border-black/5 bg-surface p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">Salas</p>
            <div className="mt-3 flex flex-col gap-2">
              {salas.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={salasVisibles.has(s.id)} onChange={() => toggleSala(s.id)} />
                  <span className="text-text-primary">{s.nombre}</span>
                </label>
              ))}
              {salas.length === 0 && <p className="text-xs text-text-muted">Sin salas configuradas.</p>}
            </div>
          </div>
        </aside>

        <div>
          {error && <p className="mb-4 text-sm text-error">{error}</p>}

          {vista === "mes" ? (
            <div className="rounded-2xl border border-black/5 bg-surface p-8 text-center text-sm text-text-muted">
              La vista de Mes está pendiente para una próxima fase — usá Día o Semana mientras tanto.
            </div>
          ) : (
            <>
              {/* Desktop / tablet: grilla con columnas por día */}
              <div className="hidden overflow-x-auto rounded-2xl border border-black/5 bg-surface sm:block">
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `56px repeat(${dias.length}, minmax(140px, 1fr))` }}
                >
                  <div className="border-b border-r border-black/5" />
                  {dias.map((dia) => (
                    <div key={dia} className="border-b border-l border-black/5 px-2 py-2 text-center">
                      <p className="text-xs font-semibold uppercase text-text-muted">{formatoDiaSemana(dia)}</p>
                      <p className={["text-sm font-bold", dia === hoyISO() ? "text-accent" : "text-primary"].join(" ")}>
                        {formatoCorto(dia)}
                      </p>
                    </div>
                  ))}

                  <div className="relative border-r border-black/5" style={{ height: alturaGrid }}>
                    {horasGrid.map((h) => (
                      <div
                        key={h}
                        className="absolute right-1 -translate-y-2 text-right text-xs text-text-muted"
                        style={{ top: (h - HORA_INICIO_GRID) * PX_POR_HORA }}
                      >
                        {pad(h)}:00
                      </div>
                    ))}
                  </div>

                  {dias.map((dia) => {
                    const citasDelDia = citasVisibles.filter((c) => c.fecha === dia);
                    return (
                      <div
                        key={dia}
                        className="relative cursor-pointer border-l border-black/5"
                        style={{ height: alturaGrid }}
                        onClick={(e) => {
                          if (e.target !== e.currentTarget) return;
                          const rect = (e.target as HTMLElement).getBoundingClientRect();
                          const y = e.clientY - rect.top;
                          const minutos = HORA_INICIO_GRID * 60 + y / PX_POR_MINUTO;
                          const horaClic = `${pad(Math.floor(minutos / 60))}:${pad(Math.round((minutos % 60) / 15) * 15 === 60 ? 0 : Math.round((minutos % 60) / 15) * 15)}`;
                          abrirNuevaCita(dia, horaClic);
                        }}
                      >
                        {horasGrid.map((h) => (
                          <div
                            key={h}
                            className="absolute inset-x-0 border-t border-black/5"
                            style={{ top: (h - HORA_INICIO_GRID) * PX_POR_HORA }}
                          />
                        ))}
                        {citasDelDia.map((cita) => {
                          const inicio = horaAMinutos(cita.hora_inicio);
                          const top = Math.max(0, (inicio - HORA_INICIO_GRID * 60) * PX_POR_MINUTO);
                          const alto = Math.max(20, cita.duracion_minutos * PX_POR_MINUTO - 2);
                          return (
                            <button
                              key={cita.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCitaSeleccionada(cita);
                              }}
                              className={[
                                "absolute inset-x-1 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight text-white shadow-sm",
                                colorMedico(cita.medico_id),
                                cita.estado === "cancelada" || cita.estado === "no_show" ? "opacity-40" : "",
                              ].join(" ")}
                              style={{ top, height: alto }}
                            >
                              <p className="truncate font-semibold">
                                {cita.paciente_nombre} · {etiqueta(cita.especie)}
                              </p>
                              <p className="truncate">
                                {cita.hora_inicio.slice(0, 5)} · {iniciales(cita.medico_nombre)}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Móvil: tira de días + tarjetas apiladas */}
              <div className="sm:hidden">
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {(vista === "semana" ? dias : Array.from({ length: 7 }, (_, i) => sumarDias(inicioDeSemana(fechaBase), i))).map(
                    (dia) => (
                      <button
                        key={dia}
                        onClick={() => {
                          setVista("dia");
                          setFechaBase(dia);
                        }}
                        className={[
                          "flex min-w-[52px] flex-col items-center rounded-xl border px-2 py-2",
                          dia === fechaBase ? "border-accent bg-accent/10" : "border-black/10 bg-surface",
                        ].join(" ")}
                      >
                        <span className="text-[10px] uppercase text-text-muted">{formatoDiaSemana(dia)}</span>
                        <span className="text-sm font-bold text-primary">{dia.slice(-2)}</span>
                      </button>
                    )
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  {citasVisibles
                    .filter((c) => c.fecha === fechaBase)
                    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
                    .map((cita) => (
                      <button
                        key={cita.id}
                        onClick={() => setCitaSeleccionada(cita)}
                        className="flex items-center gap-3 rounded-2xl border border-black/5 bg-surface p-4 text-left shadow-sm"
                      >
                        <span className={["h-full w-1.5 self-stretch rounded-full", colorMedico(cita.medico_id)].join(" ")} />
                        <div className="flex-1">
                          <p className="text-sm font-bold text-primary">
                            {cita.hora_inicio.slice(0, 5)} — {cita.paciente_nombre}
                          </p>
                          <p className="text-xs text-text-muted">
                            {cita.medico_nombre} · {etiqueta(cita.especie)}
                          </p>
                        </div>
                        <Badge variant="info">{etiquetaEstadoCita(cita.estado)}</Badge>
                      </button>
                    ))}
                  {citasVisibles.filter((c) => c.fecha === fechaBase).length === 0 && (
                    <p className="py-8 text-center text-sm text-text-muted">Sin citas para este día.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {cargando && <p className="mt-4 text-center text-sm text-text-muted">Cargando citas…</p>}
        </div>
      </div>

      <CitaDetallePanel
        cita={citaSeleccionada}
        onClose={() => setCitaSeleccionada(null)}
        onEditar={() => citaSeleccionada && abrirEdicion(citaSeleccionada)}
        onActualizada={(cita) => {
          setCitaSeleccionada(cita);
          cargarCitas();
        }}
      />

      <NuevaCitaModal
        open={modalAbierto}
        onClose={() => setModalAbierto(false)}
        onGuardada={alGuardarCita}
        medicos={medicos}
        salas={salas}
        prellenado={prellenadoModal}
        citaExistente={citaEnEdicion}
        fechaInicial={slotPrellenado?.fecha}
        horaInicial={slotPrellenado?.hora}
      />
    </div>
  );
}

function iniciales(nombre?: string): string {
  if (!nombre) return "";
  return nombre
    .replace(/^Dr\.?a?\.?\s+/i, "")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
