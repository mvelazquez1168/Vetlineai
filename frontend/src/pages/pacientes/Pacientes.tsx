import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableColumn } from "../../components/ui/Table";
import { PacienteListado, pacientesApi } from "../../lib/pacientesApi";

// Misma estructura exacta que pages/admin/Propietarios.tsx: título +
// descripción, un Input de búsqueda con debounce de 300 ms, la Table
// compartida con su emptyMessage, y la paginación de 20 abajo. No se
// inventa un patrón nuevo para la pantalla gemela del fichero de
// clientes.
const POR_PAGINA = 20;

export function Pacientes() {
  const navigate = useNavigate();
  const [pacientes, setPacientes] = useState<PacienteListado[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(true);
      pacientesApi
        .listar(q, pagina)
        .then((data) => {
          setPacientes(data.pacientes);
          setTotal(data.total);
        })
        .finally(() => setIsLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, pagina]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desdeRegistro = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hastaRegistro = Math.min(pagina * POR_PAGINA, total);

  const columns: TableColumn<PacienteListado>[] = [
    {
      key: "expediente",
      header: "N.º de expediente",
      render: (p) => <span className="font-mono text-sm text-text-muted">N.º {p.numero_expediente}</span>,
    },
    {
      key: "nombre",
      header: "Paciente",
      render: (p) => (
        <button
          type="button"
          onClick={() => navigate(`/pacientes/${p.id}`)}
          className="font-semibold text-primary hover:underline"
        >
          {p.nombre}
        </button>
      ),
    },
    {
      key: "especie",
      header: "Especie y raza",
      render: (p) => (p.raza ? `${p.especie} · ${p.raza}` : p.especie),
    },
    { key: "sexo", header: "Sexo", render: (p) => p.sexo ?? "—" },
    {
      key: "edad",
      header: "Edad",
      render: (p) =>
        p.edad_anios === null
          ? "—"
          : `${p.edad_anios} años${p.fecha_nacimiento_estimada ? " (est.)" : ""}`,
    },
    { key: "propietario", header: "Propietario", render: (p) => p.propietario_nombre },
    {
      key: "estado",
      header: "Estado",
      render: (p) =>
        p.estado === "fallecido" ? (
          <Badge variant="neutral">Fallecido</Badge>
        ) : (
          <Badge variant="success" dot>
            Activo
          </Badge>
        ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Pacientes</h1>
      <p className="mt-1 text-text-muted">
        Fichero de pacientes de la clínica — buscá por nombre, número de expediente o nombre del
        propietario.
      </p>

      <div className="mt-6 max-w-md">
        <Input
          placeholder="Buscar paciente…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPagina(1);
          }}
        />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-text-muted">Cargando…</p>
        ) : (
          <Table
            columns={columns}
            data={pacientes}
            rowKey={(p) => p.id}
            emptyMessage="No hay pacientes para esta búsqueda."
          />
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Mostrando {desdeRegistro}–{hastaRegistro} de {total} pacientes
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
    </div>
  );
}
