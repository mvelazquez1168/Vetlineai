-- =====================================================================
-- VetPlatform — Migración 086
-- vetline-clinic-01-cimientos-y-ficha-paciente, punto 2.
--
-- Habilitación de los módulos de Vetline Clinic por clínica. Misma forma
-- exacta que `tenant_agentes` (migración 001 + 024), que es el único
-- mecanismo de capacidad por clínica que ya existía y que el relevamiento
-- (docs/relevamientos/modelo-compartido-gestion.md §6) señaló como
-- patrón reusable.
--
-- Qué se copia de tenant_agentes y qué NO:
--   * SÍ la forma: tabla puente, UNIQUE (tenant, capacidad), estado con
--     CHECK cerrado, marcas de tiempo de habilitación/deshabilitación,
--     RLS forzada con la política estándar.
--   * NO el cupo. tenant_agentes está amarrado a
--     `suscripciones.agentes_contratados` porque cada agente se cobra
--     aparte. Un módulo de gestión no se cuenta: está o no está. Si
--     algún día se vende por módulo, el cupo se agrega acá, no se
--     hereda de los agentes.
--   * NO un catálogo. tenant_agentes referencia la tabla `agentes`.
--     Los módulos no tienen tabla de catálogo a propósito: son cinco
--     valores fijos del producto, no datos que alguien cargue. De ahí el
--     CHECK en vez de una FK.
--
-- La tabla nace VACÍA. Ninguna clínica (Medicavet incluida) se habilita
-- desde una migración: eso se hace con `npm run habilitar-modulo`. El
-- motivo es que una migración con el UUID de un tenant de producción
-- escrito a mano no es reproducible en otro ambiente y queda aplicada
-- para siempre; el comando se corre donde haga falta y cuantas veces
-- haga falta. El rastro de cuándo se habilitó queda en las columnas
-- `habilitado_en`/`deshabilitado_en`/`actualizado_en` de la propia fila
-- — NO en `bitacora_auditoria`, que solo registra escrituras hechas por
-- una persona autenticada vía HTTP (ver middleware/auditoria.ts).
-- =====================================================================

CREATE TABLE tenant_modulos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- CHECK de valores cerrados, no FK ni texto libre: un módulo nuevo
  -- exige una migración, a propósito. Es lo que impide que el frontend
  -- o un script inventen un módulo que el backend no gatea.
  modulo           VARCHAR(30) NOT NULL
                   CHECK (modulo IN ('expediente', 'inventario', 'ventas', 'facturacion', 'campanas')),
  estado           VARCHAR(20) NOT NULL DEFAULT 'habilitado'
                   CHECK (estado IN ('habilitado', 'deshabilitado')),
  habilitado_en    TIMESTAMPTZ,
  deshabilitado_en TIMESTAMPTZ,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, modulo)
);

CREATE INDEX idx_tenant_modulos_tenant ON tenant_modulos(tenant_id);

-- RLS habilitada Y forzada desde el minuto cero (ver migración 085 sobre
-- por qué forzar importa aunque hoy el pool admin la bypassee), con la
-- política estándar del esquema.
ALTER TABLE tenant_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_modulos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_modulos_isolation ON tenant_modulos
  USING (tenant_id::text = current_setting('app.tenant_id', true));
