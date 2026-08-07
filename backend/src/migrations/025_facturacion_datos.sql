-- =====================================================================
-- Migración 025 — Poblado de catálogos y datos de facturación
-- Vetline Ai
--
-- Requiere la migración 024 aplicada.
-- Entorno de pruebas: se reconstruye el catálogo de planes y se deja a
-- los trece tenants en estado activo, repartidos entre los cuatro planes.
--
-- REVISAR ANTES DE EJECUTAR:
--   * Bloque 1  — escalera de precios (pendiente de confirmación)
--   * Bloque 5  — tarifas por token: los precios entran en cero y deben
--                 cargarse desde administración de plataforma
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. CATÁLOGO DE PLANES
-- ---------------------------------------------------------------------

-- Los planes heredados quedan inactivos, no se eliminan: tenants.plan_id
-- todavía los referencia hasta que el backfill de suscripciones termine.
UPDATE planes SET activo = false;

INSERT INTO planes (
    nombre, codigo, orden,
    agentes_incluidos, medicos_incluidos, credito_ia_usd,
    precio_mensual_usd, precio_anual_usd,
    precio_agente_extra_usd, precio_medico_extra_usd,
    permite_agentes_extra, es_plan_prueba, activo,
    cupos_agente_medico, presupuesto_usd_incluido, precio_cupo_extra_usd
) VALUES
 ('Básico', 'basico', 1,  1,    2, 10.00,  49.00,  490.00, NULL,  12.00, false, false, true, 0, 0, 0),
 ('Pro',    'pro',    2,  3,    5, 15.00,  99.00,  990.00, NULL,  12.00, false, false, true, 0, 0, 0),
 ('Max',    'max',    3,  5,   10, 25.00, 149.00, 1490.00, 25.00, 12.00, true,  false, true, 0, 0, 0),
 ('Full',   'full',   4, NULL, 20, 50.00, 249.00, 2490.00, NULL,  12.00, false, false, true, 0, 0, 0);

-- Las tres columnas heredadas se llenan en cero porque siguen siendo NOT NULL
-- hasta que la migración 026 las elimine.


-- ---------------------------------------------------------------------
-- 2. PAÍSES
-- ---------------------------------------------------------------------

INSERT INTO paises (codigo_iso, nombre, idioma_default) VALUES
 ('CR','Costa Rica','es'), ('PA','Panamá','es'), ('GT','Guatemala','es'),
 ('HN','Honduras','es'),   ('SV','El Salvador','es'), ('NI','Nicaragua','es'),
 ('DO','República Dominicana','es')
ON CONFLICT (codigo_iso) DO NOTHING;

-- Sólo Costa Rica queda habilitado. El resto entra como lista de espera:
-- habilitarlos exige confirmar tasa impositiva, tipos de identificación,
-- cobertura de la pasarela y proveedor de comprobante electrónico.
UPDATE paises
   SET estado = 'habilitado',
       moneda_cotizacion = 'USD',
       moneda_liquidacion = 'CRC',
       pasarela_codigo = 'tilopay'
 WHERE codigo_iso = 'CR';

UPDATE paises
   SET estado = 'lista_espera',
       moneda_cotizacion = 'USD',
       pasarela_codigo = 'tilopay'
 WHERE codigo_iso IN ('PA','GT','HN','SV','NI','DO');


-- Impuesto de Costa Rica. Verificar la tasa vigente antes de producción.
INSERT INTO impuestos_pais (pais_codigo, nombre, tasa, vigente_desde)
VALUES ('CR', 'IVA', 0.1300, DATE '2024-01-01');


-- Tipos de identificación de Costa Rica
INSERT INTO tipos_identificacion
  (pais_codigo, codigo, etiqueta, aplica_persona_fisica, aplica_persona_juridica, orden)
VALUES
 ('CR','01','Cédula de identidad',  true,  false, 1),
 ('CR','02','Cédula jurídica',      false, true,  2),
 ('CR','03','DIMEX',                true,  false, 3),
 ('CR','04','NITE',                 false, true,  4),
 ('CR','05','Pasaporte',            true,  false, 5);


