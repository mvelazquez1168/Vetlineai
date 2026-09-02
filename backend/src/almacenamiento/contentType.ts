// El tipo de contenido con el que queda guardado un objeto no es un
// detalle: un logo servido como "binary/octet-stream" no se muestra en el
// cuerpo de un correo — Outlook lo trata como adjunto descargable y el
// encabezado queda roto. Y a diferencia del disco local (donde
// express.static lo deriva de la extensión en cada respuesta), en S3 el
// tipo se fija UNA VEZ, al subir: si se guardó mal, se sirve mal para
// siempre hasta que alguien lo vuelva a subir.
//
// Por eso el ámbito S3 nunca guarda sin tipo: si el llamador no lo pasa,
// se deriva de la extensión de la clave. Las claves las arma siempre el
// backend con la extensión del archivo original, así que es fiable.
//
// Esta es la ÚNICA tabla de extensión → tipo del backend. Había tres
// copias (acá, en archivos.routes.ts y en platform-admin.routes.ts) que ya
// habían divergido sin que nada fallara: las de las rutas servían .txt y
// .csv sin `charset`, y la de platform-admin solo conocía dos extensiones,
// así que un .docx de la Base de Conocimiento se descargaba como
// application/octet-stream. Ninguna de las dos cosas rompe nada visible —
// por eso podían divergir en silencio, y por eso la tabla vive en un solo
// lugar.
const POR_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Acepta la extensión con punto o sin él: los llamadores que vienen de
// `path.extname()` la traen con punto (".pdf") y los que parten una clave,
// sin él. Que las dos formas entren por la misma puerta es justamente lo
// que evita que alguien copie la tabla para "su" formato de clave.
export function contentTypePorExtension(extension: string): string {
  const normalizada = extension.replace(/^\./, "").toLowerCase();
  return POR_EXTENSION[normalizada] ?? "application/octet-stream";
}

export function contentTypePorClave(clave: string): string {
  // Sin punto en la clave, `pop()` devuelve la clave entera y no coincide
  // con ninguna extensión — cae en el genérico, que es lo correcto.
  return contentTypePorExtension(clave.split(".").pop() ?? "");
}
