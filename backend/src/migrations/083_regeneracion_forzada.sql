-- Categoría nueva de consumo: `regeneracion_forzada`.
--
-- POR QUÉ UN NOMBRE NUEVO Y NO REINTERPRETAR EL VIEJO.
--
-- `regeneracion` significa hoy "la segunda vez o más que se abrió el
-- dashboard de este caso", y sale de una señal que está por desaparecer:
--
--   casos.routes.ts:  caso.dashboard_cache === null ? 'clinico' : 'regeneracion'
--
-- Cuando el dashboard pase a proyectarse desde la síntesis, esa señal deja
-- de existir y, peor, la categoría deja de describir algo real: un pedido
-- que encuentra una síntesis vigente NO llama al modelo y no debe registrar
-- consumo alguno. Lo que sí queda como hecho cobrable es otra cosa — que el
-- médico pidió rehacer una síntesis que ya estaba vigente.
--
-- Se podría haber mantenido `regeneracion` con el significado nuevo y
-- anotado la fecha del corte. Se descarta: una serie que significa una cosa
-- hasta cierta fecha y otra después, sin nada en el dato que lo indique,
-- produce conclusiones falsas cuando ya nadie recuerda que hubo un cambio.
-- Marcar el corte además obliga a que las dos pantallas de consumo conozcan
-- esa fecha y adviertan cuando el rango la abarca: lógica con estado, que
-- se pudre. Con un nombre nuevo, las dos series se separan por el VALOR y
-- el dato se explica solo.
--
-- `regeneracion` NO se borra ni se migra: queda cerrada, con su significado
-- intacto, sobre las filas que ya existen. Deja de emitirse, nada más.
--
-- El ancho pasa de 20 a 32: `regeneracion_forzada` mide exactamente 20 y
-- entraba con cero margen, lo que dejaba una trampa para el próximo nombre.
ALTER TABLE uso_api ALTER COLUMN tipo_consumo TYPE varchar(32);

ALTER TABLE uso_api DROP CONSTRAINT IF EXISTS uso_api_tipo_consumo_check;
ALTER TABLE uso_api
  ADD CONSTRAINT uso_api_tipo_consumo_check
  CHECK (tipo_consumo IN ('clinico', 'regeneracion', 'regeneracion_forzada', 'operativo', 'cortesia'));
