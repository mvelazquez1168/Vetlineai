import {
  CredencialesHacienda,
  DatosEnvio,
  ErrorHaciendaSinRespuesta,
  EstadoConsultado,
  ProveedorHacienda,
  ResultadoEnvio,
} from "./proveedorHacienda";

// ---------------------------------------------------------------------
// El proveedor REAL: la API de Recepción de Comprobantes Electrónicos de
// Hacienda, con su IdP.
//
// Todas las URL de este archivo salen del Anexo 3 de
// `ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` y de `Guia_IdP.pdf`; están citadas en
// `docs/facturacion/datos-oficiales.md`.
//
// ⚠️ ESTE CÓDIGO NO SE EJECUTÓ CONTRA HACIENDA. El prompt que lo
// construyó prohíbe mandar algo a los servidores reales, y las
// credenciales de pruebas todavía no existen. Lo que está verificado es
// el flujo del motor con el proveedor simulado; esto queda listo para la
// primera prueba contra el sandbox. Ver la sección correspondiente del
// reporte en `docs/reportes/`.
// ---------------------------------------------------------------------

/** Anexo 3. */
const URL_API = {
  produccion: "https://api.comprobanteselectronicos.go.cr/recepcion/v1/",
  pruebas: "https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/",
} as const;

/** Anexo 3 + Guía IdP. El realm y el client_id cambian por ambiente. */
const IDP = {
  produccion: {
    token: "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token",
    clientId: "api-prod",
  },
  pruebas: {
    token:
      "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token",
    clientId: "api-stag",
  },
} as const;

/**
 * El token de Hacienda expira en CINCO MINUTOS (Anexo 3). El caché no es
 * una optimización: sin él, una tanda de treinta comprobantes pide
 * treinta tokens, y el IdP es un servicio compartido.
 *
 * Se renueva un poco antes de que venza, para que un token no expire
 * entre que se pide y que se usa.
 */
const MARGEN_RENOVACION_MS = 30_000;

/** Timeout de cada llamada. Más allá de esto se considera "no contestó". */
const TIMEOUT_MS = 20_000;

interface TokenCacheado {
  accessToken: string;
  refreshToken?: string;
  /** Cuándo deja de servir, ya con el margen aplicado. */
  vence: number;
}

/**
 * Caché de tokens por emisor Y ambiente: la llave es el usuario de la
 * API más el ambiente. Dos clínicas distintas tienen tokens distintos, y
 * el mismo emisor en pruebas y en producción también.
 *
 * Es un `Map` de módulo y no una tabla: un token de cinco minutos no
 * tiene sentido persistirlo, y guardarlo en la base sería guardar un
 * secreto más.
 */
const tokens = new Map<string, TokenCacheado>();

function llaveToken(cred: CredencialesHacienda): string {
  return `${cred.ambiente}|${cred.usuarioApi}`;
}

/**
 * Pide o renueva el token. Usa el `refresh_token` si lo tiene, como pide
 * el Anexo 3 ("la aplicación del contribuyente debe encargarse de
 * renovar este Token cuando expira"), y solo vuelve a mandar la
 * contraseña si el refresh falla.
 */
async function obtenerToken(cred: CredencialesHacienda): Promise<string> {
  const llave = llaveToken(cred);
  const cacheado = tokens.get(llave);
  if (cacheado && cacheado.vence > Date.now()) return cacheado.accessToken;

  const idp = IDP[cred.ambiente];

  if (cacheado?.refreshToken) {
    try {
      return await pedirToken(llave, idp, {
        grant_type: "refresh_token",
        client_id: idp.clientId,
        refresh_token: cacheado.refreshToken,
      });
    } catch {
      // El refresh venció o se invalidó: se vuelve a autenticar con
      // usuario y contraseña. No se propaga el error del refresh porque
      // no es un fallo del envío, es un paso intermedio.
      tokens.delete(llave);
    }
  }

  return pedirToken(llave, idp, {
    // Anexo 3: "Resource Owner Password Credential". `client_secret` y
    // `scope` se dejan VACÍOS — la Guía IdP lo dice explícitamente, y
    // mandarlos hace fallar la autenticación.
    grant_type: "password",
    client_id: idp.clientId,
    username: cred.usuarioApi,
    password: cred.passwordApi,
  });
}

