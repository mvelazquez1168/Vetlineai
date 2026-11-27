import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// EL BORRADOR Y QUIÉN TIENE EL DOCUMENTO ABIERTO — anexo 07-03, A4.
//
// Estrena `exp_borradores`, que la migración 111 creó y hasta hoy no
// leía nadie.
//
// DOS PROBLEMAS DISTINTOS, UNA SOLA TABLA, y conviene no confundirlos:
//
//   1. QUIÉN LO TIENE ABIERTO. Si la misma atención se abre en dos
//      sesiones, la segunda entra en modo lectura y dice de quién es.
//      Es un bloqueo cooperativo, no una garantía: la garantía la da la
//      versión optimista del `PATCH` (migración 124). El bloqueo evita
//      que dos personas escriban en paralelo; la versión evita que una
//      pise a la otra si igual lo hacen.
//
//   2. QUÉ SE ESTABA ESCRIBIENDO. El contenido todavía no guardado, por
//      si el navegador se cierra. No reemplaza al guardado en
//      `atenciones`: es lo que aún no llegó ahí.
//
// EL LATIDO VENCE A PROPÓSITO. Un bloqueo sin vencimiento es un
// documento trabado para siempre porque alguien cerró la laptop. Dos
// minutos: más que el intervalo con el que late la pantalla (30 s) y
// menos que el tiempo que alguien tarda en volver a la computadora.
// ---------------------------------------------------------------------

export const VENCIMIENTO_LATIDO_MINUTOS = 2;

export type TipoDocumento = "atencion" | "consentimiento" | "informe";

export interface EstadoDelBorrador {
  /** Si esta persona es la que lo tiene tomado. */
  mio: boolean;
  /** Quién lo tiene, cuando no es mío. */
  porPersonaId: string | null;
  porNombre: string | null;
  /** Desde cuándo lo tiene. */
  desde: string | null;
  /** Lo que se estaba escribiendo y todavía no llegó al documento. */
  contenido: Record<string, unknown>;
}

/**
 * Tomar el documento o renovar el latido.
 *
 * El `ON CONFLICT` actualiza **solo si** la fila es de esta persona o el
 * latido ya venció. Si es de otra persona y está viva, no actualiza
 * nada y la consulta de abajo devuelve de quién es: el que llega
 * segundo entra en lectura.
 */
export async function tomarOLatir(
  db: PoolClient,
  tenantId: string,
  datos: { documentoTipo: TipoDocumento; documentoId: string; personaId: string }
): Promise<EstadoDelBorrador> {
  await db.query(
    `INSERT INTO exp_borradores (tenant_id, documento_tipo, documento_id, persona_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (documento_tipo, documento_id) DO UPDATE
       SET persona_id    = EXCLUDED.persona_id,
           ultimo_latido = now()
     WHERE exp_borradores.persona_id = EXCLUDED.persona_id
        OR exp_borradores.ultimo_latido < now() - ($5 || ' minutes')::interval`,
    [tenantId, datos.documentoTipo, datos.documentoId, datos.personaId, String(VENCIMIENTO_LATIDO_MINUTOS)]
  );

  const r = await db.query<{
    persona_id: string;
    nombre: string | null;
    ultimo_latido: Date;
    contenido: Record<string, unknown>;
    vencido: boolean;
  }>(
    `SELECT b.persona_id, p.nombre, b.ultimo_latido, b.contenido,
            (b.ultimo_latido < now() - ($3 || ' minutes')::interval) AS vencido
       FROM exp_borradores b
       LEFT JOIN personas p ON p.id = b.persona_id
      WHERE b.documento_tipo = $1 AND b.documento_id = $2`,
    [datos.documentoTipo, datos.documentoId, String(VENCIMIENTO_LATIDO_MINUTOS)]
  );

  if (r.rows.length === 0) {
    // No debería pasar: el INSERT de arriba la crea. Si pasa, lo honesto
    // es dejar escribir —el bloqueo es una ayuda, no la protección real,
    // que es la versión optimista—.
    return { mio: true, porPersonaId: null, porNombre: null, desde: null, contenido: {} };
  }

  const f = r.rows[0];
  const mio = f.persona_id === datos.personaId;
  return {
    mio,
    porPersonaId: mio ? null : f.persona_id,
    porNombre: mio ? null : f.nombre,
    desde: mio ? null : f.ultimo_latido.toISOString(),
    // El contenido sin guardar solo se devuelve al dueño: al que entra
    // en lectura no le sirve, y mostrarle lo que otro está tipeando es
    // enseñarle datos a medio escribir.
    contenido: mio ? (f.contenido ?? {}) : {},
  };
}

/** Lo que se está escribiendo, por si el navegador se cierra. */
export async function guardarBorrador(
  db: PoolClient,
  tenantId: string,
  datos: {
    documentoTipo: TipoDocumento;
    documentoId: string;
    personaId: string;
    contenido: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO exp_borradores (tenant_id, documento_tipo, documento_id, persona_id,
                                 contenido, guardado_en, ultimo_latido)
     VALUES ($1,$2,$3,$4,$5,now(),now())
     ON CONFLICT (documento_tipo, documento_id) DO UPDATE
       SET contenido = EXCLUDED.contenido, guardado_en = now(), ultimo_latido = now()
     WHERE exp_borradores.persona_id = EXCLUDED.persona_id`,
    [tenantId, datos.documentoTipo, datos.documentoId, datos.personaId, JSON.stringify(datos.contenido)]
  );
}

/**
 * Soltar el documento.
 *
 * Se llama al cerrar la atención y al salir de la pantalla. Si no se
 * llama, el latido vence solo: por eso el vencimiento existe.
 */
export async function liberar(
  db: PoolClient,
  datos: { documentoTipo: TipoDocumento; documentoId: string; personaId: string }
): Promise<void> {
  await db.query(
    `DELETE FROM exp_borradores
      WHERE documento_tipo = $1 AND documento_id = $2 AND persona_id = $3`,
    [datos.documentoTipo, datos.documentoId, datos.personaId]
  );
}
