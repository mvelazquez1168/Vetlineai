# Barrido — toda exportación lleva el logo y el nombre de la clínica

Rama `vetline-clinic/barrido-exportaciones-logo`, partiendo de la rama del barrido de modales. Nada
fusionado a `main`. Sin migraciones.

Verificador nuevo `verificar_marca_exportaciones.ts`: **TODO OK**. Contra el estado anterior daba
**15 fallos** (12 llamadas sin marca y 3 generadores con constantes propias), que es la prueba de
que sirve.

Muestras en PDF y Excel, con logo y sin logo, en
[`muestras-pdf/`](muestras-pdf/) —incluido un comprobante electrónico real—.

---

## 1. El punto único dejó de ser «de PDF»

`pdf/marcaPdf.ts` nació en el anexo para el PDF del examen. **Se mudó a
`backend/src/marca/marcaClinica.ts`** porque el Excel necesita exactamente lo mismo —el logo en
bytes, el nombre y el color— y dejarlo en un archivo llamado «marcaPdf» habría hecho que una
planilla importara el módulo del PDF para poner un logo. `pdf/marcaPdf.ts` se quedó con lo que sí es
de pdfkit: dibujar el encabezado y el pie.

Lo nuevo del módulo:

- **`medidasDeImagen()`**, que lee el ancho y el alto de un PNG (cabecera IHDR) o un JPEG
  (marcadores SOF). Hace falta porque **el .xlsx no escala una imagen solo**: hay que declararle el
  tamaño en EMU, y sin las medidas reales un logo 4:1 metido en una caja 3:1 sale estirado. Es el
  mismo defecto que ya costó una corrección en el .docx del informe. El logo real de la clínica de
  prueba mide 1201×299 y el dibujo declara 4,019 contra una proporción real de 4,017.
- **`PRIMARIO_DE_FABRICA`**, exportado. Tenerlo copiado en cuatro archivos es exactamente cómo
  empezó esto.
- **`pieDeExportacion()`**: la línea de fecha y autor, una sola vez para los dos formatos.

Y se borró **`facturacion/logoClinica.ts`**, que era la segunda lectura del mismo archivo de logo en
el sistema.

---

## 2. El Excel con marca

`aExcel(tabla, { marca, usuario })`. El .xlsx se sigue escribiendo a mano con `fflate` —no se agregó
ninguna dependencia—, y el logo son cuatro piezas más dentro del zip:

| Pieza | Para qué |
|---|---|
| `xl/media/logo.jpeg` | la imagen |
| `xl/drawings/drawing1.xml` | dónde va y de qué tamaño (`oneCellAnchor`, EMU) |
| `xl/drawings/_rels/drawing1.xml.rels` | el dibujo → la imagen |
| `xl/worksheets/_rels/sheet1.xml.rels` | la hoja → el dibujo |
| `[Content_Types].xml` | declarar `image/jpeg` y el tipo del dibujo |

Si falta una, Excel abre el archivo sin la imagen o se niega a abrirlo, **y las dos cosas pasan en
silencio**: por eso el verificador comprueba las cinco.

Además, lo que la §4.6 pedía y la planilla no tenía:

- el **nombre de la clínica** arriba, en SU color (`xl/styles.xml`, fuente con `color rgb`);
- **la fecha de generación y el autor**;
- **filtro automático** sobre la tabla —empieza en la fila de los títulos, no en el encabezado—;
- **formato de moneda** en las columnas de dinero, que siguen siendo números y se pueden sumar;
- **encabezado de impresión** con el nombre de la clínica, el título y la paginación.

**Lo que no se hizo, y por qué:** el logo *dentro del encabezado de impresión* necesita un
`legacyDrawingHF` con VML, un formato que Excel acepta solo en una forma muy precisa y que mal
armado hace que el archivo no abra. El logo va en la hoja, que es lo primero que se imprime, y el
nombre sí está en el encabezado de impresión de todas las páginas.

---

## 3. Los tres PDF que usaban constantes copiadas

| Documento | Qué tenía | Qué tiene |
|---|---|---|
| **Reporte de atenciones** (se presenta ante el colegio) | tres constantes propias y un encabezado a mano | `dibujarEncabezado()` con el logo, el nombre, el color de la clínica y el pie con fecha y autor |
| **Receta** | tres constantes propias; el logo lo leía la ruta | el color de `marca.primario`; el logo del punto único |
| **Comprobante electrónico** | cuatro constantes propias; el logo por `logoClinica.ts` | el color de la clínica; el logo del punto único |

**El XML firmado no se tocó.** El cambio es solo de la representación gráfica, que es lo que el
prompt pide y lo que la norma permite: la validez del comprobante está en el XML.
`verificar_xml_y_firma` sigue en **TODO OK**.

