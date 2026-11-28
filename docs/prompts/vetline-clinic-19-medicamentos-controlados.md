# Vetline Clinic — 19 · Medicamentos controlados

> Prompt para Claude Code. Repo: `vetplatform`. Lee antes `docs/prompts/vetline-clinic-00-guia-rectora.md` y respeta sus reglas (entradas únicas, RLS forzado, permisos desde la base, textos de usted, manual de usuario, nunca se pierden datos al salir de una pantalla).
> Depende de: 06 Inventario (lotes, venta por fracción), 07c Acciones clínicas y receta, 04 Administración base (roles y permisos), 08 Caja.

## 0. Objetivo

Que cualquier clínica veterinaria pueda manejar psicotrópicos y estupefacientes con trazabilidad completa: quién lo recibió, quién lo prescribió o administró, a qué paciente, cuánto, de qué lote y de qué envase, con un libro de control que no se puede alterar, arqueos periódicos y reportes para la autoridad sanitaria.

Debe servir para cualquier país: qué sustancias son controladas, si se exige formulario oficial y el formato del reporte son **configuración**, no código. Para Costa Rica, el reglamento 37111-S indica que el veterinario prescribe estupefacientes y psicotrópicos en el formulario oficial de la Junta de Vigilancia de Drogas; Vetline **no reemplaza** ese formulario: lleva el control interno y registra su número.

Medicavet maneja controlados; la función queda disponible para todas las clínicas como módulo activable por tenant.

## 1. Relevamiento previo (corto, sin detenerte)

Antes de construir, revisa y anota en la bitácora: cómo están hoy `inv_productos`, lotes y venta por fracción; `registrarMovimiento`; las acciones y la receta del 07c; los permisos del 04; y cómo la caja descarga inventario. Construye sobre eso; no dupliques entradas.

## 2. Sustancias controladas (catálogo configurable)

- Que exista `ctl_sustancias`: país, nombre del principio activo, clase (`psicotropico` | `estupefaciente`), lista o anexo de la norma, activa, notas.
- Semilla para Costa Rica con principios activos de uso veterinario frecuente (por ejemplo ketamina, diazepam, midazolam, fenobarbital, butorfanol, fentanilo, morfina, metadona, buprenorfina), **marcados "por verificar con la normativa vigente"**, editables por la administración.
- Un producto se liga a una sustancia (`inv_productos.sustancia_controlada_id`) con su concentración (por ejemplo 100 mg/mL) y la unidad de control (mg o mL). Si tiene sustancia, el producto es controlado: etiqueta visible "Controlado · Psicotrópico/Estupefaciente" en inventario, buscadores, atención, receta y caja.
- Pantalla en Administración › Catálogos y cumplimiento › Sustancias controladas.
- Configuración por tenant: módulo activo, país, `requiere_formulario_oficial` (sí por defecto en Costa Rica), frecuencia de arqueo, días máximos de un envase abierto, ubicación de resguardo por sede (caja de seguridad) y su responsable.

## 3. Permisos

Permisos nuevos, resueltos desde la base (04), asignables por rol:

- `controlados.recibir` — registrar entradas.
- `controlados.prescribir` y `controlados.administrar` — solo para usuarios con número de colegiado activo en su perfil; sin colegiado, el sistema lo impide aunque el rol lo tenga.
- `controlados.dispensar` — entregar al cliente en caja o farmacia.
- `controlados.testigo` — confirmar desechos y arqueos.
- `controlados.arquear`, `controlados.ver_libro`, `controlados.ajustar` (dirección).

Tener acceso a Inventario no da acceso a mover controlados.

## 4. Libro de control (inmutable)

- Que exista `ctl_libro`, solo de inserción: un trigger rechaza `UPDATE` y `DELETE`. Cada asiento lleva: tenant, sede, producto, lote, envase (si aplica), tipo (`entrada`, `administracion`, `dispensa`, `desecho`, `ajuste`, `arqueo`), cantidad en unidad de control, saldo resultante por producto y lote, usuario responsable, testigo (si aplica), atención, paciente y cliente (si aplica), documento de respaldo (factura, número de formulario oficial), motivo, fecha y hora, y un hash encadenado con el asiento anterior para detectar alteraciones.
- **Toda** salida o entrada de un producto controlado pasa por `registrarMovimiento`, que escribe el asiento del libro en la misma transacción. No hay otro camino.
- El saldo nunca queda negativo: el movimiento se rechaza con un mensaje claro.
- Las correcciones son asientos de `ajuste` con motivo obligatorio y permiso `controlados.ajustar`; nunca se borra ni se edita un asiento.
- Pantalla "Libro de control": por producto y lote, con filtros por período, tipo y usuario; saldo corrido; verificación de la cadena de hash con un indicador "Libro íntegro".

## 5. Entradas

- Al ingresar un controlado (compra manual o carga de XML del 08b/09b), son obligatorios lote, vencimiento, cantidad, documento y quien recibe (`controlados.recibir`). Se guarda en la ubicación de resguardo de la sede.

## 6. Administración en la atención y en procedimientos

