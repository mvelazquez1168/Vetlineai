-- ---------------------------------------------------------------------
-- 116 - Los protocolos preventivos de fabrica (prompt 07c)
--
-- Van en su propia migracion y no al final de la 115 por lo que ya pasó
-- dos veces en este repo: un INSERT con una FK diferida dentro de la
-- misma transaccion que un ALTER TABLE posterior falla con "pending
-- trigger events". Separarlos es mas barato que recordarlo.
--
-- Son intervalos CORRIENTES, no una recomendacion clinica: cada clinica
-- los cambia. Lo que importa es que una clinica nueva no arranque con
-- una tabla vacia y el medico tenga que escribir la fecha a mano cada
-- vez, que es exactamente lo que el prompt quiere evitar.
-- ---------------------------------------------------------------------

INSERT INTO exp_protocolos_preventivos (tenant_id, tipo, especie, nombre, meses_hasta_proxima)
VALUES
  -- Vacunacion canina
  (NULL, 'vacunacion', 'canino', 'Polivalente', 12),
  (NULL, 'vacunacion', 'canino', 'Rabia', 12),
  (NULL, 'vacunacion', 'canino', 'Tos de las perreras', 12),
  (NULL, 'vacunacion', 'canino', 'Leptospirosis', 12),
  -- Vacunacion felina
  (NULL, 'vacunacion', 'felino', 'Triple felina', 12),
  (NULL, 'vacunacion', 'felino', 'Rabia', 12),
  (NULL, 'vacunacion', 'felino', 'Leucemia felina', 12),
  -- Sin especie: vale para cualquiera
  (NULL, 'vacunacion', NULL, 'Refuerzo', 12),
  -- Desparasitacion
  (NULL, 'desparasitacion', NULL, 'Interna', 3),
  (NULL, 'desparasitacion', NULL, 'Externa', 1),
  (NULL, 'desparasitacion', 'canino', 'Interna', 3),
  (NULL, 'desparasitacion', 'felino', 'Interna', 3)
ON CONFLICT DO NOTHING;
