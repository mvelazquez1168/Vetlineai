import { Request } from "express";
import { MarcaDeClinica, marcaDeLaClinica } from "./marcaClinica";

// ---------------------------------------------------------------------
// LA MARCA Y EL AUTOR DE UNA EXPORTACIÓN, en una línea.
//
// Toda ruta que genera un PDF o un Excel necesita exactamente lo mismo:
// la marca de la clínica de la sesión y el nombre de quien lo pidió. Sin
// esto, cada una repetiría la consulta a `personas` y el día que haya
// que cambiar de dónde sale el nombre habría que buscarlas todas.
//
// EL NOMBRE NO VIAJA EN EL TOKEN —`AuthPayload` tiene el id, no el
// nombre—, así que se lee. Es una consulta por exportación, que es una
// acción que alguien pide a mano: no está en ningún camino caliente.
// ---------------------------------------------------------------------

export interface MarcaYAutor {
  marca: MarcaDeClinica;
  usuario: string;
}

export async function marcaYAutor(req: Request): Promise<MarcaYAutor> {
  const marca = await marcaDeLaClinica(req.db!, req.auth!.tenantId!);
  const r = await req.db!.query<{ nombre: string }>(
    `SELECT nombre FROM personas WHERE id = $1`,
    [req.auth!.userId]
  );
  return { marca, usuario: r.rows[0]?.nombre ?? "—" };
}
