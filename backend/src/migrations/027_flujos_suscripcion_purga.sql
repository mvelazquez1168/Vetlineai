-- Flujos de suscripción, Flujo C — purga de cuentas no convertidas y
-- exportación.
--
-- 1. informes_generados.es_cortesia: distingue un informe generado
--    durante la ventana de purga (sin verificación de saldo, cobrable
--    false) de uno normal — necesario para el límite estricto de un
--    informe de cortesía por caso (ver Paso 3 del flujo).
--
-- 2. clinicas_purgadas_auditoria: registro que sobrevive a la eliminación
--    del tenant. tenant_id es un uuid plano, sin FK — el tenant referido
--    ya no existe para cuando se lee este registro, por diseño (es lo que
--    permite demostrar que se avisó y se eliminó, después de eliminado).
--    Vive fuera de `tenants` a propósito, por el mismo motivo: si
--    estuviera colgado de esa tabla, el ON DELETE CASCADE de todas las
--    demás tablas tenant-scoped se lo llevaría puesto en la misma
--    transacción de purga.

ALTER TABLE informes_generados ADD COLUMN es_cortesia boolean NOT NULL DEFAULT false;

CREATE TABLE clinicas_purgadas_auditoria (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL,
    nombre_clinica       varchar(200) NOT NULL,
    email_administrador  varchar(200),
    aviso_en             timestamptz,
    recordatorio_en      timestamptz,
    purgado_en           timestamptz NOT NULL DEFAULT now()
);
