// Posibles pacientes duplicados — SOLO LECTURA.
//
// Por qué hace falta: hasta vetline-clinic-01 el paciente solo se creaba
// como paso 2 del wizard de "Nuevo Caso", sin ninguna pantalla donde
// buscarlo antes. Cuando un animal vuelve y quien lo atiende no lo
// encuentra (o no lo busca), lo crea de nuevo. El resultado es el mismo
// animal con dos expedientes, cada uno con parte de su historia.
//
// Este script NO FUSIONA NADA y no escribe una sola fila. Solo lista los
// candidatos para que una persona decida. La fusión es una decisión
// aparte: implica elegir qué expediente sobrevive y mover casos, citas,
// atenciones, recetas y cuidados preventivos — nada de eso se hace sin
// que alguien lo revise caso por caso.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/listar_pacientes_duplicados.ts
//
// Apto para correr contra producción: no usa extensiones de Postgres (no
// asume pg_trgm ni fuzzystrmatch, que crearlas sería un cambio de
// esquema), no abre transacciones de escritura y la comparación de
// nombres se hace en memoria.
import { pool } from "../db";

/**
 * Normaliza un nombre para comparar: minúsculas, sin tildes, sin
 * puntuación y sin espacios repetidos. "Luna  Pérez" y "luna perez"
 * pasan a ser el mismo texto.
 *
 * `normalize("NFD")` + borrar los diacríticos es el equivalente de
 * `unaccent` sin necesitar la extensión.
 */
