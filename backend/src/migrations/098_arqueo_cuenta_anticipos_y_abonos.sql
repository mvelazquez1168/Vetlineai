-- ---------------------------------------------------------------------
-- 098 — El arqueo tiene que contar los anticipos y los abonos
--
-- DEFECTO REAL QUE ESTO CIERRA. `esperadoDeSesion` sumaba el fondo, los
-- cobros y los movimientos de efectivo, y NO los anticipos ni los
-- abonos. Las dos tablas ya guardaban `sesion_id` desde la 096, así que
-- el dinero estaba atribuido a la caja correcta; lo que faltaba era
-- contarlo.
--
-- La consecuencia era concreta: un cliente deja ₡6 000 de anticipo por
-- un encargo, o abona ₡10 000 de su cuenta, el billete queda en la
-- gaveta, y al cerrar el arqueo decía que sobraban ₡16 000. El cajero
-- tenía que "justificar" una diferencia que el sistema se había
-- causado solo, y si la diferencia pasaba el umbral, la caja no
-- cerraba. Peor: con eso pasando todos los días, la gente aprende a
-- justificar diferencias sin mirarlas, que es exactamente lo que el
-- arqueo existe para evitar.
--
-- Para contarlo hace falta saber POR QUÉ MEDIO entró, y eso no se
-- guardaba:
--
--   * un ANTICIPO se recibe en el mostrador de una sola forma, así que
--     le alcanza con un medio y una moneda en la misma fila;
--   * un ABONO puede venir partido (algo en efectivo y algo por SINPE),
--     y de hecho `registrarAbono` ya acepta varios medios porque el
--     Recibo Electrónico de Pago los valida. Esos medios vivían SOLO
--     dentro del XML del comprobante, que no es un lugar del que el
--     arqueo pueda sumar. Por eso la tabla.
--
-- El default '01' (efectivo) y 'CRC' no es una suposición cómoda: es
-- cómo se recibieron los anticipos que ya están cargados, y dejarlos en
-- NULL obligaría a excluirlos del arqueo, que es el defecto que esto
-- corrige.
-- ---------------------------------------------------------------------

ALTER TABLE vta_anticipos
  ADD COLUMN IF NOT EXISTS medio  VARCHAR(2)  NOT NULL DEFAULT '01',
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3)  NOT NULL DEFAULT 'CRC';

COMMENT ON COLUMN vta_anticipos.medio IS
  'Código de medio de pago de Hacienda (Nota 6). El arqueo lo agrupa con grupoDeArqueo().';

CREATE TABLE IF NOT EXISTS vta_abono_medios (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  abono_id  UUID NOT NULL REFERENCES vta_abonos(id) ON DELETE CASCADE,
  medio     VARCHAR(2) NOT NULL,
  moneda    VARCHAR(3) NOT NULL DEFAULT 'CRC',
  monto     NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  referencia VARCHAR(60)
);

CREATE INDEX IF NOT EXISTS idx_vta_abono_medios_abono ON vta_abono_medios (abono_id);

ALTER TABLE vta_abono_medios ENABLE ROW LEVEL SECURITY;
ALTER TABLE vta_abono_medios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vta_abono_medios_isolation ON vta_abono_medios;
CREATE POLICY vta_abono_medios_isolation ON vta_abono_medios
  USING (tenant_id::text = current_setting('app.tenant_id', true));

COMMENT ON TABLE vta_abono_medios IS
  'Con qué medios se recibió un abono. Existe porque el arqueo no puede sumar desde el XML del Recibo Electrónico de Pago, que era el único lugar donde estaban.';
