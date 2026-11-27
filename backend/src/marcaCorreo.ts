import { Pool, PoolClient } from "pg";
import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "./almacenamiento";
import { config } from "./config";
// Un correo de contacto que el admin tipeó a mano y que nadie verificó.
// Para Reply-To alcanza (no participa de SPF/DKIM, no autentica nada),
// pero un valor con un salto de línea sí inyecta una cabecera. Se usa la
// MISMA validación que aplica enviarEmail() a todas las direcciones, en
// vez de una copia que puede divergir.
import { direccionValida } from "./email";
import { dimensionesImagen, escalarDentroDeCaja, tipoDeImagenPorClave } from "./lib/imagenLogo";
// `import type` y no un import normal: correos.ts importa a su vez
// resolverMarca() de acá, y un import de valor cerraría un ciclo real en
// tiempo de ejecución. Al ser solo tipo, TypeScript lo borra al compilar.
import type { TipoCorreo } from "./correos";

// ---------------------------------------------------------------------
// prompt-code-correos-marca-del-cliente.md — quién firma cada correo.
//
// El consumidor final (el tutor de la mascota) no tiene relación con
// nosotros: un recordatorio de cita que llega con nuestra marca se lee
// como publicidad de un desconocido. Quien le escribe es la clínica.
// Los correos al titular de la cuenta son al revés — ahí sí la relación
// es directa y el remitente somos nosotros.
//
// La lista de abajo es la clasificación, revisada tipo por tipo contra
// el destinatario REAL de cada emisor (no contra el nombre de la
// plantilla). Es la única fuente de verdad de esa decisión: si mañana
// aparece un tipo nuevo, el default es marca de plataforma y hay que
// agregarlo acá a propósito para que salga con la marca del comercio.
// ---------------------------------------------------------------------

// Los 10 correos cuyo encabezado lleva la marca de la clínica.
//
// Los 8 primeros van a `propietarios` (el tutor). Los 2 últimos van a
// `personas` (un médico de la clínica): no son consumidor final, pero su
// contenido es 100% de la clínica — su agenda, sus pacientes — y nada
// habla de nuestro servicio. Decisión explícita del usuario, no un
// descarte por defecto.
export const TIPOS_MARCA_COMERCIO: ReadonlySet<TipoCorreo> = new Set<TipoCorreo>([
  // El recordatorio de saldo lo manda la clínica, no la plataforma
  // (prompt 10a): el cliente le debe a su veterinaria.
  "recordatorio_saldo",
  "recordatorio_cita",
  "confirmacion_cita",
  "cita_cancelada_o_reprogramada",
  "vacunacion_proxima",
  "desparasitacion_proxima",
  "seguimiento_posterior_consulta",
  "informe_disponible",
  "cumpleanos",
  "seguimiento_faltante",
  "agenda_dia_siguiente",
  // El comprobante electrónico va al cliente de la clínica, no al
  // usuario de Vetline: quien lo recibe tiene que ver a su veterinaria
  // en la bandeja, y responder a la veterinaria si algo está mal.
  "comprobante_electronico",
]);

export interface MarcaCorreo {
  // Texto del encabezado y nombre visible del remitente.
  nombre: string;
  // URL ABSOLUTA y pública del logo, o null si no hay ninguno cargado.
  // Nunca lleva datos del destinatario: la clave es "logos/<uuid>.<ext>",
  // un UUID aleatorio generado al subir el archivo (admin.routes.ts).
  logoUrl: string | null;
  // Tamaño YA ESCALADO dentro de la caja del encabezado, o null si el
  // archivo no se pudo medir. Van los dos números, no solo el alto: es la
  // única forma de acotar un logo apaisado en Outlook, que ignora
  // max-width y respeta los atributos width/height.
  logoTamano: { width: number; height: number } | null;
  // Dirección a la que van las respuestas, o null para dejar el default
  // del proveedor (nuestro buzón).
  replyTo: string | null;
  // Distingue las dos categorías en el render: solo los correos del
  // comercio llevan el pie que identifica a la plataforma.
  esComercio: boolean;
}

