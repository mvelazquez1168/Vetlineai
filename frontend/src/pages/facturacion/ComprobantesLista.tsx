import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  FiltroBar,
  Icono,
  LoadingState,
  Pagination,
  Table,
  TableColumn,
} from "../../components/ui";
import {
  Catalogos,
  ComprobanteListado,
  FiltrosComprobantes,
  facturacionCrApi,
  formatearMonto,
  varianteEstado,
} from "../../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// Listado de comprobantes electrónicos.
//
// Es la pantalla de aterrizaje del módulo, así que es la que tiene que
// responder de un vistazo la pregunta que una clínica se hace de verdad:
// "¿quedó algo sin transmitir?". De ahí el aviso de arriba cuando hay
// comprobantes en cola o con error — si estuvieran solo como una fila
// entre cien, nadie los vería.
// ---------------------------------------------------------------------

const ESTADOS = [
  { value: "", label: "Todos los estados" },
  { value: "aceptado", label: "Aceptado" },
  { value: "aceptado_parcial", label: "Aceptado parcialmente" },
  { value: "enviado", label: "Esperando respuesta" },
  { value: "en_cola", label: "Pendiente de transmitir" },
  { value: "rechazado", label: "Rechazado" },
  { value: "error", label: "Con error" },
  { value: "borrador", label: "Borrador (sin numerar)" },
];

