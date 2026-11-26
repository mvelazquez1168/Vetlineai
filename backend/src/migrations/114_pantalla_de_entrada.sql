-- ---------------------------------------------------------------------
-- 114 - La pantalla de entrada de cada usuario (prompt 01c)
--
-- POR QUE UNA COLUMNA Y NO `localStorage`: la pantalla de entrada es del
-- usuario, no del navegador. Una recepcionista que entra desde la
-- computadora del mostrador y desde la de la sala tiene que caer en el
-- mismo lugar en las dos, y una sesion nueva despues de borrar datos del
-- navegador no deberia devolverla a un lugar que ya habia descartado.
--
-- NULL significa «la que corresponda», no «ninguna»: sin eleccion
-- explicita, la entrada se deriva del rol y de los modulos habilitados.
-- Guardar el valor derivado de oficio seria congelar hoy una decision
-- que cambia sola el dia que la clinica habilita el modulo de caja.
--
-- No hay CHECK con la lista de rutas a proposito: una ruta no es un
-- dominio cerrado del modelo, y un CHECK aca obligaria a una migracion
-- cada vez que se agrega una pantalla. Lo valida el backend, que es
-- quien conoce las rutas, y una ruta que ya no existe cae a la
-- derivacion por defecto en vez de dejar al usuario en un 404.
-- ---------------------------------------------------------------------

ALTER TABLE personas ADD COLUMN IF NOT EXISTS pantalla_inicio VARCHAR(60);

COMMENT ON COLUMN personas.pantalla_inicio IS
  'Ruta donde aterriza este usuario al entrar. NULL = la que se derive del rol y de tenant_modulos (prompt 01c).';
