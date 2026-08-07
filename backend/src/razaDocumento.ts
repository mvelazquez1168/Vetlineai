import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------
// Carga selectiva de predisposiciones raciales (prompt_code_seleccion_raza).
// Único documento al que se le aplica esta lógica: "Predisposiciones
// Raciales a Enfermedades — Perros y Gatos" — es el único con secciones
// autocontenidas por raza delimitadas por encabezados de nivel 2. Se
// excluye del bloque cacheado normal en obtenerDocumentosParaContexto
// (casos.routes.ts) y se reemplaza acá por: SIEMPRE el encabezado del
// documento (título + metodología + advertencia + estructura) + SOLO la
// sección de la raza del paciente si hay coincidencia.
//
// Este bloque va DESPUÉS del bloque cacheado (system_prompt + documentos),
// sin cache_control — mismo lado del corte que bloqueContextoCaso.ts, del
// que es hermano: varía por caso (la raza cambia), así que no puede vivir
// en el prefijo que se supone idéntico byte a byte entre casos del mismo
// agente.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export const NOMBRE_DOCUMENTO_PREDISPOSICIONES = "Predisposiciones Raciales a Enfermedades — Perros y Gatos";

// El documento distingue "PERROS" de "GATOS" con un encabezado de nivel 1
// — Paso 4 del prompt: acotar por especie evita coincidencias cruzadas
// entre razas de nombre parecido en las dos listas.
const TITULO_SECCION_POR_ESPECIE: Record<string, string> = {
  Canino: "PERROS",
  Felino: "GATOS",
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

interface SeccionRaza {
  tituloCrudo: string;
  inicio: number; // índice de línea del encabezado "## ..."
  fin: number; // índice de línea (exclusivo) donde termina la sección
}

// Nombres candidatos que puede matchear un encabezado. Dos fuentes:
//   1. El contenido entre paréntesis, ej. "Pastor Alemán (German Shepherd)"
//      o "Dachshund (Teckel/Salchicha)" — cada alias separado por "/".
//   2. El nombre primario (todo lo anterior al paréntesis, o el título
//      entero si no hay uno) dividido por "/" o " y " CUANDO agrupa más
//      de una raza en un solo encabezado sin paréntesis, ej. "Jack
//      Russell Terrier / Parson Russell Terrier" o "Norwich Terrier y
//      Norfolk Terrier". Ese split NUNCA se aplica dentro de un
//      paréntesis — ahí "y"/"/" suele describir variantes de una misma
//      raza ("Collie (Barbudo y de Pelo Largo/Corto)"), no razas
//      distintas, y partirlo produciría nombres inventados.
function candidatosDeTitulo(tituloCrudo: string): string[] {
  const candidatos = [tituloCrudo];
  const match = tituloCrudo.match(/^(.+?)\s*\(([^)]+)\)/);
  let primario: string;
  if (match) {
    primario = match[1].trim();
    for (const alias of match[2].split("/")) {
      candidatos.push(alias.trim());
    }
  } else {
    // Sufijos tipo " — Toy, Miniatura y Estándar" no son razas distintas
    // — se descartan antes de buscar un separador de raza.
    primario = tituloCrudo.split(" — ")[0].trim();
  }
  candidatos.push(primario);
  for (const parte of primario.split(/\s*\/\s*|\s+y\s+/)) {
    candidatos.push(parte.trim());
  }
  return candidatos;
}

