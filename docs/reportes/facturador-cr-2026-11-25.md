# Motor del facturador electrónico de Costa Rica (v4.4)

**Prompt:** `docs/prompts/vetline-clinic-09a-motor-facturador.md`
**Rama:** `vetline-clinic/facturador-cr`, creada a partir de
`vetline-clinic/sesion-nocturna-2026-11-25`
**Fecha:** 2026-11-25
**No se tocó producción.** No salió ningún comprobante hacia los servidores de Hacienda y no se
envió ningún correo real.

---

## Lo primero: el número que importa

**570 aserciones en verde**, repartidas en siete verificadores nuevos:

| Verificador | Aserciones | Qué prueba |
|---|---:|---|
| `verificar_facturacion_modelo` | 124 | Las reglas impuestas en la base |
| `verificar_catalogos_fe` | 54 | Los 383 códigos contra la enumeración real de los XSD |
| `verificar_clave_y_calculo` | 132 | Clave, consecutivo e impuestos, con cuentas hechas a mano |
| `verificar_xml_y_firma` | 65 | Los 5 tipos validan y se firman; un XML alterado no pasa |
| `verificar_emision_facturacion` | 65 | Los cinco escenarios de Hacienda, con el proveedor simulado |
| `verificar_pdf_y_entrega_fe` | 46 | El PDF con QR y el correo con sus dos adjuntos |
| `verificar_api_facturacion` | 84 | La API por HTTP, con tokens reales de Keycloak |

Y de los verificadores que ya existían: **30 en verde, 3 en rojo, los 3 por motivos ajenos a este
trabajo** (ver "Verificadores existentes" al final).

---

## Fuentes oficiales usadas

Todo está en `docs/facturacion/fuentes/`, con `sumas.sha256` (23 entradas, `sha256sum -c` pasa) y un
`LEEME.md` con la URL y la fecha de descarga de cada archivo. Los hechos con su cita textual están en
`docs/facturacion/datos-oficiales.md`.

**Los nueve XSD de v4.4** (factura, tiquete, nota de crédito, nota de débito, REP, factura de compra,
factura de exportación, mensaje receptor, mensaje Hacienda), bajados de
`https://www.hacienda.go.cr/docs/`. El path que el portal de contribuyentes publica
(`docs/esquemas/2024/v4.4/`) devuelve **404**; el que sirve los archivos es `docs/` a secas. Queda
anotado porque es media hora de confusión la primera vez.

**Siete documentos**: `ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` (99 páginas, el documento madre),
`Guia_IdP.pdf`, `Codigodemoneda_V4.4.pdf`, el reglamento, la resolución DGT-R-000-2024, las
generalidades de marzo 2025 y la actualización de anexos. Más el **PDF de la política de firma**, que
se bajó después (ver abajo).

**Por qué están vendorizados y no solo enlazados:** los XSD se usan en tiempo de ejecución para
validar cada comprobante antes de firmarlo, así que una caída del sitio de Hacienda dejaría al
facturador sin poder emitir — y el motor está diseñado justamente para que Hacienda caída NO bloquee
una venta. Y Hacienda actualiza estos documentos **sin cambiar la URL**: la bitácora del anexo que
bajamos dice "Bitácora de Ajustes al 22/04/2026" sobre la misma versión 4.4.

### Los XSD viven en `backend/esquemas/`, no en `docs/`

Es una sola copia, y es deliberado. Son una dependencia de **ejecución**: dentro de `docs/` el
contenedor del backend no los vería (solo monta `./backend`) y la imagen de producción tampoco,
porque `tsc` no copia archivos que no sean TypeScript. Un segundo juego "de documentación" sería
exactamente la clase de copia que se desincroniza sin que nada falle, así que `sumas.sha256` apunta a
la única copia.

La estructura replica la del CDN de Hacienda (`xml-schemas/v4.4/<tipo>/<Archivo>.xsd`) porque cada
XSD importa la firma con `schemaLocation="../../xmldsig-core-schema.xsd"`, una ruta **relativa** que
solo resuelve con ese anidamiento. Aplanar la carpeta rompe la importación.

`.gitattributes` marca `docs/facturacion/fuentes/**` y `backend/esquemas/**` como `-text`: sin eso,
Git normalizaría los finales de línea al clonar en Windows y los `sha256` dejarían de coincidir, con
lo cual la verificación de integridad perdería todo sentido.

### Lo que NO se encontró en las fuentes

Está en `docs/facturacion/fuentes/LEEME.md` y se repite acá porque condiciona lo que se puede usar:

