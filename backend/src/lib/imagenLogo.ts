// Medición y escalado del logo de clínica. Vivía dentro de
// casos.routes.ts, escrito para el .docx del informe cuando una caja fija
// 3:1 deformaba un logo real 4:1; ahora lo necesita también el
// encabezado de los correos, así que se extrae acá en vez de copiarse.

// Lee el ancho/alto real del PNG/JPEG (los dos únicos tipos que acepta la
// carga del logo — ver POST /admin/clinica/logo). PNG: IHDR siempre en el
// mismo offset. JPEG: hay que caminar los marcadores hasta el primer SOF
// (0xC0 o 0xC2).
export function dimensionesImagen(buffer: Buffer, tipo: "png" | "jpg"): { width: number; height: number } {
  if (tipo === "png") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  let i = 2;
  while (i < buffer.length - 9) {
    if (buffer[i] !== 0xff) {
      i++;
      continue;
    }
    const marcador = buffer[i + 1];
    if (marcador === 0xc0 || marcador === 0xc2) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    const largo = buffer.readUInt16BE(i + 2);
    i += 2 + largo;
  }
  return { width: 180, height: 60 };
}

// Ajusta a la caja máxima preservando la proporción real: un logo de
// clínica típico es horizontal (4:1, 5:1...) y forzarlo a un tamaño fijo
// lo deforma. Escala por el lado que primero toca el límite, así el
// resultado nunca excede la caja NI se estira.
export function escalarDentroDeCaja(
  anchoReal: number,
  altoReal: number,
  anchoMax: number,
  altoMax: number
): { width: number; height: number } {
  const escala = Math.min(anchoMax / anchoReal, altoMax / altoReal);
  return { width: Math.round(anchoReal * escala), height: Math.round(altoReal * escala) };
}

export function tipoDeImagenPorClave(clave: string): "png" | "jpg" {
  return /\.png$/i.test(clave) ? "png" : "jpg";
}
