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

// ---------------------------------------------------------------------
// LOS PACIENTES DUPLICADOS — anexo 07-03, B1.
//
// EL CRITERIO NO SE REINVENTA ACÁ: es el de
// `scripts/listar_pacientes_duplicados.ts`, que ya se corrió contra la
// base real y se calibró con el resultado. Vive acá para que el script
// y la pantalla de unificación agrupen igual: si la pantalla propusiera
// pares que el script no lista, no habría forma de saber cuál de los dos
// tiene razón.
//
// MISMO DUEÑO Y MISMA ESPECIE, siempre. Dos «Luna» de dos clientes
// distintos no son un duplicado: son dos perras que se llaman igual, y
// es lo más común del mundo.
// ---------------------------------------------------------------------

/**
 * Normaliza un nombre para comparar: minúsculas, sin tildes, sin
 * puntuación y sin espacios repetidos.
 *
 * `normalize("NFD")` + borrar los diacríticos es el equivalente de
 * `unaccent` sin necesitar la extensión; se usa acá y no
 * `inmutable_unaccent` porque la comparación es entre filas ya traídas y
 * no dentro de la consulta.
 */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distancia de edición clásica. Suficiente para nombres de mascotas. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const actual = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const costo = a[i] === b[j] ? 0 : 1;
      actual[j + 1] = Math.min(actual[j] + 1, anterior[j + 1] + 1, anterior[j] + costo);
    }
    anterior = actual;
  }
  return anterior[b.length];
}

/** 1 = idénticos, 0 = nada en común. */
export function similitudNombres(a: string, b: string): number {
  const largo = Math.max(a.length, b.length);
  if (largo === 0) return 1;
  return 1 - levenshtein(a, b) / largo;
}

// Umbral deliberadamente alto: lo lee una persona y un falso positivo le
// cuesta tiempo de revisión. 0,82 agrupa «Luna»/«Luna » y
// «Firulais»/«Firulai», y NO agrupa «Luna»/«Lucas». Además de la
// similitud se acepta la contención («Luna» dentro de «Luna Pérez»), que
// es el error de carga más común: el mismo animal cargado una vez con el
// apellido del tutor y otra sin él.
export const UMBRAL_SIMILITUD = 0.82;

export function mismoNombreDeMascota(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  return similitudNombres(a, b) >= UMBRAL_SIMILITUD;
}

export interface PacienteParecido {
  id: string;
  nombre: string;
  numeroExpediente: number | null;
  especie: string | null;
  estado: string;
  creadoEn: string;
  /** Cuánta historia tiene cada uno, para elegir cuál sobrevive. */
  atenciones: number;
  casos: number;
  /** 0 a 100: 100 es el mismo nombre ya normalizado. */
  puntaje: number;
}

export interface GrupoDePacientes {
  propietarioId: string;
  propietarioNombre: string;
  grupo: PacienteParecido[];
}

/**
 * Grupos de pacientes del mismo dueño que podrían ser el mismo animal.
 *
 * `propietarioId` acota a un cliente (lo usa la ficha); sin él barre la
 * clínica entera (lo usa la pantalla de duplicados).
 */
