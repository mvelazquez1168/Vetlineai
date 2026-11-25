import { config } from "../config";
import { haciendaReal } from "./haciendaReal";
import { haciendaSimulado } from "./haciendaSimulado";
import { ProveedorHacienda } from "./proveedorHacienda";

// ---------------------------------------------------------------------
// LA PUERTA ÚNICA por donde el motor obtiene el proveedor de Hacienda.
//
// Vive en su propio archivo y no dentro de `proveedorHacienda.ts` para
// que la interfaz no importe a las dos implementaciones: así un módulo
// que solo necesita los tipos (el flujo de emisión, un verificador) no
// arrastra el código de `fetch` contra Hacienda.
//
// El default es el SIMULADO. No es una comodidad de desarrollo: es lo que
// impide que un ambiente mal configurado le mande un comprobante de
// prueba a Hacienda. Para usar el real hay que pedirlo explícitamente con
// FE_CR_PROVEEDOR=real.
// ---------------------------------------------------------------------

export function proveedorHaciendaActivo(): ProveedorHacienda {
  return config.feCrProveedor === "real" ? haciendaReal : haciendaSimulado;
}

/**
 * Para el log de arranque: deja dicho con qué proveedor está corriendo.
 *
 * Un facturador que cree estar en pruebas y esté en producción es un
 * problema que se descubre cuando Hacienda ya tiene el comprobante, así
 * que esto se dice fuerte y una vez, no se deduce de la configuración
 * cuando alguien va a buscarla.
 */
export function anunciarProveedorHacienda(): void {
  const p = proveedorHaciendaActivo();
  if (p === haciendaSimulado) {
    console.log(
      "[facturacion] Proveedor de Hacienda: SIMULADO. Ningún comprobante sale hacia los servidores de Hacienda."
    );
  } else {
    console.warn(
      "[facturacion] Proveedor de Hacienda: REAL (FE_CR_PROVEEDOR=real). Los comprobantes se envían a los servidores de Hacienda del ambiente configurado en cada emisor."
    );
  }
}
