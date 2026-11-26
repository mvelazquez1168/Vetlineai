-- ---------------------------------------------------------------------
-- 112 — Los valores iniciales de los catálogos clínicos
--
-- Van en su propia migración y al final de la 111 a propósito: los
-- INSERT con una FK diferida dejan eventos de disparador pendientes, y
-- Postgres rechaza un ALTER TABLE sobre una tabla que los tenga. Ya
-- costó una corrida en la migración 108.
--
-- Son valores DE LA PLATAFORMA (tenant_id NULL): toda clínica los ve
-- hasta que define los suyos. Una clínica que agrega "mucosas
-- grisáceas" crea su propia fila y no toca estas.
-- ---------------------------------------------------------------------

INSERT INTO exp_catalogos_clinicos (tenant_id, tipo, codigo, etiqueta, horas, orden)
SELECT NULL, v.tipo, v.codigo, v.etiqueta, v.horas, v.orden
FROM (VALUES
  -- Mucosas
  ('mucosas', 'rosadas',     'Rosadas',     NULL::numeric, 10),
  ('mucosas', 'palidas',     'Pálidas',     NULL::numeric, 20),
  ('mucosas', 'ictericas',   'Ictéricas',   NULL::numeric, 30),
  ('mucosas', 'cianoticas',  'Cianóticas',  NULL::numeric, 40),
  ('mucosas', 'congestivas', 'Congestivas', NULL::numeric, 50),

  -- Hidratación
  ('hidratacion', 'normal',   'Normal',                   NULL::numeric, 10),
  ('hidratacion', 'leve',     'Deshidratación leve',      NULL::numeric, 20),
  ('hidratacion', 'moderada', 'Deshidratación moderada',  NULL::numeric, 30),
  ('hidratacion', 'severa',   'Deshidratación severa',    NULL::numeric, 40),

  -- Actitud
  ('actitud', 'alerta',     'Alerta',     NULL::numeric, 10),
  ('actitud', 'deprimido',  'Deprimido',  NULL::numeric, 20),
  ('actitud', 'letargico',  'Letárgico',  NULL::numeric, 30),
  ('actitud', 'estuporoso', 'Estuporoso', NULL::numeric, 40),

  -- Dolor. La escala es 0 a 10 y acá van los tramos con nombre, que es
  -- lo que el médico dice en voz alta.
  ('dolor', '0', 'Sin dolor',      NULL::numeric, 10),
  ('dolor', '2', 'Leve',           NULL::numeric, 20),
  ('dolor', '5', 'Moderado',       NULL::numeric, 30),
  ('dolor', '8', 'Severo',         NULL::numeric, 40),
  ('dolor', '10', 'Insoportable',  NULL::numeric, 50),

  -- LA REVISIÓN POR SISTEMAS. Trece sistemas, en el orden en que se
  -- examina: de lo general a lo particular.
  ('sistema_examen', 'apariencia',    'Apariencia general',  NULL::numeric, 10),
  ('sistema_examen', 'cardiovascular', 'Cardiovascular',     NULL::numeric, 20),
  ('sistema_examen', 'respiratorio',  'Respiratorio',        NULL::numeric, 30),
  ('sistema_examen', 'digestivo',     'Digestivo',           NULL::numeric, 40),
  ('sistema_examen', 'urinario',      'Urinario',            NULL::numeric, 50),
  ('sistema_examen', 'reproductor',   'Reproductor',         NULL::numeric, 60),
  ('sistema_examen', 'nervioso',      'Nervioso',            NULL::numeric, 70),
  ('sistema_examen', 'locomotor',     'Locomotor',           NULL::numeric, 80),
  ('sistema_examen', 'dermatologico', 'Dermatológico',       NULL::numeric, 90),
  ('sistema_examen', 'ocular',        'Ocular',              NULL::numeric, 100),
  ('sistema_examen', 'otico',         'Ótico',               NULL::numeric, 110),
  ('sistema_examen', 'linfatico',     'Linfático',           NULL::numeric, 120),
  ('sistema_examen', 'hematologico',  'Hematológico',        NULL::numeric, 130),

  -- Vías de administración
  ('via_administracion', 'oral',          'Oral',                NULL::numeric, 10),
  ('via_administracion', 'subcutanea',    'Subcutánea',          NULL::numeric, 20),
  ('via_administracion', 'intramuscular', 'Intramuscular',       NULL::numeric, 30),
  ('via_administracion', 'intravenosa',   'Intravenosa',         NULL::numeric, 40),
  ('via_administracion', 'topica',        'Tópica',              NULL::numeric, 50),
  ('via_administracion', 'oftalmica',     'Oftálmica',           NULL::numeric, 60),
  ('via_administracion', 'otica',         'Ótica',               NULL::numeric, 70),
  ('via_administracion', 'rectal',        'Rectal',              NULL::numeric, 80),
  ('via_administracion', 'inhalatoria',   'Inhalatoria',         NULL::numeric, 90),

  -- FRECUENCIAS, con sus horas: de ahí sale el texto legible y la
  -- cantidad total a dispensar.
  ('frecuencia', 'c4h',   'Cada 4 horas',    4,    10),
  ('frecuencia', 'c6h',   'Cada 6 horas',    6,    20),
  ('frecuencia', 'c8h',   'Cada 8 horas',    8,    30),
  ('frecuencia', 'c12h',  'Cada 12 horas',   12,   40),
  ('frecuencia', 'c24h',  'Cada 24 horas',   24,   50),
  ('frecuencia', 'c48h',  'Cada 48 horas',   48,   60),
  ('frecuencia', 'semanal', 'Una vez por semana', 168, 70),
  ('frecuencia', 'unica', 'Dosis única',     NULL::numeric, 80),
  ('frecuencia', 'prn',   'Según necesidad', NULL::numeric, 90),

  -- Unidades de dosis
  ('unidad_dosis', 'mg',      'mg',       NULL::numeric, 10),
  ('unidad_dosis', 'ml',      'ml',       NULL::numeric, 20),
  ('unidad_dosis', 'tableta', 'tableta',  NULL::numeric, 30),
  ('unidad_dosis', 'capsula', 'cápsula',  NULL::numeric, 40),
  ('unidad_dosis', 'gota',    'gota',     NULL::numeric, 50),
  ('unidad_dosis', 'ui',      'UI',       NULL::numeric, 60),
  ('unidad_dosis', 'aplicacion', 'aplicación', NULL::numeric, 70),

  -- Carácter del paciente
  ('caracter', 'docil',    'Dócil',    NULL::numeric, 10),
  ('caracter', 'nervioso', 'Nervioso', NULL::numeric, 20),
  ('caracter', 'temeroso', 'Temeroso', NULL::numeric, 30),
  ('caracter', 'agresivo', 'Agresivo', NULL::numeric, 40),

  -- Hábitat y dieta
  ('habitat', 'interior', 'Interior',            NULL::numeric, 10),
  ('habitat', 'exterior', 'Exterior',            NULL::numeric, 20),
  ('habitat', 'mixto',    'Interior y exterior', NULL::numeric, 30),

  ('tipo_dieta', 'balanceado',  'Alimento balanceado', NULL::numeric, 10),
  ('tipo_dieta', 'casera',      'Comida casera',       NULL::numeric, 20),
  ('tipo_dieta', 'mixta',       'Mixta',               NULL::numeric, 30),
  ('tipo_dieta', 'medicada',    'Dieta medicada',      NULL::numeric, 40),
  ('tipo_dieta', 'cruda',       'Cruda (BARF)',        NULL::numeric, 50),

  -- Pelaje, complementario al color que ya existe
  ('pelaje', 'corto',   'Corto',    NULL::numeric, 10),
  ('pelaje', 'mediano', 'Mediano',  NULL::numeric, 20),
  ('pelaje', 'largo',   'Largo',    NULL::numeric, 30),
  ('pelaje', 'rizado',  'Rizado',   NULL::numeric, 40),
  ('pelaje', 'lampino', 'Lampiño',  NULL::numeric, 50),

  -- Motivos de baja
  ('motivo_baja', 'fallecimiento',  'Falleció',                 NULL::numeric, 10),
  ('motivo_baja', 'extravio',       'Se extravió',              NULL::numeric, 20),
  ('motivo_baja', 'transferencia',  'Cambió de dueño o clínica', NULL::numeric, 30),
  ('motivo_baja', 'otro',           'Otro',                     NULL::numeric, 40)
) AS v(tipo, codigo, etiqueta, horas, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM exp_catalogos_clinicos c
   WHERE c.tenant_id IS NULL AND c.tipo = v.tipo AND c.codigo = v.codigo
);

-- ---------------------------------------------------------------------
-- LA PLANTILLA DE CONSULTA GENERAL pasa a usar los trece sistemas del
-- anexo, por su etiqueta.
--
-- La plantilla guarda nombres de sistema y no códigos: así una clínica
-- puede tener su propia lista sin que la plantilla de la plataforma
-- apunte a códigos que no existen. El examen ya guarda el nombre.
-- ---------------------------------------------------------------------

UPDATE exp_plantillas_atencion
   SET sistemas = ARRAY[
         'Apariencia general', 'Cardiovascular', 'Respiratorio', 'Digestivo',
         'Urinario', 'Reproductor', 'Nervioso', 'Locomotor', 'Dermatológico',
         'Ocular', 'Ótico', 'Linfático', 'Hematológico'
       ]
 WHERE tenant_id IS NULL AND tipo_consulta = 'consulta_general';
