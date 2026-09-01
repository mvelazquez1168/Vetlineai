# Prompt — Los correos al consumidor final salen con la marca del cliente

> Sirve para los dos productos. Los nombres de las tablas y de los campos difieren, así que relevá primero cómo se llaman acá.

---

## El problema

Hoy los correos que llegan al consumidor final —el dueño de la mascota, el paciente, quien reservó una cita— salen con la marca de la plataforma en el encabezado.

**Pero quien le escribe no es la plataforma: es el comercio.** El consumidor final no tiene relación con nosotros y probablemente ni sepa qué somos. Un recordatorio que llega con una marca que no reconoce se lee como algo ajeno, y en el mejor de los casos como publicidad.

Además de ser lo correcto, refuerza la marca del cliente, que es un argumento de venta.

---

## Qué cambia

**En los correos dirigidos al consumidor final**, el encabezado lleva la marca del comercio: su nombre, su logo si lo cargó, y su color de marca.

**En los correos dirigidos al titular de la cuenta** —verificación, invitación de equipo, cobros, avisos de canal— **la marca sigue siendo la de la plataforma.** Ahí sí la relación es directa: le escribimos nosotros y sobre nuestro servicio.

Esa separación es la que ordena todo el trabajo. **Antes de tocar nada, clasificá cada plantilla existente en una de las dos categorías y pasame la lista.** Si alguna no encaja limpio en ninguna, decímelo en vez de decidirlo.

---

## De dónde salen los datos de marca

Del mismo lugar donde ya vive la apariencia configurable: nombre, logo y color. **No inventes un juego de campos nuevo para el correo.**

Y resolvé los tres casos de ausencia:

**Sin logo cargado**, el nombre del comercio en texto, con la tipografía del correo. No un hueco ni un ícono roto.

**Sin color configurado**, un color neutro legible, no el de la plataforma. El azul de la plataforma en un correo que dice ser de la clínica es peor que un gris.

**Y el contraste.** El nombre va sobre el color de marca del comercio, que puede ser cualquiera. Reusá el cálculo de contraste que ya existe en el sistema de color en vez de suponer texto blanco. Un comercio con marca amarilla no puede quedar con el nombre ilegible.

---

## El remitente

Si el encabezado dice la clínica y el correo llega desde una dirección de la plataforma, la incoherencia se nota más que antes.

**El dominio del remitente sigue siendo el nuestro** —es el que está autenticado y no se puede cambiar sin que el correo deje de autenticar—. Lo que sí cambia es **el nombre visible**: que diga el nombre del comercio.

Es lo habitual y funciona bien: el destinatario ve el nombre de la clínica y la dirección técnica queda detrás.

**Y decidí qué pasa con la dirección de respuesta.** Si el comercio tiene un correo de contacto configurado, lo natural es que las respuestas le lleguen a él y no a un buzón nuestro que nadie mira. Decime qué proponés.

---

## El pie

Un pie discreto que diga que el correo se envía a través de la plataforma.

**No es marca: es honestidad y protección.** Si el destinatario responde, reclama o denuncia el correo como no deseado, tiene que poder saber quién es quién. Y ante una queja de correo no solicitado, que la plataforma esté identificada nos protege a nosotros.

Discreto de verdad: texto chico, sin logo, al final.

---

## Cuidados

**No romper la autenticación del correo.** El dominio de envío y la firma no se tocan. Lo único que cambia es el contenido y el nombre visible.

**El logo del comercio se sirve desde una dirección estable y pública.** Los clientes de correo no ejecutan nada ni siguen redirecciones raras, y muchos bloquean imágenes por omisión — así que el correo tiene que verse bien **sin ninguna imagen cargada**. Probalo con las imágenes bloqueadas.

**Nada de datos personales en la dirección de la imagen.** Un logo servido con el identificador del contacto en la ruta filtra información a cualquier intermediario.

**Y las plantillas se prueban en clientes de correo reales**, no solo en el navegador. El correo no es la web: no hay hojas de estilo modernas, y lo que se ve bien en una pestaña se rompe en Outlook.

---

## Criterio de terminado

1. Los correos al consumidor final llevan el nombre, el logo y el color del comercio.
2. Los correos al titular de la cuenta siguen con la marca de la plataforma, y me pasaste la clasificación de cada plantilla.
3. Sin logo se ve el nombre en texto; sin color se ve un neutro legible, no el de la plataforma.
4. El nombre sobre el color de marca cumple el contraste mínimo, con los casos extremos probados.
5. El nombre visible del remitente es el del comercio y el dominio sigue siendo el nuestro, con la autenticación intacta.
6. El pie identifica a la plataforma de forma discreta.
7. El correo se lee bien con las imágenes bloqueadas.
8. Ninguna dirección de imagen lleva datos del destinatario.
9. Las pruebas anteriores siguen en verde.

---

## Cómo quiero que trabajes

Mostrame primero la clasificación de las plantillas en las dos categorías y tu propuesta para la dirección de respuesta. Esperá mi confirmación antes de escribir código.

Y no pruebes contra mi entorno: usá el arnés de integración. Ya perdimos una imagen así.
