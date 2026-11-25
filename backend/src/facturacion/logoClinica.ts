import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "../almacenamiento";

// ---------------------------------------------------------------------
// El logo de la clínica para el PDF del comprobante.
//
// A diferencia del PDF de la receta, acá el logo es OPCIONAL y su
// ausencia no impide emitir. La receta devuelve 422 pidiendo que suban el
// logo antes de emitirla, y tiene sentido: una receta sin identidad
// visual de la clínica no sirve de nada. Un comprobante electrónico es
// distinto — su validez está en el XML firmado, no en el papel. Negarse a
// generar el PDF por falta de logo bloquearía una venta por un dato
// estético.
//
// Así que un logo que falta, o que no se puede leer del almacenamiento,
// devuelve `undefined` y el PDF pone el nombre de la clínica en texto.
// ---------------------------------------------------------------------

export async function logoDeLaClinica(logoUrl: string | null): Promise<Buffer | undefined> {
  if (!logoUrl) return undefined;
  try {
    return await almacenamientoPublico.leer(claveLogoDesdeValorGuardado(logoUrl));
  } catch (err) {
    // Se registra y se sigue. Un comprobante sin logo es legible; un
    // comprobante que no se genera, no.
    console.error(
      `[facturacion] No se pudo leer el logo de la clínica para el PDF del comprobante (${logoUrl}); se usa el nombre en texto.`,
      err
    );
    return undefined;
  }
}
