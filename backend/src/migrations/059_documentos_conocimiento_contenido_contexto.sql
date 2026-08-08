-- Reproducibilidad: contenido_texto e incluir_en_contexto existían en la
-- base de dev (y por lo tanto en cualquier despliegue con la misma
-- historia) pero llegaron ahí por un ALTER TABLE hecho a mano — nunca
-- viajaron en una migración trackeada. Se detectó recién al comparar
-- columna por columna el esquema de la base viva contra una base migrada
-- desde cero: coinciden en las ~640 columnas restantes, difieren solo en
-- estas dos. Sin esto, el sembrado de plataforma (que escribe el contenido
-- real de cada documento de conocimiento) falla en cualquier servidor
-- nuevo con "column contenido_texto does not exist".
ALTER TABLE documentos_conocimiento
  ADD COLUMN contenido_texto text,
  ADD COLUMN incluir_en_contexto boolean NOT NULL DEFAULT true;