1. **El catálogo CABYS completo.** El anexo lo exige en cada línea de detalle de factura y tiquete
   (Nota 17) pero no lo incluye: se publica aparte, como archivo de datos. `fact_cat_cabys` existe y
   está **vacía**; el cargador lo avisa fuerte y `GET /facturacion/cabys` devuelve
   `{"resultados": [], "catalogoVacio": true, "aviso": "…"}` en vez de un 500 o de resultados
   inventados. Mientras tanto el código hay que escribirlo a mano: 13 dígitos.
2. **La codificación de ubicación** (provincia/cantón/distrito/barrio) se publica como
   `Codificacionubicacion_V4.4.rar`. No se descargó: es un `.rar` y el repo no tiene con qué
   descomprimirlo de forma reproducible. Los campos se validan por formato (1, 2 y 2 dígitos) pero no
   contra la lista.
3. **El JSON Schema del `POST /recepcion`.** El Anexo 3 describe el recurso y remite a "la
   documentación Web" del portal, que no se consiguió. **Esto es lo más importante de esta lista** —
   ver "Lo que falta para probar contra el sandbox".
4. **`Nota_9_Codigo_Forma_Farmaceutica.xlsx`.** Aplica a productos farmacéuticos de uso humano. El
   campo existe en el modelo (`forma_farmaceutica`) sin FK, y hay que revisarlo cuando una clínica
   dispense medicamentos.
5. **El catálogo de la Nota 20 bis / Nota 23** (nombre de la institución de una exoneración): está en
   el anexo como tabla pero no se transcribió a un catálogo propio; el campo se guarda tal cual.

### El hash de la política de firma: se verificó, no se copió

El Anexo 2 exige incluir en cada firma la URL del PDF de la política **y su hash**. El ejemplo del
anexo muestra `DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=`.

En vez de confiar en el ejemplo, se descargó el PDF de la URL que el propio anexo publica y se
calculó su SHA-256: **coincide exactamente**. El PDF quedó vendorizado con su hash en `sumas.sha256`,
así que la afirmación se puede volver a comprobar sin internet.

### `xmldsig-core-schema.xsd` no vino de Hacienda

Los nueve XSD importan el esquema de la firma XML, y **no se pudo bajar del CDN de Hacienda**:
`https://cdn.comprobanteselectronicos.go.cr/xml-schemas/xmldsig-core-schema.xsd` y la raíz del CDN
devuelven **403**, y `https://www.hacienda.go.cr/docs/xmldsig-core-schema.xsd` devuelve 404.

Se bajó del original del W3C (`REC-xmldsig-core-20020212`), que es de donde Hacienda lo toma: tiene
el mismo `targetNamespace` que declaran los `xs:import`, así que es el archivo correcto. Queda
anotado porque **la fuente no es Hacienda**.

---

## Cinco correcciones que salieron de leer el XSD y no la documentación

La regla del prompt era que todo saliera de las fuentes. Leer el **esquema** y no solo el anexo en
prosa corrigió cinco cosas que el primer borrador tenía mal:

| Qué decía el borrador | Qué dice el XSD |
|---|---|
| `ubicacion_barrio` era un código de 2 dígitos, por analogía con provincia/cantón/distrito | Es **texto de 5 a 50 caracteres**. En 4.4 el barrio dejó de ser un código. |
| El código del mensaje receptor era `'01'`/`'02'`/`'03'` | Es **`1`/`2`/`3`, un dígito**. Es el único catálogo de v4.4 que no usa dos, y confundirlo produce un XML que no valida. |
| `ProveedorSistemas` no existía | Es **obligatorio** en todos los comprobantes: la cédula de quien provee el software. |
| Las condiciones de venta eran 01..15 + 99 | El XSD de factura **no enumera `09` ni `11`**: son exclusivas del REP. Ofrecerlas en una factura produce un rechazo. |
| Las monedas eran "178" | Son **168**, contadas en la enumeración real. |

Y una que ya se había corregido antes de escribir código: el tope de líneas de detalle es
`maxOccurs="1000"` **para todos** los comprobantes. La bitácora de 2011 que dice "60 para factura" es
el registro histórico de una versión vieja, no el estado actual.

`docs/facturacion/datos-oficiales.md` quedó corregido en los cinco puntos, con la cita del esquema.

---

## Lo construido

### 1. Modelo de datos — migración 091

**25 tablas**: 13 catálogos de plataforma (sin `tenant_id`) y 12 con datos de clínica. Cada longitud,
enumeración y obligatoriedad sale del XSD, no de la prosa.

