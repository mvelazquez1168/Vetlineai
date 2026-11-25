import { NombreIcono } from "../components/ui/Icono";
import { Rol } from "../hooks/useAuth";

// ---------------------------------------------------------------------
// REGISTRO ÚNICO de acciones y atajos.
//
// Lo leen la paleta de comandos (Ctrl/Cmd+K) y la ayuda de atajos (`?`).
// No hay dos listas: el prompt lo pide explícitamente, y el motivo es
// concreto — una ayuda que anuncia un atajo que ya no existe es peor que
// no tener ayuda, y eso pasa el día que alguien agrega un atajo en el
// manejador de teclado y se olvida del cartel.
//
// POR QUÉ LOS ATAJOS SON SECUENCIAS CON PREFIJO `g` y no letras sueltas
// ni combinaciones con Ctrl:
//   - Con Ctrl/Cmd se choca con el navegador (Ctrl+N ventana nueva,
//     Ctrl+T pestaña, Ctrl+L barra de direcciones, Ctrl+P imprimir).
//     Esos no se pueden interceptar de forma confiable y, cuando se
//     puede, romper Ctrl+L enoja con razón.
//   - Una letra sola se dispara sin querer: basta que el foco esté en el
//     cuerpo del documento.
//   - `g` + letra ("go to") es la convención de GitHub y Linear: no
//     colisiona con nada del navegador y necesita intención.
//
// Y NINGÚN atajo se dispara mientras se escribe: eso lo garantiza
// `esCampoDeTexto()` más abajo, en un solo lugar.
// ---------------------------------------------------------------------

export interface Comando {
  id: string;
  titulo: string;
  /** Para que la paleta encuentre "nuevo paciente" buscando "alta" o "mascota". */
  sinonimos?: string[];
  icono: NombreIcono;
  /** Agrupa en la paleta y en la ayuda. */
  grupo: "Ir a" | "Crear" | "Ayuda";
  /** Ruta a la que navega. */
  a: string;
  /** Segunda tecla de la secuencia `g` + tecla. Sin esto, el comando solo vive en la paleta. */
  atajo?: string;
  /**
   * Quién lo ve. Se compara contra TODOS los roles de la sesión
   * (`misRoles`), no contra `rol`: una persona admin + médico tiene que
   * ver los comandos de los dos.
   */
  roles: Rol[];
}

const CLINICA: Rol[] = ["medico", "admin_clinica"];

