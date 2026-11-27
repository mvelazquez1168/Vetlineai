# Vetline Clinic — 14 · CRM completo

Rama: `vetline-clinic/14-crm-completo`, que parte de la rama del 13. Se rige por `vetline-clinic-00-guia-rectora.md`: sección 7 para el contenido, 4.4 para la ficha del cliente y sección 12 para la forma de trabajo.

## Por qué existe

El 03 dejó el pegamento: la línea de tiempo, los consentimientos, `puedeEnviar()` y el canal de WhatsApp preparado con un proveedor simulado. El anexo B sumó la unificación de duplicados, la fuente de referencia y el canal preferido. El 12 dejó la ficha del cliente como dashboard, y el 13 dejó la afinidad entre líneas con sus listas.

Falta convertir todo eso en **ventas y en clientes que vuelven**:
- saber a quién contactar hoy y por qué;
- armar campañas sobre segmentos vivos;
- enviarlas por WhatsApp a través de Converza;
- medir cuánto vendió de verdad cada acción, no cuántos mensajes salieron.

Es un CRM de clínica veterinaria, no de ventas corporativas: sin embudos de negocio, y construido **encima** de `propietarios` y `pacientes`, sin tablas de clientes propias.

**Fuera de alcance:**
- fidelización (15): planes, paquetes, puntos, niveles, referidos, NPS;
- la app del cliente (17);
- el asesor de gestión (16b), que usará lo que aquí se construye.

## 0. Relevamiento

El informe parte de una tabla con lo que ya existe y se reutiliza:
- **del 03:** la línea de tiempo, los consentimientos, `puedeEnviar()`, el proveedor de mensajería con su simulado y el contrato `docs/crm/contrato-mensajeria.md`;
- **del anexo B:** la resolución de cliente canónico, la fuente de referencia y el canal preferido;
- **las notificaciones de Vetline Ai:** `emitirNotificacion`, `notificaciones.job.ts`, `avisoActivo`, sus tipos y la pantalla Administración › Notificaciones;
- **del 12:** el dashboard del cliente y el diccionario de métricas;
- **del 13:** la afinidad, el gasto posterior y el diagnóstico de ingresos por línea;
- **datos que originan oportunidades:**
  - `cuidados_preventivos`;
  - controles recomendados en la atención;
  - presupuestos del 08b;
  - recetas de tratamiento crónico (cantidad y dosis);
  - inventario por vencer;
  - huecos de agenda.

Lo que ya existe se reutiliza o se extiende. No se crea una segunda línea de tiempo, un segundo punto de envío ni un segundo cálculo de ingresos.

## 1. Ficha 360 del cliente

La ficha es el dashboard del cliente del 12, **extendido**, no una pantalla nueva. Muestra:
- mascotas;
- gasto por línea;
- saldo;
- preventivos pendientes;
- consentimientos;
- la línea de tiempo.

Le suma:
- **oportunidades abiertas** del cliente, con su origen y valor;
- **tareas** abiertas y su responsable;
- **indicadores** de la sección 6, cada uno con su explicación;
- **acciones rápidas:** agendar, vender, enviar mensaje (por `puedeEnviar()`), crear tarea, registrar una llamada o una visita;
- **la conversación de WhatsApp:** vive en Converza y aparece en la línea de tiempo con un enlace para abrirla, sin copiar los mensajes.

Se llega desde el fichero de clientes, desde la búsqueda Ctrl+K y desde cualquier lista del CRM.

## 2. Segmentos dinámicos

- **Un constructor de reglas** sobre datos del cliente y sus mascotas, por ejemplo:
  - especie, raza, etapa de vida;
  - última visita;
  - gasto por línea;
  - preventivos vencidos;
  - consentimientos y canal;
  - fuente de referencia;
  - indicadores;
  - uso o no uso de una línea, desde la afinidad del 13.
