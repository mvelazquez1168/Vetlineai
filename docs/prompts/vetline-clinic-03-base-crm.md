# Vetline Clinic 03 — Base del CRM: línea de tiempo y consentimientos

## Contexto

La base del CRM tiene dos piezas que todos los módulos necesitan (guía rectora, secciones 3 y 7):

1. **La línea de tiempo de interacciones:** todo lo que le pasa a un cliente o a su mascota queda
   registrado como un evento, con una referencia a su origen. Es el pegamento entre módulos.
2. **Los consentimientos, las preferencias de contacto y el tope de frecuencia:** un único punto que
   **todo** envío consulta antes de salir. Es la condición para los recordatorios por WhatsApp.

Esta base debía construirse antes que los demás módulos, para que la alimentaran desde el primer
día. Como no fue así, este prompt también **reconstruye el historial** desde lo que ya existe.

Rige la guía rectora. El cliente es `propietarios` y la mascota es `pacientes`: el CRM no crea
tablas de clientes ni de contactos propias.

Rama nueva desde la última rama de trabajo terminada. Construí sin pedir confirmación. Parás solo
ante una contradicción con el código, una decisión irreversible sobre datos existentes o un trabajo
mucho mayor al supuesto. No se toca producción, no se envían mensajes reales por WhatsApp ni
correos reales.

### Antes de diseñar: relevar los emisores y los orígenes

Relevá todos los lugares que hoy registran algo de un cliente o de un paciente, o que le envían un
mensaje: `crearCita()` y los cambios de estado de citas, `atenciones`, `cuidados_preventivos`,
`recetas`, `casos`, `emitirNotificacion()`, `enviarCorreoTransaccional()`, `correos_enviados`,
`notificaciones` y el job de notificaciones, y los módulos nuevos que existan al llegar acá
(comprobantes del facturador, cobros y anticipos de la caja, encargos, movimientos de inventario
ligados a paciente, el expediente). La lista queda en el reporte.

---

## 1. Línea de tiempo de interacciones

- **Una tabla de eventos que solo se agrega**, con `tenant_id`, RLS forzado y `ON DELETE CASCADE` a
  `tenants`. Cada evento tiene: cliente, mascota (opcional), tipo, fecha y hora en que ocurrió,
  módulo de origen, persona que lo originó (si la hay) y la **referencia** al registro de origen
  (tabla e identificador). **Nunca copia el contenido del origen**: la pantalla lo resuelve leyendo
  el registro referenciado. Si el origen ya no existe, el evento lo dice ("registro eliminado").
- **Catálogo de tipos de evento** en un solo lugar: cliente y mascota registrados; cita agendada,
  confirmada, reprogramada, cancelada, no presentada y completada; llegada (check-in); atención
  cerrada; vacuna aplicada; desparasitación; receta emitida; caso de Vetline Ai abierto y cerrado;
  comprobante emitido, aceptado y rechazado; cobro; anticipo; abono; encargo (con sus estados);
  mensaje enviado (con canal y finalidad); mensaje respondido; consentimiento cambiado; nota manual.
  Ampliable: un módulo nuevo agrega sus tipos ahí.
- **Un único punto de registro** (por ejemplo `registrarInteraccion`), llamado desde los puntos
  únicos que ya tiene cada módulo (`crearCita`, `emitirNotificacion`, la emisión de comprobantes, el
  cierre de atención, el punto único de movimientos cuando hay paciente, los cobros) y **dentro de
  la misma transacción** que el registro de origen: no puede existir un evento sin su origen ni un
  origen sin su evento.
- **Un mismo origen no genera dos eventos del mismo tipo:** unicidad por tipo y referencia en la
  base.
