-- =====================================================================
-- VetPlatform — Migración 088
-- El módulo `campanas` pasa a llamarse `crm`.
--
-- Cambio de la guía rectora (vetline-clinic-00, sección 7): el CRM es el
-- pegamento entre módulos — línea de tiempo de interacciones, ficha 360
-- del cliente, segmentos, oportunidades, consentimientos — y las
-- campañas son UNA de sus seis piezas, no el módulo entero. El nombre
-- viejo describía la parte y no el todo.
--
-- Va en una migración nueva en vez de editarse sobre la 086 porque la
-- 086 ya está aplicada: `migrate.ts` lleva registro en
-- `schema_migrations` y no la volvería a correr, así que editarla
-- arreglaría los ambientes nuevos y dejaría los existentes con el valor
-- viejo. El archivo 086 queda como está, con el nombre que tenía cuando
-- se escribió.
--
-- El UPDATE de datos existentes es por si acaso: hoy ninguna fila usa
-- `campanas` (el módulo todavía no se construyó, prompt 10 de la serie),
-- pero el orden importa — primero se migran los datos, después se
-- cambia la restricción, nunca al revés.
-- =====================================================================

UPDATE tenant_modulos SET modulo = 'crm', actualizado_en = now() WHERE modulo = 'campanas';

ALTER TABLE tenant_modulos DROP CONSTRAINT tenant_modulos_modulo_check;
ALTER TABLE tenant_modulos ADD CONSTRAINT tenant_modulos_modulo_check
  CHECK (modulo IN ('expediente', 'inventario', 'ventas', 'facturacion', 'crm'));