// El logo de plataforma sale del frontend, que ya lo sirve público y sin
// autenticación desde /brand (se agregó al instalar la PWA). Variante
// "claro" = la pensada para fondo blanco, que es el del encabezado nuevo.
// PNG y no SVG a propósito: varios clientes de correo no rasterizan SVG.
export function logoPlataformaUrl(): string {
  return `${config.frontendUrl}/brand/logo-horizontal-claro@2x.png`;
}

// El logo de plataforma es un archivo nuestro de tamaño conocido
// (194x100 en el original, ver frontend/public/brand), así que su caja se
// calcula sin leer nada.
export function marcaPlataforma(): MarcaCorreo {
  return {
    nombre: "Vetline Ai",
    logoUrl: logoPlataformaUrl(),
    logoTamano: escalarLogoDeEncabezado(194, 100),
    replyTo: null,
    esComercio: false,
  };
}

// La caja del encabezado. **El criterio es el ANCHO, no el alto.**
//
// Los dos intentos anteriores fallaron por el mismo motivo, y conviene
// dejarlo escrito: con `min(ancho/w, alto/h)`, el que ata es el ANCHO solo
// cuando la proporción supera ANCHO/ALTO. Con 180x36 ese cruce estaba en
// 5:1 y con 240x56 en 4.3:1 — o sea que un logo apaisado normal (2:1,
// 1.7:1) caía siempre del lado del ALTO, se frenaba ahí y no se acercaba
// nunca al ancho disponible. Subir los dos números en proporción movía el
// resultado unos píxeles pero no cambiaba quién mandaba.
//
// Ahora el cruce se baja a 200/120 ≈ 1.67:1, de modo que **cualquier logo
// razonablemente apaisado queda limitado por el ancho** y aterriza donde
// tiene que aterrizar:
//
//   proporción   ancho renderizado
//   1.33:1       160   ← el más "cuadrado" que sigue entrando en el rango
//   1.67:1       200
//   2:1          200
//   4:1          200   (alto 50)
//   24:1         200   (alto 8)
//
// La propiedad que hay que sostener, y que el arnés verifica: **todo logo
// de 1.33:1 o más apaisado se renderiza entre 160 y 200px de ancho.**
//
// El alto ya NO es el criterio: es solo un tope de seguridad, y por eso es
// generoso. Existe para que un logo cuadrado o vertical no empuje el
// encabezado a lo alto, no para acotar a los apaisados — a 120 no llega a
// tocar a ninguno de la tabla de arriba.
//
//   1:1   →  120x120
//   1:4   →   30x120
//
// 200 no es un número estético sino el ancho útil real en el peor caso: el
// cuerpo mide 480 con 32 de padding por lado → 416 en escritorio, pero en
// un teléfono de 320 la tabla baja a 320 y el útil queda en 256. 200 entra
// ahí con margen.
export const LOGO_ANCHO_OBJETIVO = 200;
export const LOGO_ALTO_MAX = 120;

// El ancho a partir del cual un logo se considera apaisado a los efectos
// del compromiso de arriba. No configura nada — se deriva de la caja y lo
// usa el arnés para verificar el rango [160, 200].
export const PROPORCION_APAISADA_MINIMA = 4 / 3;
export const ANCHO_MINIMO_APAISADO = 160;