- **Notas manuales:** la recepción puede agregar una nota a la línea de tiempo de un cliente ("llamó
  para preguntar por el resultado"), con autor y fecha.
- **Privacidad dentro de la clínica:** el evento muestra a todos el tipo, la fecha y el enlace; el
  detalle clínico solo lo ve quien tiene permiso de verlo.

## 2. Reconstrucción del historial

- Un comando idempotente que recorre los orígenes existentes y crea sus eventos con la **fecha real
  en que ocurrieron**, no la fecha de la corrida. Correrlo dos veces no duplica nada.
- Reporte de la corrida: cuántos eventos de cada tipo se crearon y cuántos orígenes no se pudieron
  reconstruir y por qué.
- Se corre en desarrollo. Para producción queda listo como paso del despliegue, sin correrlo.

## 3. La línea de tiempo del expediente

El expediente (prompt 07) tiene su propia línea de tiempo del paciente. **No puede haber dos
historias que diverjan:** la del expediente pasa a leer de esta tabla filtrando por la mascota, si
cubre todo lo que muestra. Si alguna vista del expediente necesita algo que la tabla de eventos no
tiene, se agrega el tipo de evento correspondiente. Se verifica que ambas muestren lo mismo para un
paciente de demostración, y las diferencias se reportan.

## 4. Consentimientos y preferencias de contacto

- **Consentimiento por cliente, por canal** (WhatsApp, correo) **y por finalidad**:
  - *salud y servicio:* recordatorios de citas, vacunas, desparasitaciones, seguimientos,
    resultados, comprobantes;
  - *promociones:* campañas y ofertas.
- **Historial de cada cambio** de consentimiento, con fecha, valor, quién lo registró y la **fuente**
  (formulario de registro, recepción, respuesta del cliente, importación). Es la prueba de que el
  cliente dio o retiró su consentimiento.
- **Preferencias:** canal preferido y franja horaria permitida para mensajes (por defecto, de 8:00 a
  20:00 en la zona horaria de la clínica).
- **Baja con una palabra:** si el cliente responde "BAJA" (o equivalentes configurables) a un
  mensaje, se retira el consentimiento de promociones de ese canal al instante, queda registrado y
  se le confirma.
- **Clientes que ya existen:** como la clínica ya les envía recordatorios de salud por correo,
  quedan con consentimiento de salud por correo, registrado con fuente "existente al habilitar el
  CRM". El consentimiento de promociones queda en **no** para todos hasta que lo den.
- El formulario de registro y la ficha del cliente permiten registrar y cambiar los consentimientos.

## 5. El punto único antes de enviar

- Una función única (por ejemplo `puedeEnviar(cliente, mascota, canal, finalidad)`) que **todo**
  envío consulta: los avisos de Vetline Ai, los recordatorios, los comprobantes, y más adelante las
  campañas y el agente. Devuelve si se puede enviar y, si no, el motivo.
- Reglas que aplica:
  - consentimiento vigente para ese canal y esa finalidad;
  - **nunca** a una mascota fallecida ni sobre ella;
  - cliente con un dato de contacto válido para ese canal;
  - dentro de la franja horaria permitida (si no, se reprograma para el inicio de la siguiente);
  - **tope de mensajes promocionales** por cliente y por mes, configurable por la clínica; los
    mensajes de salud y servicio no cuentan para el tope;
  - sin duplicados: el mismo tipo de mensaje sobre la misma mascota no sale dos veces dentro de una
    ventana configurable;
  - un punto preparado para la regla de "mascota hospitalizada o en tratamiento delicado", que se
    activará cuando exista ese estado.
- `emitirNotificacion()` pasa a consultar este punto. Lo que hoy se envía a clientes existentes
  tiene que seguir saliendo igual (por eso la regla de consentimiento existente del punto 4).
- **Configuración por clínica** del tope, la franja horaria y la ventana de duplicados. Si todavía
  no existe un mecanismo de políticas por clínica, creá uno mínimo que el prompt de administración
  base va a extender, no uno que haya que reemplazar.

## 6. Canal de WhatsApp, preparado

- El canal de las notificaciones deja de ser solo correo: se amplía para admitir WhatsApp, con el
  canal elegido según la preferencia y el consentimiento del cliente.
- **Proveedor de mensajería intercambiable:** una única interfaz para enviar y para recibir
  respuestas, con una implementación **simulada** (que entrega, falla o recibe una respuesta según el
  caso de prueba). La conexión real con Converza se hace en un prompt aparte; acá queda la interfaz,
  el simulado y el contrato documentado en `docs/crm/contrato-mensajeria.md` para que Converza se
  conecte sin cambiar el CRM.
- Cada mensaje enviado y cada respuesta recibida quedan en la línea de tiempo.

## 7. Interfaz

Con el sistema de diseño ampliado y los patrones de Vetline Ai:

- En la ficha del cliente, una pestaña **Línea de tiempo** con filtros por tipo, mascota, módulo y
  período, y el botón para agregar una nota.
- Un panel de **consentimientos y preferencias** en la ficha del cliente, con su historial y la
  edición para quien tenga permiso.
- En la ficha del paciente, su línea de tiempo filtrada (ver punto 3).

---

## Verificación

- La reconstrucción crea los eventos con su fecha real, coincide en cantidades con los orígenes y
  una segunda corrida no duplica nada.
- Crear una cita, cerrar una atención, emitir un comprobante y cobrar generan su evento en la misma
  transacción; si el origen se revierte, el evento tampoco queda.
- Un mismo origen no genera dos eventos del mismo tipo.
- `puedeEnviar` bloquea, con su motivo: promoción sin consentimiento, cualquier mensaje sobre una
  mascota fallecida, cliente sin contacto válido, fuera de horario (reprogramado), tope de
  promociones superado y duplicado dentro de la ventana; y deja pasar un recordatorio de salud con
  consentimiento.
- Una respuesta "BAJA" con el proveedor simulado retira el consentimiento de promociones y queda en
  el historial y en la línea de tiempo.
- Los avisos que Vetline Ai ya enviaba a clientes existentes siguen saliendo; los verificadores de
  notificaciones siguen en verde.
- La línea de tiempo del expediente y la del CRM muestran lo mismo para el paciente de demostración.
- La auditoría de RLS pasa limpia y los verificadores existentes siguen en verde.

## Reporte

En `docs/reportes/`: el relevamiento de emisores y orígenes, lo construido, el resultado de la
reconstrucción, cómo quedó la convergencia con la línea de tiempo del expediente, lo que no se pudo y
por qué, y las decisiones que tomaste solo. Al terminar, dejá la línea de tiempo del cliente de
demostración visible y pasá las URL.
