# Autocompletar por identificación: qué fuentes hay y qué implica cada una

**Documento de diseño, sin código.** Lo pide el anexo 07-03, B2. Existe para que la decisión de
usar el padrón del TSE la tome quien tiene que tomarla, con los costos a la vista, y no se cuele
como un detalle de implementación.

Fecha: 27 de noviembre de 2026. Lo construido hoy es lo de la sección 1.

---

## 1. Lo que está construido: la API pública de contribuyentes de Hacienda

`https://api.hacienda.go.cr/fe/ae?identificacion=…`

- **Qué devuelve:** nombre o razón social, situación tributaria, régimen y actividades económicas
  de quien está **inscrito** ante Hacienda.
- **Qué hace falta:** nada. Es pública, sin convenio, sin credencial, sin cuota publicada.
- **A quién encuentra:** a los inscritos. Un asalariado, un pensionado, un menor de edad o un ama
  de casa **no están**, y son una parte grande de la clientela de una veterinaria.
- **Por qué alcanza igual:** el caso que importa es el del cliente al que hay que **facturarle
  electrónicamente**. Para ese, el nombre que tiene que ir en el comprobante es justamente el que
  Hacienda tiene, y escribirlo distinto es un rechazo. Para el resto, la recepción escribe el
  nombre como siempre y no pierde nada.
- **Estado:** implementado detrás de `IDENTIDAD_PROVEEDOR=hacienda`. El default es el simulado.

**Lo que se guarda:** una caché de plataforma (`identificacion_cache`) con el nombre, lo demás que
vino y la fecha. Vence a los 30 días. No es un padrón nuestro: es una caché con fecha de
vencimiento, y la diferencia es el punto 3 de este documento.

---

## 2. Lo que NO está construido: el padrón del TSE

El Tribunal Supremo de Elecciones publica el **padrón electoral** y tiene el nombre completo de
toda persona con cédula costarricense, inscrita o no en Hacienda. Es el dato que una clínica
querría: cubre a todos sus clientes, no a la mitad.

Tres caminos, con lo que cuesta cada uno:

### 2.a. Descargar el archivo del padrón

El TSE publica el padrón en archivos de distribución (`PADRON_COMPLETO.txt` y su tabla de
distelec). Son del orden de 3,5 millones de filas.

- **A favor:** sin dependencia de red, respuesta instantánea, sin límite de consultas.
- **En contra, y es decisivo:** pasa a ser **nuestra** base de datos personales de 3,5 millones de
  personas que no son clientes de nadie. Eso cambia nuestra categoría frente a la ley 8968 (ver
  sección 3): hoy tratamos datos de los clientes de nuestros clientes, con la clínica como
  responsable; con el padrón entero adentro, el responsable de una base de datos personales de
  alcance nacional somos nosotros, con todo lo que eso trae —inscripción de la base ante la
  PRODHAB, protocolo de actuación, auditorías—.
- **Además:** envejece. Un padrón descargado hace un año tiene nombres de gente que se cambió el
  nombre, se naturalizó o falleció, y nadie se enteraría.

### 2.b. Servicio de consulta del TSE, con convenio

El TSE ofrece consulta de datos del padrón a instituciones mediante **convenio interinstitucional**.

- **A favor:** el dato siempre al día, sin base propia, consulta uno a uno (que es lo que el alta
  necesita).
- **En contra:** requiere convenio, y los convenios del TSE son con instituciones públicas o con
  entidades con un interés legítimo acreditado. Una plataforma SaaS veterinaria tendría que
  argumentar el interés legítimo de cada clínica, no el propio.
- **Plazo realista:** meses, y el resultado no está garantizado.

### 2.c. Un intermediario comercial

Hay empresas en Costa Rica que revenden consulta de padrón con convenio propio.

- **A favor:** se resuelve con una integración y una factura.
- **En contra:** se les paga por consulta —el autocompletar deja de ser gratis y pasa a tener un
  costo por alta—, y **les estaríamos mandando la cédula de cada cliente de cada clínica**. Eso es
  una transferencia de datos personales a un tercero, y necesita estar en el consentimiento que la
  clínica le pide a su cliente. Hoy no está.

---

## 3. La ley 8968 y por qué cambia la respuesta

La Ley de Protección de la Persona frente al Tratamiento de sus Datos Personales (8968) y su
reglamento imponen tres cosas que importan acá:

1. **Consentimiento informado para tratar datos personales**, salvo las excepciones del artículo 5
   (entre ellas, los datos de acceso público no restringido).
2. **Decir de dónde salió cada dato y cuándo.** Por eso existe `propietarios.datos_fuente` y
   `datos_fuente_en`: «lo trajo el autocompletar de Hacienda el 27/11/2026» es una respuesta;
   «estaba ahí» no.
3. **Inscripción de la base de datos ante la PRODHAB** cuando se trata de bases de datos personales
   con fines de distribución, difusión o comercialización.

Las tres apuntan en la misma dirección:

| Camino | Cambia nuestra categoría legal | Consentimiento del cliente final |
|---|---|---|
| 1. Hacienda, consulta puntual (hoy) | No. Es un dato de acceso público y se consulta uno a uno | Cubierto: el cliente dio su cédula para que le facturen |
| 2.a. Padrón descargado | **Sí.** Base de datos personales de alcance nacional, nuestra | No cubierto: 3,5 millones de personas que no consintieron nada |
| 2.b. TSE con convenio | No, si el convenio lo encuadra | Hay que revisarlo con el texto del convenio |
| 2.c. Intermediario | No, pero suma una transferencia a un tercero | **Hay que agregarlo** al consentimiento |

---

## 4. Recomendación

**Quedarse en 1 y no construir 2 hasta que haya un cliente que lo pida con un caso concreto.** El
autocompletar de Hacienda cubre el caso que tiene costo real (el comprobante electrónico rechazado
por un nombre mal escrito) y no mueve nuestra posición frente a la 8968.

Si aparece la necesidad, el orden es **2.b → 2.c → 2.a**: el convenio primero porque es el único que
no agrega ni costo por consulta ni una base nuestra; el intermediario después, con el consentimiento
ampliado; y el padrón descargado **no**, salvo que alguien decida que queremos ser responsables de
una base de datos personales de alcance nacional.

**Lo que ya está listo para cualquiera de los tres:** la interfaz `ProveedorIdentificacion`. Agregar
una fuente es un archivo nuevo y una línea en el selector; nada del alta de clientes se toca.
