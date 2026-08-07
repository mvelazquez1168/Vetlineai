-- =====================================================================
-- VetPlatform — Migración 002 (Fase A de la continuación post-scaffolding)
-- Tres cambios independientes:
--   1. Control de acceso por médico a agentes (medico_agente.habilitado).
--   2. Catálogo de países (reemplaza tenants.pais de texto libre).
--   3. Documentos de la Base de Conocimiento.
-- Además: staff_plataforma.rol gana 'soporte_senior' — es un requisito
-- estructural de los endpoints de Base de Conocimiento (Fase B.3), que
-- necesitan distinguir "soporte" de "soporte_senior" para el 403; el CHECK
-- original de 001_init.sql solo contemplaba 'super_admin' y 'soporte'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Control de acceso por médico a agentes
-- ---------------------------------------------------------------------
ALTER TABLE medico_agente ADD COLUMN habilitado BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------
-- 2. Catálogo de países (ISO 3166-1 alpha-2, nombres en español)
-- ---------------------------------------------------------------------
CREATE TABLE paises (
    codigo_iso      CHAR(2) PRIMARY KEY,
    nombre          VARCHAR NOT NULL,
    idioma_default  VARCHAR NOT NULL DEFAULT 'es'
);

INSERT INTO paises (codigo_iso, nombre) VALUES
  -- África
  ('DZ', 'Argelia'), ('AO', 'Angola'), ('BJ', 'Benín'), ('BW', 'Botsuana'),
  ('BF', 'Burkina Faso'), ('BI', 'Burundi'), ('CV', 'Cabo Verde'), ('CM', 'Camerún'),
  ('CF', 'República Centroafricana'), ('TD', 'Chad'), ('KM', 'Comoras'),
  ('CG', 'República del Congo'), ('CD', 'República Democrática del Congo'),
  ('CI', 'Costa de Marfil'), ('DJ', 'Yibuti'), ('EG', 'Egipto'),
  ('GQ', 'Guinea Ecuatorial'), ('ER', 'Eritrea'), ('SZ', 'Esuatini'),
  ('ET', 'Etiopía'), ('GA', 'Gabón'), ('GM', 'Gambia'), ('GH', 'Ghana'),
  ('GN', 'Guinea'), ('GW', 'Guinea-Bisáu'), ('KE', 'Kenia'), ('LS', 'Lesoto'),
  ('LR', 'Liberia'), ('LY', 'Libia'), ('MG', 'Madagascar'), ('MW', 'Malaui'),
  ('ML', 'Malí'), ('MA', 'Marruecos'), ('MU', 'Mauricio'), ('MR', 'Mauritania'),
  ('MZ', 'Mozambique'), ('NA', 'Namibia'), ('NE', 'Níger'), ('NG', 'Nigeria'),
  ('RW', 'Ruanda'), ('SN', 'Senegal'), ('SC', 'Seychelles'), ('SL', 'Sierra Leona'),
  ('SO', 'Somalia'), ('ZA', 'Sudáfrica'), ('SS', 'Sudán del Sur'), ('SD', 'Sudán'),
  ('ST', 'Santo Tomé y Príncipe'), ('TZ', 'Tanzania'), ('TG', 'Togo'),
  ('TN', 'Túnez'), ('UG', 'Uganda'), ('ZM', 'Zambia'), ('ZW', 'Zimbabue'),

  -- América
  ('AG', 'Antigua y Barbuda'), ('AR', 'Argentina'), ('BS', 'Bahamas'),
  ('BB', 'Barbados'), ('BZ', 'Belice'), ('BO', 'Bolivia'), ('BR', 'Brasil'),
  ('CA', 'Canadá'), ('CL', 'Chile'), ('CO', 'Colombia'), ('CR', 'Costa Rica'),
  ('CU', 'Cuba'), ('DM', 'Dominica'), ('EC', 'Ecuador'), ('SV', 'El Salvador'),
  ('US', 'Estados Unidos'), ('GD', 'Granada'), ('GT', 'Guatemala'), ('GY', 'Guyana'),
  ('HT', 'Haití'), ('HN', 'Honduras'), ('JM', 'Jamaica'), ('MX', 'México'),
  ('NI', 'Nicaragua'), ('PA', 'Panamá'), ('PY', 'Paraguay'), ('PE', 'Perú'),
  ('DO', 'República Dominicana'), ('KN', 'San Cristóbal y Nieves'),
  ('LC', 'Santa Lucía'), ('VC', 'San Vicente y las Granadinas'), ('SR', 'Surinam'),
  ('TT', 'Trinidad y Tobago'), ('UY', 'Uruguay'), ('VE', 'Venezuela'),

  -- Asia
  ('AF', 'Afganistán'), ('SA', 'Arabia Saudita'), ('AM', 'Armenia'),
  ('AZ', 'Azerbaiyán'), ('BH', 'Baréin'), ('BD', 'Bangladés'), ('BT', 'Bután'),
  ('MM', 'Birmania (Myanmar)'), ('BN', 'Brunéi'), ('KH', 'Camboya'), ('QA', 'Catar'),
  ('CN', 'China'), ('CY', 'Chipre'), ('KP', 'Corea del Norte'), ('KR', 'Corea del Sur'),
  ('AE', 'Emiratos Árabes Unidos'), ('PH', 'Filipinas'), ('GE', 'Georgia'),
  ('IN', 'India'), ('ID', 'Indonesia'), ('IQ', 'Irak'), ('IR', 'Irán'),
  ('IL', 'Israel'), ('JP', 'Japón'), ('JO', 'Jordania'), ('KZ', 'Kazajistán'),
  ('KG', 'Kirguistán'), ('KW', 'Kuwait'), ('LA', 'Laos'), ('LB', 'Líbano'),
  ('MY', 'Malasia'), ('MV', 'Maldivas'), ('MN', 'Mongolia'), ('NP', 'Nepal'),
  ('OM', 'Omán'), ('PK', 'Pakistán'), ('PS', 'Palestina'), ('SY', 'Siria'),
  ('LK', 'Sri Lanka'), ('TH', 'Tailandia'), ('TJ', 'Tayikistán'),
  ('TL', 'Timor Oriental'), ('TR', 'Turquía'), ('TM', 'Turkmenistán'),
  ('UZ', 'Uzbekistán'), ('VN', 'Vietnam'), ('YE', 'Yemen'),

  -- Europa
  ('DE', 'Alemania'), ('AD', 'Andorra'), ('AT', 'Austria'), ('BE', 'Bélgica'),
  ('BY', 'Bielorrusia'), ('BA', 'Bosnia y Herzegovina'), ('BG', 'Bulgaria'),
  ('HR', 'Croacia'), ('DK', 'Dinamarca'), ('SK', 'Eslovaquia'), ('SI', 'Eslovenia'),
  ('ES', 'España'), ('EE', 'Estonia'), ('FI', 'Finlandia'), ('FR', 'Francia'),
  ('GR', 'Grecia'), ('HU', 'Hungría'), ('IE', 'Irlanda'), ('IS', 'Islandia'),
  ('IT', 'Italia'), ('LV', 'Letonia'), ('LI', 'Liechtenstein'), ('LT', 'Lituania'),
  ('LU', 'Luxemburgo'), ('MT', 'Malta'), ('MD', 'Moldavia'), ('MC', 'Mónaco'),
  ('ME', 'Montenegro'), ('NO', 'Noruega'), ('NL', 'Países Bajos'), ('PL', 'Polonia'),
  ('PT', 'Portugal'), ('GB', 'Reino Unido'), ('CZ', 'República Checa'),
  ('RO', 'Rumania'), ('RU', 'Rusia'), ('SM', 'San Marino'), ('RS', 'Serbia'),
  ('CH', 'Suiza'), ('SE', 'Suecia'), ('UA', 'Ucrania'), ('VA', 'Ciudad del Vaticano'),
  ('MK', 'Macedonia del Norte'), ('AL', 'Albania'),

  -- Oceanía
  ('AU', 'Australia'), ('FJ', 'Fiyi'), ('KI', 'Kiribati'), ('MH', 'Islas Marshall'),
  ('FM', 'Micronesia'), ('NR', 'Nauru'), ('NZ', 'Nueva Zelanda'), ('PW', 'Palaos'),
  ('PG', 'Papúa Nueva Guinea'), ('WS', 'Samoa'), ('SB', 'Islas Salomón'),
  ('TO', 'Tonga'), ('TV', 'Tuvalu'), ('VU', 'Vanuatu');

