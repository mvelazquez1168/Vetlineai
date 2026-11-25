import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  ChartArea,
  ChartBarras,
  ChartDona,
  ChartLinea,
  EmptyState,
  Icono,
  Input,
  KpiCard,
  LoadingState,
  MenuExportar,
  Modal,
  NOMBRES_ICONO,
  Pagination,
  Periodo,
  ProgressBar,
  Select,
  SelectorPeriodo,
  Sparkline,
  Table,
  periodoPorDefecto,
  useToast,
} from "../../components/ui";
import { AnchoModal } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import {
  COLOR_LINEA_NEGOCIO,
  ETIQUETA_LINEA_NEGOCIO,
  LINEAS_NEGOCIO,
  PALETA_DATOS,
  colorDeLinea,
} from "../../lib/paletaDatos";

// ---------------------------------------------------------------------
// Muestrario del sistema de diseño — SOLO EN DESARROLLO.
//
// Para qué sirve: revisar de un vistazo todos los componentes nuevos y
// sus variantes, en vez de ir pantalla por pantalla buscando dónde se
// usa cada uno. También es el lugar donde se ve si dos componentes se
// pelean visualmente entre sí, que es lo que no se nota mirándolos de a
// uno.
//
// La ruta está condicionada a `import.meta.env.DEV` en App.tsx, así que
// no existe en el build de producción.
// ---------------------------------------------------------------------

const DATOS_LINEAS = LINEAS_NEGOCIO.map((linea, i) => ({
  etiqueta: ETIQUETA_LINEA_NEGOCIO[linea],
  valor: 120000 - i * 9000,
  color: COLOR_LINEA_NEGOCIO[linea],
  clave: linea,
}));

const MESES = ["Jun", "Jul", "Ago", "Set", "Oct", "Nov"];

