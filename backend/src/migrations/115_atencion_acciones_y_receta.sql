-- ---------------------------------------------------------------------
-- 115 - Acciones explicitas en la atencion y receta completa (prompt 07c)
--
-- Nada de esto crea un camino nuevo para el dinero ni para el stock: el
-- cargo sigue entrando por `agregarCargo` y la salida por
-- `registrarMovimiento`, igual que en el 07. Lo que falta es QUE SE
-- PUEDA DECIR lo que el medico hizo, y hoy no se puede: una vacuna se
-- registra entrando por "Producto" y marcando una casilla escondida en
-- un modal.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. EL TIPO CLINICO DEL PRODUCTO
--
-- `categoria` ya existe, pero es del inventario: sirve para ordenar el
-- catalogo y para los reportes de compra, y cada clinica la nombra como
-- quiere ("Biologicos", "Vacunas caninas", "Farmacia"). Lo que la
-- atencion necesita preguntar es otra cosa y tiene que ser estable:
-- ¿esto es una vacuna? La pregunta no se puede responder con un texto
-- que cada clinica escribe distinto.
--
-- Por eso una columna propia y no una convencion sobre `categoria`.
-- ---------------------------------------------------------------------

ALTER TABLE inv_productos
  ADD COLUMN IF NOT EXISTS tipo_clinico VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inv_productos_tipo_clinico_check'
  ) THEN
    ALTER TABLE inv_productos ADD CONSTRAINT inv_productos_tipo_clinico_check
      CHECK (tipo_clinico IS NULL OR tipo_clinico IN
             ('vacuna', 'antiparasitario', 'medicamento', 'insumo', 'otro'));
  END IF;
END $$;

COMMENT ON COLUMN inv_productos.tipo_clinico IS
  'Que es el producto para la clinica (prompt 07c): vacuna, antiparasitario, medicamento, insumo u otro. Distinto de `categoria`, que es del inventario y cada clinica nombra a su gusto. NULL = sin clasificar.';

-- Semilla por inferencia, SOLO donde el nombre no deja lugar a dudas.
-- Lo que no es evidente queda en NULL a proposito: adivinar el tipo
-- clinico de un producto y equivocarse es peor que dejarlo sin
-- clasificar, porque el filtro de la accion "Vacuna" mostraria algo que
-- no es una vacuna y nadie lo revisaria.
UPDATE inv_productos p SET tipo_clinico = 'vacuna'
 WHERE p.tipo_clinico IS NULL
   AND (p.nombre ILIKE '%vacuna%' OR p.categoria ILIKE '%vacun%');

UPDATE inv_productos p SET tipo_clinico = 'antiparasitario'
 WHERE p.tipo_clinico IS NULL
   AND (p.nombre ILIKE '%desparasit%' OR p.nombre ILIKE '%antiparasit%'
        OR p.categoria ILIKE '%desparasit%' OR p.categoria ILIKE '%antiparasit%');

UPDATE inv_productos p SET tipo_clinico = 'medicamento'
 WHERE p.tipo_clinico IS NULL AND p.requiere_receta;

-- ---------------------------------------------------------------------
-- 2. LOS PROTOCOLOS PREVENTIVOS
--
-- Cuanto falta para la proxima vacuna o desparasitacion. Mismo patron
-- que `exp_catalogos_clinicos`: `tenant_id IS NULL` son los valores de
-- fabrica, que valen para todas, y una fila con tenant los reemplaza.
-- Asi una clinica puede cambiar su protocolo sin que haya que migrar
-- nada, y una clinica nueva arranca con algo razonable en vez de con
-- una tabla vacia.
--
-- La especie es opcional: un protocolo sin especie vale para todas, que
-- es el caso de la desparasitacion interna.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exp_protocolos_preventivos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE
                  DEFERRABLE INITIALLY DEFERRED,
  tipo          VARCHAR(20) NOT NULL
                  CHECK (tipo IN ('vacunacion', 'desparasitacion')),
  /* NULL = sirve para cualquier especie. */
  especie       VARCHAR(40),
  /* El nombre del preventivo tal como se registra: "Polivalente",
     "Rabia", "Interna". */
  nombre        VARCHAR(120) NOT NULL,
  /* Un protocolo puede estar atado a un producto concreto del catalogo
     de la clinica, y entonces gana sobre el del nombre. */
  producto_id   UUID REFERENCES inv_productos(id) ON DELETE CASCADE
                  DEFERRABLE INITIALLY DEFERRED,
  meses_hasta_proxima SMALLINT NOT NULL CHECK (meses_hasta_proxima > 0),
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_protocolo_global
  ON exp_protocolos_preventivos (tipo, COALESCE(especie, ''), nombre)
  WHERE tenant_id IS NULL AND producto_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_protocolo_tenant
  ON exp_protocolos_preventivos (tenant_id, tipo, COALESCE(especie, ''), nombre)
  WHERE tenant_id IS NOT NULL AND producto_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_protocolo_producto
  ON exp_protocolos_preventivos (producto_id) WHERE producto_id IS NOT NULL;

