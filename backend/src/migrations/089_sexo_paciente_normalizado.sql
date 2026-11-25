-- =====================================================================
-- VetPlatform — Migración 089
-- Normalización de `pacientes.sexo` y validación del CHECK que la
-- migración 087 dejó NOT VALID.
--
-- POR QUÉ AHORA SÍ SE TOCAN LOS DATOS. La 087 dejó el CHECK sin validar
-- y reportó los 5 valores que no encajaban, sin reescribirlos, porque
-- parecían carga clínica. No lo eran: salían del sembrado de desarrollo
-- (`backend/src/seed/seed.ts`, que escribía "Macho"/"Hembra" a mano), y
-- ningún endpoint escribía esa columna hasta vetline-clinic-01 — el
-- relevamiento lo había señalado (§9.2: `pacientes.sexo` se leía en 6
-- lugares y no lo escribía nadie). Normalizar el sembrado no destruye
-- información de ninguna clínica.
--
-- CONVERSIONES, explícitas y acotadas a lo que existe:
--   'Macho'          → 'macho'
--   'Hembra'         → 'hembra'
--   'Macho castrado' → 'macho' + estado_reproductivo = 'castrado'
--
-- Las dos primeras son el mismo dato con otra capitalización. La tercera
-- es la única que mueve información entre columnas, y es exactamente el
-- caso que `estado_reproductivo` (migración 087) vino a separar: un campo
-- traía dos conceptos.
--
-- NO hay conversión genérica por capitalización (`lower(sexo)`) a
-- propósito: un `lower()` ciego también "convertiría" 'Hembra castrada' a
-- 'hembra castrada', que seguiría sin pasar el CHECK, y 'MACHO/HEMBRA' a
-- valores válidos sin que nadie haya mirado qué más había ahí. Preferible
-- que un valor inesperado haga fallar el VALIDATE de abajo a que se
-- cuele convertido a medias.
--
-- POR ESO EXISTE LA COMPUERTA PREVIA:
--   src/scripts/verificar_sexo_paciente_normalizable.ts
-- Solo lectura, lista cualquier valor fuera de macho|hembra|NULL y dice
-- si esta migración lo cubre. Correrlo contra la base de producción ANTES
-- de desplegar: si aparece algo no cubierto, el VALIDATE de abajo falla y
-- aborta la migración a mitad de camino. Decisión tomada con el usuario:
-- en ese caso NO se despliega la validación y se reporta.
--
-- Resultado en desarrollo (medido antes de escribir esto): 14 NULL,
-- 3 'Macho', 1 'Hembra', 1 'Macho castrado'. Los 5 convertibles.
-- =====================================================================

-- El orden importa: primero el caso que mueve dos columnas, para que el
-- UPDATE de abajo (que solo mira 'Macho') no se lo coma antes.
UPDATE pacientes
   SET sexo = 'macho',
       estado_reproductivo = 'castrado'
 WHERE sexo = 'Macho castrado';

UPDATE pacientes SET sexo = 'macho'  WHERE sexo = 'Macho';
UPDATE pacientes SET sexo = 'hembra' WHERE sexo = 'Hembra';

-- Ahora el CHECK pasa a validado: deja de ser una promesa sobre las filas
-- nuevas y se vuelve una garantía sobre TODA la tabla. Con esto se cierra
-- además la consecuencia que la 087 reportaba: un UPDATE sobre una fila
-- con el valor viejo ya no falla, porque no quedan valores viejos.
--
-- Si quedara alguno, esta sentencia falla con
-- "check constraint ... is violated by some row" y la migración entera
-- hace ROLLBACK — ninguna conversión parcial queda aplicada.
ALTER TABLE pacientes VALIDATE CONSTRAINT pacientes_sexo_check;
