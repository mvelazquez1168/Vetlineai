# Fuentes oficiales — comprobantes electrónicos Costa Rica v4.4

Todo lo que el motor del facturador afirma sobre el formato, los códigos, las longitudes y las URLs
de servicio **sale de estos archivos**, no de la memoria de nadie. Si algo que hace falta no está
acá, se reporta como no encontrado; no se completa por aproximación.

**Descargadas el 2026-11-25** desde los sitios oficiales del Ministerio de Hacienda de Costa Rica.

## Por qué están guardadas en el repo y no solo enlazadas

Dos motivos concretos:

1. **Los XSD se usan en tiempo de ejecución** para validar cada comprobante antes de firmarlo. Si
   se descargaran al validar, una caída del sitio de Hacienda dejaría al facturador sin poder
   emitir — y el propio motor está diseñado para que Hacienda caída NO bloquee una venta.
2. **Hacienda actualiza estos documentos sin cambiar la URL.** La bitácora del anexo que bajamos
   dice "Bitácora de Ajustes al 22/04/2026" sobre la misma versión 4.4. Sin una copia con su hash,
   no hay forma de saber contra qué texto se programó.

Los `sha256` de abajo son para eso: volver a descargar y comparar dice si Hacienda cambió algo.

## Esquemas XSD — `backend/esquemas/fe-cr/xml-schemas/`

**No están en esta carpeta, y es a propósito.** Los XSD son una dependencia de EJECUCIÓN del
backend: el motor valida cada comprobante contra ellos antes de firmarlo. Si vivieran acá, dentro de
`docs/`, el contenedor del backend no los vería (solo monta `./backend`) y la imagen de producción
—que corre `dist/` compilado— tampoco los llevaría, porque `tsc` no copia archivos que no sean
TypeScript.

Así que hay **una sola copia**, en `backend/esquemas/`, y esta carpeta no guarda un duplicado: los
hashes de `sumas.sha256` apuntan a esa única copia. Un segundo juego de XSD "de documentación" sería
exactamente la clase de copia que se desincroniza sin que nada falle.

La estructura de carpetas replica la del CDN de Hacienda:

```
backend/esquemas/fe-cr/xml-schemas/
  xmldsig-core-schema.xsd
  v4.4/facturaElectronica/FacturaElectronica_V4.4.xsd
  v4.4/tiqueteElectronico/TiqueteElectronico_V4.4.xsd
  ...
```

No es decorativo: cada XSD de Hacienda importa la firma con
`schemaLocation="../../xmldsig-core-schema.xsd"`, una ruta **relativa** que solo resuelve con este
anidamiento. Aplanar la carpeta rompe la importación.

Base de descarga: `https://www.hacienda.go.cr/docs/<nombre>`

Los nueve se enumeran en el portal de contribuyentes
(`https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx`, sección v4.4,
que los lista bajo `docs/esquemas/2024/v4.4/`). **Ese path relativo del portal devuelve 404**; el
que sirve los archivos es `https://www.hacienda.go.cr/docs/`. Queda anotado porque es media hora de
confusión la primera vez.

| Archivo | `targetNamespace` |
|---|---|
| `FacturaElectronica_V4.4.xsd` | `…/xml-schemas/v4.4/facturaElectronica` |
| `TiqueteElectronico_V4.4.xsd` | `…/xml-schemas/v4.4/tiqueteElectronico` |
| `NotaCreditoElectronica_V4.4.xsd` | `…/xml-schemas/v4.4/notaCreditoElectronica` |
| `NotaDebitoElectronica_V4.4.xsd` | `…/xml-schemas/v4.4/notaDebitoElectronica` |
| `ReciboElectronicoPago_V4.4.xsd` | `…/xml-schemas/v4.4/reciboElectronicoPago` |
| `FacturaElectronicaCompra_V4.4.xsd` | `…/xml-schemas/v4.4/facturaElectronicaCompra` |
| `FacturaElectronicaExportacion_V4.4.xsd` | `…/xml-schemas/v4.4/facturaElectronicaExportacion` |
| `MensajeReceptor_V4.4.xsd` | `…/xml-schemas/v4.4/mensajeReceptor` |
| `MensajeHacienda_V4.4.xsd` | `…/xml-schemas/v4.4/mensajeHacienda` |

El prefijo completo de los namespaces es `https://cdn.comprobanteselectronicos.go.cr/`. Los sha256
de los diez archivos están en `sumas.sha256`.

### `xmldsig-core-schema.xsd` no vino de Hacienda

