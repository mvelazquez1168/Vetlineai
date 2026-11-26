import { PageHeader } from "../../components/ui";
import { useEffect, useMemo, useState } from "react";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Table, TableColumn } from "../../components/ui/Table";
import { useAuth } from "../../hooks/useAuth";
import {
  ItemListaEspera,
  listarMedicosLigero,
  listaEsperaApi,
  MedicoLigero,
  PrioridadListaEspera,
  Sala,
  salasApi,
} from "../../lib/agendaApi";
import { PacienteDePropietario, Propietario, workspaceApi } from "../../lib/workspaceApi";
import { NuevaCitaModal, PrellenadoCita } from "./NuevaCitaModal";
import { etiqueta } from "../../lib/etiquetas";

const PRIORIDAD_BADGE: Record<PrioridadListaEspera, BadgeVariant> = {
  alta: "error",
  media: "warning",
  baja: "neutral",
};

const ESPECIE_ICONO: Record<string, string> = { Canino: "🐶", Felino: "🐱" };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function diasDesde(fechaISO: string): number {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const [hy, hm, hd] = hoyISO().split("-").map(Number);
  const dt = Date.UTC(y, m - 1, d);
  const hoy = Date.UTC(hy, hm - 1, hd);
  return Math.max(0, Math.round((hoy - dt) / 86400000));
}

