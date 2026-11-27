import PDFDocument from "pdfkit";
import { PoolClient } from "pg";
import { dibujarEncabezado, dibujarPie, marcaDeLaClinica } from "../pdf/marcaPdf";

// ---------------------------------------------------------------------
// PLANTILLAS DE DOCUMENTOS CLÍNICOS — prompt 11, §1 (Documentos).
//
// Consentimientos, certificados de salud y de vacunación, autorización
// de eutanasia, alta. Son los papeles que una clínica imprime todos los
// días y hoy escribe a mano en Word.
//
// LA TABLA YA EXISTÍA (`exp_plantillas_consentimiento`, del 07) con
// `tipo`, `titulo` y `cuerpo`, **y no generaba ningún PDF**. Lo que
// agrega el 11 son las variables y el documento.
//
// LAS VARIABLES SON UNA LISTA CERRADA, y es a propósito: una plantilla
// que acepta cualquier nombre de variable es una plantilla que un día
// imprime `{{nombrePaciente}}` en el papel que el cliente firma, porque
// quien la escribió no sabía que la variable se llamaba `{{paciente}}`.
// Acá, lo que no está en la lista se marca en la vista previa.
// ---------------------------------------------------------------------

export class PlantillaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PlantillaInvalida";
  }
}

export interface VariableDeclarada {
  clave: string;
  descripcion: string;
}

export const VARIABLES: VariableDeclarada[] = [
  { clave: "paciente", descripcion: "Nombre del paciente" },
  { clave: "especie", descripcion: "Especie" },
  { clave: "raza", descripcion: "Raza" },
  { clave: "sexo", descripcion: "Sexo" },
  { clave: "edad", descripcion: "Edad del paciente" },
  { clave: "peso", descripcion: "Peso de la última atención" },
  { clave: "microchip", descripcion: "Número de microchip" },
  { clave: "expediente", descripcion: "Número de expediente" },
  { clave: "cliente", descripcion: "Nombre del cliente" },
  { clave: "identificacion", descripcion: "Identificación del cliente" },
  { clave: "telefono", descripcion: "Teléfono del cliente" },
  { clave: "direccion", descripcion: "Dirección del cliente" },
  { clave: "medico", descripcion: "Nombre del médico" },
  { clave: "colegiatura", descripcion: "Colegiatura del médico" },
  { clave: "clinica", descripcion: "Nombre de la clínica" },
  { clave: "fecha", descripcion: "Fecha de hoy" },
];

const CLAVES = new Set(VARIABLES.map((v) => v.clave));

