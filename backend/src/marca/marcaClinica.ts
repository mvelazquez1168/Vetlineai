import { PoolClient } from "pg";
import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "../almacenamiento";

// ---------------------------------------------------------------------
// EL PUNTO ÚNICO DE LA MARCA DE LA CLÍNICA, para los dos formatos.
//
// Nació como `pdf/marcaPdf.ts` en el anexo 07-03, para el PDF del
// examen. SE MUDA ACÁ porque dejó de ser de PDF: el Excel necesita
// exactamente lo mismo —el logo en bytes, el nombre y el color— y
// dejarlo en un archivo llamado «marcaPdf» habría hecho que la planilla
// importara el módulo del PDF para poner un logo. El nombre tiene que
// describir lo que hace.
//
// `pdf/marcaPdf.ts` se queda con lo que SÍ es de pdfkit: dibujar el
// encabezado y el pie.
//
// UNA SOLA POLÍTICA ANTE LA FALTA DE LOGO: **se imprime el nombre de la
// clínica y el documento sale**. Nunca el logo de Vetline en su lugar:
// el documento es de la clínica, no nuestro. Antes había tres políticas
// —la receta devolvía 422 y no se emitía, el comprobante ponía el nombre
// y el PDF del examen imprimía sin logo—, y el barrido de exportaciones
// las unificó en esta.
// ---------------------------------------------------------------------

export interface MarcaDeClinica {
  nombre: string;
  logo: Buffer | null;
  /** El tipo de contenido del logo, que el .xlsx necesita declarar. */
  logoTipo: "png" | "jpeg" | null;
  /** El tamaño real del logo, para no deformarlo al escalar. */
  logoMedidas: { ancho: number; alto: number } | null;
  /** El color de la clínica, en hex. */
  primario: string;
  /** Un gris de apoyo que combina con cualquier primario. */
  tenue: string;
}

const TENUE = "#5A6B82";
/**
 * El primario DE FÁBRICA: el que se usa cuando la clínica no cargó su
 * paleta. Se exporta para que los documentos no lo vuelvan a declarar:
 * tenerlo copiado en cuatro archivos es como empezó todo esto.
 */
export const PRIMARIO_DE_FABRICA = "#1B2A4A";
const PRIMARIO_POR_DEFECTO = PRIMARIO_DE_FABRICA;

/**
 * El ancho y el alto de una imagen, leídos de sus primeros bytes.
 *
 * POR QUÉ HACE FALTA: el .xlsx no escala una imagen solo, hay que
 * declararle el tamaño en EMU. Sin las medidas reales, un logo 4:1
 * metido en una caja 3:1 sale estirado —el defecto que ya costó una
 * corrección en el .docx del informe—.
 *
 * Soporta PNG y JPEG, que son los dos formatos que acepta la subida de
 * logo. Si no reconoce la cabecera devuelve `null` y el documento sale
 * con el nombre, que es la misma política de siempre.
 */
export function medidasDeImagen(
  buf: Buffer
): { ancho: number; alto: number; tipo: "png" | "jpeg" } | null {
  // PNG: la cabecera IHDR está en una posición fija.
  if (
    buf.length > 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return {
      ancho: buf.readUInt32BE(16),
      alto: buf.readUInt32BE(20),
      tipo: "png",
    };
  }

  // JPEG: hay que recorrer los marcadores hasta un SOF (0xC0–0xCF,
  // salteando 0xC4, 0xC8 y 0xCC, que no son de inicio de cuadro).
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marcador = buf[i + 1];
      if (
        marcador >= 0xc0 &&
        marcador <= 0xcf &&
        marcador !== 0xc4 &&
        marcador !== 0xc8 &&
        marcador !== 0xcc
      ) {
        return {
          alto: buf.readUInt16BE(i + 5),
          ancho: buf.readUInt16BE(i + 7),
          tipo: "jpeg",
        };
      }
      const largo = buf.readUInt16BE(i + 2);
      if (largo <= 0) return null;
      i += 2 + largo;
    }
  }

  return null;
}

/**
 * Lee la marca de la clínica lista para usar en un documento.
 *
 * Distinta de `apariencia()`, que devuelve la URL del logo para el
 * navegador: un PDF y un .xlsx necesitan los BYTES. Por eso esto lee el
 * objeto del almacenamiento en vez de devolver un enlace.
 */
export async function marcaDeLaClinica(
  db: PoolClient,
  tenantId: string
): Promise<MarcaDeClinica> {
  const r = await db.query<{ nombre: string; logo_url: string | null; primario: string | null }>(
    `SELECT t.nombre, t.logo_url, a.primario
       FROM tenants t
       LEFT JOIN clinica_apariencia a ON a.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId]
  );
  const fila = r.rows[0];
  const nombre = fila?.nombre ?? "Clínica";
  const primario = fila?.primario ?? PRIMARIO_POR_DEFECTO;

  let logo: Buffer | null = null;
  let logoTipo: MarcaDeClinica["logoTipo"] = null;
  let logoMedidas: MarcaDeClinica["logoMedidas"] = null;
  if (fila?.logo_url) {
    try {
      logo = await almacenamientoPublico.leer(claveLogoDesdeValorGuardado(fila.logo_url));
      const medidas = logo ? medidasDeImagen(logo) : null;
      if (medidas) {
        logoTipo = medidas.tipo;
        logoMedidas = { ancho: medidas.ancho, alto: medidas.alto };
      }
    } catch (err) {
      // Se registra y se sigue: un documento sin logo es legible; un
      // documento que no se genera, no.
      console.error(
        `[marca] No se pudo leer el logo de la clínica (${fila.logo_url}); el documento sale con el nombre en texto.`,
        err
      );
    }
  }

  return { nombre, logo, logoTipo, logoMedidas, primario, tenue: TENUE };
}

/** El pie de todo documento exportado: fecha, hora y quién lo generó. */
export function pieDeExportacion(usuario?: string | null): string {
  const cuando = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Generado el ${cuando} UTC${usuario ? ` por ${usuario}` : ""}`;
}