export const COMANDOS: Comando[] = [
  // --- Ir a ---
  {
    id: "ir-pacientes",
    titulo: "Pacientes",
    sinonimos: ["mascotas", "fichero", "expedientes"],
    icono: "paciente",
    grupo: "Ir a",
    a: "/pacientes",
    atajo: "p",
    roles: CLINICA,
  },
  {
    id: "ir-agenda",
    titulo: "Agenda",
    sinonimos: ["citas", "calendario", "turnos"],
    icono: "cita",
    grupo: "Ir a",
    a: "/agenda",
    atajo: "a",
    roles: CLINICA,
  },
  {
    id: "ir-propietarios",
    titulo: "Propietarios",
    sinonimos: ["clientes", "tutores", "duenos"],
    icono: "propietario",
    grupo: "Ir a",
    a: "/admin/propietarios",
    atajo: "t",
    roles: ["admin_clinica"],
  },
  {
    id: "ir-casos",
    titulo: "Casos",
    sinonimos: ["consultas", "episodios"],
    icono: "medico",
    grupo: "Ir a",
    a: "/admin/casos",
    atajo: "c",
    roles: ["admin_clinica"],
  },
  {
    id: "ir-workspace",
    titulo: "Área de trabajo",
    sinonimos: ["agentes", "chat clinico", "ia"],
    icono: "panel",
    grupo: "Ir a",
    a: "/workspace",
    atajo: "w",
    roles: ["medico"],
  },
  {
    id: "ir-centro-comando",
    titulo: "Centro de Comando",
    sinonimos: ["sala de espera", "dia de hoy"],
    icono: "panel",
    grupo: "Ir a",
    a: "/agenda/centro-comando",
    roles: CLINICA,
  },
  {
    id: "ir-lista-espera",
    titulo: "Lista de Espera",
    icono: "hora",
    grupo: "Ir a",
    a: "/agenda/lista-espera",
    roles: CLINICA,
  },
  {
    id: "ir-medicos",
    titulo: "Médicos",
    sinonimos: ["veterinarios", "equipo"],
    icono: "personas",
    grupo: "Ir a",
    a: "/admin/medicos",
    roles: ["admin_clinica"],
  },
  {
    id: "ir-clinica",
    titulo: "Datos de la clínica",
    sinonimos: ["configuracion", "ajustes"],
    icono: "ajustes",
    grupo: "Ir a",
    a: "/admin/clinica",
    roles: ["admin_clinica"],
  },
  {
    id: "ir-facturacion",
    titulo: "Facturación electrónica",
    sinonimos: ["facturas", "comprobantes", "hacienda", "tiquete", "nota de credito"],
    icono: "comprobante",
    grupo: "Ir a",
    a: "/facturacion",
    roles: CLINICA,
  },
  {
    id: "ir-facturacion-recibidos",
    titulo: "Comprobantes recibidos",
    sinonimos: ["facturas de proveedores", "mensaje receptor", "compras"],
    icono: "recibidos",
    grupo: "Ir a",
    a: "/facturacion/recibidos",
    roles: CLINICA,
  },
  // --- Crear ---
  //
  // Van a la pantalla que tiene el formulario, no a un modal abierto por
  // la paleta: el alta de un paciente necesita elegir propietario
  // primero, y reproducir ese flujo dentro de la paleta sería una
  // segunda implementación del mismo wizard.
  {
    id: "nueva-cita",
    titulo: "Nueva cita",
    sinonimos: ["agendar", "turno nuevo", "reservar"],
    icono: "agregar",
    grupo: "Crear",
    a: "/agenda/calendario?nueva=1",
    atajo: "n",
    roles: CLINICA,
  },
  {
    id: "nuevo-comprobante",
    titulo: "Emitir un comprobante",
    sinonimos: ["facturar", "nueva factura", "nuevo tiquete"],
    icono: "comprobante",
    grupo: "Crear",
    a: "/facturacion/emitir",
    roles: CLINICA,
  },
  {
    id: "nuevo-paciente",
    titulo: "Nuevo paciente",
    sinonimos: ["alta de mascota", "registrar animal"],
    icono: "paciente",
    grupo: "Crear",
    a: "/pacientes?nuevo=1",
    roles: CLINICA,
  },
];

/** Los comandos que esta sesión puede ver, según TODOS sus roles. */
export function comandosParaRoles(roles: Rol[]): Comando[] {
  return COMANDOS.filter((c) => c.roles.some((r) => roles.includes(r)));
}

/** La tecla que abre la paleta, para mostrarla en la ayuda y en los botones. */
export const ATAJO_PALETA = { tecla: "k", conModificador: true } as const;
export const ATAJO_AYUDA = { tecla: "?", conModificador: false } as const;
export const PREFIJO_SECUENCIA = "g";

/**
 * ¿El foco está en algo donde la persona está escribiendo?
 *
 * Único lugar donde se decide, y lo consultan el manejador de atajos y
 * el de la paleta. Cubre input, textarea, select, cualquier cosa con
 * `contenteditable`, y el caso que se olvida siempre: un elemento con
 * `role="textbox"` (los combobox del sistema lo usan).
 */
export function esCampoDeTexto(objetivo: EventTarget | null): boolean {
  if (!(objetivo instanceof HTMLElement)) return false;
  const etiqueta = objetivo.tagName.toLowerCase();
  if (etiqueta === "input" || etiqueta === "textarea" || etiqueta === "select") return true;
  if (objetivo.isContentEditable) return true;
  return objetivo.getAttribute("role") === "textbox";
}

/**
 * Normaliza para comparar: minúsculas y sin acentos. Es el equivalente
 * en el cliente de lo que `inmutable_unaccent` hace en la base, para que
 * la búsqueda de PANTALLAS (que es local) se comporte igual que la de
 * pacientes y propietarios (que es del backend).
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Filtra comandos por texto, mirando también los sinónimos. */
export function filtrarComandos(comandos: Comando[], consulta: string): Comando[] {
  const q = normalizar(consulta);
  if (!q) return comandos;
  return comandos.filter((c) => {
    const heno = normalizar([c.titulo, c.grupo, ...(c.sinonimos ?? [])].join(" "));
    return heno.includes(q);
  });
}
