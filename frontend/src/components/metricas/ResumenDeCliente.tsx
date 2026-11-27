import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../ui/LoadingState";
import { Table } from "../ui/Table";
import { ChartBarras } from "../ui/charts";
import { Bloque } from "./Bloque";
import { ResumenCliente, metricasApi } from "../../lib/metricasApi";
import { colorDeLinea, ETIQUETA_LINEA_NEGOCIO, LineaNegocio } from "../../lib/paletaDatos";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { useAuth } from "../../hooks/useAuth";

// ---------------------------------------------------------------------
// §4 — EL RESUMEN DEL CLIENTE.
//
// La pestaña «Resumen» de la ficha, que anticipa la ficha 360 del 14 con
// lo que YA existe. Los bloques que dependen del 14 —oportunidades,
// respuesta a campañas— no se dibujan vacíos: cuando el 14 los
// construya, aparecen.
// ---------------------------------------------------------------------

const colones = (n: number) =>
  new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(n);

function etiquetaLinea(linea: string): string {
  return (
    ETIQUETA_LINEA_NEGOCIO[linea as LineaNegocio] ??
    (linea === "sin_linea" ? "Sin línea asignada" : linea)
  );
}

export function ResumenDeCliente({ propietarioId }: { propietarioId: string }) {
  const { zonaHoraria } = useAuth();
  const [datos, setDatos] = useState<ResumenCliente | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    metricasApi
      .cliente(propietarioId)
      .then((d) => vivo && setDatos(d))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se pudo cargar."));
    return () => {
      vivo = false;
    };
  }, [propietarioId]);

  if (error) return <EmptyState titulo="No se pudo cargar" texto={error} icono="aviso" />;
  if (!datos) return <LoadingState />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Dato etiqueta="Gasto acumulado" valor={colones(datos.gastoAcumulado)} />
        <Dato
          etiqueta="Saldo pendiente"
          valor={colones(datos.saldoPendiente)}
          aviso={datos.saldoVencido > 0 ? `${colones(datos.saldoVencido)} vencido` : undefined}
        />
        <Dato
          etiqueta="Visitas"
          valor={String(datos.visitas)}
          aviso={
            datos.frecuenciaDias !== null
              ? `una cada ${datos.frecuenciaDias} días`
              : "primera visita"
          }
        />
        <Dato
          etiqueta="Última visita"
          valor={
            datos.ultimaVisita ? formatearFechaCorta(datos.ultimaVisita, zonaHoraria) : "nunca"
          }
          aviso={
            datos.primeraVisita
              ? `cliente desde ${formatearFechaCorta(datos.primeraVisita, zonaHoraria)}`
              : undefined
          }
        />
      </div>

      {/* EL VALOR DEL CLIENTE. El margen aparece solo con permiso de
          costos; el proyectado es del 14 y no se inventa acá. */}
      <Bloque
        titulo="Valor del cliente"
        descripcion={
          datos.valor.margen === null
            ? "El margen requiere el permiso de ver costos."
            : datos.valor.sinCosto > 0
              ? `${datos.valor.sinCosto} ítem(s) sin costo cargado quedan fuera del margen.`
              : undefined
        }
      >
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted">Ingresos acumulados</p>
            <p className="text-xl font-bold">{colones(datos.valor.ingresos)}</p>
          </div>
          {datos.valor.margen !== null && (
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted">Margen acumulado</p>
              <p className="text-xl font-bold">{colones(datos.valor.margen)}</p>
            </div>
          )}
        </div>
      </Bloque>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Bloque titulo="En qué gasta">
          <ChartBarras
            datos={datos.gastoPorLinea.map((l) => ({
              etiqueta: etiquetaLinea(l.linea),
              valor: l.monto,
              color: colorDeLinea(l.linea),
            }))}
            orientacion="horizontal"
            alto={Math.max(160, datos.gastoPorLinea.length * 40)}
            formatearValor={colones}
            mensajeVacio="Todavía no compró nada."
          />
        </Bloque>

        <Bloque titulo="Los últimos doce meses">
          <ChartBarras
            datos={datos.tendencia.map((t) => ({ etiqueta: t.mes, valor: t.monto }))}
            alto={200}
            formatearValor={colones}
            mensajeVacio="Sin compras en el último año."
          />
        </Bloque>
      </div>

      <Bloque titulo="Sus mascotas">
        <Table
          columns={[
            { key: "nombre", header: "Nombre", render: (m) => m.nombre },
            { key: "especie", header: "Especie", render: (m) => m.especie },
            {
              key: "estado",
              header: "Estado",
              render: (m) => (
                <Badge variant={m.estado === "activo" ? "success" : "neutral"}>{m.estado}</Badge>
              ),
            },
            {
              key: "ultima",
              header: "Última visita",
              render: (m) =>
                m.ultimaVisita ? formatearFechaCorta(m.ultimaVisita, zonaHoraria) : "—",
            },
            {
              key: "preventivos",
              header: "Preventivos vencidos",
              className: "px-6 py-4 text-right tabular-nums",
              render: (m) =>
                m.preventivosVencidos > 0 ? (
                  <span className="text-warning">{m.preventivosVencidos}</span>
                ) : (
                  "0"
                ),
            },
          ]}
          data={datos.mascotas}
          rowKey={(m) => m.id}
          emptyMessage="No tiene mascotas registradas."
        />
      </Bloque>

      {datos.preventivosPendientes.length > 0 && (
        <Bloque
          titulo="Preventivos pendientes"
          descripcion="De todas sus mascotas, vencidos o por vencer en 30 días."
        >
          <Table
            columns={[
              { key: "paciente", header: "Paciente", render: (p) => p.paciente },
              {
                key: "tipo",
                header: "Qué",
                render: (p) => `${p.tipo}${p.detalle ? ` · ${p.detalle}` : ""}`,
              },
              {
                key: "fecha",
                header: "Correspondía",
                render: (p) => formatearFechaCorta(p.fecha, zonaHoraria),
              },
              {
                key: "dias",
                header: "",
                render: (p) =>
                  p.dias > 0 ? (
                    <Badge variant="error">{p.dias} días vencido</Badge>
                  ) : (
                    <Badge variant="warning">en {Math.abs(p.dias)} días</Badge>
                  ),
              },
            ]}
            data={datos.preventivosPendientes}
            rowKey={(p) => `${p.pacienteId}-${p.tipo}-${p.fecha}`}
          />
        </Bloque>
      )}
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  aviso,
}: {
  etiqueta: string;
  valor: string;
  aviso?: string;
}) {
  return (
    <div className="rounded-xl bg-background p-4">
      <p className="text-xs uppercase tracking-wide text-text-muted">{etiqueta}</p>
      <p className="mt-1 text-lg font-bold text-text-primary">{valor}</p>
      {aviso && <p className="mt-0.5 text-xs text-text-muted">{aviso}</p>}
    </div>
  );
}