function raizDeSeccionesRaza(lineas: string[], inicioEspecie: number, finEspecie: number): SeccionRaza[] {
  const secciones: SeccionRaza[] = [];
  for (let i = inicioEspecie; i < finEspecie; i++) {
    if (/^##\s+/.test(lineas[i])) {
      const tituloCrudo = lineas[i].replace(/^##\s+/, "").trim();
      let fin = finEspecie;
      for (let j = i + 1; j < finEspecie; j++) {
        if (/^#{1,2}\s+/.test(lineas[j])) {
          fin = j;
          break;
        }
      }
      secciones.push({ tituloCrudo, inicio: i, fin });
    }
  }
  return secciones;
}

// Encuentra la sección de nivel 1 (especie) y devuelve sus límites de
// línea [inicio, fin) — fin es la próxima línea "# " o el final del
// documento.
function limitesSeccionEspecie(lineas: string[], tituloEspecie: string): { inicio: number; fin: number } | null {
  const inicio = lineas.findIndex((l) => new RegExp(`^#\\s+${tituloEspecie}\\s*$`).test(l));
  if (inicio === -1) return null;
  let fin = lineas.length;
  for (let j = inicio + 1; j < lineas.length; j++) {
    if (/^#\s+/.test(lineas[j])) {
      fin = j;
      break;
    }
  }
  return { inicio, fin };
}

// El encabezado del documento es todo lo que precede a la primera
// sección de especie ("# PERROS") — título, metodología, advertencia de
// uso, cómo está estructurado.
function extraerEncabezado(lineas: string[]): string {
  const primeraEspecie = lineas.findIndex((l) => /^#\s+(PERROS|GATOS)\s*$/.test(l));
  const fin = primeraEspecie === -1 ? lineas.length : primeraEspecie;
  return lineas.slice(0, fin).join("\n").trim();
}

export interface ResultadoBloqueRaza {
  texto: string;
  coincidio: boolean;
}

// Exportada aparte para poder medirla contra todo el catálogo de razas
// sin pegarle a la base por cada una (scripts de verificación).
//
// `tituloSeccionOverride` es el mapeo explícito de razas_alias_documento
// (migración 044) — cuando viene, se usa para ubicar la sección
// DIRECTAMENTE (no se vuelve a buscar por `raza`, que puede no aparecer
// en el encabezado ni de casualidad: "Boyero Australiano" vs. "Australian
// Cattle Dog"). `nota`, si está, se inserta como aviso explícito ANTES de
// la sección — ver el pedido del usuario: no alcanza con que la nota
// exista en la tabla, tiene que llegar al contexto del agente.
export function seleccionarSeccionRaza(
  contenidoDocumento: string,
  especie: string,
  raza: string | null,
  tituloSeccionOverride?: string | null,
  nota?: string | null
): ResultadoBloqueRaza {
  const lineas = contenidoDocumento.split(/\r?\n/);
  const encabezado = extraerEncabezado(lineas);

  const tituloEspecie = TITULO_SECCION_POR_ESPECIE[especie];
  if (!tituloEspecie) {
    // Especie fuera de perro/gato (no debería pasar dado el catálogo
    // actual) — no hay dónde buscar, mismo camino que sin coincidencia.
    return { texto: encabezado, coincidio: false };
  }
  const limites = limitesSeccionEspecie(lineas, tituloEspecie);
  if (!limites) {
    return { texto: encabezado, coincidio: false };
  }
  const secciones = raizDeSeccionesRaza(lineas, limites.inicio, limites.fin);

  let seccion: SeccionRaza | undefined;
  if (tituloSeccionOverride) {
    seccion = secciones.find((s) => s.tituloCrudo === tituloSeccionOverride);
  } else if (raza && raza.trim()) {
    // Coincidencia exacta primero.
    seccion = secciones.find((s) => candidatosDeTitulo(s.tituloCrudo).includes(raza));
    // Después, insensible a mayúsculas/acentos.
    if (!seccion) {
      const razaNormalizada = normalizar(raza);
      seccion = secciones.find((s) =>
        candidatosDeTitulo(s.tituloCrudo).some((c) => normalizar(c) === razaNormalizada)
      );
    }
  }

  if (!seccion) {
    return { texto: encabezado, coincidio: false };
  }

  const bloqueRaza = lineas.slice(seccion.inicio, seccion.fin).join("\n").trim();
  const aviso = nota ? `[Nota: ${nota}]\n\n` : "";
  return { texto: `${encabezado}\n\n${aviso}${bloqueRaza}`, coincidio: true };
}

// Sin FK a tenants A PROPÓSITO (mismo criterio que correos_enviados,
// ver correos.ts) — no es un descuido: razas_sin_coincidencia_log es
// analítica de plataforma (qué razas faltan en el documento), no dato de
// clínica, y sigue siendo válida aunque el tenant que la generó ya no
// exista. Las filas de tenants purgados quedan a propósito, sin limpieza
// (prompt_code_optimizacion_contexto, Cambio 4 — confirmado con el
// usuario explícitamente).
async function registrarSinCoincidencia(
  db: EjecutorSql,
  params: { tenantId: string | null; casoId: string; especie: string; raza: string | null }
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO razas_sin_coincidencia_log (tenant_id, caso_id, especie, raza_texto) VALUES ($1, $2, $3, $4)`,
      [params.tenantId, params.casoId, params.especie, params.raza]
    );
  } catch (err) {
    // Best-effort — un fallo acá nunca debe tirar abajo la llamada real.
    console.error("[razaDocumento] No se pudo registrar la raza sin coincidencia", err);
  }
}

// Bloque de `system` adicional, sin cache_control — mismo criterio y
// mismo punto de llamada que construirBloqueContextoCaso (contextoCaso.ts).
// Devuelve "" si el documento de predisposiciones no está cargado (para
// no mandar un bloque vacío de más).
export async function construirBloqueRazaDocumento(
  db: EjecutorSql,
  casoId: string,
  tenantId: string | null
): Promise<string> {
  const documentoResult = await db.query(
    `SELECT id, contenido_texto FROM documentos_conocimiento WHERE nombre = $1 AND estado = 'activo' LIMIT 1`,
    [NOMBRE_DOCUMENTO_PREDISPOSICIONES]
  );
  const documento = documentoResult.rows[0] as { id: string; contenido_texto: string | null } | undefined;
  if (!documento?.contenido_texto) return "";

  const casoResult = await db.query(
    `SELECT p.raza_id, p.especie, r.nombre AS raza
     FROM casos c
     JOIN pacientes p ON p.id = c.paciente_id
     LEFT JOIN razas r ON r.id = p.raza_id
     WHERE c.id = $1`,
    [casoId]
  );
  const fila = casoResult.rows[0];
  if (!fila) return "";

  // Mapeo explícito (migración 044) — razas que solo difieren en el
  // nombre entre el catálogo y el documento. Se consulta ANTES del
  // matching automático: si hay fila, manda sobre cualquier coincidencia
  // que el parser pudiera encontrar por su cuenta.
  let tituloSeccionOverride: string | null = null;
  let nota: string | null = null;
  if (fila.raza_id) {
    const aliasResult = await db.query(
      `SELECT titulo_seccion, nota FROM razas_alias_documento WHERE raza_id = $1 AND documento_id = $2`,
      [fila.raza_id, documento.id]
    );
    if (aliasResult.rows.length > 0) {
      tituloSeccionOverride = aliasResult.rows[0].titulo_seccion;
      nota = aliasResult.rows[0].nota;
    }
  }

  const { texto, coincidio } = seleccionarSeccionRaza(
    documento.contenido_texto,
    fila.especie,
    fila.raza,
    tituloSeccionOverride,
    nota
  );
  if (!coincidio) {
    await registrarSinCoincidencia(db, { tenantId, casoId, especie: fila.especie, raza: fila.raza ?? null });
  }

  return (
    `Predisposiciones raciales — sección de la raza del paciente (documento completo omitido por no ` +
    `aportar a este caso; ver encabezado para metodología, fuentes y advertencia de uso):\n\n${texto}`
  );
}
