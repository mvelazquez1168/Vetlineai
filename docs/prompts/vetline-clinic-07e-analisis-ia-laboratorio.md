# Vetline Clinic — 07e · Lectura y análisis con IA de los estudios de laboratorio

Rama: una nueva, que parte de la del 07d. Se rige por `vetline-clinic-00-guia-rectora.md`, sección 12, incluida la regla del manual de usuario.

## Por qué existe

Cuando llega un resultado de laboratorio, el médico tiene que transcribir los valores y después interpretarlos. Este prompt hace dos cosas:
- **lee el informe** (PDF o CSV) y propone los valores para revisión;
- **interpreta el estudio con IA** como apoyo al médico, considerando la especie, la raza, la edad, la medicación activa y los estudios anteriores.

**Se toma la lógica ya probada en NutriSmart** (`C:\Nutrismart\apps\api\src`), adaptada a medicina veterinaria. NutriSmart no se copia como código, porque es otro proyecto y otro stack (Fastify). Se adoptan sus **reglas y su diseño**, que costaron varias iteraciones:

- `laboratorios/pdf.ts`: lectura del PDF;
- `laboratorios/csv.ts`: lectura del CSV;
- `routes/ia.ts`: rutas `/api/labs/:estudioId/interpretar`, `/interpretacion` y `/revisar`;
- `ia/prompts.ts`: `promptInterpretacionLabs`.

## 0. Relevamiento

El informe parte de dos relevamientos:

1. **En Vetline Clinic:** cómo funciona hoy el laboratorio del 07, el 07c y el anexo. Catálogo de estudios y analitos, rangos de referencia por especie, carga de resultados, adjuntos, tendencias y aviso de "sin ver".
2. **En NutriSmart (solo lectura):** las reglas de los archivos citados, para replicarlas.

## 1. Lectura del informe (PDF o CSV), sin persistir nada

- Al adjuntar el informe de un estudio, el sistema **extrae el texto del PDF** (o lee el CSV) y le pide al modelo que **empareje cada analito con un código del catálogo de analitos de la clínica**, nunca con un nombre libre. El modelo también devuelve el valor, la unidad y **el rango de referencia que imprime el laboratorio**.
- **Se exige que el código exista en el catálogo.** Un código inventado no resuelve a nada y cae en "no reconocidos", a la vista del médico. Un nombre inventado podría parecerse a uno real y colarse.
- **No se persiste nada.** Lo leído llena la **pantalla de revisión** de resultados: el médico ve cada valor junto al informe, corrige y confirma. Un decimal mal leído en un laboratorio no es un error cosmético.
- **El rango del informe** viaja con cada resultado, porque es el del laboratorio que hizo esa medición. Lo que el informe no declara queda en nulo, **nunca en cero**. Si no hay rango del informe, se usa el rango por especie del catálogo, y si tampoco hay, queda "sin referencia".
- **PDF escaneado (sin texto seleccionable):** no se llama a la IA. Se avisa que hay que capturar los valores a mano.
- Todo consumo pasa por la **compuerta de crédito existente**, con la función identificada (por ejemplo, `lectura_labs`).

## 2. Interpretación con IA

**Disparo:** desde un estudio con resultados confirmados, el médico pulsa **"Analizar con IA"**. También puede haber una opción por clínica para generarla automáticamente al confirmar los resultados, desactivada por defecto.

**Qué va al modelo** (como en NutriSmart, **solo los números**):
- Cada analito cuantitativo catalogado, como "valor unidad (referencia mín–máx) [FUERA DE RANGO] [anterior: valor]".
- **Los resultados cualitativos y los analitos sin catalogar no se mandan a interpretar.** Un "negativo" convertido en 0 se leería como un valor fuera de rango. La pantalla dice cuáles no se interpretaron y por qué.
- Si no queda ningún valor interpretable, se responde así, **sin pagar una llamada**.

**Contexto veterinario** que acompaña a los valores:
- especie, raza, edad, sexo y estado reproductivo;
- peso actual;
- **medicación activa**, porque varios fármacos alteran valores;
- **predisposiciones de la raza**, del documento de Vetline Ai (si el módulo está habilitado);
- el motivo de la atención ligada al estudio;
- las **tendencias** frente a los estudios anteriores.

**El prompt**, adaptado de `promptInterpretacionLabs`:
- Redacta para un **médico veterinario** que revisará y editará antes de que algo llegue al expediente.
- Los datos van dentro de un bloque delimitado y **se declaran datos, no instrucciones** (protección contra inyección).
- Tiene **secciones fijas**:
  - RESUMEN CLÍNICO;
  - HALLAZGOS RELEVANTES, por sistema;
  - DIFERENCIALES A CONSIDERAR, nunca un diagnóstico definitivo;
  - ESTUDIOS COMPLEMENTARIOS SUGERIDOS;
  - SEGUIMIENTO PRIORITARIO, con qué repetir y en qué plazo.
- **Reglas:**
  - un analito sin rango declarado **no se describe como normal**;
  - se habla solo de los analitos de la lista, sin suponer resultados ausentes;
  - extensión máxima definida;
  - sin advertencias genéricas de "consulte a un profesional", porque quien lee lo es.

**Almacenamiento**, en una tabla de interpretaciones con RLS y `ON DELETE CASCADE`: estudio, paciente, médico que la pidió, modelo, prompt usado, texto, tokens de entrada y salida, y fecha. Cada nueva generación se guarda aparte, sin pisar la anterior.

**Revisión:**
- La interpretación nace **"sin revisar"** y se muestra marcada como generada por IA.
- El médico la edita y la marca **revisada**. Queda quién y cuándo, y es idempotente: revisar otra vez no cambia al revisor original.
- **Solo lo revisado** puede citarse en la nota de la atención, con un botón "Agregar a la evaluación", o publicarse al cliente.

**Para el cliente** (se conecta con la app del cliente del 17 y con la experiencia posvisita): desde una interpretación revisada, el médico puede generar una **explicación en lenguaje simple** para el dueño. La revisa y la publica con el resultado, respetando la opción "no publicar hasta conversarlo con el dueño". Hasta que exista el 17, se envía con `emitirNotificacion` y `puedeEnviar()`.

**Permisos:** solo el rol médico pide, revisa y publica interpretaciones. El consumo se atribuye al médico y a la clínica en el medidor de IA existente.

## Manual de usuario

Las páginas de `docs/ayuda/` explican:
- cómo subir un informe y revisar los valores leídos;
- qué pasa con un PDF escaneado;
- cómo pedir el análisis y qué considera;
- por qué los cualitativos no se interpretan;
- cómo revisar, editar y publicar;
- el costo en créditos.

Incluyen un ejemplo con un hemograma y una química de un perro.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador con `demo.medico`:

- subir un PDF de un hemograma con texto, revisar los valores (con uno corregido a mano) y confirmar;
- subir un PDF escaneado y comprobar el aviso;
- pedir el análisis de un estudio con un valor fuera de rango, un analito sin rango y un cualitativo, y comprobar que el cualitativo no va al modelo, que el analito sin rango no se llama normal y que aparecen las tendencias;
- editar y marcar revisada;
- agregarla a la evaluación de la atención;
- generar y publicar la explicación para el dueño;
- una prueba de inyección: un valor con texto que intenta dar instrucciones.

**Medir:** el costo por lectura y por análisis.

El informe incluye qué se adoptó de NutriSmart y qué se adaptó, las migraciones (con RLS forzado y `ON DELETE CASCADE`), los prompts finales y las mediciones.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
