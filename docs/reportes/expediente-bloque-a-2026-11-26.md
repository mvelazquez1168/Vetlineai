# Vetline Clinic 07 — Expediente clínico, bloque A

Rama `vetline-clinic/07-expediente`. Bloque A del prompt
`docs/prompts/vetline-clinic-07-expediente-clinico.md`: **el expediente**. El bloque B —la atención
que genera cargos— va en su propia entrega, y depende de la entrada de cargos de la caja, que se
completó primero (ver `caja-ventas-2026-11-26.md`, addendum 2).

No se tocó producción. No salió ningún correo. Ningún comprobante fue a Hacienda.

---

## 1. La decisión de fondo: el expediente es una VISTA, no una tabla nueva

La historia clínica de un paciente ya estaba repartida entre tablas que existen y se usan: `citas`,
`casos` y sus mensajes, `recetas` y `receta_items`, `cuidados_preventivos` (vacunas y
desparasitaciones), `atenciones`, `archivos`.

La tentación era crear una tabla de eventos del expediente y escribir ahí una copia de cada cosa que
pasa. **No se hizo**: un dato en dos lugares es un defecto aunque hoy coincidan, y lo caro es que la
divergencia no rompe nada visible. La línea de tiempo del expediente es un `UNION` sobre las tablas
que ya son dueñas de cada hecho (`expediente/resumen.ts`, `lineaDeTiempo`). Lo único que se creó son
las tablas de lo que **no existía en ninguna parte**.

### Lo que sí hacía falta crear (migración 101)

| Tabla | Qué guarda, y por qué no existía |
| --- | --- |
| `exp_problemas` + `exp_problema_atenciones` | La **lista de problemas** activos y resueltos, y en qué atención se tocó cada uno. No había forma de preguntar «qué tiene este paciente hoy». |
| `exp_alergias` | Alergias e intolerancias, por fármaco **o por grupo**. Es lo que dispara el aviso al recetar. |
| `exp_analitos`, `exp_estudios_lab`, `exp_lab_resultados` | Laboratorio con **rango de referencia por especie**: sin eso un resultado es un número sin significado. |
| `exp_grooming` + servicios + hallazgos | La visita de estética, y el **hallazgo clínico** que la peluquera encuentra y que un médico tiene que ver. |
| `exp_plantillas_consentimiento`, `exp_consentimientos` | El consentimiento informado con su **texto congelado**: lo que el cliente firmó, no lo que hoy dice la plantilla. |
| `exp_adendas` | La corrección de una atención ya cerrada. |

`archivos` se amplió (`paciente_id`, `tipo_documento`, `es_externo`, `descripcion`,
`fecha_documento`) para que un documento del expediente —una radiografía, la historia de otra
clínica— cuelgue del paciente. `atenciones` se amplió con `estado`, `cerrada_en`, `firmada_por` y
`firmada_nombre`, más los disparadores de inmutabilidad.

---

## 2. Lo construido

- **`expediente/clinico.ts`** — problemas, alergias y el chequeo que corre al prescribir.
- **`expediente/laboratorio.ts`** — carga de resultados, `banderaDe` (bajo/normal/alto según el rango
  de la especie) y `tendenciaDeAnalito` (la serie histórica de un analito).
- **`expediente/grooming.ts`** — la visita de estética y sus hallazgos.
- **`expediente/consentimientos.ts`** — cuatro plantillas base, `resolverMarcadores` para armar el
  texto con los datos del paciente y del dueño, y el congelado del texto al firmar.
- **`expediente/resumen.ts`** — `encabezadoDeExpediente`, `lineaDeTiempo` (el `UNION`),
  `buscarEnHistoria`, `evolucion` y `fichaRacial`, que **reusa** `seleccionarSeccionRaza` del motor
  de predisposiciones en vez de tener su propio criterio.
- **`routes/expediente.routes.ts`** — 33 rutas bajo `/api/expediente`. La escritura clínica está
  gateada a médico; el grooming queda abierto a cualquier persona del personal, **documentado como
  provisional** hasta que el prompt 04 cree el rol de peluquería.
- **Frontend** — `FranjaAlertas` (alergias y problemas activos, arriba de todo), `PestanasExpediente`
  con once pestañas, y la ficha del paciente reorganizada alrededor de ellas.

### Las once pestañas

Resumen · Línea de tiempo · Visitas · Vacunas · Desparasitaciones · Laboratorio · Imágenes y
documentos · Prescripciones · Grooming · Casos de Vetline Ai · Consentimientos.

