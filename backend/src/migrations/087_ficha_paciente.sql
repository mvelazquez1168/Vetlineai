-- =====================================================================
-- VetPlatform — Migración 087
-- vetline-clinic-01-cimientos-y-ficha-paciente, punto 3.1.
--
-- La ficha del paciente. No es un módulo de Vetline Clinic gateado: es
-- núcleo, porque Vetline Ai también la necesita — hoy el agente clínico
-- recibe el contexto del caso SIN el sexo del paciente, no porque la
-- columna no exista sino porque ningún endpoint la escribe nunca (el
-- único INSERT que la completa está en seed.ts). Ver el relevamiento
-- §9.2.
-- =====================================================================

-- NOTA DE ORDEN: el CHECK de `sexo` se agrega AL FINAL de este archivo,
-- después del backfill del número de expediente. No es cosmético — ver
-- la Parte F: una constraint NOT VALID sí se aplica a toda fila que se
-- UPDATEe, aunque el UPDATE no toque la columna de la constraint, así
-- que ponerla antes hacía fallar el backfill. Medido contra la base, no
-- deducido: el primer intento de esta migración murió exactamente ahí.

-- ---------------------------------------------------------------------
-- PARTE B — Estado reproductivo, separado del sexo.
--
-- 'desconocido' y no NULL como default: en una ficha clínica "no sé si
-- está castrado" es un dato distinto de "nadie completó el campo", y el
-- primero es el caso normal en una primera consulta. Con un default
-- explícito, la pantalla muestra siempre algo verdadero sin que el
-- backend tenga que inventar un texto para el NULL.
-- ---------------------------------------------------------------------
ALTER TABLE pacientes
  ADD COLUMN estado_reproductivo VARCHAR(20) NOT NULL DEFAULT 'desconocido'
    CHECK (estado_reproductivo IN ('entero', 'castrado', 'desconocido'));

-- ---------------------------------------------------------------------
-- PARTE C — La edad se guarda SOLO como fecha de nacimiento.
--
-- `fecha_nacimiento_estimada` existe porque muchos tutores saben la edad
-- aproximada pero no la fecha (adopciones, rescates). En vez de volver a
-- tener dos representaciones de la edad — el problema que `edad_anios` ya
-- causó — se guarda siempre una fecha, y esta bandera dice si se calculó
-- a partir de una edad declarada o si es la fecha real.
--
-- `edad_anios` NO se borra ni se vacía: 5 filas la tienen y son el único
-- dato de edad que esas fichas tienen. Deja de escribirse (ningún
-- endpoint la toca a partir de ahora) y se sigue leyendo por
-- `edadPaciente.ts::calcularEdadEfectiva`, que ya es el único lugar que
-- resuelve la edad y que prioriza `fecha_nacimiento` cuando está.
-- ---------------------------------------------------------------------
ALTER TABLE pacientes
  ADD COLUMN fecha_nacimiento_estimada BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- PARTE D — Campos nuevos de la ficha, todos opcionales.
--
-- `microchip` sin índice único a propósito: un microchip es único en el
-- mundo real, pero una clínica carga el número a mano y un dígito mal
-- tipeado no debe impedir guardar el paciente. Si en algún momento la
-- búsqueda por microchip lo justifica, el índice se agrega ahí con la
-- medición que lo pida.
--
-- `alerta_manejo` es corta a propósito (200): es lo que se pinta
-- destacado en el encabezado de la ficha ("agresivo, requiere bozal"),
-- no un campo de observaciones. `alergias` sí es TEXT: puede ser una
-- lista larga y la lee el médico completa.
-- ---------------------------------------------------------------------
ALTER TABLE pacientes ADD COLUMN microchip     VARCHAR(50);
ALTER TABLE pacientes ADD COLUMN color         VARCHAR(100);
ALTER TABLE pacientes ADD COLUMN alergias      TEXT;
ALTER TABLE pacientes ADD COLUMN alerta_manejo VARCHAR(200);

-- ---------------------------------------------------------------------
-- PARTE E — Número de expediente DEL PACIENTE.
--
-- Mismo mecanismo exacto que `casos.numero_expediente` (migración 047):
-- consecutivo por clínica, con su contador en `tenants` y asignación
-- atómica por UPDATE...RETURNING. Las dos funciones de asignación viven
-- juntas en `expediente.ts`, no repartidas — es la tercera vez que esta
-- forma aparece y ya está consolidada ahí.
--
-- `casos.numero_expediente` NO cambia: ni de significado, ni de datos, ni
-- de contador. Lo único que cambia es su etiqueta en la interfaz, que
-- pasa de "Expediente" a "N.º de caso" para que no se confunda con este.
-- ---------------------------------------------------------------------
ALTER TABLE tenants   ADD COLUMN paciente_expediente_ultimo_numero INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pacientes ADD COLUMN numero_expediente INTEGER;