- **Se evalúa en el momento**, nunca como lista congelada. Una campaña guarda una **foto** de quiénes recibieron el envío, para medirla, pero el segmento sigue vivo.
- **Una sola definición** para campañas, dashboards, filtros guardados y el agente. Las listas del 13 («clientes de grooming que nunca compraron productos») se pueden guardar como segmento con un clic.
- **Al construirlo:** muestra cuántos clientes caen y cuántos son **contactables** después de consentimientos, tope de frecuencia y exclusiones.
- **Segmentos sugeridos de fábrica**, editables:
  - perros senior sin chequeo en 12 meses;
  - gatos con vacuna vencida;
  - clientes de grooming sin compra de alimento;
  - clientes sin visita en 9 meses que antes venían cada 3.

## 3. Motor de oportunidades

**Ciclo de vida:** `detectada → contactada → convertida | descartada | vencida`.

Cada oportunidad lleva:
- origen;
- cliente y mascota;
- responsable;
- valor estimado, según el precio vigente;
- fecha límite;
- motivo de descarte cuando aplica.

**Orígenes:**
- preventivo vencido o por vencer;
- recompra de alimento o medicamento crónico, calculada por cantidad y dosis (cuándo se le acaba);
- control recomendado por el médico y no agendado;
- presupuesto aprobado sin convertir o a punto de vencer;
- cambio de etapa de vida;
- capacidad ociosa de la agenda;
- inventario por vencer con clientes que lo compran.

**Reglas:**
- **Sin duplicados:** si un cliente tiene varias, se le ofrece **solo la de mayor valor**; las demás quedan en espera, visibles en la ficha.
- **Atribución real:** una oportunidad se convierte cuando aparece la cita o la venta que la resuelve dentro de su ventana, y queda **ligada** a ese registro. Así se mide cuánto vendió el motor.
- **Se detectan de noche**, con un trabajo idempotente que no duplica oportunidades ya abiertas.

**Exclusiones, que nunca generan oportunidad ni mensaje:**
- pacientes fallecidos o dados de baja;
- clientes con una mascota hospitalizada o en tratamiento delicado (marca en el expediente);
- promoción de medicamentos de prescripción.

## 4. Campañas

**Una campaña tiene:**
- segmento;
- mensaje desde una plantilla con variables;
- oferta opcional (descuento o servicio), que respeta los topes de descuento de las políticas del 04;
- canal: WhatsApp por Converza, o correo con `enviarEmail` y la marca de la clínica;
- fecha y ventana de envío.

**Antes de aprobarla, la pantalla muestra:**
- cuántos la recibirán;
- el costo estimado de envío (las conversaciones de WhatsApp tienen costo);
- el **impacto estimado en margen** de la oferta.

**Aprobación:** la aprueba quien tenga `crm.campanas.aprobar`, y nunca quien la creó si la política así lo dice.

**Envío escalonado**, en lotes, sin pasar del tope de frecuencia por cliente. Todo envío pasa por `puedeEnviar()`. Las respuestas del cliente vuelven a la línea de tiempo y, si piden algo, generan una tarea.

**Medición:**
- entregados, leídos, respondidos;
- citas y ventas **atribuidas** dentro de la ventana;
- margen neto de la campaña contra su costo.

**Grupo de control opcional:** un porcentaje del segmento que no recibe el mensaje, para medir la venta que la campaña realmente agregó frente a la que habría ocurrido igual. Si el segmento es chico, la pantalla avisa que la diferencia no es concluyente, con las reglas estadísticas del 13.

**Recordatorios comerciales automáticos** (recompra, preventivo por vencer, control no agendado): se agregan como **tipos nuevos del mecanismo de notificaciones existente**, cada uno con su interruptor en Administración › Notificaciones, su plantilla editable, su registro en `notificaciones` y su paso por `puedeEnviar()`. Los avisos que Vetline Ai ya envía siguen exactamente igual.

## 5. Conexión real con Converza

