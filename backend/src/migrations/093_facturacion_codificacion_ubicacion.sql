-- Codificación oficial de ubicación de Hacienda: provincia, cantón,
-- distrito y barrio (`Codificacionubicacion_V4.4.xlsx`).
--
-- Hasta acá los tres campos de ubicación del emisor y del receptor se
-- validaban SOLO POR FORMATO: `^[1-9]$`, `^[0-9]{2}$`, `^[0-9]{2}$`. O
-- sea, la provincia 9 cantón 99 distrito 99 pasaba, y el rechazo
-- llegaba desde Hacienda después de firmar y enviar. Con estas tablas
-- se valida contra la lista real.
--
-- SON CUATRO TABLAS Y NO UNA porque la jerarquía es real: el cantón 01
-- de San José y el cantón 01 de Limón son cantones distintos. Con una
-- tabla plana de 7 087 filas no habría forma de poner la clave foránea
-- de un distrito sin repetir el nombre de la provincia en cada fila.
--
-- BARRIO NO TIENE CLAVE FORÁNEA, y no es un olvido: en la versión 4.4
-- el campo `Barrio` del XML es TEXTO LIBRE de 5 a 50 caracteres, no un
-- código (cambió respecto de 4.3). La tabla se carga igual porque sirve
-- para sugerir en la pantalla, pero atarla con una FK le pondría al
-- emisor una restricción que el XSD no tiene.
--
-- Sin RLS y sin `tenant_id`, como el resto de los `fact_cat_*`: es la
-- misma lista para todas las clínicas.

CREATE TABLE fact_cat_provincia (
  codigo VARCHAR(1) PRIMARY KEY CHECK (codigo ~ '^[1-9]$'),
  nombre VARCHAR(80) NOT NULL
);

CREATE TABLE fact_cat_canton (
  provincia VARCHAR(1) NOT NULL REFERENCES fact_cat_provincia(codigo),
  codigo    VARCHAR(2) NOT NULL CHECK (codigo ~ '^[0-9]{2}$'),
  nombre    VARCHAR(80) NOT NULL,
  PRIMARY KEY (provincia, codigo)
);

CREATE TABLE fact_cat_distrito (
  provincia VARCHAR(1) NOT NULL,
  canton    VARCHAR(2) NOT NULL,
  codigo    VARCHAR(2) NOT NULL CHECK (codigo ~ '^[0-9]{2}$'),
  nombre    VARCHAR(80) NOT NULL,
  PRIMARY KEY (provincia, canton, codigo),
  FOREIGN KEY (provincia, canton) REFERENCES fact_cat_canton(provincia, codigo)
);

CREATE TABLE fact_cat_barrio (
  provincia VARCHAR(1)  NOT NULL,
  canton    VARCHAR(2)  NOT NULL,
  distrito  VARCHAR(2)  NOT NULL,
  codigo    VARCHAR(2)  NOT NULL CHECK (codigo ~ '^[0-9]{2}$'),
  nombre    VARCHAR(120) NOT NULL,
  PRIMARY KEY (provincia, canton, distrito, codigo),
  FOREIGN KEY (provincia, canton, distrito)
    REFERENCES fact_cat_distrito(provincia, canton, codigo)
);

-- Búsqueda del barrio por nombre para la pantalla, tolerante a acentos
-- y a errores de tipeo. Mismo mecanismo que la búsqueda de CABYS y que
-- la migración 090: trigramas sobre el texto sin acentos.
CREATE INDEX idx_fact_cat_barrio_nombre_trgm
  ON fact_cat_barrio USING gin (inmutable_unaccent(nombre) gin_trgm_ops);

CREATE INDEX idx_fact_cat_distrito_nombre_trgm
  ON fact_cat_distrito USING gin (inmutable_unaccent(nombre) gin_trgm_ops);

-- ---------------------------------------------------------------------
-- La ubicación del EMISOR ahora tiene que existir en la codificación.
--
-- VA COMO `NOT VALID`, y no por debilidad: las tablas de arriba quedan
-- VACÍAS al terminar esta migración, porque la codificación se carga
-- después, desde la planilla oficial, con `npm run cargar-catalogos-fe`.
-- Una FK validada contra una tabla vacía rechazaría al emisor que ya
-- existe, y la migración no podría aplicarse nunca.
--
-- `NOT VALID` NO significa "no se aplica": Postgres la exige igual en
-- todo INSERT y UPDATE desde este momento. Lo único que no hace es
-- revisar las filas viejas. Esa revisión la cierra el comando de
-- catálogos con un VALIDATE CONSTRAINT, apenas la lista existe — ver
-- `validarRestriccionesDeUbicacion` en facturacion/ubicacion.ts.
-- ---------------------------------------------------------------------
ALTER TABLE fact_emisores
  ADD CONSTRAINT fact_emisores_ubicacion_fkey
  FOREIGN KEY (ubicacion_provincia, ubicacion_canton, ubicacion_distrito)
  REFERENCES fact_cat_distrito(provincia, canton, codigo) NOT VALID;

-- La del RECEPTOR, igual, pero los tres campos son opcionales (un
-- tiquete puede no identificar al receptor, y un receptor extranjero no
-- tiene ubicación de Costa Rica). Con MATCH SIMPLE —el default— una FK
-- compuesta con cualquier columna en NULL se da por satisfecha, que es
-- exactamente lo que hace falta acá: o están los tres y son válidos, o
-- no están.
ALTER TABLE fact_comprobantes
  ADD CONSTRAINT fact_comprobantes_receptor_ubicacion_fkey
  FOREIGN KEY (receptor_ubicacion_provincia, receptor_ubicacion_canton,
               receptor_ubicacion_distrito)
  REFERENCES fact_cat_distrito(provincia, canton, codigo) NOT VALID;