**El emisor es tabla propia**, no columnas en `tenants`. Hoy hay uno por clínica (de ahí el UNIQUE),
pero el emisor fiscal no ES la clínica: una clínica puede facturar a nombre de otra razón social.
Con los datos en `tenants` eso sería una migración; así es sacar el UNIQUE.

**El `tenant_id` de las siete tablas hijas es DERIVADO, no copiado.** Llevan la columna porque la
auditoría de RLS solo mira tablas que la tengan —sin ella, una hija sin RLS pasa desapercibida para
siempre— pero un `tenant_id` escrito a mano en siete tablas es un dato en dos lugares que pueden
divergir. Un trigger lo deriva del padre en cada INSERT e impide cambiarlo. Verificado: un
`tenant_id` escrito a mano y equivocado se corrige al del padre.

#### Las cuatro reglas que el prompt pide EN LA BASE

| Regla | Cómo | Verificado con |
|---|---|---|
| Consecutivo único por emisor, sucursal, terminal y tipo | `UNIQUE (emisor_id, consecutivo)` — el consecutivo codifica los otros tres en sus primeras 10 posiciones | El mismo consecutivo repetido → 23505; otro emisor sí puede usarlo |
| Clave de 50 dígitos única | `UNIQUE (clave)` global, más `CHECK (clave ~ '^[0-9]{50}$')` | Clave repetida, de 49 dígitos y con una letra → rechazadas |
| Un enviado no se borra ni se edita | Dos triggers; `fact_estado_ya_enviado()` define "ya salió" en un solo lugar | Borrado en los 4 estados finales → 23001; borrador y firmado sí se borran |
| Una solicitud no genera dos comprobantes | `UNIQUE (emisor_id, clave_idempotencia)` | Repetida → 23505; otro emisor sí; dos sin clave no chocan |

"No se edita" tiene una excepción necesaria y acotada: un comprobante enviado **sí** cambia de estado
y recibe la respuesta de Hacienda. La lista blanca son ocho columnas de seguimiento, y el trigger
recorre el resto **comparando la fila entera como `jsonb`** — así, una columna nueva queda congelada
sola, sin que nadie se acuerde de agregarla a una lista.

#### Un defecto real del primer borrador, encontrado por la verificación

Con los triggers sin excepción, **una clínica con UNA factura aceptada no se podía purgar nunca**:
`DELETE FROM tenants` fallaba con *"ya fue enviado a Hacienda"*. Es el mismo modo de falla que la
auditoría de RLS vigila para las FK sin cascada (la purga hace ROLLBACK dentro de un `catch` y la
clínica queda colgada), y la auditoría **no lo habría detectado** porque la FK a `tenants` sí es
CASCADE: lo que bloqueaba era el trigger.

Resuelto con `fact_es_operacion_directa()` sobre `pg_trigger_depth()`, con las profundidades
**medidas y no supuestas**:

```
DELETE FROM fact_comprobantes       -> profundidad 1  (hay que bloquear)
DELETE FROM tenants (cascada)       -> profundidad 2  (hay que permitir)
```

Verificado en los dos sentidos: la purga de una clínica con un comprobante **aceptado** funciona y no
deja filas huérfanas en ninguna de las 12 tablas, y borrar a mano ese mismo comprobante sigue
prohibido.

### 2. Catálogos — 383 códigos, verificados contra el XSD

`npm run cargar-catalogos-fe`, idempotente y re-corrible. Van en TypeScript y no en una migración por
el mismo criterio que `tenant_modulos`: Hacienda actualiza los catálogos sin cambiar la versión, y una
migración queda aplicada para siempre.

**La verificación que importa** no es "el cargador no explota": es que `verificar_catalogos_fe.ts`
compara **código por código** las 12 listas contra la **enumeración real de los XSD**, que es lo que
Hacienda valida. 383/383 coinciden. Y el verificador se autoprueba: inyecta un código falso y quita
uno verdadero, y confirma que la comparación los señala.

Un código que Hacienda quite se marca `activo = false`, **nunca se borra**: un comprobante viejo
puede referenciarlo, y borrarlo rompería la FK o forzaría a borrar el comprobante.

### 3. Clave numérica y consecutivo

Las 50 y las 20 posiciones armadas pieza por pieza según la Nota 3, con el relleno de la Nota 4.1.
Dos decisiones con motivo:

- **El relleno se calcula** a 12 caracteres (`padStart`) en vez de copiar la tabla "tres ceros para
  física, dos para jurídica, uno para DIMEX de 11". Esa tabla es correcta **solo** si la cédula viene
  con su largo canónico; una cédula física guardada con un cero de más daría 13 caracteres sin que
  nada avise. Lo que sí se valida es que no pase de 12 — y para los tipos 05 y 06, que admiten hasta
  20 en el XML, la Nota 4.1 **no dice cómo armar la clave**, así que se reporta en vez de inventarlo.
