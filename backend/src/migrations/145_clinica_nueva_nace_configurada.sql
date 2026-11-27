-- ---------------------------------------------------------------------
-- 145 — UNA CLÍNICA NUEVA NACE CONFIGURADA (prompt 04, §3)
--
-- DEFECTO DE LA 144, encontrado por el verificador: la semilla del
-- horario y de los feriados es un `INSERT … SELECT FROM tenants`, o sea
-- que corrió **una vez, para las clínicas que existían ese día**. La que
-- se registre mañana nace sin horario, sin feriados, sin tipos de cita y
-- sin numeraciones.
--
-- Es la tercera vez que aparece la misma forma de defecto —los topes de
-- descuento del 08b y los roles de la 143— y por eso se arregla igual
-- que la 143: **en la base, con un disparador**, y no en el registro
-- público. Si se arregla en el registro, el camino que alguien escriba
-- el mes que viene (una clínica creada desde la plataforma, una
-- migración de datos, una clínica de demostración) vuelve a nacer vacía.
--
-- SOBRE LOS FERIADOS: la 144 los trae escritos adentro del INSERT, así
-- que para que el disparador los copie hacen falta en una tabla. Se crea
-- `feriados_catalogo` y **desde acá esa tabla es la única fuente**: la
-- lista de la 144 queda como lo que es, el registro histórico de una
-- migración ya aplicada. Cargar el año que viene es insertar en el
-- catálogo, y cada clínica nueva se lo lleva.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- EL CATÁLOGO DE FERIADOS, por país.
--
-- Es de plataforma y no por clínica: el 25 de diciembre no cambia de
-- fecha según la clínica. Lo que sí es de cada clínica es **si lo
-- trabaja**, y eso ya vive en `clinica_excepciones.bloquea`.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feriados_catalogo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pais_codigo VARCHAR(2) NOT NULL,
  fecha       DATE NOT NULL,
  nombre      VARCHAR(120) NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feriados_catalogo
  ON feriados_catalogo (pais_codigo, fecha, nombre);

COMMENT ON TABLE feriados_catalogo IS
  'Feriados por país, fuente única de la semilla de clinica_excepciones. Que una clínica los trabaje o no se decide en clinica_excepciones.bloquea (prompt 04, §3).';

-- Los de Costa Rica, 2026 y 2027, en su fecha de calendario. Los que la
-- ley 2412 traslada a lunes quedan en su fecha original y la clínica los
-- mueve: trasladarlos acá exigiría implementar la regla de traslado de
-- cada año, y equivocarse es cerrar la clínica un día que abría.
INSERT INTO feriados_catalogo (pais_codigo, fecha, nombre)
VALUES
  ('CR', '2026-01-01', 'Año nuevo'),
  ('CR', '2026-04-02', 'Jueves Santo'),
  ('CR', '2026-04-03', 'Viernes Santo'),
  ('CR', '2026-04-11', 'Día de Juan Santamaría'),
  ('CR', '2026-05-01', 'Día del Trabajador'),
  ('CR', '2026-07-25', 'Anexión del Partido de Nicoya'),
  ('CR', '2026-08-02', 'Día de la Virgen de los Ángeles'),
  ('CR', '2026-08-15', 'Día de la Madre'),
  ('CR', '2026-08-31', 'Día de la Persona Negra y la Cultura Afrocostarricense'),
  ('CR', '2026-09-15', 'Día de la Independencia'),
  ('CR', '2026-12-01', 'Día de las Culturas'),
  ('CR', '2026-12-25', 'Navidad'),
  ('CR', '2027-01-01', 'Año nuevo'),
  ('CR', '2027-03-25', 'Jueves Santo'),
  ('CR', '2027-03-26', 'Viernes Santo'),
  ('CR', '2027-04-11', 'Día de Juan Santamaría'),
  ('CR', '2027-05-01', 'Día del Trabajador'),
  ('CR', '2027-07-25', 'Anexión del Partido de Nicoya'),
  ('CR', '2027-08-02', 'Día de la Virgen de los Ángeles'),
  ('CR', '2027-08-15', 'Día de la Madre'),
  ('CR', '2027-08-31', 'Día de la Persona Negra y la Cultura Afrocostarricense'),
  ('CR', '2027-09-15', 'Día de la Independencia'),
  ('CR', '2027-12-01', 'Día de las Culturas'),
  ('CR', '2027-12-25', 'Navidad')
ON CONFLICT (pais_codigo, fecha, nombre) DO NOTHING;

