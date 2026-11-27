# Barrido: toda exportación a PDF o Excel lleva el logo de la clínica

Rama: `vetline-clinic/barrido-exportaciones-logo`, que parte de la rama del barrido de modales. Va en la cola **justo después del barrido de modales y antes del 05**. Es corto.

## El problema

El anexo dejó `marcaPdf.ts` como punto único de la marca en un PDF: logo en bytes, color de la clínica y la regla de qué hacer si no hay logo. Pero:
- solo lo usa el PDF del examen;
- los tres PDF anteriores (receta, comprobante y el tercero que listó el informe del anexo) imprimen el azul de Vetline con constantes copiadas;
- las exportaciones a Excel no llevan ninguna marca.

**La regla del dueño del producto:** todo reporte o lista que se exporte a PDF o a Excel lleva el logo de la clínica.

## Resultado esperado

**Un solo punto de marca para los dos formatos:** `marcaPdf.ts` se extiende o se acompaña de su par para Excel, con la misma fuente de logo, color y nombre de la clínica (`clinica_apariencia`) y la misma regla ante la falta de logo: sale el nombre de la clínica, nunca el logo de Vetline en su lugar.

**PDF**, en todos los que genera el sistema:
- logo, nombre y color de la clínica en el encabezado;
- título, período y filtros aplicados;
- fecha de generación y usuario (sección 4.6 de la guía).

Se migran los tres PDF que hoy usan constantes, **incluido el comprobante electrónico**: su representación gráfica lleva el logo de la clínica emisora.

Para el comprobante, antes de cerrar se generan muestras en PDF y se dejan en `docs/reportes/muestras-pdf/` para que el dueño del producto las revise en papel. Cambiar el diseño no toca el XML firmado ni ningún dato fiscal.

**Excel**, en todas las exportaciones:
- un encabezado arriba de la tabla con el logo, el nombre de la clínica, el título, el período, los filtros, la fecha y el usuario;
- la tabla empieza debajo, con sus encabezados, filtros automáticos y datos tipados (números como números, fechas como fechas, formato de moneda), igual que hoy;
- el logo y el nombre también en el encabezado de impresión de la hoja.

**Inventario de exportaciones:** se listan todas las que existen (Caja, Inventario, Finanzas, Para el contador, Facturación, Presupuestos, Administración, CRM, dashboards, receta, examen, comprobante, cierre de caja) y cada una pasa por el punto único.

## Que no vuelva a pasar

- Un verificador que **falle** si una ruta de exportación genera un PDF o un Excel sin pasar por el punto único de marca. Primero tiene que fallar contra el estado actual.
- Una línea nueva en la sección 4.6 de la guía rectora: «Toda exportación a PDF o Excel lleva el logo y el nombre de la clínica, desde el punto único de marca».

## Verificación y entrega

- Exportar a PDF y a Excel desde al menos cinco pantallas distintas, con la clínica de prueba con logo propio y otra sin logo, para ver la regla del nombre.
- Las muestras del comprobante y de la receta en `docs/reportes/muestras-pdf/`.
- Un informe corto en `docs/reportes/` con la lista de exportaciones migradas, y commit con push.

Este trabajo se detiene solo ante una contradicción con lo construido.
