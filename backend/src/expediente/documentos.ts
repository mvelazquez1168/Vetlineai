import { PoolClient } from "pg";
import { fechaHoyEnZona } from "../fecha";

// ---------------------------------------------------------------------
// IMÁGENES Y DOCUMENTOS DEL PACIENTE — hallazgo de la revisión del
// 2026-11-27: «la pestaña solo muestra la línea de tiempo filtrada y no
// permite agregar nada».
//
// Era cierto, y era peor que un faltante: el médico que saca una
// radiografía no tiene dónde ponerla, así que la manda por WhatsApp. El
// expediente queda sin el estudio y la imagen queda en un teléfono.
//
// LO QUE ESTE MÓDULO NO HACE, a propósito: no guarda archivos ni
// resuelve almacenamiento. Eso ya existe —`archivos.routes.ts` con
// `almacenamientoPrivado`, el límite de 25 MB, la tabla de tipos MIME y
// el descargador autenticado `GET /api/archivos/:id`— y se reusa tal
// cual. Acá vive lo que es del EXPEDIENTE: el catálogo de tipos de
// documento por clínica, quién puede subir cada tipo, y la galería con
// sus filtros y su origen.
// ---------------------------------------------------------------------

export interface TipoDocumento {
  id: string;
  codigo: string;
  nombre: string;
  /** Si la recepción puede subirlo. */
  administrativo: boolean;
  orden: number;
}

export async function tiposDeDocumento(
  db: PoolClient,
  tenantId: string
): Promise<TipoDocumento[]> {
  const r = await db.query<TipoDocumento>(
    `SELECT id, codigo, nombre, administrativo, orden
       FROM exp_tipos_documento
      WHERE tenant_id = $1 AND activo
      ORDER BY orden, nombre`,
    [tenantId]
  );
  return r.rows;
}

export class DocumentoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DocumentoInvalido";
  }
}

/**
 * ¿Esta persona puede subir este tipo de documento?
 *
 * LA REGLA DEL PROMPT: el médico sube cualquier tipo; la recepción, solo
 * los administrativos (historial previo, informe externo, certificado).
 *
 * POR QUÉ ASÍ Y NO AL REVÉS: una radiografía o una foto clínica son
 * contenido clínico —van al expediente y el agente las puede leer—, y
 * quién las interpreta es un médico. El historial que el cliente trae en
 * papel, en cambio, lo recibe el mostrador: exigir un médico para
 * escanearlo es cómo se termina con una carpeta de papeles sin cargar.
 */
export async function puedeSubirTipo(
  db: PoolClient,
  tenantId: string,
  codigo: string,
  quien: { esMedico: boolean }
): Promise<{ puede: boolean; motivo?: string }> {
  const r = await db.query<{ nombre: string; administrativo: boolean }>(
    `SELECT nombre, administrativo FROM exp_tipos_documento
      WHERE tenant_id = $1 AND codigo = $2 AND activo`,
    [tenantId, codigo]
  );
  if (r.rows.length === 0) {
    return { puede: false, motivo: `El tipo de documento «${codigo}» no existe en esta clínica.` };
  }
  if (quien.esMedico) return { puede: true };
  if (r.rows[0].administrativo) return { puede: true };
  return {
    puede: false,
    motivo: `«${r.rows[0].nombre}» es contenido clínico y lo sube un médico. Desde recepción se pueden cargar el historial previo, los informes externos y los certificados.`,
  };
}

export interface DocumentoDelPaciente {
  id: string;
  nombre_archivo: string;
  tipo: string;
  tipo_documento: string | null;
  tipo_documento_nombre: string | null;
  descripcion: string | null;
  fecha_documento: string | null;
  creado_en: string;
  atencion_id: string | null;
  /** De dónde vino: subido acá, un resultado de laboratorio, un caso. */
  origen: "subido" | "laboratorio" | "caso";
  origen_id: string | null;
  subido_por: string | null;
  /** Si es una imagen, para decidir miniatura o ícono. */
  es_imagen: boolean;
}

