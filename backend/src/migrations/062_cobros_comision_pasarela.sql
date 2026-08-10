-- =====================================================================
-- VetPlatform — Migración 062
-- prompt_code_panel_consumo_plataforma, Paso 5 — hueco a cerrar: "cobros"
-- guarda neto/impuesto/total pero nunca la comisión que retiene la
-- pasarela. Sin ese dato el margen por clínica (Paso 4, Bloque 3) queda
-- sobreestimado en cada cobro. Tilopay todavía no integra el envío de
-- este dato en su liquidación — se agrega la columna ahora, NULL por
-- default, para que cuando llegue el dato real tenga dónde escribirse.
-- No se puebla acá ni se calcula: cualquier consumidor de esta columna
-- debe tratar NULL como "comisión desconocida", nunca como cero.
-- =====================================================================

ALTER TABLE cobros ADD COLUMN comision_pasarela NUMERIC(12,2);