Cuatro tienen vista propia (Resumen, Laboratorio, Grooming, Consentimientos); las otras siete son la
misma línea de tiempo filtrada por tipo de evento. No son siete pantallas: es un filtro, y por eso
no pueden decir cosas distintas entre sí.

---

## 3. Cuatro defectos reales encontrados mientras se construía

1. **Los disparadores de inmutabilidad trababan la purga.** Misma familia que el defecto D-006: una
   tabla que se protege contra el `UPDATE` también se protege contra el borrado en cascada de una
   clínica purgada. Migración **102**, con `fact_es_operacion_directa()` para distinguir la mano de
   un usuario de la cascada.
2. **Los analitos se sembraron con `'perro'` y `'gato'`** mientras `pacientes.especie` dice `Canino`
   y `Felino`. El efecto no era un error: era **cada resultado de laboratorio sin rango y sin
   bandera**, en silencio. Migración **103** con el valor real y un `CHECK`, más `normalizarEspecie`
   para que una especie escrita de otra forma no vuelva a pasar inadvertida.
3. **`archivos.caso_id` era `NOT NULL`.** No se podía guardar la radiografía que trae el cliente sin
   inventarle un caso de Vetline Ai —y un caso inventado aparecería en los listados y en el consumo
   de IA—. Migración **104**: `caso_id` admite nulo y un `CHECK` exige que todo archivo cuelgue de
   algo, de un caso o de un paciente.
4. **`Promise.all` sobre un solo cliente de Postgres.** node-postgres no permite consultas
   concurrentes en el mismo cliente: hoy avisa, en `pg@9` falla. Se pasó a esperas secuenciales.

Los defectos 2 y 3 aparecieron **al sembrar datos de demostración reales**, no al escribir el
código: la especie equivocada y el `NOT NULL` solo se ven cuando hay un paciente de verdad con una
radiografía de verdad.

---

## 4. Verificación

`backend/src/scripts/verificar_expediente_bloque_a.ts`, corrido **sin `--transpile-only`**, termina
en `TODO OK`. Once secciones:

| § | Qué prueba |
| --- | --- |
| 0 | Clínica, personal y dos pacientes |
| 1 | La historia reúne una visita, una vacuna y una receta **desde las tablas que ya existen** |
| 2 | Lista de problemas: activo, resuelto y su atención |
| 3 | Alergias: el aviso al recetar, **incluso cuando la alergia es por grupo** y el fármaco es otro |
| 4 | Laboratorio: rango por especie, bandera y tendencia de un analito con varias mediciones |
| 5 | Grooming y su hallazgo clínico |
| 6 | Ficha racial: lo que dice el documento, **o nada** —no se inventa contenido para una raza sin fuente— |
| 7 | Integridad: una atención cerrada no se edita; la corrección es una adenda |
| 8 | Consentimientos: el texto queda congelado y es inmutable |
| 9 | El expediente completo y la evolución |
| 10 | RLS: nada de otra clínica, probado con un segundo tenant |

---

## 5. Cómo mirarlo

Usuario `demo.medico@vetlineai-test.com` en la clínica de demostración (admin **y** médico, para
poder escribir lo clínico).

| Qué | Camino de clics |
| --- | --- |
| Expediente de un paciente | Menú lateral → **Pacientes** → `Toby` |
| Franja de alertas | Arriba de la ficha, antes de las pestañas: alergias y problemas activos |
| Laboratorio con banderas y tendencia | Ficha de `Toby` → pestaña **Laboratorio** |
| Grooming y su hallazgo | Ficha de `Toby` → pestaña **Grooming** |
| Consentimiento firmado | Ficha de `Toby` → pestaña **Consentimientos** |
| Una visita con su adenda | Ficha de `Toby` → pestaña **Visitas** |

URL directa del paciente sembrado:
`/pacientes/1acf9b72-b082-4c05-b605-1258fd44b70c`.

Datos sembrados por `sembrar_demo_expediente.ts` en la clínica de demostración: 3 problemas, 1
alergia, 4 estudios de laboratorio con 10 resultados, 1 visita de grooming, 1 consentimiento firmado
y 1 adenda.

---

## 6. Lo que NO es parte de este bloque

El **bloque B** —la atención SOAP que genera cargos: plantillas, examen físico por sistemas, ítems
elegidos del catálogo, aviso de alergia al prescribir, cuenta viva, cierre coherente que empuja los
cargos por `agregarCargo`, descarga de inventario con origen `atencion`, recordatorios, cierre de la
cita y firma— va en su propia entrega. El rol de **peluquería** lo crea el prompt 04; hasta entonces
el grooming lo escribe cualquier persona del personal, y está dicho en el código.
