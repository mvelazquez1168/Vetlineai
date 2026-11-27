import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
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
import { ModalNuevoPaciente } from "../../components/paciente/ModalNuevoPaciente";
import { getStoredToken } from "../../hooks/useAuth";
import { apiFetch } from "../../lib/api";
import { ETIQUETA_ESTADO_PACIENTE, PacienteListado, pacientesApi } from "../../lib/pacientesApi";

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
  // Alta de paciente (anexo 07-03, A5). El fichero era de solo consulta:
  // crear un paciente obligaba a abrir un caso clínico o una cita.
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [recargar, setRecargar] = useState(0);
  // El filtro de las fichas a medias (anexo 07-03, A5). La etiqueta sola
  // no alcanza: en un fichero de cuatrocientos pacientes, encontrar las
  // quince incompletas scrolleando es un trabajo que nadie hace.
  const [soloIncompletas, setSoloIncompletas] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(true);
      pacientesApi
        .listar(q, pagina, soloIncompletas)
        .then((data) => {
          setPacientes(data.pacientes);
          setTotal(data.total);
          setPorPagina(data.porPagina);
        })
        .finally(() => setIsLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, pagina, recargar, soloIncompletas]);

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
      render: (p) => (
        <div className="flex flex-wrap items-center gap-1">
          {p.estado === "activo" ? (
            <Badge variant="success" dot>
              Activo
            </Badge>
          ) : (
            <Badge variant="neutral">{ETIQUETA_ESTADO_PACIENTE[p.estado]}</Badge>
          )}
          {/* FICHA POR COMPLETAR (anexo 07-03, A5): lo que el alta
              rápida desde una cita no pidió. El título dice qué falta,
              para que el aviso sirva para algo más que inquietar. */}
          {p.datos_basicos_faltantes?.length > 0 && (
            <span title={`Falta: ${p.datos_basicos_faltantes.join(", ")}.`}>
              <Badge variant="warning">Ficha por completar</Badge>
            </span>
          )}
        </div>
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
        accion={<Button onClick={() => setAltaAbierta(true)}>+ Nuevo paciente</Button>}
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

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="max-w-md flex-1">
          <Input
            placeholder="Buscar paciente…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPagina(1);
            }}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-black/20"
            checked={soloIncompletas}
            onChange={(e) => {
              setSoloIncompletas(e.target.checked);
              setPagina(1);
            }}
          />
          Solo las fichas por completar
        </label>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <LoadingState forma="tabla" cantidad={6} etiqueta="Cargando pacientes…" />
        ) : pacientes.length === 0 ? (
          <EmptyState
            icono="paciente"
            titulo={
              soloIncompletas
                ? "Ninguna ficha está por completar"
                : q
                  ? "Ningún paciente coincide con la búsqueda"
                  : "Todavía no hay pacientes"
            }
            texto={
              soloIncompletas
                ? "Todas tienen especie, raza, sexo, estado reproductivo y edad o fecha de nacimiento."
                : q
                  ? "Probá con el nombre del paciente, su número de expediente o el nombre del propietario."
                  : "Los pacientes se dan de alta desde «+ Nuevo paciente», al crear un caso o al agendar una cita."
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

      <ModalNuevoPaciente
        abierto={altaAbierta}
        onCerrar={() => setAltaAbierta(false)}
        onCreado={(id) => {
          setAltaAbierta(false);
          setRecargar((n) => n + 1);
          // Se entra a la ficha reciencita: el alta rápida deja datos
          // por completar y es el momento de completarlos.
          navigate(`/pacientes/${id}`);
        }}
      />
    </div>
  );
}
