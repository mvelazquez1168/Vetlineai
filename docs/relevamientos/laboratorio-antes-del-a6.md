# Laboratorio: qué hace hoy, antes del A6

Relevamiento pedido por `docs/prompts/07-03-anexo-A6-laboratorio-adjunto.md` («Antes de construir»).
Leído contra el código del 26/11/2026, en la rama `vetline-clinic/07-03-anexo`. **Nada de lo que
existe se pierde con el A6**; esto es la lista de lo que hay que respetar.

---

## 1. El modelo

### `exp_estudios_lab` (migración 101, ampliada por la 115)

Una fila por estudio. **No hay una tabla de órdenes aparte**, y está escrito en la migración por qué:
«una orden es un estudio que todavía no tiene resultado, y separarlas obligaría a copiar los datos
del estudio al llegar el resultado». Eso es exactamente lo que el A6 pide conservar: *«al adjuntar
el resultado después, el pendiente se cierra; no se crea un registro aparte»*. **El modelo ya está
del lado correcto.**

| Columna | Qué guarda |
|---|---|
| `estado` | `solicitado` · `muestra_enviada` · `resultado_recibido` · `cancelado` |
| `es_externo` + `laboratorio` | quién lo hizo |
| `fecha_solicitud` / `fecha_resultado` | con CHECK: `resultado_recibido` exige fecha |
| `archivo_id` | **el PDF, ya previsto**, FK a `archivos` |
| `observaciones` | el comentario del médico |
| `visto_en` / `visto_por` | el aviso de resultado sin leer |
| `servicio_id` / `atencion_item_id` | el cargo, agregado por la 115 (07c) |

**Ya existe un estado «pendiente de resultado»**: es `solicitado`. Lo que falta no es el estado, es
la pantalla que lo cierre.

### `exp_lab_resultados` (migración 101)

Un valor por analito, con el rango **copiado del catálogo al cargarlo** para que un resultado viejo
no se reinterprete si el catálogo cambia. Acepta valor numérico o texto («positivo»), nunca ninguno
de los dos. `bandera` alto/bajo/normal.

### `exp_analitos`

Catálogo por especie con rangos de referencia. Alimenta la tendencia.

---

## 2. Lo que ya funciona en el backend

`backend/src/expediente/laboratorio.ts`:

- `solicitarEstudio` — crea la orden.
- `cambiarEstadoEstudio` — mueve el estado.
- `cargarResultados` — **ya acepta `archivoId` y `observaciones`**, normaliza la especie para no
  perder el rango de los pacientes con `canino` en minúscula (defecto que cerró la migración 103),
  **reemplaza** los resultados del estudio en vez de duplicarlos («el laboratorio manda el mismo
  correo dos veces»), y calcula la bandera contra el rango del catálogo.
- `marcarEstudioVisto`, `estudiosDePaciente`, `tendenciaDeAnalito`, `analitosConHistoria`,
  `estudiosSinVer`.

`backend/src/expediente/preventivos.ts::pedirEstudio` — el camino del 07c desde la atención. Crea el
estudio en `solicitado` y, si lleva servicio del catálogo, genera el cargo con `agregarItem` (el
mismo punto que todo lo demás de la atención). **Regla ya tomada**: un estudio externo no lleva
servicio, porque lo que se cobra es el envío y no el estudio.

Rutas en `expediente.routes.ts`: `POST /pacientes/:id/laboratorio`, `PUT /laboratorio/:id/estado`,
`POST /laboratorio/:id/resultados`, `POST /laboratorio/:id/visto`, `GET /laboratorio/sin-ver`,
`GET /pacientes/:id/laboratorio`, `GET /pacientes/:id/laboratorio/tendencia/:codigo`, y
`POST|GET /atenciones/:id/estudios`.

---

## 3. Lo que hace hoy la interfaz

- **Botón «Estudio (Alt+E)» de la atención** → `ModalEstudio` (`AccionesClinicas.tsx`): estudio,
  externo sí/no, laboratorio, servicio del catálogo y observaciones. **Solo pide**: no hay forma de
  adjuntar un resultado.
- **Pestaña Laboratorio del expediente** (`PestanasExpediente.tsx`): lista los estudios, permite
  cargar resultados analito por analito y ver la tendencia **como tabla**, no como gráfico.
- **Pestaña «Imágenes y documentos»**: es un **filtro de la línea de tiempo** por
  `tipoEvento: "documento"`. No sube nada.

---

## 4. El hueco real, y es uno solo

**No existe ninguna forma de subir un archivo a un paciente.**

`archivos` tiene `paciente_id`, `atencion_id` y `tipo_documento` desde la migración 101, y
`exp_estudios_lab.archivo_id` los está esperando. Pero el único endpoint de subida
(`POST /api/archivos`, `archivos.routes.ts:85`) **exige `casoId`** y rechaza sin él: es el adjunto
del chat de Vetline Ai. Un resultado de laboratorio que llega por correo hoy no tiene dónde entrar
si el paciente no tiene un caso abierto.

Entonces el A6 es, en lo esencial: **abrir la subida de archivos al paciente y al estudio**, y poner
encima la pantalla de «Registrar laboratorio». El almacenamiento no se toca —`almacenamientoPrivado`
y el mismo `multer` con su límite de 25 MB—, ni se crea una tabla nueva.

---

## 5. Qué de Vetline Ai lee esto, para no romperlo

- `archivosDelCaso.ts` es la fuente única de los adjuntos que ve el agente, y filtra **por caso**.
  Un archivo con `paciente_id` y sin `caso_id` no le llega al agente, que es lo correcto: un
  laboratorio del expediente no es un adjunto de una conversación.
- `contextoCaso.ts` arma el contexto clínico del agente. **Hay que revisar si incluye laboratorios**
  antes de cambiar nada ahí; si no los incluye, el A6 no es el lugar para agregarlos.
- Los estudios sin ver alimentan la franja de alertas del expediente (`resumen.ts`) y el aviso del
  inicio. Al cerrar un pendiente con su resultado, ese aviso tiene que apagarse solo.

---

## 6. Las dos cosas que el A6 cambia de nombre

El prompt pide que los nombres digan lo que hacen. Hoy:

| Dice | Hace | Pasa a decir |
|---|---|---|
| «Pedir un estudio» | crea una orden sin resultado | **Registrar laboratorio**, con «todavía no tengo el resultado» como opción secundaria |
| `estado = 'solicitado'` | no hay resultado todavía | **Pendiente de resultado** en pantalla (el valor de la base no cambia) |
