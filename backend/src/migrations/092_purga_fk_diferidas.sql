-- =====================================================================
-- VetPlatform — Migración 092
-- D-006: una clínica cuyo médico escribió un mensaje no se podía purgar.
--
-- EL SÍNTOMA. `DELETE FROM tenants` fallaba con
-- `mensajes_autor_persona_id_fkey`, y `purga.ts::ejecutarPurgas` atrapa
-- el error y hace ROLLBACK dentro de un `catch`: la clínica quedaba
-- pendiente indefinidamente, en silencio salvo una línea de log. Como
-- `mensajes.autor_persona_id` se llena en cuanto un médico escribe en el
-- chat, afectaba a cualquier clínica con actividad.
--
-- LA CAUSA, y por qué no alcanza con reordenar el borrado. Medido sobre
-- el esquema real: NO es una FK, son 42 FK sin cascada entre tablas que
-- la purga borra. `mensajes` era solo la primera con la que tropezó el
-- verificador. Borrar los mensajes antes que las personas arreglaría UNA
-- y la purga fallaría en `casos_medico_id_fkey`, después en
-- `recetas_medico_id_fkey`, y así. Mantener a mano un orden topológico de
-- 42 aristas, correcto para siempre, es exactamente la clase de lista
-- paralela que se desactualiza con la 43.a.
--
-- Por que fallan, si `NO ACTION` se verifica al final de la sentencia: la
-- cascada de `tenants` no es UNA sentencia. Cada rama la ejecuta un
-- trigger interno de integridad referencial como su propia sentencia, y
-- el chequeo de `NO ACTION` corre al final de ESA — momento en el que la
-- otra rama todavia no borro sus filas. Por eso el orden entre ramas
-- decide si pasa o no, y por eso es intermitente por naturaleza.
--
-- LA DECISION (del usuario, 2026-11-25): `mensajes.autor_persona_id`
-- MANTIENE su regla. Un medico no se borra en la operacion normal: se
-- desactiva, y sus mensajes son historial clinico. Lo que cambia es
-- CUANDO se verifica la regla, no SI se verifica.
--
-- `DEFERRABLE INITIALLY DEFERRED` mueve el chequeo al COMMIT. Para
-- entonces todas las ramas de la cascada terminaron y no queda ninguna
-- fila colgada, asi que la purga pasa sin importar el orden. Fuera de la
-- purga la regla sigue mordiendo igual: borrar un medico que escribio un
-- mensaje sigue fallando, solo que el error aparece al confirmar la
-- transaccion en vez de en la sentencia. La transaccion se aborta igual y
-- el mensaje de error es el mismo.
--
-- QUE SE DIFIERE Y QUE NO. Solo las FK en las que **las dos puntas** se
-- borran con el tenant. Para una FK cuyo origen NO se borra, diferir no
-- serviria: la fila sobrevive al COMMIT y seguiria apuntando a un padre
-- eliminado. Esas se resuelven borrando a mano, y son las que ya estaban
-- contempladas (`uso_api`, `notificaciones_uso`, `eventos_facturacion`,
-- `documentos_fiscales`, `notificaciones_callback`) mas una que faltaba:
-- `restablecimientos_contrasena`, que se agrega en `purga.ts`.
--
-- Las 42 estan escritas una por una, y no calculadas por un DO block: una
-- migracion tiene que hacer siempre lo mismo, y una que recorra el
-- esquema haria cosas distintas segun cuando se aplique.
-- =====================================================================

