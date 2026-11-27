import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EnLaClinicaAhora } from "../components/expediente/EnLaClinicaAhora";
import {
  Card,
  CardDescription,
  CardTitle,
  KpiCard,
  LoadingState,
  PageHeader,
  TiraIndicadores,
} from "../components/ui";
import { getStoredToken, useAuth } from "../hooks/useAuth";
import { useApariencia } from "../hooks/useApariencia";
import { apiFetch } from "../lib/api";
import { plural } from "../lib/plural";

// ---------------------------------------------------------------------
// INICIO — prompt 01c, secciones 1 y 5.
//
// La primera opción del menú, y la única pantalla nueva del marco además
// de Apariencia. Antes cada rol aterrizaba en una lista: el médico en su
// workspace y el administrador en «Médicos». Una lista no es un inicio.
//
// CADA INDICADOR SALE DE DATOS REALES, de una sola consulta agregada.
// Los que el prompt nombra y hoy no tienen de dónde salir no están, y
// queda dicho en el informe: un número que siempre dice cero enseña a
// ignorar los números.
//
// LAS TARJETAS LLEVAN AL LUGAR donde se resuelve lo que muestran. Un
// indicador que no se puede accionar es decoración.
// ---------------------------------------------------------------------

interface Indicadores {
  citas_hoy: number;
  citas_por_confirmar: number;
  en_sala_de_espera: number;
  casos_pendientes: number;
  pacientes_activos: number;
  vacunas_por_vencer: number;
  caja: {
    sesion_abierta: string | null;
    cobrado_hoy: string;
    cobros_hoy: number;
    cuentas_abiertas: number;
    aprobaciones_pendientes: number;
  } | null;
  inventario: {
    bajo_minimo: number;
    vencen_60_dias: number;
    ajustes_por_aprobar: number;
  } | null;
}

function colones(valor: string | number): string {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(Number(valor));
}

