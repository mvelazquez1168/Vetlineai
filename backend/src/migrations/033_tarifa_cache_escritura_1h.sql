-- Latencia y costo por mensaje, Cambio 1 — el chat clínico pasa a usar TTL
-- de una hora en el cache_control del bloque cacheado (system_prompt +
-- documentos), en vez del default de 5 minutos. Anthropic cobra la
-- escritura con TTL de una hora al doble que la de cinco minutos, pero
-- tarifas_modelo tenía un solo tipo 'cache_escritura' — si el chat pasa a
-- 1h sin esta migración, el costo se seguiría calculando con la tarifa de
-- 5 minutos mientras se factura la de una hora, y el consumo quedaría
-- subestimado. Dashboard, Informe y Recetas se quedan en 5 minutos (sin
-- cambios en este prompt), así que ambas tarifas coexisten y hacen falta
-- las dos — no se reemplaza cache_escritura, se agrega cache_escritura_1h.
--
-- La tarifa nueva se siembra a partir de la vigente de cache_escritura
-- (5 min) multiplicada por 1.6 — la relación real entre ambos TTL en la
-- tarifa de Anthropic (escritura 5m = entrada×1.25, escritura 1h =
-- entrada×2 → 1h/5m = 2/1.25 = 1.6), así que no hace falta tocar el precio
-- base de entrada para derivarla, y el resultado es consistente con el
-- valor real de Anthropic para cualquier modelo ya tarifado.

BEGIN;

ALTER TABLE tarifas_modelo DROP CONSTRAINT tarifas_modelo_tipo_token_check;
ALTER TABLE tarifas_modelo
    ADD CONSTRAINT tarifas_modelo_tipo_token_check
    CHECK (tipo_token IN ('entrada','salida','cache_escritura','cache_lectura','cache_escritura_1h'));

INSERT INTO tarifas_modelo (modelo, tipo_token, precio_usd_por_millon, facturable, vigente_desde)
SELECT modelo, 'cache_escritura_1h', ROUND(precio_usd_por_millon * 1.6, 6), facturable, now()
  FROM tarifas_modelo
 WHERE tipo_token = 'cache_escritura' AND vigente_hasta IS NULL;

COMMIT;
