import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Table, TableColumn } from "../../components/ui/Table";
import { useAuth } from "../../hooks/useAuth";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { AgenteAdmin, CasoAdmin, Medico, MedicoDisponible, adminApi } from "../../lib/adminApi";

const ESTADO_BADGE: Record<string, BadgeVariant> = {
  triage: "neutral",
  en_curso: "warning",
  completado: "success",
};

const ESTADO_LABEL: Record<string, string> = {
  triage: "Triage",
  en_curso: "En curso",
  completado: "Completado",
};

const ESTADO_OPTIONS = [
  { value: "", label: "Todos los estados" },
  { value: "triage", label: "Triage" },
  { value: "en_curso", label: "En curso" },
  { value: "completado", label: "Completado" },
];

export function Casos() {
  const { zonaHoraria } = useAuth();
  const navigate = useNavigate();

  const [casos, setCasos] = useState<CasoAdmin[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [agentes, setAgentes] = useState<AgenteAdmin[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const [buscarPaciente, setBuscarPaciente] = useState("");
  const [numeroExpediente, setNumeroExpediente] = useState("");
  const [medicoId, setMedicoId] = useState("");
  const [estado, setEstado] = useState("");
  const [agenteId, setAgenteId] = useState("");

  // Modal de reasignación.
  const [casoAReasignar, setCasoAReasignar] = useState<CasoAdmin | null>(null);
  const [medicosDisponibles, setMedicosDisponibles] = useState<MedicoDisponible[]>([]);
  const [cargandoMedicosDisponibles, setCargandoMedicosDisponibles] = useState(false);
  const [nuevoMedicoAgenteId, setNuevoMedicoAgenteId] = useState("");
  const [motivoReasignacion, setMotivoReasignacion] = useState("");
  const [reasignando, setReasignando] = useState(false);
  const [errorReasignacion, setErrorReasignacion] = useState<string | null>(null);

  useEffect(() => {
    adminApi.listarMedicos().then((data) => setMedicos(data.medicos));
    adminApi.listarAgentes().then((data) => setAgentes(data.agentes));
  }, []);

  const cargar = () => {
    setIsLoading(true);
    adminApi
      .listarCasos({ medicoId, estado, agenteId, buscarPaciente, numeroExpediente, pagina })
      .then((data) => {
        setCasos(data.casos);
        setTotal(data.total);
        setTotalPaginas(data.totalPaginas);
      })
      .finally(() => setIsLoading(false));
  };

  // Debounce de ~300ms para la búsqueda por texto — el resto de los
  // filtros (selects) disparan la carga de inmediato.
  useEffect(() => {
    const timer = setTimeout(cargar, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscarPaciente, numeroExpediente, medicoId, estado, agenteId, pagina]);

  const actualizarFiltro = (setter: (v: string) => void) => (valor: string) => {
    setter(valor);
    setPagina(1);
  };

  const abrirReasignar = async (caso: CasoAdmin) => {
    setCasoAReasignar(caso);
    setNuevoMedicoAgenteId("");
    setMotivoReasignacion("");
    setErrorReasignacion(null);
    setCargandoMedicosDisponibles(true);
    try {
      const { medicos: disponibles } = await adminApi.obtenerMedicosDisponibles(caso.id);
      setMedicosDisponibles(disponibles);
    } finally {
      setCargandoMedicosDisponibles(false);
    }
  };

  const confirmarReasignacion = async () => {
    if (!casoAReasignar || !nuevoMedicoAgenteId) return;
    setReasignando(true);
    setErrorReasignacion(null);
    try {
      await adminApi.reasignarCaso(casoAReasignar.id, {
        nuevoMedicoAgenteId,
        motivo: motivoReasignacion.trim() || undefined,
      });
      setCasoAReasignar(null);
      cargar();
    } catch (err: any) {
      setErrorReasignacion(err?.message ?? "No pudimos reasignar el caso.");
    } finally {
      setReasignando(false);
    }
  };

  const columns: TableColumn<CasoAdmin>[] = [
    {
      key: "expediente",
      header: "Expediente",
      render: (c) => <span className="font-mono text-sm text-text-muted">N.º {c.numero_expediente}</span>,
    },
    {
      key: "paciente",
      header: "Paciente",
      render: (c) => (
        <div>
          <p className="font-semibold text-primary">{c.paciente_nombre}</p>
          <p className="text-xs text-text-muted">
            {c.especie}
            {c.raza ? ` · ${c.raza}` : ""}
          </p>
        </div>
      ),
    },
    { key: "medico", header: "Médico", render: (c) => c.medico_nombre },
    { key: "agente", header: "Agente", render: (c) => c.agente_nombre },
    {
      key: "estado",
      header: "Estado",
      render: (c) => (
        <Badge variant={ESTADO_BADGE[c.estado] ?? "neutral"}>{ESTADO_LABEL[c.estado] ?? c.estado}</Badge>
      ),
    },
    {
      key: "fecha",
      header: "Fecha apertura",
      render: (c) => formatearFechaCorta(c.creado_en, zonaHoraria),
    },
    {
      key: "acciones",
      header: "Acciones",
      render: (c) => (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/admin/casos/${c.id}`)}
            title="Ver caso"
            aria-label="Ver caso"
            className="text-text-muted hover:text-accent"
          >
            👁
          </button>
          <button
            type="button"
            onClick={() => abrirReasignar(c)}
            title="Reasignar a otro médico"
            aria-label="Reasignar a otro médico"
            className="text-text-muted hover:text-accent"
          >
            ⇄
          </button>
        </div>
      ),
    },
  ];

  const desdeRegistro = total === 0 ? 0 : (pagina - 1) * 10 + 1;
  const hastaRegistro = Math.min(pagina * 10, total);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Casos Clínicos</h1>
      <p className="mt-1 text-text-muted">
        Todos los casos de la clínica, de todos los médicos — abrilos o reasignalos a otro médico.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-black/5 bg-surface p-4 sm:grid-cols-5">
        <Input
          placeholder="Buscar paciente…"
          value={buscarPaciente}
          onChange={(e) => actualizarFiltro(setBuscarPaciente)(e.target.value)}
        />
        <Input
          placeholder="N.º de expediente…"
          value={numeroExpediente}
          onChange={(e) => actualizarFiltro(setNumeroExpediente)(e.target.value)}
        />
        <Select
          value={medicoId}
          onChange={(e) => actualizarFiltro(setMedicoId)(e.target.value)}
          options={[
            { value: "", label: "Todos los médicos" },
            ...medicos.map((m) => ({ value: m.id, label: m.nombre })),
          ]}
        />
        <Select
          value={estado}
          onChange={(e) => actualizarFiltro(setEstado)(e.target.value)}
          options={ESTADO_OPTIONS}
        />
        <Select
          value={agenteId}
          onChange={(e) => actualizarFiltro(setAgenteId)(e.target.value)}
          options={[
            { value: "", label: "Todos los agentes" },
            ...agentes.map((a) => ({ value: a.id, label: a.nombre })),
          ]}
        />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-text-muted">Cargando…</p>
        ) : (
          <Table
            columns={columns}
            data={casos}
            rowKey={(c) => c.id}
            emptyMessage="No hay casos para estos filtros."
          />
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Mostrando {desdeRegistro}–{hastaRegistro} de {total} casos
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1}
            >
              Anterior
            </Button>
            <span className="text-sm text-text-muted">
              Página {pagina} de {totalPaginas}
            </span>
            <Button
              variant="secondary"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={!!casoAReasignar}
        onClose={() => setCasoAReasignar(null)}
        title={casoAReasignar ? `Reasignar ${casoAReasignar.paciente_nombre} a otro médico` : ""}
        description={
          casoAReasignar
            ? `Solo se muestran médicos habilitados para el agente ${casoAReasignar.agente_nombre}.`
            : ""
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setCasoAReasignar(null)}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarReasignacion}
              disabled={reasignando || cargandoMedicosDisponibles || !nuevoMedicoAgenteId}
            >
              {reasignando ? "Reasignando…" : "Reasignar caso"}
            </Button>
          </>
        }
      >
        {cargandoMedicosDisponibles ? (
          <p className="text-text-muted">Cargando médicos disponibles…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Select
              label="Médico destino"
              value={nuevoMedicoAgenteId}
              onChange={(e) => setNuevoMedicoAgenteId(e.target.value)}
              options={[
                { value: "", label: "Seleccioná un médico…" },
                ...medicosDisponibles.map((m) => ({ value: m.medico_agente_id, label: m.nombre })),
              ]}
            />
            {medicosDisponibles.length === 0 && (
              <p className="text-sm text-text-muted">
                No hay otros médicos habilitados para este agente en tu clínica.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-text-primary">
                Motivo de la reasignación (opcional)
              </label>
              <textarea
                className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                rows={3}
                value={motivoReasignacion}
                onChange={(e) => setMotivoReasignacion(e.target.value)}
              />
            </div>
            {errorReasignacion && <p className="text-sm text-error">{errorReasignacion}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
