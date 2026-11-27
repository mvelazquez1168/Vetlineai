import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// LOS CLIENTES QUE YA ESTÁN — anexo del 07-03.
//
// Dos usos, un solo criterio:
//
//   1. EL ALTA (A5). Antes de crear un cliente se mira si ya existe uno
//      con la misma identificación o el mismo teléfono. El duplicado más
//      barato de resolver es el que no se crea.
//   2. LA PANTALLA DE DUPLICADOS (B1). La misma función, sin un cliente
//      nuevo de referencia, barre los que ya están.
//
// POR QUÉ ESTÁ ACÁ Y NO EN LA RUTA DEL ALTA: si el aviso del alta usara
// un criterio y la pantalla de unificación otro, la pantalla mostraría
// pares que el alta dejó pasar, y nadie entendería por qué.
//
// EL TELÉFONO SE COMPARA NORMALIZADO. «8888-7777», «88887777» y
// «+506 8888 7777» son el mismo teléfono escrito de tres formas; el
// índice de la migración 121 está sobre la misma expresión que esta
// consulta, para que la use.
// ---------------------------------------------------------------------

export type CriterioCoincidencia = "identificacion" | "telefono" | "correo" | "nombre";

export interface ClienteParecido {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  numeroIdentificacion: string | null;
  /** Por qué se parece. Puede ser más de una cosa. */
  criterios: CriterioCoincidencia[];
  /** 0 a 100. La identificación sola ya es 100: es una llave. */
  puntaje: number;
  /** Cuántos pacientes tiene, para poder elegir cuál sobrevive. */
  pacientes: number;
}

/** Lo que vale la pena mirar de un cliente que se está por crear. */
export interface DatosDelCliente {
  nombre?: string | null;
  telefono?: string | null;
  email?: string | null;
  tipoIdentificacionId?: string | null;
  numeroIdentificacion?: string | null;
}

const PESO: Record<CriterioCoincidencia, number> = {
  // Una identificación repetida no es un parecido: es el mismo cliente.
  identificacion: 100,
  telefono: 70,
  correo: 60,
  nombre: 40,
};

/** Solo los dígitos. Es lo que compara el índice de la migración 121. */
export function soloDigitos(telefono: string | null | undefined): string {
  return (telefono ?? "").replace(/\D/g, "");
}

/**
 * Clientes que se parecen a los datos dados.
 *
 * `excluirId` es para la pantalla de duplicados, que compara un cliente
 * existente contra los demás y no contra sí mismo.
 *
 * `soloFuertes` deja únicamente identificación y teléfono: es lo que
 * usa el alta, porque avisar «hay alguien que se llama parecido» en cada
 * cliente nuevo entrenaría a ignorar el aviso.
 */
export async function clientesParecidos(
  db: PoolClient,
  datos: DatosDelCliente,
  opciones: { excluirId?: string; soloFuertes?: boolean; limite?: number } = {}
): Promise<ClienteParecido[]> {
  const telefono = soloDigitos(datos.telefono);
  const correo = (datos.email ?? "").trim().toLowerCase();
  const nombre = (datos.nombre ?? "").trim();
  const tieneIdentificacion = Boolean(datos.tipoIdentificacionId && datos.numeroIdentificacion?.trim());

  if (!tieneIdentificacion && telefono.length < 8 && !correo && (opciones.soloFuertes || nombre.length < 4)) {
    return [];
  }

  const r = await db.query<{
    id: string;
    nombre: string;
    telefono: string | null;
    email: string | null;
    numero_identificacion: string | null;
    por_identificacion: boolean;
    por_telefono: boolean;
    por_correo: boolean;
    por_nombre: boolean;
    pacientes: string;
  }>(
    `SELECT p.id, p.nombre, p.telefono, p.email, p.numero_identificacion,
            ($1::uuid IS NOT NULL AND p.tipo_identificacion_id = $1::uuid
              AND p.numero_identificacion = $2)                        AS por_identificacion,
            ($3 <> '' AND regexp_replace(COALESCE(p.telefono,''), '[^0-9]', '', 'g') = $3)
                                                                       AS por_telefono,
            ($4 <> '' AND lower(btrim(COALESCE(p.email,''))) = $4)      AS por_correo,
            ($5 <> '' AND NOT $6::boolean
              AND inmutable_unaccent(lower(p.nombre)) % inmutable_unaccent(lower($5)))
                                                                       AS por_nombre,
            (SELECT count(*) FROM pacientes pa WHERE pa.propietario_id = p.id) AS pacientes
       FROM propietarios p
      WHERE ($7::uuid IS NULL OR p.id <> $7::uuid)
        AND (
          ($1::uuid IS NOT NULL AND p.tipo_identificacion_id = $1::uuid AND p.numero_identificacion = $2)
          OR ($3 <> '' AND regexp_replace(COALESCE(p.telefono,''), '[^0-9]', '', 'g') = $3)
          OR ($4 <> '' AND lower(btrim(COALESCE(p.email,''))) = $4)
          OR ($5 <> '' AND NOT $6::boolean
              AND inmutable_unaccent(lower(p.nombre)) % inmutable_unaccent(lower($5)))
        )
      LIMIT $8`,
    [
      datos.tipoIdentificacionId || null,
      datos.numeroIdentificacion?.trim() || "",
      telefono.length >= 8 ? telefono : "",
      correo,
      nombre.length >= 4 ? nombre : "",
      opciones.soloFuertes === true,
      opciones.excluirId || null,
      opciones.limite ?? 10,
    ]
  );

  return r.rows
    .map((f) => {
      const criterios: CriterioCoincidencia[] = [];
      if (f.por_identificacion) criterios.push("identificacion");
      if (f.por_telefono) criterios.push("telefono");
      if (f.por_correo) criterios.push("correo");
      if (f.por_nombre) criterios.push("nombre");
      return {
        id: f.id,
        nombre: f.nombre,
        telefono: f.telefono,
        email: f.email,
        numeroIdentificacion: f.numero_identificacion,
        criterios,
        // El puntaje es el del criterio más fuerte, no la suma: dos
        // criterios débiles no hacen uno fuerte, y una suma dejaría
        // «mismo nombre + mismo correo» por encima de «misma cédula».
        puntaje: Math.max(0, ...criterios.map((c) => PESO[c])),
        pacientes: Number(f.pacientes),
      };
    })
    .filter((c) => c.criterios.length > 0)
    .sort((a, b) => b.puntaje - a.puntaje);
}

/** El texto del aviso, en un solo lugar para que el alta no lo invente. */
export function avisoDeDuplicado(parecidos: ClienteParecido[]): string {
  const porQue = parecidos[0].criterios.includes("identificacion")
    ? "con esa identificación"
    : parecidos[0].criterios.includes("telefono")
      ? "con ese teléfono"
      : parecidos[0].criterios.includes("correo")
        ? "con ese correo"
        : "con un nombre muy parecido";
  return parecidos.length === 1
    ? `Ya existe un cliente ${porQue}: ${parecidos[0].nombre}.`
    : `Ya existen ${parecidos.length} clientes ${porQue}.`;
}