-- ---------------------------------------------------------------------
-- 3. PAQUETES DE RECARGA
-- ---------------------------------------------------------------------

INSERT INTO paquetes_recarga (nombre, monto_pagado_usd, credito_acreditado_usd, es_minimo, orden)
VALUES
 ('Recarga mínima', 25.00,  25.00, true,  1),
 ('Recarga media',  50.00,  55.00, false, 2),
 ('Recarga grande', 100.00, 115.00, false, 3);


-- ---------------------------------------------------------------------
-- 4. TARIFAS POR TOKEN
--
-- Se generan filas para cada modelo ya presente en uso_api, con precio
-- en cero. Deben cargarse los precios reales desde administración de
-- plataforma antes de que el motor calcule consumo.
-- ---------------------------------------------------------------------

INSERT INTO tarifas_modelo (modelo, tipo_token, precio_usd_por_millon, vigente_desde)
SELECT DISTINCT u.modelo, t.tipo, 0, now()
  FROM uso_api u
 CROSS JOIN (VALUES ('entrada'),('salida'),('cache_escritura'),('cache_lectura')) AS t(tipo)
 WHERE u.modelo IS NOT NULL
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------
-- 5. SUSCRIPCIONES — trece tenants activos, repartidos entre los planes
-- ---------------------------------------------------------------------

WITH reparto AS (
    SELECT t.id AS tenant_id,
           (ROW_NUMBER() OVER (ORDER BY t.creado_en, t.nombre) - 1) % 4 AS grupo
      FROM tenants t
), asignacion AS (
    SELECT r.tenant_id,
           p.id  AS plan_id,
           p.precio_mensual_usd,
           p.credito_ia_usd,
           p.agentes_incluidos,
           p.medicos_incluidos
      FROM reparto r
      JOIN planes p ON p.orden = r.grupo + 1 AND p.activo = true
)
INSERT INTO suscripciones (
    tenant_id, plan_id, periodicidad,
    precio_pactado_usd, credito_pactado_usd,
    agentes_contratados, medicos_contratados,
    estado, periodo_inicio, periodo_fin, proximo_cobro_en
)
SELECT a.tenant_id, a.plan_id, 'mensual',
       a.precio_mensual_usd, a.credito_ia_usd,
       a.agentes_incluidos, a.medicos_incluidos,
       'activa',
       date_trunc('day', now()),
       date_trunc('day', now()) + interval '1 month',
       date_trunc('day', now()) + interval '1 month'
  FROM asignacion a;


-- Enlace desde tenants y normalización del estado
UPDATE tenants t
   SET suscripcion_id      = s.id,
       estado_suscripcion  = 'activa',
       plan_id             = s.plan_id
  FROM suscripciones s
 WHERE s.tenant_id = t.id
   AND s.estado = 'activa';

-- Datos fiscales mínimos para los tenants existentes
UPDATE tenants
   SET pais_codigo   = COALESCE(pais_codigo, 'CR'),
       tipo_persona  = COALESCE(tipo_persona, 'juridica'),
       nombre_fiscal = COALESCE(nombre_fiscal, nombre);

UPDATE tenants t
   SET tipo_identificacion_id = ti.id
  FROM tipos_identificacion ti
 WHERE ti.pais_codigo = 'CR'
   AND ti.codigo = '02'
   AND t.tipo_identificacion_id IS NULL
   AND t.tipo_persona = 'juridica';


-- ---------------------------------------------------------------------
-- 6. SALDOS Y MOVIMIENTOS INICIALES
-- ---------------------------------------------------------------------

INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd)
SELECT s.tenant_id, s.credito_pactado_usd, 0
  FROM suscripciones s
 WHERE s.estado = 'activa'
ON CONFLICT (tenant_id) DO UPDATE
   SET credito_plan_usd = EXCLUDED.credito_plan_usd,
       actualizado_en   = now();

INSERT INTO movimientos_credito (
    tenant_id, tipo, bolsa, monto_usd,
    referencia_tabla, referencia_id,
    saldo_plan_post, saldo_comprado_post, descripcion
)
SELECT s.tenant_id, 'otorgamiento_plan', 'plan', s.credito_pactado_usd,
       'suscripciones', s.id,
       s.credito_pactado_usd, 0,
       'Crédito inicial del período por alta de suscripción'
  FROM suscripciones s
 WHERE s.estado = 'activa';