export async function plantillas(
  db: PoolClient,
  tenantId: string,
  incluirInactivas = false
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT id, tipo, titulo, cuerpo, activo, creado_en
       FROM exp_plantillas_consentimiento
      WHERE tenant_id = $1 AND ($2 OR activo)
      ORDER BY tipo, titulo`,
    [tenantId, incluirInactivas]
  );
  return r.rows;
}

export async function guardarPlantilla(
  db: PoolClient,
  tenantId: string,
  datos: { id?: string; tipo: string; titulo: string; cuerpo: string; activo?: boolean }
): Promise<{ id: string; variablesDesconocidas: string[] }> {
  if (!datos.titulo?.trim()) throw new PlantillaInvalida("La plantilla necesita un título.");
  if (!datos.cuerpo?.trim()) throw new PlantillaInvalida("La plantilla necesita un cuerpo.");

  const desconocidas = variablesDesconocidas(datos.cuerpo);

  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE exp_plantillas_consentimiento
          SET tipo = $3, titulo = $4, cuerpo = $5, activo = COALESCE($6, activo)
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [datos.id, tenantId, datos.tipo, datos.titulo.trim(), datos.cuerpo, datos.activo ?? null]
    );
    if (r.rows.length === 0) throw new PlantillaInvalida("Esa plantilla no existe.");
    return { id: r.rows[0].id, variablesDesconocidas: desconocidas };
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_plantillas_consentimiento (tenant_id, tipo, titulo, cuerpo)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [tenantId, datos.tipo, datos.titulo.trim(), datos.cuerpo]
  );
  return { id: r.rows[0].id, variablesDesconocidas: desconocidas };
}

/** Las que la plantilla usa y el sistema no sabe rellenar. */
export function variablesDesconocidas(cuerpo: string): string[] {
  const usadas = [...cuerpo.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(usadas.filter((v) => !CLAVES.has(v)))];
}

/**
 * Los valores de las variables para un paciente concreto.
 *
 * LO QUE NO SE SABE QUEDA VACÍO Y NO SE INVENTA. Un certificado que dice
 * «microchip: 000000» porque el paciente no tiene es un certificado
 * falso; uno que deja el espacio en blanco es un certificado que alguien
 * completa a mano.
 */
export async function valoresDe(
  db: PoolClient,
  tenantId: string,
  datos: { pacienteId: string; medicoId?: string | null }
): Promise<Record<string, string>> {
  const p = await db.query<{
    paciente: string;
    especie: string | null;
    raza: string | null;
    sexo: string | null;
    edad: string | null;
    microchip: string | null;
    expediente: string | null;
    cliente: string | null;
    identificacion: string | null;
    telefono: string | null;
    direccion: string | null;
    peso: string | null;
  }>(
    `SELECT pa.nombre AS paciente, pa.especie, r.nombre AS raza, pa.sexo,
            CASE WHEN pa.fecha_nacimiento IS NOT NULL
                 THEN (date_part('year', age(pa.fecha_nacimiento))::int || ' años')
                 WHEN pa.edad_anios IS NOT NULL THEN (pa.edad_anios || ' años')
                 ELSE NULL END AS edad,
            pa.microchip, pa.numero_expediente::text AS expediente,
            pr.nombre AS cliente, pr.numero_identificacion AS identificacion,
            pr.telefono, pr.direccion,
            (SELECT a.peso::text FROM atenciones a
              WHERE a.paciente_id = pa.id AND a.peso IS NOT NULL
              ORDER BY a.creado_en DESC LIMIT 1) AS peso
       FROM pacientes pa
       LEFT JOIN razas r ON r.id = pa.raza_id
       LEFT JOIN propietarios pr ON pr.id = pa.propietario_id
      WHERE pa.id = $1 AND pa.tenant_id = $2`,
    [datos.pacienteId, tenantId]
  );
  if (p.rows.length === 0) throw new PlantillaInvalida("Ese paciente no existe.");
  const f = p.rows[0];

  const medico = datos.medicoId
    ? (
        await db.query<{ nombre: string; colegiatura: string | null }>(
          `SELECT nombre, colegiatura FROM personas WHERE id = $1`,
          [datos.medicoId]
        )
      ).rows[0]
    : null;

  const clinica = (
    await db.query<{ nombre: string }>(`SELECT nombre FROM tenants WHERE id = $1`, [tenantId])
  ).rows[0];

  return {
    paciente: f.paciente ?? "",
    especie: f.especie ?? "",
    raza: f.raza ?? "",
    sexo: f.sexo ?? "",
    edad: f.edad ?? "",
    peso: f.peso ? `${f.peso} kg` : "",
    microchip: f.microchip ?? "",
    expediente: f.expediente ?? "",
    cliente: f.cliente ?? "",
    identificacion: f.identificacion ?? "",
    telefono: f.telefono ?? "",
    direccion: f.direccion ?? "",
    medico: medico?.nombre ?? "",
    colegiatura: medico?.colegiatura ?? "",
    clinica: clinica?.nombre ?? "",
    fecha: new Date().toLocaleDateString("es-CR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
  };
}

export function reemplazar(cuerpo: string, valores: Record<string, string>): string {
  return cuerpo.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (original, clave: string) =>
    // Una variable que el sistema no conoce se deja TAL CUAL y no se
    // borra: quien imprime ve que ahí falta algo, en vez de recibir un
    // documento con un hueco silencioso.
    clave in valores ? valores[clave] : original
  );
}

/**
 * El documento, en PDF, con la marca de la clínica.
 *
 * Usa el encabezado compartido (`pdf/marcaPdf.ts`), el mismo de la
 * receta y del examen: un documento de la clínica tiene que verse igual
 * salga de donde salga.
 */
export async function generarPdf(
  db: PoolClient,
  tenantId: string,
  datos: { plantillaId: string; pacienteId: string; medicoId?: string | null }
): Promise<{ buffer: Buffer; titulo: string }> {
  const pl = await db.query<{ titulo: string; cuerpo: string; tipo: string }>(
    `SELECT titulo, cuerpo, tipo FROM exp_plantillas_consentimiento
      WHERE id = $1 AND tenant_id = $2`,
    [datos.plantillaId, tenantId]
  );
  if (pl.rows.length === 0) throw new PlantillaInvalida("Esa plantilla no existe.");

  const valores = await valoresDe(db, tenantId, datos);
  const texto = reemplazar(pl.rows[0].cuerpo, valores);
  const marca = await marcaDeLaClinica(db, tenantId);

  const doc = new PDFDocument({ size: "LETTER", margin: 54 });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(trozos)));
  });

  dibujarEncabezado(doc, marca, pl.rows[0].titulo, `${valores.paciente} · ${valores.cliente}`);

  doc.moveDown(1).fillColor("#111").fontSize(10.5).font("Helvetica");
  for (const parrafo of texto.split(/\n{2,}/)) {
    doc.text(parrafo.trim(), { align: "justify", lineGap: 2 });
    doc.moveDown(0.6);
  }

  // LAS FIRMAS. Un consentimiento sin dónde firmar no es un
  // consentimiento: es un folleto.
  doc.moveDown(2);
  const y = doc.y;
  const ancho = (doc.page.width - doc.page.margins.left - doc.page.margins.right - 40) / 2;
  doc.fontSize(9).fillColor("#111");
  doc.moveTo(doc.page.margins.left, y + 40).lineTo(doc.page.margins.left + ancho, y + 40).stroke();
  doc.text(valores.cliente || "Cliente", doc.page.margins.left, y + 45, { width: ancho });
  doc.text(
    valores.identificacion ? `Identificación: ${valores.identificacion}` : "Identificación:",
    doc.page.margins.left,
    y + 58,
    { width: ancho }
  );

  const x2 = doc.page.margins.left + ancho + 40;
  doc.moveTo(x2, y + 40).lineTo(x2 + ancho, y + 40).stroke();
  doc.text(valores.medico || "Médico veterinario", x2, y + 45, { width: ancho });
  doc.text(
    valores.colegiatura ? `Colegiatura: ${valores.colegiatura}` : "Colegiatura:",
    x2,
    y + 58,
    { width: ancho }
  );

  dibujarPie(doc, marca, `${marca.nombre} · ${valores.fecha}`);
  doc.end();

  return { buffer: await listo, titulo: pl.rows[0].titulo };
}

// ---------------------------------------------------------------------
// LOS PROCEDIMIENTOS DE LA CLÍNICA — prompt 11, §6.
//
// Los manuales operativos: limpieza del quirófano, emergencias, cierre
// de caja, manejo de controlados. El agente de ayuda (16a) los va a
// leer, así que el contenido se guarda como **texto** siempre que se
// pueda: un PDF escaneado no se puede citar.
// ---------------------------------------------------------------------

export async function procedimientos(
  db: PoolClient,
  tenantId: string,
  filtros: { categoria?: string; rol?: string; incluirInactivos?: boolean } = {}
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT p.id, p.categoria, p.titulo, p.version, p.vigente_desde::text,
            p.roles, p.exige_lectura, p.activo, p.archivo_clave,
            left(p.contenido, 240) AS resumen,
            (SELECT count(*) FROM clinica_procedimiento_lecturas l
              WHERE l.procedimiento_id = p.id AND l.version = p.version)::int AS lecturas
       FROM clinica_procedimientos p
      WHERE p.tenant_id = $1
        AND ($2 OR p.activo)
        AND ($3::text IS NULL OR p.categoria = $3::text)
        AND ($4::text IS NULL OR cardinality(p.roles) = 0 OR $4::text = ANY(p.roles))
      ORDER BY p.categoria, p.titulo`,
    [tenantId, filtros.incluirInactivos ?? false, filtros.categoria ?? null, filtros.rol ?? null]
  );
  return r.rows;
}