ALTER TABLE exp_protocolos_preventivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_protocolos_preventivos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exp_protocolos_tenant ON exp_protocolos_preventivos;
CREATE POLICY exp_protocolos_tenant ON exp_protocolos_preventivos
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

COMMENT ON TABLE exp_protocolos_preventivos IS
  'Cada cuantos meses toca el proximo preventivo. tenant_id NULL = valores de fabrica; una fila con tenant los reemplaza (prompt 07c).';

-- ---------------------------------------------------------------------
-- 3. LA RECETA, ATADA A LA ATENCION
--
-- `recetas` y `receta_items` EXISTEN desde Vetline Ai (migracion 016) y
-- se extienden en vez de duplicarse: una receta es una receta, la
-- escriba el agente o el medico en la consulta. Lo que cambia es de
-- donde cuelga y que puede llevar.
--
-- `caso_id` pasa a ser opcional porque una atencion puede no tener
-- caso: el expediente no exige abrir un caso de IA para recetar.
-- ---------------------------------------------------------------------

ALTER TABLE recetas
  ADD COLUMN IF NOT EXISTS atencion_id UUID REFERENCES atenciones(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  /* El peso con el que se calcularon las dosis. Se guarda porque la
     receta es un documento: dentro de un mes el paciente pesa otra cosa
     y la receta tiene que seguir diciendo con que peso se calculo. */
  ADD COLUMN IF NOT EXISTS peso_kg NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS firmada_por UUID REFERENCES personas(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS firmada_en TIMESTAMPTZ;

ALTER TABLE recetas ALTER COLUMN caso_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receta_cuelga_de_algo'
  ) THEN
    ALTER TABLE recetas ADD CONSTRAINT receta_cuelga_de_algo
      CHECK (caso_id IS NOT NULL OR atencion_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recetas_atencion ON recetas (atencion_id)
  WHERE atencion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recetas_paciente ON recetas (paciente_id);

-- ---------------------------------------------------------------------
-- 4. LA LINEA DE RECETA, CON SU POSOLOGIA
--
-- Tres origenes posibles y exactamente uno por linea:
--   * `medicamento_id`  — el catalogo de Vetline Ai, como hasta hoy;
--   * `presentacion_id` — el inventario de la clinica, que es lo que
--     permite dispensar;
--   * `texto_libre`     — lo que la clinica no vende. El prompt lo pide
--     explicito, y sin esto el medico no puede recetar algo que el
--     propietario compra en otro lado.
--
-- `dosis`, `frecuencia`, `duracion` y `via_administracion` son TEXTO en
-- la tabla original y se conservan: son lo que se imprime. Al lado van
-- los campos estructurados, que son los que permiten calcular. No se
-- reemplaza el texto por los numeros porque una receta vieja no tiene
-- los numeros y tiene que seguir imprimiendose igual.
-- ---------------------------------------------------------------------

ALTER TABLE receta_items ALTER COLUMN medicamento_id DROP NOT NULL;
ALTER TABLE receta_items ALTER COLUMN dosis DROP NOT NULL;
ALTER TABLE receta_items ALTER COLUMN frecuencia DROP NOT NULL;
ALTER TABLE receta_items ALTER COLUMN duracion DROP NOT NULL;
ALTER TABLE receta_items ALTER COLUMN via_administracion DROP NOT NULL;

ALTER TABLE receta_items
  ADD COLUMN IF NOT EXISTS presentacion_id UUID REFERENCES inv_presentaciones(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS texto_libre VARCHAR(200),
  /* La dosis, estructurada: cuanto, de que unidad, y si es por kilo. */
  ADD COLUMN IF NOT EXISTS dosis_cantidad NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS dosis_unidad VARCHAR(20),
  ADD COLUMN IF NOT EXISTS dosis_por_kg BOOLEAN NOT NULL DEFAULT false,
  /* El resultado del calculo y su base, congelados. Se guardan los dos
     para que la receta pueda explicarse sola: "12,5 mg/kg x 18 kg". */
  ADD COLUMN IF NOT EXISTS peso_base_kg NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS dosis_total NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS via_codigo VARCHAR(40),
  ADD COLUMN IF NOT EXISTS frecuencia_codigo VARCHAR(40),
  ADD COLUMN IF NOT EXISTS cantidad_total NUMERIC(12,3),
  /* El texto para el propietario, generado y editable. */
  ADD COLUMN IF NOT EXISTS indicaciones TEXT,
  /* Si se entrega aca, la linea genera cargo y salida por el flujo que
     ya existe, ligada a `exp_atencion_items`. Una sola fuente: el cargo
     no se agrega dos veces. */
  ADD COLUMN IF NOT EXISTS dispensado_aqui BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS atencion_item_id UUID REFERENCES exp_atencion_items(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- Las columnas de duracion estructurada las agrega la 111 (anexo). Se
-- repiten con IF NOT EXISTS para que esta migracion valga sola.
ALTER TABLE receta_items
  ADD COLUMN IF NOT EXISTS duracion_cantidad SMALLINT,
  ADD COLUMN IF NOT EXISTS duracion_unidad VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receta_item_tiene_un_origen'
  ) THEN
    ALTER TABLE receta_items ADD CONSTRAINT receta_item_tiene_un_origen
      CHECK (
        (CASE WHEN medicamento_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN presentacion_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN texto_libre IS NOT NULL THEN 1 ELSE 0 END) = 1
      );
  END IF;
END $$;

-- Lo que se compra afuera NO puede tener cargo: si no se dispensa aca,
-- no hay nada que cobrar ni que descontar. Es la regla que evita cobrar
-- un medicamento que el cliente va a comprar en otro lado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receta_item_afuera_no_se_cobra'
  ) THEN
    ALTER TABLE receta_items ADD CONSTRAINT receta_item_afuera_no_se_cobra
      CHECK (dispensado_aqui OR atencion_item_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receta_items_receta ON receta_items (receta_id);

-- ---------------------------------------------------------------------
-- 5. EL REGISTRO HISTORICO DE UN PREVENTIVO
--
-- Una vacuna puesta el ano pasado en otra clinica es informacion
-- clinica real y hoy no hay donde ponerla: `cuidados_preventivos` nace
-- siempre de una atencion. Se marca como historica para que nadie la
-- confunda con algo que esta clinica aplico, y para que los reportes de
-- produccion no la cuenten.
--
-- NO lleva cargo ni movimiento de inventario, y por eso no pasa por la
-- atencion: no se aplico nada aca.
-- ---------------------------------------------------------------------

ALTER TABLE cuidados_preventivos
  ADD COLUMN IF NOT EXISTS historico BOOLEAN NOT NULL DEFAULT false,
  /* Donde se aplico, cuando no fue aca. Texto libre a proposito: es el
     nombre de otra clinica, que no esta en ninguna tabla nuestra. */
  ADD COLUMN IF NOT EXISTS lugar VARCHAR(160);

COMMENT ON COLUMN cuidados_preventivos.historico IS
  'true = aplicado antes o en otro lugar, cargado a mano. Sin cargo ni movimiento de inventario (prompt 07c).';

-- ---------------------------------------------------------------------
-- 6. EL ESTUDIO PEDIDO DESDE LA ATENCION
--
-- `exp_estudios_lab` ya tiene `atencion_id`. Lo que falta es el puente
-- al cobro: si el estudio se hace aca y tiene un servicio del catalogo,
-- el cargo va a la atencion como cualquier otra cosa que se hizo.
-- ---------------------------------------------------------------------

ALTER TABLE exp_estudios_lab
  ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES inv_servicios(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS atencion_item_id UUID REFERENCES exp_atencion_items(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------
-- 7. EL NUMERO DE COLEGIADO EN LA RECETA
--
-- `personas.colegiatura` ya existe (migracion del prompt de invitacion
-- de medicos) y es lo que va impreso. No se agrega un campo nuevo: se
-- deja dicho que este es su uso, para que nadie cree otro.
-- ---------------------------------------------------------------------

COMMENT ON COLUMN personas.colegiatura IS
  'Numero de colegiado. Obligatorio para un medico; se imprime en la receta y en el informe clinico.';
