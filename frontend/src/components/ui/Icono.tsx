import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Info,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  Package,
  PawPrint,
  Pencil,
  Plus,
  Search,
  Settings,
  Stethoscope,
  Syringe,
  Trash2,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------
// ÚNICA PUERTA a la librería de íconos.
//
// Librería: `lucide-react`. Por qué esta: son íconos de línea con
// `stroke-width` 2, que es exactamente el trazo de los 13 SVG que el
// proyecto ya tenía escritos a mano (hamburguesa, campanas), así que no
// hay un salto visual al adoptarla; y exporta un componente por ícono,
// así que el bundle solo se lleva los que se usan.
//
// Ninguna pantalla importa `lucide-react` directamente. El motivo no es
// ceremonial: cambiar de librería de íconos con 40 pantallas
// importándola es un trabajo de días, y con esta puerta es cambiar este
// archivo. Es la misma disciplina que `proveedorPagos.ts` aplica a la
// pasarela y `enviarEmail` al proveedor de correo.
//
// CÓMO AGREGAR UN ÍCONO: se importa arriba y se agrega al mapa. No se
// expone el tipo de lucide hacia afuera — el `nombre` es un string de
// esta lista, así que el compilador atrapa un nombre que no existe y
// nadie puede pasar un componente arbitrario.
// ---------------------------------------------------------------------

const ICONOS = {
  // Navegación y estructura
  menu: Menu,
  cerrar: X,
  buscar: Search,
  filtrar: Filter,
  ajustes: Settings,
  panel: LayoutDashboard,
  // Flechas y direcciones
  "flecha-derecha": ArrowRight,
  "flecha-arriba": ArrowUp,
  "flecha-abajo": ArrowDown,
  "chevron-arriba": ChevronUp,
  "chevron-abajo": ChevronDown,
  "chevron-izquierda": ChevronLeft,
  "chevron-derecha": ChevronRight,
  // Estados y avisos
  check: Check,
  aviso: AlertTriangle,
  info: Info,
  campana: Bell,
  // Tendencia (KpiCard)
  "tendencia-sube": TrendingUp,
  "tendencia-baja": TrendingDown,
  // Acciones
  agregar: Plus,
  editar: Pencil,
  borrar: Trash2,
  descargar: Download,
  excel: FileSpreadsheet,
  pdf: FileText,
  // Dominio veterinario
  paciente: PawPrint,
  propietario: User,
  personas: Users,
  medico: Stethoscope,
  vacuna: Syringe,
  cita: Calendar,
  hora: Clock,
  producto: Package,
} satisfies Record<string, LucideIcon>;

export type NombreIcono = keyof typeof ICONOS;

/** Los nombres disponibles, para el muestrario. */
export const NOMBRES_ICONO = Object.keys(ICONOS) as NombreIcono[];

export interface IconoProps {
  nombre: NombreIcono;
  /** Tamaño en px del lado. 16 para texto chico, 20 por defecto, 24 para encabezados. */
  tamano?: 14 | 16 | 20 | 24 | 32;
  className?: string;
  /**
   * Texto para lectores de pantalla. Si se omite, el ícono se marca como
   * decorativo (`aria-hidden`), que es lo correcto cuando al lado ya hay
   * una etiqueta visible — el caso normal. Poné esto solo cuando el
   * ícono ES la única información (un botón sin texto).
   */
  etiqueta?: string;
}

export function Icono({ nombre, tamano = 20, className = "", etiqueta }: IconoProps) {
  const Componente = ICONOS[nombre];
  return (
    <Componente
      size={tamano}
      className={className}
      strokeWidth={2}
      aria-hidden={etiqueta ? undefined : true}
      aria-label={etiqueta}
      role={etiqueta ? "img" : undefined}
    />
  );
}
