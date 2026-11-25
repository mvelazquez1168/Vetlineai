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
] as const;

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
