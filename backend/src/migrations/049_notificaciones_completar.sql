-- =====================================================================
-- VetPlatform — Migración 049
-- prompt_code_notificaciones: consolidar el envío del módulo de
-- notificaciones por el mismo camino que los correos transaccionales,
-- conectar seguimiento_faltante al envío real, y dar a cada clínica
-- control (interruptor + parámetro) sobre las 3 notificaciones.
-- =====================================================================

-- notificaciones: el motivo de un fallo de ENVÍO ya vive en
-- correos_enviados.error — acá solo una referencia (ajuste pedido por el
-- usuario), para que el motivo viva en un solo lugar y quede trazable si
-- esa fila recibe después un rebote por webhook. `error` acá es SOLO
-- para fallos ANTERIORES al intento de envío (ej. propietario sin correo
-- cargado) que nunca llegan a generar una fila en correos_enviados.
-- `canal` deja previsto que una notificación pueda salir por otro medio
-- en el futuro — hoy el único valor posible es 'correo', sin exponerlo
-- en la interfaz.
ALTER TABLE notificaciones
  ADD COLUMN correo_enviado_id UUID REFERENCES correos_enviados(id),
  ADD COLUMN error TEXT,
  ADD COLUMN canal VARCHAR(20) NOT NULL DEFAULT 'correo' CHECK (canal IN ('correo'));

-- configuracion_notificaciones: un interruptor + un parámetro por cada
-- una de las 3 notificaciones.
-- horas_aviso_recordatorio_cita reemplaza el "26 horas" que estaba
-- hardcodeado en el job (mismo valor por default, no cambia
-- comportamiento existente).
-- dias_aviso_seguimiento_faltante reemplaza DIAS_DEDUPE_SEGUIMIENTO
-- (también hardcodeado, en 3): es la ventana de re-aviso para el mismo
-- caso si la condición sigue vigente — la única noción de "días sin
-- actividad" que existe hoy en ese disparador (el trigger en sí es por
-- severidad clínica + sin cita futura, no por inactividad medida; ver
-- reporte de verificación).
ALTER TABLE configuracion_notificaciones
  ADD COLUMN recordatorio_cita_activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN horas_aviso_recordatorio_cita INTEGER NOT NULL DEFAULT 26,
  ADD COLUMN desparasitacion_activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN seguimiento_faltante_activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN dias_aviso_seguimiento_faltante INTEGER NOT NULL DEFAULT 3;