El esquema de la firma XML que los nueve XSD importan **no se pudo bajar del CDN de Hacienda**:
`https://cdn.comprobanteselectronicos.go.cr/xml-schemas/xmldsig-core-schema.xsd` y la raíz del CDN
devuelven **403**, y `https://www.hacienda.go.cr/docs/xmldsig-core-schema.xsd` devuelve 404. Se bajó
del original del W3C, que es de donde Hacienda lo toma:

`https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd`

Es la recomendación del W3C del 2002-02-12, con `targetNamespace="http://www.w3.org/2000/09/xmldsig#"`
— el mismo namespace que declaran los `xs:import` de Hacienda, así que es el archivo correcto. Queda
anotado porque la fuente **no** es Hacienda.

## Documentos — `documentos/`

| Archivo | URL de origen |
|---|---|
| `ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` | `https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` |
| `Guia_IdP.pdf` | `https://www.hacienda.go.cr/docs/Guia_IdP.pdf` |
| `Codigodemoneda_V4.4.pdf` | `https://www.hacienda.go.cr/docs/Codigodemoneda_V4.4.pdf` |
| `REGLAMENTO_DE_COMPROBANTES_ELECTRONICOS.pdf` | `https://www.hacienda.go.cr/docs/REGLAMENTO_DE_COMPROBANTES_ELECTRONICOS.pdf` |
| `DGT-R-000-2024DisposicionesTecnicasDeComprobantesElectronicosCP.pdf` | `https://www.hacienda.go.cr/docs/DGT-R-000-2024DisposicionesTecnicasDeComprobantesElectronicosCP.pdf` |
| `ComprobantesElectronicos-GeneralidadesyVersion4.4.marzo2025.pdf` | `https://www.hacienda.go.cr/docs/ComprobantesElectronicos-GeneralidadesyVersion4.4.marzo2025.pdf` |
| `ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf` | `https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf` |

**`ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` es el documento madre**: 99 páginas, con el Anexo 1
(especificación campo por campo de los siete comprobantes, más las notas con todos los catálogos),
el Anexo 2 (mecanismo de seguridad y firma XAdES, con ejemplos) y el Anexo 3 (conexión con la API
de recepción y con el IdP).

## Texto extraído — `texto-extraido/`

Los mismos PDF convertidos a texto con `lib/extraccion.ts` (el extractor que ya usa la Base de
Conocimiento). Están versionados porque **buscar un campo en el texto es la forma práctica de
verificar una afirmación del código** sin volver a abrir un PDF de 99 páginas, y porque el PDF no se
puede `grep`ear en una revisión de código.

No son la fuente: la fuente es el PDF. Si los dos difieren, manda el PDF.

## Catálogo CABYS — `backend/catalogos/cabys/`

Hacienda exige el código CABYS en **cada** línea de detalle de factura y tiquete (Nota 17 del anexo),
pero no lo publica con el resto de los catálogos: lo publica el **Banco Central de Costa Rica**,
aparte, como una planilla de Excel.

| | |
|---|---|
| Archivo | `backend/catalogos/cabys/Catalogo_CABYS_2025.xlsx` |
| URL de origen | `https://www.bccr.fi.cr/content/dam/bccr/bccr-espanol/noticias/2025/2025-04-01-catalogo-de-bienes-servicios-1.xlsx` |
| Publicado por el BCCR | 1 de abril de 2025 |
| Descargado | 2026-11-25 |
| Contenido | 20 506 códigos de 13 dígitos |