- En la atención (acciones del 07c) y en procedimientos, un controlado se registra por **dosis**: mg o mL, vía, lote y envase.
- **Envases abiertos:** al abrir un frasco multidosis se crea el envase con su contenido; cada administración descuenta de ese envase; se ve cuánto le queda y desde cuándo está abierto. Al cerrar el envase (vacío o vencido el plazo de uso), el sobrante se registra como `desecho`.
- **Testigo:** un desecho requiere la confirmación de un segundo usuario con `controlados.testigo`, desde su propia sesión (le llega la solicitud y confirma con un clic). Sin testigo, el desecho queda pendiente y visible como alerta.
- La atención no se puede cerrar con una línea de controlado sin dosis, lote o envase.
- El cargo al cliente sigue el flujo normal (`agregarCargo`), por fracción cuando corresponda.

## 7. Receta y dispensa para la casa

- En la receta, una línea de controlado pide el **número del formulario oficial** cuando el tenant lo exige, y respeta una cantidad máxima configurable por sustancia.
- El PDF de la receta indica, en esas líneas: "Medicamento controlado. Este documento no reemplaza el formulario oficial."
- La entrega al cliente en caja o farmacia (`controlados.dispensar`) descarga el libro con el número de formulario, el cliente y el paciente. Lo recetado y no entregado aparece en "Recetado y no entregado".

## 8. Arqueos

- Arqueo programado según la frecuencia del tenant, y arqueo manual cuando se quiera.
- Se cuenta físicamente por producto, lote y envase abierto; el sistema muestra la diferencia contra el libro. Requiere testigo.
- Una diferencia exige justificación y genera un asiento de `ajuste` (con `controlados.ajustar`) y un aviso a la dirección con `emitirNotificacion` y `puedeEnviar()`.
- Historial de arqueos con resultado y firmantes.

## 9. Alertas (deterministas, "sin dato no hay recomendación")

Con aviso en la campana y en el panel de la dirección:

- arqueo vencido;
- diferencia en arqueo;
- envase abierto más allá del plazo configurado;
- desecho sin testigo;
- lote próximo a vencer;
- consumo de un usuario muy por encima de su promedio o del promedio de la clínica en el período (con el detalle de los asientos que lo explican).

## 10. Reportes

- Libro por producto y período, movimientos por usuario, consumo por paciente, arqueos.
- Exportación a PDF y Excel.
- Formato del reporte para la autoridad configurable por país: columnas y encabezado definidos en una plantilla editable; la plantilla de Costa Rica queda marcada "por validar con la autoridad".

## 11. Integraciones

- Cada administración, dispensa y desecho deja un evento en la línea de tiempo del paciente con `registrarInteraccion`.
- Métrica para dashboards (12): consumo de controlados por período y diferencias de arqueo, con su definición en el diccionario de métricas.
- Si el chat interno (18) existe, la solicitud de testigo puede llegar también como mensaje.

## 12. Calidad

- Migraciones con el siguiente número libre, RLS forzado y `ON DELETE CASCADE` donde corresponda (nunca en `ctl_libro` hacia productos: el libro no se borra en cascada).
- Tests:
  - el libro rechaza `UPDATE` y `DELETE`;
  - movimiento y asiento van en la misma transacción;
  - no hay saldo negativo;
  - sin colegiado no se prescribe ni se administra;
  - un desecho sin testigo queda pendiente;
  - la cadena de hash detecta una alteración;
  - no hay fuga entre tenants.
- Datos de demostración en el tenant de prueba: ketamina y diazepam con entradas, administraciones, un desecho con testigo y un arqueo con diferencia.
- Formularios con `useCambiosSinGuardar`.
- Manual de usuario en `docs/ayuda/medicamentos-controlados.md` con el estándar de la guía: para qué sirve, cuándo, quién, paso a paso, un ejemplo con números (frasco de ketamina de 10 mL a 100 mg/mL, tres administraciones, desecho del sobrante, arqueo), qué pasa después, preguntas frecuentes y glosario. Debe decir con claridad que Vetline no reemplaza el formulario oficial y que la lista de sustancias se valida con la autoridad y el Colegio.

## 13. Criterios de aceptación

1. Un producto ligado a una sustancia se ve como controlado en todo el sistema.
2. Entrada → apertura de envase → tres administraciones en atenciones distintas → desecho con testigo, y el libro muestra cada paso con saldo correcto y "Libro íntegro".
3. Un usuario sin colegiado o sin permiso no puede administrar, dispensar ni ajustar.
4. La receta con controlado exige el número de formulario y el PDF lleva la leyenda.
5. Un arqueo con diferencia genera ajuste justificado y aviso a la dirección.
6. El reporte del período se exporta en PDF y Excel.
7. Capturas de cada pantalla en la bitácora.

## 14. Límites

- Sin conexión con sistemas del Ministerio de Salud ni de otra autoridad.
- No se da por válida ninguna lista de sustancias ni formato de reporte sin la marca de verificación del tenant.
- Nada a producción; nada a `main` sin revisión.