export async function pacientesParecidos(
  db: PoolClient,
  opciones: { propietarioId?: string; limite?: number } = {}
): Promise<GrupoDePacientes[]> {
  const r = await db.query<{
    id: string;
    propietario_id: string;
    propietario_nombre: string;
    nombre: string;
    numero_expediente: number | null;
    especie: string | null;
    estado: string;
    creado_en: string;
    atenciones: string;
    casos: string;
  }>(
    `SELECT p.id, p.propietario_id, pr.nombre AS propietario_nombre, p.nombre,
            p.numero_expediente, p.especie, p.estado, p.creado_en,
            (SELECT count(*) FROM atenciones a WHERE a.paciente_id = p.id) AS atenciones,
            (SELECT count(*) FROM casos c WHERE c.paciente_id = p.id)      AS casos
       FROM pacientes p
       JOIN propietarios pr ON pr.id = p.propietario_id
      WHERE p.unificado_hacia_id IS NULL
        AND pr.unificado_hacia_id IS NULL
        AND ($1::uuid IS NULL OR p.propietario_id = $1::uuid)
      ORDER BY p.propietario_id, p.creado_en`,
    [opciones.propietarioId || null]
  );

  // Agrupar por dueño + especie, y dentro de cada grupo unir por nombre
  // con union-find: si A se parece a B y B a C, los tres son un grupo
  // aunque A y C no se parezcan entre sí.
  const porDuenoEspecie = new Map<string, typeof r.rows>();
  for (const fila of r.rows) {
    const clave = `${fila.propietario_id}|${normalizarNombre(fila.especie ?? "")}`;
    const lista = porDuenoEspecie.get(clave) ?? [];
    lista.push(fila);
    porDuenoEspecie.set(clave, lista);
  }

  const resultado: GrupoDePacientes[] = [];
  for (const filas of porDuenoEspecie.values()) {
    if (filas.length < 2) continue;
    const normalizados = filas.map((f) => normalizarNombre(f.nombre));
    const padre = filas.map((_, i) => i);
    const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
    for (let i = 0; i < filas.length; i++) {
      for (let j = i + 1; j < filas.length; j++) {
        if (mismoNombreDeMascota(normalizados[i], normalizados[j])) padre[raiz(j)] = raiz(i);
      }
    }
    const grupos = new Map<number, number[]>();
    for (let i = 0; i < filas.length; i++) {
      const g = grupos.get(raiz(i)) ?? [];
      g.push(i);
      grupos.set(raiz(i), g);
    }
    for (const indices of grupos.values()) {
      if (indices.length < 2) continue;
      resultado.push({
        propietarioId: filas[indices[0]].propietario_id,
        propietarioNombre: filas[indices[0]].propietario_nombre,
        grupo: indices.map((i) => ({
          id: filas[i].id,
          nombre: filas[i].nombre,
          numeroExpediente: filas[i].numero_expediente,
          especie: filas[i].especie,
          estado: filas[i].estado,
          creadoEn: filas[i].creado_en,
          atenciones: Number(filas[i].atenciones),
          casos: Number(filas[i].casos),
          puntaje:
            normalizados[i] === normalizados[indices[0]]
              ? 100
              : Math.round(similitudNombres(normalizados[i], normalizados[indices[0]]) * 100),
        })),
      });
    }
  }
  return resultado.slice(0, opciones.limite ?? 50);
}

export interface ParDeClientes {
  a: ClienteParecido;
  b: ClienteParecido;
  puntaje: number;
}

/**
 * Los pares de CLIENTES que podrían ser el mismo, barriendo la clínica.
 *
 * Reusa `clientesParecidos` cliente por cliente en vez de escribir una
 * segunda consulta: el criterio tiene que ser uno solo. El par se
 * devuelve una sola vez —A-B y no también B-A— ordenando los dos ids.
 */
export async function clientesDuplicadosDeLaClinica(
  db: PoolClient,
  limite = 50
): Promise<ParDeClientes[]> {
  const todos = await db.query<{
    id: string;
    nombre: string;
    telefono: string | null;
    email: string | null;
    tipo_identificacion_id: string | null;
    numero_identificacion: string | null;
    pacientes: string;
  }>(
    `SELECT p.id, p.nombre, p.telefono, p.email, p.tipo_identificacion_id,
            p.numero_identificacion,
            (SELECT count(*) FROM pacientes pa WHERE pa.propietario_id = p.id) AS pacientes
       FROM propietarios p
      WHERE p.unificado_hacia_id IS NULL
      ORDER BY p.creado_en`
  );

  const vistos = new Set<string>();
  const pares: ParDeClientes[] = [];
  for (const fila of todos.rows) {
    const parecidos = await clientesParecidos(
      db,
      {
        nombre: fila.nombre,
        telefono: fila.telefono,
        email: fila.email,
        tipoIdentificacionId: fila.tipo_identificacion_id,
        numeroIdentificacion: fila.numero_identificacion,
      },
      { excluirId: fila.id, limite: 5 }
    );
    for (const otro of parecidos) {
      const clave = [fila.id, otro.id].sort().join("|");
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      pares.push({
        a: {
          id: fila.id,
          nombre: fila.nombre,
          telefono: fila.telefono,
          email: fila.email,
          numeroIdentificacion: fila.numero_identificacion,
          criterios: otro.criterios,
          puntaje: otro.puntaje,
          pacientes: Number(fila.pacientes),
        },
        b: otro,
        puntaje: otro.puntaje,
      });
      if (pares.length >= limite) return pares.sort((x, y) => y.puntaje - x.puntaje);
    }
  }
  return pares.sort((x, y) => y.puntaje - x.puntaje);
}