**Es la versión vigente.** El Ministerio de Hacienda fijó una transición del 1 de abril al 1 de junio
de 2025 en la que se aceptaban los códigos de Cabys 2023 y de Cabys 2025, y *"a partir del 1.° de
junio del 2025, se aceptarán únicamente los códigos Cabys de la nueva versión del catálogo"*
([comunicado CP-BCCR-015-2025](https://www.hacienda.go.cr/docs/CP-BCCR-015-2025.pdf)).

**No existe una versión 2026.** Se verificó: el listado de noticias del BCCR no publica ninguna
actualización posterior a la de 2025, y las URL que seguirían el patrón de 2026 dan 404. (Una primera
búsqueda afirmó que "Cabys 2026 rige desde el 1 de junio de 2026"; era falso, y por eso se comprobó
contra la fuente antes de escribirlo acá.)

### Dónde vive y por qué

En `backend/catalogos/cabys/`, **no** en esta carpeta, por el mismo motivo que los XSD: es una entrada
de ejecución del cargador, y `docs/` no está montado en el contenedor del backend ni entra en la
imagen de producción. Una sola copia, con su `sha256` en `sumas.sha256`.

### Cómo se carga

Por el mismo comando idempotente que el resto de los catálogos:

```bash
docker compose exec backend npm run cargar-catalogos-fe
```

Lee la hoja `Catálogo` de la planilla: columna **Q** el código de 13 dígitos, **R** la descripción,
**S** el impuesto.

**La columna "Impuesto" no es homogénea** — medido sobre el archivo real: trae fracciones (`0.13`),
textos con porcentaje (`13%`, 53 filas), `Exento` (885 filas) y `na` (3 filas). Un `Number()` ingenuo
dejaría 941 filas sin tarifa en silencio, así que la traducción al código de tarifa de la Nota 8.1 es
un mapa explícito, y cualquier valor que no esté en él se **reporta** en la salida del comando en vez
de cargarse como nulo.

`Exento` se traduce al código **10** (Tarifa Exenta), que es exactamente lo que nombra la Nota 8.1 —
no al 01 ni al 11, que también valen 0% pero significan otra cosa. Los 3 códigos con `na` quedan **sin
tarifa sugerida**: el catálogo no les asigna una y ponerles cualquiera sería inventarla.

### Cuándo actualizarlo

Cuando el BCCR publique una versión nueva: se descarga la planilla al mismo lugar, se regenera
`sumas.sha256`, se corre el comando y se corre `verificar_cabys.ts`. El lector **detiene la carga** si
el encabezado de la planilla cambió, en vez de cargar columnas corridas.

## Codificación de ubicación — `backend/catalogos/ubicacion/`

`Codificacionubicacion_V4.4.xlsx`, descargada el **2026-11-25** de
`https://www.hacienda.go.cr/docs/Codificacionubicacion_V4.4.xlsx`.

Provincia, cantón, distrito y barrio, que son tres de los campos obligatorios de la ubicación del
emisor y del receptor. La carga `npm run cargar-catalogos-fe` en `fact_cat_provincia`,
`fact_cat_canton`, `fact_cat_distrito` y `fact_cat_barrio` (migración 093), y desde entonces los
tres códigos se validan **contra la lista** con una clave foránea, no solo por formato.

### Este archivo reemplaza al `.rar` que antes no se pudo bajar

El portal de ATV enlaza `docs/esquemas/2024/v4.4/Codificacionubicacion_V4.4.rar`, y en la primera
pasada quedó reportado como no descargable por ser `.rar`. **No hizo falta ningún extractor**:
Hacienda sirve la misma codificación como `.xlsx` en `https://www.hacienda.go.cr/docs/`, que es la
base donde están los demás documentos. El `.rar` devuelve 404 en todas sus rutas —las del portal,
las de `www.hacienda.go.cr/docs/` y las variantes de mayúsculas—, así que el `.xlsx` no es un
atajo: es el único que existe.

### El archivo se contradice a sí mismo en los nombres

Los **códigos** son consistentes: 7 provincias, 84 cantones, 492 distritos y 7 087 barrios, y cada
nivel cuelga bien del anterior. Los **nombres** no: 554 códigos aparecen con dos usos de mayúsculas
("Quepos" y "QUEPOS"), y en 16 la diferencia es mayor — acentos (`CONCEPCION` / `Concepción`),
artículos (`LA FORTUNA` / `Fortuna`), un error de tipeo del propio archivo (`SAN FRANCISO` /
`San Francisco`) y un nombre con una aclaración adentro.

El cargador toma **el nombre más frecuente** de cada código y **reporta** cada desacuerdo al
correrlo. No se eligió "el que parece mejor": el nombre es un dato de presentación, lo que Hacienda
valida es el código, y un criterio inventado escondería que la fuente oficial no se pone de acuerdo
consigo misma.

### El barrio es texto, no código

En la versión 4.4 el campo `Barrio` del XML es **texto libre de 5 a 50 caracteres** (en 4.3 era un
código). Por eso `fact_cat_barrio` se carga pero **no** es destino de ninguna clave foránea: sirve
para sugerir en la pantalla, y atarlo restringiría más que el XSD.

## Lo que NO se encontró en estas fuentes

- **El JSON Schema de la API de recepción y los ejemplos de mensajes**: el Anexo 3 los describe en
  prosa y remite a "la documentación Web" del portal de Hacienda para el esquema exacto. Lo que sí
  está en el anexo, y alcanza para integrar, son las URIs, el modelo de seguridad, los recursos y la
  forma del callback — ver `datos-oficiales.md`.
- **`Nota_9_Codigo_Forma_Farmaceutica.xlsx`**: no se descargó; aplica a productos farmacéuticos de
  uso humano y no hay nada en este prompt que lo necesite todavía. Para una clínica veterinaria que
  dispense medicamentos habrá que revisarlo.

## Cómo volver a verificar que siguen vigentes

```bash
cd docs/facturacion/fuentes
sha256sum -c sumas.sha256
```

Si alguna cambió, Hacienda actualizó el documento: hay que leer la bitácora de cambios del anexo
(primeras páginas) antes de tocar el código.
