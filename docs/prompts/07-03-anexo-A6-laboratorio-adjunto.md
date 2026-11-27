# 07-03 Anexo — A6: adjuntar un laboratorio ya realizado

Se suma a la parte A del anexo, en la rama `vetline-clinic/07-03-anexo`. Se hace después de la pieza de la parte A que esté en curso.

## El problema

En la atención, el botón **Estudio (Alt+E)** abre "Pedir un estudio": estudio, laboratorio externo, servicio del catálogo y observaciones. Con eso se registra una orden, pero no se puede hacer lo que la clínica necesita: **cargar el resultado de un laboratorio que ya se hizo** (en la clínica o en un laboratorio externo) para que quede en el expediente.

## Antes de construir: relevamiento

Que quede documentado, al inicio del informe, qué hace hoy todo lo relacionado con laboratorios: el modal "Pedir un estudio", la pestaña **Laboratorio** y la pestaña **Imágenes y documentos** del expediente, las tablas y endpoints que usan, si existe algún estado "pendiente de resultado", cómo genera el cargo el servicio del catálogo y si algo de Vetline Ai (casos, agentes) ya lee laboratorios o adjuntos. Nada de lo que exista hoy se pierde.

## Resultado esperado

- **Registrar laboratorio** es la acción principal del botón Alt+E y de la pestaña Laboratorio. Pide:
  - el estudio, con sugerencias (hemograma, química, urianálisis, coprológico, etc.) y texto libre;
  - la fecha de la toma de la muestra;
  - quién lo hizo: la clínica o un laboratorio externo, con su nombre;
  - uno o varios archivos adjuntos (PDF o foto tomada con el celular);
  - el comentario o la interpretación del médico;
  - un servicio del catálogo, opcional, para cobrarlo cuando la clínica lo hizo o lo intermedia. Se cobra igual que hoy.
- **Pedir sin resultado** sigue disponible como opción secundaria ("todavía no tengo el resultado"). Deja el estudio como pendiente, visible en la atención y en el expediente. Al adjuntar el resultado después, el pendiente se cierra; no se crea un registro aparte.
- Se puede adjuntar un laboratorio **fuera de una atención**, directo desde la pestaña Laboratorio del expediente. Así entran los resultados que llegan días después o los que trae el cliente de otra clínica.
- En la pestaña Laboratorio, los resultados aparecen por fecha, con vista previa del archivo, descarga y el comentario del médico. Los pendientes se distinguen a simple vista.
- Los archivos se guardan con el mismo mecanismo de adjuntos que ya usa el sistema (el de Imágenes y documentos o el de los casos de Vetline Ai). No se crea un almacenamiento nuevo si ya existe uno.
- Los nombres en pantalla dicen lo que hacen: "Registrar laboratorio" y "Pendiente de resultado", no "Pedir un estudio".

## Cierre

Aserciones en el verificador del anexo, verificación en navegador con el usuario demo (subir un PDF y una foto, registrar uno pendiente y luego cerrarlo con su resultado) y una sección en el manual de `docs/ayuda/`. Para solo si el relevamiento muestra que algo de lo existente se contradice con esto.