async function pedirToken(
  llave: string,
  idp: { token: string; clientId: string },
  cuerpo: Record<string, string>
): Promise<string> {
  const respuesta = await conTimeout(
    fetch(idp.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(cuerpo).toString(),
    })
  );

  if (!respuesta.ok) {
    // El cuerpo de un error del IdP puede incluir el usuario, nunca la
    // contraseña. Se recorta a 300 caracteres para que un HTML de error
    // no inunde el log.
    const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
    throw new ErrorHaciendaSinRespuesta(
      `El servicio de identidad de Hacienda devolvió ${respuesta.status} al pedir el token: ${detalle}`,
      respuesta.status
    );
  }

  const datos = (await respuesta.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!datos.access_token) {
    throw new ErrorHaciendaSinRespuesta(
      "El servicio de identidad de Hacienda respondió sin access_token."
    );
  }

  // `expires_in` viene en segundos. Si no viniera, se asumen los 5
  // minutos que documenta el Anexo 3.
  const duracionMs = (datos.expires_in ?? 300) * 1000;
  tokens.set(llave, {
    accessToken: datos.access_token,
    refreshToken: datos.refresh_token,
    vence: Date.now() + Math.max(duracionMs - MARGEN_RENOVACION_MS, 5_000),
  });

  return datos.access_token;
}

/**
 * `fetch` con tope de tiempo. Un `fetch` sin timeout contra un servicio
 * que no responde deja la request colgada; y acá "no responde" tiene que
 * convertirse en contingencia, no en una espera infinita.
 */
async function conTimeout(promesa: Promise<Response>): Promise<Response> {
  const corte = new Promise<never>((_, rechazar) =>
    setTimeout(
      () =>
        rechazar(
          new ErrorHaciendaSinRespuesta(
            `Hacienda no respondió en ${TIMEOUT_MS / 1000} segundos.`
          )
        ),
      TIMEOUT_MS
    )
  );
  try {
    return await Promise.race([promesa, corte]);
  } catch (err) {
    if (err instanceof ErrorHaciendaSinRespuesta) throw err;
    // Error de red, DNS, TLS: no hubo respuesta.
    throw new ErrorHaciendaSinRespuesta(
      `No se pudo contactar a Hacienda: ${(err as Error).message}`
    );
  }
}