const SERIES_TIEMPO = [
  { nombre: "Consulta", color: colorDeLinea("consulta"), valores: [42, 48, 45, 52, 58, 61] },
  { nombre: "Farmacia", color: colorDeLinea("farmacia"), valores: [28, 31, 34, 30, 38, 41] },
  { nombre: "Grooming", color: colorDeLinea("grooming"), valores: [12, 14, 19, 17, 22, 26] },
];

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold text-primary">{titulo}</h2>
      {nota && <p className="mt-1 max-w-3xl text-sm text-text-muted">{nota}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Muestrario() {
  const toast = useToast();
  const { zonaHoraria } = useAuth();
  const [periodo, setPeriodo] = useState<Periodo>(periodoPorDefecto(zonaHoraria));
  const [paginaDemo, setPaginaDemo] = useState(1);
  const [modalAbierto, setModalAbierto] = useState<AnchoModal | null>(null);
  const [ultimoClic, setUltimoClic] = useState<string>("—");

  return (
    <div className="min-h-screen bg-background p-6 sm:p-10">
      <header>
        <h1 className="text-2xl font-bold text-primary">Muestrario del sistema de diseño</h1>
        <p className="mt-1 max-w-3xl text-text-muted">
          Solo visible en desarrollo. Todo lo que está acá sale de{" "}
          <code className="rounded bg-black/5 px-1">components/ui/</code> y de los tokens de{" "}
          <code className="rounded bg-black/5 px-1">tailwind.config.js</code>: si algo se ve distinto
          en una pantalla real, la pantalla está divergiendo.
        </p>
      </header>

      <Seccion
        titulo="Paleta de datos"
        nota="Diez colores categóricos, en orden de luminosidad creciente. Contraste mínimo 3.39:1 sobre blanco y 3.17:1 sobre el crema; separación perceptual mínima ΔE2000 18.7. Medidos por scripts/verificar-paleta-datos.mjs."
      >
        <div className="flex flex-wrap gap-2">
          {PALETA_DATOS.map((hex, i) => (
            <div key={hex} className="w-28 overflow-hidden rounded-lg border border-black/5">
              <div className="h-14" style={{ backgroundColor: hex }} />
              <div className="bg-surface px-2 py-1">
                <p className="font-mono text-xs text-text-primary">datos-{i + 1}</p>
                <p className="font-mono text-[10px] text-text-muted">{hex}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm font-semibold text-text-primary">Color fijo por línea de negocio</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {LINEAS_NEGOCIO.map((linea) => (
            <span
              key={linea}
              className="flex items-center gap-2 rounded-full border border-black/5 bg-surface px-3 py-1 text-xs text-text-primary"
            >
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorDeLinea(linea) }} />
              {ETIQUETA_LINEA_NEGOCIO[linea]}
            </span>
          ))}
        </div>
      </Seccion>

      <Seccion
        titulo="Íconos"
        nota={`${NOMBRES_ICONO.length} íconos disponibles, todos a través del componente Icono. Ninguna pantalla importa lucide-react directamente.`}
      >
        <div className="flex flex-wrap gap-3">
          {NOMBRES_ICONO.map((nombre) => (
            <div
              key={nombre}
              className="flex w-24 flex-col items-center gap-1 rounded-lg border border-black/5 bg-surface p-2"
            >
              <span className="text-text-primary">
                <Icono nombre={nombre} tamano={20} />
              </span>
              <span className="truncate text-[10px] text-text-muted" title={nombre}>
                {nombre}
              </span>
            </div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Botones y controles">
        <div className="flex flex-wrap items-end gap-3">
          <Button>Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="danger">Peligro</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button size="sm">Chico</Button>
          <Button disabled>Deshabilitado</Button>
        </div>
        <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
          <Input label="Campo de texto" placeholder="Escribí algo…" />
          <Input label="Con error" error="Este campo es obligatorio." defaultValue="valor inválido" />
          <Select
            label="Selector"
            options={[
              { value: "a", label: "Opción A" },
              { value: "b", label: "Opción B" },
            ]}
          />
          <div>
            <p className="text-sm font-semibold text-text-primary">Barra de progreso</p>
            <ProgressBar value={68} className="mt-3" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="success" dot>
            Activo
          </Badge>
          <Badge variant="warning">Pendiente</Badge>
          <Badge variant="error">Rechazado</Badge>
          <Badge variant="info">Información</Badge>
          <Badge variant="neutral">Neutro</Badge>
        </div>
      </Seccion>

      <Seccion titulo="Avisos (Toast)" nota="Un solo proveedor y un solo hook: useToast().">
        <div className="flex flex-wrap gap-3">
          <Button size="sm" onClick={() => toast.exito("Ficha guardada.")}>
            Éxito
          </Button>
          <Button size="sm" variant="secondary" onClick={() => toast.aviso("Hay cambios sin guardar.")}>
            Aviso
          </Button>
          <Button size="sm" variant="danger" onClick={() => toast.error("No se pudo guardar. Reintentá.")}>
            Error
          </Button>
        </div>
      </Seccion>

      <Seccion titulo="Modales" nota="Mismo componente, cuatro anchos. Los 16 usos existentes siguen en el default (md).">
        <div className="flex flex-wrap gap-3">
          {(["sm", "md", "lg", "xl"] as AnchoModal[]).map((ancho) => (
            <Button key={ancho} size="sm" variant="secondary" onClick={() => setModalAbierto(ancho)}>
              Abrir {ancho}
            </Button>
          ))}
        </div>
        <Modal
          open={modalAbierto !== null}
          onClose={() => setModalAbierto(null)}
          title={`Modal ancho="${modalAbierto ?? ""}"`}
          description="El contenido alto hace scroll adentro del modal, no en la página."
          ancho={modalAbierto ?? "md"}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalAbierto(null)}>
                Cancelar
              </Button>
              <Button onClick={() => setModalAbierto(null)}>Confirmar</Button>
            </>
          }
        >
          <p className="text-sm text-text-muted">
            sm 384px · md 448px (default histórico) · lg 672px · xl 896px.
          </p>
        </Modal>
      </Seccion>

      <Seccion titulo="Estados: carga y vacío">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-text-primary">LoadingState — líneas</p>
            <LoadingState forma="lineas" cantidad={3} />
            <p className="mb-2 mt-6 text-sm font-semibold text-text-primary">LoadingState — tabla</p>
            <LoadingState forma="tabla" cantidad={3} />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-text-primary">LoadingState — tarjetas</p>
            <LoadingState forma="tarjetas" cantidad={3} />
            <p className="mb-2 mt-6 text-sm font-semibold text-text-primary">EmptyState</p>
            <EmptyState
              icono="paciente"
              titulo="Todavía no hay pacientes"
              texto="Los pacientes se dan de alta al crear un caso o al agendar una cita, y aparecen acá."
              accion={<Button size="sm">Nuevo paciente</Button>}
            />
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Tabla y paginación">
        <Table
          columns={[
            { key: "linea", header: "Línea de negocio", render: (f: any) => f.etiqueta },
            {
              key: "color",
              header: "Color",
              render: (f: any) => (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: f.color }} />
                  <span className="font-mono text-xs text-text-muted">{f.color}</span>
                </span>
              ),
            },
            {
              key: "valor",
              header: "Ingresos",
              render: (f: any) => `₡${f.valor.toLocaleString("es-CR")}`,
            },
          ]}
          data={DATOS_LINEAS.slice((paginaDemo - 1) * 4, paginaDemo * 4)}
          rowKey={(f: any) => f.clave}
        />
        <Pagination
          pagina={paginaDemo}
          total={DATOS_LINEAS.length}
          porPagina={4}
          onPagina={setPaginaDemo}
          sustantivo={{ singular: "línea", plural: "líneas" }}
        />
      </Seccion>

      <Seccion
        titulo="Período y exportación"
        nota="Las fechas se resuelven en la zona horaria del tenant, por formatFecha. El menú de exportar fija el contrato; la exportación real llega con los dashboards."
      >
        <SelectorPeriodo valor={periodo} onCambio={setPeriodo} />
        <div className="mt-4 flex items-center gap-4">
          <MenuExportar onExportar={(formato) => toast.aviso(`Exportar ${formato}: pendiente del backend.`)} />
          <code className="rounded bg-black/5 px-2 py-1 text-xs text-text-muted">
            {JSON.stringify({ desde: periodo.desde, hasta: periodo.hasta, anterior: periodo.anterior })}
          </code>
        </div>
      </Seccion>

      <Seccion titulo="Indicadores (KpiCard)" nota="El color de la variación sale de `sentido`, no del signo: subir no siempre es bueno.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            titulo="Ingresos del mes"
            valor="₡4.820.000"
            variacionPorcentaje={12.4}
            tendencia={[31, 34, 33, 39, 42, 48]}
            detalle="30 días vs. 30 anteriores"
            alClic={() => setUltimoClic("KpiCard: Ingresos")}
          />
          <KpiCard
            titulo="Inasistencias"
            valor="8,2%"
            variacionPorcentaje={6.1}
            sentido="subir_es_malo"
            tendencia={[5, 6, 6, 7, 8, 8]}
            detalle="subir es malo: la flecha va en rojo"
          />
          <KpiCard
            titulo="Atenciones"
            valor="312"
            variacionPorcentaje={-2.3}
            sentido="neutro"
            detalle="sentido neutro: sin color"
          />
          <KpiCard titulo="Clientes nuevos" valor="19" variacionPorcentaje={null} detalle="sin período anterior" />
        </div>
      </Seccion>

      <Seccion
        titulo="Charts"
        nota={`Todos aceptan clic por elemento, porque el drill-down es obligatorio. Último clic: ${ultimoClic}`}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Barras verticales</CardTitle>
            <CardDescription>Un color fijo por línea de negocio</CardDescription>
            <ChartBarras
              datos={DATOS_LINEAS.slice(0, 6)}
              formatearValor={(v) => `₡${(v / 1000).toFixed(0)}k`}
              alClic={(p) => setUltimoClic(`Barra ${p.etiqueta} = ${p.valor} (clave: ${p.clave})`)}
            />
          </Card>
          <Card>
            <CardTitle>Barras horizontales</CardTitle>
            <CardDescription>Mismo componente, orientación distinta</CardDescription>
            <ChartBarras
              datos={DATOS_LINEAS.slice(0, 6)}
              orientacion="horizontal"
              formatearValor={(v) => `₡${(v / 1000).toFixed(0)}k`}
              alClic={(p) => setUltimoClic(`Barra horizontal ${p.etiqueta}`)}
            />
          </Card>
          <Card>
            <CardTitle>Barras apiladas</CardTitle>
            <ChartBarras
              series={SERIES_TIEMPO}
              etiquetas={MESES}
              apiladas
              alClic={(p) => setUltimoClic(`Apilada ${p.serie} / ${p.etiqueta} = ${p.valor}`)}
            />
          </Card>
          <Card>
            <CardTitle>Líneas</CardTitle>
            <ChartLinea
              series={SERIES_TIEMPO}
              etiquetas={MESES}
              conPuntos
              alClic={(p) => setUltimoClic(`Línea ${p.serie} / ${p.etiqueta}`)}
            />
          </Card>
          <Card>
            <CardTitle>Área apilada</CardTitle>
            <ChartArea
              series={SERIES_TIEMPO}
              etiquetas={MESES}
              alClic={(p) => setUltimoClic(`Área ${p.serie} / ${p.etiqueta}`)}
            />
          </Card>
          <Card>
            <CardTitle>Dona</CardTitle>
            <CardDescription>Con el total en el centro</CardDescription>
            <ChartDona
              datos={DATOS_LINEAS.slice(0, 5)}
              centro="₡512k"
              centroDetalle="total del mes"
              formatearValor={(v) => `₡${(v / 1000).toFixed(0)}k`}
              alClic={(p) => setUltimoClic(`Sector ${p.etiqueta}`)}
            />
          </Card>
          <Card>
            <CardTitle>Sparkline</CardTitle>
            <CardDescription>Sin ejes ni tooltip: es un glifo, no un chart chico</CardDescription>
            <div className="mt-4 flex items-center gap-6">
              <Sparkline valores={[12, 15, 14, 19, 23, 28]} className="w-32" />
              <Sparkline valores={[28, 23, 19, 14, 15, 12]} className="w-32" color={colorDeLinea("cirugia")} />
            </div>
          </Card>
          <Card>
            <CardTitle>Chart sin datos</CardTitle>
            <CardDescription>No se dibuja un eje vacío: dice que no hay nada</CardDescription>
            <ChartBarras datos={[]} mensajeVacio="No hay ingresos registrados en este período." />
          </Card>
        </div>
      </Seccion>

      <Seccion titulo="Atajos">
        <p className="text-sm text-text-muted">
          Apretá <kbd className="rounded border border-black/10 bg-surface px-1.5 py-0.5 font-mono text-xs">?</kbd>{" "}
          para la ayuda de atajos, o{" "}
          <kbd className="rounded border border-black/10 bg-surface px-1.5 py-0.5 font-mono text-xs">Ctrl</kbd>
          {" + "}
          <kbd className="rounded border border-black/10 bg-surface px-1.5 py-0.5 font-mono text-xs">K</kbd> para la
          paleta de comandos. Las dos listas salen del mismo registro (<code>lib/comandos.ts</code>).
        </p>
      </Seccion>
    </div>
  );
}
