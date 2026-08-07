-- =====================================================================
-- VetPlatform — Migración 051
-- Vetline_Ai_Suspension_Bloqueo.md — cierra el vacío entre la suspensión
-- automática por impago y la ausencia de un estado terminal para una
-- clínica que nunca paga, y agrega el estado "bloqueada" (abuso/fraude,
-- decisión manual, no elimina datos).
-- =====================================================================

-- suscripciones.estado: agrega 'bloqueada'. Los demás estados del target
-- model del spec (activa/morosa/suspendida/finalizada) ya existen; lo que
-- el spec llama "ventana_cierre" es el mismo 'ventana_purga' que ya
-- existe — se reusa el mecanismo completo, no se agrega un estado nuevo.
ALTER TABLE suscripciones DROP CONSTRAINT suscripciones_estado_check;
ALTER TABLE suscripciones ADD CONSTRAINT suscripciones_estado_check
    CHECK (estado IN ('prueba', 'activa', 'morosa', 'suspendida', 'ventana_purga',
                       'bloqueada', 'cancelada', 'finalizada'));

-- periodos_suspendida_consecutivos: cuántos períodos de facturación
-- completos transcurrieron con la suscripción en 'suspendida' sin
-- resolverse. Se recalcula desde suscripciones.periodo_fin (que queda
-- congelado mientras está suspendida — el motor de crédito y el ciclo de
-- cobro excluyen ese estado de su selección, ver ciclo.job.ts y
-- cicloCobro.ts) — no es un contador que se incrementa a mano en cada
-- corrida, sino tiempo transcurrido / duración del período, recalculado
-- cada vez. Se resetea a 0 en cuanto la suscripción sale de 'suspendida'
-- (cobro exitoso o reactivación manual).
--
-- estado_antes_bloqueo: para que "desbloquear" pueda devolver la
-- suscripción a donde estaba (spec 5.3: "no necesariamente a activa"),
-- sin tener que inferirlo de otro lado.
ALTER TABLE suscripciones
  ADD COLUMN periodos_suspendida_consecutivos INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN estado_antes_bloqueo VARCHAR(30);

-- ventana_purga_origen: de dónde vino la entrada a ventana_purga — hace
-- falta para elegir el correo correcto (una prueba que no se convirtió
-- no es lo mismo que un cierre por impago prolongado) sin duplicar el
-- mecanismo de purga.ts, que ya es genérico por diseño.
ALTER TABLE tenants
  ADD COLUMN ventana_purga_origen VARCHAR(30)
    CHECK (ventana_purga_origen IN ('prueba_no_convertida', 'cuenta_no_operativa', 'impago'));

-- ---------------------------------------------------------------------
-- clinica_eventos_ciclo_vida — auditoría tipada de toda acción manual de
-- ciclo de vida (spec, sección 8): quién, cuándo, motivo, estado antes y
-- después. tenant_id es una columna suelta, SIN FK a propósito — mismo
-- criterio que clinicas_purgadas_auditoria (migración 027): esta
-- evidencia (en particular, quién bloqueó una clínica por fraude y por
-- qué) tiene que sobrevivir aunque la clínica termine cerrándose y
-- purgándose; por eso tampoco se borra a mano en purga.ts::ejecutarPurgas
-- como sí se hace con uso_api/notificaciones_uso/eventos_facturacion/
-- documentos_fiscales.
-- ---------------------------------------------------------------------
CREATE TABLE clinica_eventos_ciclo_vida (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  tipo_evento     VARCHAR(30) NOT NULL CHECK (tipo_evento IN (
                    'suspension_manual', 'reactivacion', 'bloqueo', 'desbloqueo',
                    'entrada_ventana_cierre', 'cancelacion_ventana_cierre', 'cierre_efectivo'
                  )),
  motivo          TEXT,
  estado_anterior VARCHAR(30),
  estado_nuevo    VARCHAR(30),
  ejecutado_por   UUID REFERENCES staff_plataforma(id),
  ejecutado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clinica_eventos_ciclo_vida_tenant ON clinica_eventos_ciclo_vida(tenant_id, ejecutado_en DESC);

-- Mismo criterio que clinicas_purgadas_auditoria (migración 045): RLS
-- habilitado SIN ninguna política — lockout total desde `vetplatform_app`
-- (tenant). El único punto de escritura/lectura es Platform Admin y los
-- jobs de fondo, todos por el `pool` con bypass de RLS.
ALTER TABLE clinica_eventos_ciclo_vida ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Parámetros de plataforma — sección 7 del spec.
-- ---------------------------------------------------------------------
INSERT INTO parametros_plataforma (clave, valor, tipo, descripcion) VALUES
 ('cierre.periodos_suspendida', '3', 'numero', 'Períodos consecutivos en suspendida antes de entrar en ventana de cierre'),
 ('cierre.plazo_dias', '15', 'numero', 'Duración de la ventana de cierre antes de eliminar los datos por impago'),
 ('cierre.recordatorio_dias_antes', '3', 'numero', 'Anticipación del recordatorio de cierre')
ON CONFLICT (clave) DO NOTHING;
