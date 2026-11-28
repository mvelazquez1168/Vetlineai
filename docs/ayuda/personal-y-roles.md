# El personal de la clínica y lo que puede hacer cada uno

## Para qué sirve

Que cada persona del equipo entre con **su** usuario y vea lo que le toca: la recepción la agenda y
los clientes, la caja los cobros, la farmacia el inventario, el médico el expediente. Y que cuando
alguien deja de trabajar en la clínica, deje de entrar el mismo día.

Antes había dos categorías: médico y administrador. Todo el que no era médico —recepción, caja,
asistente— entraba como administrador, es decir, podía todo: anular un cobro, cambiar los precios,
exportar la base de clientes.

## Cuándo se usa

Cuando entra alguien nuevo, cuando alguien cambia de puesto y cuando alguien se va.

## Quién puede usarla

**Ver el equipo** lo ve todo el personal: saber que la Dra. Mora es médica y que Dani está en caja
es información de todos los días.

**Cambiar roles, invitar y desactivar** lo hace quien tenga el permiso *Invitar, editar y
desactivar personas*, que por omisión tiene el administrador.

## Los ocho roles

| Rol | De qué se encarga | Dónde aterriza al entrar |
|---|---|---|
| **Administrador** | Configura la clínica, sus personas y sus políticas. Autoriza lo que otros piden. | Inicio |
| **Médico** | Atiende, escribe y firma el expediente, prescribe y pide estudios. | Área de trabajo |
| **Recepción** | Agenda, check-in, clientes y pacientes (datos no clínicos), presupuestos y mensajes al cliente. | Agenda |
| **Caja** | Sesiones de caja, cobros, abonos, anticipos, comprobantes y cierre. | Caja |
| **Farmacia** | Venta de mostrador, inventario, recepción de compras y toma física. | Inventario |
| **Estética** | Grooming y sus hallazgos. | Pacientes |
| **Asistente técnico** | Signos y peso en el check-in, preparación del paciente. | Agenda |
| **Contador** | Solo lectura de caja, comprobantes, cuentas y reportes. Sin datos clínicos. | Facturación electrónica |

> **Una persona puede tener más de un rol.** En una clínica chica la misma persona es caja y
> recepción, y lo que puede hacer es la suma de los dos. Si dos de sus roles tienen topes distintos
> —por ejemplo, de descuento—, vale **el más permisivo**: su rol más alto manda.

## Paso a paso

**Invitar a alguien**

1. *Administración › Personas › Invitaciones* › **+ Invitar a alguien**.
2. Marque **con qué rol entra**. Puede marcar varios.
3. Escriba el **correo** y, si quiere, el nombre.
4. **Enviar invitación**. Le llega un enlace de un solo uso, válido por siete días, donde ella
   misma elige su contraseña.

**Pasarle el enlace de alta a mano**

Cuando el correo no llega —cayó en spam, se escribió mal la dirección, o la persona está sentada al
lado—, se le puede dar el enlace directamente.

1. *Administración › Personas › Invitaciones* › en la fila de la invitación, **Copiar enlace**.
2. El enlace queda en el portapapeles. Pegalo en un mensaje **privado** para esa persona.

Lo mismo se ofrece justo después de invitar: el aviso de «Invitación enviada» trae el botón
**Copiar enlace de alta**.

El enlace **es una credencial**: quien lo tenga crea esa cuenta, con esos roles, en esta clínica.
Por eso solo lo ve quien puede *invitar, editar y desactivar personas*, y **queda registrado quién
lo copió y cuándo** (se ve en *Administración › Catálogos y cumplimiento › Auditoría*).

**Cambiarle los roles a alguien**

1. *Administración › Personas › Personal*.
2. En su fila, **Roles**.
3. Marque y desmarque, y **Guardar roles**.

El cambio surte efecto en su siguiente pantalla: **no hace falta que cierre sesión**.

**Que alguien deje de entrar**

1. *Administración › Personas › Personal* › en su fila, **Desactivar**.
2. Confirme.

## Un ejemplo

Entra Dani, que va a estar en el mostrador y además va a cobrar.

Se la invita marcando **Recepción** y **Caja**. Le llega el correo, elige su contraseña y entra: cae
en la agenda, puede agendar, cobrar y emitir facturas. No puede anular un cobro ni ver los costos de
los productos, y el menú no le muestra esas opciones.

Al mes, la clínica decide que Dani también autorice anulaciones. El administrador va a *Roles y
permisos*, busca **Anular cobros y comprobantes** en la columna de **Caja** y marca la casilla. Dani
lo ve en menos de un minuto, sin volver a entrar.

## Qué pasa después

Al desactivar a alguien:

- se le quitan los roles;
- se **deshabilita su usuario** y se **cierran sus sesiones abiertas**: si estaba con el sistema
  abierto, el siguiente clic la saca;
- **lo que ya firmó o cobró queda como está, con su nombre.** Una atención firmada por ella sigue
  firmada por ella: borrarla sería falsificar el expediente;
- si tenía **citas futuras**, se avisa cuántas. Alguien tiene que reasignarlas: no se cancelan
  solas.

Si vuelve, **Reactivar** la deja entrar otra vez, con el rol más básico. Hay que volver a marcarle
sus roles: el sistema no adivina los que tenía hace seis meses.

## Preguntas frecuentes y errores comunes

**«Es la única persona con el rol de administrador activa en la clínica».**
No se puede dejar la clínica sin administrador, ni desactivando a la última ni quitándole el rol.
Dele el rol a alguien más primero.

**«No podés desactivarte a vos mismo».**
Alguien más tiene que hacerlo. Si no, el último administrador podría quedarse afuera de su propia
clínica.

**El rol de médico pide colegiatura.**
Porque una firma en el expediente tiene que poder atribuirse a un profesional colegiado. A la
recepción no se le pide: no es veterinaria.

**Invité a la recepción y me dice que no hay cupo.**
No debería: el cupo del plan es **de médicos**, y una invitación sin el rol de médico no lo consume.
Si el mensaje aparece, revise que no haya quedado marcado también **Médico**.

**¿Por qué no puedo cambiar los permisos del expediente?**
Escribir y firmar el expediente es del rol médico y no se configura. Es lo que hace que una firma
signifique algo. Los permisos que **sí** se pueden mover son cinco: ver costos y márgenes, aplicar
descuentos, anular, ajustar inventario y exportar datos.

**Copié el enlace y el botón dice que no se pudo copiar.**
Entonces no se copió, y el enlace se muestra en pantalla para copiarlo a mano. Pasa cuando la
interfaz se abre por una dirección que el navegador no considera segura: el portapapeles solo está
disponible en `https` y en `localhost`.

**¿Puedo mandar el enlace por WhatsApp a un grupo?**
No. Es una credencial de un solo uso: el primero que la abra crea la cuenta con esos roles. Va a la
persona, por un canal privado.

**Copié el enlace y la persona dice que no funciona.**
Fijate en la columna **Vence**. Un enlace vencido, ya usado o cancelado no sirve, y al pedirlo el
sistema lo dice en lugar de darte un enlace muerto. Se resuelve con **Reenviar** o invitando de
nuevo.

**Le quité un permiso y la persona lo sigue teniendo.**
Espere medio minuto. Los permisos se guardan en memoria un rato para no consultar la base en cada
pantalla; el cambio entra en su siguiente solicitud real.
