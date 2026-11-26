// ---------------------------------------------------------------------
// Guardar un blob como archivo, en un solo lugar.
//
// Este bloque —crear el object URL, un <a> invisible, clickearlo,
// sacarlo del DOM y revocar el URL— estaba copiado en cinco pantallas
// (el .docx del informe, el PDF del reporte de atenciones, la
// exportación de la clínica, el PDF/XML del comprobante y el dashboard).
// Cinco copias del mismo gesto es cinco lugares donde arreglar el día
// que un navegador cambie de criterio, y ya estaban divergiendo en el
// tiempo de revocación.
//
// EL `revokeObjectURL` NO ES OPCIONAL y tampoco puede ser inmediato: el
// navegador necesita el URL vivo mientras arranca la descarga, y si no
// se revoca nunca, el blob queda en memoria hasta que se recarga la
// página. Treinta segundos alcanza para las dos cosas.
// ---------------------------------------------------------------------

export function guardarComoArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
