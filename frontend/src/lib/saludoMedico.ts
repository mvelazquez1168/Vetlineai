// Cómo se saluda a la persona de la sesión en la pantalla de selección de
// agente. Vive acá y no dentro del componente porque la regla tiene tres
// casos con criterio propio, y porque el saludo es la clase de cosa que se
// copia a la próxima pantalla que lo necesite.
//
// Lo que había antes y por qué fallaba:
//
//   const apellido = nombre.split(" ").slice(-1)[0] ?? "";
//   const prefijo  = nombre.startsWith("Dr.") || nombre.startsWith("Dra.")
//     ? nombre.split(" ")[0] : "Dr.";
//   → `Bienvenido, {prefijo} {apellido}`
//
//   1. Sin nombre quedaba "Bienvenido, Dr." — un título colgado. El
//      prefijo salía igual porque su rama por defecto es una constante,
//      así que la falta del dato no se notaba: se notaba a medias.
//   2. A quien no tuviera título en el nombre se le INVENTABA uno. De las
//      23 personas de la base, la mayoría no lo tiene: "Melany Velasquez"
//      era saludada como "Dr. Velasquez".
//   3. El título solo se reconocía con punto. "Dra Isabel Salas" (así,
//      real, en la base) no coincidía y caía en la rama que inventa "Dr.".

// Título al principio del nombre, tal como lo escriben en la base: con
// punto o sin él, en cualquier caja, y pegado al nombre ("Dr.Roger") o
// separado ("Dr Manuel").
const TITULO_AL_INICIO = /^(dra|dr)\.?\s*/i;

/**
 * Devuelve el saludo completo, ya listo para pintar.
 *
 * El verbo es neutro a propósito. Antes decía "Bienvenido" para todo el
 * mundo, lo cual pasaba desapercibido mientras el título también fuera
 * siempre "Dr."; al reconocer "Dra." se volvería una incoherencia visible
 * en la misma línea ("Bienvenido, Dra. Salas"). Es la única forma de
 * saludar bien sin inferir el género de nadie a partir del nombre.
 */
export function saludoMedico(nombreCompleto: string | null | undefined): string {
  const nombre = (nombreCompleto ?? "").trim();
  // Sin nombre no se saluda a medias: se saluda sin nombre. Nunca un
  // título suelto.
  if (!nombre) return "Te damos la bienvenida";

  const conTitulo = nombre.match(TITULO_AL_INICIO);
  // Sin título en el dato no se inventa: se usa el nombre tal como está
  // cargado. Es más largo que "Dr. Apellido" y es lo correcto — el título
  // lo pone quien carga la persona, no esta pantalla.
  if (!conTitulo) return `Te damos la bienvenida, ${nombre}`;

  const titulo = conTitulo[1].toLowerCase() === "dra" ? "Dra." : "Dr.";
  const resto = nombre.slice(conTitulo[0].length).trim();
  // Un nombre que es solo el título ("Dr.") no aporta nada: mejor sin él.
  if (!resto) return "Te damos la bienvenida";

  const apellido = resto.split(/\s+/).slice(-1)[0];
  return `Te damos la bienvenida, ${titulo} ${apellido}`;
}