- **La fecha se toma en hora de Costa Rica**, no en UTC. Un comprobante emitido a las 20:00 del día
  25 son las 02:00 del 26 en UTC: la clave diría 26 y contradiría su propia fecha de emisión.
  Verificado con el cruce de año (22:00 del 31/12/2026 en CR = 04:00 del 1/1/2027 en UTC → la clave
  dice `3112` y `26`).

**El consecutivo se consume de forma atómica** con un `INSERT ... ON CONFLICT DO UPDATE` sobre un
`PoolClient`, en la misma transacción que crea el comprobante. Medido: 10 emisiones simultáneas dan
los números 3 al 12, sin huecos ni repeticiones; y tras un `ROLLBACK` el contador sigue donde estaba.

### 4. Cálculo de impuestos y totales

Cada fórmula tiene la cita del campo del Anexo que la define, en el comentario de al lado. Los montos
son **BigInt en cienmilésimas**, no `number`: el XSD es `decimal(18,5)` y Hacienda valida que los
totales cuadren con la suma de las líneas, así que una factura de veinte líneas desviada un céntimo
se rechaza y el motivo es imposible de encontrar leyendo el XML.

Lo que no era obvio, con el caso resuelto a mano en el verificador:

- **Los tres ceros del IVA suman en totales DISTINTOS.** Tarifa `10` → exento; tarifas `01` y `11` →
  no sujeto. Mismo monto cobrado, tres significados fiscales.
- **Servicio o mercancía lo decide el primer dígito del CABYS** (5-9 → servicio). De eso depende en
  qué total del resumen suma la línea, y Hacienda lo valida.
- **En una regalía el IVA se calcula sobre el monto SIN descontar** y queda como "impuesto asumido
  por el emisor", así que el total de la línea es 0: al cliente no se le cobra nada.
- **El impuesto específico suma a la base imponible del IVA.** Verificado: 10 000 + 400 de específico
  → IVA sobre 10 400.
- **La exoneración reparte el monto de la línea en UNA sola división.** En dos pasos (proporción y
  después multiplicación) daba 76 923,00000 donde la cuenta a mano da **76 923,07692**: la proporción
  solo tiene 5 decimales. Fue el único caso de cálculo que falló en la primera corrida, y está
  anotado en el código con el número.

### 5. XML v4.4 y validación contra los XSD oficiales

El **orden** de los elementos sale del esquema real, tipo por tipo, y está escrito como comentario
arriba de cada función: los XSD usan `xs:sequence`, así que un campo correcto en el lugar equivocado
invalida el comprobante.

**Librería de validación: `xmllint-wasm`** — libxml2 compilado a WebAssembly, el mismo validador que
usa Hacienda del otro lado, sin toolchain nativo ni JVM. Las alternativas eran `libxmljs2` (requiere
C++ en la imagen alpine) y `xsd-schema-validator` (requiere Java). Un validador en JavaScript puro no
era opción: uno que acepta un XML que Hacienda rechaza es peor que no tener validador.

**Cómo se resolvió validar ANTES de firmar.** La norma lo pide, pero el esquema define `ds:Signature`
con `minOccurs="1"`: un documento sin firmar nunca puede validar del todo. La primera solución fue
filtrar el error de la firma faltante por su texto, y **se probó que es frágil**: en una nota de
crédito, donde `InformacionReferencia` puede repetirse, libxml2 nombra *ese* elemento y no la firma.
La solución final **inserta una firma de relleno estructuralmente válida** y valida el documento
completo sin tolerar ningún error — estrictamente más estricto, y sin depender de cómo libxml2
redacte un mensaje. Verificado: con la opción puesta, un XML sin `Clave`, sin `TotalComprobante`, sin
`BaseImponible` o sin `CodigoCABYS` **sigue** sin validar.

**Resultado:** los cinco tipos que el motor emite (factura, tiquete, nota de crédito, nota de débito,
REP) validan contra su XSD oficial, antes y después de firmar. Y **diez campos obligatorios quitados a
propósito invalidan, y el error nombra el campo** — más un código de tarifa fuera de la Nota 8.1 y una
clave de 49 dígitos, que también se rechazan.

### 6. Firma XAdES-EPES

