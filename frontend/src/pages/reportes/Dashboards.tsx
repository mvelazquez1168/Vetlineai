import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Tabs } from "../../components/ui/Tabs";
import { Bloque } from "../../components/metricas/Bloque";
import { Table } from "../../components/ui/Table";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { MenuExportar } from "../../components/ui/MenuExportar";
import { ControlSegmentado } from "../../components/ui/ControlSegmentado";
import { SelectorPeriodo, Periodo, construirPeriodo } from "../../components/ui/SelectorPeriodo";
import { ChartBarras, ChartDona, ChartLinea } from "../../components/ui/charts";
import { useToast } from "../../components/ui/Toast";
import { guardarComoArchivo } from "../../lib/descargas";
import { colorDeLinea, ETIQUETA_LINEA_NEGOCIO, LineaNegocio } from "../../lib/paletaDatos";
import { fechaHoyEnZona, formatearFechaCorta } from "../../lib/formatFecha";

import { useAuth } from "../../hooks/useAuth";
import {
  DashboardClinica,
  DashboardMedico,
  DefinicionMetrica,
  metricasApi,
} from "../../lib/metricasApi";
import {
  TarjetasDeMetricas,
  formatearValorDeMetrica,
} from "../../components/metricas/TarjetasDeMetricas";

// ---------------------------------------------------------------------
// LOS DASHBOARDS — prompt 12, §2 y §3.
//
// Dos pestañas: la clínica y los médicos. El período y la comparación
// son los mismos controles del sistema de diseño, y el drill-down es un
// clic en cualquier tarjeta, barra o sector: la URL de la lista lleva el
// mismo período, así que el enlace se puede compartir.
//
// CADA BLOQUE SE PINTA CUANDO LLEGA SU DATO (§9) hasta donde el backend
// lo permite: hoy el dashboard viene en una sola respuesta —tarda 150 ms
// con un año de datos—, así que partirlo en seis llamadas agregaría
// latencia de red en vez de quitarla. Si algún día un bloque se vuelve
// caro, se parte ese y no los seis.
// ---------------------------------------------------------------------

const ETIQUETA_MEDIO: Record<string, string> = {
  "01": "Efectivo",
  "02": "Tarjeta",
  "03": "Cheque",
  "04": "Transferencia",
  "05": "Recaudado por terceros",
  "06": "SINPE Móvil",
  "07": "Plataforma digital",
  "99": "Otros",
  credito: "Crédito del cliente",
  anticipo: "Anticipo",
};

function etiquetaLinea(linea: string): string {
  return (
    ETIQUETA_LINEA_NEGOCIO[linea as LineaNegocio] ??
    (linea === "sin_linea" ? "Sin línea asignada" : linea)
  );
}