export const haciendaReal: ProveedorHacienda = {
  nombre: "hacienda-real",

  async enviar(datos: DatosEnvio, cred: CredencialesHacienda): Promise<ResultadoEnvio> {
    const token = await obtenerToken(cred);

    // ⚠️ LA FORMA EXACTA DE ESTE CUERPO NO ESTÁ EN LAS FUENTES
    // DESCARGADAS. El Anexo 3 describe el recurso y remite a "la
    // documentación Web" del portal de Hacienda para el JSON Schema, que
    // no se pudo obtener (ver "Lo que NO se encontró" en
    // docs/facturacion/fuentes/LEEME.md).
    //
    // Los nombres de abajo son los que el propio anexo usa en el ejemplo
    // del callback (`clave`, `fecha`, `respuestaXml`) extendidos con los
    // del emisor y el receptor. Están AQUÍ, en un solo objeto, para que
    // ajustarlos cuando se tenga el schema sea cambiar esto y nada más.
    // Hasta esa confirmación, este cuerpo es una suposición informada y
    // no un hecho documentado.
    const cuerpo: Record<string, unknown> = {
      clave: datos.clave,
      fecha: datos.fechaEmision,
      emisor: {
        tipoIdentificacion: datos.emisor.tipoIdentificacion,
        numeroIdentificacion: datos.emisor.numeroIdentificacion,
      },
      comprobanteXml: Buffer.from(datos.xmlFirmado, "utf-8").toString("base64"),
    };
    if (datos.receptor) {
      cuerpo.receptor = {
        tipoIdentificacion: datos.receptor.tipoIdentificacion,
        numeroIdentificacion: datos.receptor.numeroIdentificacion,
      };
    }

    const respuesta = await conTimeout(
      fetch(`${URL_API[cred.ambiente]}recepcion`, {
        method: "POST",
        headers: {
          // Anexo 3: el prefijo es "bearer", en minúscula en el documento.
          Authorization: `bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(cuerpo),
      })
    );

    const texto = (await respuesta.text().catch(() => "")).slice(0, 2000);

    // 5xx es "no contestó": el comprobante puede haber entrado o no, y la
    // consulta por clave lo va a decir. Tratarlo como rechazo sería
    // descartar algo que Hacienda quizá aceptó.
    if (respuesta.status >= 500) {
      throw new ErrorHaciendaSinRespuesta(
        `Hacienda devolvió ${respuesta.status} al recibir el comprobante.`,
        respuesta.status
      );
    }

    // 401/403: el token no sirve. Se descarta el caché para que el
    // próximo intento vuelva a autenticar en vez de reusar un token
    // muerto — si no, el reintento falla igual para siempre.
    if (respuesta.status === 401 || respuesta.status === 403) {
      tokens.delete(llaveToken(cred));
      throw new ErrorHaciendaSinRespuesta(
        `Hacienda rechazó la autenticación (${respuesta.status}). Las credenciales de la API pueden estar vencidas o ser de otro ambiente.`,
        respuesta.status
      );
    }

    return {
      recibido: respuesta.status >= 200 && respuesta.status < 300,
      codigoHttp: respuesta.status,
      detalle: texto || undefined,
    };
  },

  async consultarEstado(
    clave: string,
    cred: CredencialesHacienda
  ): Promise<EstadoConsultado | null> {
    const token = await obtenerToken(cred);

    const respuesta = await conTimeout(
      fetch(`${URL_API[cred.ambiente]}recepcion/${clave}`, {
        method: "GET",
        headers: { Authorization: `bearer ${token}` },
      })
    );

    // 404 no es un error: Hacienda no conoce esa clave, o sea que el
    // envío no llegó. El motor lo trata como "hay que reintentar".
    if (respuesta.status === 404) return null;

    if (respuesta.status >= 500) {
      throw new ErrorHaciendaSinRespuesta(
        `Hacienda devolvió ${respuesta.status} al consultar el estado.`,
        respuesta.status
      );
    }
    if (respuesta.status === 401 || respuesta.status === 403) {
      tokens.delete(llaveToken(cred));
      throw new ErrorHaciendaSinRespuesta(
        `Hacienda rechazó la autenticación al consultar el estado (${respuesta.status}).`,
        respuesta.status
      );
    }
    if (!respuesta.ok) {
      throw new ErrorHaciendaSinRespuesta(
        `Hacienda devolvió ${respuesta.status} al consultar el estado de ${clave}.`,
        respuesta.status
      );
    }

    const datos = (await respuesta.json()) as {
      clave?: string;
      fecha?: string;
      indEstado?: string;
      respuestaXml?: string;
    };

    if (!datos.indEstado) {
      throw new ErrorHaciendaSinRespuesta(
        `Hacienda respondió la consulta de ${clave} sin indEstado.`,
        respuesta.status
      );
    }

    const respuestaXml = datos.respuestaXml
      ? Buffer.from(datos.respuestaXml, "base64").toString("utf-8")
      : undefined;

    return {
      clave: datos.clave ?? clave,
      indEstado: datos.indEstado,
      fecha: datos.fecha,
      respuestaXml,
      detalle: respuestaXml ? extraerDetalleDeRespuesta(respuestaXml) : undefined,
    };
  },
};

/**
 * Saca el motivo del XML de respuesta de Hacienda (`MensajeHacienda`),
 * sin reescribirlo.
 *
 * Con una expresión regular y no con un parser: lo único que hace falta
 * es el contenido de `DetalleMensaje`, el XML completo ya se guarda
 * aparte y textual, y así extraer el motivo no puede fallar por una
 * sorpresa de namespace en un documento que llega de afuera.
 */
export function extraerDetalleDeRespuesta(respuestaXml: string): string | undefined {
  const m = /<(?:[\w-]+:)?DetalleMensaje>([\s\S]*?)<\/(?:[\w-]+:)?DetalleMensaje>/.exec(
    respuestaXml
  );
  return m?.[1]?.trim() || undefined;
}

/**
 * Vacía el caché de tokens. Solo para los verificadores: en producción el
 * caché se renueva solo.
 */
export function olvidarTokens(): void {
  tokens.clear();
}
