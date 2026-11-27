import { PoolClient } from "pg";
import { registrarConsentimiento } from "../crm/consentimientos";
import { registrarInteraccion } from "../crm/interacciones";

// ---------------------------------------------------------------------
// CREAR UN CLIENTE — el único lugar (anexo 07-03, A5).
//
// Nació dentro de `POST /api/propietarios`, que era el único camino que
// existía. El anexo agrega un segundo: crear el paciente y su dueño en
// la misma operación, desde `/pacientes`. Dos caminos y una sola
// función, porque crear un cliente no es solo un INSERT: también lo
// registra en la línea de tiempo del CRM y le deja su consentimiento de
// salud. Un segundo INSERT suelto crearía clientes sin ninguna de las
// dos cosas, y el defecto no se vería hasta que a alguien no le llegue
// un recordatorio.
// ---------------------------------------------------------------------

export interface DatosAltaPropietario {
  nombre: string;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  tipoIdentificacionId?: string | null;
  numeroIdentificacion?: string | null;
  /** Cómo llegó a la clínica (anexo 07-03, B3). */
  fuenteReferenciaId?: string | null;
  /** Qué cliente lo trajo, cuando la fuente lo pide. */
  referidoPorPropietarioId?: string | null;
  /**
   * De dónde salieron el nombre y los datos fiscales (anexo 07-03, B2):
   * los escribió alguien («manual») o los trajo el autocompletar.
   *
   * Importa por la ley 8968: hay que poder decir de dónde salió un dato
   * personal y cuándo. Y en la operación, porque un nombre que vino del
   * registro no se corrige «porque se ve raro».
   */
  datosFuente?: "manual" | "hacienda" | "simulado" | null;
}

export interface PropietarioCreado {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  tipo_identificacion_id: string | null;
  numero_identificacion: string | null;
}

export async function crearPropietario(
  db: PoolClient,
  tenantId: string,
  datos: DatosAltaPropietario,
  personaId?: string
): Promise<PropietarioCreado> {
  const result = await db.query<PropietarioCreado>(
    `INSERT INTO propietarios
       (tenant_id, nombre, telefono, email, direccion, tipo_identificacion_id,
        numero_identificacion, fuente_referencia_id, referido_por_propietario_id,
        datos_fuente, datos_fuente_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::varchar,
             -- EL CAST NO ES DECORATIVO: sin él, Postgres no puede
             -- deducir el tipo de $10 dentro del CASE y falla con
             -- «could not determine data type». Es el mismo defecto que
             -- ya apareció en la baja del paciente y en los agentes por
             -- país: un parámetro que solo aparece dentro de un CASE
             -- necesita que alguien le diga qué es.
             CASE WHEN $10::varchar IS NULL THEN NULL ELSE now() END)
     RETURNING id, nombre, telefono, email, direccion, tipo_identificacion_id,
               numero_identificacion`,
    [
      tenantId,
      datos.nombre.trim(),
      datos.telefono?.trim() || null,
      datos.email?.trim() || null,
      datos.direccion?.trim() || null,
      datos.tipoIdentificacionId || null,
      datos.numeroIdentificacion?.trim() || null,
      datos.fuenteReferenciaId || null,
      datos.referidoPorPropietarioId || null,
      datos.datosFuente || null,
    ]
  );
  const nuevo = result.rows[0];

  // CRM (prompt 03): el cliente nace en la línea de tiempo y con su
  // consentimiento de SALUD por correo registrado. El de PROMOCIONES
  // queda en no hasta que lo dé: es opt-in.
  await registrarInteraccion(db, {
    tenantId,
    tipo: "cliente_registrado",
    propietarioId: nuevo.id,
    origenTabla: "propietarios",
    origenId: nuevo.id,
    personaId,
    resumen: nuevo.nombre,
  });
  // EL REFERIDO ES SU PROPIO EVENTO, además del alta: es el dato que
  // la fidelización va a premiar (7.1 de la guía), y buscarlo dentro
  // del evento de registro sería buscarlo en el lugar equivocado.
  if (datos.referidoPorPropietarioId) {
    const quien = await db.query<{ nombre: string }>(
      `SELECT nombre FROM propietarios WHERE id = $1`,
      [datos.referidoPorPropietarioId]
    );
    await registrarInteraccion(db, {
      tenantId,
      tipo: "cliente_referido",
      propietarioId: nuevo.id,
      origenTabla: "propietarios",
      origenId: datos.referidoPorPropietarioId,
      personaId,
      resumen: `Referido por ${quien.rows[0]?.nombre ?? "otro cliente"}`,
    });
  }

  await registrarConsentimiento(db, tenantId, {
    propietarioId: nuevo.id,
    canal: "correo",
    finalidad: "salud",
    otorgado: true,
    fuente: "recepcion",
    personaId,
    nota: "Registrado al crear el cliente: recordatorios de citas, vacunas y comprobantes.",
  });

  return nuevo;
}

/** El 23505 de la identificación única, traducido una sola vez. */
export function esIdentificacionRepetida(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" && e?.constraint === "propietarios_identificacion_unica";
}

export const ERROR_IDENTIFICACION_REPETIDA =
  "Ya existe un propietario registrado en tu clínica con ese tipo y número de identificación.";