export function ListaEspera() {
  const { rol } = useAuth();
  const esAdminClinica = rol === "admin_clinica";

  const [items, setItems] = useState<ItemListaEspera[]>([]);
  const [medicos, setMedicos] = useState<MedicoLigero[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [filtroPrioridad, setFiltroPrioridad] = useState<PrioridadListaEspera | "">("");
  const [filtroEspecie, setFiltroEspecie] = useState<"" | "Canino" | "Felino">("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formAbierto, setFormAbierto] = useState(false);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [prellenado, setPrellenado] = useState<PrellenadoCita | null>(null);

  useEffect(() => {
    listarMedicosLigero(esAdminClinica, null).then(setMedicos);
    salasApi.listar().then((d) => setSalas(d.salas));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargar = () => {
    setCargando(true);
    setError(null);
    listaEsperaApi
      .listar({ prioridad: filtroPrioridad || undefined, especie: filtroEspecie || undefined })
      .then((data) => setItems(data.listaEspera))
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar la lista de espera."))
      .finally(() => setCargando(false));
  };

  useEffect(cargar, [filtroPrioridad, filtroEspecie]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendientes = useMemo(() => items.filter((i) => i.estado === "pendiente"), [items]);

  const abrirAgendar = (item: ItemListaEspera) => {
    setPrellenado({
      pacienteId: item.paciente_id,
      pacienteNombre: `${item.paciente_nombre} (${etiqueta(item.especie)})`,
      propietarioNombre: item.propietario_nombre,
      medicoPreferidoId: item.medico_preferido_id,
      motivo: item.motivo,
      listaEsperaItemId: item.id,
    });
    setModalAbierto(true);
  };

  const columnas: TableColumn<ItemListaEspera>[] = [
    {
      key: "prioridad",
      header: "Prioridad",
      render: (item) => <Badge variant={PRIORIDAD_BADGE[item.prioridad]}>{item.prioridad}</Badge>,
    },
    {
      key: "paciente",
      header: "Paciente",
      render: (item) => (
        <div>
          <p className="font-semibold text-text-primary">
            {ESPECIE_ICONO[item.especie] ?? ""} {item.paciente_nombre}
          </p>
          <p className="text-xs text-text-muted">{item.propietario_nombre}</p>
        </div>
      ),
    },
    { key: "fecha", header: "Fecha solicitada", render: (item) => item.fecha_solicitud },
    { key: "medico", header: "Médico preferido", render: (item) => item.medico_preferido_nombre ?? "Sin preferencia" },
    { key: "motivo", header: "Motivo", render: (item) => <span className="text-sm text-text-primary">{item.motivo}</span> },
    {
      key: "espera",
      header: "Tiempo de espera",
      render: (item) => {
        const dias = diasDesde(item.fecha_solicitud);
        return <span>{dias === 0 ? "Hoy" : `${dias} día${dias === 1 ? "" : "s"}`}</span>;
      },
    },
    {
      key: "acciones",
      header: "Acciones",
      render: (item) => (
        <Button variant="secondary" onClick={() => abrirAgendar(item)} className="text-xs">
          Agendar
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Lista de espera"
        icono="hora"
        modulo="agenda"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => setFormAbierto((v) => !v)}>{formAbierto ? "Cerrar" : "+ Agregar a la lista"}</Button>
      </div>

      {formAbierto && (
        <FormularioNuevoItem
          medicos={medicos}
          onCreado={() => {
            setFormAbierto(false);
            cargar();
          }}
        />
      )}

      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1 rounded-lg border border-black/10 bg-surface p-1">
          {(["", "alta", "media", "baja"] as const).map((p) => (
            <button
              key={p || "todas"}
              onClick={() => setFiltroPrioridad(p)}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-semibold capitalize",
                filtroPrioridad === p ? "bg-primary text-white" : "text-text-muted hover:bg-black/5",
              ].join(" ")}
            >
              {p || "Todas"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-black/10 bg-surface p-1">
          {([
            { value: "", label: "Todas las especies" },
            { value: "Canino", label: "Perros" },
            { value: "Felino", label: "Gatos" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFiltroEspecie(opt.value)}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-semibold",
                filtroEspecie === opt.value ? "bg-primary text-white" : "text-text-muted hover:bg-black/5",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {cargando ? (
        <p className="text-sm text-text-muted">Cargando…</p>
      ) : (
        <Table columns={columnas} data={pendientes} rowKey={(i) => i.id} emptyMessage="No hay pacientes en la lista de espera." />
      )}

      <NuevaCitaModal
        open={modalAbierto}
        onClose={() => setModalAbierto(false)}
        onGuardada={() => {
          setModalAbierto(false);
          cargar();
        }}
        medicos={medicos}
        salas={salas}
        prellenado={prellenado}
      />
    </div>
  );
}

function FormularioNuevoItem({
  medicos,
  onCreado,
}: {
  medicos: MedicoLigero[];
  onCreado: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<Propietario[]>([]);
  const [propietario, setPropietario] = useState<Propietario | null>(null);
  const [pacientes, setPacientes] = useState<PacienteDePropietario[]>([]);
  const [pacienteId, setPacienteId] = useState("");
  const [medicoPreferidoId, setMedicoPreferidoId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [prioridad, setPrioridad] = useState<PrioridadListaEspera>("media");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (propietario) return;
    setBuscando(true);
    const t = setTimeout(() => {
      workspaceApi
        .buscarPropietarios(busqueda)
        .then((d) => setResultados(d.propietarios))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, propietario]);

  const seleccionarPropietario = (p: Propietario) => {
    setPropietario(p);
    setPacienteId("");
    workspaceApi.listarPacientesDePropietario(p.id).then((d) => setPacientes(d.pacientes));
  };

  const guardar = async () => {
    if (!pacienteId || !motivo.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await listaEsperaApi.crear({
        pacienteId,
        medicoPreferidoId: medicoPreferidoId || undefined,
        motivo: motivo.trim(),
        prioridad,
      });
      onCreado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos agregar este ítem.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-surface p-5">
      <p className="text-sm font-bold text-primary">Agregar a la lista de espera</p>

      {!propietario ? (
        <div>
          <input
            className="w-full rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            placeholder="Buscar propietario por nombre, email o teléfono…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-black/10">
            {buscando && <p className="p-3 text-xs text-text-muted">Buscando…</p>}
            {!buscando &&
              resultados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => seleccionarPropietario(p)}
                  className="block w-full border-b border-black/5 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent/5"
                >
                  {p.nombre}
                </button>
              ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-text-muted">
            Propietario: <span className="font-semibold text-primary">{propietario.nombre}</span>{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => setPropietario(null)}>
              cambiar
            </button>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {pacientes.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPacienteId(p.id)}
                className={[
                  "rounded-lg border p-3 text-left text-sm",
                  pacienteId === p.id ? "border-accent bg-accent/5" : "border-black/10 hover:bg-black/5",
                ].join(" ")}
              >
                {p.nombre} <span className="text-xs text-text-muted">({etiqueta(p.especie)})</span>
              </button>
            ))}
          </div>

          <Select
            label="Médico preferido (opcional)"
            value={medicoPreferidoId}
            onChange={(e) => setMedicoPreferidoId(e.target.value)}
            options={[{ value: "", label: "Sin preferencia" }, ...medicos.map((m) => ({ value: m.id, label: m.nombre }))]}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Motivo</label>
            <textarea
              className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>

          <div>
            <p className="text-sm font-semibold text-text-primary">Prioridad</p>
            <div className="mt-1.5 flex gap-2">
              {(["baja", "media", "alta"] as PrioridadListaEspera[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrioridad(p)}
                  className={[
                    "flex-1 rounded-lg border py-2 text-sm font-semibold capitalize",
                    prioridad === p ? "border-accent bg-accent/10 text-accent" : "border-black/10 text-text-muted hover:bg-black/5",
                  ].join(" ")}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <div className="flex justify-end">
            <Button onClick={guardar} disabled={guardando || !pacienteId || !motivo.trim()}>
              {guardando ? "Guardando…" : "Agregar a la lista"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
