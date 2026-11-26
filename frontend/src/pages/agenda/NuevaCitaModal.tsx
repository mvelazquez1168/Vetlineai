import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { useAuth } from "../../hooks/useAuth";
import {
  Cita,
  citasApi,
  CrearCitaInput,
  listaEsperaApi,
  MedicoLigero,
  PrioridadCita,
  Sala,
} from "../../lib/agendaApi";
import { PacienteDePropietario, Propietario, workspaceApi } from "../../lib/workspaceApi";
import { etiqueta } from "../../lib/etiquetas";

export interface PrellenadoCita {
  pacienteId: string;
  pacienteNombre: string;
  propietarioNombre: string;
  medicoPreferidoId?: string | null;
  motivo?: string;
  // Si viene, al guardar se llama a listaEsperaApi.agendar en vez de
  // citasApi.crear, para vincular y marcar 'agendada' ese ítem.
  listaEsperaItemId?: string;
}

export interface NuevaCitaModalProps {
  open: boolean;
  onClose: () => void;
  onGuardada: (cita: Cita) => void;
  medicos: MedicoLigero[];
  salas: Sala[];
  prellenado?: PrellenadoCita | null;
  citaExistente?: Cita | null;
  fechaInicial?: string;
  horaInicial?: string;
}

const DURACIONES = [15, 30, 45, 60];
const PRIORIDADES: { value: PrioridadCita; label: string }[] = [
  { value: "baja", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "emergencia", label: "Emergencia" },
];

function horaAMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Modal propio (no el Modal genérico) por el mismo motivo que el wizard
// de "Nuevo Caso" en CasoWorkspace.tsx: demasiados campos para max-w-md.
// Sirve tanto para crear como para editar (citaExistente) y para agendar
// un ítem de lista de espera (prellenado.listaEsperaItemId).
export function NuevaCitaModal({
  open,
  onClose,
  onGuardada,
  medicos,
  salas,
  prellenado,
  citaExistente,
  fechaInicial,
  horaInicial,
}: NuevaCitaModalProps) {
  const { rol, user } = useAuth();
  const esMedico = rol === "medico";
  const editando = !!citaExistente;
  // Con cita existente o con un ítem de lista de espera ya viene el
  // paciente resuelto — no hace falta (ni conviene) reabrir la búsqueda.
  const pacienteFijo = editando || !!prellenado;

  const [pacienteId, setPacienteId] = useState("");
  const [pacienteLabel, setPacienteLabel] = useState("");
  const [busquedaPropietario, setBusquedaPropietario] = useState("");
  const [buscandoPropietarios, setBuscandoPropietarios] = useState(false);
  const [resultadosPropietarios, setResultadosPropietarios] = useState<Propietario[]>([]);
  const [propietarioSeleccionado, setPropietarioSeleccionado] = useState<Propietario | null>(null);
  const [pacientesDelPropietario, setPacientesDelPropietario] = useState<PacienteDePropietario[]>([]);
  const [cargandoPacientes, setCargandoPacientes] = useState(false);
  const [formNuevaMascotaAbierto, setFormNuevaMascotaAbierto] = useState(false);
  const [nuevaMascota, setNuevaMascota] = useState({ nombre: "", especie: "Canino" });
  const [creandoMascota, setCreandoMascota] = useState(false);

  const [medicoId, setMedicoId] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [duracion, setDuracion] = useState(30);
  const [prioridad, setPrioridad] = useState<PrioridadCita>("normal");
  const [salaId, setSalaId] = useState("");
  const [motivo, setMotivo] = useState("");

  const [conflictosDetectados, setConflictosDetectados] = useState<Cita[] | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConflictosDetectados(null);
    setPropietarioSeleccionado(null);
    setPacientesDelPropietario([]);
    setBusquedaPropietario("");
    setResultadosPropietarios([]);
    setFormNuevaMascotaAbierto(false);

    if (citaExistente) {
      setPacienteId(citaExistente.paciente_id);
      setPacienteLabel(
        [citaExistente.paciente_nombre, citaExistente.propietario_nombre].filter(Boolean).join(" — ")
      );
      setMedicoId(citaExistente.medico_id);
      setFecha(citaExistente.fecha);
      setHora(citaExistente.hora_inicio.slice(0, 5));
      setDuracion(citaExistente.duracion_minutos);
      setPrioridad(citaExistente.prioridad);
      setSalaId(citaExistente.sala_id ?? "");
      setMotivo(citaExistente.motivo_consulta ?? "");
    } else if (prellenado) {
      setPacienteId(prellenado.pacienteId);
      setPacienteLabel(`${prellenado.pacienteNombre} — ${prellenado.propietarioNombre}`);
      setMedicoId(prellenado.medicoPreferidoId || (esMedico && user ? user.userId : ""));
      setFecha(fechaInicial ?? "");
      setHora(horaInicial ?? "");
      setDuracion(30);
      setPrioridad("normal");
      setSalaId("");
      setMotivo(prellenado.motivo ?? "");
    } else {
      setPacienteId("");
      setPacienteLabel("");
      setMedicoId(esMedico && user ? user.userId : "");
      setFecha(fechaInicial ?? "");
      setHora(horaInicial ?? "");
      setDuracion(30);
      setPrioridad("normal");
      setSalaId("");
      setMotivo("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, citaExistente, prellenado, fechaInicial, horaInicial]);

  // Autocompletado de propietario ~300ms, solo cuando aplica: sin
  // paciente ya fijo. GET /propietarios/buscar era medico-only en el
  // backend hasta el fix de permisos (ver
  // prompt_fix_agenda_permisos_paciente.md) — ahora también admin_clinica,
  // que es cualquiera que llegue a esta pantalla dado el ProtectedRoute
  // de /agenda, así que ya no hace falta gatear esto por rol acá.
  useEffect(() => {
    if (!open || pacienteFijo) return;
    setBuscandoPropietarios(true);
    const timer = setTimeout(() => {
      workspaceApi
        .buscarPropietarios(busquedaPropietario)
        .then((data) => setResultadosPropietarios(data.propietarios))
        .finally(() => setBuscandoPropietarios(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [busquedaPropietario, open, pacienteFijo]);

  if (!open) return null;

  const seleccionarPropietario = (p: Propietario) => {
    setPropietarioSeleccionado(p);
    setPacienteId("");
    setCargandoPacientes(true);
    workspaceApi
      .listarPacientesDePropietario(p.id)
      .then((data) => setPacientesDelPropietario(data.pacientes))
      .finally(() => setCargandoPacientes(false));
  };

  const crearMascota = async () => {
    if (!propietarioSeleccionado || !nuevaMascota.nombre.trim()) return;
    setCreandoMascota(true);
    setError(null);
    try {
      const { paciente } = await workspaceApi.crearPaciente({
        propietarioId: propietarioSeleccionado.id,
        nombre: nuevaMascota.nombre.trim(),
        especie: nuevaMascota.especie,
      });
      setPacientesDelPropietario((prev) => [...prev, paciente]);
      setPacienteId(paciente.id);
      setFormNuevaMascotaAbierto(false);
      setNuevaMascota({ nombre: "", especie: "Canino" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos registrar la mascota.");
    } finally {
      setCreandoMascota(false);
    }
  };

  const construirInput = (): CrearCitaInput => ({
    pacienteId,
    medicoId,
    salaId: salaId || null,
    fecha,
    horaInicio: hora,
    duracionMinutos: duracion,
    prioridad,
    motivoConsulta: motivo.trim() || undefined,
  });

  const formularioValido = !!pacienteId && !!medicoId && !!fecha && !!hora;

  const persistir = async () => {
    setGuardando(true);
    setError(null);
    try {
      const input = construirInput();
      let cita: Cita;
      if (editando && citaExistente) {
        cita = (await citasApi.editar(citaExistente.id, input)).cita;
      } else if (prellenado?.listaEsperaItemId) {
        cita = (await listaEsperaApi.agendar(prellenado.listaEsperaItemId, input)).cita;
      } else {
        cita = (await citasApi.crear(input)).cita;
      }
      onGuardada(cita);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la cita.");
    } finally {
      setGuardando(false);
    }
  };

  // El backend nunca bloquea por conflicto (POST/PUT /citas inserta e
  // informa después) — para avisar ANTES de confirmar como pide el
  // prompt, se re-deriva acá el mismo chequeo de solapamiento que usa
  // buscarConflictos() en citas.routes.ts, contra los datos ya
  // persistidos, antes de llamar a guardar.
  const guardar = async () => {
    if (!formularioValido) return;
    setError(null);
    setVerificando(true);
    try {
      const { citas } = await citasApi.listar({ desde: fecha, hasta: fecha });
      const inicioMin = horaAMinutos(hora);
      const finMin = inicioMin + duracion;
      const solapadas = citas.filter((c) => {
        if (editando && citaExistente && c.id === citaExistente.id) return false;
        if (c.estado === "cancelada" || c.estado === "no_show") return false;
        const mismoRecurso = c.medico_id === medicoId || (!!salaId && c.sala_id === salaId);
        if (!mismoRecurso) return false;
        const cInicio = horaAMinutos(c.hora_inicio);
        const cFin = horaAMinutos(c.hora_fin);
        return cInicio < finMin && cFin > inicioMin;
      });
      if (solapadas.length > 0) {
        setConflictosDetectados(solapadas);
        return;
      }
      await persistir();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos verificar conflictos de horario.");
    } finally {
      setVerificando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* El encabezado queda PEGADO arriba (prompt 01c, seccion 4): la
            caja entera tiene scroll, asi que sin esto el titulo y la X
            se iban hacia arriba al bajar en el formulario y el modal
            quedaba sin forma visible de cerrarse. Los margenes
            negativos compensan el padding de la caja. */}
        <div className="sticky top-0 z-10 -mx-8 -mt-8 flex items-center justify-between bg-surface px-8 pb-3 pt-8">
          <h2 className="pr-3 text-xl font-bold text-primary">
            {editando ? "Editar Cita" : "Nueva Cita"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg px-2 py-1 text-lg text-text-muted hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        {conflictosDetectados ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border-l-4 border-warning bg-warning/10 p-4">
              <p className="text-sm font-bold text-primary">
                Este horario se superpone con{" "}
                {conflictosDetectados.length === 1 ? "otra cita" : `${conflictosDetectados.length} citas`}:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-text-primary">
                {conflictosDetectados.map((c) => (
                  <li key={c.id}>
                    {c.paciente_nombre} con {c.medico_nombre} — {c.hora_inicio.slice(0, 5)} a{" "}
                    {c.hora_fin.slice(0, 5)}
                    {c.sala_nombre ? ` (sala ${c.sala_nombre})` : ""}
                  </li>
                ))}
              </ul>
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConflictosDetectados(null)}>
                Ajustar horario
              </Button>
              <Button onClick={persistir} disabled={guardando}>
                {guardando ? "Guardando…" : "Confirmar igual"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div>
              <p className="text-sm font-semibold text-text-primary">Paciente</p>
              {pacienteFijo ? (
                <p className="mt-1.5 rounded-lg bg-background px-4 py-2.5 text-sm text-text-primary">
                  {pacienteLabel || "—"}
                </p>
              ) : !propietarioSeleccionado ? (
                <div className="mt-1.5">
                  <input
                    className="w-full rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    placeholder="Buscar propietario por nombre, email o teléfono…"
                    value={busquedaPropietario}
                    onChange={(e) => setBusquedaPropietario(e.target.value)}
                  />
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-black/10">
                    {buscandoPropietarios && <p className="p-3 text-xs text-text-muted">Buscando…</p>}
                    {!buscandoPropietarios && resultadosPropietarios.length === 0 && (
                      <p className="p-3 text-xs text-text-muted">Sin resultados.</p>
                    )}
                    {!buscandoPropietarios &&
                      resultadosPropietarios.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => seleccionarPropietario(p)}
                          className="block w-full border-b border-black/5 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent/5"
                        >
                          <span className="font-semibold text-primary">{p.nombre}</span>
                          <span className="ml-2 text-xs text-text-muted">
                            {[p.email, p.telefono].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 space-y-2">
                  <p className="text-xs text-text-muted">
                    Propietario: <span className="font-semibold text-primary">{propietarioSeleccionado.nombre}</span>{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setPropietarioSeleccionado(null);
                        setPacienteId("");
                      }}
                      className="text-accent hover:underline"
                    >
                      cambiar
                    </button>
                  </p>
                  {cargandoPacientes ? (
                    <p className="text-sm text-text-muted">Cargando mascotas…</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {pacientesDelPropietario.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPacienteId(p.id)}
                          className={[
                            "rounded-lg border p-3 text-left text-sm",
                            pacienteId === p.id ? "border-accent bg-accent/5" : "border-black/10 hover:bg-black/5",
                          ].join(" ")}
                        >
                          <p className="font-semibold text-primary">{p.nombre}</p>
                          <p className="text-xs text-text-muted">
                            {etiqueta(p.especie)}
                            {p.raza ? `, ${p.raza}` : ""}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                  {!formNuevaMascotaAbierto ? (
                    <button
                      type="button"
                      onClick={() => setFormNuevaMascotaAbierto(true)}
                      className="w-full rounded-lg border border-dashed border-black/20 py-2 text-xs font-semibold text-text-muted hover:bg-black/5"
                    >
                      + Registrar nueva mascota
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-3">
                      <Input
                        placeholder="Nombre de la mascota"
                        value={nuevaMascota.nombre}
                        onChange={(e) => setNuevaMascota((prev) => ({ ...prev, nombre: e.target.value }))}
                      />
                      <Select
                        options={[
                          { value: "Canino", label: "Canino" },
                          { value: "Felino", label: "Felino" },
                        ]}
                        value={nuevaMascota.especie}
                        onChange={(e) => setNuevaMascota((prev) => ({ ...prev, especie: e.target.value }))}
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => setFormNuevaMascotaAbierto(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={crearMascota} disabled={creandoMascota || !nuevaMascota.nombre.trim()}>
                          {creandoMascota ? "Guardando…" : "Guardar"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Select
              label="Veterinario"
              value={medicoId}
              onChange={(e) => setMedicoId(e.target.value)}
              options={[{ value: "", label: "Seleccionar…" }, ...medicos.map((m) => ({ value: m.id, label: m.nombre }))]}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              <Input label="Hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>

            <div>
              <p className="text-sm font-semibold text-text-primary">Duración</p>
              <div className="mt-1.5 flex gap-2">
                {DURACIONES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuracion(d)}
                    className={[
                      "flex-1 rounded-lg border py-2 text-sm font-semibold",
                      duracion === d ? "border-accent bg-accent/10 text-accent" : "border-black/10 text-text-muted hover:bg-black/5",
                    ].join(" ")}
                  >
                    {d}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-text-primary">Prioridad</p>
              <div className="mt-1.5 flex gap-2">
                {PRIORIDADES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPrioridad(p.value)}
                    className={[
                      "flex-1 rounded-lg border py-2 text-sm font-semibold",
                      prioridad === p.value ? "border-accent bg-accent/10 text-accent" : "border-black/10 text-text-muted hover:bg-black/5",
                    ].join(" ")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <Select
              label="Sala"
              value={salaId}
              onChange={(e) => setSalaId(e.target.value)}
              options={[{ value: "", label: "Sin sala asignada" }, ...salas.map((s) => ({ value: s.id, label: s.nombre }))]}
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">Motivo de consulta</label>
              <textarea
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={!formularioValido || verificando || guardando}>
                {verificando ? "Verificando…" : guardando ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
