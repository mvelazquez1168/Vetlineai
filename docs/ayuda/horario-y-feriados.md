# El horario de la clínica, los feriados y los tipos de cita

## Para qué sirve

Que la agenda sepa cuándo abre la clínica. Sin eso, se puede agendar un domingo a las once de la
noche y nadie se entera hasta el domingo.

También sirve para lo contrario: **poder** agendar fuera del horario cuando hace falta de verdad,
dejando dicho quién lo autorizó y por qué.

## Cuándo se usa

Una vez, al empezar. Después, cada vez que cambia algo: un feriado que la clínica va a trabajar, las
vacaciones de un médico, la reunión de equipo del jueves.

## Quién puede usarla

**Ver el horario y los feriados** lo ve todo el personal: la recepción necesita poder explicarle al
cliente por qué no hay turno el 25.

**Cambiarlos** lo hace quien tenga el permiso *Configurar la clínica y sus políticas*.

## Cómo está armado

Hay tres niveles, y la agenda los pregunta **en este orden**:

1. **El horario de la clínica.** Es el marco. Si la clínica abre de 8 a 17 y un médico declara de 7
   a 20, sus citas válidas son de 8 a 17: nadie atiende con la clínica cerrada.
2. **Las excepciones**: feriados, vacaciones de un médico, bloqueos de unas horas.
3. **El horario de cada médico**, dentro del marco. Ese se configura en *Agenda › Horarios*.

El motivo que se muestra es el del **primer** nivel que falla. Decir «el médico no trabaja los
domingos» cuando la clínica está cerrada el domingo manda a buscar al lugar equivocado.

## Paso a paso

**El horario**

1. *Administración › Clínica › Agenda › Horario*.
2. Destilde un día para cerrarlo; tíldelo para abrirlo.
3. Ponga **de** y **a**. Si cierra al mediodía, **+ Otro tramo**: «de 8 a 12» y «de 14 a 17».
4. **Guardar** en la fila del día.

La clínica nace abierta de lunes a viernes de 8 a 17 y sábado de 8 a 12, con el domingo cerrado.

**Un feriado que sí se trabaja**

1. *Configuración de la agenda › Feriados y bloqueos*.
2. En el feriado, **La clínica trabaja ese día**.

El feriado **no se borra**: se sigue viendo en la lista, pero deja de bloquear la agenda.

**Las vacaciones de un médico o un bloqueo de unas horas**

1. **Agregar un feriado o bloqueo**.
2. Elija qué es, póngale nombre y fechas.
3. Si es de unas horas, ponga **desde** y **hasta** la hora. Sin horas, bloquea el día entero.

**Los tipos de cita**

1. *Configuración de la agenda › Tipos de cita*.
2. **Agregar un tipo de cita**, con su nombre, su duración y su color.

Al agendar, elegir el tipo **precarga la duración**, y se puede cambiar.

## Un ejemplo

La clínica cierra a las 17:00. Son las 16:50 y entra una llamada para una consulta de 30 minutos.

La agenda no la acepta: *«La clínica atiende de 08:00 a 17:00, y la cita de 16:50 termina 17:20»*. Lo
que se mira es **cuándo termina**, no cuándo empieza: una cita que termina con la clínica cerrada es
el error que se descubre cuando el cliente ya está en la sala. A las 16:30 sí entra, porque termina
justo al cierre.

Al rato llama un cliente que viaja el lunes y necesita el control el domingo. La recepción intenta
agendarlo y el sistema avisa: *«La clínica no abre los domingos»*, y **a ella no le ofrece** agendar
igual. La administradora sí: escribe el motivo —*«El dueño viaja el lunes»*— y la cita queda
agendada, con su nombre y ese motivo adentro.

## Qué pasa después

- Las citas fuera de horario quedan con **quién las autorizó** y **por qué**. Es una excepción a una
  política de la clínica, y por eso se registra.
- El aviso llega **antes** de guardar, y con los horarios de ese día, para poder ofrecer otra hora
  en la misma llamada.
- **La atención del paciente que llega sin turno no se bloquea nunca.** Si entra una urgencia a las
  siete de la tarde, el médico abre la atención y punto: esa cita se crea para registrar lo que ya
  está pasando, no para agendar algo.

## Preguntas frecuentes y errores comunes

**No configuré el horario y la agenda me deja agendar a cualquier hora.**
Es a propósito: sin horario configurado no se bloquea nada. Un control que nace prohibiendo todo es
un control que se apaga el primer día.

**«Para citar fuera de horario hace falta el permiso…».**
Ese permiso —*Citar fuera de horario o en un bloqueo*— se le puede dar a cualquier rol desde
*Roles y permisos*. Por omisión lo tiene el administrador.

**Me pide un motivo para agendar fuera de horario.**
Sí, y es obligatorio. Sin motivo, dentro de un mes nadie va a poder explicar por qué hay una cita un
25 de diciembre.

**Los feriados solo llegan hasta 2027.**
Están cargados los de 2026 y 2027 de Costa Rica. Los de los años siguientes se agregan desde esta
misma pantalla: no se inventan diez años de feriados por adelantado.

**Los feriados que la ley traslada a lunes aparecen en su fecha original.**
Sí. El traslado cambia de año en año y equivocarse significa cerrar la clínica un día que abría: se
deja la fecha real y cada clínica lo mueve si lo traslada.

**Borré un tipo de cita y las citas viejas lo siguen mostrando.**
Los tipos no se borran, se **desactivan**: dejan de ofrecerse al agendar y las citas que ya se
hicieron con él lo conservan.
