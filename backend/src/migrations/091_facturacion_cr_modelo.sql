-- =====================================================================
-- VetPlatform — Migración 091
-- vetline-clinic-09a, punto 1: modelo de datos del facturador
-- electrónico de Costa Rica, versión 4.4.
--
-- CADA longitud, enumeración y obligatoriedad de este archivo sale de
-- las fuentes oficiales descargadas en `docs/facturacion/fuentes/`:
--   * los nueve XSD de v4.4 (las longitudes y los enum son del XSD, que
--     es lo que Hacienda realmente valida);
--   * `ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` (las notas 3 a 22, que son los
--     catálogos y las reglas de composición).
-- Los hechos con su cita están en `docs/facturacion/datos-oficiales.md`.
-- Nada acá se escribió de memoria.
--
-- Prefijo `fact_` en todas las tablas: son 18 tablas nuevas y sin
-- prefijo el esquema se vuelve ilegible.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CATÁLOGOS OFICIALES — sin tenant_id, son de la plataforma.
--
-- Mismo criterio que `paises` o `tipos_identificacion`: los publica
-- Hacienda, no los edita una clínica. Van sin RLS, como el resto de los
-- catálogos del esquema.
--
-- Las tablas nacen VACÍAS. Se cargan con `npm run cargar-catalogos-fe`,
-- que es idempotente y se puede volver a correr cuando Hacienda
-- actualice los catálogos — mismo criterio que `tenant_modulos`
-- (migración 086): un catálogo escrito dentro de una migración queda
-- aplicado para siempre y no se puede volver a correr.
--
-- `codigo` es texto y no entero, siempre: los códigos oficiales llevan
-- cero a la izquierda ('01', no 1) y van literales al XML. Guardarlos
-- como número obliga a volver a formatearlos en cada uso, y ahí se
-- pierde el cero.
-- ---------------------------------------------------------------------

-- Nota 2 del anexo + los nueve XSD.
CREATE TABLE fact_cat_tipo_comprobante (
  codigo        VARCHAR(2) PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  -- Elemento raíz del XML y nombre del XSD con el que se valida.
  -- Verificado leyendo los nueve esquemas, no la documentación.
  elemento_raiz VARCHAR(60),
  archivo_xsd   VARCHAR(80),
  -- Un comprobante que se emite (factura, tiquete, notas, REP) vs. un
  -- mensaje de confirmación (aceptación 05, aceptación parcial 06,
  -- rechazo 07). Los tres mensajes comparten la numeración consecutiva
  -- pero NO son comprobantes: no tienen líneas ni totales. De ahí que
  -- esta columna exista y no se deduzca del código.
  es_comprobante BOOLEAN NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT true
);