function normalizar(nombre: string): string {
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
function similitud(a: string, b: string): number {
  const largo = Math.max(a.length, b.length);
  if (largo === 0) return 1;
  return 1 - levenshtein(a, b) / largo;
}

// Umbral deliberadamente alto: este listado lo va a leer una persona y
// un falso positivo le cuesta tiempo de revisión. 0.82 agrupa
// "Luna"/"Luna " y "Firulais"/"Firulai", y NO agrupa "Luna"/"Lucas".
// Además de la similitud se acepta la contención ("Luna" dentro de "Luna
// Pérez"), que es el error de carga más común: el mismo animal cargado
// una vez con apellido del tutor y otra sin él.
const UMBRAL_SIMILITUD = 0.82;

interface FilaPaciente {
  tenant_id: string;
  tenant_nombre: string;
  propietario_id: string;
  propietario_nombre: string;
  paciente_id: string;
  numero_expediente: number;
  nombre: string;
  especie: string;
  estado: string;
  creado_en: string;
  casos: number;
  citas: number;
  atenciones: number;
  recetas: number;
  cuidados: number;
  ultima_actividad: string | null;
}

function esCandidato(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  return similitud(a, b) >= UMBRAL_SIMILITUD;
}

async function main() {
  // Una sola consulta: los conteos van como subconsultas correlacionadas
  // en vez de 5 JOIN con GROUP BY, para que cada número sea
  // inequívocamente el de ESE paciente (un JOIN múltiple multiplica
  // filas y los conteos salen inflados — error fácil y silencioso).
  const result = await pool.query<FilaPaciente>(
    `SELECT t.id   AS tenant_id,
            t.nombre AS tenant_nombre,
            prop.id  AS propietario_id,
            prop.nombre AS propietario_nombre,
            p.id     AS paciente_id,
            p.numero_expediente,
            p.nombre,
            p.especie,
            p.estado,
            p.creado_en,
            (SELECT count(*) FROM casos c            WHERE c.paciente_id = p.id)::int AS casos,
            (SELECT count(*) FROM citas ci           WHERE ci.paciente_id = p.id)::int AS citas,
            (SELECT count(*) FROM atenciones a       WHERE a.paciente_id = p.id)::int AS atenciones,
            (SELECT count(*) FROM recetas r          WHERE r.paciente_id = p.id)::int AS recetas,
            (SELECT count(*) FROM cuidados_preventivos cp WHERE cp.paciente_id = p.id)::int AS cuidados,
            GREATEST(
              (SELECT max(c.actualizado_en) FROM casos c  WHERE c.paciente_id = p.id),
              (SELECT max(ci.actualizado_en) FROM citas ci WHERE ci.paciente_id = p.id)
            ) AS ultima_actividad
     FROM pacientes p
     JOIN propietarios prop ON prop.id = p.propietario_id
     JOIN tenants t         ON t.id = p.tenant_id
     ORDER BY t.nombre, prop.nombre, p.nombre`
  );

  // Agrupar por clínica + propietario + especie. El mismo nombre en dos
  // propietarios distintos NO es un duplicado (hay muchas "Luna"), y el
  // mismo nombre en dos especies distintas tampoco.
  const grupos = new Map<string, FilaPaciente[]>();
  for (const fila of result.rows) {
    const clave = `${fila.tenant_id}|${fila.propietario_id}|${normalizar(fila.especie)}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(fila);
  }

  let gruposReportados = 0;
  let pacientesInvolucrados = 0;

  for (const filas of grupos.values()) {
    if (filas.length < 2) continue;

    // Componentes conexas por "nombres parecidos": si A se parece a B y
    // B a C, los tres van en el mismo grupo aunque A y C no se parezcan
    // entre sí directamente.
    const normalizados = filas.map((f) => normalizar(f.nombre));
    const grupo = filas.map((_, i) => i);
    const padre = [...grupo];
    const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
    for (let i = 0; i < filas.length; i++) {
      for (let j = i + 1; j < filas.length; j++) {
        if (esCandidato(normalizados[i], normalizados[j])) padre[raiz(j)] = raiz(i);
      }
    }

    const porRaiz = new Map<number, number[]>();
    for (let i = 0; i < filas.length; i++) {
      const r = raiz(i);
      if (!porRaiz.has(r)) porRaiz.set(r, []);
      porRaiz.get(r)!.push(i);
    }

    for (const indices of porRaiz.values()) {
      if (indices.length < 2) continue;
      gruposReportados++;
      pacientesInvolucrados += indices.length;

      const primera = filas[indices[0]];
      console.log("");
      console.log(`── ${primera.tenant_nombre} · propietario: ${primera.propietario_nombre} · ${primera.especie}`);
      for (const i of indices) {
        const f = filas[i];
        const actividad = f.ultima_actividad
          ? new Date(f.ultima_actividad).toISOString().slice(0, 10)
          : "sin actividad";
        console.log(
          `   Expediente N.º ${String(f.numero_expediente).padStart(5)} · ${f.nombre}` +
            ` · ${f.estado}` +
            ` · casos ${f.casos}, citas ${f.citas}, atenciones ${f.atenciones},` +
            ` recetas ${f.recetas}, preventivos ${f.cuidados}` +
            ` · alta ${new Date(f.creado_en).toISOString().slice(0, 10)}` +
            ` · última actividad ${actividad}`
        );
        console.log(`     id: ${f.paciente_id}`);
      }
    }
  }

  console.log("");
  console.log("─".repeat(72));
  console.log(`${result.rows.length} paciente(s) revisado(s) en ${grupos.size} grupo(s) de propietario+especie.`);
  if (gruposReportados === 0) {
    console.log("No se encontraron posibles duplicados con el criterio actual.");
  } else {
    console.log(
      `${gruposReportados} grupo(s) de posibles duplicados, ${pacientesInvolucrados} paciente(s) involucrado(s).`
    );
    console.log("");
    console.log("Criterio: mismo propietario, misma especie y nombre idéntico (ya normalizado),");
    console.log(`contenido uno en el otro, o con similitud >= ${UMBRAL_SIMILITUD}.`);
    console.log("");
    console.log("NO se fusionó nada. Revisá cada grupo: el que conserve más historia suele ser el");
    console.log("que hay que mantener, pero la decisión es clínica, no automática.");
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
