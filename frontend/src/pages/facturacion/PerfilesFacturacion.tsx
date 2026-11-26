import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  LoadingState,
  Modal,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import { SelectorUbicacion, ValorUbicacion } from "../../components/SelectorUbicacion";
import {
  PerfilFacturacion,
  ReceptorEncontrado,
  facturacionCrApi,
} from "../../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// PERFILES DE FACTURACIÓN — a nombre de quién se factura cuando no es
// el dueño de la mascota.
//
// Esta pantalla existe para MANTENERLOS (corregir una dirección, ligar
// un perfil a otro empleado, desactivar uno que ya no se usa). El uso
// de todos los días no pasa por acá: se elige al cobrar o al emitir,
// con el selector compartido, y uno nuevo se puede registrar ahí mismo.
//
// LA IDENTIFICACIÓN NO SE EDITA, igual que en la ficha del cliente:
// cambiarla reescribiría a quién se le facturó. Si estaba mal, se crea
// el perfil correcto y se desactiva el equivocado — y las facturas ya
// emitidas quedan como estaban, porque guardan su copia.
// ---------------------------------------------------------------------

const TIPOS = [
  { value: "01", label: "Cédula física" },
  { value: "02", label: "Cédula jurídica" },
  { value: "03", label: "DIMEX" },
  { value: "04", label: "NITE" },
];