El 03 dejó la interfaz del proveedor de mensajería, el simulado y el contrato. Aquí se construye la **implementación real de Converza** detrás de esa misma interfaz, sin cambiar el CRM:
- **envío** de mensajes con **plantillas aprobadas por Meta** cuando el mensaje sale fuera de la ventana de 24 horas;
- **recepción** de respuestas y estados (entregado, leído, fallido) por webhook firmado;
- **enlace** a la conversación en Converza desde la línea de tiempo.

**El simulado sigue siendo el proveedor por omisión.** El real se activa por clínica solo con sus credenciales configuradas y un interruptor explícito. En desarrollo no se envía ningún mensaje real.

Si a Converza le falta algo del contrato (por ejemplo, la gestión de plantillas o los webhooks de estado), el informe lo lista como requisito para Converza, y la funcionalidad queda en el simulado.

## 6. Indicadores por cliente

Se calculan con consultas y código, y siempre explican su valor en una frase:
- **Valor de vida:** margen acumulado (del diccionario del 12) más una proyección simple basada en su frecuencia y ticket históricos. La proyección se muestra aparte y con su supuesto.
- **Riesgo de abandono:** comparando el tiempo sin venir con **su propio intervalo habitual**, por ejemplo: «riesgo alto: 14 meses sin venir; antes venía cada 4». Si tiene menos de 3 visitas, el riesgo se marca como «sin historial suficiente».
- **Propensión por línea:** qué tan probable es que use una línea que hoy no usa, desde la afinidad del 13 y clientes parecidos. Se muestra como alta, media o baja, con la explicación.

## 7. Bandeja del día

Para la recepción, en CRM › Hoy: **a quién contactar hoy y por qué**, ordenado por valor y urgencia:
- oportunidades asignadas;
- tareas que vencen;
- respuestas de clientes sin atender;
- clientes en riesgo alto.

Cada fila tiene **la acción a un clic**: llamar (y registrar el resultado), enviar el mensaje sugerido, agendar o descartar con motivo.

Al final del día, la bandeja muestra qué se hizo y qué quedó pendiente para mañana.

## 8. Permisos

Agregar a la matriz del 04:
- `crm.ver`;
- `crm.contactar`;
- `crm.segmentos.editar`;
- `crm.campanas.crear`, `crm.campanas.aprobar`;
- `crm.oportunidades.asignar`.

Recepción tiene ver, contactar y la bandeja. El administrador tiene todo. El contador no ve el CRM.

## Verificación y entrega

**Primero tienen que fallar contra el defecto que dicen detectar.** Aserciones mínimas:
- un cliente con mascota fallecida, uno sin consentimiento y uno que ya llegó al tope de frecuencia **no reciben** la campaña, y la pantalla los contó como no contactables;
- un cliente con tres oportunidades recibe solo la de mayor valor;
- una cita agendada dentro de la ventana convierte la oportunidad y queda ligada a ella;
- el trabajo nocturno corrido dos veces no duplica oportunidades;
- un cliente unificado por el B1 aparece una sola vez en un segmento;
- los avisos existentes de Vetline Ai salen igual que antes;
- una clínica solo con Vetline Ai no ve nada del CRM.

En el navegador, con el historial de demostración:
- guardar como segmento la lista «grooming sin productos» del 13;
- crear una campaña con oferta, ver el impacto estimado en margen, aprobarla con otro usuario y enviarla por el simulado con grupo de control;
- simular respuestas y ver las tareas que generan;
- ver la atribución de ventas de la campaña;
- abrir la ficha 360 de un cliente en riesgo y entender su indicador;
- trabajar la bandeja del día de punta a punta.

El informe incluye:
- la tabla del relevamiento;
- el contrato de Converza actualizado y lo que le falta a Converza;
- las pantallas nuevas con su camino de clics;
- las migraciones, con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant;
- las páginas de `docs/ayuda/`;
- lo documentado sin construir.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