**Librería: `xadesjs`** (sobre `xmldsigjs`), detrás de un único módulo (`facturacion/firma.ts`).
Justificación en una línea, que es lo que el prompt pidió: es la única del ecosistema de Node que
construye XAdES-EPES completo —`SignedProperties`, `SigningCertificate` con su `CertDigest` e
`IssuerSerial`, y `SignaturePolicyIdentifier` con el hash de la política—, que es exactamente lo que
Hacienda exige; `xml-crypto` firma XMLDSig pero no construye las propiedades XAdES, y escribirlas y
canonicalizarlas a mano es la parte difícil y la que no conviene improvisar en un documento fiscal.
`node-forge` se usa solo para abrir el PKCS#12, porque WebCrypto no lee `.p12`.

Comprobado en el XML resultante, contra lo que exige el Anexo 2: namespace de ETSI TS 101 903 v1.3.2,
canonicalización exclusiva, RSA con SHA-256, empaquetado **ENVELOPED** ("no se aceptará ningún otro"),
`SignaturePolicyIdentifier` con la URL exacta y el hash verificado, `SigningTime`, el digest del
certificado, y el nodo como último hijo del elemento raíz.

**Un defecto real encontrado en la verificación.** Sin `x509` en las opciones, la firma se genera y
**parece correcta** —tiene todas las propiedades XAdES— pero el documento no lleva ninguna llave
pública, así que **nadie puede verificarla**: un XML intacto daba firma inválida. El certificado va en
`ds:KeyInfo` (para poder verificar) **y** su digest en `xades:SigningCertificate` (requisito de
XAdES): son dos cosas distintas, y el ejemplo oficial del Anexo lleva las dos.

El certificado de prueba se **genera en el test** (`certificadoPrueba.ts`), nunca se usa una llave
real. Y el .p12 valida al cargarse: una llave de 1024 bits se rechaza ahí, no al emitir la primera
factura. Verificado que un XML con el **total** cambiado después de firmar no pasa, que con el
**receptor** cambiado tampoco, y que la firma de un comprobante **pegada en otro** tampoco.

### 7. Proveedor de Hacienda intercambiable

La distinción que organiza todo el módulo: **"Hacienda rechazó" y "Hacienda no contestó" son cosas
distintas**, y por eso la segunda es un tipo de error propio (`ErrorHaciendaSinRespuesta`) y no un
string. Un `catch` que las trate igual descarta un comprobante que Hacienda probablemente tiene, o
reintenta para siempre algo que nunca va a pasar.

**El default es el SIMULADO**, y no por comodidad: es lo que impide que un ambiente mal configurado
le mande un comprobante de prueba a Hacienda. El backend anuncia en el log de arranque con cuál está
corriendo.

El simulado reproduce los **cuatro** comportamientos que cambian la decisión del motor (acepta,
rechaza, demora, no responde), exige credenciales cargadas —porque "emitir sin credenciales" es un
camino de error que también hay que poder probar— y devuelve un `MensajeHacienda` con la forma del
XSD real, no un texto suelto: con un texto suelto, el extractor de motivos se probaría contra algo que
no es el camino real.

El **real** queda construido y **sin ejecutar contra Hacienda**. Tiene caché de token por emisor y
ambiente (el token expira en 5 minutos: sin caché, una tanda de 30 comprobantes pide 30 tokens), usa
`refresh_token` antes de reenviar la contraseña, y descarta el caché ante un 401/403 para que el
reintento no reuse un token muerto.

### 8. Emisión, contingencia y rechazo

Siete pasos, **cada escritura en su propia transacción corta y ninguna llamada a Hacienda con una
transacción abierta** — el patrón que este proyecto ya tuvo que adoptar por una alerta de AWS.
Consumir el consecutivo, armar la clave y guardar el comprobante con sus líneas sí van juntos y
atómicos.

**La venta nunca se bloquea por Hacienda.** Si Hacienda no responde, `emitir()` devuelve igual con el
comprobante firmado y en cola. El job corre cada minuto, usa `FOR UPDATE SKIP LOCKED` para no pisarse
con otra instancia, **suelta el bloqueo antes** de llamar a Hacienda, y es idempotente: no reenvía lo
que ya salió, consulta. Tras siete intentos deja de reintentar y queda en `error` para que alguien lo
mire — reintentar para siempre esconde un problema de credenciales detrás de un log que nadie lee.

Los cinco escenarios del prompt, verificados con el simulado:

| Escenario | Resultado medido |
|---|---|
| Aceptado | `aceptado`, con `indEstado` crudo, XML firmado y respuesta guardados; eventos `creado → firmado → enviado → respuesta_recibida` |
| Rechazado con motivo | `rechazado`, y el motivo **textual** de Hacienda en la base, sin reescribir |
| Demora con respuesta posterior | `enviado` → la cola consulta 3 veces → `aceptado`. **Se envió UNA sola vez** y se consultó tres |
| Sin respuesta → contingencia → reintento → aceptado | `en_cola` con evento `contingencia` → 2 reintentos → `aceptado`, con 3 intentos de envío |
| Sin envío duplicado | Correr la cola de nuevo **no** cambia el contador de intentos |

Y dos más del prompt: **8 emisiones simultáneas** dan 8 consecutivos y 8 claves distintas; y **la
misma clave de idempotencia devuelve el mismo comprobante** (200 en vez de 201, `yaExistia: true`, y
una sola fila en la base).

**Las notas** son la única forma de corregir un enviado. El código de referencia (Nota 9) es
obligatorio y **no tiene default**: "anula el documento" y "corrige el monto" tienen efectos
contables distintos en la declaración del receptor. Una nota contra un **rechazado** se rechaza con su
motivo: Hacienda no lo tiene, así que lo que corresponde es un comprobante nuevo.

### 9. PDF con QR y entrega por correo

**Motor: pdfkit**, el mismo de las recetas y del reporte de atenciones, como pedía el prompt. Lo único
que faltaba era el QR, y eso lo resuelve `qrcode` generando un PNG que pdfkit inserta como cualquier
imagen.

**El QR lleva la clave sola, no una URL.** El Anexo dice que la clave "se tiene que utilizar para la
consulta del código QR" pero no publica la URL del consultor: una URL inventada sería un enlace roto
el día que cambie, y la clave no caduca.

Tres decisiones del PDF con su motivo: el logo va con `fit` y no con `width`, porque un logo apaisado
y uno cuadrado tienen que caber en la misma caja sin deformarse (ya pasó en el `.docx` del informe); el
logo es **opcional**, al revés que en la receta —que devuelve 422 pidiéndolo— porque la validez del
comprobante está en el XML firmado y no se bloquea una venta por un dato estético; y las líneas de
total en cero no se imprimen.

**La entrega está separada de la emisión** a propósito: un comprobante emitido es válido aunque el
correo rebote, y un correo que falla no puede deshacer una emisión. Si estuvieran juntos, un problema
de Resend haría fallar una venta.

`enviarEmail` ahora acepta adjuntos, con tope propio (20 MB, la mitad del de Resend) y validación del
nombre de archivo: una barra o un salto de línea en el nombre es una cabecera inyectada, y se rechaza
igual que un destinatario inválido. Los nombres son los de la Nota 3 (`clave.pdf`, `clave.xml`), que
es el formato con el que una contadora espera recibirlos.

**Un defecto real encontrado por la verificación:** `comprobante_electronico` no estaba en
`TIPOS_MARCA_COMERCIO`, así que el correo salía firmado "Vetline Ai" — justo en el correo donde quien
recibe es el cliente de la clínica y no un usuario nuestro.

Un **tiquete sin correo del receptor NO es un error**: devuelve `enviado: false` con el motivo, porque
convertir eso en un fallo haría que la caja mostrara un problema donde no hay ninguno. Y un
comprobante **sin firmar no se entrega**: mandar solo el PDF sería entregar la representación gráfica
sin el documento con validez legal.

### 10. API y contrato

17 rutas bajo `requiereModulo('facturacion')`. El contrato del documento de venta está en
`docs/facturacion/contrato-api.md`, con una tabla de **qué tiene que hacer la caja con cada estado** —
que es la pregunta real de quien se integra, y la respuesta no es obvia: `en_cola` y `enviado` son
respuestas **exitosas**.

Permisos: médico o admin para consultar y emitir; **solo admin** para el emisor y las credenciales.

**El proveedor de sistemas no se recibe del cliente.** Lo pone el servidor desde su configuración:
recibirlo dejaría que una clínica declare a otro como proveedor del software. Verificado mandándolo en
el cuerpo y comprobando que no cambia.

**La aserción que más importa de los 84:** una búsqueda **recursiva del VALOR** de la contraseña, el
PIN y la llave en cada respuesta de la API — por valor y no por nombre de campo, así un campo nuevo
que filtre un secreto también se detecta. Ninguna respuesta los contiene.

Más el aislamiento entre clínicas, probado con una segunda clínica y su propio token: ve 0
comprobantes, 404 en el detalle ajeno, 404 en su PDF y `null` en el emisor ajeno.

### 11. Interfaz propia — 5 pantallas

Con el sistema de diseño ampliado de la sesión nocturna. Lo que vale la pena señalar:

- **El listado** responde de un vistazo "¿quedó algo sin transmitir?". El conteo de pendientes se pide
  **sin** los filtros de la pantalla: si se calculara sobre la página visible, filtrar por "aceptado"
  escondería justamente los que hay que atender.
- **El detalle** pone la historia de eventos **arriba**: quien abre esa pantalla casi siempre lo hace
  porque algo no salió como esperaba. El motivo del rechazo se muestra tal cual.
- **La emisión manual** no calcula los totales que van al XML (muestra una estimación, etiquetada como
  aproximada) y no inventa el CABYS. Lista **todos** los problemas de validación y no uno por vez.
- **Los recibidos** muestran en rojo un XML que no valida, pero lo cargan igual.
- **Las credenciales** no tienen botón de "ver": eso sería la puerta que el cifrado en reposo existe
  para cerrar. Los campos de contraseña y PIN se limpian al guardar.

El mapa estado → color vive en **un** solo lugar: tres mapas separados divergen, y el día que se
agregue un estado dos se actualizan y el tercero lo pinta gris.

---

## Decisiones que tomé solo

1. **Los XSD viven en `backend/esquemas/` y no hay copia en `docs/`.** Una sola copia, con los hashes
   apuntando ahí. Motivo arriba.
2. **`tenant_id` en las hijas, derivado por trigger.** El prompt pedía `tenant_id` en todas las
   tablas; la alternativa era copiarlo a mano en siete lugares.
3. **Un emisor guarda UN correo**, no los cuatro que admite el XSD. Emitir con uno es un subconjunto
   válido; si hacen falta los cuatro pasa a tabla hija, no a `correo_2`/`correo_3`/`correo_4`.
4. **Un `CodigoComercial` por línea**, no los cinco del XSD. Una clínica tiene un código interno.
5. **`DetalleSurtido` (combos y paquetes) no se construyó.** Trae su propio árbol de impuestos y
   descuentos, y una clínica veterinaria no factura surtidos. Documentado como no construido en vez de
   medio hecho.
6. **`TotalIVADevuelto` queda en 0.** Es obligatorio al facturar **servicios de salud** pagados con
   tarjeta; el régimen de devolución aplica a salud **humana**. El código dice qué fórmula usar si
   algún día califica, y que no se deje en 0.
7. **El `callbackUrl` de Hacienda no se usa.** El mismo JSON se obtiene con el GET por clave, así que
   la consulta por reintento alcanza y evita exponer un endpoint público.
8. **El mensaje receptor no se encola.** A diferencia de un comprobante, tiene plazo (ocho días
   hábiles): si Hacienda no responde queda firmado y sin enviar, y la pantalla lo dice, en vez de que
   el sistema reintente en silencio por días.
9. **El remitente del correo sale de `tenants.nombre`**, no de `fact_emisores.nombre_comercial`. Un
   cliente que recibe un recordatorio de cita y una factura tiene que ver el **mismo** remitente. Son
   dos datos distintos (identidad fiscal vs. identidad en el producto), no una copia.
10. **Dos íconos nuevos** (`comprobante`, `recibidos`) agregados por la única puerta, `Icono.tsx`.

---

## Lo que no se pudo, y por qué

- **No se probó contra el sandbox real de Hacienda.** El prompt lo prohíbe explícitamente y lo pone
  fuera de alcance, y además no hay credenciales de pruebas: las genera el ATV del contribuyente y
  llegan a su buzón electrónico.
- **El catálogo CABYS no está cargado.** No se pudo obtener (ver arriba). Es lo único que impide
  emitir una factura o un tiquete "de verdad" sin escribir el código a mano.
- **Las cinco pantallas no se abrieron en un navegador.** `tsc` del frontend limpio y `vite build` de
  producción completo, pero no hubo una revisión visual. Es la misma salvedad que el prompt de
  `vinculo_caso_cita` dejó anotada.
- **La factura electrónica de compra (08) y la de exportación (09)** están fuera del prompt. Sus XSD
  están descargados y el catálogo las conoce; el motor no las emite.
- **La recepción automática de facturas de proveedores por correo** está fuera del prompt. Hay que
  subir el XML.

---

## Lo que falta para probar contra el ambiente de pruebas real

En orden de lo que bloquea:

1. **El JSON Schema del `POST /recepcion`.** Es lo único verdaderamente desconocido. El Anexo 3
   describe el recurso y remite a la documentación Web del portal, que no se consiguió. El cuerpo que
   el motor arma está en **un solo objeto** de `haciendaReal.ts`, marcado con una advertencia, usando
   los nombres que el propio anexo usa en el ejemplo del callback (`clave`, `fecha`) más el emisor y
   el receptor. **Es una suposición informada, no un hecho documentado**, y ajustarla es cambiar ese
   objeto y nada más.
