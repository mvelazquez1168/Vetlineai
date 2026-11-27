// ---------------------------------------------------------------------
// AUTOCOMPLETAR POR IDENTIFICACIÓN — anexo 07-03, B2.
//
// La interfaz y sus dos implementaciones. El selector vive en
// `proveedorIdentificacionActivo.ts` y no acá, para que un módulo que
// solo necesita los tipos no arrastre el `fetch` contra Hacienda — es el
// mismo reparto que usan `facturacion/proveedorHacienda.ts` y
// `expediente/transcripcion.ts`.
//
// QUÉ SERVICIO SE CONSULTA, Y QUÉ NO.
//
// Se consulta la API pública de contribuyentes del Ministerio de
// Hacienda (`api.hacienda.go.cr/fe/ae`), que es pública, no requiere
// convenio y devuelve el nombre y el régimen tributario de quien está
// inscrito. Es la misma que usa cualquier facturador del país.
//
// NO se consulta el padrón del TSE. El TSE tiene el nombre de TODA
// persona cédula en mano, inscrita o no en Hacienda, y es el dato que
// una clínica querría; pero su uso masivo requiere convenio y, sobre
// todo, tratar datos personales de gente que no es cliente de la clínica
// todavía. Qué haría falta para usarlo está escrito en
// `docs/diseno/tse-padron-y-ley-8968.md`, y es una decisión de negocio,
// no de este archivo.
//
// EL SIMULADO ES DETERMINISTA POR EL NÚMERO, no al azar. Un simulado que
// devuelve nombres aleatorios hace que el mismo caso de prueba dé
// distinto cada vez y que ningún verificador pueda afirmar nada.
// ---------------------------------------------------------------------

export interface DatosDeIdentificacion {
  /** Nombre o razón social como lo tiene el registro. */
  nombre: string;
  /** Lo demás que vino, tal cual. */
  datos: Record<string, unknown>;
}

export interface RespuestaIdentificacion {
  encontrado: boolean;
  datos: DatosDeIdentificacion | null;
  /**
   * Por qué no se pudo, cuando no se pudo.
   *
   * Se distingue de `encontrado: false` a propósito: «esa cédula no
   * existe» es una respuesta del servicio, y «el servicio no contestó»
   * es un problema nuestro. La pantalla trata las dos igual —sigue
   * manual— pero el log y la caché no: una no-respuesta NO se cachea.
   */
  errorTecnico?: string;
}

export interface ProveedorIdentificacion {
  readonly nombre: string;
  /** Si está configurado como para poder usarse. */
  disponible(): { ok: boolean; falta?: string };
  consultar(tipoCodigo: string, numero: string): Promise<RespuestaIdentificacion>;
}

/**
 * Cuántos días vale una consulta guardada.
 *
 * Treinta: el nombre de una persona no cambia, pero su régimen
 * tributario y su estado en Hacienda sí —alguien se inscribe, otro pasa
 * a régimen simplificado—, y esos dos campos son los que la facturación
 * usa. Más de un mes empieza a facturar con un régimen que ya cambió.
 */
export const DIAS_CACHE_IDENTIFICACION = 30;

/**
 * Cuántas consultas por minuto se permiten, por clínica.
 *
 * El servicio de Hacienda es público y gratuito y no publica su límite;
 * la forma de que no nos lo cierren es no parecer un scraper. Doce por
 * minuto es más de lo que una recepción puede escribir y mucho menos de
 * lo que un bucle haría.
 */
export const CONSULTAS_POR_MINUTO = 12;

// ---------------------------------------------------------------------
// EL SIMULADO
// ---------------------------------------------------------------------

/** Los dos dígitos del final deciden el caso. Es lo que lo hace probable. */
const APELLIDOS = [
  "Rodríguez Jiménez",
  "Solís Vargas",
  "Mora Castro",
  "Chaves Araya",
  "Núñez Ramírez",
  "Fallas Quesada",
];
const NOMBRES = ["Ana María", "José Pablo", "Laura", "Carlos Andrés", "Marcela", "Diego"];