// Escala un logo a la caja SIN ampliarlo nunca por encima de sus propios
// píxeles. Un archivo chico se muestra chico: estirarlo no lo mejora, lo
// vuelve borroso, y en un cliente de correo eso se nota más que el tamaño.
//
// CONSECUENCIA que hay que tener presente con el objetivo de 200px: un
// archivo de menos de 200px de ancho NO llega a 200 — se queda en su
// tamaño real. El compromiso de "160 a 200 para un apaisado" vale para
// archivos de al menos 200px de ancho, que es lo normal en un logo real
// (el de la base mide 1201). Si un logo sale chico, mirar primero las
// dimensiones del archivo antes que la caja.
//
// El recorte se hace acá y no dentro de escalarDentroDeCaja() porque esa
// función la comparte la portada del informe .docx, que hoy sí amplía y no
// es parte de este cambio.
export function escalarLogoDeEncabezado(ancho: number, alto: number): { width: number; height: number } {
  return escalarDentroDeCaja(ancho, alto, Math.min(LOGO_ANCHO_OBJETIVO, ancho), Math.min(LOGO_ALTO_MAX, alto));
}

// El archivo del logo cambia solo cuando el admin sube otro, y ahí cambia
// también la clave (es un UUID nuevo). Así que la medición se puede
// cachear por clave sin invalidación: una clave vieja simplemente deja de
// consultarse. Evita leer el archivo del almacenamiento —una ida a S3 en
// producción— en cada correo de cada tanda del job diario.
const tamanosMedidos = new Map<string, { width: number; height: number } | null>();

async function medirLogo(clave: string): Promise<{ width: number; height: number } | null> {
  if (tamanosMedidos.has(clave)) return tamanosMedidos.get(clave)!;

  let tamano: { width: number; height: number } | null = null;
  try {
    const buffer = await almacenamientoPublico.leer(clave);
    const real = dimensionesImagen(buffer, tipoDeImagenPorClave(clave));
    if (real.width > 0 && real.height > 0) {
      tamano = escalarLogoDeEncabezado(real.width, real.height);
    }
  } catch (err) {
    // No es excepcional: un logo cargado antes de la migración de
    // almacenamiento puede no tener archivo detrás (ver la nota sobre
    // archivo_ref). Se registra una vez por clave y se sigue.
    console.warn(
      `marcaCorreo: no se pudo medir el logo ${clave} (${err instanceof Error ? err.message : String(err)}) — el encabezado usa el nombre en texto`
    );
  }

  // Se cachea también el null: si el archivo no está, no tiene sentido
  // reintentar la lectura en cada correo.
  tamanosMedidos.set(clave, tamano);
  return tamano;
}

// Con almacenamiento local, url() devuelve una ruta relativa que no
// significa nada dentro de un cliente de correo; con s3 ya viene absoluta.
function absolutizar(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${config.apiPublicUrl.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

// Devuelve la marca que corresponde al tipo de correo. Si el tipo es de
// comercio pero el tenant no se puede leer (o no hay tenant), cae en la
// marca de plataforma: es peor mandar un correo sin encabezado que uno
// con el encabezado equivocado.
export async function resolverMarca(
  db: Pool | PoolClient,
  tipo: TipoCorreo,
  tenantId: string | null
): Promise<MarcaCorreo> {
  if (!TIPOS_MARCA_COMERCIO.has(tipo) || !tenantId) return marcaPlataforma();

  try {
    const { rows } = await db.query(
      `SELECT nombre, logo_url, email FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = rows[0];
    if (!tenant?.nombre) return marcaPlataforma();

    // Un logo que no se puede medir no se muestra: sin sus dimensiones no
    // hay forma de acotarlo sin deformarlo, y el encabezado cae en el
    // nombre en texto — que es exactamente lo que corresponde, porque un
    // archivo ilegible tampoco iba a cargar en el cliente de correo.
    const clave = tenant.logo_url ? claveLogoDesdeValorGuardado(tenant.logo_url) : null;
    const logoTamano = clave ? await medirLogo(clave) : null;

    return {
      nombre: tenant.nombre,
      logoUrl: clave && logoTamano ? absolutizar(almacenamientoPublico.url(clave)) : null,
      logoTamano,
      replyTo: direccionValida(tenant.email),
      esComercio: true,
    };
  } catch (err) {
    console.error(`marcaCorreo: no se pudo resolver la marca del tenant ${tenantId}`, err);
    return marcaPlataforma();
  }
}
