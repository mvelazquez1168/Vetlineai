// ---------------------------------------------------------------------
// vetline-clinic-01, punto 1 — el contrato entre la purga y la auditoría
// de seguridad por fila, en UN solo lugar.
//
// Por qué existe este archivo: hasta ahora la lista de tablas que la
// purga tiene que borrar a mano vivía como cinco `DELETE` escritos a
// mano dentro de `purga.ts::ejecutarPurgas`, y la auditoría de RLS no
// sabía nada de ella. Son dos lecturas de la misma regla ("estas tablas
// tenant-scoped no se van solas cuando se borra el tenant"), y mientras
// estuvieran en dos lados, agregar una tabla nueva a una y olvidarse de
// la otra no rompía nada visible: la purga seguiría fallando con una
// violación de FK, en silencio, dentro del catch del job diario.
//
// Ahora la lista es una constante y los dos la leen. Si aparece una FK a
// `tenants` sin `ON DELETE CASCADE` que no esté acá, el job la reporta.
// ---------------------------------------------------------------------

/**
 * Tablas con FK directa a `tenants` SIN `ON DELETE CASCADE`, que por eso
 * la purga borra explícitamente antes del `DELETE FROM tenants` final.
 *
 * El orden importa y es el que ya tenía `purga.ts`: ninguna de las
 * cuatro depende de las otras, pero se conserva para que el diff contra
 * la versión anterior sea legible.
 *
 * Por qué estas cuatro no tienen cascada: son el rastro contable y
 * fiscal del tenant (consumo de IA, avisos de uso, eventos de
 * facturación, documentos fiscales emitidos). No tenerla es deliberado —
 * obliga a que borrarlas sea un acto explícito y no un efecto colateral
 * de borrar la clínica. La contrapartida es que la purga tiene que
 * nombrarlas, y de ahí esta lista.
 *
 * REGLA PARA TABLAS NUEVAS (Vetline Clinic incluido): lo esperado es
 * `ON DELETE CASCADE`, y entonces NO va acá. Agregá una tabla a esta
 * lista solo si hay un motivo real para que su FK no tenga cascada, y
 * escribilo en el comentario de la migración.
 */
export const TABLAS_BORRADO_MANUAL_EN_PURGA = [
  "uso_api",
  "notificaciones_uso",
  "eventos_facturacion",
  "documentos_fiscales",
  // Misma naturaleza que uso_api y por el mismo motivo: es rastro de
  // consumo de IA (minutos de audio transcritos, migración 119), y su FK
  // a tenants no tiene cascada a propósito.
  "uso_transcripcion",
] as const;

/**
 * Tablas que la purga también tiene que borrar a mano pero que **no
 * tienen `tenant_id`**, así que no se pueden borrar por el criterio de
 * la lista de arriba: se llega a sus filas por una FK a una tabla que sí
 * es del tenant.
 *
 * Son la otra mitad de D-006. La diferencia con la familia que la
 * migración 092 resolvió difiriendo las FK es que acá **diferir no
 * sirve**: la fila que apunta sobrevive al COMMIT, así que la FK se va a
 * violar igual, solo que más tarde. La única salida es borrarla.
 *
 * El SQL vive acá, no en `purga.ts`, para que la auditoría y la purga
 * lean la misma lista: si estuviera en dos lados, agregar una tabla a
 * una y olvidarse de la otra dejaría a la purga fallando en silencio,
 * que es exactamente lo que pasó con `notificaciones_callback`.
 *
 * `$1` es el `tenants.id`.
 */
export const TABLAS_BORRADO_MANUAL_SIN_TENANT_ID: {
  tabla: string;
  sql: string;
  motivo: string;
}[] = [
  {
    tabla: "notificaciones_callback",
    sql:
      "DELETE FROM notificaciones_callback " +
      "WHERE cobro_id IN (SELECT id FROM cobros WHERE tenant_id = $1)",
    motivo:
      "Bitácora cruda de los avisos de la pasarela de pago. Cuelga de `cobros`, que sí es del " +
      "tenant, pero la FK no tiene cascada: es evidencia de qué dijo el proveedor y cuándo.",
  },
  {
    tabla: "restablecimientos_contrasena",
    sql:
      "DELETE FROM restablecimientos_contrasena " +
      "WHERE persona_id IN (SELECT id FROM personas WHERE tenant_id = $1)",
    motivo:
      "Pedidos de recuperación de contraseña. Cuelgan de `personas`. Cualquier clínica cuyo " +
      "usuario alguna vez usó «olvidé mi contraseña» trababa el DELETE FROM tenants.",
  },
];

/**
 * Tablas con RLS habilitado y CERO políticas **a propósito**: el bloqueo
 * total es el comportamiento buscado, no un olvido. La auditoría las
 * saltea en el chequeo de "sin política" y solo en ese.
 *
 * Son las únicas dos excepciones del sistema. Cualquier otra tabla con
 * `tenant_id` y RLS sin política es un defecto.
 */
export const TABLAS_SIN_POLITICA_RLS_A_PROPOSITO: Record<string, string> = {
  clinica_eventos_ciclo_vida:
    "Evidencia interna de ciclo de vida (migración 051). Se escribe y se lee solo por el pool " +
    "admin (jobs de cobro/purga y Platform Admin); ninguna clínica debe poder leer los eventos " +
    "de suspensión o bloqueo de su propia cuenta.",
  clinicas_purgadas_auditoria:
    "Auditoría que sobrevive al DELETE del tenant a propósito (migración 027, sin FK). No es " +
    "dato de clínica: es la constancia de que esa clínica existió y cuánto consumió.",
};
