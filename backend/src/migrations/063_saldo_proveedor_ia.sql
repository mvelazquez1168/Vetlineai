-- =====================================================================
-- VetPlatform — Migración 063
-- prompt_code_panel_consumo_sin_api — la cuenta de Anthropic es
-- individual, la API de administración (uso/costo autoritativo) no está
-- disponible. El saldo se deriva de recargas_proveedor_ia (061) menos
-- uso_api.costo_usd_calculado, que ya está calculado con las tarifas
-- reales — no hace falta cargar gasto a mano.
--
-- Esta migración agrega lo que ese enfoque necesita: un control manual
-- (lo único que puede detectar si la derivación se desvió del número
-- real del proveedor) y el mecanismo de "un solo aviso por cruce de
-- umbral" para el correo de saldo bajo.
-- =====================================================================

-- Control manual: cada vez que alguien mira la consola del proveedor y
-- anota el saldo real observado. Es la única forma de detectar drift —
-- si el derivado y el observado se separan, hay una tarifa mal cargada
-- o consumo que no se está registrando. El control más reciente se usa
-- además como nuevo punto de partida de la derivación (ver
-- saldoProveedorIa.ts) en vez de acumular siempre desde la primera
-- recarga: así un error ya detectado no sigue arrastrándose para
-- siempre en el número derivado.
CREATE TABLE controles_saldo_proveedor_ia (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha                DATE NOT NULL,
    saldo_observado_usd  NUMERIC(12,2) NOT NULL,
    -- Diferencia contra lo que la plataforma habría derivado a esta
    -- misma fecha (con el punto de partida vigente ANTES de este
    -- control) — calculada y congelada al momento de registrar el
    -- control, no recalculada después. Es el dato más valioso del
    -- panel: si no es ~0, hay una tarifa mal cargada o consumo que no
    -- se está registrando.
    diferencia_usd       NUMERIC(12,2) NOT NULL,
    registrado_por       UUID NOT NULL REFERENCES staff_plataforma(id),
    nota                 TEXT,
    creado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_controles_saldo_proveedor_ia_fecha
    ON controles_saldo_proveedor_ia (fecha DESC, creado_en DESC);

-- Alertas de saldo bajo: una fila "activa" (resuelto_en IS NULL)
-- mientras el saldo derivado sigue debajo del umbral. El job la crea
-- (y dispara el correo) solo si no hay ninguna activa todavía — así el
-- aviso sale una sola vez por cruce, no todos los días que el saldo
-- siga bajo. Se cierra (resuelto_en = now()) apenas el saldo vuelve a
-- estar por encima del umbral, dejando el camino libre para que un
-- cruce futuro dispare un aviso nuevo.
CREATE TABLE alertas_saldo_proveedor_ia (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cruzo_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    saldo_derivado_usd   NUMERIC(12,2) NOT NULL,
    resuelto_en          TIMESTAMPTZ
);

-- A lo sumo una alerta activa a la vez — el job lee-antes-de-escribir,
-- pero este índice es la garantía real contra una carrera o un bug que
-- intente insertar una segunda.
CREATE UNIQUE INDEX uq_alerta_saldo_proveedor_ia_activa
    ON alertas_saldo_proveedor_ia ((true))
    WHERE resuelto_en IS NULL;

-- Sin RLS en ninguna de las dos: son staff-only y platform-wide (no
-- tenant_id), mismo criterio que recargas_proveedor_ia (061).

INSERT INTO parametros_plataforma (clave, valor, tipo, descripcion) VALUES
    ('saldo_proveedor.umbral_usd', '50', 'numero',
     'Si el saldo derivado del proveedor de IA cae debajo de este monto (USD), se avisa por correo una vez por cruce.'),
    ('saldo_proveedor.correo_destino', 'soporte@vetlineai.com', 'texto',
     'Correo que recibe el aviso de saldo bajo del proveedor de IA.')
ON CONFLICT (clave) DO NOTHING;
