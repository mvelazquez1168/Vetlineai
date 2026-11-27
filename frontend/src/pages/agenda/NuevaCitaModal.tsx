import { useEffect, useState } from "react";
import { CapaModal } from "../../components/ui/CapaModal";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { ControlSegmentado } from "../../components/ui";
import { Select } from "../../components/ui/Select";
import { useAuth } from "../../hooks/useAuth";
import {
  FormularioPaciente,
  useFormularioPaciente,
} from "../../components/paciente/FormularioPaciente";
import {
  Cita,
  citasApi,
  CrearCitaInput,
  esFueraDeHorario,
  FueraDeHorario,
  listaEsperaApi,
  MedicoLigero,
  PrioridadCita,
  Sala,
} from "../../lib/agendaApi";
import { clinicaApi, TipoDeCita } from "../../lib/clinicaApi";
import { ApiError } from "../../lib/apiError";
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
  const formMascota = useFormularioPaciente();
  const [creandoMascota, setCreandoMascota] = useState(false);

  const [medicoId, setMedicoId] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [duracion, setDuracion] = useState(30);
  const [prioridad, setPrioridad] = useState<PrioridadCita>("normal");
  const [salaId, setSalaId] = useState("");
  const [motivo, setMotivo] = useState("");

  const [tipoCitaId, setTipoCitaId] = useState("");
  const [tipos, setTipos] = useState<TipoDeCita[]>([]);
  // EL AVISO DE FUERA DE HORARIO y su motivo. Llega del 409 del backend:
  // la pantalla no reimplementa el horario de la clínica —sería una
  // segunda fuente— sino que muestra lo que el backend contestó.
  const [fueraDeHorario, setFueraDeHorario] = useState<FueraDeHorario | null>(null);
  const [motivoExcepcion, setMotivoExcepcion] = useState("");

  const [conflictosDetectados, setConflictosDetectados] = useState<Cita[] | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Los tipos de cita de la clínica. Se cargan al abrir y no al montar:
  // una clínica puede agregar uno mientras la pantalla está abierta.
  useEffect(() => {
    if (!open) return;
    clinicaApi
      .tiposDeCita()
      .then((r) => setTipos(r.tipos))
      // Sin tipos de cita el modal sigue sirviendo: la duración se elige
      // a mano, como antes de que existieran.
      .catch(() => setTipos([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConflictosDetectados(null);
    setFueraDeHorario(null);
    setMotivoExcepcion("");
    setTipoCitaId("");
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
    if (!propietarioSeleccionado || !formMascota.v.nombre.trim()) return;
    setCreandoMascota(true);
    setError(null);
    try {
      const { paciente } = await workspaceApi.crearPaciente({
        propietarioId: propietarioSeleccionado.id,
        nombre: formMascota.v.nombre.trim(),
        especie: formMascota.v.especie,
      });
      setPacientesDelPropietario((prev) => [...prev, paciente]);
      setPacienteId(paciente.id);
      setFormNuevaMascotaAbierto(false);
      formMascota.reiniciar();
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
    tipoCitaId: tipoCitaId || null,
  });

  const formularioValido = !!pacienteId && !!medicoId && !!fecha && !!hora;

  /**
   * Guarda de verdad. `forzando` es el segundo intento, el que lleva el
   * motivo de la excepción después de que el backend avisó.
   */
  const persistir = async (forzando?: { motivo: string }) => {
    setGuardando(true);
    setError(null);
    try {
      const input: CrearCitaInput = forzando
        ? { ...construirInput(), forzarFueraDeHorario: forzando }
        : construirInput();
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
      // EL HORARIO DE LA CLÍNICA (prompt 04, §3). El 409 trae el motivo
      // —«La clínica no abre los domingos», «Navidad: es feriado ese
      // día»—, los bloques del día para proponer otra hora, y si quien
      // está agendando puede autorizar la excepción.
      if (err instanceof ApiError && err.status === 409 && esFueraDeHorario(err.data)) {
        setFueraDeHorario(err.data);
        setConflictosDetectados(null);
        return;
      }
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
    setFueraDeHorario(null);
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
    <CapaModal
      onClose={onClose}
      tipo="formulario"
      // Lo que se pierde al cerrar: el paciente elegido y la fecha y la
      // hora que se hayan tocado. Era el caso del reporte: un clic al
      // costado borraba una cita a medio agendar.
      hayCambios={pacienteId !== "" || fecha !== "" || hora !== ""}
      className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-8 shadow-xl"
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

        {fueraDeHorario ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border-l-4 border-warning bg-warning/10 p-4">
              <p className="text-sm font-bold text-primary">{fueraDeHorario.error}</p>
              {fueraDeHorario.bloquesDelDia && fueraDeHorario.bloquesDelDia.length > 0 && (
                <p className="mt-2 text-sm text-text-primary">
                  Ese día hay turno{" "}
                  {fueraDeHorario.bloquesDelDia
                    .map((b) => `de ${b.desde} a ${b.hasta}`)
                    .join(" y ")}
                  .
                </p>
              )}
              {fueraDeHorario.nivel === "excepcion" && (
                <p className="mt-2 text-xs text-text-muted">
                  Si la clínica trabaja ese día, se desmarca en Configuración de la agenda y deja de
                  bloquear.
                </p>
              )}
            </div>

            {fueraDeHorario.puedeForzar ? (
              <div className="space-y-2">
                <Input
                  label="Motivo de la excepción"
                  placeholder="El cliente viaja mañana, es un control posoperatorio…"
                  value={motivoExcepcion}
                  onChange={(e) => setMotivoExcepcion(e.target.value)}
                />
                <p className="text-xs text-text-muted">
                  Queda registrado con tu nombre: es una excepción a una política de la clínica, no
                  una cita normal.
                </p>
              </div>
            ) : (
              <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
                Para citar fuera del horario hace falta el permiso «Citar fuera de horario o en un
                bloqueo». Pedíselo a un administrador, o elegí una hora dentro del horario.
              </p>
            )}

            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setFueraDeHorario(null)}>
                Elegir otra hora
              </Button>
              {fueraDeHorario.puedeForzar && (
                <Button
                  onClick={() => persistir({ motivo: motivoExcepcion.trim() })}
                  disabled={guardando || motivoExcepcion.trim().length === 0}
                >
                  {guardando ? "Guardando…" : "Agendar igual"}
                </Button>
              )}
            </div>
          </div>
        ) : conflictosDetectados ? (
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
              <Button onClick={() => persistir()} disabled={guardando}>
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
                      {/* EL MISMO FORMULARIO DE PACIENTE DE TODO EL
                          SISTEMA, en modo rápido (anexo 07-03, A5): acá
                          el teléfono está sonando. Lo que cambia es el
                          modo, no los campos, y la ficha queda marcada
                          como «por completar» en el fichero. */}
                      <FormularioPaciente form={formMascota} modo="rapido" deshabilitado={creandoMascota} />
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => setFormNuevaMascotaAbierto(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={crearMascota} disabled={creandoMascota || !formMascota.v.nombre.trim()}>
                          {creandoMascota ? "Guardando…" : "Guardar"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {tipos.length > 0 && (
              <Select
                label="Tipo de cita"
                value={tipoCitaId}
                onChange={(e) => {
                  setTipoCitaId(e.target.value);
                  // La duración del tipo es una sugerencia, no una
                  // imposición: se precarga y se puede cambiar abajo.
                  const t = tipos.find((x) => x.id === e.target.value);
                  if (t) setDuracion(t.duracion_minutos);
                }}
                options={[
                  { value: "", label: "Sin especificar" },
                  ...tipos.map((t) => ({
                    value: t.id,
                    label: `${t.nombre} (${t.duracion_minutos} min)`,
                  })),
                ]}
              />
            )}

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

            <ControlSegmentado
              etiqueta="Duración"
              valor={duracion}
              onCambio={setDuracion}
              opciones={DURACIONES.map((d) => ({ valor: d, etiqueta: `${d} min` }))}
            />

            {/* La prioridad se tiñe con SU color de estado y no con el
                primario: «urgente» en el color de la clínica es un dato
                mas; en rojo es una advertencia, que es lo que es. */}
            <ControlSegmentado
              etiqueta="Prioridad"
              valor={prioridad}
              onCambio={setPrioridad}
              opciones={PRIORIDADES.map((p) => ({
                valor: p.value,
                etiqueta: p.label,
                tono: (p.value === "emergencia"
                  ? "error"
                  : p.value === "alta"
                    ? "aviso"
                    : "primario") as "error" | "aviso" | "primario",
              }))}
            />

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
    </CapaModal>
  );
}
