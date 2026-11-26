import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icono, NombreIcono } from "./Icono";

// ---------------------------------------------------------------------
// EL ENCABEZADO DE PANTALLA — prompt 01c, sección 3.
//
// Dos variantes, y la diferencia no es estética:
//
//   * COMPLETA, para listados y dashboards: una franja del color
//     primario con el título y UNA acción principal, y debajo la tira de
//     indicadores superpuesta al borde de la franja.
//   * COMPACTA, para trabajo largo —el expediente, la atención, la
//     emisión de comprobantes, los formularios—: una franja baja que al
//     hacer scroll queda como una barra delgada. En una pantalla donde
//     se escribe durante veinte minutos, una franja alta es espacio
//     robado.
//
// EL ÍCONO LLEVA EL COLOR DEL MÓDULO (ajuste 1 del prompt). La franja NO:
// teñir la tarjeta completa de siete colores distintos hace que el
// sistema parezca siete sistemas.
//
// UNA SOLA ACCIÓN PRINCIPAL. Es una regla, no una sugerencia: el
// relevamiento encontró nueve botones en fila en Inventario. Las demás
// van como secundarias, con borde translúcido.
// ---------------------------------------------------------------------

export interface PageHeaderProps {
  titulo: string;
  subtitulo?: string;
  /** El ícono del módulo. Lleva su color. */
  icono?: NombreIcono;
  /** `caja`, `inventario`, `agenda`… decide el color del ícono. */
  modulo?: string;
  /** La acción principal. Una sola, en botón sólido. */
  accion?: ReactNode;
  /** Las secundarias, con borde translúcido. */
  secundarias?: ReactNode;
  /** Enlace al padre DENTRO de la página, en una pantalla hija. */
  padre?: { a: string; etiqueta: string };
  /** Contexto de la variante compacta: paciente, propietario, estado. */
  contexto?: ReactNode;
  /** Los indicadores, superpuestos al borde inferior. Solo en completa. */
  indicadores?: ReactNode;
  variante?: "completa" | "compacta";
}

const COLOR_ICONO: Record<string, string> = {
  caja: "text-modulo-caja",
  ventas: "text-modulo-caja",
  inventario: "text-modulo-inventario",
  agenda: "text-modulo-agenda",
  facturacion: "text-modulo-facturacion",
  pacientes: "text-modulo-pacientes",
  propietarios: "text-modulo-pacientes",
  expediente: "text-modulo-pacientes",
  casos: "text-modulo-ia",
  ia: "text-modulo-ia",
  admin: "text-modulo-admin",
  crm: "text-modulo-agenda",
};

export function PageHeader({
  titulo,
  subtitulo,
  icono,
  modulo,
  accion,
  secundarias,
  padre,
  contexto,
  indicadores,
  variante = "completa",
}: PageHeaderProps) {
  const colorIcono = modulo ? (COLOR_ICONO[modulo] ?? "text-primary") : "text-primary";

  if (variante === "compacta") {
    return (
      <div className="franja-pegada -mx-4 mb-4 border-b border-black/5 bg-surface px-4 py-3 shadow-suave sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {icono && (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-suave">
              <Icono nombre={icono} tamano={20} className={colorIcono} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {padre && (
              <Link
                to={padre.a}
                className="text-xs text-text-muted hover:text-primary"
              >
                ← {padre.etiqueta}
              </Link>
            )}
            <h1 className="truncate text-lg font-bold text-text-primary">{titulo}</h1>
            {contexto && <div className="text-sm text-text-muted">{contexto}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {secundarias}
            {accion}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={indicadores ? "mb-4" : "mb-6"}>
      <div className="-mx-4 bg-primary px-4 pb-6 pt-5 text-sobre-primary sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {icono && (
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-sobre-primary">
              <Icono nombre={icono} tamano={24} className={colorIcono} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {padre && (
              <Link
                to={padre.a}
                className="text-xs text-sobre-primary/70 hover:text-sobre-primary"
              >
                ← {padre.etiqueta}
              </Link>
            )}
            <h1 className="text-xl font-bold sm:text-2xl">{titulo}</h1>
            {subtitulo && (
              <p className="mt-0.5 text-sm text-sobre-primary/75">{subtitulo}</p>
            )}
            {contexto && <div className="mt-1 text-sm text-sobre-primary/75">{contexto}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {secundarias}
            {accion}
          </div>
        </div>
      </div>

      {/* Los indicadores, superpuestos al borde inferior de la franja.
          El margen negativo es lo que produce ese efecto; sin él
          quedarían como una fila más y la franja no los contendría. */}
      {indicadores && <div className="-mt-4 px-0">{indicadores}</div>}
    </div>
  );
}

/**
 * La tira de indicadores. Vive acá y no en cada pantalla porque la
 * cuadrícula y el espaciado son del patrón, no de la pantalla: con cada
 * una eligiendo su grilla, dos listados contiguos se veían distintos.
 */
export function TiraIndicadores({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
  );
}
