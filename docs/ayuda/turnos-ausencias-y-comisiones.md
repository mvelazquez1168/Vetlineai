# Turnos, ausencias y comisiones

## Para qué sirve

Saber **quién trabaja cuándo** y **cuánto se le paga por lo que hizo**, sin llevarlo en una planilla
aparte que nadie actualiza.

## Cuándo se usa

Los turnos, cada semana. Las ausencias, cuando alguien las pide. Las comisiones, al cerrar el mes.

## Quién puede usarla

**Turnos, ausencias y credenciales**: quien tenga *Turnos, ausencias y credenciales*. Cualquiera
puede **pedir su propia ausencia**; registrar la de otra persona o aprobarla lleva ese permiso.

**Comisiones**: cada persona ve **las suyas** (*Ver sus propias comisiones*, que el médico tiene por
omisión). Ver las de todos y aprobarlas son dos permisos aparte.

---

# Turnos

## El turno no es el horario

| | Qué dice | Dónde se configura |
|---|---|---|
| **Horario de la clínica** | Cuándo abre el local | Configuración de la agenda |
| **Horario del médico** | Cuándo **puede** atender esa persona | Agenda › Horarios |
| **Turno** | Cuándo **le toca** a esa persona, ese día | Acá |

Una clínica con tres médicos y un consultorio necesita los tres: todos pueden los lunes, y el lunes
atiende uno.

## Paso a paso

1. *Administración › Catálogos y cumplimiento › Personal y turnos*.
2. Elegí la semana.
3. **Agregar turno**: persona, día, de qué hora a qué hora, y si es turno o **guardia**.
4. **Copiar a la semana siguiente** repite toda la semana. Copiar dos veces no duplica nada.

> La **guardia** cuenta para las horas del período y **no abre la agenda**: es disponibilidad, no
> consulta.

---

# Ausencias

## Paso a paso

1. **Pedir una ausencia**: tipo (vacaciones, incapacidad o permiso) y fechas.
2. Quien administra la **aprueba** o la rechaza.

## Qué pasa después

- **Pedirla no cierra la agenda.** Hasta que alguien la apruebe, la recepción puede seguir citando:
  si al final no se las dan, no hubo que deshacer nada.
- **Aprobada, la agenda deja de permitir citas** para esa persona en esas fechas, con el motivo a la
  vista.
- Si ya había **citas agendadas**, la lista dice cuántas. **No se cancelan solas**: alguien tiene
  que reasignarlas.
- De una incapacidad se guardan **el tipo y las fechas, nunca el diagnóstico**. Es dato de salud de
  un empleado y la clínica no lo necesita para organizar la agenda.

---

# Credenciales

La colegiatura, la regencia, la licencia de radiología. Lo que importa es **cuándo vencen**: el
aviso aparece arriba de la pantalla a 30 días, y el día que vence.

Renovar una credencial —cambiarle la fecha— **vuelve a habilitar el aviso** para la próxima.

---

# Comisiones

## Cómo se decide cuánto

Una **regla** dice a quién, sobre qué y cuánto. Puede ser por persona, por servicio, por familia de
productos o por línea de negocio, y **gana la más específica**:

1. esta persona + este servicio
2. esta persona + esta familia
3. esta persona + esta línea
4. esta persona
5. este servicio, para cualquiera
6. … hasta la regla general de la clínica.

**Por omisión se paga sobre lo cobrado**, no sobre lo facturado: una comisión pagada sobre una
factura que el cliente nunca pagó es plata que puso la clínica. Se puede cambiar.

**El IVA nunca entra**: se descuenta siempre. Descontar además el **costo de los insumos** es
opcional, regla por regla.

## Paso a paso

1. **Agregar una regla** con el porcentaje o el monto.
2. Al cerrar el mes, **Calcular un período** para una persona: sale un **borrador** con una línea
   por cargo.
3. Revisarlo. Se puede **ajustar** con un motivo.
4. **Aprobar.**

## Un ejemplo con números

La Dra. Mora tiene **10 % sobre cirugías**; la clínica tiene **5 % general**. Hace dos cirugías de
₡100 000 y ₡60 000, las dos cobradas.

El borrador trae dos líneas y **₡16 000**: ganó su regla, no la general. Se aprueba.

Tres días después se anula la cirugía de ₡60 000. **La liquidación aprobada no se toca**: en el
período siguiente aparece un **ajuste de −₡6 000** con el motivo «el cargo se anuló después de la
liquidación del…».

## Qué pasa después

- **Una liquidación aprobada no se edita, ni vuelve a borrador, ni cambia de total.** Es plata ya
  pagada: lo que venga después se ajusta en la siguiente.
- **Un cargo no se liquida dos veces.** Si se recalcula un período que ya tenía cargos liquidados,
  esos no vuelven a entrar y el sistema lo dice.
- Cada persona ve **sus** comisiones con el detalle de cada cargo: de dónde salió y con qué
  porcentaje.

## Preguntas frecuentes y errores comunes

**Calculé el período y salió en cero.**
Revisá que haya una regla vigente y que los cargos tengan **quién los realizó**: la comisión se
calcula sobre `realizado por` y `referido por`, que se eligen al cobrar.

**Una cuenta pagada a medias.**
Lo cobrado **se prorratea** entre los cargos de esa cuenta. Si el cliente pagó la mitad, cada cargo
cuenta la mitad: decidir «cuál de los tres se pagó» sería inventado.

**«Esa liquidación ya está aprobada y no se recalcula».**
Es la regla. Si hubo un error, se corrige con un ajuste en el período siguiente, que queda explicado.

**Quiero pagar un monto fijo por cirugía en vez de un porcentaje.**
La regla admite las dos cosas: elegí *Monto fijo*.
