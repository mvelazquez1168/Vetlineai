import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Table } from "../ui/Table";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../ui/LoadingState";
import { ChartBarras, ChartLinea } from "../ui/charts";
import { SelectorPeriodo, Periodo, construirPeriodo } from "../ui/SelectorPeriodo";
import { Bloque } from "./Bloque";
import { ConsumoProducto, TrazabilidadLote, metricasApi } from "../../lib/metricasApi";
import { fechaHoyEnZona, formatearFechaCorta } from "../../lib/formatFecha";
import { useAuth } from "../../hooks/useAuth";

// ---------------------------------------------------------------------
// §6 — CONSUMO Y TRAZABILIDAD DE UN PRODUCTO.
//
// Contesta dos preguntas distintas y las separa:
//
//   «¿en qué se me fue este producto?» → el desglose por origen, donde
//   los movimientos SIN paciente son su propio grupo con su nombre
//   («Venta de mostrador», «Consumo interno», «Merma»). No se esconden
//   ni se reparten entre los pacientes: repartirlos sería inventar que a
//   alguien se le aplicó algo.
//
//   «el fabricante retiró el lote X, ¿a quién se lo pusimos?» → la
//   trazabilidad por lote, con el teléfono de cada cliente y si se le
//   puede escribir según sus consentimientos.
// ---------------------------------------------------------------------

