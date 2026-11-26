import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  EmptyState,
  Input,
  LoadingState,
  Pagination,
  Table,
  TableColumn,
} from "../../components/ui";
import { PacienteListado, pacientesApi } from "../../lib/pacientesApi";

// Misma estructura que pages/admin/Propietarios.tsx: título +
// descripción, un Input de búsqueda con debounce de 300 ms y la Table
// compartida.
//
// Lo que cambió en la sesión nocturna: la paginación, el estado vacío y
// la carga ya no están escritos acá. `Pagination` recibe el `porPagina`
// que devolvió el BACKEND en vez de una constante local — así el rango
// que se muestra no puede discrepar del que el servidor realmente
// paginó.

export function Pacientes() {
  const navigate = useNavigate();
  const [pacientes, setPacientes] = useState<PacienteListado[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);
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
          setPorPagina(data.porPagina);
        })
        .finally(() => setIsLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, pagina]);

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
        Fichero de pacientes de la clínica — busque por nombre, número de expediente o nombre del
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
          <LoadingState forma="tabla" cantidad={6} etiqueta="Cargando pacientes…" />
        ) : pacientes.length === 0 ? (
          <EmptyState
            icono="paciente"
            titulo={q ? "Ningún paciente coincide con la búsqueda" : "Todavía no hay pacientes"}
            texto={
              q
                ? "Probá con el nombre del paciente, su número de expediente o el nombre del propietario."
                : "Los pacientes se dan de alta al crear un caso o al agendar una cita, y aparecen acá."
            }
          />
        ) : (
          <Table columns={columns} data={pacientes} rowKey={(p) => p.id} />
        )}
      </div>

      <Pagination
        pagina={pagina}
        total={total}
        porPagina={porPagina}
        onPagina={setPagina}
        sustantivo={{ singular: "paciente", plural: "pacientes" }}
      />
    </div>
  );
}
