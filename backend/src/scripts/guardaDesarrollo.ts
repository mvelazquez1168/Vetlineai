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

// ---------------------------------------------------------------------
// EL AVISO DE `pg` ES UN ERROR EN LAS PRUEBAS — punto 8 del 2026-11-27.
//
// «Calling client.query() when the client is already executing a query
// is deprecated and will be removed in pg@9.0» significa que alguien
// lanzó dos consultas en paralelo sobre la misma conexión. Hoy funciona
// porque `pg` las encola; en pg@9 deja de funcionar.
//
// Estaba en el log y nadie lo leía. Acá se convierte en algo que se ve:
// cualquier verificador que lo dispare termina con fallo, con el
// `Promise.all` culpable en la pila.
//
// No se instala en producción: esto vive en `scripts/`, que es lo que
// corren los verificadores.
// ---------------------------------------------------------------------
let avisoDeConcurrencia: string | null = null;
let seEsperaElAviso = false;

/**
 * Para el único verificador que dispara el aviso A PROPÓSITO.
 *
 * `verificar_consultas_en_serie.ts` necesita provocarlo para demostrar
 * que su control funciona; si no lo provocara, su segunda mitad no
 * probaría nada. Es la excepción, y se declara.
 */
export function seEsperaElAvisoDeConcurrencia(): void {
  seEsperaElAviso = true;
}

process.on("warning", (aviso) => {
  if (/already executing a query/i.test(aviso.message)) {
    avisoDeConcurrencia = [aviso.message, aviso.stack ?? ""].join(String.fromCharCode(10));
  }
});

process.on("exit", (codigo) => {
  if (!avisoDeConcurrencia || seEsperaElAviso) return;
  console.error(
    [
      "",
      "[FALLO] Hubo consultas en paralelo sobre la misma conexión de Postgres.",
      "Una conexión es secuencial: hoy lo tapa pg encolando, y en pg@9 se rompe.",
      avisoDeConcurrencia,
    ].join(String.fromCharCode(10))
  );
  if (codigo === 0) process.exitCode = 1;
});