El borde (`#D7DEE8`), el gris de apoyo, el ámbar de los avisos y el rojo de «FALTA COLEGIATURA`
**no** se tiñen con el color de la clínica, y el verificador los permite explícitamente: teñir un
aviso con el color de marca es perder el significado del color.

---

## 4. Un defecto de política que se cerró de paso

La receta tenía **dos políticas para el mismo documento**:

- la ruta del agente devolvía **422** y no emitía la receta si la clínica no tenía logo;
- la receta de la atención se emitía igual, sin logo.

Gana la del paciente: **se imprime el nombre de la clínica y la receta sale**. Es el criterio que ya
argumentaba `recetaPdf.ts` —«no entregar un documento clínico que el propietario necesita porque
falta un archivo de marca es poner la marca por encima del paciente»— y ahora es la única política
del sistema, escrita en el punto único y en la guía.

---

## 5. El inventario de exportaciones, y por dónde pasa cada una

| Exportación | Formato | Pasa por |
|---|---|---|
| Kardex de inventario | PDF y Excel | `aPdf`/`aExcel` con marca |
| Reportes de caja (cierre, cobros, descuentos…) | PDF y Excel | idem |
| Finanzas: cuadernos para el contador | PDF y Excel | idem |
| Administración: catálogos, planilla, comisiones | Excel | idem |
| Dashboards (prompt 12) | PDF y Excel | `dashboardAPdf` + `aExcel` con marca |
| Listas del drill-down (prompt 12) | PDF y Excel | `aPdf`/`aExcel` con marca |
| Receta | PDF | `generarPdfReceta` con marca |
| PDF del examen físico | PDF | ya usaba `dibujarEncabezado` |
| Reporte de atenciones | PDF | migrado |
| Comprobante electrónico | PDF | migrado |
| Cierre de caja y presupuesto | PDF | ya usaban `marcaPdf` |
| Documentos clínicos (11) | PDF | ya usaba `marcaPdf` |

Son **12 llamadas** a los exportadores genéricos más **7 generadores propios**, y las 19 pasan por
el punto único.

---

## 6. Que no vuelva a pasar

`verificar_marca_exportaciones.ts`, en dos mitades:

**A. Estática.** Falla si una llamada a `aExcel(` o `aPdf(` no lleva la marca, y si un generador de
PDF declara colores de marca propios. Lee **la llamada completa contando paréntesis** y no una
ventana de tamaño fijo: con una ventana, una llamada con un literal largo de columnas quedaba
cortada y se reportaba como si le faltara la marca —un falso positivo enseña a ignorar al
verificador—.

**B. Real.** Genera los archivos y los vuelve a abrir: las cinco piezas del .xlsx, los bytes de la
imagen idénticos al logo de la clínica, la proporción respetada, el filtro automático, el formato de
moneda, el encabezado de impresión, y que el PDF incrusta una imagen.

**Y una tercera cosa que vale más que las dos:** se generan el mismo PDF y el mismo .xlsx con dos
colores de clínica distintos y **se comprueba que los archivos difieren**. Si el generador ignorara
el color, saldrían idénticos. Además, el `FF720AB8` de la clínica aparece en `xl/styles.xml` en el
formato que Excel espera.

La regla quedó escrita en la **guía rectora, §4.6**.

---

## 7. Las muestras

`docs/reportes/muestras-pdf/`, generadas con `muestras_exportaciones.ts` (re-corrible, solo lee):

| Archivo | Qué es |
|---|---|
| `comprobante-con-logo.pdf` | **un comprobante REAL** de la clínica de prueba, con su logo y su violeta `#720AB8` |
| `receta-con-logo.pdf` / `receta-sin-logo.pdf` | la receta con logo y la misma sin logo, con el nombre haciendo de marca |
| `reporte-atenciones-con-logo.pdf` / `-sin-logo.pdf` | el reporte del colegio, en los dos casos |
| `lista-con-logo.pdf` / `.xlsx` y `lista-sin-logo.pdf` / `.xlsx` | un kardex de ejemplo en los dos formatos y los dos casos |

El tamaño ya dice algo: 25 KB con logo contra 2 KB sin logo, en los dos formatos.

---

## 8. Qué se verificó, y qué no

| Qué | Cómo |
|---|---|
| Las 12 llamadas pasan la marca | verificador, mitad A |
| Ningún generador declara color de marca propio | idem |
| El verificador **falla** contra el estado anterior | 15 hallazgos |
| Las cinco piezas del .xlsx con logo | verificador, mitad B, abriendo el zip |
| Los bytes de la imagen son los del logo | idem |
| La proporción real se respeta (4,019 vs. 4,017) | idem |
| Filtro automático, moneda, encabezado de impresión | idem |
| **El color de la clínica llega al archivo** | dos colores → dos archivos distintos; `FF720AB8` en los estilos |
| Con logo y sin logo | las dos clínicas reales de la base |
| El XML firmado no cambió | `verificar_xml_y_firma`: **TODO OK** |
| Sin regresiones | `rutas_unicas`, `ventas_caja`, `atencion_07c`, `dashboards_12`: **0 fallos**; `tsc --noEmit` limpio |

**No se miraron los PDF renderizados.** No hay poppler ni navegador en este entorno, así que no se
pudo convertir una página a imagen ni extraer su texto de forma confiable. Las muestras están
generadas y **esperan la revisión en papel del dueño del producto**, que es exactamente para lo que
el prompt las pide. Lo que sí está probado es que el logo se incrusta, que la proporción es la
correcta y que el color de la clínica cambia el archivo.

**Tampoco se exportó desde la interfaz.** Las cinco pantallas que el prompt pide recorrer quedan
pendientes de hacerse a mano; las rutas están probadas desde el dominio.