ALTER TABLE archivos ALTER CONSTRAINT archivos_mensaje_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> mensajes
ALTER TABLE archivos ALTER CONSTRAINT archivos_subido_por_persona_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE atenciones ALTER CONSTRAINT atenciones_cita_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> citas
ALTER TABLE atenciones ALTER CONSTRAINT atenciones_medico_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE atenciones ALTER CONSTRAINT atenciones_paciente_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> pacientes
ALTER TABLE bitacora_auditoria ALTER CONSTRAINT bitacora_auditoria_persona_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE cambio_medicos_conservados ALTER CONSTRAINT cambio_medicos_conservados_persona_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE cambios_suscripcion ALTER CONSTRAINT cambios_suscripcion_cobro_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> cobros
ALTER TABLE cambios_suscripcion ALTER CONSTRAINT cambios_suscripcion_solicitado_por_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE casos ALTER CONSTRAINT casos_cerrado_por_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE casos ALTER CONSTRAINT casos_medico_agente_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> medico_agente
ALTER TABLE casos ALTER CONSTRAINT casos_medico_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE casos ALTER CONSTRAINT casos_reabierto_por_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE citas ALTER CONSTRAINT citas_caso_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> casos
ALTER TABLE citas ALTER CONSTRAINT citas_medico_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE citas ALTER CONSTRAINT citas_paciente_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> pacientes
ALTER TABLE citas ALTER CONSTRAINT citas_sala_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> salas
ALTER TABLE cobros ALTER CONSTRAINT cobros_metodo_pago_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> metodos_pago
ALTER TABLE cobros ALTER CONSTRAINT cobros_suscripcion_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> suscripciones
ALTER TABLE cuidados_preventivos ALTER CONSTRAINT cuidados_preventivos_atencion_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> atenciones
ALTER TABLE cuidados_preventivos ALTER CONSTRAINT cuidados_preventivos_registrado_por_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE exportaciones ALTER CONSTRAINT exportaciones_solicitada_por_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE fact_comprobantes ALTER CONSTRAINT fact_comprobantes_comprobante_referencia_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> fact_comprobantes
ALTER TABLE informes_generados ALTER CONSTRAINT informes_generados_caso_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> casos
ALTER TABLE informes_generados ALTER CONSTRAINT informes_generados_medico_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE invitaciones_medico ALTER CONSTRAINT invitaciones_medico_persona_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE lista_espera ALTER CONSTRAINT lista_espera_cita_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> citas
ALTER TABLE lista_espera ALTER CONSTRAINT lista_espera_medico_preferido_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE lista_espera ALTER CONSTRAINT lista_espera_paciente_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> pacientes
ALTER TABLE mensajes ALTER CONSTRAINT mensajes_autor_persona_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE notificaciones ALTER CONSTRAINT notificaciones_caso_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> casos
ALTER TABLE notificaciones ALTER CONSTRAINT notificaciones_cita_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> citas
ALTER TABLE notificaciones ALTER CONSTRAINT notificaciones_cuidado_preventivo_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> cuidados_preventivos
ALTER TABLE notificaciones ALTER CONSTRAINT notificaciones_paciente_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> pacientes
ALTER TABLE recargas ALTER CONSTRAINT recargas_cobro_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> cobros
ALTER TABLE recargas ALTER CONSTRAINT recargas_solicitada_por_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE receta_items ALTER CONSTRAINT receta_items_medicamento_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> medicamentos
ALTER TABLE recetas ALTER CONSTRAINT recetas_atencion_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> atenciones
ALTER TABLE recetas ALTER CONSTRAINT recetas_medico_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE recetas ALTER CONSTRAINT recetas_paciente_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> pacientes
ALTER TABLE solicitudes_activacion ALTER CONSTRAINT solicitudes_activacion_solicitado_por_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> personas
ALTER TABLE tenants ALTER CONSTRAINT tenants_suscripcion_id_fkey DEFERRABLE INITIALLY DEFERRED;  -- -> suscripciones

-- ---------------------------------------------------------------------
-- Comprobacion: despues de esto, ninguna FK entre dos tablas que la purga
-- borra puede quedar sin diferir.
--
-- Va DENTRO de la migracion y no en un verificador aparte a proposito: si
-- alguien agrega manana una FK sin cascada entre dos tablas borrables y
-- vuelve a correr las migraciones desde cero, esto lo detiene aca, con el
-- nombre de la FK, en vez de dejar que el defecto vuelva en silencio.
-- ---------------------------------------------------------------------
DO $verificacion$
DECLARE
  faltantes TEXT;
BEGIN
  WITH RECURSIVE cascada AS (
    SELECT 'tenants'::regclass AS tabla
    UNION
    SELECT con.conrelid
      FROM pg_constraint con
      JOIN cascada c ON c.tabla = con.confrelid
     WHERE con.contype = 'f' AND con.confdeltype = 'c'
  )
  SELECT string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ')
    INTO faltantes
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
   WHERE con.contype = 'f'
     AND ns.nspname = 'public'
     AND con.confdeltype <> 'c'
     AND NOT con.condeferrable
     AND con.conrelid IN (SELECT tabla FROM cascada)
     AND con.confrelid IN (SELECT tabla FROM cascada);

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION
      'Quedaron FK sin diferir entre tablas que la purga borra, y van a trabarla (D-006): %',
      faltantes;
  END IF;
END
$verificacion$;