export function ComprobantesLista() {
  const navegar = useNavigate();
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [filtros, setFiltros] = useState<FiltrosComprobantes>({ pagina: 1, porPagina: 25 });
  const [datos, setDatos] = useState<{ total: number; comprobantes: ComprobanteListado[] } | null>(
    null
  );
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState<{ enCola: number; conError: number } | null>(null);

  useEffect(() => {
    facturacionCrApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
  }, []);

  useEffect(() => {
    setCargando(true);
    setError(null);
    facturacionCrApi
      .listar(filtros)
      .then(setDatos)
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, [filtros]);

  // El conteo de pendientes se pide aparte y SIN los filtros de la
  // pantalla. Si se calculara sobre la página visible, filtrar por
  // "aceptado" escondería justamente los que hay que atender.
  useEffect(() => {
    Promise.all([
      facturacionCrApi.listar({ estado: "en_cola", porPagina: 1 }),
      facturacionCrApi.listar({ estado: "error", porPagina: 1 }),
    ])
      .then(([cola, err]) => setPendientes({ enCola: cola.total, conError: err.total }))
      .catch(() => setPendientes(null));
  }, [datos]);

  const columnas: TableColumn<ComprobanteListado>[] = [
    {
      key: "consecutivo",
      header: "Comprobante",
      // Un BORRADOR todavía no tiene consecutivo —se asigna al
      // emitir, para no dejar huecos en la numeración— y se abre en la
      // pantalla de edición, no en la de detalle: lo que se quiere
      // hacer con un borrador es terminarlo.
      render: (c) =>
        c.estado === "borrador" ? (
          <Link to={`/facturacion/emitir?borrador=${c.id}`} className="block hover:underline">
            <span className="font-medium text-primary">Borrador sin número</span>
            <span className="block text-xs text-text-muted">
              {c.tipoComprobanteNombre} · se numera al emitir
            </span>
          </Link>
        ) : (
          <Link to={`/facturacion/comprobantes/${c.id}`} className="block hover:underline">
            <span className="font-medium text-primary">{c.consecutivo}</span>
            <span className="block text-xs text-text-muted">{c.tipoComprobanteNombre}</span>
          </Link>
        ),
    },
    {
      key: "fechaEmision",
      header: "Fecha",
      render: (c) =>
        new Date(c.fechaEmision).toLocaleDateString("es-CR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
    },
    {
      key: "receptor",
      header: "Receptor",
      render: (c) =>
        c.receptorNombre ? (
          <>
            <span>{c.receptorNombre}</span>
            {c.receptorIdentificacion && (
              <span className="block text-xs text-text-muted">{c.receptorIdentificacion}</span>
            )}
          </>
        ) : (
          // Un tiquete puede no identificar al receptor. Decirlo es mejor
          // que una celda vacía, que se lee como un dato faltante.
          <span className="text-text-muted">Consumidor final</span>
        ),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      render: (c) => formatearMonto(c.totalComprobante, c.moneda),
    },
    {
      key: "estado",
      header: "Estado en Hacienda",
      render: (c) => (
        <>
          <Badge variant={varianteEstado(c.estado)} dot>
            {c.estadoLegible}
          </Badge>
          {c.detalle && (
            <span className="mt-1 block max-w-xs truncate text-xs text-text-muted" title={c.detalle}>
              {c.detalle}
            </span>
          )}
        </>
      ),
    },
  ];

  const sinFiltros = !filtros.receptor && !filtros.estado && !filtros.tipo;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-primary">Comprobantes electrónicos</h2>
          <p className="mt-1 text-sm text-text-muted">
            Lo que se le emitió a Hacienda, con el estado que Hacienda devolvió.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/facturacion/emisor">
            <Button variant="ghost">
              <Icono nombre="ajustes" tamano={16} /> Emisor
            </Button>
          </Link>
          <Link to="/facturacion/perfiles">
            <Button variant="ghost">
              <Icono nombre="propietario" tamano={16} /> Perfiles de facturación
            </Button>
          </Link>
          <Link to="/facturacion/recibidos">
            <Button variant="secondary">
              <Icono nombre="recibidos" tamano={16} /> Recibidos
            </Button>
          </Link>
          <Link to="/facturacion/emitir">
            <Button>
              <Icono nombre="agregar" tamano={16} /> Emitir
            </Button>
          </Link>
        </div>
      </div>

      {pendientes && pendientes.enCola > 0 && (
        <div className="mt-4 rounded-xl border border-black/5 bg-surface p-3 text-sm">
          <p className="font-medium text-text">
            {pendientes.enCola} comprobante(s) pendientes de transmitir a Hacienda.
          </p>
          <p className="text-text-muted">
            Se reintentan solos cada minuto. La venta no se bloquea: el comprobante ya está firmado.
          </p>
        </div>
      )}
      {pendientes && pendientes.conError > 0 && (
        <div className="mt-3 rounded-xl border border-error/30 bg-error/5 p-3 text-sm">
          <p className="font-medium text-error">
            {pendientes.conError} comprobante(s) con error.
          </p>
          <p className="text-text-muted">
            Ya no se reintentan solos: hay que abrirlos y reenviarlos a mano, o corregir lo que
            Hacienda señaló.
          </p>
        </div>
      )}

      <FiltroBar
        busqueda={filtros.receptor ?? ""}
        onBusqueda={(receptor) => setFiltros((f) => ({ ...f, receptor, pagina: 1 }))}
        placeholderBusqueda="Buscar por receptor o identificación…"
        desde={filtros.desde ?? ""}
        hasta={filtros.hasta ?? ""}
        onDesde={(desde) => setFiltros((f) => ({ ...f, desde, pagina: 1 }))}
        onHasta={(hasta) => setFiltros((f) => ({ ...f, hasta, pagina: 1 }))}
        selects={[
          {
            value: filtros.estado ?? "",
            onChange: (estado) => setFiltros((f) => ({ ...f, estado, pagina: 1 })),
            opciones: ESTADOS,
          },
          {
            value: filtros.tipo ?? "",
            onChange: (tipo) => setFiltros((f) => ({ ...f, tipo, pagina: 1 })),
            opciones: [
              { value: "", label: "Todos los tipos" },
              ...(catalogos?.tiposComprobante ?? []).map((t) => ({
                value: t.codigo,
                label: t.nombre,
              })),
            ],
          },
        ]}
        className="mt-4"
      />

      {cargando && <LoadingState forma="tabla" cantidad={6} className="mt-4" />}
      {error && <p className="mt-6 text-sm text-error">{error}</p>}

      {!cargando && !error && datos && datos.comprobantes.length === 0 && (
        <EmptyState
          className="mt-4"
          icono="comprobante"
          titulo={sinFiltros ? "Todavía no hay comprobantes" : "Ningún comprobante coincide"}
          texto={
            sinFiltros
              ? "Cuando se emita el primero va a aparecer acá, con su estado en Hacienda."
              : "Probá con otros filtros o con un rango de fechas más amplio."
          }
          accion={
            sinFiltros ? (
              <Button onClick={() => navegar("/facturacion/emitir")}>Emitir un comprobante</Button>
            ) : undefined
          }
        />
      )}

      {!cargando && !error && datos && datos.comprobantes.length > 0 && (
        <>
          <div className="mt-4">
            <Table columns={columnas} data={datos.comprobantes} rowKey={(c) => c.id} />
          </div>
          <Pagination
            pagina={filtros.pagina ?? 1}
            total={datos.total}
            porPagina={filtros.porPagina ?? 25}
            onPagina={(pagina) => setFiltros((f) => ({ ...f, pagina }))}
            sustantivo={{ singular: "comprobante", plural: "comprobantes" }}
          />
        </>
      )}
    </div>
  );
}