export async function procedimiento(
  db: PoolClient,
  tenantId: string,
  id: string
): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT p.*, per.nombre AS creado_por_nombre
       FROM clinica_procedimientos p
       LEFT JOIN personas per ON per.id = p.creado_por
      WHERE p.id = $1 AND p.tenant_id = $2`,
    [id, tenantId]
  );
  if (r.rows.length === 0) throw new PlantillaInvalida("Ese procedimiento no existe.");
  return r.rows[0];
}

export async function guardarProcedimiento(
  db: PoolClient,
  tenantId: string,
  datos: {
    id?: string;
    categoria: string;
    titulo: string;
    contenido?: string | null;
    archivoClave?: string | null;
    version?: string;
    vigenteDesde?: string;
    roles?: string[];
    exigeLectura?: boolean;
    activo?: boolean;
    personaId: string;
  }
): Promise<{ id: string }> {
  if (!datos.titulo?.trim()) throw new PlantillaInvalida("El procedimiento necesita un título.");
  if (!datos.contenido?.trim() && !datos.archivoClave) {
    throw new PlantillaInvalida("El procedimiento necesita su texto o su archivo.");
  }
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE clinica_procedimientos
          SET categoria = $3, titulo = $4, contenido = $5,
              archivo_clave = COALESCE($6, archivo_clave),
              version = COALESCE($7, version),
              vigente_desde = COALESCE($8::date, vigente_desde),
              roles = COALESCE($9::varchar[], roles),
              exige_lectura = COALESCE($10, exige_lectura),
              activo = COALESCE($11, activo),
              actualizado_en = now()
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [
        datos.id,
        tenantId,
        datos.categoria,
        datos.titulo.trim(),
        datos.contenido ?? null,
        datos.archivoClave ?? null,
        datos.version ?? null,
        datos.vigenteDesde ?? null,
        datos.roles ?? null,
        datos.exigeLectura ?? null,
        datos.activo ?? null,
      ]
    );
    if (r.rows.length === 0) throw new PlantillaInvalida("Ese procedimiento no existe.");
    return r.rows[0];
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO clinica_procedimientos
       (tenant_id, categoria, titulo, contenido, archivo_clave, version,
        vigente_desde, roles, exige_lectura, creado_por)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'1'),COALESCE($7::date, CURRENT_DATE),
             COALESCE($8::varchar[], '{}'),COALESCE($9,false),$10)
     RETURNING id`,
    [
      tenantId,
      datos.categoria,
      datos.titulo.trim(),
      datos.contenido ?? null,
      datos.archivoClave ?? null,
      datos.version ?? null,
      datos.vigenteDesde ?? null,
      datos.roles ?? null,
      datos.exigeLectura ?? null,
      datos.personaId,
    ]
  );
  return r.rows[0];
}