-- ---------------------------------------------------------------------
-- LA CONFIGURACIÓN INICIAL DE UNA CLÍNICA.
--
-- Cuatro cosas, y ninguna es una decisión que la clínica no pueda
-- cambiar después:
--
--   * el horario de lunes a viernes de 8 a 17 y sábado de 8 a 12, que es
--     lo que hace una clínica de barrio;
--   * los feriados de su país;
--   * seis tipos de cita con su duración, porque una agenda sin tipos
--     obliga a teclear la duración en cada cita;
--   * las cuatro numeraciones con su prefijo.
--
-- NO SE SIEMBRAN SALAS: una clínica puede tener una o cuatro, y
-- adivinarlo deja basura que alguien tiene que borrar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clinica_configuracion_inicial() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO clinica_horario (tenant_id, dia_semana, bloques, abierto)
  SELECT NEW.id, v.dia, v.bloques::jsonb, v.abierto
    FROM (VALUES
      (0, '[]', false),
      (1, '[{"desde":"08:00","hasta":"17:00"}]', true),
      (2, '[{"desde":"08:00","hasta":"17:00"}]', true),
      (3, '[{"desde":"08:00","hasta":"17:00"}]', true),
      (4, '[{"desde":"08:00","hasta":"17:00"}]', true),
      (5, '[{"desde":"08:00","hasta":"17:00"}]', true),
      (6, '[{"desde":"08:00","hasta":"12:00"}]', true)
    ) AS v(dia, bloques, abierto)
  ON CONFLICT (tenant_id, dia_semana) DO NOTHING;

  -- Los del país de la clínica. Si el país no tiene feriados cargados no
  -- se bloquea el alta: la clínica los carga desde la pantalla.
  INSERT INTO clinica_excepciones (tenant_id, tipo, nombre, desde, hasta, bloquea)
  SELECT NEW.id, 'feriado', f.nombre, f.fecha, f.fecha, true
    FROM feriados_catalogo f
   WHERE f.pais_codigo = COALESCE(NEW.pais_codigo, 'CR');

  INSERT INTO tipos_cita (tenant_id, nombre, duracion_minutos, color, orden)
  SELECT NEW.id, v.nombre, v.minutos, v.color, v.orden
    FROM (VALUES
      ('Consulta general',  30, '#2563eb', 10),
      ('Control',           20, '#0891b2', 20),
      ('Vacunación',        15, '#16a34a', 30),
      ('Desparasitación',   15, '#65a30d', 40),
      ('Cirugía',           90, '#dc2626', 50),
      ('Urgencia',          30, '#ea580c', 60)
    ) AS v(nombre, minutos, color, orden)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  INSERT INTO clinica_numeraciones (tenant_id, documento, prefijo, digitos)
  SELECT NEW.id, v.documento, v.prefijo, v.digitos
    FROM (VALUES
      ('expediente',  'EXP-', 5),
      ('presupuesto', 'PRE-', 5),
      ('recibo',      'REC-', 5),
      ('anticipo',    'ANT-', 5)
    ) AS v(documento, prefijo, digitos)
  ON CONFLICT (tenant_id, documento) DO NOTHING;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clinica_configuracion_inicial ON tenants;
CREATE TRIGGER trg_clinica_configuracion_inicial
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION clinica_configuracion_inicial();

COMMENT ON FUNCTION clinica_configuracion_inicial() IS
  'Siembra horario, feriados del país, tipos de cita y numeraciones al crear una clínica, para que ningún camino de alta la deje sin configurar (prompt 04, §3; defecto de la 144).';

-- ---------------------------------------------------------------------
-- Y las clínicas que ya existen: la 144 les dio horario y feriados, pero
-- nunca hubo semilla de tipos de cita ni de numeraciones (las dos tablas
-- quedaron vacías). Se siembran ahora con la misma lista.
-- ---------------------------------------------------------------------
INSERT INTO tipos_cita (tenant_id, nombre, duracion_minutos, color, orden)
SELECT t.id, v.nombre, v.minutos, v.color, v.orden
  FROM tenants t
  CROSS JOIN (VALUES
    ('Consulta general',  30, '#2563eb', 10),
    ('Control',           20, '#0891b2', 20),
    ('Vacunación',        15, '#16a34a', 30),
    ('Desparasitación',   15, '#65a30d', 40),
    ('Cirugía',           90, '#dc2626', 50),
    ('Urgencia',          30, '#ea580c', 60)
  ) AS v(nombre, minutos, color, orden)
ON CONFLICT (tenant_id, nombre) DO NOTHING;

INSERT INTO clinica_numeraciones (tenant_id, documento, prefijo, digitos)
SELECT t.id, v.documento, v.prefijo, v.digitos
  FROM tenants t
  CROSS JOIN (VALUES
    ('expediente',  'EXP-', 5),
    ('presupuesto', 'PRE-', 5),
    ('recibo',      'REC-', 5),
    ('anticipo',    'ANT-', 5)
  ) AS v(documento, prefijo, digitos)
ON CONFLICT (tenant_id, documento) DO NOTHING;
