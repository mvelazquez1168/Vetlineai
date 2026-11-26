import path from "path";
import { Pool, PoolClient } from "pg";
import { abrirLibro, celdasDeFila, filasDeHoja } from "./xlsx";

// ---------------------------------------------------------------------
// La codificación oficial de ubicación: provincia, cantón, distrito y
// barrio.
//
// Hacienda exige estos tres códigos en la ubicación del emisor y del
// receptor (Nota 2 del anexo), pero hasta acá se validaban solo por
// FORMATO: la provincia 9, cantón 99, distrito 99 pasaba, se firmaba,
// se enviaba, y el rechazo llegaba de Hacienda. Con este catálogo se
// valida contra la lista real, antes de firmar.
//
// DE DÓNDE SALE, y por qué esto antes "no se podía":
// el reporte del facturador dejó anotado que la codificación se
// publica como `Codificacionubicacion_V4.4.rar` y que el repo no tiene
// con qué descomprimir un `.rar` de forma reproducible. Eso ya no es
// cierto: Hacienda sirve la MISMA codificación como `.xlsx` en
// `https://www.hacienda.go.cr/docs/Codificacionubicacion_V4.4.xlsx`
// (el `.rar` que enlaza el portal de ATV devuelve 404 en todas sus
// rutas, probadas una por una). O sea que no hizo falta ningún
// extractor: el archivo es un zip de XML como el del CABYS y lo lee el
// mismo módulo.
//
// LO QUE EL ARCHIVO TIENE DE SUCIO, y cómo se trata:
// los CÓDIGOS son consistentes —7 provincias, 84 cantones, 492
// distritos, 7 087 barrios, y cada nivel cuelga bien del anterior—,
// pero los NOMBRES se contradicen entre filas. La misma provincia
// aparece como "San José" y como "SAN JOSÉ" (488 filas vienen en
// mayúsculas), y hay 30 códigos donde la diferencia es más que el
// uso de mayúsculas: acentos ("CONCEPCION" / "Concepción"), artículos
// ("LA FORTUNA" / "Fortuna"), espacios de más ("Jesús  "), un error de
// tipeo del propio archivo ("SAN FRANCISO" / "San Francisco") y un
// nombre con una aclaración adentro.
//
// La regla es: se carga el nombre MÁS FRECUENTE para cada código, y
// cada desacuerdo se REPORTA con sus variantes. No se elige "el que
// parece mejor" con una heurística: el nombre es un dato de
// presentación, el que Hacienda valida es el código, y un criterio
// inventado escondería que la fuente oficial se contradice.
// ---------------------------------------------------------------------

/**
 * Dónde se espera la planilla. Mismo criterio que el CABYS: en
 * `backend/catalogos/`, fuera de `src/`, porque es una entrada de
 * EJECUCIÓN del cargador y `docs/` no entra en la imagen de producción.
 */
const RAIZ_BACKEND = path.resolve(__dirname, "..", "..");
export const RUTA_UBICACION =
  process.env.FE_CR_ARCHIVO_UBICACION ??
  path.join(RAIZ_BACKEND, "catalogos", "ubicacion", "Codificacionubicacion_V4.4.xlsx");

/**
 * El encabezado de la hoja. Son cuatro celdas combinadas —B, D, F y
 * H—, una por nivel; las columnas C, E, G e I quedan vacías en la fila
 * del encabezado y traen el nombre en las filas de datos.
 */
const ENCABEZADO_ESPERADO: Record<string, string> = {
  B: "Provincia",
  D: "Cantón",
  F: "Distrito",
  H: "Barrio o Poblado",
};

const COL = {
  provinciaCodigo: "B",
  provinciaNombre: "C",
  cantonCodigo: "D",
  cantonNombre: "E",
  distritoCodigo: "F",
  distritoNombre: "G",
  barrioCodigo: "H",
  barrioNombre: "I",
} as const;

/** Cuántos hay de cada nivel, según el propio archivo de Hacienda. */
const ESPERADOS = { provincias: 7, cantones: 84, distritos: 492, barrios: 7087 };

export interface FilaUbicacion {
  provincia: string;
  canton: string;
  distrito: string;
  barrio: string;
  nombreProvincia: string;
  nombreCanton: string;
  nombreDistrito: string;
  nombreBarrio: string;
}