export function Inicio() {
  const navegar = useNavigate();
  const { esMedico, esAdminClinica } = useAuth();
  const { apariencia } = useApariencia();
  const [datos, setDatos] = useState<Indicadores | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    apiFetch<Indicadores>("/inicio/indicadores", { token: getStoredToken() })
      .then(setDatos)
      .catch(() => setDatos(null))
      .finally(() => setCargando(false));
  }, []);

  const hoy = new Date().toLocaleDateString("es-CR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div>
      <PageHeader
        titulo={apariencia?.nombreClinica ?? "Inicio"}
        subtitulo={hoy.charAt(0).toUpperCase() + hoy.slice(1)}
        icono="inicio"
        indicadores={
          cargando ? (
            <LoadingState forma="tarjetas" cantidad={4} />
          ) : datos ? (
            <TiraIndicadores>
              <KpiCard
                titulo="Citas de hoy"
                valor={String(datos.citas_hoy)}
                icono="cita"
                modulo="agenda"
                variacionPorcentaje={null}
                detalle={
                  datos.citas_por_confirmar > 0
                    ? plural(datos.citas_por_confirmar, "sin confirmar", "sin confirmar")
                    : "Todas confirmadas"
                }
                alClic={() => navegar("/agenda/calendario")}
              />
              <KpiCard
                titulo="En sala de espera"
                valor={String(datos.en_sala_de_espera)}
                icono="hora"
                modulo="agenda"
                estado={datos.en_sala_de_espera > 0 ? "aviso" : undefined}
                variacionPorcentaje={null}
                detalle="Llegaron y todavía no entran a consulta"
                alClic={() => navegar("/agenda/centro-comando")}
              />
              {datos.caja ? (
                <KpiCard
                  titulo="Cobrado hoy"
                  valor={colones(datos.caja.cobrado_hoy)}
                  icono="caja"
                  modulo="caja"
                  variacionPorcentaje={null}
                  detalle={`${plural(datos.caja.cobros_hoy, "cobro", "cobros")} · ${plural(
                    datos.caja.cuentas_abiertas,
                    "cuenta abierta",
                    "cuentas abiertas"
                  )}`}
                  alClic={() => navegar("/ventas")}
                  accion={
                    datos.caja.sesion_abierta
                      ? undefined
                      : { etiqueta: "Abrir la caja", alClic: () => navegar("/ventas") }
                  }
                />
              ) : (
                <KpiCard
                  titulo="Pacientes activos"
                  valor={String(datos.pacientes_activos)}
                  icono="paciente"
                  modulo="pacientes"
                  variacionPorcentaje={null}
                  alClic={() => navegar("/pacientes")}
                />
              )}
              <KpiCard
                titulo="Vacunas por vencer"
                valor={String(datos.vacunas_por_vencer)}
                icono="vacuna"
                modulo="pacientes"
                estado={datos.vacunas_por_vencer > 0 ? "aviso" : undefined}
                variacionPorcentaje={null}
                detalle="Vencidas o que vencen en 30 días"
                alClic={() => navegar("/pacientes")}
              />
            </TiraIndicadores>
          ) : null
        }
      />

      {datos && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* QUIÉN ESTÁ ADENTRO (anexo 07-03, A2). Va primero porque es
              lo único de esta pantalla que cambia minuto a minuto. */}
          <EnLaClinicaAhora />

          {/* Lo que hay que resolver. Solo aparece lo que de verdad está
              pendiente: una tarjeta que dice «nada pendiente» ocupa el
              lugar de una que sí tiene algo. */}
          {(datos.caja?.aprobaciones_pendientes ||
            datos.inventario?.ajustes_por_aprobar ||
            datos.casos_pendientes) && (
            <Card>
              <CardTitle>Para resolver</CardTitle>
              <CardDescription>Lo que está esperando a alguien.</CardDescription>
              <ul className="mt-3 space-y-2 text-sm">
                {!!datos.caja?.aprobaciones_pendientes && (
                  <li>
                    <button
                      type="button"
                      onClick={() => navegar("/ventas/aprobaciones")}
                      className="min-h-11 text-left font-medium text-primary hover:underline"
                    >
                      {plural(
                        datos.caja.aprobaciones_pendientes,
                        "aprobación de caja pendiente",
                        "aprobaciones de caja pendientes"
                      )}
                    </button>
                  </li>
                )}
                {!!datos.inventario?.ajustes_por_aprobar && (
                  <li>
                    <button
                      type="button"
                      onClick={() => navegar("/inventario/movimientos?tab=aprobaciones")}
                      className="min-h-11 text-left font-medium text-primary hover:underline"
                    >
                      {plural(
                        datos.inventario.ajustes_por_aprobar,
                        "ajuste de inventario por aprobar",
                        "ajustes de inventario por aprobar"
                      )}
                    </button>
                  </li>
                )}
                {!!datos.casos_pendientes && (
                  <li>
                    <button
                      type="button"
                      onClick={() => navegar("/admin/casos")}
                      className="min-h-11 text-left font-medium text-primary hover:underline"
                    >
                      {plural(datos.casos_pendientes, "caso clínico abierto", "casos clínicos abiertos")}
                    </button>
                  </li>
                )}
              </ul>
            </Card>
          )}

          {datos.inventario && (
            <Card>
              <CardTitle>Inventario</CardTitle>
              <CardDescription>Lo que conviene mirar antes de que falte.</CardDescription>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <button
                    type="button"
                    onClick={() => navegar("/inventario/alertas")}
                    className="min-h-11 text-left font-medium text-primary hover:underline"
                  >
                    {plural(datos.inventario.bajo_minimo, "producto", "productos", {
                      cero: "Ningún producto",
                    })}{" "}
                    bajo el mínimo
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navegar("/inventario/alertas")}
                    className="min-h-11 text-left font-medium text-primary hover:underline"
                  >
                    {plural(datos.inventario.vencen_60_dias, "lote que vence", "lotes que vencen", {
                      cero: "Ningún lote vence",
                    })}{" "}
                    en 60 días o menos
                  </button>
                </li>
              </ul>
            </Card>
          )}

          {esMedico && (
            <Card>
              <CardTitle>Su trabajo clínico</CardTitle>
              <CardDescription>
                El área de trabajo con sus agentes y sus casos abiertos.
              </CardDescription>
              <button
                type="button"
                onClick={() => navegar("/workspace")}
                className="mt-3 min-h-11 font-semibold text-primary hover:underline"
              >
                Ir al área de trabajo →
              </button>
            </Card>
          )}

          {esAdminClinica && (
            <Card>
              <CardTitle>Apariencia de la clínica</CardTitle>
              <CardDescription>
                El color, el logo y el tema con los que todo el personal ve el sistema.
              </CardDescription>
              <button
                type="button"
                onClick={() => navegar("/admin/clinica?tab=apariencia")}
                className="mt-3 min-h-11 font-semibold text-primary hover:underline"
              >
                Configurar la apariencia →
              </button>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