export function PerfilesFacturacion() {
  const toast = useToast();
  const [perfiles, setPerfiles] = useState<Array<PerfilFacturacion & { clientes: number }>>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [q, setQ] = useState("");

  const [editando, setEditando] = useState<PerfilFacturacion | null>(null);
  const [creando, setCreando] = useState(false);
  const [datos, setDatos] = useState({
    nombre: "",
    nombreComercial: "",
    tipoIdentificacion: "02",
    numeroIdentificacion: "",
    correo: "",
    telefonoNumero: "",
    otrasSenas: "",
  });
  const [ubicacion, setUbicacion] = useState<ValorUbicacion>({});

  // Para ligar un perfil a un cliente.
  const [ligando, setLigando] = useState<PerfilFacturacion | null>(null);
  const [busca, setBusca] = useState("");
  const [clientes, setClientes] = useState<ReceptorEncontrado[]>([]);
  const [predeterminado, setPredeterminado] = useState(true);

  const recargar = () => {
    setCargando(true);
    facturacionCrApi
      .perfiles(q)
      .then((r) => setPerfiles(r.perfiles))
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    const t = setTimeout(recargar, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (busca.trim().length < 2) {
      setClientes([]);
      return;
    }
    const t = setTimeout(() => {
      facturacionCrApi
        .buscarClientes(busca)
        .then((r) => setClientes(r.clientes))
        .catch(() => setClientes([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const abrirNuevo = () => {
    setDatos({
      nombre: "",
      nombreComercial: "",
      tipoIdentificacion: "02",
      numeroIdentificacion: "",
      correo: "",
      telefonoNumero: "",
      otrasSenas: "",
    });
    setUbicacion({});
    setEditando(null);
    setCreando(true);
  };

  const abrirEdicion = (p: PerfilFacturacion) => {
    setDatos({
      nombre: p.nombre,
      nombreComercial: p.nombre_comercial ?? "",
      tipoIdentificacion: p.tipo_identificacion,
      numeroIdentificacion: p.numero_identificacion,
      correo: p.correo ?? "",
      telefonoNumero: p.telefono_numero ?? "",
      otrasSenas: p.ubicacion_otras_senas ?? "",
    });
    setUbicacion({
      provincia: p.ubicacion_provincia ?? "",
      canton: p.ubicacion_canton ?? "",
      distrito: p.ubicacion_distrito ?? "",
      barrio: p.ubicacion_barrio ?? "",
    });
    setEditando(p);
    setCreando(true);
  };

  const guardar = async () => {
    setOcupado(true);
    try {
      const cuerpo = {
        nombre: datos.nombre.trim(),
        nombreComercial: datos.nombreComercial.trim() || undefined,
        tipoIdentificacion: datos.tipoIdentificacion,
        numeroIdentificacion: datos.numeroIdentificacion.trim(),
        correo: datos.correo.trim() || undefined,
        telefonoCodigoPais: datos.telefonoNumero.trim() ? "506" : undefined,
        telefonoNumero: datos.telefonoNumero.trim() || undefined,
        ubicacionProvincia: ubicacion.provincia || undefined,
        ubicacionCanton: ubicacion.canton || undefined,
        ubicacionDistrito: ubicacion.distrito || undefined,
        ubicacionBarrio: ubicacion.barrio || undefined,
        ubicacionOtrasSenas: datos.otrasSenas.trim() || undefined,
      };
      if (editando) {
        await facturacionCrApi.editarPerfil(editando.id, cuerpo);
        toast.exito("Perfil actualizado. Las facturas ya emitidas no cambian.");
      } else {
        await facturacionCrApi.crearPerfil(cuerpo);
        toast.exito("Perfil creado. Ya se puede elegir al cobrar o al emitir.");
      }
      setCreando(false);
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const alternarActivo = async (p: PerfilFacturacion) => {
    try {
      await facturacionCrApi.editarPerfil(p.id, { activo: !p.activo });
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const ligar = async (clienteId: string) => {
    if (!ligando) return;
    setOcupado(true);
    try {
      await facturacionCrApi.ligarPerfilACliente(ligando.id, {
        propietarioId: clienteId,
        esPredeterminado: predeterminado,
      });
      toast.exito(
        predeterminado
          ? "Ligado y marcado como el habitual: la caja lo va a proponer primero."
          : "Ligado al cliente."
      );
      setLigando(null);
      setBusca("");
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<PerfilFacturacion & { clientes: number }>[] = [
    {
      key: "nombre",
      header: "A nombre de",
      render: (p) => (
        <>
          <span className="font-medium text-primary">{p.nombre}</span>
          <span className="block text-xs text-text-muted">
            {TIPOS.find((t) => t.value === p.tipo_identificacion)?.label ?? p.tipo_identificacion} ·{" "}
            {p.numero_identificacion}
          </span>
        </>
      ),
    },
    {
      key: "contacto",
      header: "Contacto",
      render: (p) => (
        <span className="text-xs text-text-muted">
          {p.correo ?? "sin correo"}
          {p.telefono_numero ? ` · ${p.telefono_numero}` : ""}
        </span>
      ),
    },
    {
      key: "direccion",
      header: "Dirección",
      render: (p) =>
        p.ubicacion_provincia ? (
          <span className="text-xs text-text-muted">
            {p.ubicacion_provincia}-{p.ubicacion_canton}-{p.ubicacion_distrito}
            {p.ubicacion_otras_senas ? ` · ${p.ubicacion_otras_senas}` : ""}
          </span>
        ) : (
          <span className="text-xs text-text-muted">sin dirección</span>
        ),
    },
    {
      key: "clientes",
      header: "Clientes",
      render: (p) => (
        <span className="text-sm">
          {p.clientes === 0 ? "ninguno" : `${p.clientes} ligado(s)`}
        </span>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (p) => (
        <Badge variant={p.activo ? "success" : "neutral"} dot>
          {p.activo ? "activo" : "inactivo"}
        </Badge>
      ),
    },
    {
      key: "acciones",
      header: "",
      render: (p) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => abrirEdicion(p)}>
            Editar
          </Button>
          <Button variant="secondary" onClick={() => setLigando(p)}>
            Ligar a un cliente
          </Button>
          <Button variant="secondary" onClick={() => alternarActivo(p)}>
            {p.activo ? "Desactivar" : "Activar"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <Link to="/facturacion" className="text-sm text-text-muted hover:text-primary">
        ← Comprobantes
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">Perfiles de facturación</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            A nombre de quién se factura cuando no es el dueño de la mascota: su empresa, una
            fundación que paga la atención, un familiar. Un perfil puede servir a varios clientes o
            a ninguno. <strong>La cuenta y el expediente siguen siendo del dueño.</strong>
          </p>
        </div>
        <Button onClick={abrirNuevo}>
          <Icono nombre="agregar" className="mr-1 h-4 w-4" />
          Nuevo perfil
        </Button>
      </div>

      <Card className="mt-6">
        <Input
          name="buscar-perfil"
          label="Buscar"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Razón social o identificación"
        />
        <div className="mt-3">
          {cargando ? (
            <LoadingState forma="tabla" cantidad={4} />
          ) : (
            <Table
              columns={columnas}
              data={perfiles}
              rowKey={(p) => p.id}
              emptyMessage="Todavía no hay perfiles. Se pueden crear acá o al cobrar, cuando hagan falta."
            />
          )}
        </div>
      </Card>

      <Modal
        open={creando}
        onClose={() => setCreando(false)}
        title={editando ? "Editar el perfil" : "Nuevo perfil de facturación"}
        ancho="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreando(false)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado || !datos.nombre.trim() || !datos.numeroIdentificacion.trim()}
              onClick={guardar}
            >
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input
            name="perfil-nombre"
            label="Nombre o razón social"
            value={datos.nombre}
            onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
            placeholder="Transportes del Valle S.A."
          />
          <Input
            name="perfil-comercial"
            label="Nombre comercial (opcional)"
            value={datos.nombreComercial}
            onChange={(e) => setDatos({ ...datos, nombreComercial: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              name="perfil-tipo-id"
              label="Tipo de identificación"
              value={datos.tipoIdentificacion}
              onChange={(e) => setDatos({ ...datos, tipoIdentificacion: e.target.value })}
              options={TIPOS}
              disabled={!!editando}
            />
            <Input
              name="perfil-numero-id"
              label="Número de identificación"
              value={datos.numeroIdentificacion}
              onChange={(e) => setDatos({ ...datos, numeroIdentificacion: e.target.value })}
              disabled={!!editando}
            />
          </div>
          {editando && (
            <p className="text-xs text-text-muted">
              La identificación no se edita: cambiarla reescribiría a quién se le facturó. Si estaba
              mal, creá el perfil correcto y desactivá este.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              name="perfil-correo"
              label="Correo"
              value={datos.correo}
              onChange={(e) => setDatos({ ...datos, correo: e.target.value })}
            />
            <Input
              name="perfil-telefono"
              label="Teléfono"
              value={datos.telefonoNumero}
              onChange={(e) => setDatos({ ...datos, telefonoNumero: e.target.value })}
            />
          </div>
          <SelectorUbicacion idPrefijo="perfil" valor={ubicacion} onChange={setUbicacion} />
          <Input
            name="perfil-otras-senas"
            label="Otras señas"
            value={datos.otrasSenas}
            onChange={(e) => setDatos({ ...datos, otrasSenas: e.target.value })}
            maxLength={250}
          />
        </div>
      </Modal>

      <Modal
        open={ligando !== null}
        onClose={() => setLigando(null)}
        title={`Ligar ${ligando?.nombre ?? ""} a un cliente`}
        ancho="lg"
      >
        <p className="text-sm text-text-muted">
          Al ligarlo, la caja lo va a ofrecer cuando se cobre a ese cliente. Un perfil puede estar
          ligado a varios: una empresa que paga por varios empleados, una fundación con varios
          rescatados.
        </p>
        <div className="mt-3">
          <Input
            name="ligar-busca"
            label="Cliente"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nombre, identificación o teléfono"
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={predeterminado}
              onChange={(e) => setPredeterminado(e.target.checked)}
            />
            Es el habitual de ese cliente (se propone primero)
          </label>
          <ul className="mt-2 max-h-56 overflow-auto rounded-lg border border-black/5">
            {clientes.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => ligar(c.id)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-background"
                >
                  <span className="font-medium">{c.nombre}</span>
                  <span className="block text-xs text-text-muted">
                    {c.numero_identificacion ?? "sin identificación"}
                  </span>
                </button>
              </li>
            ))}
            {clientes.length === 0 && (
              <li className="px-3 py-2 text-sm text-text-muted">
                Escribí al menos dos letras para buscar.
              </li>
            )}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
