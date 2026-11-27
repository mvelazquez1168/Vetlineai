import { PoolClient } from "pg";
import { config } from "../config";
import {
  CONSULTAS_POR_MINUTO,
  DIAS_CACHE_IDENTIFICACION,
  identificacionHacienda,
  identificacionSimulada,
  ProveedorIdentificacion,
  RespuestaIdentificacion,
} from "./proveedorIdentificacion";

// ---------------------------------------------------------------------
// LA PUERTA ÚNICA del autocompletar por identificación (anexo 07-03, B2).
//
// El default es el SIMULADO, igual que en facturación y transcripción. No
// es comodidad de desarrollo: es lo que impide que un ambiente mal
// configurado le mande el tráfico de todas las clínicas a un servicio
// público del Estado. Para usar el real hay que pedirlo con
// IDENTIDAD_PROVEEDOR=hacienda.
// ---------------------------------------------------------------------

export function proveedorIdentificacionActivo(): ProveedorIdentificacion {
  return config.identidadProveedor === "hacienda" ? identificacionHacienda : identificacionSimulada;
}

export function anunciarProveedorIdentificacion(): void {
  const p = proveedorIdentificacionActivo();
  const estado = p.disponible();
  if (p === identificacionSimulada) {
    console.log(
      "[clientes] Autocompletar por identificación: SIMULADO. Ninguna consulta sale hacia Hacienda. Los números terminados en 0 devuelven «no existe» y los terminados en 9 simulan que el servicio no contesta."
    );
    return;
  }
  if (!estado.ok) {
    console.warn(`[clientes] Autocompletar por identificación: REAL mal configurado — ${estado.falta}`);
    return;
  }
  console.warn(
    "[clientes] Autocompletar por identificación: REAL (IDENTIDAD_PROVEEDOR=hacienda). Las consultas salen a la API pública de contribuyentes."
  );
}

// ---------------------------------------------------------------------
// EL LÍMITE DE FRECUENCIA, en memoria del proceso.
//
// Es el patrón de `tarifas.ts`: un Map de módulo, por clínica, con la
// ventana de un minuto. No va a la base porque el objetivo no es
// auditar: es no golpear un servicio ajeno. Si el proceso se reinicia y
// la ventana se pierde, no pasa nada; si cada consulta tuviera que
// escribir en la base, el autocompletar sería más lento que escribir el
// nombre a mano.
// ---------------------------------------------------------------------
const ventanas = new Map<string, { desde: number; cuantas: number }>();

function dentroDelLimite(tenantId: string): boolean {
  const ahora = Date.now();
  const v = ventanas.get(tenantId);
  if (!v || ahora - v.desde > 60_000) {
    ventanas.set(tenantId, { desde: ahora, cuantas: 1 });
    return true;
  }
  if (v.cuantas >= CONSULTAS_POR_MINUTO) return false;
  v.cuantas += 1;
  return true;
}

export interface ResultadoConsulta extends RespuestaIdentificacion {
  /** De dónde salió: la caché o el servicio. Lo muestra la pantalla. */
  deCache: boolean;
  proveedor: string;
}

/**
 * La consulta, con su caché y su límite.
 *
 * ESTE ES EL ÚNICO PUNTO QUE LAS RUTAS LLAMAN. El formato ya viene
 * validado por quien llama (la ruta conoce `tipos_identificacion`); acá
 * se decide si hace falta ir al servicio.
 *
 * NO LANZA NUNCA. El autocompletar es una comodidad: si falla, devuelve
 * `encontrado: false` con el motivo y el alta sigue a mano. Una
 * excepción acá rompería el formulario de clientes por un servicio
 * ajeno que se cayó.
 */
