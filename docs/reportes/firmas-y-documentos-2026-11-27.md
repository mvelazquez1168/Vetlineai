# Firmas de consentimiento, imágenes y documentos, y el bloqueante de «Registrar atención»

Rama `fix/firmas-y-documentos`, partiendo de la rama del 05. Nada fusionado a `main`.

Migraciones **167** y **168**. Tres verificadores nuevos:

| Verificador | Resultado |
|---|---|
| `verificar_firmas_consentimiento` | **TODO OK**, 44 aserciones |
| `verificar_documentos_expediente` | **TODO OK**, 29 aserciones, con subida real de un PNG y un PDF por HTTP |
| `verificar_atencion_extremo_a_extremo` | **TODO OK**, el flujo completo por HTTP |

---

## 1. La firma del consentimiento no era una firma

**El defecto, tal como estaba en el código:**

```js
firmaPng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ…"
```

Un PNG de **1×1 píxel transparente**, fijo, el mismo para todos. El backend lo aceptaba porque solo
miraba que el texto empezara con `data:image/`. El botón de «firmar» en pantalla era un `<button>`
que ponía un booleano en `true`.

Resultado: **cada consentimiento del expediente decía «firmado», mostraba un nombre y una fecha, y
no respaldaba nada**. Es peor que no tener firma, porque nadie lo nota hasta el día que hace falta.

### Lo que ahora pasa, y dónde

**La firma se dibuja** (`components/ui/PanelFirma.tsx`): con el dedo en una tablet, con el mouse en
una computadora. Un solo juego de manejadores de puntero para los tres —dedo, lápiz y mouse—, porque
dos juegos dibujan doble en una tablet. `touch-action: none`, para que firmar no desplace la página.
El lienzo se dimensiona en píxeles reales y **conserva el trazo al girar el dispositivo**.

**El servidor decide si eso es una firma** (`expediente/firmaPng.ts`). No alcanza con mirar el
tamaño del base64: un PNG grande puede estar vacío. Así que se **decodifica el PNG** —cabecera,
inflado del IDAT y deshacer el filtro por línea— y **se cuentan los píxeles con tinta**:

| Qué llega | Qué pasa |
|---|---|
| El PNG de 1×1 del defecto | **rechazado**: «mide 1×1 y hace falta al menos 200×60» |
| Un lienzo de 400×150 vacío | **rechazado**: «el recuadro está vacío. Pedile al cliente que firme…» |
| Una imagen casi toda pintada | **rechazado**: «eso no parece una firma» |
| Un trazo de verdad (2 % de tinta) | **aceptado** |

Se decodifica a mano y no con una librería: un PNG de `canvas.toDataURL()` es siempre RGBA de 8 bits
sin entrelazar, que es el caso más simple del formato. Sesenta líneas contra una dependencia nueva
para contar píxeles.

### La evidencia

| Qué | De dónde sale |
|---|---|
| Nombre e identificación del firmante | el formulario |
| **Relación con el paciente** (propietario o autorizado, y por quién) | el formulario |
| Fecha y hora | **el reloj del servidor** (`DEFAULT now()`), nunca el del cliente |
| Testigo del personal | la sesión de quien gestiona la firma |
| Dispositivo e IP | la solicitud (`user-agent`, `req.ip`) |

Los tres últimos **no viajan en el cuerpo** a propósito: si viajaran, serían tres datos que el
navegador puede inventar.

### La huella

SHA-256 del **título + el texto exacto + la firma**. Se guarda al firmar y **se verifica al
mostrarlo**: si alguien edita el texto en la base, la huella deja de coincidir y la pantalla y el
PDF lo dicen. Verificado en el verificador: cambiar un espacio del texto rompe la huella.

Un consentimiento sin huella —los viejos— se declara **no verificable**, que es distinto de
«intacto».

### Los consentimientos que ya estaban

Los **3** que había quedaron marcados `firma_valida = false` con su motivo. **No se borraron**: la
conversación con el cliente existió, y borrarla sería perder el registro de que ese día se habló del
procedimiento. La pantalla los muestra con la insignia **«sin firma válida»** y el texto *«conviene
volver a firmarlo»*, y su PDF lo dice en la primera página, antes del texto.

La migración los detecta por el contenido exacto del PNG de relleno **y** por cualquier firma de
menos de 400 caracteres de base64: un trazo real no cabe en eso.

### El PDF y su envío

`GET /expediente/consentimientos/:id/pdf` genera el documento al vuelo —no se guarda, para no tener
un segundo original que pueda divergir— con el texto exacto, la firma, la evidencia completa y **la
huella impresa**, para poder comparar el papel con el registro.

