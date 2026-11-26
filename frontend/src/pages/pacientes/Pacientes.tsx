import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  EmptyState,
  Icono,
  Input,
  KpiCard,
  LoadingState,
  PageHeader,
  Pagination,
  Table,
  TableColumn,
  TiraIndicadores,
} from "../../components/ui";
import { getStoredToken } from "../../hooks/useAuth";
import { apiFetch } from "../../lib/api";
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

interface IndicadoresPacientes {
  pacientes_activos: number;
  vacunas_por_vencer: number;
}

export function Pacientes() {
  const [indicadores, setIndicadores] = useState<IndicadoresPacientes | null>(null);

  useEffect(() => {
    apiFetch<IndicadoresPacientes>("/inicio/indicadores", { token: getStoredToken() })
      .then(setIndicadores)
      .catch(() => setIndicadores(null));
  }, []);

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
      // Un icono en la primera columna donde aporta (prompt 01c, 4). El
      // de la especie: en una lista de treinta, distinguir perros de
      // gatos a simple vista es mas rapido que leer treinta veces la
      // columna de al lado. No reemplaza el texto, lo acompana.
      render: (p) => (
        <button
          type="button"
          onClick={() => navigate(`/pacientes/${p.id}`)}
          className="flex items-center gap-2 text-left font-semibold text-primary hover:underline"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-suave">
            <Icono nombre="paciente" tamano={16} className="text-modulo-pacientes" />
          </span>
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
      {/* Los dos indicadores que los datos de hoy respaldan (prompt 01c,
          seccion 5). Salen de `/inicio/indicadores`, la misma consulta
          agregada del marco, y no de un endpoint nuevo: el numero tiene
          que ser el mismo que el de Inicio, y dos consultas distintas
          para el mismo numero terminan dando dos numeros. */}
      <PageHeader
        titulo="Pacientes"
        subtitulo="Fichero de pacientes de la clínica. Busque por nombre, número de expediente o nombre del propietario."
        icono="paciente"
        modulo="pacientes"
        indicadores={
          indicadores && (
            <TiraIndicadores>
              <KpiCard
                titulo="Pacientes activos"
                valor={String(indicadores.pacientes_activos)}
                icono="paciente"
                modulo="pacientes"
                variacionPorcentaje={null}
                detalle="Sin contar los fallecidos ni los dados de baja"
              />
              <KpiCard
                titulo="Vacunas por vencer"
                valor={String(indicadores.vacunas_por_vencer)}
                icono="vacuna"
                modulo="pacientes"
                estado={indicadores.vacunas_por_vencer > 0 ? "aviso" : undefined}
                variacionPorcentaje={null}
                detalle="Vencidas o que vencen en 30 días"
              />
            </TiraIndicadores>
          )
        }
      />

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