export function ConsumoDeProducto({ productoId }: { productoId: string }) {
  const { zonaHoraria } = useAuth();
  const navigate = useNavigate();
  const hoy = fechaHoyEnZona(zonaHoraria);
  const [periodo, setPeriodo] = useState<Periodo>(() => construirPeriodo("trimestre", hoy, false));
  const [datos, setDatos] = useState<ConsumoProducto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [lote, setLote] = useState<{ id: string; numero: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    metricasApi
      .consumoProducto(productoId, periodo.desde, periodo.hasta)
      .then((d) => vivo && setDatos(d))
      .catch(() => vivo && setDatos(null))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [productoId, periodo.desde, periodo.hasta]);

  if (cargando) return <LoadingState />;
  if (!datos)
    return (
      <EmptyState
        titulo="No se pudo cargar el consumo"
        texto="Volvé a intentarlo en un momento."
        icono="aviso"
      />
    );

  return (
    <div className="space-y-6">
      <SelectorPeriodo valor={periodo} onCambio={setPeriodo} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Bloque titulo={`Consumo en ${datos.unidadBase}`}>
          <p className="text-2xl font-bold">{datos.totalBase}</p>
          {datos.presentacion && datos.totalPresentacion !== null && (
            <p className="mt-1 text-sm text-text-muted">
              Equivale a {datos.totalPresentacion} × {datos.presentacion.nombre}
            </p>
          )}
        </Bloque>
        <Bloque titulo="Tendencia semanal">
          <ChartLinea
            etiquetas={datos.tendencia.map((p) => formatearFechaCorta(p.fecha, zonaHoraria))}
            series={[
              { nombre: datos.unidadBase, valores: datos.tendencia.map((p) => p.cantidadBase) },
            ]}
            alto={160}
            mensajeVacio="Sin salidas en el período."
          />
        </Bloque>
      </div>

      <Bloque
        titulo="En qué se fue"
        descripcion="Los movimientos sin paciente —mostrador, consumo interno, merma— son su propio grupo: no se reparten entre los pacientes."
      >
        <ChartBarras
          datos={datos.porOrigen.map((o) => ({ etiqueta: o.nombre, valor: o.cantidadBase }))}
          orientacion="horizontal"
          alto={Math.max(160, datos.porOrigen.length * 42)}
          mensajeVacio="Sin salidas en el período."
        />
        <Table
          columns={[
            { key: "nombre", header: "Origen", render: (f) => f.nombre },
            {
              key: "conPaciente",
              header: "",
              render: (f) =>
                f.conPaciente ? (
                  <Badge variant="info">Con paciente</Badge>
                ) : (
                  <Badge variant="neutral">Sin paciente</Badge>
                ),
            },
            {
              key: "cantidadBase",
              header: datos.unidadBase,
              className: "px-6 py-4 text-right tabular-nums",
              render: (f) => f.cantidadBase,
            },
            {
              key: "movimientos",
              header: "Movimientos",
              className: "px-6 py-4 text-right tabular-nums",
              render: (f) => f.movimientos,
            },
          ]}
          data={datos.porOrigen}
          rowKey={(f) => f.origen}
          emptyMessage="Sin salidas en el período."
        />
      </Bloque>

      <Bloque
        titulo="A qué pacientes se les aplicó"
        descripcion="Solo los movimientos ligados a un paciente. De cada fila se llega a su atención y a su lote."
      >
        <Table
          columns={[
            {
              key: "fecha",
              header: "Fecha",
              render: (f) => formatearFechaCorta(f.fecha, zonaHoraria),
            },
            { key: "paciente", header: "Paciente", render: (f) => f.paciente },
            { key: "cliente", header: "Cliente", render: (f) => f.cliente ?? "—" },
            {
              key: "cantidadBase",
              header: datos.unidadBase,
              className: "px-6 py-4 text-right tabular-nums",
              render: (f) => f.cantidadBase,
            },
            {
              key: "lote",
              header: "Lote",
              render: (f) => f.lote ?? "—",
            },
            {
              key: "_ir",
              header: "",
              render: (f) => (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/pacientes?id=${f.pacienteId}`)}
                >
                  Ver paciente →
                </Button>
              ),
            },
          ]}
          data={datos.pacientes}
          rowKey={(f) => `${f.pacienteId}-${f.fecha}-${f.cantidadBase}`}
          emptyMessage="Este producto no se aplicó a ningún paciente en el período."
        />
      </Bloque>

      {/* La trazabilidad por lote: el caso de la alerta del fabricante.
          Se entra por el lote que aparece en la tabla de arriba. */}
      {datos.pacientes.some((p) => p.lote) && (
        <Bloque
          titulo="Trazabilidad por lote"
          descripcion="Ante una alerta del fabricante: a quién se le aplicó cada lote."
        >
          <div className="flex flex-wrap gap-2">
            {[
              ...new Map(
                datos.pacientes
                  .filter((p) => p.loteId && p.lote)
                  .map((p) => [p.loteId!, { id: p.loteId!, numero: p.lote! }])
              ).values(),
            ].map((l) => (
              <Button key={l.id} variant="secondary" size="sm" onClick={() => setLote(l)}>
                Lote {l.numero}
              </Button>
            ))}
          </div>
        </Bloque>
      )}

      {lote && <ModalLote loteId={lote.id} numero={lote.numero} onCerrar={() => setLote(null)} />}
    </div>
  );
}

/** El lote y sus pacientes. */
function ModalLote({
  loteId,
  numero,
  onCerrar,
}: {
  loteId: string;
  numero: string;
  onCerrar: () => void;
}) {
  const { zonaHoraria } = useAuth();
  const [datos, setDatos] = useState<TrazabilidadLote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    metricasApi
      .trazabilidadLote(loteId)
      .then((t) => vivo && setDatos(t))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se pudo cargar el lote."));
    return () => {
      vivo = false;
    };
  }, [loteId]);

  return (
    <Modal
      open
      onClose={onCerrar}
      title={`Lote ${numero}`}
      description={
        datos
          ? `${datos.producto}${datos.vencimiento ? ` · vence el ${formatearFechaCorta(datos.vencimiento, zonaHoraria)}` : ""}`
          : undefined
      }
      ancho="xl"
    >
      {error && <EmptyState titulo="No se pudo cargar" texto={error} icono="aviso" />}
      {!datos && !error && <LoadingState />}
      {datos && (
        <div className="space-y-5">
          <Table
            columns={[
              {
                key: "fecha",
                header: "Fecha",
                render: (f) => formatearFechaCorta(f.fecha, zonaHoraria),
              },
              { key: "paciente", header: "Paciente", render: (f) => f.paciente },
              { key: "cliente", header: "Cliente", render: (f) => f.cliente ?? "—" },
              { key: "telefono", header: "Teléfono", render: (f) => f.telefono ?? "—" },
              {
                key: "avisar",
                header: "¿Se le puede escribir?",
                render: (f) =>
                  f.sePuedeAvisar ? (
                    <Badge variant="success">Sí, por correo</Badge>
                  ) : (
                    // NO SE ESCONDE al que no consintió: se dice que hay
                    // que llamarlo. Esconderlo haría que nadie lo
                    // contacte, que es lo contrario del objetivo.
                    <span className="text-xs text-warning">{f.motivoSiNo}</span>
                  ),
              },
            ]}
            data={datos.pacientes}
            rowKey={(f) => `${f.pacienteId}-${f.fecha}`}
            emptyMessage="Este lote no se aplicó a ningún paciente."
          />

          {datos.sinPaciente.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                Salidas del lote sin paciente
              </h4>
              <Table
                columns={[
                  {
                    key: "fecha",
                    header: "Fecha",
                    render: (f) => formatearFechaCorta(f.fecha, zonaHoraria),
                  },
                  { key: "nombre", header: "Origen", render: (f) => f.nombre },
                  {
                    key: "cantidadBase",
                    header: "Cantidad",
                    className: "px-6 py-4 text-right tabular-nums",
                    render: (f) => f.cantidadBase,
                  },
                ]}
                data={datos.sinPaciente}
                rowKey={(f) => `${f.origen}-${f.fecha}-${f.cantidadBase}`}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
