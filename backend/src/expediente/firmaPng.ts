import zlib from "zlib";
import { medidasDeImagen } from "../marca/marcaClinica";

// ---------------------------------------------------------------------
// ¿ESTO ES UNA FIRMA, O UN PÍXEL?
//
// DEFECTO QUE ESTE ARCHIVO EXISTE PARA CERRAR: la pantalla mandaba un
// PNG fijo de 1×1 transparente como «firma» y el backend lo aceptaba
// —solo miraba que el texto empezara con `data:image/`—. Todos los
// consentimientos del expediente decían «firmado» sin respaldar nada.
//
// La validación tiene que ser del lado del servidor, no de la pantalla:
// la pantalla es justamente la que mandaba el píxel. Y no alcanza con
// mirar el tamaño del base64, porque un PNG grande puede estar vacío.
// Hay que **mirar los píxeles**.
//
// POR QUÉ SE DECODIFICA A MANO y no con una librería: un PNG de
// `canvas.toDataURL()` es siempre RGBA de 8 bits sin entrelazar, que es
// el caso más simple del formato —inflar el IDAT y deshacer el filtro
// por línea—. Son sesenta líneas contra una dependencia nueva en la
// cadena de suministro para contar píxeles.
// ---------------------------------------------------------------------

/** Lo mínimo que se acepta como firma. */
export const MINIMO = {
  ancho: 200,
  alto: 60,
  /** Qué parte del lienzo tiene que tener tinta. Un trazo real pinta poco. */
  proporcionTintaMinima: 0.002,
  /** Y qué parte NO puede superar: una imagen rellena no es una firma. */
  proporcionTintaMaxima: 0.6,
};

export interface AnalisisDeFirma {
  valida: boolean;
  motivo?: string;
  ancho: number;
  alto: number;
  /** Proporción de píxeles con tinta, de 0 a 1. */
  tinta: number;
}

interface PngCrudo {
  ancho: number;
  alto: number;
  profundidad: number;
  tipoColor: number;
  datos: Buffer;
}

/** Lee la cabecera y junta los IDAT. */
function leerPng(buf: Buffer): PngCrudo | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  const ancho = buf.readUInt32BE(16);
  const alto = buf.readUInt32BE(20);
  const profundidad = buf[24];
  const tipoColor = buf[25];
  const entrelazado = buf[28];
  if (entrelazado !== 0) return null;

  const trozos: Buffer[] = [];
  let i = 8;
  while (i + 8 <= buf.length) {
    const largo = buf.readUInt32BE(i);
    const tipo = buf.toString("latin1", i + 4, i + 8);
    if (tipo === "IDAT") trozos.push(buf.subarray(i + 8, i + 8 + largo));
    if (tipo === "IEND") break;
    i += 12 + largo;
  }
  if (trozos.length === 0) return null;

  try {
    return {
      ancho,
      alto,
      profundidad,
      tipoColor,
      datos: zlib.inflateSync(Buffer.concat(trozos)),
    };
  } catch {
    return null;
  }
}