export async function consultarIdentificacion(
  db: PoolClient,
  tenantId: string,
  tipoCodigo: string,
  numero: string,
  paisCodigo = "CR"
): Promise<ResultadoConsulta> {
  const proveedor = proveedorIdentificacionActivo();
  const limpio = numero.replace(/\s|-/g, "");

  // 1. LA CACHÉ. Incluye los «no existe»: preguntar diez veces por una
  //    cédula que no está inscrita es diez viajes para la misma nada.
  const cache = await db.query<{
    nombre: string | null;
    datos: Record<string, unknown>;
    encontrado: boolean;
    proveedor: string;
    vieja: boolean;
  }>(
    `SELECT nombre, datos, encontrado, proveedor,
            (consultado_en < now() - ($4 || ' days')::interval) AS vieja
       FROM identificacion_cache
      WHERE pais_codigo = $1 AND tipo_codigo = $2 AND numero = $3`,
    [paisCodigo, tipoCodigo, limpio, String(DIAS_CACHE_IDENTIFICACION)]
  );
  const guardado = cache.rows[0];
  if (guardado && !guardado.vieja && guardado.proveedor === proveedor.nombre) {
    return {
      encontrado: guardado.encontrado,
      datos: guardado.encontrado ? { nombre: guardado.nombre ?? "", datos: guardado.datos } : null,
      deCache: true,
      proveedor: guardado.proveedor,
    };
  }

  // 2. EL LÍMITE. Si se pasó, se devuelve lo que haya en la caché
  //    aunque esté vieja —un nombre de hace dos meses sirve más que
  //    nada— y si no hay nada, se dice que no se pudo.
  if (!dentroDelLimite(tenantId)) {
    if (guardado) {
      return {
        encontrado: guardado.encontrado,
        datos: guardado.encontrado ? { nombre: guardado.nombre ?? "", datos: guardado.datos } : null,
        deCache: true,
        proveedor: guardado.proveedor,
      };
    }
    return {
      encontrado: false,
      datos: null,
      errorTecnico: `Demasiadas consultas en un minuto (el tope es ${CONSULTAS_POR_MINUTO}). Escribí el nombre a mano.`,
      deCache: false,
      proveedor: proveedor.nombre,
    };
  }

  const disponible = proveedor.disponible();
  if (!disponible.ok) {
    return {
      encontrado: false,
      datos: null,
      errorTecnico: `El autocompletar no está configurado: ${disponible.falta}`,
      deCache: false,
      proveedor: proveedor.nombre,
    };
  }

  const r = await proveedor.consultar(tipoCodigo, limpio);

  // 3. SE CACHEA LA RESPUESTA, NO LA FALLA. Un timeout no es un dato
  //    sobre esa cédula: cachearlo haría que el autocompletar quede
  //    roto treinta días por una caída de un minuto.
  if (!r.errorTecnico) {
    await db.query(
      `INSERT INTO identificacion_cache
         (pais_codigo, tipo_codigo, numero, nombre, datos, encontrado, proveedor)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (pais_codigo, tipo_codigo, numero) DO UPDATE
         SET nombre = EXCLUDED.nombre,
             datos = EXCLUDED.datos,
             encontrado = EXCLUDED.encontrado,
             proveedor = EXCLUDED.proveedor,
             consultado_en = now()`,
      [
        paisCodigo,
        tipoCodigo,
        limpio,
        r.datos?.nombre ?? null,
        JSON.stringify(r.datos?.datos ?? {}),
        r.encontrado,
        proveedor.nombre,
      ]
    );
  }

  return { ...r, deCache: false, proveedor: proveedor.nombre };
}

/**
 * El número está completo según el formato de su tipo.
 *
 * Sale de `tipos_identificacion.formato_regex` (migración 128) y no de
 * una constante acá: el formato es del país y el catálogo es por país.
 * Sin formato cargado —el pasaporte— no se valida y no se consulta: no
 * hay forma de saber cuándo está completo.
 */
export async function formatoValido(
  db: PoolClient,
  tipoIdentificacionId: string,
  numero: string
): Promise<{ valido: boolean; codigo: string | null; formato: string | null }> {
  const r = await db.query<{ codigo: string; formato_regex: string | null }>(
    `SELECT codigo, formato_regex FROM tipos_identificacion WHERE id = $1`,
    [tipoIdentificacionId]
  );
  if (r.rows.length === 0) return { valido: false, codigo: null, formato: null };
  const { codigo, formato_regex } = r.rows[0];
  if (!formato_regex) return { valido: false, codigo, formato: null };
  const limpio = numero.replace(/\s|-/g, "");
  return { valido: new RegExp(formato_regex).test(limpio), codigo, formato: formato_regex };
}
