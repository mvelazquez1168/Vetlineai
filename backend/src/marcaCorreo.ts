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
    logoTamano: escalarDentroDeCaja(194, 100, LOGO_ANCHO_MAX, LOGO_ALTO_MAX),
    replyTo: null,
    esComercio: false,
  };
}

// La caja del encabezado. El ancho útil del cuerpo son 416px (480 menos
// 32 de padding a cada lado); 180 deja el logo en una proporción sensata
// y sobra margen de sobra incluso si algún cliente agrega su propio
// relleno.
const LOGO_ANCHO_MAX = 180;
const LOGO_ALTO_MAX = 36;

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
      tamano = escalarDentroDeCaja(real.width, real.height, LOGO_ANCHO_MAX, LOGO_ALTO_MAX);
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