/** Un código cuyo nombre no es el mismo en todas las filas del archivo. */
export interface Desacuerdo {
  nivel: "provincia" | "canton" | "distrito";
  codigo: string;
  elegido: string;
  variantes: string[];
  /**
   * `true` si las variantes son la misma palabra con otro uso de
   * mayúsculas ("Quepos" / "QUEPOS"), que es el caso de la enorme
   * mayoría y no dice nada. `false` cuando difieren de verdad —acento,
   * artículo, un error de tipeo— que son los que hay que mirar.
   */
  soloMayusculas: boolean;
}

export interface LecturaUbicacion {
  provincias: Array<{ codigo: string; nombre: string }>;
  cantones: Array<{ provincia: string; codigo: string; nombre: string }>;
  distritos: Array<{ provincia: string; canton: string; codigo: string; nombre: string }>;
  barrios: Array<{
    provincia: string;
    canton: string;
    distrito: string;
    codigo: string;
    nombre: string;
  }>;
  desacuerdos: Desacuerdo[];
}

/** Espacios de los extremos fuera y espacios internos repetidos, uno. */
function normalizarNombre(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * El nombre más frecuente de un código, y las variantes si hubo más de
 * una.
 *
 * Empate: gana el que apareció primero en el archivo. Es arbitrario,
 * pero es determinista —correr la carga dos veces da lo mismo— y queda
 * reportado igual, que es lo que importa.
 */
function nombreMasFrecuente(apariciones: string[]): { elegido: string; variantes: string[] } {
  const cuenta = new Map<string, number>();
  for (const n of apariciones) {
    if (n === "") continue; // una celda vacía no es un nombre
    cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
  }
  if (cuenta.size === 0) return { elegido: "", variantes: [] };
  let elegido = "";
  let mejor = -1;
  for (const [nombre, veces] of cuenta) {
    if (veces > mejor) {
      mejor = veces;
      elegido = nombre;
    }
  }
  return { elegido, variantes: cuenta.size > 1 ? Array.from(cuenta.keys()) : [] };
}

/** Los códigos van con ceros a la izquierda: provincia 1, cantón 2, distrito 2, barrio 2. */
function pad(valor: string, ancho: number): string {
  return valor.padStart(ancho, "0");
}

export function leerUbicacion(ruta: string = RUTA_UBICACION): LecturaUbicacion {
  const libro = abrirLibro(ruta, "la codificación de ubicación");
  const textos = libro.textos;
  const filasXml = filasDeHoja(libro.xmlDeHoja(0));

  if (filasXml.length === 0) {
    throw new Error("La planilla de codificación de ubicación no tiene ni una fila.");
  }

  const encabezado = celdasDeFila(filasXml[0], textos);
  const diferencias = Object.entries(ENCABEZADO_ESPERADO)
    .filter(([col, esperado]) => normalizarNombre(encabezado[col] ?? "") !== esperado)
    .map(
      ([col, esperado]) =>
        `${col}: se esperaba "${esperado}" y dice "${encabezado[col] ?? "(vacía)"}"`
    );
  if (diferencias.length > 0) {
    throw new Error(
      "El encabezado de la planilla de ubicación cambió, así que las columnas pueden no ser " +
        "las de siempre y la carga se detiene:\n  " +
        diferencias.join("\n  ")
    );
  }

  // Se junta TODA aparición de cada nombre y recién al final se elige,
  // porque "el más frecuente" no se puede saber hasta haber leído el
  // archivo entero.
  const nombresProvincia = new Map<string, string[]>();
  const nombresCanton = new Map<string, string[]>();
  const nombresDistrito = new Map<string, string[]>();
  const barrios: LecturaUbicacion["barrios"] = [];
  const barriosVistos = new Set<string>();

  for (let i = 1; i < filasXml.length; i++) {
    const c = celdasDeFila(filasXml[i], textos);
    const crudoProvincia = (c[COL.provinciaCodigo] ?? "").trim();
    if (crudoProvincia === "") continue; // la planilla termina con filas vacías

    const provincia = pad(crudoProvincia, 1);
    const canton = pad((c[COL.cantonCodigo] ?? "").trim(), 2);
    const distrito = pad((c[COL.distritoCodigo] ?? "").trim(), 2);
    const barrio = pad((c[COL.barrioCodigo] ?? "").trim(), 2);

    for (const [valor, patron, que] of [
      [provincia, /^[1-7]$/, "provincia"],
      [canton, /^[0-9]{2}$/, "cantón"],
      [distrito, /^[0-9]{2}$/, "distrito"],
      [barrio, /^[0-9]{2}$/, "barrio"],
    ] as Array<[string, RegExp, string]>) {
      if (!patron.test(valor)) {
        throw new Error(
          `La fila ${i + 1} de la planilla de ubicación tiene el código de ${que} "${valor}", ` +
            `que no tiene la forma esperada. El formato del archivo cambió.`
        );
      }
    }

    const claveCanton = `${provincia}-${canton}`;
    const claveDistrito = `${provincia}-${canton}-${distrito}`;
    const claveBarrio = `${claveDistrito}-${barrio}`;

    const agregar = (m: Map<string, string[]>, k: string, v: string) => {
      const previo = m.get(k);
      if (previo) previo.push(v);
      else m.set(k, [v]);
    };
    agregar(nombresProvincia, provincia, normalizarNombre(c[COL.provinciaNombre] ?? ""));
    agregar(nombresCanton, claveCanton, normalizarNombre(c[COL.cantonNombre] ?? ""));
    agregar(nombresDistrito, claveDistrito, normalizarNombre(c[COL.distritoNombre] ?? ""));

    if (barriosVistos.has(claveBarrio)) {
      throw new Error(
        `El barrio ${claveBarrio} aparece dos veces en la planilla de ubicación (fila ${i + 1}).`
      );
    }
    barriosVistos.add(claveBarrio);
    barrios.push({
      provincia,
      canton,
      distrito,
      codigo: barrio,
      nombre: normalizarNombre(c[COL.barrioNombre] ?? ""),
    });
  }

  const desacuerdos: Desacuerdo[] = [];
  const resolver = (
    m: Map<string, string[]>,
    nivel: Desacuerdo["nivel"]
  ): Map<string, string> => {
    const out = new Map<string, string>();
    for (const [codigo, apariciones] of m) {
      const { elegido, variantes } = nombreMasFrecuente(apariciones);
      if (elegido === "") {
        throw new Error(
          `El ${nivel} ${codigo} no tiene nombre en ninguna fila de la planilla de ubicación.`
        );
      }
      out.set(codigo, elegido);
      if (variantes.length > 0) {
        const soloMayusculas = new Set(variantes.map((v) => v.toUpperCase())).size === 1;
        desacuerdos.push({ nivel, codigo, elegido, variantes, soloMayusculas });
      }
    }
    return out;
  };

  const provincias = resolver(nombresProvincia, "provincia");
  const cantones = resolver(nombresCanton, "canton");
  const distritos = resolver(nombresDistrito, "distrito");

  const lectura: LecturaUbicacion = {
    provincias: Array.from(provincias, ([codigo, nombre]) => ({ codigo, nombre })),
    cantones: Array.from(cantones, ([clave, nombre]) => {
      const [provincia, codigo] = clave.split("-");
      return { provincia, codigo, nombre };
    }),
    distritos: Array.from(distritos, ([clave, nombre]) => {
      const [provincia, canton, codigo] = clave.split("-");
      return { provincia, canton, codigo, nombre };
    }),
    barrios,
    desacuerdos,
  };

  // Los cuatro totales se comprueban contra lo que el país tiene. No es
  // decorativo: si una columna se corriera de lugar, los códigos
  // seguirían teniendo la forma correcta y la carga metería basura
  // bien formada. Los totales son lo que lo delata.
  const reales = {
    provincias: lectura.provincias.length,
    cantones: lectura.cantones.length,
    distritos: lectura.distritos.length,
    barrios: lectura.barrios.length,
  };
  const malos = Object.entries(ESPERADOS)
    .filter(([k, v]) => reales[k as keyof typeof reales] !== v)
    .map(([k, v]) => `${k}: se esperaban ${v} y se leyeron ${reales[k as keyof typeof reales]}`);
  if (malos.length > 0) {
    throw new Error(
      `La planilla de ubicación no dio las cantidades conocidas de la división territorial ` +
        `de Costa Rica, así que la lectura está mal:\n  ` +
        malos.join("\n  ")
    );
  }

  return lectura;
}

export interface ResultadoCargaUbicacion {
  provincias: number;
  cantones: number;
  distritos: number;
  barrios: number;
  desacuerdos: Desacuerdo[];
  /** Las FK de ubicación que quedaron validadas contra las filas viejas. */
  restriccionesValidadas: string[];
  /** Por qué alguna no se pudo validar: hay datos que no están en la lista. */
  restriccionesConProblema: Array<{ constraint: string; motivo: string }>;
}

/**
 * Las dos claves foráneas de ubicación nacen `NOT VALID` en la
 * migración 093, porque cuando esa migración corre la codificación
 * todavía no está cargada (ver la nota larga ahí). Postgres ya las
 * exige en cada INSERT y UPDATE; lo que falta es revisar las filas que
 * existían de antes, y eso recién se puede hacer acá.
 *
 * `VALIDATE CONSTRAINT` sobre algo ya validado es un no-op, así que
 * correr el comando dos veces no cuesta nada.
 *
 * Si una falla NO se interrumpe la carga: la lista quedó bien cargada y
 * el problema es un dato viejo que hay que mirar. Se devuelve para que
 * el comando lo diga.
 */
async function validarRestriccionesDeUbicacion(
  db: Pool | PoolClient
): Promise<Pick<ResultadoCargaUbicacion, "restriccionesValidadas" | "restriccionesConProblema">> {
  const aValidar: Array<[tabla: string, constraint: string]> = [
    ["fact_emisores", "fact_emisores_ubicacion_fkey"],
    ["fact_comprobantes", "fact_comprobantes_receptor_ubicacion_fkey"],
  ];

  const restriccionesValidadas: string[] = [];
  const restriccionesConProblema: Array<{ constraint: string; motivo: string }> = [];

  for (const [tabla, constraint] of aValidar) {
    try {
      await db.query(`ALTER TABLE ${tabla} VALIDATE CONSTRAINT ${constraint}`);
      restriccionesValidadas.push(constraint);
    } catch (err) {
      restriccionesConProblema.push({ constraint, motivo: (err as Error).message });
    }
  }

  return { restriccionesValidadas, restriccionesConProblema };
}

/**
 * Carga los cuatro niveles. Idempotente (`ON CONFLICT DO UPDATE`), y de
 * arriba hacia abajo para que las claves foráneas encuentren su padre.
 *
 * NO desactiva lo que ya no está —a diferencia del CABYS, que marca
 * `activo = false`—: estas tablas son el destino de una clave foránea
 * de `fact_emisores`, así que una fila que desapareciera del archivo no
 * se puede borrar si alguien la está usando, y el `DELETE` fallaría con
 * un error de integridad en vez de decir algo útil. Si Costa Rica
 * cambia su división territorial, eso merece una migración que diga qué
 * hacer con los emisores afectados, no una línea en un cargador.
 */
export async function cargarUbicacion(
  db: Pool | PoolClient,
  ruta: string = RUTA_UBICACION
): Promise<ResultadoCargaUbicacion> {
  const lectura = leerUbicacion(ruta);

  for (const p of lectura.provincias) {
    await db.query(
      `INSERT INTO fact_cat_provincia (codigo, nombre) VALUES ($1, $2)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
      [p.codigo, p.nombre]
    );
  }
  for (const c of lectura.cantones) {
    await db.query(
      `INSERT INTO fact_cat_canton (provincia, codigo, nombre) VALUES ($1, $2, $3)
       ON CONFLICT (provincia, codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
      [c.provincia, c.codigo, c.nombre]
    );
  }
  for (const d of lectura.distritos) {
    await db.query(
      `INSERT INTO fact_cat_distrito (provincia, canton, codigo, nombre) VALUES ($1, $2, $3, $4)
       ON CONFLICT (provincia, canton, codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
      [d.provincia, d.canton, d.codigo, d.nombre]
    );
  }

  // Los barrios sí van en lotes: son 7 087, y 7 087 viajes de ida y
  // vuelta tardan minutos donde esto tarda segundos. Los otros tres
  // niveles son cientos y no lo necesitan.
  const TAMANO_LOTE = 500;
  for (let i = 0; i < lectura.barrios.length; i += TAMANO_LOTE) {
    const lote = lectura.barrios.slice(i, i + TAMANO_LOTE);
    const valores: unknown[] = [];
    const marcadores = lote.map((b, j) => {
      valores.push(b.provincia, b.canton, b.distrito, b.codigo, b.nombre);
      const base = j * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    await db.query(
      `INSERT INTO fact_cat_barrio (provincia, canton, distrito, codigo, nombre)
       VALUES ${marcadores.join(", ")}
       ON CONFLICT (provincia, canton, distrito, codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
      valores
    );
  }

  return {
    provincias: lectura.provincias.length,
    cantones: lectura.cantones.length,
    distritos: lectura.distritos.length,
    barrios: lectura.barrios.length,
    desacuerdos: lectura.desacuerdos,
    ...(await validarRestriccionesDeUbicacion(db)),
  };
}
