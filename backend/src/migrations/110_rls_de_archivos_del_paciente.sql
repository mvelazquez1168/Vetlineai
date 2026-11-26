-- ---------------------------------------------------------------------
-- 110 — Un documento del expediente lo ve su propia clínica
--
-- DEFECTO REAL, encontrado reconstruyendo la línea de tiempo del CRM: la
-- política de RLS de `archivos` solo contempla el archivo que cuelga de
-- un CASO de Vetline Ai:
--
--     EXISTS (SELECT 1 FROM casos c
--              WHERE c.id = archivos.caso_id
--                AND c.tenant_id = current_setting('app.tenant_id'))
--
-- La migración 104 (prompt 07) permitió que `caso_id` sea NULL para los
-- documentos del expediente —la radiografía que trae el cliente, la
-- historia de otra clínica—, pero NO extendió la política. Resultado: un
-- documento que cuelga de un paciente es invisible para su propia
-- clínica. La pestaña «Imágenes y documentos» del expediente estaba
-- vacía para todo el mundo, y la reconstrucción del CRM no veía ni uno.
--
-- No era una fuga —RLS falla cerrado: de más, no de menos—, pero sí un
-- dato guardado que nadie podía leer.
--
-- La política nueva cubre los dos casos y sigue siendo fail-closed: un
-- archivo sin caso Y sin paciente no lo ve nadie (y la migración 104 ya
-- lo prohíbe con un CHECK).
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS archivos_tenant ON archivos;
CREATE POLICY archivos_tenant ON archivos
  USING (
    EXISTS (
      SELECT 1 FROM casos c
       WHERE c.id = archivos.caso_id
         AND c.tenant_id::text = current_setting('app.tenant_id', true)
    )
    OR EXISTS (
      SELECT 1 FROM pacientes p
       WHERE p.id = archivos.paciente_id
         AND p.tenant_id::text = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM casos c
       WHERE c.id = archivos.caso_id
         AND c.tenant_id::text = current_setting('app.tenant_id', true)
    )
    OR EXISTS (
      SELECT 1 FROM pacientes p
       WHERE p.id = archivos.paciente_id
         AND p.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

COMMENT ON TABLE archivos IS
  'Adjuntos: de un caso de Vetline Ai (caso_id) o del expediente de un paciente (paciente_id). La política de RLS cubre los dos caminos — ver la migración 110, que corrige el olvido de la 104.';
