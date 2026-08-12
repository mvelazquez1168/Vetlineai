import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableColumn } from "../../components/ui/Table";
import { useAuth } from "../../hooks/useAuth";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { CasoSinActividad } from "../../lib/workspaceApi";
import { adminApi } from "../../lib/adminApi";

// prompt_code_cierre_caso.md, Paso 4 — "cantidad de meses, o una fecha de
// corte", a elección. Un solo criterio a la vez: elegir uno limpia el otro
// para que no quede ambigüedad de cuál manda (el backend solo acepta uno).
export function CasosSinActividad() {
  const { zonaHoraria } = useAuth();
  const navigate = useNavigate();

  const [meses, setMeses] = useState("3");
  const [fechaCorte, setFechaCorte] = useState("");
  const [criterio, setCriterio] = useState<"meses" | "fecha">("meses");
  const [casos, setCasos] = useState<CasoSinActividad[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buscar = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminApi.casosSinActividad(
        criterio === "meses" ? { meses: Number(meses) } : { fechaCorte }
      );
      setCasos(data.casos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos obtener los casos.");
    } finally {
      setIsLoading(false);
    }
  };

  const columns: TableColumn<CasoSinActividad>[] = [
    {
      key: "expediente",
      header: "Expediente",
      render: (c) => <span className="font-mono text-sm text-text-muted">N.º {c.numero_expediente}</span>,
    },
    { key: "paciente", header: "Paciente", render: (c) => c.paciente_nombre },
    { key: "motivo", header: "Motivo", render: (c) => c.motivo },
    { key: "medico", header: "Médico", render: (c) => c.medico_nombre },
    { key: "apertura", header: "Fecha de apertura", render: (c) => formatearFechaCorta(c.creado_en, zonaHoraria) },
    {
      key: "actividad",
      header: "Última actividad",
      render: (c) => formatearFechaCorta(c.actualizado_en, zonaHoraria),
    },
    {
      key: "acciones",
      header: "Acciones",
      render: (c) => (
        <button
          type="button"
          onClick={() => navigate(`/admin/casos/${c.id}`)}
          className="text-sm font-semibold text-accent hover:underline"
        >
          Abrir
        </button>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Casos sin actividad</h1>
      <p className="mt-1 text-text-muted">
        Casos abiertos (no cerrados) de toda la clínica que nadie tocó desde hace tiempo — desde acá se pueden
        abrir y cerrar.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-2xl border border-black/5 bg-surface p-4">
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="radio"
            checked={criterio === "meses"}
            onChange={() => setCriterio("meses")}
          />
          Meses sin actividad
        </label>
        <Input
          type="number"
          min={1}
          value={meses}
          disabled={criterio !== "meses"}
          onChange={(e) => setMeses(e.target.value)}
          className="w-24"
        />

        <label className="ml-4 flex items-center gap-2 text-sm text-text-primary">
          <input
            type="radio"
            checked={criterio === "fecha"}
            onChange={() => setCriterio("fecha")}
          />
          Fecha de corte
        </label>
        <Input
          type="date"
          value={fechaCorte}
          disabled={criterio !== "fecha"}
          onChange={(e) => setFechaCorte(e.target.value)}
        />

        <Button
          onClick={buscar}
          disabled={isLoading || (criterio === "meses" ? !meses : !fechaCorte)}
          className="ml-auto"
        >
          {isLoading ? "Buscando…" : "Buscar"}
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      {casos !== null && (
        <div className="mt-6">
          <Table
            columns={columns}
            data={casos}
            rowKey={(c) => c.id}
            emptyMessage="No hay casos sin actividad para este criterio."
          />
        </div>
      )}
    </div>
  );
}