-- Backfill por clínica. CRITERIO DE ORDEN: `creado_en ASC, id ASC`.
--   * `creado_en` porque es el orden en que la clínica dio de alta a cada
--     paciente, y es el único orden que un expediente consecutivo puede
--     tener sin inventar nada.
--   * `id ASC` como desempate: `creado_en` es timestamptz y dos altas del
--     mismo wizard pueden caer en el mismo microsegundo. Sin desempate,
--     el resultado del backfill no sería reproducible entre corridas (y
--     esta migración tiene que dar lo mismo en dev y en producción).
DO $backfill$
DECLARE
    fila_tenant   RECORD;
    fila_paciente RECORD;
    contador      INTEGER;
BEGIN
    FOR fila_tenant IN SELECT DISTINCT tenant_id FROM pacientes LOOP
        contador := 0;
        FOR fila_paciente IN
            SELECT id FROM pacientes
            WHERE tenant_id = fila_tenant.tenant_id
            ORDER BY creado_en ASC, id ASC
        LOOP
            contador := contador + 1;
            UPDATE pacientes SET numero_expediente = contador WHERE id = fila_paciente.id;
        END LOOP;
        UPDATE tenants SET paciente_expediente_ultimo_numero = contador WHERE id = fila_tenant.tenant_id;
    END LOOP;
END $backfill$;

ALTER TABLE pacientes ALTER COLUMN numero_expediente SET NOT NULL;
ALTER TABLE pacientes
  ADD CONSTRAINT pacientes_numero_expediente_unico UNIQUE (tenant_id, numero_expediente);

-- El listado de pacientes busca por nombre y por número de expediente, y
-- ordena por nombre. Este índice cubre el orden dentro de la clínica; la
-- unicidad de arriba ya cubre la búsqueda por número.
CREATE INDEX idx_pacientes_tenant_nombre ON pacientes(tenant_id, nombre);

-- ---------------------------------------------------------------------
-- PARTE F — Sexo con valores cerrados. VA AL FINAL, ver la nota de orden
-- del encabezado.
--
-- RELEVAMIENTO PREVIO (base de desarrollo, antes de escribir el CHECK),
-- tal como pidió el prompt:
--
--     sexo             | filas
--     -----------------+------
--     NULL             |   14
--     'Macho'          |    3
--     'Macho castrado' |    1
--     'Hembra'         |    1
--
-- NINGUNO de los 5 valores no nulos encaja en 'macho'|'hembra': cuatro
-- difieren solo en la capitalización, y 'Macho castrado' mezcla dos
-- conceptos distintos en un campo — es exactamente el dato que
-- `estado_reproductivo` (Parte B) viene a separar.
--
-- Por eso el CHECK va NOT VALID, igual que
-- `colegiatura_medico_obligatoria` (migración 031): se aplica a toda fila
-- nueva o modificada y no rechaza las existentes. NO se reescriben esos
-- 5 valores: normalizar datos clínicos ya cargados es una decisión del
-- usuario, y en particular suponer que 'Macho castrado' significa
-- sexo='macho' + estado_reproductivo='castrado' es una interpretación,
-- no una conversión.
--
-- CONSECUENCIA REAL, REPORTADA Y NO RESUELTA ACÁ: mientras esas 5 filas
-- conserven su valor viejo, CUALQUIER UPDATE sobre ellas falla — incluido
-- `PATCH /api/pacientes/:id/estado` (marcar fallecido) y el cierre de
-- caso con desenlace 'fallecido' (cierreCaso.ts), que no tocan `sexo`.
-- El camino que lo arregla es `PATCH /api/pacientes/:id`, que sí escribe
-- `sexo` con el vocabulario nuevo. Son 5 filas de datos de demostración
-- en desarrollo; en producción hay que relevar cuántas son antes de
-- decidir entre normalizarlas o ampliar el CHECK.
-- ---------------------------------------------------------------------
ALTER TABLE pacientes DROP CONSTRAINT IF EXISTS pacientes_sexo_check;
ALTER TABLE pacientes
  ADD CONSTRAINT pacientes_sexo_check
  CHECK (sexo IS NULL OR sexo IN ('macho', 'hembra'))
  NOT VALID;
