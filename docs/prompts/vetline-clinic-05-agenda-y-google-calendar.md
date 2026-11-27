# Vetline Clinic — 05 · Agenda y Google Calendar

Rama: `vetline-clinic/05-agenda-google-calendar`, que parte del último punto que contenga todo lo construido (como mínimo el 04 y el 11). Se rige por `vetline-clinic-00-guia-rectora.md`: sección 5 para el contenido y sección 12 para la forma de trabajo.

## Por qué existe

La agenda de Vetline Ai ya existe: calendario, lista de espera, salas y citas. El 04 le agregó horarios, feriados, bloqueos, tipos de cita con duración y el aviso al agendar fuera de horario. El 11 le agregó turnos y ausencias del personal.

Falta que la agenda **impida** los errores en lugar de solo avisarlos, que muestre la clínica como la trabaja Medicavet (por médico y por sala) y que cada médico vea sus citas en su Google Calendar.

**La regla que no se negocia:** la agenda de Vetline es **la única fuente de verdad** de las citas, porque una cita lleva paciente, dispara avisos al cliente y alimenta la atención. Google Calendar es una vista y una fuente de disponibilidad, opcional por médico.

**Fuera de alcance:**
- la reserva en línea por el cliente, que va en la app del cliente (17) y usará el motor de disponibilidad de este prompt;
- otros calendarios (Outlook o Microsoft 365): quedan preparados con una interfaz intercambiable, sin construirlos.

## 0. Relevamiento

El informe parte de una tabla con lo que ya existe y se reutiliza:
- **las tablas y rutas de la agenda de Vetline Ai:** `citas`, `salas`, `agenda.routes.ts`, `citas.routes.ts`, sus estados y transiciones, la lista de espera, y los avisos al cliente que disparan;
- **del 04:** horarios, feriados, bloqueos, tipos de cita con duración y sala sugerida, el permiso `agenda.fuera_de_horario` y su registro;
- **del 11:** turnos, guardias y ausencias;
- **el check-in del anexo** (`citas.check_in_en`) y «En la clínica ahora»;
- **todos los lugares que crean, mueven o cancelan una cita:** agenda, lista de espera, atención (control agendado), CRM y agente. Tienen que pasar por un solo punto.

Si hoy hay más de un camino que escribe en `citas`, se unifica en una sola función de citas antes de construir lo demás.

## 1. Motor de disponibilidad

**Una sola función** responde «¿se puede citar a este médico, en esta sala, de tal hora a tal hora?» y «¿cuáles son los huecos libres?». La usan la agenda, la lista de espera, el control desde la atención, el CRM, el agente y, más adelante, la app del cliente.

Combina:
- horario de la clínica y feriados (04);
- turno del médico y sus ausencias (11);
- bloqueos puntuales;
- **duración del tipo de cita** más un **margen entre citas** configurable por tipo (limpieza del consultorio, por ejemplo);
- **recursos:** la sala y, si el tipo lo pide, un equipo (por ejemplo, el endoscopio o la máquina de anestesia). Dos citas no pueden usar el mismo recurso a la vez;
- **bloques ocupados de Google Calendar** del médico (sección 4);
- las citas existentes.

**Impide, no solo avisa:** crear una cita fuera de la disponibilidad se rechaza. La única salida es una **sobrecarga explícita** por quien tenga `agenda.fuera_de_horario`, con motivo, y queda registrada en la auditoría. El aviso del 04 pasa a ser este rechazo, con la sobrecarga como opción.

**Respuesta clara:** cuando rechaza, dice por qué («la Dra. está de vacaciones», «el quirófano está ocupado de 10:00 a 11:30», «evento en su Google Calendar») y ofrece los tres huecos más cercanos.

## 2. Vistas de la agenda

- **Por médico y por sala**, en vista diaria y semanal, con cambio en un clic. Medicavet trabaja por ubicación (consultorio, anestesias, grooming), como en Digital Vet.
- **Huecos libres visibles** en la vista, para agendar en un clic sobre el hueco.
- **Arrastrar para mover** una cita, pasando por el motor de disponibilidad y por la lógica de citas (avisos al cliente incluidos).
- **Colores** por tipo de cita o por línea de negocio, con el mapa de color de la paleta.
- **Estado** de cada cita a la vista: confirmada, en la clínica (check-in), atendida, no se presentó.
- **Filtros** por médico, sala, tipo y estado, guardados por usuario.

Si la pantalla actual de la agenda se rediseña, primero se releva qué hace hoy (sección 12 de la guía) y no se pierde ninguna función.

## 3. Conexión con Google Calendar