export function Dashboards() {
  const { zonaHoraria } = useAuth();
  const navigate = useNavigate();
  const [diccionario, setDiccionario] = useState<DefinicionMetrica[]>([]);

  useEffect(() => {
    metricasApi
      .diccionario()
      .then((r) => setDiccionario(r.metricas))
      .catch(() => setDiccionario([]));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Reportes"
        subtitulo="Cómo va la clínica, y de cada número a la lista que lo explica"
        icono="reportes"
        modulo="admin"
        secundarias={
          // El reporte de atenciones ya existía en su propia ruta. Se
          // llega desde acá para que no quede huérfano al pasar el menú
          // a esta pantalla: una pantalla a la que no se llega no existe.
          <Button variant="secondary" onClick={() => navigate("/admin/reporte-atenciones")}>
            Reporte de atenciones
          </Button>
        }
      />
      <Tabs
        pestanas={[
          { clave: "clinica", etiqueta: "Clínica" },
          { clave: "medicos", etiqueta: "Médicos" },
        ]}
      >
        {(pestana) =>
          pestana === "clinica" ? (
            <PanelClinica diccionario={diccionario} zona={zonaHoraria} />
          ) : (
            <PanelMedicos diccionario={diccionario} zona={zonaHoraria} />
          )
        }
      </Tabs>
    </div>
  );
}

// =====================================================================
// §2 — LA CLÍNICA
// =====================================================================
function PanelClinica({
  diccionario,
  zona,
}: {
  diccionario: DefinicionMetrica[];
  zona: string | null;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const hoy = fechaHoyEnZona(zona);
  const [periodo, setPeriodo] = useState<Periodo>(() => construirPeriodo("mes", hoy, true));
  const [datos, setDatos] = useState<DashboardClinica | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topPor, setTopPor] = useState<"ingresos" | "margen">("ingresos");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await metricasApi.clinica(periodo.desde, periodo.hasta));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el dashboard.");
    } finally {
      setCargando(false);
    }
  }, [periodo.desde, periodo.hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const irALista = (clave: string) =>
    navigate(`/reportes/lista/${clave}?desde=${periodo.desde}&hasta=${periodo.hasta}`);

  const exportar = async (formato: "excel" | "pdf") => {
    try {
      const blob = await metricasApi.exportarDashboard(periodo.desde, periodo.hasta, formato);
      guardarComoArchivo(
        blob,
        `dashboard-${periodo.desde}-${periodo.hasta}.${formato === "excel" ? "xlsx" : "pdf"}`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo exportar.");
    }
  };

  const datosLinea = useMemo(
    () =>
      (datos?.porLinea ?? []).map((l) => ({
        etiqueta: etiquetaLinea(l.linea),
        valor: l.ingresos,
        color: colorDeLinea(l.linea),
        clave: l.linea,
      })),
    [datos]
  );

  const top = topPor === "margen" ? datos?.topPorMargen : datos?.topPorIngresos;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SelectorPeriodo valor={periodo} onCambio={setPeriodo} />
        <MenuExportar onExportar={exportar} deshabilitado={!datos} />
      </div>

      {cargando && <LoadingState />}
      {error && <EmptyState titulo="No se pudo cargar" texto={error} icono="aviso" />}

      {datos && !cargando && (
        <>
          <TarjetasDeMetricas
            tarjetas={datos.tarjetas}
            diccionario={diccionario}
            alAbrirLista={irALista}
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Bloque titulo="Ingresos por línea de negocio">
              <ChartDona
                datos={datosLinea}
                centro={formatearValorDeMetrica(
                  datos.tarjetas.find((t) => t.clave === "ingresos")?.valor ?? 0,
                  "dinero"
                )}
                centroDetalle="del período"
                formatearValor={(v) => formatearValorDeMetrica(v, "dinero")}
                alClic={() => irALista("ingresos")}
                mensajeVacio="Sin ventas en el período."
              />
            </Bloque>

            <Bloque titulo="Tendencia de ingresos">
              <ChartLinea
                etiquetas={datos.tendencia.map((p) => formatearFechaCorta(p.fecha, zona))}
                series={[{ nombre: "Ingresos", valores: datos.tendencia.map((p) => p.valor) }]}
                formatearValor={(v) => formatearValorDeMetrica(v, "dinero")}
                alClic={() => irALista("ingresos")}
                mensajeVacio="Sin ventas en el período."
              />
            </Bloque>
          </div>

          {/* EL MARGEN SOLO CON PERMISO (§10). Sin `catalogo.ver_costos`
              el backend no manda el costo, así que acá no hay nada que
              esconder: el bloque simplemente no existe. */}
          {datos.verCostos && (
            <Bloque
              titulo="Margen por línea de negocio"
              descripcion={
                datos.sinCosto > 0
                  ? `${datos.sinCosto} ítem(s) vendidos sin costo cargado: su margen no se puede calcular y no se cuenta como 100 %.`
                  : undefined
              }
            >
              <ChartBarras
                datos={datos.porLinea.map((l) => ({
                  etiqueta: etiquetaLinea(l.linea),
                  valor: l.margen,
                  color: colorDeLinea(l.linea),
                  clave: l.linea,
                }))}
                orientacion="horizontal"
                formatearValor={(v) => formatearValorDeMetrica(v, "dinero")}
                mensajeVacio="Sin datos en el período."
              />
            </Bloque>
          )}

          <Bloque
            titulo="Top 10"
            acciones={
              datos.verCostos ? (
                <ControlSegmentado
                  etiqueta="Ordenar el top por"
                  valor={topPor}
                  opciones={[
                    { valor: "ingresos", etiqueta: "Por ingresos" },
                    { valor: "margen", etiqueta: "Por margen" },
                  ]}
                  onCambio={(v) => setTopPor(v)}
                />
              ) : undefined
            }
          >
            <Table
              columns={[
                { key: "item", header: "Producto o servicio", render: (f) => f.item },
                {
                  key: "tipo",
                  header: "Tipo",
                  render: (f) => (
                    <Badge variant={f.tipo === "servicio" ? "info" : "neutral"}>
                      {f.tipo === "servicio" ? "Servicio" : "Producto"}
                    </Badge>
                  ),
                },
                {
                  key: "cantidad",
                  header: "Cantidad",
                  className: "px-6 py-4 text-right tabular-nums",
                  render: (f) => f.cantidad,
                },
                {
                  key: "ingresos",
                  header: "Ingresos",
                  className: "px-6 py-4 text-right tabular-nums",
                  render: (f) => formatearValorDeMetrica(f.ingresos, "dinero"),
                },
                ...(datos.verCostos
                  ? [
                      {
                        key: "margen",
                        header: "Margen",
                        className: "px-6 py-4 text-right tabular-nums",
                        render: (f: (typeof datos.topPorIngresos)[number]) =>
                          // SIN COSTO NO ES 100 % DE MARGEN: se dice.
                          f.sin_costo ? (
                            <span className="text-warning">sin costo</span>
                          ) : (
                            formatearValorDeMetrica(f.margen, "dinero")
                          ),
                      },
                    ]
                  : []),
              ]}
              data={top ?? []}
              rowKey={(f) => `${f.tipo}-${f.item}`}
              emptyMessage="Sin ventas en el período."
            />
          </Bloque>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Bloque titulo="Agenda: ocupación por médico">
              <ChartBarras
                series={[
                  {
                    nombre: "Citas",
                    valores: datos.agenda.porMedico.map((m) => m.citas),
                  },
                  {
                    nombre: "No presentadas",
                    valores: datos.agenda.porMedico.map((m) => m.noShow),
                  },
                ]}
                etiquetas={datos.agenda.porMedico.map((m) => m.medico)}
                apiladas
                alClic={() => irALista("inasistencias")}
                mensajeVacio="Sin citas en el período."
              />
            </Bloque>

            <Bloque titulo="Inasistencias por motivo">
              <ChartBarras
                datos={datos.agenda.inasistenciasPorMotivo.map((m) => ({
                  etiqueta: m.motivo,
                  valor: m.cantidad,
                }))}
                orientacion="horizontal"
                alClic={() => irALista("inasistencias")}
                mensajeVacio="Nadie faltó en el período."
              />
            </Bloque>

            <Bloque titulo="Cobros por medio de pago">
              <ChartDona
                datos={datos.cobrosPorMedio.map((m) => ({
                  etiqueta: ETIQUETA_MEDIO[m.medio] ?? m.medio,
                  valor: m.monto,
                }))}
                formatearValor={(v) => formatearValorDeMetrica(v, "dinero")}
                mensajeVacio="Sin cobros en el período."
              />
            </Bloque>

            <Bloque titulo="Clientes">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">Nuevos en el período</dt>
                  <dd className="font-semibold">{datos.clientes.nuevos}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">Volvieron del período anterior</dt>
                  <dd className="font-semibold">{datos.clientes.recurrentes}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">Retención</dt>
                  <dd className="font-semibold">
                    {datos.clientes.retencion === null
                      ? "sin período anterior con actividad"
                      : `${datos.clientes.retencion} %`}
                  </dd>
                </div>
              </dl>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={() => irALista("clientes_nuevos")}
              >
                Ver los clientes nuevos →
              </Button>
            </Bloque>
          </div>

          <Bloque titulo="Inventario crítico" descripcion="Los mismos números del módulo de Inventario">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                { etiqueta: "Bajo el mínimo", valor: datos.inventarioCritico.bajoMinimo },
                { etiqueta: "Por vencer en 30 días", valor: datos.inventarioCritico.porVencer },
                {
                  etiqueta: "Vencidos con existencia",
                  valor: datos.inventarioCritico.vencidosConExistencia,
                },
              ].map((b) => (
                <div key={b.etiqueta} className="rounded-xl bg-background p-4">
                  <p className="text-xs uppercase tracking-wide text-text-muted">{b.etiqueta}</p>
                  <p className="mt-1 text-xl font-bold">{b.valor}</p>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => navigate("/inventario/alertas")}
            >
              Ver las alertas del inventario →
            </Button>
          </Bloque>

          {/* El bloque de campañas aparece SOLO si hay campañas con
              datos. Mientras el 14 no las construya, no se muestra un
              bloque vacío que diga «0». */}
          {datos.campanas && (
            <Bloque titulo="Resultado de campañas">
              <Table
                columns={[
                  { key: "campana", header: "Campaña", render: (f) => f.campana },
                  { key: "enviados", header: "Enviados", render: (f) => f.enviados },
                  { key: "respondieron", header: "Respondieron", render: (f) => f.respondieron },
                ]}
                data={datos.campanas}
                rowKey={(f) => f.campana}
              />
            </Bloque>
          )}
        </>
      )}
    </div>
  );
}

