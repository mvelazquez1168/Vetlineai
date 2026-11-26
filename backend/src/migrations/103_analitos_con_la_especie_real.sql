-- ---------------------------------------------------------------------
-- 103 — Los rangos de laboratorio, con la especie que el sistema usa
--
-- DEFECTO REAL de la migración 101, encontrado al sembrar el paciente de
-- demostración: sembré el catálogo de analitos con la especie escrita
-- como 'perro' y 'gato', y el vocabulario del sistema es **'Canino'** y
-- **'Felino'** (así está en `pacientes.especie` y así lo espera
-- `razaDocumento.ts`, que mapea Canino → "PERROS").
--
-- El efecto habría sido silencioso y grave: `cargarResultados` busca el
-- rango por `(codigo, especie)`, no habría encontrado ninguno, y TODOS
-- los resultados se habrían guardado sin rango y sin bandera. Un valor
-- de creatinina al doble del máximo se vería como un número más.
--
-- No fallaba nada: simplemente no había rangos. Es la clase de defecto
-- que solo aparece cuando se prueba con un paciente de verdad, que es
-- por qué la verificación en el navegador con datos reales es parte del
-- trabajo y no un extra.
--
-- Se insertan los correctos y se borran los de la 101: no hay
-- resultados cargados contra ellos en ninguna clínica real —el catálogo
-- tiene minutos de vida— y dejarlos sería mantener dos vocabularios de
-- especie en la misma tabla.
-- ---------------------------------------------------------------------

INSERT INTO exp_analitos (codigo, nombre, unidad, especie, ref_min, ref_max, grupo, orden) VALUES
  ('HTO',  'Hematocrito',            '%',      'Canino', 37, 55, 'hemograma', 1),
  ('HTO',  'Hematocrito',            '%',      'Felino', 30, 45, 'hemograma', 1),
  ('HB',   'Hemoglobina',            'g/dL',   'Canino', 12, 18, 'hemograma', 2),
  ('HB',   'Hemoglobina',            'g/dL',   'Felino',  8, 15, 'hemograma', 2),
  ('LEU',  'Leucocitos',             '10^3/uL','Canino',  6, 17, 'hemograma', 3),
  ('LEU',  'Leucocitos',             '10^3/uL','Felino', 5.5, 19.5, 'hemograma', 3),
  ('PLQ',  'Plaquetas',              '10^3/uL','Canino', 200, 500, 'hemograma', 4),
  ('PLQ',  'Plaquetas',              '10^3/uL','Felino', 300, 800, 'hemograma', 4),
  ('CREA', 'Creatinina',             'mg/dL',  'Canino', 0.5, 1.5, 'quimica', 10),
  ('CREA', 'Creatinina',             'mg/dL',  'Felino', 0.8, 2.4, 'quimica', 10),
  ('BUN',  'Nitrógeno ureico (BUN)', 'mg/dL',  'Canino',  7, 27, 'quimica', 11),
  ('BUN',  'Nitrógeno ureico (BUN)', 'mg/dL',  'Felino', 16, 36, 'quimica', 11),
  ('ALT',  'ALT',                    'U/L',    'Canino', 10, 100, 'quimica', 12),
  ('ALT',  'ALT',                    'U/L',    'Felino', 20, 100, 'quimica', 12),
  ('FA',   'Fosfatasa alcalina',     'U/L',    'Canino', 23, 212, 'quimica', 13),
  ('FA',   'Fosfatasa alcalina',     'U/L',    'Felino', 14,  71, 'quimica', 13),
  ('GLU',  'Glucosa',                'mg/dL',  'Canino', 70, 120, 'quimica', 14),
  ('GLU',  'Glucosa',                'mg/dL',  'Felino', 70, 150, 'quimica', 14),
  ('ALB',  'Albúmina',               'g/dL',   'Canino', 2.6, 4.0, 'quimica', 15),
  ('ALB',  'Albúmina',               'g/dL',   'Felino', 2.5, 3.9, 'quimica', 15),
  ('T4',   'T4 total',               'ug/dL',  'Felino', 0.8, 4.0, 'endocrino', 20),
  ('DGO',  'Densidad urinaria',      '',       'Canino', 1.015, 1.045, 'urianalisis', 30),
  ('DGO',  'Densidad urinaria',      '',       'Felino', 1.035, 1.060, 'urianalisis', 30)
ON CONFLICT (codigo, especie) DO NOTHING;

DELETE FROM exp_analitos WHERE especie IN ('perro', 'gato');

-- Que no vuelva a entrar una especie que el resto del sistema no usa.
-- Es un CHECK y no una FK porque no hay catálogo de especies: el
-- vocabulario vive en los CHECK de `pacientes` y en el mapeo del
-- documento de predisposiciones.
ALTER TABLE exp_analitos DROP CONSTRAINT IF EXISTS exp_analitos_especie_conocida;
ALTER TABLE exp_analitos
  ADD CONSTRAINT exp_analitos_especie_conocida CHECK (especie IN ('Canino', 'Felino'));