**Por médico, opcional y revocable:**
- El médico conecta su cuenta de Google desde **Mi perfil › Google Calendar**, con OAuth, y elige en qué calendario aparecen sus citas.
- Puede desconectar en cualquier momento: se revoca el acceso en Google y se borran los tokens.
- **Los tokens se guardan cifrados.** Ninguna llamada a Google ocurre dentro de una transacción abierta.
- **Lo que se ve en Google:** solo lo necesario, por ejemplo «Consulta — Toby (Golden)» con un enlace a la cita en Vetline. Sin diagnóstico ni datos clínicos. Que se incluya o no el nombre del cliente es una política de la clínica, desactivada por omisión.

**Proveedor intercambiable:** una interfaz de calendario con dos implementaciones:
- la **simulada**, que es la de omisión en desarrollo y en los verificadores;
- la **real** de Google.

Así, más adelante se puede sumar Microsoft 365 sin tocar la agenda.

**Lo que necesita Google y no es código:** un proyecto en Google Cloud con la pantalla de consentimiento OAuth. El acceso al calendario es un permiso sensible: en desarrollo funciona con usuarios de prueba, y para producción Google exige **verificar la aplicación**. El informe deja escritos los pasos, los permisos exactos que se piden (los mínimos) y lo que Google va a revisar.

## 4. Sincronización en los dos sentidos

**De Vetline a Google:** cada cita del médico aparece en su Google Calendar, y se actualiza o desaparece cuando cambia o se cancela en Vetline. Va por una cola con reintentos, fuera de la transacción de la cita: si Google no responde, la cita en Vetline queda igual y la sincronización se reintenta.

**De Google a Vetline:**
- Si el médico **mueve o cancela en Google un evento que es una cita de Vetline**, el cambio se aplica en Vetline **pasando por la misma lógica de citas**: transiciones, disponibilidad y avisos al cliente. Nunca se escribe directo en la tabla.
- Si el cambio no cabe (por ejemplo, la sala está ocupada a la nueva hora), no se aplica. El evento en Google vuelve a su lugar y el médico recibe un aviso con el motivo.
- **Los eventos propios de Google** que no son citas (una reunión, el dentista) **no se convierten en citas**: se toman como **bloques ocupados** en la disponibilidad del médico. De esos eventos solo se guarda inicio, fin y «ocupado», sin título ni descripción.

**Cómo se mantiene al día:**
- sincronización incremental con los **tokens de sincronización** de Google;
- **notificaciones push** de Google para enterarse de los cambios, con renovación de los canales antes de que venzan;
- **reconciliación periódica** como red de seguridad, que detecta y corrige diferencias y las deja en una bitácora.

En desarrollo, las notificaciones push no llegan (Google no puede alcanzar `localhost`), así que la reconciliación periódica hace ese papel. Queda documentado.

**Estado visible:** en Mi perfil y en Administración, cada médico conectado muestra su estado (sincronizado, con errores, desconectado) y la última sincronización.

## 5. Permisos

Agregar a la matriz del 04:
- `agenda.sobrecarga` (puede reemplazar o renombrar al `agenda.fuera_de_horario` del 04, sin duplicarlo);
- `agenda.recursos.configurar`;
- `calendario.conectar_propio`, para cada persona sobre su propia cuenta;
- `calendario.ver_estado`, para el administrador.

Nadie conecta ni desconecta la cuenta de Google de otra persona.

## Verificación y entrega

**Los verificadores primero tienen que fallar contra el defecto que dicen detectar.** Con el proveedor de calendario simulado:
- una cita en un feriado, en una ausencia del médico o con la sala ocupada se **rechaza**, y con sobrecarga se crea y queda en la auditoría;
- dos citas que piden el mismo equipo a la misma hora: la segunda se rechaza;
- el margen entre citas se respeta;
- crear, mover y cancelar en Vetline se refleja en el calendario simulado;
- mover en el calendario simulado una cita de Vetline la mueve en Vetline **y dispara el aviso al cliente**;
- un movimiento desde el calendario que choca con una sala ocupada no se aplica y vuelve a su lugar;
- un evento propio del calendario bloquea la disponibilidad y **no** crea una cita;
- si el calendario falla, la cita en Vetline se guarda igual y la sincronización se reintenta;
- desconectar borra los tokens;
- una clínica solo con Vetline Ai conserva su agenda como hoy.

En el navegador:
- cambiar entre la vista por médico y por sala;
- agendar sobre un hueco libre;
- intentar citar en un feriado y ver el motivo y los huecos sugeridos;
- arrastrar una cita;
- conectar Google Calendar con una cuenta de prueba, si las credenciales de Google Cloud están configuradas. Si no lo están, el informe lo dice y la prueba queda con el simulado.

El informe incluye:
- la tabla del relevamiento;
- los caminos de escritura de citas que se unificaron;
- los pasos para configurar Google Cloud y la verificación de la aplicación;
- las pantallas nuevas con su camino de clics;
- las migraciones, con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant;
- las páginas de `docs/ayuda/`;
- lo documentado sin construir.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