-- Nota 4 (los seis tipos) y Nota 4.1 (el relleno con ceros para armar la
-- clave numérica).
CREATE TABLE fact_cat_tipo_identificacion (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  -- Cuántos caracteres debe tener la identificación en las posiciones
  -- 10-21 de la clave. Los cuatro tipos que la Nota 4.1 describe llegan
  -- a 12; los tipos 05 y 06 no aparecen en esa nota (ver `nota_relleno`).
  largo_en_clave SMALLINT,
  -- El texto literal de la Nota 4.1, para que el módulo de la clave no
  -- tenga la regla escrita en dos lugares distintos.
  nota_relleno   TEXT,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 5. OJO: el XSD de FacturaElectronica enumera
-- 01..08, 10, 12..15, 99 — sin 09 ni 11, porque esos dos son de uso
-- EXCLUSIVO del Recibo Electrónico de Pago (el XSD del REP enumera
-- justamente [09|11] y nada más). De ahí la columna de alcance.
CREATE TABLE fact_cat_condicion_venta (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  -- El código 99 ("Otros") obliga a completar el detalle en texto libre.
  exige_detalle BOOLEAN NOT NULL DEFAULT false,
  -- true solo para 09 y 11.
  solo_en_rep BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 6. SINPE MOVIL es el 06.
CREATE TABLE fact_cat_medio_pago (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  exige_detalle BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 8. El XSD enumera 01,02,03,04,05,06,07,08,12,99: NO existen 09,
-- 10 ni 11.
CREATE TABLE fact_cat_codigo_impuesto (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  exige_detalle BOOLEAN NOT NULL DEFAULT false,
  -- Los impuestos específicos (03, 04, 05, 06, 12) usan el nodo
  -- DatosImpuestoEspecifico en vez de una tarifa porcentual.
  exige_datos_especificos BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 8.1. Son once códigos y TRES de ellos valen 0% con significados
-- fiscales distintos: 01 (0% con derecho a crédito pleno), 10 (exenta) y
-- 11 (0% sin derecho a crédito). Por eso el CÓDIGO es la llave y la
-- tarifa es un dato derivado, nunca al revés.
CREATE TABLE fact_cat_tarifa_iva (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  tarifa NUMERIC(5,2),
  -- Los códigos 05, 06 y 07 (transitorios) son de uso exclusivo de
  -- notas de crédito y débito.
  solo_en_notas BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 15. El código es el SÍMBOLO ('Kg', 'Unid', 'Sp', 'm³'…), no un
-- número: así va al XML. De ahí VARCHAR y no un entero, y de ahí que el
-- largo sea 20 (el XSD acota UnidadMedidaComercial a 20).
CREATE TABLE fact_cat_unidad_medida (
  codigo      VARCHAR(20) PRIMARY KEY,
  descripcion VARCHAR(200) NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT true
);

-- Nota 13.1 / `Codigodemoneda_V4.4.pdf`. El XSD enumera 178 códigos
-- ISO 4217.
CREATE TABLE fact_cat_moneda (
  codigo VARCHAR(3) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 20: el catálogo de "naturaleza del descuento". El XSD lo llama
-- CodigoDescuentoType y enumera 01..09 y 99.
CREATE TABLE fact_cat_codigo_descuento (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  -- El 99 obliga `CodigoDescuentoOTRO` y la `NaturalezaDescuento`
  -- (bitácora 4.4.0, ajustes 53 y 54).
  exige_detalle BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 10: tipo de documento de referencia (01..20, 99).
CREATE TABLE fact_cat_tipo_doc_referencia (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  exige_detalle BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 9: código de referencia. El XSD de factura enumera
-- 01,02,04..16,99 — sin 03, y el 17 ("Pago a comprobante electrónico")
-- es exclusivo del REP.
CREATE TABLE fact_cat_codigo_referencia (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  exige_detalle BOOLEAN NOT NULL DEFAULT false,
  solo_en_rep BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Nota 18: condición del impuesto del mensaje receptor (01..05). Es lo
-- que define si el IVA de una factura de proveedor es acreditable, así
-- que más adelante alimenta el IVA acreditable.
CREATE TABLE fact_cat_condicion_impuesto (
  codigo VARCHAR(2) PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- CABYS (Nota 17): el catálogo que Hacienda exige en CADA línea de
-- detalle de factura y tiquete, y que NO viene en los anexos — se
-- publica aparte como archivo de datos. La tabla se crea porque el
-- modelo la necesita, y queda vacía hasta que se consiga la fuente; ver
-- "Lo que NO se encontró" en `docs/facturacion/fuentes/LEEME.md`.
CREATE TABLE fact_cat_cabys (
  codigo      VARCHAR(13) PRIMARY KEY CHECK (codigo ~ '^[0-9]{13}$'),
  descripcion TEXT NOT NULL,
  -- Tarifa de IVA que SUGIERE el catálogo. Es sugerida: la que va al
  -- comprobante la decide la línea, porque una exoneración o un régimen
  -- especial la cambian.
  codigo_tarifa_iva_sugerido VARCHAR(2) REFERENCES fact_cat_tarifa_iva(codigo),
  activo      BOOLEAN NOT NULL DEFAULT true
);

-- Búsqueda de CABYS por descripción, que es como la va a usar la
-- pantalla de emisión manual. Mismo mecanismo que la búsqueda tolerante
-- de la migración 090: trigramas sobre el texto sin acentos.
CREATE INDEX idx_fact_cat_cabys_descripcion_trgm
  ON fact_cat_cabys USING gin (inmutable_unaccent(descripcion) gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 2. EMISOR — tabla propia, no columnas en `tenants`.
--
-- El prompt lo pide explícitamente y el motivo es real: el emisor fiscal
-- no es la clínica. Hoy hay uno por tenant (de ahí el UNIQUE), pero una
-- clínica puede facturar a nombre de otra razón social, o un grupo puede
-- tener dos emisores. Con los datos fiscales metidos en `tenants` eso es
-- una migración; con tabla propia es sacar el UNIQUE.
-- ---------------------------------------------------------------------
CREATE TABLE fact_emisores (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  tipo_identificacion   VARCHAR(2) NOT NULL REFERENCES fact_cat_tipo_identificacion(codigo),
  -- 20 y no 12: el XSD acota `Identificacion/Numero` a maxLength 20
  -- (la bitácora 4.4.0 #11 lo amplió para el tipo 05, Extranjero No
  -- Domiciliado). Los 12 dígitos son del armado de la CLAVE, no del
  -- campo.
  numero_identificacion VARCHAR(20) NOT NULL,
  -- XSD: minLength 5, maxLength 100.
  nombre VARCHAR(100) NOT NULL CHECK (char_length(nombre) BETWEEN 5 AND 100),
  -- XSD: opcional, minLength 3, maxLength 80.
  nombre_comercial VARCHAR(80) CHECK (nombre_comercial IS NULL OR char_length(nombre_comercial) >= 3),
  -- XSD: `CodigoActividadEmisor`, obligatorio, EXACTAMENTE 6 (minLength
  -- y maxLength son los dos 6). Es el CIIU 4 inscrito en el ATV.
  codigo_actividad_economica VARCHAR(6) NOT NULL CHECK (codigo_actividad_economica ~ '^[0-9]{6}$'),
  -- XSD: `Registrofiscal8707`, opcional, maxLength 12. Solo aplica a
  -- quien vende bebidas con contenido alcohólico (Ley 8707).
  registro_fiscal_8707 VARCHAR(12),

  -- Ubicación. Provincia 1 dígito, cantón y distrito 2.
  ubicacion_provincia VARCHAR(1) NOT NULL CHECK (ubicacion_provincia ~ '^[1-9]$'),
  ubicacion_canton    VARCHAR(2) NOT NULL CHECK (ubicacion_canton ~ '^[0-9]{2}$'),
  ubicacion_distrito  VARCHAR(2) NOT NULL CHECK (ubicacion_distrito ~ '^[0-9]{2}$'),
  -- En v4.4 el barrio NO es un código: el XSD lo define como string de
  -- 5 a 50 caracteres. Se escribió como VARCHAR(2) en el primer borrador
  -- de esta migración, por analogía con provincia/cantón/distrito, y el
  -- XSD lo desmintió.
  ubicacion_barrio VARCHAR(50) CHECK (ubicacion_barrio IS NULL OR char_length(ubicacion_barrio) >= 5),
  -- XSD: `OtrasSenas` es OBLIGATORIO en el emisor (5 a 250).
  ubicacion_otras_senas VARCHAR(250) NOT NULL CHECK (char_length(ubicacion_otras_senas) BETWEEN 5 AND 250),

  -- XSD: el nodo Telefono completo es opcional, pero si está, sus dos
  -- hijos son obligatorios. CodigoPais 3 dígitos; NumTelefono entre 100
  -- y 20 dígitos.
  telefono_codigo_pais VARCHAR(3) CHECK (telefono_codigo_pais IS NULL OR telefono_codigo_pais ~ '^[0-9]{1,3}$'),
  telefono_numero      VARCHAR(20) CHECK (telefono_numero IS NULL OR telefono_numero ~ '^[0-9]{3,20}$'),
  -- XSD: `CorreoElectronico` del emisor es [1..4], maxLength 160. Acá
  -- se guarda UNO. Emitir con un solo correo del emisor es un
  -- subconjunto válido del esquema; si alguna vez hacen falta los
  -- cuatro, esto pasa a ser una tabla hija — no se agregan
  -- correo_2/correo_3/correo_4.
  correo VARCHAR(160) NOT NULL,

  -- XSD: `ProveedorSistemas`, OBLIGATORIO, maxLength 20. Es la cédula de
  -- quien provee el sistema de facturación. No es la clínica y no es un
  -- dato que la clínica cargue: es el mismo valor para todos los
  -- emisores de Vetline. Vive igual acá, en el emisor, porque es un
  -- campo del XML por emisor y porque un día puede haber un emisor que
  -- facture con otro sistema. El valor por defecto lo pone el backend
  -- desde una variable de entorno, no esta migración.
  proveedor_sistemas VARCHAR(20) NOT NULL,

  -- Sucursal y terminal por defecto. 001 = casa matriz, 00001 = terminal
  -- única o servidor centralizado (Nota 3).
  sucursal VARCHAR(3) NOT NULL DEFAULT '001' CHECK (sucursal ~ '^[0-9]{3}$'),
  terminal VARCHAR(5) NOT NULL DEFAULT '00001' CHECK (terminal ~ '^[0-9]{5}$'),

  -- Qué ambiente usa para emitir. Las credenciales viven por ambiente en
  -- su propia tabla, así que se pueden tener las dos cargadas y cambiar
  -- esto para pasar a producción.
  ambiente_activo VARCHAR(12) NOT NULL DEFAULT 'pruebas'
                  CHECK (ambiente_activo IN ('pruebas', 'produccion')),

  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Hoy uno por clínica. Sacar este UNIQUE es todo lo que hace falta
  -- para admitir varios.
  UNIQUE (tenant_id)
);

CREATE INDEX idx_fact_emisores_tenant ON fact_emisores(tenant_id);

ALTER TABLE fact_emisores ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_emisores FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_emisores_isolation ON fact_emisores
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 3. CREDENCIALES — cifradas en reposo, nunca salen por la API.
--
-- Cifradas con pgcrypto (`pgp_sym_encrypt`), con la clave en una
-- variable de entorno del backend. Por qué el cifrado ocurre en la base
-- y no en TypeScript: así es el ÚNICO camino de escritura. Si cifrara el
-- backend, un INSERT directo o un script de mantenimiento guardaría en
-- claro y nada fallaría.
--
-- Las columnas son BYTEA y se llaman `_cifrada`/`_cifrado` a propósito:
-- el nombre tiene que decir que lo que hay adentro no es legible, para
-- que nadie escriba un SELECT esperando texto.
-- ---------------------------------------------------------------------
CREATE TABLE fact_credenciales (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  emisor_id  UUID NOT NULL REFERENCES fact_emisores(id) ON DELETE CASCADE,
  ambiente   VARCHAR(12) NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),

  -- Usuario de la API de Hacienda. NO se cifra: no es un secreto (lo
  -- genera el ATV a partir de la identificación del contribuyente) y
  -- hace falta poder mostrarlo para que alguien confirme que cargó el
  -- correcto.
  usuario_api VARCHAR(160) NOT NULL,

  -- Secretos. La contraseña la genera el ATV y llega al buzón del
  -- contribuyente (Anexo 3 de ANEXOS_Y_ESTRUCTURAS_V4.4).
  password_api_cifrada BYTEA NOT NULL,
  -- La llave criptográfica .p12 y su PIN.
  llave_p12_cifrada    BYTEA NOT NULL,
  pin_llave_cifrado    BYTEA NOT NULL,

  -- En claro, porque es lo único de este registro que la API devuelve:
  -- hace falta para avisar antes de que la llave venza.
  llave_vence_en DATE,
  -- Nombre del archivo que se subió, para que se vea QUÉ se cargó sin
  -- ver el contenido.
  llave_nombre_archivo VARCHAR(200),

  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (emisor_id, ambiente)
);

CREATE INDEX idx_fact_credenciales_tenant ON fact_credenciales(tenant_id);

ALTER TABLE fact_credenciales ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_credenciales FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_credenciales_isolation ON fact_credenciales
  USING (tenant_id::text = current_setting('app.tenant_id', true));

COMMENT ON TABLE fact_credenciales IS
  'Credenciales de Hacienda por emisor y ambiente. Las columnas _cifrada/_cifrado están cifradas con pgcrypto y NUNCA se devuelven por la API ni se escriben en logs ni en la bitácora. Lo único publicable de esta tabla es: si existe la fila, su ambiente, usuario_api, llave_vence_en y llave_nombre_archivo.';

-- ---------------------------------------------------------------------
-- 4. CONSECUTIVOS — el contador, con su llave igual al alcance que la
-- norma define: emisor, sucursal, terminal y tipo de comprobante.
--
-- Tabla aparte y no una columna en `fact_emisores` porque el consecutivo
-- NO es uno por emisor: la Nota 3 lo define "para cada sucursal o
-- terminal según sea el caso", y además por tipo de comprobante. Un
-- emisor con dos terminales y cinco tipos tiene diez contadores.
--
-- `ultimo_numero` arranca en 0 (el primero emitido es el 1, Nota 3) pero
-- se puede fijar en otro valor: quien venga de otro sistema "deberá
-- mantener la numeración consecutiva" (Nota 3). Es el mismo problema que
-- `tenants.paciente_expediente_ultimo_numero` ya resolvió en la 087.
-- ---------------------------------------------------------------------
CREATE TABLE fact_consecutivos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  emisor_id UUID NOT NULL REFERENCES fact_emisores(id) ON DELETE CASCADE,
  sucursal  VARCHAR(3) NOT NULL CHECK (sucursal ~ '^[0-9]{3}$'),
  terminal  VARCHAR(5) NOT NULL CHECK (terminal ~ '^[0-9]{5}$'),
  tipo_comprobante VARCHAR(2) NOT NULL REFERENCES fact_cat_tipo_comprobante(codigo),

  -- Las posiciones 11-20 del consecutivo: diez dígitos, así que el tope
  -- es 9.999.999.999. BIGINT y no INTEGER por eso.
  ultimo_numero BIGINT NOT NULL DEFAULT 0
                CHECK (ultimo_numero >= 0 AND ultimo_numero <= 9999999999),

  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (emisor_id, sucursal, terminal, tipo_comprobante)
);

CREATE INDEX idx_fact_consecutivos_tenant ON fact_consecutivos(tenant_id);

ALTER TABLE fact_consecutivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_consecutivos FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_consecutivos_isolation ON fact_consecutivos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 5. COMPROBANTES
--
-- El XML firmado se guarda textual, así que estas columnas no son la
-- fuente del documento: son lo que hace falta para ARMARLO, para
-- mostrarlo y para filtrar un listado sin parsear XML. El XML manda si
-- alguna vez difieren, y por eso es inmutable (ver el trigger al final).
-- ---------------------------------------------------------------------
CREATE TABLE fact_comprobantes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  emisor_id UUID NOT NULL REFERENCES fact_emisores(id) ON DELETE CASCADE,

  tipo_comprobante VARCHAR(2) NOT NULL REFERENCES fact_cat_tipo_comprobante(codigo),

  -- 50 posiciones. El XSD la define como `[a-zA-Z0-9]{50,50}`, pero la
  -- composición de la Nota 3 es toda numérica, así que para lo que
  -- EMITIMOS el CHECK exige dígitos: ser más estricto que el esquema en
  -- lo propio es correcto. (En `fact_recibidos`, que guarda claves de
  -- terceros, se usa el patrón del XSD — ver ahí.)
  clave VARCHAR(50) NOT NULL CHECK (clave ~ '^[0-9]{50}$'),
  -- 20 posiciones, `\d{20,20}` en el XSD.
  consecutivo VARCHAR(20) NOT NULL CHECK (consecutivo ~ '^[0-9]{20}$'),
  sucursal VARCHAR(3) NOT NULL CHECK (sucursal ~ '^[0-9]{3}$'),
  terminal VARCHAR(5) NOT NULL CHECK (terminal ~ '^[0-9]{5}$'),

  -- Posición 42 de la clave: 1 Normal, 2 Contingencia, 3 Sin internet.
  -- OJO: "Contingencia" NO significa "Hacienda no respondió" — significa
  -- que este comprobante sustituye un documento FÍSICO emitido en
  -- contingencia. Ver la advertencia en datos-oficiales.md.
  situacion VARCHAR(1) NOT NULL DEFAULT '1' CHECK (situacion IN ('1', '2', '3')),

  -- Con qué versión se emitió. Hace falta: una nota de crédito que
  -- ajusta un comprobante de 4.3 tiene que generarse en 4.3.
  version VARCHAR(5) NOT NULL DEFAULT '4.4',

  fecha_emision TIMESTAMPTZ NOT NULL,

  -- Actividad económica. La del emisor es obligatoria en el XML (salvo
  -- en el REP, que no la lleva); la del receptor es opcional.
  codigo_actividad_emisor   VARCHAR(6) CHECK (codigo_actividad_emisor IS NULL OR codigo_actividad_emisor ~ '^[0-9]{6}$'),
  codigo_actividad_receptor VARCHAR(6) CHECK (codigo_actividad_receptor IS NULL OR codigo_actividad_receptor ~ '^[0-9]{6}$'),

  -- Receptor. Todo nullable porque el tiquete electrónico puede no
  -- identificarlo y el nodo de ubicación es condicional en factura.
  receptor_tipo_identificacion   VARCHAR(2) REFERENCES fact_cat_tipo_identificacion(codigo),
  receptor_numero_identificacion VARCHAR(20),
  receptor_nombre                VARCHAR(100),
  receptor_nombre_comercial      VARCHAR(80),
  receptor_correo                VARCHAR(160),
  receptor_telefono_codigo_pais  VARCHAR(3),
  receptor_telefono_numero       VARCHAR(20),
  receptor_ubicacion_provincia   VARCHAR(1),
  receptor_ubicacion_canton      VARCHAR(2),
  receptor_ubicacion_distrito    VARCHAR(2),
  receptor_ubicacion_barrio      VARCHAR(50),
  receptor_ubicacion_otras_senas VARCHAR(250),
  -- XSD: `OtrasSenasExtranjero`, 5 a 300. Para un receptor no
  -- domiciliado, que no tiene provincia/cantón/distrito de Costa Rica.
  receptor_otras_senas_extranjero VARCHAR(300),

  condicion_venta VARCHAR(2) NOT NULL REFERENCES fact_cat_condicion_venta(codigo),
  -- XSD: `CondicionVentaOtros`, 5 a 100. Obligatorio si la condición es 99.
  condicion_venta_detalle VARCHAR(100),
  -- XSD: `PlazoCredito`, entero de 5 dígitos, en DÍAS (bitácora 4.4.0
  -- #35; en 4.3 era texto libre).
  plazo_credito_dias INTEGER CHECK (plazo_credito_dias IS NULL OR plazo_credito_dias BETWEEN 0 AND 99999),

  moneda VARCHAR(3) NOT NULL DEFAULT 'CRC' REFERENCES fact_cat_moneda(codigo),
  -- XSD: `TipoCambio` es obligatorio dentro del nodo de moneda. Para CRC
  -- vale 1.
  tipo_cambio NUMERIC(18,5) NOT NULL DEFAULT 1 CHECK (tipo_cambio > 0),

  -- Resumen. NUMERIC(18,5) exactamente como el `DecimalDineroType` del
  -- XSD (totalDigits 18, fractionDigits 5). Nunca float: son montos.
  --
  -- El XSD define más totales que los cuatro obvios, y los cuatro
  -- "estados" del IVA son distintos entre sí: gravado, exento (tarifa
  -- 10), exonerado (con documento de exoneración) y no sujeto. Juntarlos
  -- en una sola columna "exentos" perdería información que Hacienda
  -- distingue.
  total_serv_gravados   NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_serv_exentos    NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_serv_exonerado  NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_serv_no_sujeto  NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_merc_gravadas   NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_merc_exentas    NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_merc_exonerada  NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_merc_no_sujeta  NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_gravado         NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_exento          NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_exonerado       NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_no_sujeto       NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_venta           NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_descuentos      NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_venta_neta      NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_impuesto        NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_imp_asum_emisor_fabrica NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_iva_devuelto    NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_otros_cargos    NUMERIC(18,5) NOT NULL DEFAULT 0,
  total_comprobante     NUMERIC(18,5) NOT NULL DEFAULT 0,

  -- Estado INTERNO del motor. Es distinto de la `situacion` de la clave
  -- y distinto del `indEstado` que devuelve Hacienda (que se guarda
  -- aparte y sin interpretar, en `respuesta_ind_estado`).
  estado VARCHAR(20) NOT NULL DEFAULT 'borrador'
         CHECK (estado IN ('borrador', 'firmado', 'en_cola', 'enviado',
                           'aceptado', 'aceptado_parcial', 'rechazado', 'error')),

  -- El XML firmado EXACTO que se envió y la respuesta EXACTA de
  -- Hacienda. Los dos inmutables una vez escritos (ver el trigger).
  xml_firmado BYTEA,
  respuesta_xml BYTEA,
  -- `indEstado` tal como lo devuelve Hacienda, sin traducir.
  respuesta_ind_estado VARCHAR(30),
  respuesta_recibida_en TIMESTAMPTZ,
  -- El motivo del rechazo tal cual viene, sin reescribir.
  respuesta_detalle TEXT,

  -- Idempotencia: la misma solicitud no genera dos comprobantes.
  clave_idempotencia VARCHAR(80),

  -- Para notas de crédito y débito: a qué comprobante nuestro corrigen.
  -- Nullable porque una nota puede referenciar un comprobante que no
  -- emitimos nosotros (ahí el dato vive en fact_comprobante_referencias,
  -- que es lo que va al XML; esta columna es solo el atajo para
  -- navegar).
  comprobante_referencia_id UUID REFERENCES fact_comprobantes(id),

  enviado_en TIMESTAMPTZ,
  intentos_envio INTEGER NOT NULL DEFAULT 0,
  proximo_intento_en TIMESTAMPTZ,

  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- REGLA EN LA BASE: clave numérica de 50 dígitos única. Global y no
  -- por emisor: la clave lleva la cédula del emisor adentro, así que dos
  -- emisores no pueden colisionar legítimamente, y un choque global
  -- significa un error de armado que hay que ver.
  CONSTRAINT fact_comprobantes_clave_unica UNIQUE (clave),

  -- REGLA EN LA BASE: consecutivo único por emisor, sucursal, terminal y
  -- tipo. El consecutivo codifica sucursal, terminal y tipo en sus
  -- primeras 10 posiciones, así que único por (emisor, consecutivo) ES
  -- único por los cuatro — y además impide que dos consecutivos iguales
  -- se atribuyan a sucursales distintas.
  CONSTRAINT fact_comprobantes_consecutivo_unico UNIQUE (emisor_id, consecutivo),

  -- REGLA EN LA BASE: una misma solicitud de emisión no genera dos
  -- comprobantes. NULL no choca con NULL en Postgres, así que una
  -- emisión sin clave de idempotencia (la pantalla propia) no queda
  -- limitada a una sola.
  CONSTRAINT fact_comprobantes_idempotencia_unica UNIQUE (emisor_id, clave_idempotencia)
);

CREATE INDEX idx_fact_comprobantes_tenant_fecha ON fact_comprobantes(tenant_id, fecha_emision DESC);
CREATE INDEX idx_fact_comprobantes_emisor ON fact_comprobantes(emisor_id);
-- Índice parcial: la cola de reenvío solo mira estos dos estados, y son
-- una minoría de las filas.
CREATE INDEX idx_fact_comprobantes_cola ON fact_comprobantes(proximo_intento_en)
  WHERE estado IN ('en_cola', 'enviado');
CREATE INDEX idx_fact_comprobantes_referencia ON fact_comprobantes(comprobante_referencia_id)
  WHERE comprobante_referencia_id IS NOT NULL;
CREATE INDEX idx_fact_comprobantes_receptor ON fact_comprobantes(tenant_id, receptor_numero_identificacion)
  WHERE receptor_numero_identificacion IS NOT NULL;

ALTER TABLE fact_comprobantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_comprobantes FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_comprobantes_isolation ON fact_comprobantes
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 6. TENANT_ID EN LAS TABLAS HIJAS, DERIVADO Y NO COPIADO
--
-- Las hijas (líneas, impuestos, descuentos, medios de pago,
-- referencias, otros cargos, eventos) llevan `tenant_id` porque el
-- prompt lo pide para TODAS las tablas, y porque la auditoría de RLS
-- (`jobs/auditoriaRls.job.ts`) solo mira tablas que tengan esa columna:
-- sin ella, una hija sin RLS pasa desapercibida para siempre.
--
-- Pero un tenant_id copiado a mano en siete tablas es exactamente el
-- defecto de "un dato en dos lugares que pueden divergir". La salida es
-- que NO se escriba a mano: un trigger lo deriva del padre en cada
-- INSERT e impide cambiarlo. Es una columna derivada, no una copia.
--
-- Una sola función genérica para las siete, parametrizada por el nombre
-- de la columna que apunta al padre y la tabla padre.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fact_derivar_tenant_del_padre()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  columna_padre TEXT := TG_ARGV[0];
  tabla_padre   TEXT := TG_ARGV[1];
  id_padre      UUID;
  tenant_padre  UUID;
BEGIN
  -- `to_jsonb(NEW) ->> columna` y no `EXECUTE 'SELECT ($1).col' USING NEW`:
  -- al pasar NEW como parámetro el planificador lo ve como RECORD sin
  -- columnas conocidas y falla con "could not identify column". jsonb no
  -- necesita saber el tipo.
  id_padre := (to_jsonb(NEW) ->> columna_padre)::uuid;

  IF id_padre IS NULL THEN
    RAISE EXCEPTION '%.% no puede ser NULL: de ahí se deriva el tenant_id.',
      TG_TABLE_NAME, columna_padre USING ERRCODE = 'not_null_violation';
  END IF;

  EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', tabla_padre)
    INTO tenant_padre USING id_padre;

  IF tenant_padre IS NULL THEN
    RAISE EXCEPTION 'No existe %.id = % — no se puede derivar el tenant_id de %.',
      tabla_padre, id_padre, TG_TABLE_NAME USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- En UPDATE: el tenant no se reasigna. Mover una fila de clínica es
  -- siempre un error, y en silencio sería una fuga entre tenants.
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION '%.tenant_id no se puede cambiar (% -> %).',
      TG_TABLE_NAME, OLD.tenant_id, NEW.tenant_id USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.tenant_id := tenant_padre;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fact_derivar_tenant_del_padre() IS
  'Deriva tenant_id de la fila padre. Argumentos del trigger: [0] nombre de la columna FK al padre, [1] nombre de la tabla padre. Hace que tenant_id en las tablas hijas sea derivado y no una copia que pueda divergir.';

-- ---------------------------------------------------------------------
-- 7. LÍNEAS DE DETALLE
-- ---------------------------------------------------------------------
CREATE TABLE fact_comprobante_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES fact_comprobantes(id) ON DELETE CASCADE,
  -- XSD: `LineaDetalle` es [1..1000] y `NumeroLinea` va de 1 a 1000.
  -- (El tope de 60 líneas que menciona la bitácora de 2011 está
  -- obsoleto: los siete XSD de 4.4 dicen 1000.)
  numero_linea INTEGER NOT NULL CHECK (numero_linea BETWEEN 1 AND 1000),

  -- CABYS: 13 dígitos exactos. SIN FK al catálogo a propósito: el
  -- catálogo todavía no se pudo cargar (ver LEEME.md) y una FK a una
  -- tabla vacía haría imposible emitir. La FK se agrega en la migración
  -- que cargue CABYS.
  -- Nullable porque el REP no lleva CABYS en sus líneas (su XSD solo
  -- tiene Detalle, MontoTotal, SubTotal, Impuesto, ImpuestoNeto y
  -- MontoTotalLinea).
  codigo_cabys VARCHAR(13) CHECK (codigo_cabys IS NULL OR codigo_cabys ~ '^[0-9]{13}$'),

  -- XSD: `CodigoComercial` es [0..5]. Acá va UNO: el código interno del
  -- producto o servicio de la clínica, que es el único que una clínica
  -- veterinaria tiene. Si hicieran falta los cinco, pasa a tabla hija.
  codigo_comercial_tipo VARCHAR(2)
    CHECK (codigo_comercial_tipo IS NULL OR codigo_comercial_tipo IN ('01','02','03','04','99')),
  codigo_comercial      VARCHAR(20),

  -- XSD: decimal(16,3).
  cantidad NUMERIC(16,3) NOT NULL CHECK (cantidad > 0),
  unidad_medida VARCHAR(20) NOT NULL REFERENCES fact_cat_unidad_medida(codigo),
  unidad_medida_comercial VARCHAR(20),
  -- Nota 22: tipo de transacción (01 venta normal, autoconsumos, bienes
  -- de capital…). Opcional en el XSD.
  tipo_transaccion VARCHAR(2),
  -- XSD: 3 a 200.
  detalle VARCHAR(200) NOT NULL CHECK (char_length(detalle) BETWEEN 3 AND 200),

  -- Campos de medicamentos. Relevantes para una veterinaria que
  -- dispensa; el XSD los define opcionales.
  registro_medicamento VARCHAR(100),
  -- Nota 19, catálogo "Código de forma Farmacéutica" — que NO se
  -- descargó (ver LEEME.md). Se guarda el código tal cual; sin FK.
  forma_farmaceutica VARCHAR(3),

  precio_unitario NUMERIC(18,5) NOT NULL CHECK (precio_unitario >= 0),
  monto_total     NUMERIC(18,5) NOT NULL CHECK (monto_total >= 0),
  subtotal        NUMERIC(18,5) NOT NULL CHECK (subtotal >= 0),
  -- Nota 21 / `IVACobradoFabrica`: 01 o 02, solo para el sistema
  -- especial de IVA a nivel de fábrica.
  iva_cobrado_fabrica VARCHAR(2)
    CHECK (iva_cobrado_fabrica IS NULL OR iva_cobrado_fabrica IN ('01','02')),
  -- XSD: `BaseImponible` es OBLIGATORIO en la línea desde 4.4
  -- (bitácora #58). Se calcula, no lo manda quien factura.
  base_imponible NUMERIC(18,5) NOT NULL DEFAULT 0 CHECK (base_imponible >= 0),
  impuesto_asumido_emisor_fabrica NUMERIC(18,5) NOT NULL DEFAULT 0,
  impuesto_neto     NUMERIC(18,5) NOT NULL DEFAULT 0,
  monto_total_linea NUMERIC(18,5) NOT NULL CHECK (monto_total_linea >= 0),

  UNIQUE (comprobante_id, numero_linea)
);

CREATE INDEX idx_fact_lineas_tenant ON fact_comprobante_lineas(tenant_id);
CREATE INDEX idx_fact_lineas_comprobante ON fact_comprobante_lineas(comprobante_id);

CREATE TRIGGER fact_lineas_tenant_derivado
  BEFORE INSERT OR UPDATE ON fact_comprobante_lineas
  FOR EACH ROW EXECUTE FUNCTION fact_derivar_tenant_del_padre('comprobante_id', 'fact_comprobantes');

ALTER TABLE fact_comprobante_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_comprobante_lineas FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_comprobante_lineas_isolation ON fact_comprobante_lineas
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 8. IMPUESTOS DE LA LÍNEA (con su exoneración)
--
-- El XSD exige al menos un `Impuesto` por línea en factura y tiquete.
-- Una línea exenta NO va sin impuesto: va con código 01 (IVA) y código
-- de tarifa 10 (exenta). Es la diferencia entre "no cobré IVA" y "no
-- declaré nada sobre el IVA".
--
-- `Exoneracion` es [0..1] dentro de cada impuesto, así que sus campos
-- viven acá con prefijo `exoneracion_` en vez de en una tabla 1:1.
-- ---------------------------------------------------------------------
CREATE TABLE fact_linea_impuestos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  linea_id UUID NOT NULL REFERENCES fact_comprobante_lineas(id) ON DELETE CASCADE,

  codigo_impuesto VARCHAR(2) NOT NULL REFERENCES fact_cat_codigo_impuesto(codigo),
  -- Obligatorio si el código es 99.
  codigo_impuesto_otro VARCHAR(100),
  -- Solo aplica al IVA (códigos 01 y 07). Un impuesto específico no
  -- tiene código de tarifa.
  codigo_tarifa_iva VARCHAR(2) REFERENCES fact_cat_tarifa_iva(codigo),
  -- XSD: decimal(4,2) — alcanza para 13.00 y para 0.50.
  tarifa NUMERIC(4,2),
  -- XSD: `FactorCalculoIVA` decimal(5,4). Para el régimen de bienes
  -- usados (código de impuesto 08).
  factor_calculo_iva NUMERIC(5,4),

  -- Nodo `DatosImpuestoEspecifico`, obligatorio para los impuestos
  -- específicos (combustibles, alcohol, tabaco, cemento…).
  esp_cantidad_unidad_medida NUMERIC(7,2),
  esp_porcentaje             NUMERIC(4,2),
  esp_proporcion             NUMERIC(10,5),
  esp_volumen_unidad_consumo NUMERIC(7,2),
  esp_impuesto_unidad        NUMERIC(18,5),

  monto NUMERIC(18,5) NOT NULL DEFAULT 0 CHECK (monto >= 0),

  -- Nodo `Exoneracion`. Nota 10.1 (tipo de documento) y Nota 23 (nombre
  -- de la institución).
  exoneracion_tipo_documento      VARCHAR(2),
  exoneracion_tipo_documento_otro VARCHAR(100),
  exoneracion_numero_documento    VARCHAR(40),
  exoneracion_articulo            INTEGER,
  exoneracion_inciso              INTEGER,
  exoneracion_nombre_institucion  VARCHAR(2),
  exoneracion_nombre_institucion_otros VARCHAR(160),
  exoneracion_fecha_emision       TIMESTAMPTZ,
  exoneracion_tarifa_exonerada    NUMERIC(4,2),
  exoneracion_monto               NUMERIC(18,5)
);

CREATE INDEX idx_fact_linea_impuestos_tenant ON fact_linea_impuestos(tenant_id);
CREATE INDEX idx_fact_linea_impuestos_linea ON fact_linea_impuestos(linea_id);

CREATE TRIGGER fact_linea_impuestos_tenant_derivado
  BEFORE INSERT OR UPDATE ON fact_linea_impuestos
  FOR EACH ROW EXECUTE FUNCTION fact_derivar_tenant_del_padre('linea_id', 'fact_comprobante_lineas');

ALTER TABLE fact_linea_impuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_linea_impuestos FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_linea_impuestos_isolation ON fact_linea_impuestos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 9. DESCUENTOS DE LA LÍNEA
-- ---------------------------------------------------------------------
CREATE TABLE fact_linea_descuentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  linea_id UUID NOT NULL REFERENCES fact_comprobante_lineas(id) ON DELETE CASCADE,

  monto NUMERIC(18,5) NOT NULL CHECK (monto >= 0),
  -- XSD: `CodigoDescuento` es OBLIGATORIO en 4.4 (bitácora #52), con el
  -- catálogo de la Nota 20.
  codigo_descuento VARCHAR(2) NOT NULL REFERENCES fact_cat_codigo_descuento(codigo),
  -- Obligatorio si el código es 99 (bitácora #53).
  codigo_descuento_otro VARCHAR(100),
  -- XSD: `NaturalezaDescuento`, 3 a 80. Obligatoria cuando el código es
  -- 99 (bitácora #54).
  naturaleza VARCHAR(80)
);

CREATE INDEX idx_fact_linea_descuentos_tenant ON fact_linea_descuentos(tenant_id);
CREATE INDEX idx_fact_linea_descuentos_linea ON fact_linea_descuentos(linea_id);

CREATE TRIGGER fact_linea_descuentos_tenant_derivado
  BEFORE INSERT OR UPDATE ON fact_linea_descuentos
  FOR EACH ROW EXECUTE FUNCTION fact_derivar_tenant_del_padre('linea_id', 'fact_comprobante_lineas');

ALTER TABLE fact_linea_descuentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_linea_descuentos FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_linea_descuentos_isolation ON fact_linea_descuentos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 10. MEDIOS DE PAGO
--
-- En v4.4 el medio de pago va en el RESUMEN del comprobante, no en el
-- encabezado (bitácora #36) — de ahí que cuelgue del comprobante y no
-- sea una columna suya: el XSD admite hasta cuatro, cada uno con su
-- monto (pago mixto).
-- ---------------------------------------------------------------------
CREATE TABLE fact_comprobante_medios_pago (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES fact_comprobantes(id) ON DELETE CASCADE,
  codigo_medio_pago VARCHAR(2) NOT NULL REFERENCES fact_cat_medio_pago(codigo),
  -- Obligatorio si el código es 99.
  medio_pago_otro VARCHAR(100),
  monto NUMERIC(18,5) CHECK (monto IS NULL OR monto >= 0)
);

CREATE INDEX idx_fact_medios_pago_tenant ON fact_comprobante_medios_pago(tenant_id);
CREATE INDEX idx_fact_medios_pago_comprobante ON fact_comprobante_medios_pago(comprobante_id);

CREATE TRIGGER fact_medios_pago_tenant_derivado
  BEFORE INSERT OR UPDATE ON fact_comprobante_medios_pago
  FOR EACH ROW EXECUTE FUNCTION fact_derivar_tenant_del_padre('comprobante_id', 'fact_comprobantes');

ALTER TABLE fact_comprobante_medios_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_comprobante_medios_pago FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_comprobante_medios_pago_isolation ON fact_comprobante_medios_pago
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 11. REFERENCIAS — una nota apunta al comprobante que corrige.
-- ---------------------------------------------------------------------
CREATE TABLE fact_comprobante_referencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES fact_comprobantes(id) ON DELETE CASCADE,

  tipo_documento VARCHAR(2) NOT NULL REFERENCES fact_cat_tipo_doc_referencia(codigo),
  tipo_documento_otro VARCHAR(100),
  -- La clave de 50 del comprobante referenciado (o su consecutivo, o el
  -- número de un documento físico). XSD: maxLength 50, sin patrón.
  numero VARCHAR(50),
  -- XSD: `FechaEmisionIR` es obligatoria.
  fecha_emision TIMESTAMPTZ NOT NULL,
  codigo VARCHAR(2) REFERENCES fact_cat_codigo_referencia(codigo),
  codigo_otro VARCHAR(100),
  razon VARCHAR(180)
);

CREATE INDEX idx_fact_referencias_tenant ON fact_comprobante_referencias(tenant_id);
CREATE INDEX idx_fact_referencias_comprobante ON fact_comprobante_referencias(comprobante_id);
-- Para encontrar "qué notas corrigen esta clave", que es lo que necesita
-- la pantalla de detalle.
CREATE INDEX idx_fact_referencias_numero ON fact_comprobante_referencias(tenant_id, numero);

CREATE TRIGGER fact_referencias_tenant_derivado
  BEFORE INSERT OR UPDATE ON fact_comprobante_referencias
  FOR EACH ROW EXECUTE FUNCTION fact_derivar_tenant_del_padre('comprobante_id', 'fact_comprobantes');

ALTER TABLE fact_comprobante_referencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_comprobante_referencias FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_comprobante_referencias_isolation ON fact_comprobante_referencias
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 12. OTROS CARGOS — Nota 16. El XSD admite hasta 15.
--
-- Para una veterinaria el caso concreto es el timbre de colegio
-- profesional (código 07) y los intereses moratorios (10).
-- ---------------------------------------------------------------------
CREATE TABLE fact_comprobante_otros_cargos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES fact_comprobantes(id) ON DELETE CASCADE,

  -- Nota 16: 01..10, 99. Sin tabla de catálogo propia: son once valores
  -- fijos que no se cargan de ningún archivo, igual criterio que el
  -- CHECK de `tenant_modulos.modulo` (migración 086).
  tipo_documento VARCHAR(2) NOT NULL
    CHECK (tipo_documento IN ('01','02','03','04','05','06','07','08','09','10','99')),
  tipo_documento_otros VARCHAR(100),
  -- Si el cargo lo cobra un tercero (p. ej. el colegio profesional).
  tercero_tipo_identificacion VARCHAR(2) REFERENCES fact_cat_tipo_identificacion(codigo),
  tercero_numero_identificacion VARCHAR(20),
  tercero_nombre VARCHAR(100),
  detalle VARCHAR(160) NOT NULL,
  porcentaje NUMERIC(9,5),
  monto NUMERIC(18,5) NOT NULL CHECK (monto >= 0)
);

CREATE INDEX idx_fact_otros_cargos_tenant ON fact_comprobante_otros_cargos(tenant_id);
CREATE INDEX idx_fact_otros_cargos_comprobante ON fact_comprobante_otros_cargos(comprobante_id);

CREATE TRIGGER fact_otros_cargos_tenant_derivado
  BEFORE INSERT OR UPDATE ON fact_comprobante_otros_cargos
  FOR EACH ROW EXECUTE FUNCTION fact_derivar_tenant_del_padre('comprobante_id', 'fact_comprobantes');

ALTER TABLE fact_comprobante_otros_cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_comprobante_otros_cargos FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_comprobante_otros_cargos_isolation ON fact_comprobante_otros_cargos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 13. EVENTOS — tabla que SOLO SE AGREGA.
--
-- El estado actual del comprobante se deriva de acá.
-- `fact_comprobantes.estado` existe como caché de esa derivación (para
-- poder indexar y filtrar un listado), pero la historia es esta tabla:
-- es la que explica POR QUÉ un comprobante está como está, que es
-- justamente lo que hace falta cuando Hacienda rechaza algo.
--
-- Solo-agregar se impone con un trigger, no con una convención.
-- ---------------------------------------------------------------------
CREATE TABLE fact_comprobante_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES fact_comprobantes(id) ON DELETE CASCADE,
  tipo_evento VARCHAR(30) NOT NULL
    CHECK (tipo_evento IN ('creado', 'firmado', 'enviado', 'respuesta_recibida',
                           'reintento', 'contingencia', 'anulado_por_nota', 'error')),
  -- JSONB y no texto: lo que hay que guardar cambia según el evento (el
  -- motivo del rechazo, el número de intento, el código HTTP). Nunca
  -- credenciales: el módulo de envío las excluye antes de escribir acá.
  detalle JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fact_eventos_tenant ON fact_comprobante_eventos(tenant_id);
CREATE INDEX idx_fact_eventos_comprobante ON fact_comprobante_eventos(comprobante_id, creado_en);

CREATE TRIGGER fact_eventos_tenant_derivado
  BEFORE INSERT ON fact_comprobante_eventos
  FOR EACH ROW EXECUTE FUNCTION fact_derivar_tenant_del_padre('comprobante_id', 'fact_comprobantes');

ALTER TABLE fact_comprobante_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_comprobante_eventos FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_comprobante_eventos_isolation ON fact_comprobante_eventos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------
-- 14. COMPROBANTES RECIBIDOS de proveedores + mensaje receptor
-- ---------------------------------------------------------------------
CREATE TABLE fact_recibidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  emisor_id UUID NOT NULL REFERENCES fact_emisores(id) ON DELETE CASCADE,

  -- La clave del comprobante del proveedor. Acá el patrón es el del XSD
  -- (`[a-zA-Z0-9]{50,50}`) y NO solo dígitos: esta clave la armó un
  -- tercero, y rechazar un XML que Hacienda considera válido sería un
  -- defecto nuestro.
  clave VARCHAR(50) NOT NULL CHECK (clave ~ '^[a-zA-Z0-9]{50}$'),
  xml_recibido BYTEA NOT NULL,

  -- Datos extraídos del XML, para el listado. El XML manda.
  emisor_nombre VARCHAR(100),
  emisor_identificacion VARCHAR(20),
  tipo_comprobante VARCHAR(2) REFERENCES fact_cat_tipo_comprobante(codigo),
  consecutivo VARCHAR(20),
  fecha_emision TIMESTAMPTZ,
  total_comprobante NUMERIC(18,5),
  total_impuesto NUMERIC(18,5),
  moneda VARCHAR(3),

  -- Resultado de validar el XML contra el XSD oficial.
  validacion_ok BOOLEAN,
  validacion_detalle TEXT,

  -- El mensaje receptor emitido. El código del mensaje es 1, 2 o 3 — un
  -- ENTERO de un dígito en el XSD (`Mensaje`), no '01'/'02'/'03'. Es el
  -- único catálogo de v4.4 que no usa dos dígitos, y confundirlo produce
  -- un XML que no valida.
  mensaje_tipo VARCHAR(1) CHECK (mensaje_tipo IS NULL OR mensaje_tipo IN ('1', '2', '3')),
  mensaje_consecutivo VARCHAR(20)
    CHECK (mensaje_consecutivo IS NULL OR mensaje_consecutivo ~ '^[0-9]{20}$'),
  -- Nota 18, obligatorio para poder calcular el IVA acreditable.
  mensaje_condicion_impuesto VARCHAR(2) REFERENCES fact_cat_condicion_impuesto(codigo),
  mensaje_monto_impuesto_acreditar NUMERIC(18,5),
  mensaje_monto_gasto_aplicable NUMERIC(18,5),
  -- XSD: `DetalleMensaje`, maxLength 160.
  mensaje_detalle VARCHAR(160),
  mensaje_xml_firmado BYTEA,
  mensaje_respuesta_xml BYTEA,
  mensaje_ind_estado VARCHAR(30),
  mensaje_enviado_en TIMESTAMPTZ,

  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- El mismo comprobante de proveedor no se carga dos veces.
  UNIQUE (emisor_id, clave)
);

CREATE INDEX idx_fact_recibidos_tenant_fecha ON fact_recibidos(tenant_id, fecha_emision DESC);

ALTER TABLE fact_recibidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_recibidos FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_recibidos_isolation ON fact_recibidos
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- =====================================================================
-- 15. REGLAS IMPUESTAS EN LA BASE
--
-- Las de unicidad ya están arriba como constraints. Las que siguen
-- necesitan trigger porque son reglas sobre la TRANSICIÓN de una fila,
-- no sobre su contenido, y eso un CHECK no lo puede expresar.
--
-- Por qué en la base y no solo en el backend: la guía rectora lo pide
-- para lo que mueve dinero, y un comprobante fiscal enviado a Hacienda
-- es exactamente eso. Un script de mantenimiento, una consola de psql o
-- un segundo backend que borre un comprobante enviado le genera a la
-- clínica un problema tributario que no se arregla con un rollback.
-- =====================================================================

-- ---------------------------------------------------------------------
-- UNA OPERACIÓN DIRECTA vs. LA PURGA DE LA CLÍNICA
--
-- Esto no estaba en el primer borrador y lo encontró la verificación: con
-- los triggers de abajo sin excepción, `DELETE FROM tenants` fallaba con
--
--   "No se puede borrar el comprobante … ya fue enviado a Hacienda"
--
-- o sea que UNA clínica con una sola factura aceptada ya no se podía
-- purgar nunca. Es exactamente el modo de falla que la auditoría de RLS
-- vigila para las FK sin cascada (`purga.ts::ejecutarPurgas` hace
-- ROLLBACK dentro de un catch y la clínica queda colgada), y la auditoría
-- NO lo habría detectado: la FK a `tenants` acá sí es CASCADE — lo que
-- bloqueaba era el trigger.
--
-- La regla correcta es "nadie borra un comprobante enviado", no "este
-- comprobante es indestructible": cuando se elimina la clínica entera —
-- después de su ventana de purga y su exportación— los comprobantes se
-- van con ella.
--
-- `pg_trigger_depth() = 1` es justamente "alguien ejecutó un DELETE
-- directo contra esta tabla". Medido, no supuesto:
--
--   DELETE FROM fact_comprobantes       -> profundidad 1  (hay que bloquear)
--   DELETE FROM tenants (cascada)       -> profundidad 2  (hay que permitir)
--   cascada a las líneas, en los dos casos -> profundidad 2
--
-- Las hijas se guían por lo mismo: si el borrado del comprobante pasó,
-- sus líneas tienen que irse con él.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fact_es_operacion_directa()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT pg_trigger_depth() = 1;
$$;

COMMENT ON FUNCTION fact_es_operacion_directa() IS
  'true si el trigger actual lo disparó una sentencia directa contra la tabla, false si viene de una cascada (p. ej. DELETE FROM tenants en la purga).';

-- Qué cuenta como "ya salió para Hacienda". Una sola definición, usada
-- por los tres triggers: si estuviera escrita tres veces, un estado
-- nuevo se agregaría en dos y se olvidaría en el tercero.
CREATE OR REPLACE FUNCTION fact_estado_ya_enviado(estado TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  -- 'rechazado' está adentro a propósito: un rechazado tampoco se borra
  -- ni se edita. La corrección es un comprobante NUEVO, y el rechazado
  -- queda como constancia de lo que pasó.
  SELECT estado IN ('enviado', 'aceptado', 'aceptado_parcial', 'rechazado');
$$;

-- REGLA 1: un comprobante enviado a Hacienda no se borra.
-- Un 'borrador' o un 'firmado' que nunca salió sí se puede borrar:
-- todavía no existe para Hacienda. (El consecutivo que consumió no se
-- devuelve, y está bien: la Nota 3 pide numeración consecutiva, no sin
-- huecos.)
CREATE OR REPLACE FUNCTION fact_impedir_borrado_enviado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- La purga de la clínica borra el tenant y la cascada se lleva todo:
  -- ahí no hay nada que impedir. Ver la nota de arriba.
  IF NOT fact_es_operacion_directa() THEN
    RETURN OLD;
  END IF;

  IF fact_estado_ya_enviado(OLD.estado) THEN
    RAISE EXCEPTION
      'No se puede borrar el comprobante % (clave %): ya fue enviado a Hacienda (estado %). Un comprobante enviado se corrige con una nota de crédito o débito, nunca se borra.',
      OLD.id, OLD.clave, OLD.estado
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER fact_comprobantes_no_borrar_enviado
  BEFORE DELETE ON fact_comprobantes
  FOR EACH ROW EXECUTE FUNCTION fact_impedir_borrado_enviado();

-- REGLA 2: el XML firmado y la respuesta de Hacienda, una vez
-- guardados, no cambian; y un comprobante enviado no se edita.
--
-- El XML firmado es el documento que Hacienda recibió y validó: si se
-- modifica, la firma deja de corresponder y no hay forma de demostrar
-- qué se emitió. La respuesta es la prueba de qué contestó Hacienda.
--
-- Se permite pasar de NULL a un valor (así se guardan la primera vez) y
-- se prohíbe cambiar un valor existente, incluido volverlo NULL.
--
-- "No se edita" tiene una excepción necesaria y acotada: un comprobante
-- enviado SÍ cambia de estado y recibe la respuesta de Hacienda — es la
-- única forma de registrar que fue aceptado. La lista blanca de abajo es
-- exactamente eso, y cualquier otra columna queda congelada.
CREATE OR REPLACE FUNCTION fact_impedir_cambio_comprobante_enviado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  columna TEXT;
  -- Lo único que puede cambiar DESPUÉS de que el comprobante salió.
  editables_tras_envio TEXT[] := ARRAY[
    'estado', 'respuesta_xml', 'respuesta_ind_estado', 'respuesta_recibida_en',
    'respuesta_detalle', 'enviado_en', 'intentos_envio', 'proximo_intento_en'
  ];
  -- La fila entera como jsonb para poder recorrer sus columnas sin
  -- enumerarlas: si mañana se agrega una columna, queda congelada sola.
  viejo JSONB := to_jsonb(OLD);
  nuevo JSONB := to_jsonb(NEW);
BEGIN
  -- Inmutabilidad del XML y de la respuesta: vale en TODO estado, no
  -- solo después de enviar.
  IF OLD.xml_firmado IS NOT NULL AND NEW.xml_firmado IS DISTINCT FROM OLD.xml_firmado THEN
    RAISE EXCEPTION
      'El XML firmado del comprobante % (clave %) no se puede modificar: es el documento exacto que se le envió a Hacienda.',
      OLD.id, OLD.clave USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.respuesta_xml IS NOT NULL AND NEW.respuesta_xml IS DISTINCT FROM OLD.respuesta_xml THEN
    RAISE EXCEPTION
      'La respuesta de Hacienda del comprobante % (clave %) no se puede modificar: es la prueba de lo que Hacienda contestó.',
      OLD.id, OLD.clave USING ERRCODE = 'restrict_violation';
  END IF;

  -- La clave, el consecutivo, el tenant y el emisor son la identidad del
  -- comprobante: cambiarlos convierte una fila en otra.
  IF NEW.clave IS DISTINCT FROM OLD.clave
     OR NEW.consecutivo IS DISTINCT FROM OLD.consecutivo
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.emisor_id IS DISTINCT FROM OLD.emisor_id THEN
    RAISE EXCEPTION
      'La clave, el consecutivo, el tenant y el emisor del comprobante % no se pueden modificar.',
      OLD.id USING ERRCODE = 'restrict_violation';
  END IF;

  -- Un comprobante ya enviado: todo lo demás congelado.
  IF fact_estado_ya_enviado(OLD.estado) THEN
    FOR columna IN SELECT jsonb_object_keys(viejo) LOOP
      IF columna <> ALL (editables_tras_envio)
         AND (nuevo -> columna) IS DISTINCT FROM (viejo -> columna) THEN
        RAISE EXCEPTION
          'No se puede modificar %.% del comprobante % (clave %): ya fue enviado a Hacienda (estado %). La corrección se hace con una nota, no editando el comprobante.',
          TG_TABLE_NAME, columna, OLD.id, OLD.clave, OLD.estado
          USING ERRCODE = 'restrict_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER fact_comprobantes_inmutable_tras_envio
  BEFORE UPDATE ON fact_comprobantes
  FOR EACH ROW EXECUTE FUNCTION fact_impedir_cambio_comprobante_enviado();

-- REGLA 3: los eventos solo se agregan.
CREATE OR REPLACE FUNCTION fact_eventos_solo_agregar()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Igual que la regla 1: la cascada de la purga pasa.
  IF NOT fact_es_operacion_directa() THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'fact_comprobante_eventos solo admite INSERT: es la historia del comprobante y un % la reescribiría.',
    TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER fact_eventos_inmutables
  BEFORE UPDATE OR DELETE ON fact_comprobante_eventos
  FOR EACH ROW EXECUTE FUNCTION fact_eventos_solo_agregar();

-- REGLA 4: las líneas y sus hijos tampoco cambian si el comprobante ya
-- salió. Si el XML es inmutable, los datos que lo generaron tampoco
-- pueden cambiar: la pantalla mostraría algo distinto de lo que dice el
-- XML que Hacienda tiene.
--
-- Una sola función para las seis tablas hijas, parametrizada por el
-- camino hasta el comprobante.
CREATE OR REPLACE FUNCTION fact_impedir_cambio_hijo_enviado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  columna_padre TEXT := TG_ARGV[0];
  -- 'comprobante' si la FK apunta al comprobante; 'linea' si apunta a
  -- una línea y hay que subir un nivel.
  nivel TEXT := TG_ARGV[1];
  id_padre UUID;
  id_comprobante UUID;
  estado_comprobante TEXT;
  clave_comprobante TEXT;
  -- NEW no existe en un DELETE y OLD no existe en un INSERT: la fila
  -- relevante se elige por operación, en vez de con un COALESCE sobre
  -- dos records (que no siempre resuelve el tipo).
  fila RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN fila := OLD; ELSE fila := NEW; END IF;

  -- Cascada (borrado del comprobante o de la clínica): pasa. Si el
  -- borrado del comprobante estaba permitido, sus hijas se van con él.
  IF TG_OP = 'DELETE' AND NOT fact_es_operacion_directa() THEN
    RETURN fila;
  END IF;

  id_padre := (to_jsonb(fila) ->> columna_padre)::uuid;

  IF nivel = 'linea' THEN
    SELECT comprobante_id INTO id_comprobante FROM fact_comprobante_lineas WHERE id = id_padre;
  ELSE
    id_comprobante := id_padre;
  END IF;

  SELECT estado, clave INTO estado_comprobante, clave_comprobante
  FROM fact_comprobantes WHERE id = id_comprobante;

  -- El padre puede no existir si esto corre dentro de un DELETE en
  -- cascada del comprobante: ahí no hay nada que impedir.
  IF estado_comprobante IS NULL THEN
    RETURN fila;
  END IF;

  IF fact_estado_ya_enviado(estado_comprobante) THEN
    RAISE EXCEPTION
      'No se puede % en % del comprobante % (clave %): ya fue enviado a Hacienda (estado %).',
      TG_OP, TG_TABLE_NAME, id_comprobante, clave_comprobante, estado_comprobante
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN fila;
END;
$$;

CREATE TRIGGER fact_lineas_congeladas_tras_envio
  BEFORE INSERT OR UPDATE OR DELETE ON fact_comprobante_lineas
  FOR EACH ROW EXECUTE FUNCTION fact_impedir_cambio_hijo_enviado('comprobante_id', 'comprobante');

CREATE TRIGGER fact_linea_impuestos_congelados_tras_envio
  BEFORE INSERT OR UPDATE OR DELETE ON fact_linea_impuestos
  FOR EACH ROW EXECUTE FUNCTION fact_impedir_cambio_hijo_enviado('linea_id', 'linea');

CREATE TRIGGER fact_linea_descuentos_congelados_tras_envio
  BEFORE INSERT OR UPDATE OR DELETE ON fact_linea_descuentos
  FOR EACH ROW EXECUTE FUNCTION fact_impedir_cambio_hijo_enviado('linea_id', 'linea');

CREATE TRIGGER fact_medios_pago_congelados_tras_envio
  BEFORE INSERT OR UPDATE OR DELETE ON fact_comprobante_medios_pago
  FOR EACH ROW EXECUTE FUNCTION fact_impedir_cambio_hijo_enviado('comprobante_id', 'comprobante');

CREATE TRIGGER fact_referencias_congeladas_tras_envio
  BEFORE INSERT OR UPDATE OR DELETE ON fact_comprobante_referencias
  FOR EACH ROW EXECUTE FUNCTION fact_impedir_cambio_hijo_enviado('comprobante_id', 'comprobante');

CREATE TRIGGER fact_otros_cargos_congelados_tras_envio
  BEFORE INSERT OR UPDATE OR DELETE ON fact_comprobante_otros_cargos
  FOR EACH ROW EXECUTE FUNCTION fact_impedir_cambio_hijo_enviado('comprobante_id', 'comprobante');