// =====================================================================
// §3 — LOS MÉDICOS
// =====================================================================
function PanelMedicos({
  diccionario,
  zona,
}: {
  diccionario: DefinicionMetrica[];
  zona: string | null;
}) {
  const navigate = useNavigate();
  const { puede } = useAuth();
  const hoy = fechaHoyEnZona(zona);
  const [periodo, setPeriodo] = useState<Periodo>(() => construirPeriodo("mes", hoy, true));
  const puedeVerOtros = puede("reportes.ver");
  const [medicoId, setMedicoId] = useState<string>("");
  const [datos, setDatos] = useState<DashboardMedico | null>(null);
  const [comparativa, setComparativa] = useState<
    Array<{
      medicoId: string;
      medico: string;
      atenciones: number;
      facturado: number;
      ticket: number;
      noShow: number;
    }>
  >([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    metricasApi
      .medico(periodo.desde, periodo.hasta, medicoId || null)
      .then((d) => vivo && setDatos(d))
      .catch(() => vivo && setDatos(null))
      .finally(() => vivo && setCargando(false));
    if (puedeVerOtros) {
      metricasApi
        .comparativa(periodo.desde, periodo.hasta)
        .then((r) => vivo && setComparativa(r.medicos))
        .catch(() => vivo && setComparativa([]));
    }
    return () => {
      vivo = false;
    };
  }, [periodo.desde, periodo.hasta, medicoId, puedeVerOtros]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <SelectorPeriodo valor={periodo} onCambio={setPeriodo} />
        {/* El selector de médico SOLO para quien puede ver a otros. Un
            médico sin ese permiso ve lo suyo y no hay un selector que le
            sugiera que podría ver más. */}
        {puedeVerOtros && comparativa.length > 0 && (
          <Select
            label="Médico"
            value={medicoId}
            onChange={(e) => setMedicoId(e.target.value)}
            options={[
              { value: "", label: "Mi dashboard" },
              ...comparativa.map((m) => ({ value: m.medicoId, label: m.medico })),
            ]}
          />
        )}
      </div>

      {cargando && <LoadingState />}

      {datos && !cargando && (
        <>
          <h2 className="text-lg font-bold text-text-primary">{datos.medico}</h2>
          <TarjetasDeMetricas tarjetas={datos.tarjetas} diccionario={diccionario} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Bloque titulo="Agenda de hoy">
              <Table
                columns={[
                  { key: "hora", header: "Hora", render: (f) => String(f.hora).slice(0, 5) },
                  { key: "paciente", header: "Paciente", render: (f) => String(f.paciente) },
                  {
                    key: "estado",
                    header: "Estado",
                    render: (f) => <Badge variant="neutral">{String(f.estado)}</Badge>,
                  },
                ]}
                data={datos.agendaHoy}
                rowKey={(f) => String(f.id)}
                emptyMessage="No tenés citas hoy."
              />
            </Bloque>

            <Bloque titulo="La semana">
              <ChartBarras
                datos={datos.agendaSemana.map((d) => ({
                  etiqueta: formatearFechaCorta(d.fecha, zona),
                  valor: d.citas,
                }))}
                mensajeVacio="Sin citas en los próximos siete días."
              />
            </Bloque>
          </div>

          {/* LA LISTA ACCIONABLE del §3: controles que él recomendó y el
              cliente nunca agendó. Es la única forma, hoy, de ver cuánto
              control recomendado se pierde. */}
          <Bloque
            titulo="Recomendaciones no agendadas"
            descripcion="Controles que recomendaste y el cliente no agendó"
          >
            <Table
              columns={[
                { key: "fecha", header: "Recomendado para", render: (f) => formatearFechaCorta(String(f.fecha), zona) },
                { key: "paciente", header: "Paciente", render: (f) => String(f.paciente) },
                { key: "cliente", header: "Cliente", render: (f) => String(f.cliente ?? "—") },
                { key: "telefono", header: "Teléfono", render: (f) => String(f.telefono ?? "—") },
                { key: "motivo", header: "Motivo", render: (f) => String(f.motivo ?? "—") },
                {
                  key: "_ir",
                  header: "",
                  render: (f) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/agenda?paciente=${f.paciente_id}`)}
                    >
                      Agendar →
                    </Button>
                  ),
                },
              ]}
              data={datos.recomendacionesNoAgendadas}
              rowKey={(f) => `${f.paciente_id}-${f.fecha}`}
              emptyMessage="Todo lo que recomendaste está agendado."
            />
          </Bloque>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Bloque titulo="Seguimientos pendientes">
              <Table
                columns={[
                  { key: "fecha", header: "Fecha", render: (f) => formatearFechaCorta(String(f.fecha), zona) },
                  { key: "paciente", header: "Paciente", render: (f) => String(f.paciente) },
                  { key: "motivo", header: "Qué", render: (f) => String(f.motivo ?? "—") },
                  {
                    key: "clase",
                    header: "",
                    render: (f) => (
                      <Badge variant={f.clase === "preventivo" ? "warning" : "info"}>
                        {f.clase === "preventivo" ? "Preventivo vencido" : "Control"}
                      </Badge>
                    ),
                  },
                ]}
                data={datos.seguimientos}
                rowKey={(f) => `${f.paciente_id}-${f.fecha}-${f.clase}`}
                emptyMessage="Sin seguimientos pendientes."
              />
            </Bloque>

            <Bloque titulo="Laboratorio sin ver">
              <Table
                columns={[
                  { key: "fecha", header: "Resultado", render: (f) => formatearFechaCorta(String(f.fecha), zona) },
                  { key: "paciente", header: "Paciente", render: (f) => String(f.paciente) },
                  { key: "tipo_estudio", header: "Estudio", render: (f) => String(f.tipo_estudio) },
                ]}
                data={datos.laboratorioSinVer}
                rowKey={(f) => String(f.id)}
                emptyMessage="No tenés resultados sin mirar."
              />
            </Bloque>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Bloque titulo="Lo que facturaste, por línea">
              <ChartBarras
                datos={datos.porLinea.map((l) => ({
                  etiqueta: etiquetaLinea(l.linea),
                  valor: l.ingresos,
                  color: colorDeLinea(l.linea),
                }))}
                orientacion="horizontal"
                formatearValor={(v) => formatearValorDeMetrica(v, "dinero")}
                mensajeVacio="Sin cargos en el período."
              />
            </Bloque>
            <Bloque titulo="Tus servicios más hechos">
              <Table
                columns={[
                  { key: "item", header: "Servicio", render: (f) => f.item },
                  {
                    key: "cantidad",
                    header: "Cantidad",
                    className: "px-6 py-4 text-right tabular-nums",
                    render: (f) => f.cantidad,
                  },
                  {
                    key: "ingresos",
                    header: "Ingresos",
                    className: "px-6 py-4 text-right tabular-nums",
                    render: (f) => formatearValorDeMetrica(f.ingresos, "dinero"),
                  },
                ]}
                data={datos.topServicios}
                rowKey={(f) => f.item}
                emptyMessage="Sin cargos en el período."
              />
            </Bloque>
          </div>
        </>
      )}

      {/* LA COMPARATIVA ES DEL ADMINISTRADOR (§10). Un médico no ve la
          facturación de sus colegas. */}
      {puedeVerOtros && comparativa.length > 0 && (
        <Bloque titulo="Comparativa entre médicos">
          <Table
            columns={[
              { key: "medico", header: "Médico", render: (f) => f.medico },
              {
                key: "atenciones",
                header: "Atenciones",
                className: "px-6 py-4 text-right tabular-nums",
                render: (f) => f.atenciones,
              },
              {
                key: "facturado",
                header: "Facturado",
                className: "px-6 py-4 text-right tabular-nums",
                render: (f) => formatearValorDeMetrica(f.facturado, "dinero"),
              },
              {
                key: "ticket",
                header: "Ticket",
                className: "px-6 py-4 text-right tabular-nums",
                render: (f) => formatearValorDeMetrica(f.ticket, "dinero"),
              },
              {
                key: "noShow",
                header: "No presentadas",
                className: "px-6 py-4 text-right tabular-nums",
                render: (f) => f.noShow,
              },
              {
                key: "_ver",
                header: "",
                render: (f) => (
                  <Button variant="ghost" size="sm" onClick={() => setMedicoId(f.medicoId)}>
                    Ver su dashboard →
                  </Button>
                ),
              },
            ]}
            data={comparativa}
            rowKey={(f) => f.medicoId}
          />
        </Bloque>
      )}
    </div>
  );
}