export const identificacionSimulada: ProveedorIdentificacion = {
  nombre: "simulado",
  disponible: () => ({ ok: true }),
  async consultar(tipoCodigo, numero) {
    const digitos = numero.replace(/\D/g, "");

    // LOS CASOS DE PRUEBA, por el último dígito. Están documentados acá
    // y en el manual porque la recepción los va a ver en desarrollo:
    //
    //   termina en 0 → no existe (para probar que el alta sigue manual)
    //   termina en 9 → el servicio no contesta (para probar el timeout)
    //   cualquier otro → existe, con nombre derivado del número
    const ultimo = digitos.slice(-1);
    if (ultimo === "0") {
      return { encontrado: false, datos: null };
    }
    if (ultimo === "9") {
      return {
        encontrado: false,
        datos: null,
        errorTecnico: "El servicio de consulta no respondió (caso simulado: número terminado en 9).",
      };
    }

    const n = Number(digitos) || 0;
    const esJuridica = tipoCodigo === "02" || tipoCodigo === "04";
    const nombre = esJuridica
      ? `${APELLIDOS[n % APELLIDOS.length].split(" ")[0]} y Asociados S.A.`
      : `${NOMBRES[n % NOMBRES.length]} ${APELLIDOS[(n >> 3) % APELLIDOS.length]}`;

    return {
      encontrado: true,
      datos: {
        nombre,
        datos: {
          regimen: esJuridica ? "Régimen tradicional" : "Régimen simplificado",
          situacion: "Inscrito",
          actividad: "Simulada",
        },
      },
    };
  },
};

// ---------------------------------------------------------------------
// EL REAL
// ---------------------------------------------------------------------

/**
 * Cuánto se espera al servicio público antes de seguir sin él.
 *
 * Dos segundos y medio. El autocompletar es una comodidad: si tarda más
 * que eso, la recepción ya está escribiendo el nombre a mano y una
 * respuesta tardía que le sobrescribe lo que tecleó es peor que no
 * tener la función.
 */
const TIMEOUT_MS = 2500;

export const identificacionHacienda: ProveedorIdentificacion = {
  nombre: "hacienda",
  disponible() {
    // La API de contribuyentes es pública: no hay credencial que
    // pueda faltar. Lo que sí puede faltar es la URL, si alguien la
    // apunta a otro ambiente.
    const url = process.env.IDENTIDAD_URL;
    if (url !== undefined && !url.startsWith("http")) {
      return { ok: false, falta: "IDENTIDAD_URL no es una URL." };
    }
    return { ok: true };
  },
  async consultar(tipoCodigo, numero) {
    const base = process.env.IDENTIDAD_URL ?? "https://api.hacienda.go.cr/fe/ae";
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${base}?identificacion=${encodeURIComponent(numero)}`, {
        signal: control.signal,
        headers: { Accept: "application/json" },
      });
      if (r.status === 404) {
        // Hacienda contesta 404 cuando la identificación no está
        // inscrita. Es una respuesta, no una falla: se cachea.
        return { encontrado: false, datos: null };
      }
      if (!r.ok) {
        return {
          encontrado: false,
          datos: null,
          errorTecnico: `El servicio de Hacienda respondió ${r.status}.`,
        };
      }
      const cuerpo = (await r.json()) as {
        nombre?: string;
        tipoIdentificacion?: string;
        regimen?: { descripcion?: string };
        situacion?: { estado?: string };
        actividades?: Array<{ descripcion?: string }>;
      };
      if (!cuerpo.nombre) {
        return { encontrado: false, datos: null };
      }
      void tipoCodigo;
      return {
        encontrado: true,
        datos: {
          nombre: cuerpo.nombre,
          datos: {
            regimen: cuerpo.regimen?.descripcion ?? null,
            situacion: cuerpo.situacion?.estado ?? null,
            actividad: cuerpo.actividades?.[0]?.descripcion ?? null,
          },
        },
      };
    } catch (err) {
      // EL TIMEOUT NO ES UN ERROR DEL ALTA. Se devuelve como error
      // técnico y quien llama sigue sin el autocompletar.
      const esTimeout = (err as { name?: string })?.name === "AbortError";
      return {
        encontrado: false,
        datos: null,
        errorTecnico: esTimeout
          ? `El servicio de Hacienda no respondió en ${TIMEOUT_MS} ms.`
          : `No se pudo consultar: ${err instanceof Error ? err.message : "error desconocido"}.`,
      };
    } finally {
      clearTimeout(reloj);
    }
  },
};