/** Deshace el filtro de cada línea. Es lo que define el formato PNG. */
function desfiltrar(png: PngCrudo, canales: number): Buffer | null {
  const bytesPorPixel = canales * (png.profundidad / 8);
  const bytesPorLinea = png.ancho * bytesPorPixel;
  const salida = Buffer.alloc(png.alto * bytesPorLinea);
  let origen = 0;

  for (let y = 0; y < png.alto; y++) {
    if (origen >= png.datos.length) return null;
    const filtro = png.datos[origen++];
    const linea = png.datos.subarray(origen, origen + bytesPorLinea);
    origen += bytesPorLinea;
    const destino = y * bytesPorLinea;
    const anterior = y > 0 ? salida.subarray(destino - bytesPorLinea, destino) : null;

    for (let x = 0; x < bytesPorLinea; x++) {
      const crudo = linea[x] ?? 0;
      const a = x >= bytesPorPixel ? salida[destino + x - bytesPorPixel] : 0;
      const b = anterior ? anterior[x] : 0;
      const c = anterior && x >= bytesPorPixel ? anterior[x - bytesPorPixel] : 0;
      let valor: number;
      switch (filtro) {
        case 0:
          valor = crudo;
          break;
        case 1:
          valor = crudo + a;
          break;
        case 2:
          valor = crudo + b;
          break;
        case 3:
          valor = crudo + Math.floor((a + b) / 2);
          break;
        case 4: {
          // Paeth, tal como lo define la norma.
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          valor = crudo + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          return null;
      }
      salida[destino + x] = valor & 0xff;
    }
  }
  return salida;
}

/**
 * ¿Hay un trazo acá?
 *
 * Cuenta los píxeles que tienen tinta: con alfa, los que no son
 * transparentes; sin alfa, los que no son blancos. Y pide que sean
 * **pocos pero no ninguno**: un trazo de lapicera pinta entre el 1 % y
 * el 10 % de un lienzo de firma. Cero es el píxel de relleno; más del
 * 60 % es una imagen pegada, no una firma.
 */
export function analizarFirma(dataUrl: string): AnalisisDeFirma {
  const coma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/png;base64,") || coma < 0) {
    return {
      valida: false,
      motivo: "La firma tiene que ser una imagen PNG dibujada en pantalla.",
      ancho: 0,
      alto: 0,
      tinta: 0,
    };
  }

  const buf = Buffer.from(dataUrl.slice(coma + 1), "base64");

  // EL TAMAÑO SE MIRA PRIMERO, con la cabecera y sin descomprimir nada.
  //
  // No es una optimización: el PNG de relleno de 1×1 no se podía
  // inflar y el mensaje salía «no se pudo leer la imagen», que manda a
  // buscar un problema de formato cuando el problema es que mide un
  // píxel. El verificador lo cazó. Con las medidas primero, el motivo
  // es el verdadero.
  const medidas = medidasDeImagen(buf);
  if (!medidas) {
    return {
      valida: false,
      motivo: "No se pudo leer la imagen de la firma.",
      ancho: 0,
      alto: 0,
      tinta: 0,
    };
  }
  if (medidas.ancho < MINIMO.ancho || medidas.alto < MINIMO.alto) {
    return {
      valida: false,
      motivo: `La firma mide ${medidas.ancho}×${medidas.alto} y hace falta al menos ${MINIMO.ancho}×${MINIMO.alto}: una imagen de ese tamaño no puede contener un trazo.`,
      ancho: medidas.ancho,
      alto: medidas.alto,
      tinta: 0,
    };
  }

  const png = leerPng(buf);
  if (!png) {
    return {
      valida: false,
      motivo: "No se pudo leer el contenido de la firma.",
      ancho: medidas.ancho,
      alto: medidas.alto,
      tinta: 0,
    };
  }

  // 6 = RGBA, 2 = RGB, 0 = gris, 4 = gris con alfa.
  const canales = png.tipoColor === 6 ? 4 : png.tipoColor === 2 ? 3 : png.tipoColor === 4 ? 2 : 1;
  if (png.profundidad !== 8) {
    return {
      valida: false,
      motivo: "El formato de la firma no es el que produce el panel de firma.",
      ancho: png.ancho,
      alto: png.alto,
      tinta: 0,
    };
  }

  const pixeles = desfiltrar(png, canales);
  if (!pixeles) {
    return {
      valida: false,
      motivo: "No se pudo leer el contenido de la firma.",
      ancho: png.ancho,
      alto: png.alto,
      tinta: 0,
    };
  }

  const conAlfa = canales === 4 || canales === 2;
  let conTinta = 0;
  const total = png.ancho * png.alto;
  for (let i = 0; i < total; i++) {
    const base = i * canales;
    if (conAlfa) {
      if (pixeles[base + canales - 1] > 16) conTinta++;
    } else {
      // Sin alfa: cuenta lo que no es casi blanco.
      const suma = canales === 1 ? pixeles[base] : pixeles[base] + pixeles[base + 1] + pixeles[base + 2];
      const promedio = suma / canales;
      if (promedio < 240) conTinta++;
    }
  }

  const tinta = conTinta / total;
  if (tinta < MINIMO.proporcionTintaMinima) {
    return {
      valida: false,
      motivo:
        "El recuadro de la firma está vacío. Pedile al cliente que firme con el dedo o con el mouse antes de confirmar.",
      ancho: png.ancho,
      alto: png.alto,
      tinta,
    };
  }
  if (tinta > MINIMO.proporcionTintaMaxima) {
    return {
      valida: false,
      motivo: "Eso no parece una firma: casi toda la imagen está pintada.",
      ancho: png.ancho,
      alto: png.alto,
      tinta,
    };
  }

  return { valida: true, ancho: png.ancho, alto: png.alto, tinta };
}
