import { Modulo } from "../hooks/useAuth";

// ---------------------------------------------------------------------
// DÓNDE ATERRIZA CADA USUARIO AL ENTRAR — prompt 01c.
//
// Una sola función, porque hay DOS lugares que resuelven lo mismo: el
// `IndexRedirect` de la raíz y el `Login` después de autenticar. Con la
// regla escrita dos veces, un día uno manda a Inicio y el otro al
// workspace, y nadie entiende por qué depende de cómo entró.
//
// EL ORDEN DE LAS DECISIONES:
//
//   1. La plataforma es de la plataforma. Un superadministrador no
//      pertenece a ninguna clínica y no tiene por qué ver Inicio, que
//      muestra indicadores de una clínica.
//   2. LO QUE EL USUARIO ELIGIÓ, si sigue estando disponible. Una
//      elección que apunta a un módulo que la clínica deshabilitó deja
//      de valer: es mejor caer en la entrada derivada que en un 403.
//   3. SIN MÓDULOS DE GESTIÓN, todo queda como antes. Una clínica que
//      solo usa Vetline Ai no tiene caja, ni inventario, ni agenda que
//      resumir: Inicio le mostraría una pantalla de ceros. El médico
//      entra a su área de trabajo y el administrador a sus médicos,
//      exactamente como entraban antes de este prompt.
//   4. CON MÓDULOS DE GESTIÓN, Inicio. Ahí sí hay algo que resumir.
//
// El punto 3 es el que hace que este prompt no sea una regresión para
// las clínicas que hoy están en producción: ninguna tiene módulos de
// gestión habilitados todavía.
// ---------------------------------------------------------------------

export interface QuienEntra {
  rol: string;
  esMedico: boolean;
  esAdminClinica: boolean;
  modulos: Modulo[];
  /** Lo que el usuario eligió en su menú, o null. */
  pantallaElegida?: string | null;
  /**
   * LA ENTRADA DE SU ROL (prompt 04): `roles.pantalla_inicio`, resuelta
   * por el backend. La recepción aterriza en la agenda, la caja en caja,
   * la farmacia en inventario.
   *
   * Existe porque con ocho roles «el que no es médico aterriza en
   * Médicos» dejó de ser cierto, y mandar a la recepción a la pantalla
   * de médicos es mandarla a un lugar donde no tiene nada que hacer.
   */
  pantallaDelRol?: string | null;
}

/**
 * Si esa ruta tiene sentido en esta clínica.
 *
 * Una entrada que apunta a un módulo deshabilitado no vale: es mejor
 * caer en la derivada que en un 403 cada vez que alguien entra. Vale
 * tanto para lo que el usuario eligió como para la entrada de su rol
 * —el mismo criterio para los dos, porque es la misma pregunta—.
 */
function rutaHabilitada(ruta: string, modulos: Modulo[]): boolean {
  const tiene = (m: Modulo) => modulos.includes(m);
  if (ruta.startsWith("/ventas")) return tiene("ventas");
  if (ruta.startsWith("/inventario")) return tiene("inventario");
  if (ruta.startsWith("/facturacion")) return tiene("facturacion");
  // Inicio resume la gestión: sin ningún módulo muestra una pantalla de
  // ceros, que es peor que no ofrecerla.
  if (ruta === "/inicio") return modulos.length > 0;
  return true;
}

/** Las que puede elegir este usuario, con su nombre. */
export function pantallasDisponibles(
  quien: Pick<QuienEntra, "esMedico" | "esAdminClinica" | "modulos">
): { ruta: string; etiqueta: string }[] {
  const tiene = (m: Modulo) => quien.modulos.includes(m);
  const lista: { ruta: string; etiqueta: string }[] = [];

  // Inicio solo aparece donde tiene algo que mostrar.
  if (quien.modulos.length > 0) lista.push({ ruta: "/inicio", etiqueta: "Inicio" });
  if (quien.esMedico) lista.push({ ruta: "/workspace", etiqueta: "Área de trabajo" });
  lista.push({ ruta: "/agenda/calendario", etiqueta: "Agenda" });
  lista.push({ ruta: "/pacientes", etiqueta: "Pacientes" });
  if (tiene("ventas")) lista.push({ ruta: "/ventas", etiqueta: "Caja" });
  if (tiene("inventario")) lista.push({ ruta: "/inventario", etiqueta: "Inventario" });
  if (tiene("facturacion"))
    lista.push({ ruta: "/facturacion", etiqueta: "Facturación electrónica" });
  lista.push({ ruta: "/admin/casos", etiqueta: "Casos clínicos" });
  // «Personas» y no «Médicos»: la pantalla administra a todo el
  // personal desde el 04, y el menú ya lo dice así (punto 6 del
  // 2026-11-27).
  if (quien.esAdminClinica) lista.push({ ruta: "/admin/personas", etiqueta: "Personas" });
  return lista;
}

export function rutaDeEntrada(quien: QuienEntra): string {
  if (quien.rol === "super_admin") return "/platform-admin";

  // 1. Lo que la persona eligió, si sigue sirviendo.
  const disponibles = pantallasDisponibles(quien).map((p) => p.ruta);
  if (quien.pantallaElegida && disponibles.includes(quien.pantallaElegida)) {
    return quien.pantallaElegida;
  }

  // 2. La entrada de su rol (prompt 04). Va ANTES de la derivación vieja
  //    y DESPUÉS de su elección: es una buena opción por omisión, no una
  //    decisión que le pisa la que ya tomó.
  if (quien.pantallaDelRol && rutaHabilitada(quien.pantallaDelRol, quien.modulos)) {
    return quien.pantallaDelRol;
  }

  // 3. Lo de siempre, para las sesiones y los roles que no digan nada.
  if (quien.modulos.length === 0) {
    return quien.esMedico ? "/workspace" : "/admin/personas";
  }
  return "/inicio";
}
