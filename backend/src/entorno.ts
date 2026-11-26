import { config } from "./config";

// ---------------------------------------------------------------------
// ¿ESTE AMBIENTE ES LOCAL?
//
// Una sola respuesta para todo el backend. Antes la pregunta vivía
// dentro de `scripts/guardaDesarrollo.ts`, que la usaba para no sembrar
// datos de demostración contra producción. Ahora la necesita también el
// envío de mensajes —en desarrollo no sale nada hacia un proveedor
// real—, y dos criterios de «¿es producción?» que puedan divergir serían
// exactamente el defecto que esto evita.
//
// POR QUÉ MIRA `FRONTEND_URL` Y NO UNA VARIABLE «ES_PRODUCCION»: una
// variable así hay que acordarse de ponerla, y la que importa es la que
// NO está puesta en el ambiente peligroso. `FRONTEND_URL` ya existe, es
// obligatoria para que los correos salgan con enlaces correctos, y en
// producción es el dominio público real. El dato que distingue los dos
// ambientes ya está ahí y nadie lo puede olvidar sin romper otra cosa
// antes.
//
// Es FAIL-CLOSED en el sentido que importa para cada uso:
//
//   * los scripts de siembra exigen prueba POSITIVA de que es local;
//   * el envío de mensajes trata como local todo lo que no sea
//     demostrablemente producción, porque equivocarse hacia «no mandar»
//     cuesta un correo que no salió, y equivocarse hacia «mandar» cuesta
//     un correo que llegó a una persona real desde una máquina de
//     desarrollo. Ya pasó: el job diario mandó dos avisos por Resend
//     real a un cliente de demostración.
// ---------------------------------------------------------------------

/** Loopback, o una de las tres redes privadas de la RFC 1918. */
export function esAnfitrionLocal(anfitrion: string): boolean {
  if (anfitrion === "localhost" || anfitrion === "::1") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(anfitrion)) return true;
  // Rango privado: el acceso por red local (FRONTEND_URL con la IP de la
  // máquina en la LAN) quedó documentado como alternativa, y volver a
  // activarlo no debería cambiar el comportamiento de los envíos.
  if (/^10\./.test(anfitrion)) return true;
  if (/^192\.168\./.test(anfitrion)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(anfitrion)) return true;
  return false;
}

export interface Veredicto {
  local: boolean;
  motivos: string[];
}

/**
 * El diagnóstico completo, con los motivos. Lo usa la guarda de los
 * scripts, que necesita explicarle a una persona por qué no corre.
 */
export function diagnosticarEntorno(): Veredicto {
  const motivos: string[] = [];

  if (process.env.NODE_ENV === "production") {
    motivos.push("NODE_ENV=production");
  }

  const crudo = config.frontendUrl;
  let anfitrion: string | null = null;
  try {
    anfitrion = new URL(crudo).hostname;
  } catch {
    motivos.push(`FRONTEND_URL no es una URL interpretable: "${crudo}"`);
  }
  if (anfitrion && !esAnfitrionLocal(anfitrion)) {
    motivos.push(`FRONTEND_URL apunta a "${anfitrion}", que no es loopback ni una red privada`);
  }

  return { local: motivos.length === 0, motivos };
}

/** `true` solo si el ambiente es demostrablemente local. */
export function esEntornoLocal(): boolean {
  return diagnosticarEntorno().local;
}

/**
 * LA PUERTA DE LOS ENVÍOS REALES.
 *
 * En un ambiente local, ningún mensaje sale hacia un proveedor real —ni
 * correo ni WhatsApp— salvo que alguien lo pida explícitamente con
 * `ENVIOS_REALES=1`. Esa variable existe porque probar la entrega de
 * verdad es una tarea legítima (ya se hizo con cuatro correos
 * transaccionales), y tiene que ser un acto deliberado y visible, no el
 * comportamiento por defecto de cualquiera que levante el entorno.
 */
export function enviosRealesHabilitados(): boolean {
  if (!esEntornoLocal()) return true;
  return process.env.ENVIOS_REALES === "1";
}

/** Para el log y para los verificadores: por qué se está simulando. */
export function explicacionDeSimulacion(): string {
  if (enviosRealesHabilitados()) return "";
  return (
    "Ambiente local sin ENVIOS_REALES=1: el mensaje NO sale hacia un proveedor real. " +
    "Para probar una entrega de verdad, levantá el backend con ENVIOS_REALES=1."
  );
}