2. **Credenciales de pruebas del ATV**: usuario, contraseña y la llave `.p12` con su PIN, del realm
   `rut-stag`. Se cargan por la pantalla de Emisor, y quedan cifradas.
3. **`FE_CR_PROVEEDOR=real`** y el emisor con `ambiente_activo = 'pruebas'`.
4. **`FE_CR_PROVEEDOR_SISTEMAS` con la cédula real** de quien provee el sistema. Hoy tiene un valor de
   relleno (`3101999999`) y va literal a cada comprobante.
5. **`FE_CR_CLAVE_CIFRADO` real en producción**, desde el orquestador y no desde `docker-compose.yml`.
6. **Un certificado real**, emitido por el BCCR. El de prueba sirve para comprobar que la firma se
   construye y se verifica; Hacienda lo rechaza, y eso es lo correcto.
7. **El catálogo CABYS**, para no escribir el código a mano.

Cuando esos siete estén, el primer envío al sandbox es el que va a decir si el cuerpo del POST es el
correcto — y es la única cosa de este motor que no se pudo verificar de otra forma.

---

## Verificadores existentes

**30 en verde.** Del barrido completo se excluyeron los que llaman al modelo (gastan crédito), los
que envían correo real y los que piden un argumento.

**3 en rojo, los tres por motivos ajenos a este trabajo:**

| Verificador | Qué pasa |
|---|---|
| `verificar_correos_cobro` | Pide un destinatario por argumento. No es una falla: no se le pasó, porque envía correo real. |
| `verificar_motor_cobros` | **Preexistente**, ya anotado en la sesión del 2026-11-25. La FSM del cobro queda `morosa` donde esperaba `activa`. Nada de este trabajo toca cobros. |
| `verificar_cambio4_purga_consumo` | **Defecto real preexistente, ahora documentado como D-006.** Ver abajo. |

### D-006 — una clínica cuyo médico escribió un mensaje no se puede purgar

`DELETE FROM tenants` falla con `mensajes_autor_persona_id_fkey`. **Reproducido en aislamiento** con
el caso mínimo (una clínica, un médico, un propietario, un paciente, un caso y **un** mensaje), sin
nada de facturación de por medio.

Que es preexistente está probado, no supuesto: la FK viene de la **migración 066**, el último cambio a
`purga.ts` es de un commit **anterior** a la base de esta rama, y el diff de esta rama contra su base
**no toca** `purga.ts`, `auditoriaRls.job.ts` ni `tablasTenant.ts`.

Importa porque `purga.ts` atrapa el error y hace `ROLLBACK` dentro de un `catch`: la clínica queda
pendiente indefinidamente, en silencio salvo una línea de log. Y como `mensajes.autor_persona_id` se
llena en cuanto un médico escribe en el chat, afecta a cualquier clínica con actividad.

**No lo arreglé**, y es deliberado: son dos decisiones sobre datos de clínicas reales (qué pasa con el
mensaje, y cómo se extiende la auditoría para cubrir esta familia de FK) y no se toman de paso dentro
de otro prompt. Está en `DEFECTOS_ABIERTOS.md` como **D-006**, con el caso mínimo que falla hoy.

La auditoría de RLS **sí pasa limpia** con las 25 tablas nuevas, que es lo que el prompt exigía: D-006
es de una familia que esa auditoría no cubre (una FK `NO ACTION` hacia una tabla tenant-scoped, desde
una tabla sin `tenant_id`), y eso también quedó anotado.

---

## Cómo volver a correr todo

```bash
# Las fuentes oficiales siguen siendo las mismas
cd docs/facturacion/fuentes && sha256sum -c sumas.sha256

# Migración y catálogos
docker compose exec backend npm run migrate
docker compose exec backend npm run cargar-catalogos-fe

# Los siete verificadores nuevos (570 aserciones). No tocan producción,
# no envían correo real y no le mandan nada a Hacienda.
for v in facturacion_modelo catalogos_fe clave_y_calculo xml_y_firma \
         emision_facturacion pdf_y_entrega_fe api_facturacion; do
  docker compose exec backend npx ts-node --transpile-only \
    src/scripts/verificar_$v.ts
done
```

`verificar_api_facturacion` necesita el backend arriba y Keycloak accesible: crea su propia clínica y
sus propios usuarios descartables, y los borra al terminar. **Nunca toca un usuario existente ni sus
credenciales.**
