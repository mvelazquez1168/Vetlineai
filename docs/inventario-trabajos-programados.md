# Inventario 3 — Trabajos programados

Los 4 archivos de `backend/src/jobs/`, todos arrancados desde `index.ts` al levantar el proceso. El proyecto usa `node-cron` para los 3 vigentes; el desactivado usaba `setInterval` crudo (ver nota en el propio código: "en producción esto se reemplaza por un scheduler real, no por agregar más setIntervals sueltos").

---

## `ciclo.job.ts` — motor de crédito + purga

- **Frecuencia:** diaria, `0 5 * * *` (5:00 AM). No corre al arrancar el proceso.
- **Qué hace:**
  1. Ejecuta los cambios de suscripción vencidos (downgrade/cancelación programados que ya llegaron a su fecha).
  2. Corre el pipeline completo de prueba/purga en este orden: aviso de prueba por terminar → cierre de pruebas vencidas → aviso de cuenta nunca operativa → cierre de cuentas nunca operativas → recordatorio de purga → eliminación definitiva de las clínicas cuya ventana de purga venció.
  3. Para cada suscripción activa/morosa/cancelada cuyo período ya venció: expira el crédito del plan no consumido, salda el colchón de gracia si estaba usado, otorga el crédito del nuevo período y avanza `periodo_inicio`/`periodo_fin`.
- **Si deja de correr:** ningún tenant activo renueva su crédito mensual (se queda con el saldo que tenía al momento de vencer su ciclo — efectivamente se congela, no se sigue descontando de más ni se resetea) y los cambios de plan programados nunca se aplican. El pipeline de purga tampoco avanza: una prueba vencida no entra en ventana de purga, una clínica ya en ventana de purga no llega a eliminarse. **Se nota rápido para el crédito** (el mismo día que a un tenant le tocaba renovar, deja de poder generar) y **tarde para la purga** (recién cuando debería haber pasado el plazo configurado, días o semanas después).
- **Idempotente:** sí. El otorgamiento de crédito se protege comparando contra `movimientos_credito` (si ya existe un `otorgamiento_plan` posterior al nuevo `periodo_inicio`, se omite). Cada paso del pipeline de purga tiene su propia marca de "ya avisado" en `tenants` (`trial_aviso_enviado_en`, `purga_aviso_en`, `aviso_cuenta_no_operativa_enviado_en`, `purga_recordatorio_en`). Correrlo dos veces el mismo día no duplica nada.

## `cicloCobro.job.ts` — motor de cobros

- **Frecuencia:** diaria, `0 7 * * *` (7:00 AM) — deliberadamente **después** de `ciclo.job.ts` (5:00 AM), aunque el código aclara que los dos ciclos (crédito y cobro) están diseñados para no depender del orden entre sí.
- **Qué hace:** dispara el cobro de suscripciones cuyo período venció, aplicando la política de reintentos (0, 3, 7 y 10 días desde el vencimiento, configurable vía `parametros_plataforma`). El resultado de cada intento llega siempre por el callback asíncrono de la pasarela (`pagos/callbackCobros.ts`), nunca en este mismo job.
- **Si deja de correr:** las clínicas con período vencido dejan de recibir el intento de cobro correspondiente — no se les cobra, pero tampoco se les marca como morosas ni se les reintenta. Se nota en días: hay una verificación dedicada para esto (`GET /api/platform-admin/cobros/diagnostico` → `suscripcionesSinIntento`, período vencido hace más de 1 día sin ningún cobro registrado para ese `periodo_fin`).
- **Idempotente:** sí. La atribución es por `order_number` único en `cobros`, y el propio callback central es idempotente (si `cobros.estado` ya no es `pendiente`, no reaplica el efecto).

## `notificaciones.job.ts` — avisos clínicos y operativos

- **Frecuencia:** diaria, `0 6 * * *` (6:00 AM). No corre al arrancar.
- **Qué hace, en 3 sub-tareas:**
  1. Recordatorio de cita — citas en estado `programada`/`confirmada` dentro de las próximas ~26 horas (wall-clock en la zona horaria del tenant).
  2. Desparasitación próxima a vencer — según el umbral configurable por clínica (`configuracion_notificaciones`, default 7 días).
  3. Seguimiento clínico faltante — casos cuyo último `dashboard_cache` marca estado `empeorando`/`crítico` y no tienen ninguna cita futura agendada.
  Cada notificación creada intenta además el envío real por correo (Resend) — si Resend no está configurado, queda registrada igual con estado `simulada`.
- **Si deja de correr:** propietarios dejan de recibir recordatorios de cita y avisos de desparasitación; médicos dejan de recibir la alerta de seguimiento faltante. Se nota al día siguiente (las citas de mañana no habrían recibido su recordatorio de 24-26h).
- **Idempotente:** sí, con tres mecanismos distintos por sub-tarea — el recordatorio de cita usa un índice único parcial en base (`ON CONFLICT DO NOTHING` sobre `cita_id`), la desparasitación y el seguimiento faltante usan una ventana de "no repetir antes de N días" contra la última notificación del mismo tipo para el mismo recurso.

## `suscripciones.job.ts` — **DESACTIVADO, modelo de facturación anterior**

- **Frecuencia:** ninguna — `iniciarJobsProgramados()` existe y se llama desde `index.ts`, pero las 3 líneas `setInterval(...)` que programaban sus 3 funciones están **comentadas**. La función se ejecuta al arrancar pero no hace nada.
- **Qué contiene (sin programar):**
  - `procesarCancelacionesVencidas` (pensada para cada 1 minuto) — pasaba `tenants.estado_suscripcion` a `'cancelada'`.
  - `procesarTrialsVencidos` (pensada para cada 1 hora) — convertía trials vencidos a suscripción real de Stripe, o los pasaba a `ventana_purga`.
  - `procesarExcedentesDeUso` (pensada para 1 vez al día) — facturaba a Stripe el excedente de uso sobre el presupuesto del plan.
- **Por qué está desactivado, en palabras del propio código:** los 3 jobs son el modelo viejo completo (Stripe + cupos + `tenants.estado_suscripcion`), desconectado del modelo vigente (`suscripciones`/`saldos_ia`) desde que se migró — y **ya habían hecho divergir datos reales** de un tenant (`tenants.estado_suscripcion` quedó en `'cancelada'` mientras `suscripciones.estado` seguía en `'activa'`) antes de que alguien lo notara y lo desactivara.
- **No lo reactives.** El reemplazo funcional vive en `ciclo.job.ts` (crédito) + `cicloCobro.job.ts` (cobro).
- **Gap real seguido vigente:** `procesarExcedentesDeUso` **sí sigue siendo alcanzable** — hay un botón manual en Platform Admin (`POST /api/platform-admin/facturacion/ejecutar-job-excedente`, ver Inventario 1) que la llama directo, saltándose la desactivación del scheduler. Quien lo apriete ejecuta código del modelo viejo contra datos que el resto del sistema ya no trata como fuente de verdad.

---

## Resumen de horarios (orden de ejecución diaria)

| Hora | Job |
|---|---|
| 05:00 | `ciclo.job.ts` (crédito + purga) |
| 06:00 | `notificaciones.job.ts` |
| 07:00 | `cicloCobro.job.ts` (motor de cobros) |
| — | `suscripciones.job.ts` — sin horario, no programado |
