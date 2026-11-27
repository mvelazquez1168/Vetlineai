# Permisos, controlados, desechos y auditoría

## Para qué sirve

Que los papeles que la clínica necesita no venzan sin que nadie se dé cuenta, que el libro de
controlados esté al día cuando llegue una inspección, y que se pueda contestar «¿quién hizo esto?».

## Cuándo se usa

Los permisos, una vez y después cuando avisa. El libro de controlados, cada vez que entra o sale uno
—solo—, y al cerrar el período. La auditoría, cuando algo no cuadra.

## Quién puede usarla

| Qué | Permiso |
|---|---|
| Permisos, vencimientos y desechos | *Permisos, vencimientos y desechos* |
| Ver y registrar en el libro de controlados | *Registrar en el libro de controlados* (médico y farmacia lo tienen) |
| **Firmar el cierre** del libro | *Firmar el cierre del libro de controlados* — **solo el regente**, y la clínica se lo asigna: el sistema no sabe quién es |
| Auditoría | *Ver la auditoría del sistema* (administrador y contador) |

---

# Permisos y vencimientos

La clínica nace con una **lista sugerida**: permiso sanitario de funcionamiento, certificado
veterinario de operación, patente municipal, regencia, póliza de riesgos del trabajo, revisión de
rayos X, calibración de equipos y contrato con el gestor de desechos.

> **Están marcados como sugeridos a propósito.** Este sistema **no verificó** contra el Ministerio
> de Salud, SENASA ni el Colegio cuáles le aplican a tu clínica, y presentar como obligación legal
> algo sin confirmar sería peor que no listarlo. Confirmá con tu asesor cuáles corresponden, cargá
> sus datos —al hacerlo dejan de ser una sugerencia— y desactivá los que no apliquen.

Cada uno guarda su **número**, su **vencimiento**, su **responsable** y con cuántos días avisar.

---

# El libro de medicamentos controlados

## De dónde sale

**No se escribe aparte.** Se arma con los movimientos de inventario que ya existen:

- **entradas**: las compras;
- **salidas**: el uso en una atención, con **el paciente** y **el médico que lo indicó**;
- **saldo**: por producto y por lote.

Un segundo registro de lo mismo es un segundo registro que un día no coincide, y en un libro de
controlados eso es un problema con el regente.

Para que un producto aparezca, tiene que estar marcado **controlado** en su ficha de inventario.

## El cierre

1. El regente revisa el saldo del período contra lo que hay en el estante.
2. **Cerrar y firmar el período.**
3. Queda congelado **lo que vio**: quién firmó, cuándo y el saldo de cada producto y lote.

**Un cierre firmado no se edita ni se borra.** Si hubo un error, se corrige con un **cierre nuevo**
que lo explique, igual que un asiento inverso en contabilidad.

---

# Desechos bioinfecciosos

Fecha, tipo, **peso o volumen**, el **gestor autorizado** que los retiró y su comprobante. Es lo que
una inspección pide ver. Un retiro sin cantidad se rechaza: no sirve para nada.

---

# Auditoría

## Qué muestra

Lo que pasó en el sistema, **de todas las fuentes a la vez**:

- anulaciones y descuentos autorizados, con quién los pidió y quién los aprobó;
- cambios de política, con el valor anterior y el nuevo;
- **cambios de precio**, con el precio de antes y el de ahora;
- ajustes de inventario;
- fusiones de clientes y pacientes;
- exportaciones de datos.

**Se filtra** por fecha, por persona y por tipo, y se **exporta a Excel**.

## Un ejemplo

El lunes aparece un cobro anulado de ₡60 000 que nadie recuerda. En *Auditoría*, filtrando por
«anular_cobro», sale: *27 de noviembre, 14:32 — Ana Admin — caja — Cobro duplicado — ₡60 000 · Se
verificó con el cliente*. Quién lo pidió, quién lo aprobó y por qué, en una línea.

## Qué pasa después

Nada: la auditoría **solo lee**. No se puede editar ni borrar un evento, porque los eventos son los
registros que cada módulo ya dejó.

## Preguntas frecuentes y errores comunes

**No encuentro un cambio que sé que pasó.**
La auditoría muestra lo que quedó registrado en alguna parte. Si un módulo no deja rastro de algo,
no se puede mostrar: el informe del prompt 11 lista qué quedaba sin registrar y qué se cubrió —los
cambios de precio, por ejemplo, **no se guardaban en ninguna parte** hasta esta entrega—.

**El libro de controlados está vacío.**
Revisá que los productos estén marcados **controlado** en su ficha. Sin esa marca, sus movimientos
no entran al libro.

**¿Por qué el saldo del libro no coincide con el inventario?**
No debería: sale de los mismos movimientos. Si no coincide, lo que cambió es el filtro de fechas —el
libro muestra un período y el inventario el saldo de hoy—.
