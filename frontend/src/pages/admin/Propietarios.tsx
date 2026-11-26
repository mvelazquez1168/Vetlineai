import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableColumn } from "../../components/ui/Table";
import { FichaPropietarioModal } from "../../components/caso/FichaPropietarioModal";
import { PropietarioListado, propietariosApi } from "../../lib/propietariosApi";

const POR_PAGINA = 20;

// Fichero de clientes de la clínica — no existía ninguna pantalla para
// consultar propietarios fuera del contexto de un caso o una cita
// puntual (solo el typeahead de 10 resultados de los wizards).
export function Propietarios() {
  const [propietarios, setPropietarios] = useState<PropietarioListado[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [propietarioAbiertoId, setPropietarioAbiertoId] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    propietariosApi
      .listar(q, pagina)
      .then((data) => {
        setPropietarios(data.propietarios);
        setTotal(data.total);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(cargar, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pagina]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desdeRegistro = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hastaRegistro = Math.min(pagina * POR_PAGINA, total);

  const columns: TableColumn<PropietarioListado>[] = [
    {
      key: "nombre",
      header: "Nombre",
      render: (p) => (
        <button
          type="button"
          onClick={() => setPropietarioAbiertoId(p.id)}
          className="font-semibold text-primary hover:underline"
        >
          {p.nombre}
        </button>
      ),
    },
    {
      key: "identificacion",
      header: "Identificación",
      render: (p) =>
        p.numero_identificacion ? `${p.tipo_identificacion_etiqueta}: ${p.numero_identificacion}` : "—",
    },
    { key: "telefono", header: "Teléfono", render: (p) => p.telefono ?? "—" },
    { key: "email", header: "Correo", render: (p) => p.email ?? "—" },
    { key: "mascotas", header: "Mascotas", render: (p) => p.cantidad_pacientes },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Propietarios</h1>
      <p className="mt-1 text-text-muted">
        Fichero de clientes de la clínica — busque por nombre, teléfono, correo o número de identificación.
      </p>

      <div className="mt-6 max-w-md">
        <Input
          placeholder="Buscar propietario…"
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
            data={propietarios}
            rowKey={(p) => p.id}
            emptyMessage="No hay propietarios para esta búsqueda."
          />
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Mostrando {desdeRegistro}–{hastaRegistro} de {total} propietarios
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

      {propietarioAbiertoId && (
        <FichaPropietarioModal
          propietarioId={propietarioAbiertoId}
          onClose={() => setPropietarioAbiertoId(null)}
          onGuardado={cargar}
        />
      )}
    </div>
  );
}