ALTER TABLE tenants ADD COLUMN pais_codigo CHAR(2) REFERENCES paises(codigo_iso);

-- Migra el dato existente (texto libre en español) al código ISO, haciendo
-- match contra el nombre ya sembrado en `paises`. Cubre cualquier tenant
-- previo, no solo el "Argentina" del seed de desarrollo.
UPDATE tenants t
SET pais_codigo = p.codigo_iso
FROM paises p
WHERE lower(trim(t.pais)) = lower(p.nombre)
  AND t.pais_codigo IS NULL;

ALTER TABLE tenants DROP COLUMN pais;

-- ---------------------------------------------------------------------
-- 3. Documentos de la Base de Conocimiento
-- ---------------------------------------------------------------------
CREATE TABLE documentos_conocimiento (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre              VARCHAR NOT NULL,
    descripcion         VARCHAR,
    tipo                VARCHAR NOT NULL
                            CHECK (tipo IN ('banderas_rojas', 'breed_intelligence',
                                             'farmacoterapia', 'nutricion', 'otro')),
    agente_id           UUID REFERENCES agentes(id) ON DELETE CASCADE,
                            -- NULL = compartido por todos los agentes
    archivo_ref         VARCHAR NOT NULL,
    version             VARCHAR NOT NULL DEFAULT '1.0',
    estado              VARCHAR NOT NULL DEFAULT 'activo'
                            CHECK (estado IN ('activo', 'archivado')),
    cargado_por         UUID REFERENCES staff_plataforma(id),
    fecha_carga         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Esta tabla NO lleva RLS por tenant_id (no tiene) — el acceso se controla
-- por rol de staff_plataforma en el middleware del backend, no a nivel de
-- fila (igual que agentes y staff_plataforma en 001_init.sql).

CREATE INDEX idx_documentos_conocimiento_agente ON documentos_conocimiento(agente_id);

-- ---------------------------------------------------------------------
-- 4. staff_plataforma: agrega el rol 'soporte_senior'
--    (ver nota al comienzo del archivo)
-- ---------------------------------------------------------------------
ALTER TABLE staff_plataforma DROP CONSTRAINT staff_plataforma_rol_check;
ALTER TABLE staff_plataforma ADD CONSTRAINT staff_plataforma_rol_check
  CHECK (rol IN ('super_admin', 'soporte_senior', 'soporte'));
