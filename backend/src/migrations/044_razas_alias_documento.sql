-- =====================================================================
-- VetPlatform — Migración 044
-- Selección de raza en predisposiciones, Paso 2 del ajuste pedido por el
-- usuario tras el hallazgo de 57,8% de coincidencia: mapeo explícito
-- raza↔sección del documento para las 23 razas que solo difieren en el
-- nombre entre el catálogo (lo que elige el veterinario) y el documento
-- (con el que se escribió su contenido) — mismo patrón que
-- farmacos_equivalencias (tabla dedicada, no una columna en razas: el
-- alias es propiedad de la relación raza↔documento, no de la raza).
-- =====================================================================

CREATE TABLE razas_alias_documento (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raza_id        uuid NOT NULL REFERENCES razas(id) ON DELETE CASCADE,
    documento_id   uuid NOT NULL REFERENCES documentos_conocimiento(id) ON DELETE CASCADE,
    titulo_seccion text NOT NULL,
    nota           text,
    creado_en      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (raza_id, documento_id)
);

-- Las 23 filas de la Lista 1 (solo difieren en el nombre). `nota` solo en
-- las secciones que agrupan más de una raza del catálogo bajo un mismo
-- encabezado — esa nota es la que se le muestra al agente para que no
-- trate el contenido compartido como específico del paciente.
DO $$
DECLARE
  doc_id uuid;
BEGIN
  SELECT id INTO doc_id FROM documentos_conocimiento
   WHERE nombre = 'Predisposiciones Raciales a Enfermedades — Perros y Gatos';

  INSERT INTO razas_alias_documento (raza_id, documento_id, titulo_seccion, nota)
  SELECT r.id, doc_id, m.titulo_seccion, m.nota
  FROM (VALUES
    ('Akita Inu', 'Akita', NULL),
    ('American Staffordshire Terrier', 'American Pit Bull Terrier / Staffordshire Terrier Americano',
      'Esta sección cubre varias razas emparentadas; las predisposiciones listadas no son necesariamente específicas de la raza de este paciente.'),
    ('Boyero Australiano', 'Australian Cattle Dog (Blue Heeler)', NULL),
    ('Boyero de Berna', 'Bernés de la Montaña (Bernese Mountain Dog)', NULL),
    ('Boyero de Flandes', 'Bouvier des Flandres', NULL),
    ('Braco Alemán', 'Braco Alemán de Pelo Corto (German Shorthaired Pointer)',
      'Esta sección cubre varias razas emparentadas; las predisposiciones listadas no son necesariamente específicas de la raza de este paciente.'),
    ('Corgi Galés Cardigan', 'Welsh Corgi Cardigan', NULL),
    ('Corgi Galés Pembroke', 'Welsh Corgi Pembroke', NULL),
    ('Dóberman', 'Dóberman Pinscher', NULL),
    ('Galgo Español', 'Galgo/Whippet/Greyhound',
      'Esta sección cubre varias razas emparentadas; las predisposiciones listadas no son necesariamente específicas de la raza de este paciente.'),
    ('Galgo Inglés', 'Galgo/Whippet/Greyhound',
      'Esta sección cubre varias razas emparentadas; las predisposiciones listadas no son necesariamente específicas de la raza de este paciente.'),
    ('Malamute de Alaska', 'Alaskan Malamute', NULL),
    ('Mastín Tibetano', 'Dogo del Tíbet (Tibetan Mastiff)', NULL),
    ('Pastor Belga Tervueren', 'Pastor Belga (Tervueren / Groenendael)',
      'Esta sección cubre varias razas emparentadas; las predisposiciones listadas no son necesariamente específicas de la raza de este paciente.'),
    ('Perro Chino Crestado', 'Crestado Chino (Chinese Crested)', NULL),
    ('Perro de Agua Portugués', 'Perro de Agua Español / Portugués',
      'Esta sección cubre varias razas emparentadas; las predisposiciones listadas no son necesariamente específicas de la raza de este paciente.'),
    ('Pit Bull Terrier', 'American Pit Bull Terrier / Staffordshire Terrier Americano',
      'Esta sección cubre varias razas emparentadas; las predisposiciones listadas no son necesariamente específicas de la raza de este paciente.'),
    ('Schnauzer Estándar', 'Schnauzer Gigante y Estándar',
      'Esta sección cubre varias razas emparentadas; las predisposiciones listadas no son necesariamente específicas de la raza de este paciente.'),
    ('Setter Gordon', 'Gordon Setter', NULL),
    ('Springer Spaniel', 'English Springer Spaniel', NULL),
    ('Wire Fox Terrier', 'Fox Terrier (Pelo de Alambre y Liso)', NULL),
    ('Angora Turco', 'Turco Van / Turco Angora', NULL),
    ('Van Turco', 'Turco Van / Turco Angora', NULL)
  ) AS m(raza_nombre, titulo_seccion, nota)
  JOIN razas r ON r.nombre = m.raza_nombre;
END $$;