Se le manda al cliente con `emitirNotificacion` pasando por `puedeEnviar()` del 03. **Si no se le
puede escribir, el consentimiento igual queda firmado** y el aviso dice por qué no salió: frenar la
firma porque el correo no se puede mandar sería poner el canal por encima del paciente.

### La firma a distancia

El caso real: la cirugía se decide por teléfono y el dueño está en el trabajo. Hoy eso termina en
«me autorizó por WhatsApp», que no es un consentimiento.

`/firmar/:token` se abre **sin iniciar sesión**. Seis decisiones la hacen segura:

1. **Un solo uso**: se sella al firmar, en la misma transacción que la firma.
2. **Vence en 48 horas.**
3. **El token no se guarda**: se guarda su SHA-256. Una base filtrada no entrega enlaces usables.
4. **Código de verificación al mismo canal.** El enlace solo no alcanza: un WhatsApp reenviado
   dejaría firmar a cualquiera.
5. **Cinco intentos** y el enlace muere. Seis dígitos se adivinan con un script.
6. **El texto se congela** al crear el enlace, y **no se devuelve antes del código**: el texto
   nombra al paciente y el procedimiento.

El testigo de una firma a distancia es **quien pidió la firma**: no hay nadie del personal mirando,
y decir «sin testigo» sería perder el dato de quién gestionó el consentimiento.

---

## 2. Imágenes y documentos: la pestaña ahora permite cargar

El hallazgo era exacto: la pestaña mostraba la línea de tiempo filtrada y **no permitía agregar
nada**. El médico que saca una radiografía la manda por WhatsApp, el expediente queda sin el estudio
y la imagen queda en un teléfono.

**Lo que se construyó**, reusando el almacenamiento, el límite de 25 MB, la tabla de tipos MIME y el
descargador autenticado que ya existían:

- **Carga múltiple** por arrastre, por selector y con la **cámara** (`capture="environment"`). Tres
  entradas al mismo flujo, no tres flujos.
- **Los metadatos se piden una vez para todo el lote**: cinco fotos de la misma radiografía son del
  mismo tipo y la misma fecha, y pedirlos cinco veces es cómo se consigue que nadie los complete.
- **Cada archivo sube en su propia solicitud**: si el tercero falla, los dos primeros ya están.
- **Tipo** del catálogo por clínica (`exp_tipos_documento`, con la semilla que pide el prompt),
  **fecha del documento** —puede ser de hace años; no puede ser futura—, **descripción** y
  **atención** opcional.
- **Galería** con miniaturas, zoom para imágenes y visor en línea para PDF.
- **Filtros** por tipo y por fecha, y **el origen visible** en cada elemento —subido acá, resultado
  de laboratorio, caso de Vetline Ai— con enlace a su registro.
- **Permisos**: el médico sube cualquier tipo; la recepción, solo los administrativos. Se decide en
  el backend (`puedeSubirTipo`) y la pantalla ofrece solo lo que esa persona puede subir.
- **Botón «Adjuntar» en la atención en curso**, con el archivo ligado a ella.
- **Cada carga deja su evento** en la línea de tiempo del paciente.

---

## 3. El bloqueante: «Registrar atención» no abría nada

El prompt de la revisión señalaba como primer sospechoso mi commit `75ca2a9` del 05. **No era.**

Lo primero que se hizo fue escribir `verificar_atencion_extremo_a_extremo.ts`, que recorre **por
HTTP** lo mismo que el navegador: las cinco llamadas que la pestaña hace al montarse, abrir la
atención, leer su detalle, escribir la nota y cerrarla. **Pasa entero**, y de paso confirma que la
cita que se crea sola queda con la fecha de hoy **en la zona de la clínica** y que al cerrar la
atención la cita queda completada por el punto único del 05.

Así que el problema estaba en el frontend. Eran **tres causas** y se cerraron las tres:

| Causa | Por qué hacía eso |
|---|---|
| **Las pestañas colgaban de que el encabezado cargara** (`{expediente && …}`), y el fallo de `GET /expediente/pacientes/:id` se tragaba con un `catch` que ponía `null` | el botón cambiaba la pestaña a una pestaña **que no estaba dibujada**: desde el navegador se ve exactamente como «no se despliega nada» |
| **El botón no bajaba la vista** | el contenido cambiaba 600 píxeles más abajo, fuera de la pantalla |
| **La pestaña pedía el detalle de 100 productos de a uno, en serie** | 101 solicitudes autenticadas encadenadas, cada una abriendo su transacción. Con los 897 productos de la clínica de demostración, la pestaña quedaba inutilizable durante segundos; con la latencia de un servidor real, mucho más |