/**
 * «Lo leí.»
 *
 * Se guarda CON LA VERSIÓN. Si el procedimiento cambia, la confirmación
 * vieja no vale para la nueva: lo contrario haría que un cambio de
 * protocolo quede «leído» por todos sin que nadie lo lea.
 */
export async function confirmarLectura(
  db: PoolClient,
  tenantId: string,
  datos: { procedimientoId: string; personaId: string }
): Promise<{ version: string }> {
  const p = await db.query<{ version: string }>(
    `SELECT version FROM clinica_procedimientos WHERE id = $1 AND tenant_id = $2`,
    [datos.procedimientoId, tenantId]
  );
  if (p.rows.length === 0) throw new PlantillaInvalida("Ese procedimiento no existe.");
  await db.query(
    `INSERT INTO clinica_procedimiento_lecturas
       (tenant_id, procedimiento_id, persona_id, version)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (procedimiento_id, persona_id, version) DO NOTHING`,
    [tenantId, datos.procedimientoId, datos.personaId, p.rows[0].version]
  );
  return { version: p.rows[0].version };
}

/** Quién leyó qué, para el administrador. */
export async function lecturas(
  db: PoolClient,
  tenantId: string,
  procedimientoId: string
): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT l.persona_id, p.nombre AS persona, l.version, l.leido_en
       FROM clinica_procedimiento_lecturas l
       JOIN personas p ON p.id = l.persona_id
      WHERE l.tenant_id = $1 AND l.procedimiento_id = $2
      ORDER BY l.leido_en DESC`,
    [tenantId, procedimientoId]
  );
  return r.rows;
}
