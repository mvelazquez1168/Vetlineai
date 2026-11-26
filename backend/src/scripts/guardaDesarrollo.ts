import { diagnosticarEntorno } from "../entorno";

// ---------------------------------------------------------------------
// EL CORTAFUEGOS de los scripts que ESCRIBEN datos de demostración.
//
// Un script de siembra inventa clínicas, emisores, comprobantes y
// movimientos de stock. Corrido contra la base de producción no rompe
// nada ruidosamente: deja datos falsos indistinguibles de los reales,
// mezclados con los de clínicas que están facturando. Eso no se
// descubre el mismo día.
//
// Ya hay una barrera estructural: `tsconfig.build.json` excluye
// `src/scripts`, así que estos archivos NO viajan en la imagen de
// producción y `node dist/scripts/…` es un comando que no existe. Esta
// guarda es la segunda, para el caso que esa no cubre: alguien con el
// repo clonado y las variables de producción a mano.
//
// POR QUÉ MIRA LA URL DEL FRONTEND Y NO UNA VARIABLE "ES_PRODUCCION":
// una variable así hay que acordarse de ponerla, y la que importa es la
// que NO está puesta en el ambiente peligroso. `FRONTEND_URL` en cambio
// ya existe, es obligatoria para que los correos salgan con enlaces
// correctos, y en producción es el dominio público real
// (`${APP_URL}` en docker-compose.prod.yml). O sea: el dato que
// distingue los dos ambientes ya está ahí y nadie lo puede olvidar sin
// romper otra cosa antes.
//
// Es FAIL-CLOSED: no detecta producción para bloquearla, exige prueba
// positiva de que el ambiente es local. Un valor que no se puede
// interpretar también detiene el script.
// ---------------------------------------------------------------------

// El criterio de «¿es local?» vive en `entorno.ts`: lo comparten esta
// guarda y la puerta de los envíos reales. Dos criterios que puedan
// divergir serían el defecto que esto evita.

/**
 * Detiene el proceso si el ambiente no es demostrablemente local.
 *
 * Se llama ANTES de abrir la primera transacción, no en medio de la
 * siembra: un script que aborta a la mitad deja peor que uno que no
 * arranca.
 */
export function exigirEntornoDeDesarrollo(nombreScript: string): void {
  const { local, motivos } = diagnosticarEntorno();
  if (local) return;

  console.error(
    [
      "",
      `  ${nombreScript} NO va a correr en este ambiente.`,
      "",
      "  Este script ESCRIBE datos de demostración (clínicas, comprobantes,",
      "  movimientos de stock). Contra una base real deja datos falsos",
      "  mezclados con los de clínicas que están operando.",
      "",
      "  Por qué se detuvo:",
      ...motivos.map((m) => `    · ${m}`),
      "",
      "  Si de verdad estás en desarrollo, revisá FRONTEND_URL en",
      "  docker-compose.yml: tiene que apuntar a localhost.",
      "",
    ].join("\n")
  );
  process.exit(1);
}
