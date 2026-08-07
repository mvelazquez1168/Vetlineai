import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { CountryCombobox } from "../../components/ui/CountryCombobox";
import { FiltroBar } from "../../components/ui/FiltroBar";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Table, TableColumn } from "../../components/ui/Table";
import { ClinicaResumen, platformApi } from "../../lib/platformApi";

export function Clinicas() {
  const [clinicas, setClinicas] = useState<ClinicaResumen[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroPais, setFiltroPais] = useState("");
  const [filtroPlan, setFiltroPlan] = useState("");

  const [modalAbierto, setModalAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [paisCodigo, setPaisCodigo] = useState("AR");
  const [ciudad, setCiudad] = useState("");
  const [adminNombre, setAdminNombre] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    platformApi
      .listarClinicas({ q: busqueda || undefined, pais: filtroPais || undefined, plan: filtroPlan || undefined })
      .then((data) => setClinicas(data.clinicas))
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, [busqueda, filtroPais, filtroPlan]);

  // Opciones de los selects derivadas de lo que ya está cargado — mismo
  // criterio que ConsumoClinicas.tsx: cascadean con los otros filtros en
  // vez de necesitar un endpoint aparte de "países/planes distintos".
  const paisesDisponibles = useMemo(() => {
    const mapa = new Map<string, string>();
    clinicas.forEach((c) => c.pais_codigo && mapa.set(c.pais_codigo, c.pais_codigo));
    return Array.from(mapa.keys());
  }, [clinicas]);
  const planesDisponibles = useMemo(() => {
    const set = new Set<string>();
    clinicas.forEach((c) => c.plan && set.add(c.plan));
    return Array.from(set);
  }, [clinicas]);

  const limpiarFormulario = () => {
    setNombre("");
    setPaisCodigo("AR");
    setCiudad("");
    setAdminNombre("");
    setAdminEmail("");
    setError(null);
  };

  const crear = async () => {
    if (!nombre.trim() || !paisCodigo || !adminNombre.trim() || !adminEmail.trim()) return;
    setCreando(true);
    setError(null);
    try {
      await platformApi.crearClinica({
        nombre: nombre.trim(),
        pais_codigo: paisCodigo,
        ciudad: ciudad.trim() || undefined,
        adminNombre: adminNombre.trim(),
        adminEmail: adminEmail.trim(),
      });
      setModalAbierto(false);
      limpiarFormulario();
      cargar();
    } catch (err: any) {
      setError(err?.message ?? "No pudimos crear la clínica.");
    } finally {
      setCreando(false);
    }
  };

  const columns: TableColumn<ClinicaResumen>[] = [
    {
      key: "nombre",
      header: "Clínica",
      render: (c) => <span className="font-semibold text-primary">{c.nombre}</span>,
    },
    {
      key: "ubicacion",
      header: "Ubicación",
      render: (c) => `${c.ciudad ?? "—"}, ${c.pais_codigo ?? "—"}`,
    },
    { key: "plan", header: "Plan", render: (c) => c.plan },
    { key: "agentes", header: "Agentes habilitados", render: (c) => c.agentes_habilitados },
    { key: "medicos", header: "Médicos activos", render: (c) => c.medicos_activos },
    {
      key: "acciones",
      header: "",
      render: (c) => (
        <Link to={`/platform-admin/clinicas/${c.id}`}>
          <Button variant="secondary">Ver detalle</Button>
        </Link>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Clínicas</h1>
          <p className="text-text-muted">Todas las clínicas registradas en la plataforma.</p>
        </div>
        <Button onClick={() => setModalAbierto(true)}>+ Nueva Clínica</Button>
      </div>

      <FiltroBar
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        placeholderBusqueda="Buscar clínica…"
        selects={[
          {
            value: filtroPais,
            onChange: setFiltroPais,
            opciones: [{ value: "", label: "País: Todos" }, ...paisesDisponibles.map((p) => ({ value: p, label: p }))],
          },
          {
            value: filtroPlan,
            onChange: setFiltroPlan,
            opciones: [{ value: "", label: "Plan: Todos" }, ...planesDisponibles.map((p) => ({ value: p, label: p }))],
          },
        ]}
      />

      <div className="mt-6">
        {isLoading ? (
          <p className="text-text-muted">Cargando…</p>
        ) : (
          <Table columns={columns} data={clinicas} rowKey={(c) => c.id} emptyMessage="No hay clínicas para estos filtros." />
        )}
      </div>

      <Modal
        open={modalAbierto}
        onClose={() => setModalAbierto(false)}
        title="Nueva clínica"
        description="Se crea el tenant y su primer usuario admin de clínica (contraseña de desarrollo: DevPassword123!)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalAbierto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={crear}
              disabled={
                creando || !nombre.trim() || !paisCodigo || !adminNombre.trim() || !adminEmail.trim()
              }
            >
              {creando ? "Creando…" : "Crear clínica"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Nombre de la clínica" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <div className="grid grid-cols-2 gap-4">
            <CountryCombobox label="País" value={paisCodigo} onChange={setPaisCodigo} />
            <Input label="Ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
          </div>
          <hr className="border-black/5" />
          <p className="text-sm font-semibold text-text-primary">Primer admin de clínica</p>
          <Input
            label="Nombre"
            value={adminNombre}
            onChange={(e) => setAdminNombre(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
          />
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