La tercera se resolvió con **una sola llamada** a `GET /expediente/catalogo-clinico`, que ya
devolvía presentación, precio y lotes con existencia —y es el mismo endpoint que usan las acciones
de la atención, así que la lista del buscador y la de cada acción ya no pueden discrepar—. Medido
contra la base: el bucle tardaba 226 ms de consultas; la llamada única, 82 ms. Y pasa de 101
solicitudes HTTP a 1.

Y el expediente ya **no desaparece** cuando la franja de alertas falla: se dibuja con un aviso de
que las alertas no cargaron.

---

## 4. Cinco defectos más, encontrados por los verificadores

1. **El motivo del rechazo de la firma era el equivocado.** El PNG de 1×1 se rechazaba con «no se
   pudo leer la imagen» —que manda a buscar un problema de formato— porque el tamaño se miraba
   *después* de descomprimir. Ahora se mira con la cabecera, sin descomprimir, y el motivo es el
   verdadero.
2. **La franja horaria del CRM frenaba el enlace de una cirugía de urgencia.** La franja 08:00–20:00
   existe para no molestar a nadie con recordatorios; reprogramar para mañana a las 8:00 un enlace
   que el dueño está esperando **es no mandarlo**. Se agregó `urgente` a `puedeEnviar`, que saltea
   **solo la franja** y nunca el consentimiento ni el dato de contacto.
3. **Un dato mal pedido salía como 500.** «Falta el tipo de documento» llegaba a la pantalla como
   «Error al subir el archivo», que no dice qué arreglar.
4. **`archivos.tipo` guarda una categoría, no un MIME.** La galería preguntaba por `'image/%'` y
   mostraba todo con ícono de documento.
5. **`documento_adjunto` estaba en `crm_tipos_evento` y faltaba en la unión de TypeScript**: el
   catálogo de la base y esa unión son dos listas del mismo concepto, y una se había quedado atrás.

Y uno del propio verificador, que vale anotar: la primera versión del generador de PNG de prueba
pintaba una banda de cuatro píxeles, así que el caso «casi todo pintado» **no podía producirse** y
el verificador fallaba por su dato de prueba, no por el código.

---

## 5. Qué se verificó, y qué no

| Qué | Cómo |
|---|---|
| **El PNG de 1×1 del defecto se rechaza** | verificador, con ese PNG exacto |
| Vacío, demasiado chico y casi todo pintado se rechazan; un trazo real se acepta | idem, con PNG armados byte a byte |
| La evidencia completa queda guardada | idem, leyendo la fila |
| La hora es del servidor | idem: menos de dos minutos de diferencia |
| La huella detecta un texto editado después de firmar | idem |
| El PDF se genera, con firma y con la marca de «sin firma válida» cuando toca | idem |
| Firma a distancia: token en hash, texto solo tras el código, intentos contados, un solo uso | idem, 12 aserciones |
| Los 3 consentimientos viejos quedaron marcados y **no borrados** | idem, contra la base |
| Subida real de un PNG y un PDF **por HTTP** | `verificar_documentos_expediente` |
| La recepción recibe 403 con una radiografía y 201 con el historial previo | idem, por HTTP |
| Filtros por tipo y fecha, origen, y el evento en la historia | idem |
| Adjuntar ligado a la atención, y rechazo de una atención ajena | idem |
| **El flujo de la atención, de punta a punta** | `verificar_atencion_extremo_a_extremo` |
| El manual nuevo se encuentra | `verificar_ayuda_16a`: **53/53** |
| Sin regresiones | `rutas_unicas`, `atencion_07c`, `crm`, `administracion_04`: 0 fallos; `tsc --noEmit` limpio en los dos lados |

**No se verificó en el navegador.** No hay navegador ni automatización de navegador en este entorno.
Lo que está probado es el dominio, el camino HTTP completo con usuarios reales de Keycloak creados y
borrados por el flujo de invitación, los archivos generados y la compilación. Quedan pendientes de
hacerse a mano, y son justamente las tres que el pedido nombra:

1. **firmar con el mouse** y **con pantalla táctil emulada**;
2. **la firma a distancia** abriendo el enlace en un teléfono;
3. **la carga con la cámara emulada**.

Lo que sí se puede afirmar sin navegador: el trazo que sale del lienzo es el que se guarda (el
componente manda `canvas.toDataURL()` y el servidor cuenta sus píxeles), y un recuadro vacío no pasa
ni la pantalla ni el servidor.

**Credenciales:** no se tocó ninguna cuenta existente. Los verificadores crean sus propios usuarios
de Keycloak por el flujo real de invitación y los borran al terminar.
