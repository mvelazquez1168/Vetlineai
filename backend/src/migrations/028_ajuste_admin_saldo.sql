-- Platform Admin — ajuste manual de saldo (prompts_code_platform_admin_registro.md,
-- Prompt A Paso 5). movimientos_credito.creado_por tenía una FK real hacia
-- personas(id), pero un ajuste manual de saldo lo hace un usuario de
-- staff_plataforma (super_admin), cuyo id no existe en personas — la FK
-- rechazaría el INSERT siempre. Se convierte en FK lógica (sin constraint),
-- mismo patrón ya usado en este esquema para columnas que pueden apuntar a
-- personas O a staff_plataforma según quién hizo la acción (ver
-- solicitudes_activacion.revisado_por en 001_init.sql).
ALTER TABLE movimientos_credito DROP CONSTRAINT movimientos_credito_creado_por_fkey;
