// ---------------------------------------------------------------------
// Sistema de diseño compartido — punto único de importación.
//
// Hasta la sesión nocturna de 2026-11-25 este barrel exportaba 9 de los
// 13 componentes del directorio: faltaban CollapsibleSection, FiltroBar,
// BreedCombobox y ClinicaCombobox, que las pantallas importaban por ruta
// directa. El problema de un barrel incompleto no es estético: deja al
// que busca "qué hay disponible" creyendo que algo no existe, y lo
// escribe de nuevo. (La cuenta real es 13 archivos, no 12 como decía el
// relevamiento.)
//
// Regla: todo componente de este directorio se exporta acá, junto con
// sus tipos públicos. Si algo no debería ser de uso general, no va en
// `components/ui/`.
//
// Los charts viven en `./charts` y se exportan desde ahí para que
// `recharts` quede detrás de una sola puerta — ver charts/tipos.ts.
// ---------------------------------------------------------------------

export { Badge } from "./Badge";
export type { BadgeProps, BadgeVariant } from "./Badge";

export { BreedCombobox } from "./BreedCombobox";
export type { BreedComboboxProps } from "./BreedCombobox";

export { Button } from "./Button";
export type { ButtonProps } from "./Button";

export { Card, CardDescription, CardTitle } from "./Card";
export type { CardProps } from "./Card";

export { ClinicaCombobox } from "./ClinicaCombobox";
export type { ClinicaComboboxProps } from "./ClinicaCombobox";

export { CollapsibleSection } from "./CollapsibleSection";
export type { CollapsibleSectionProps } from "./CollapsibleSection";

export { CountryCombobox } from "./CountryCombobox";
export type { CountryComboboxProps } from "./CountryCombobox";

export { FiltroBar } from "./FiltroBar";
export type { FiltroBarProps, FiltroBarSelect, FiltroBarSelectOption } from "./FiltroBar";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Modal } from "./Modal";
export type { ModalProps } from "./Modal";

export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";

export { Select } from "./Select";
export type { SelectOption, SelectProps } from "./Select";

export { Table } from "./Table";
export type { TableColumn, TableProps } from "./Table";

// --- agregados en la sesión nocturna 2026-11-25 ---------------------

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { Icono, NOMBRES_ICONO } from "./Icono";
export type { IconoProps, NombreIcono } from "./Icono";

export { KpiCard } from "./KpiCard";
export type { KpiCardProps } from "./KpiCard";

export { LoadingState } from "./LoadingState";
export type { FormaCarga, LoadingStateProps } from "./LoadingState";

export { MenuExportar } from "./MenuExportar";
export type { FormatoExportacion, MenuExportarProps } from "./MenuExportar";

export { Pagination } from "./Pagination";
export type { PaginationProps } from "./Pagination";

export {
  SelectorPeriodo,
  construirPeriodo,
  periodoAnterior,
  periodoPorDefecto,
  rangoDePreset,
} from "./SelectorPeriodo";
export type { Periodo, PresetPeriodo, SelectorPeriodoProps } from "./SelectorPeriodo";

export { ToastProvider, useToast } from "./Toast";
export type { VarianteToast } from "./Toast";

// Modal gana la prop de ancho; el tipo se exporta para que una pantalla
// pueda tipar su propia envoltura.
export type { AnchoModal } from "./Modal";

// Charts — la librería queda detrás de estos cinco.
export {
  ALTO_CHART_POR_DEFECTO,
  ChartArea,
  ChartBarras,
  ChartDona,
  ChartLinea,
  Sparkline,
  formatearNumero,
} from "./charts";
export type {
  AlClicElemento,
  ChartAreaProps,
  ChartBarrasProps,
  ChartDonaProps,
  ChartLineaProps,
  PropsChartBase,
  PuntoDato,
  SerieDato,
  SparklineProps,
} from "./charts";
