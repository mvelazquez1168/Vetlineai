# Contingencia de caja — qué hacer cuando no se puede facturar

Escrito para quien está en el mostrador, no para quien programó el sistema.

---

## Primero: distinguir los dos casos

No son lo mismo y se resuelven distinto.

| Qué pasa | Cómo se nota | Qué hacer |
|---|---|---|
| **Hacienda no responde, pero hay internet** | El cobro funciona. El comprobante dice "Pendiente de transmitir" o "en cola". | **Nada.** El sistema firmó el comprobante, lo guardó y lo reintenta solo cada minuto. La venta está hecha y es válida. |
| **No hay internet** | El sistema no carga, o el cobro falla al conectarse. | Talonario en papel, y regularizar después. |

La diferencia importa: usar el talonario cuando Hacienda está caída pero hay internet genera trabajo
manual que el sistema ya estaba haciendo solo.

---

## La primera línea: una conexión de respaldo

**La recomendación es tener una segunda conexión**, y es más barata que el costo de una mañana sin
facturar:

- un **router con chip 4G** dedicado, encendido y configurado como respaldo automático; o
- el **hotspot del teléfono** de quien esté en recepción, como mínimo.

Con eso, el caso "sin internet" casi no ocurre, y el talonario queda para la excepción real.

Conviene **probarlo una vez por mes**: desconectar el cable de internet un minuto y comprobar que la
caja sigue cobrando. Un respaldo que nadie probó no es un respaldo.

---

## Si de verdad no hay internet

### 1. Usar el talonario

El talonario son comprobantes provisionales **prenumerados**, impresos de antemano desde
**Caja → Contingencia → Emitir e imprimir**.

Se imprimen **antes** de que haga falta, y es a propósito: sin internet tampoco hay sistema para
pedir un número.

Por cada venta:

1. Llenar un provisional a mano.
2. Entregarle la copia al cliente.
3. **Anotar el número** y guardar el original.

### 2. Regularizar cuando vuelva la conexión

En **Caja → Contingencia → Regularizar una venta**, por cada provisional usado:

1. Armar la cuenta con los cargos de esa venta.
2. Poner el **número del provisional**.
3. Poner la **fecha y la hora reales de la venta** — no la de hoy.
4. Regularizar.

El sistema emite el comprobante electrónico con esa fecha y con la referencia que Hacienda define
para este caso: el código **05**, *"Sustituye comprobante provisional por contingencia"* (Nota 9 del
Anexo 4.4).

### Por qué la fecha real importa

Emitir con la fecha de hoy una venta de anteayer declara el ingreso en el período equivocado. El
sistema usa la fecha que se escriba, así que es el dato que hay que cuidar.

---

## Lo que el sistema no hace solo

- **No detecta que no hay internet** y cambia de modo. Quien está en caja decide usar el papel.
- **No recuerda cuántos provisionales se usaron.** La lista de Contingencia muestra cuáles están
  disponibles y cuáles ya se regularizaron; lo que se llenó en papel y todavía no se cargó solo lo
  sabe quien lo escribió.
- **El inventario se descarga al regularizar**, no al vender en papel. Entre una cosa y la otra, la
  existencia del sistema está más alta que la real.