-- ---------------------------------------------------------------------
-- 7. CONFIGURACIÓN DE RECARGA POR CLÍNICA
-- ---------------------------------------------------------------------

INSERT INTO config_recarga (tenant_id, autorecarga_activa, umbral_usd, paquete_id)
SELECT t.id, true, 5.00, (SELECT id FROM paquetes_recarga WHERE es_minimo LIMIT 1)
  FROM tenants t
ON CONFLICT (tenant_id) DO NOTHING;

-- El tope mensual de recargas hereda el límite propio ya configurado
UPDATE config_recarga c
   SET tope_mensual_recargas_usd = t.limite_usd_configurado
  FROM tenants t
 WHERE t.id = c.tenant_id
   AND t.limite_usd_configurado IS NOT NULL;


-- ---------------------------------------------------------------------
-- 8. ENTITLEMENTS — marca de período para el freno anti-rotación
-- ---------------------------------------------------------------------

UPDATE tenant_agentes ta
   SET habilitado_en = COALESCE(habilitado_en, ta.creado_en),
       periodo_ultimo_cambio = s.periodo_inicio
  FROM suscripciones s
 WHERE s.tenant_id = ta.tenant_id
   AND s.estado = 'activa';

COMMIT;


-- =====================================================================
-- VERIFICACIÓN
-- =====================================================================

\echo '=== Catálogo de planes ==='
SELECT codigo, nombre, agentes_incluidos, medicos_incluidos,
       credito_ia_usd, precio_mensual_usd, precio_anual_usd
  FROM planes WHERE activo = true ORDER BY orden;

\echo '=== Suscripciones creadas ==='
SELECT t.nombre AS clinica, p.codigo AS plan, s.estado,
       s.precio_pactado_usd, s.credito_pactado_usd,
       s.agentes_contratados, s.medicos_contratados,
       s.periodo_fin::date
  FROM suscripciones s
  JOIN tenants t ON t.id = s.tenant_id
  JOIN planes  p ON p.id = s.plan_id
 ORDER BY p.orden, t.nombre;

\echo '=== Saldos iniciales ==='
SELECT t.nombre, sa.credito_plan_usd, sa.credito_comprado_usd
  FROM saldos_ia sa JOIN tenants t ON t.id = sa.tenant_id
 ORDER BY t.nombre;

\echo '=== Tenants que exceden el cupo de agentes de su plan ==='
SELECT t.nombre, p.codigo AS plan, s.agentes_contratados AS permitidos,
       count(ta.id) AS habilitados
  FROM tenants t
  JOIN suscripciones s ON s.tenant_id = t.id AND s.estado = 'activa'
  JOIN planes p ON p.id = s.plan_id
  LEFT JOIN tenant_agentes ta ON ta.tenant_id = t.id AND ta.estado = 'habilitado'
 GROUP BY t.nombre, p.codigo, s.agentes_contratados
HAVING s.agentes_contratados IS NOT NULL
   AND count(ta.id) > s.agentes_contratados
 ORDER BY t.nombre;

\echo '=== Tenants que exceden el cupo de medicos de su plan ==='
SELECT t.nombre, p.codigo AS plan, s.medicos_contratados AS permitidos,
       count(pe.id) AS activos
  FROM tenants t
  JOIN suscripciones s ON s.tenant_id = t.id AND s.estado = 'activa'
  JOIN planes p ON p.id = s.plan_id
  LEFT JOIN personas pe ON pe.tenant_id = t.id AND pe.estado = 'activo' AND pe.es_medico = true
 GROUP BY t.nombre, p.codigo, s.medicos_contratados
HAVING count(pe.id) > s.medicos_contratados
 ORDER BY t.nombre;

\echo '=== Tarifas por token pendientes de precio ==='
SELECT modelo, tipo_token, precio_usd_por_millon
  FROM tarifas_modelo
 WHERE vigente_hasta IS NULL AND precio_usd_por_millon = 0
 ORDER BY modelo, tipo_token;