/**
 * La galería del paciente: lo que se subió acá y lo que llegó por otros
 * caminos.
 *
 * EL ORIGEN SE MUESTRA, que es la mitad del pedido: un PDF que llegó
 * como resultado de laboratorio y uno que alguien escaneó a mano no son
 * lo mismo, y el que mira la galería tiene que poder ir al registro que
 * lo explica.
 */
export async function documentosDePaciente(
  db: PoolClient,
  pacienteId: string,
  filtros: { tipo?: string; desde?: string; hasta?: string } = {}
): Promise<DocumentoDelPaciente[]> {
  const condiciones: string[] = ["a.paciente_id = $1"];
  const params: unknown[] = [pacienteId];

  if (filtros.tipo) {
    params.push(filtros.tipo);
    condiciones.push(`a.tipo_documento = $${params.length}`);
  }
  if (filtros.desde) {
    params.push(filtros.desde);
    condiciones.push(`COALESCE(a.fecha_documento, a.creado_en::date) >= $${params.length}::date`);
  }
  if (filtros.hasta) {
    params.push(filtros.hasta);
    condiciones.push(`COALESCE(a.fecha_documento, a.creado_en::date) <= $${params.length}::date`);
  }

  const r = await db.query<DocumentoDelPaciente>(
    `SELECT a.id, a.nombre_archivo, a.tipo, a.tipo_documento,
            td.nombre AS tipo_documento_nombre,
            a.descripcion, a.fecha_documento::text, a.creado_en::text,
            a.atencion_id,
            CASE
              WHEN a.estudio_lab_id IS NOT NULL THEN 'laboratorio'
              WHEN a.caso_id IS NOT NULL THEN 'caso'
              ELSE 'subido'
            END AS origen,
            COALESCE(a.estudio_lab_id, a.caso_id)::text AS origen_id,
            per.nombre AS subido_por,
            -- archivos.tipo guarda una CATEGORÍA («imagen», «pdf»,
            -- «documento»), no el tipo MIME. Preguntar por 'image/%'
            -- daba siempre falso y la galería mostraba todo con ícono
            -- de documento. (Sin comillas invertidas en los comentarios
            -- SQL: cortan el template literal de TypeScript.)
            (a.tipo = 'imagen' OR a.tipo LIKE 'image/%') AS es_imagen
       FROM archivos a
       LEFT JOIN exp_tipos_documento td
         ON td.codigo = a.tipo_documento
        AND td.tenant_id = (SELECT tenant_id FROM pacientes WHERE id = $1)
       LEFT JOIN personas per ON per.id = a.subido_por_persona_id
      WHERE ${condiciones.join(" AND ")}
      ORDER BY COALESCE(a.fecha_documento, a.creado_en::date) DESC, a.creado_en DESC`,
    params
  );
  return r.rows;
}

/**
 * Comprueba los datos del documento antes de guardarlo.
 *
 * LA FECHA DEL DOCUMENTO PUEDE SER ANTERIOR —un historial previo es de
 * hace tres años— pero no puede ser del futuro: una radiografía de la
 * semana que viene no existe, y lo que sí pasa es que alguien se
 * equivoca al teclear el año.
 */
export function validarDatosDeDocumento(
  d: {
    tipoDocumento?: string;
    fechaDocumento?: string;
    descripcion?: string;
  },
  // La zona de la clínica, para saber qué día es hoy. Con la de UTC, el
  // 25 de diciembre tecleado a las 19:00 del 24 en Costa Rica se
  // rechazaba por futuro.
  zonaHoraria?: string | null
): void {
  if (!d.tipoDocumento?.trim()) {
    throw new DocumentoInvalido(
      "Falta el tipo de documento. Sin él, la galería no se puede filtrar y nadie encuentra la radiografía dos meses después."
    );
  }
  if (d.fechaDocumento) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fechaDocumento)) {
      throw new DocumentoInvalido("La fecha del documento va en formato AAAA-MM-DD.");
    }
    const hoy = fechaHoyEnZona(zonaHoraria);
    if (d.fechaDocumento > hoy) {
      throw new DocumentoInvalido("La fecha del documento no puede ser futura.");
    }
  }
  if (d.descripcion && d.descripcion.length > 500) {
    throw new DocumentoInvalido("La descripción no puede pasar de 500 caracteres.");
  }
}
