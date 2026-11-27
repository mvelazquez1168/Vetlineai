-- ---------------------------------------------------------------------
-- 165 — UN SOLO VOCABULARIO PARA `pacientes.especie`
--
-- DEFECTO REAL, reportado el 2026-11-27: editar la ficha de un golden
-- retriever contestaba «La raza seleccionada no corresponde a la especie
-- indicada». La causa no era la raza: `pacientes.especie` era texto
-- libre y la base tenía cinco escrituras del mismo concepto —«Canino»,
-- «canino», «Felino», «perro», «gato»—, mientras el cruce con
-- `razas.especie` aceptaba exactamente «Canino» y «Felino».
--
-- Resultado: **78 de 97 pacientes no podían guardar su raza**, y el
-- mensaje culpaba al usuario de un desajuste nuestro.
--
-- Esta migración arregla LOS DATOS. El código ya tolera las variantes
-- (`especiePaciente.ts`) y normaliza al escribir, así que esto es lo que
-- falta para que el problema no quede latente en las filas viejas.
--
-- NO SE AGREGA UN CHECK, a propósito. Un `CHECK (especie IN
-- ('Canino','Felino'))` convertiría cualquier especie futura —un conejo,
-- un ave, un equino— en un error de base de datos en vez de un dato
-- nuevo, y Vetline ya tiene clínicas que atienden más que perros y
-- gatos. Lo que gobierna es `especieCanonica()`: traduce lo que
-- reconoce y **deja pasar tal cual lo que no**, para que nadie le cambie
-- la especie a un animal por aproximar.
-- ---------------------------------------------------------------------

UPDATE pacientes
   SET especie = 'Canino'
 WHERE lower(unaccent(trim(especie))) IN
       ('canino', 'canina', 'can', 'perro', 'perra', 'perrito', 'perrita',
        'cachorro', 'cachorra')
   AND especie <> 'Canino';

UPDATE pacientes
   SET especie = 'Felino'
 WHERE lower(unaccent(trim(especie))) IN
       ('felino', 'felina', 'gato', 'gata', 'gatito', 'gatita', 'minino', 'michi')
   AND especie <> 'Felino';

-- Lo que quedó fuera del vocabulario queda escrito en el log del
-- despliegue: es la lista de lo que hay que mirar a mano, y es
-- preferible a corregirlo por aproximación.
DO $$
DECLARE
  v_resto TEXT;
BEGIN
  SELECT string_agg(DISTINCT especie, ', ') INTO v_resto
    FROM pacientes
   WHERE especie NOT IN ('Canino', 'Felino');

  IF v_resto IS NOT NULL THEN
    RAISE NOTICE
      'Especies fuera del vocabulario único, sin tocar: %. El formulario las muestra tal cual y pide elegir la especie antes de la raza.',
      v_resto;
  END IF;
END $$;

COMMENT ON COLUMN pacientes.especie IS
  'Especie del paciente en el vocabulario único («Canino», «Felino»). Se normaliza al escribir con especieCanonica(); una especie no reconocida se guarda tal cual y NO se aproxima.';
