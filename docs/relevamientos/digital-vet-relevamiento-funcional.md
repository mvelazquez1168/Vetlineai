# Relevamiento funcional de Digital Vet (Grupo Argus) frente a Vetline Clinic

Fecha: 26 de noviembre de 2026. Recorrido hecho con la sesión de Medicavet, que autorizó el acceso con sus credenciales.

**Alcance y límites.** El recorrido fue solo de lectura y funcional. Se revisó qué módulos existen, qué hace cada pantalla y qué campos, catálogos y flujos maneja. **No** se revisó código, no se copió la interfaz, no se registraron datos de clientes ni de pacientes, y no se guardó, editó ni borró nada. Donde se abrió un formulario de alta para ver sus campos, se salió sin guardar. Este documento describe **capacidades** en lenguaje propio, para saber qué cubrir en Vetline Clinic. No es una especificación para replicar Digital Vet.

## 1. Qué es Digital Vet

Es un **ERP genérico** de Grupo Argus (ASP.NET Web Forms) con una vertical veterinaria encima. El menú lo confirma: incluye mantenimientos de otras industrias que no aplican a una clínica (vehículos, control de embarques, casos de aseguradoras de autos, órdenes de servicio). La parte veterinaria es la ficha clínica, la peluquería, las especies y razas, el control de vacunación y las recetas. El fuerte del producto es lo **administrativo-fiscal**: facturación electrónica, recepción de comprobantes, caja, cuentas por cobrar y por pagar, comisiones y un catálogo de más de 200 reportes tabulares.

Medicavet opera con **dos compañías** (la sociedad actual y una "histórica") y con **dos actividades económicas** registradas: venta al por mayor de productos farmacéuticos y veterinarios, y actividades veterinarias. Al facturar se elige con cuál actividad se emite.

## 2. Mapa de módulos

| Área | Qué contiene |
|---|---|
| **Accesos rápidos** | Agenda, Padrón, Cliente, Ficha clínica, Factura, Recibo, Cierres de caja |
| **Clientes** | Clientes, Ficha clínica veterinaria, Seguimiento (CRM básico), consulta al Padrón electoral (TSE), consulta de identificación en Hacienda, tipos de cliente, correos masivos, unificar clientes duplicados |
| **Facturación** | Factura y factura "multi-pestaña" (varias abiertas a la vez), recibo, recibo de adelanto, nota de crédito, por cobrar, presupuesto (también multi-pestaña), apertura de caja, vales de caja, cierre de caja, aplicar y reversar adelantos y notas de crédito |
| **Comprobantes electrónicos** | Estado de documentos, factura electrónica de compra, recepción de comprobantes de proveedores (normal, detallada y con aceptación parcial), recepción automática con tablero, descarga masiva de XML y PDF, bitácora de envío |
| **Egresos** | Proveedores, condiciones de crédito, factura de egreso, recibo de egreso (pagos), documentos recibidos |
| **Inventarios** | Insumos, órdenes de pedido (y unificarlas), movimientos (simple y detallado), traslados entre bodegas, entrada desde un comprobante recibido, kardex, histórico, lotes (registro, activos, cambio de vencimiento), pedidos de e-commerce, liquidación de pagos a terceros |
| **Agenda** | Agenda por ubicación (consultorio, anestesias, grooming), vista diaria y semanal, color por estado, motivo o funcionario; citas por reagendar, citas eliminadas, calificación de citas con cuestionario, disponibilidad de funcionarios, actividades y recordatorios, agenda telefónica |
| **Reportes** | Reportes generales (más de 200, por clasificación, con favoritos), reportes dinámicos por grupo de usuario, gráficas personalizadas |
| **Administración** | Usuarios y permisos por grupo, restricción de horario de uso, política de contraseñas, contraseñas para autorizar descuentos, logo, precios de servicios y de egresos, llaves criptográficas, importación de datos con plantillas (clientes, inventarios, servicios, proveedores, lotes, motivos de cita, precios) |
| **Plantillas de mensajes** | Recordatorio de cita (general y por compañía), seguimiento al día siguiente, recordatorio de citas canceladas, cumpleaños del cliente, cumpleaños de la mascota, correo del comprobante electrónico |
| **Catálogos veterinarios** | Especies, razas, mantos, pelaje, altura, carácter, hábitat, pedigrí, alimentación, partos, estados y motivos de baja, tipos de corte, control de vacunación canino y felino, aseguradoras y tipos de póliza, motivos y tipos de consulta |
| **Catálogos de recetas** | Medicamentos, dosis, frecuencias, tiempo de tratamiento, vías de aplicación |
| **Otros** | Contratos y planes con cuotas, zonas, otros cargos y terceros, catálogos de servicios por compañía, composición de servicios (servicio con insumos) |

## 3. Detalle de las pantallas clave

### 3.1 Ficha clínica veterinaria

- **Encabezado:** paciente con su edad calculada (años, meses y días) y propietario con su teléfono.
- **Pestañas:** Consultas, Resumen, Gráficas, Por cobrar, Actividades, Plantillas, Peluquería y Datos de la mascota.
- **Formulario de consulta:**
  - fecha, compañía, motivo de consulta (catálogo: general, dermatología, gastroenterología, cardiología, ortopedia, emergencia, emergencia nocturna, etc.);
  - **fecha de ingreso y de salida** (cubre estancias u hospitalización simple);
  - detalle de la consulta, exámenes de laboratorio (texto libre) y diagnóstico presuntivo;
  - **examen físico:** peso, FR, FC, temperatura, alerta o deprimido, hidratación, auscultación, mucosas, TLLC, condición corporal, palpación y alimentación;
  - **revisión por sistemas, cada uno con casillas "Normal" y "No aplica" más un detalle:** apariencia general, cardiovascular, nervioso, digestivo, dermatológico, locomotor, urinario, reproductor, ocular, linfático, hematológico, respiratorio y otros;
  - plan de tratamiento, diagnóstico definitivo, recomendaciones y notas.
- **Por cobrar:** se agregan servicios y productos desde la ficha, con descuento, exoneración e IVA separado de productos y de servicios, y se pasa a facturar. Equivale a nuestra captura de cargos en la atención.
- **Plantillas:** documentos con plantilla, aviso de firma y **autoguardado** (consentimientos, certificados, informes).
- **Datos de la mascota:**
  - nombre, número de expediente, sexo, fechas de ingreso y de nacimiento;
  - especie, raza, altura, manto, castrado, pelaje, carácter, hábitat, pedigrí, microchip, alimentación;
  - estado, motivo de baja, partos;
  - **características especiales, patologías permanentes y tratamientos permanentes.**
- **Archivos adjuntos** por paciente.

**Lo que no se vio estructurado:** vacunas y desparasitaciones registradas como eventos clínicos con lote y próxima fecha (en Digital Vet salen de banderas en el producto y de tablas de control por especie); resultados de laboratorio con valores y rangos; firma o cierre de la atención; lista de problemas; alertas visibles de alergias.

### 3.2 Factura

- **Encabezado:**
  - tipo de comprobante (factura, tiquete o factura de exportación);
  - cliente, que por defecto es "cliente contado";
  - funcionario que atiende y **funcionario referente**, para comisiones;
  - moneda (colones o dólares);
  - catálogo de precios;
  - condición (contado, crédito o **apartado**);
  - **actividad económica** con la que se emite.
- **Líneas:** se elige servicio o producto, con monto unitario, cantidad, detalle, % de descuento o **descuento por monto**, y % de exoneración.
- **Totales:** subtotal, IVA de productos, IVA de servicios, **IVA devuelto**, otros cargos y total.
- **Además:**
  - comentarios;
  - **nombre para factura editable**;
  - documento de referencia, con número y fecha;
  - **"cargar factura"**, que trae un presupuesto o documento previo;
  - **"cancela con"**, que calcula el vuelto.
- **Formas de pago:** efectivo, cheque, tarjeta, depósito, tarjeta manual y SINPE.

### 3.3 Productos (insumos)

**Pestaña General:**
- **Identificación:** código, dos códigos de barras, descripción, observaciones.
- **Clasificación:** familia, subfamilia, gama (normal, servicio, medicamento), marca, ubicación física, proveedor.
- **Existencias:** mínima y **máxima**.
- **Costos y precios:**
  - costo y **costo de la última compra**;
  - **precio de venta automático por % de utilidad**;
  - precio con y sin IVA;
  - **% máximo de descuento por producto**;
  - **consignación**.
- **Clínico:** banderas de **vacunación** y **desparasitación**, que alimentan los recordatorios; **similares** (sustitutos).
- **Fiscal (v4.4):**
  - tipo de impuesto y tarifa;
  - unidad de medida oficial;
  - código CABYS;
  - partida arancelaria;
  - código comercial;
  - **registro sanitario del medicamento**;
  - **forma farmacéutica**;
  - bandera **"regulado bajo decreto 44863"**.

**Pestaña Por fracción:** un producto se liga a otro "padre" con una cantidad. Es el modelo de códigos separados que mencionaste (1002 = 0,1 de 1001). Nuestro modelo de unidad base con presentaciones resuelve lo mismo sin duplicar productos.

**Aparte:** insumos compuestos (un insumo hecho de otros), insumos por servicio (receta de consumo) y carga de imágenes de productos.

### 3.4 Clientes

**Campos de la ficha:**
- **Identificación y relación con la clínica:** número de expediente, compañía, funcionario asignado, sexo, país de origen y de residencia, tipo y número de identificación, fechas de nacimiento y de ingreso, tipo de cliente.
- **Nombre y contacto:** nombre y dos apellidos, **forma de contacto preferida** (correo, teléfono, correo masivo, mensaje de texto), cuatro teléfonos, dos correos.
- **Precios:** catálogo de servicios asignado al cliente, es decir, su lista de precios.
- **Marketing y relación:** profesión, **tipo y detalle de referencia** (cómo llegó: TV, radio, web, referido), parentesco.
- **Facturación:** **un nombre y una identificación alternos para facturar**, actividad económica del cliente, **tipo de descuento fiscal por defecto**.
- **Dirección:** provincia, cantón y distrito codificados, y dirección exacta.
- **Otros:** observaciones y si quiere recordatorio de cita por correo.

**Herramientas aparte:** unificar clientes duplicados; consulta del padrón del TSE y de Hacienda para autocompletar por cédula.

### 3.5 Agenda

- Calendario por compañía y **ubicación** (consultorio, anestesias, grooming), en vista diaria o semanal.
- Coloreado por estado, por motivo o por funcionario.
- Pantallas aparte: citas por reagendar (seguimiento de canceladas y ausentes), citas eliminadas (auditoría), **calificación de citas con cuestionario** (encuesta de satisfacción), disponibilidad de funcionarios y bitácora de la agenda.

### 3.6 Reportes

- Más de 200 reportes **tabulares**, agrupados en: general, ventas, agenda, inventario, egresos, cuentas por pagar y por cobrar, comisiones, presupuestos, clientes, fichas clínicas, factura electrónica, soporte contable, veterinaria y cliente frecuente.
- Se marcan favoritos, y los permisos se dan por grupo de usuario.
- Los que más llaman la atención:
  - **producción y comisiones por funcionario** (con y sin descuento, con honorarios fijos y descontando el costo financiero de la tarjeta);
  - **conciliación de tarjetas contra Credomatic**;
  - **D-151**, la declaración informativa de clientes y proveedores;
  - consecutivos por fecha;
  - comprobantes rechazados o pendientes ante Hacienda;
  - cédula de ventas diaria y mensual;
  - utilidad por insumo;
  - existencias bajo el mínimo y por vencer;
  - productos en consignación;
  - clientes inactivos y días sin cita;
  - cumpleañeros;
  - contratos y cuotas;
  - apartados.
- **No hay tableros con gráficos ni análisis cruzado.** Es exportación de tablas.

## 4. Comparación con Vetline Clinic

### 4.1 Donde Vetline Clinic ya está igual o mejor

- **Inventario:** unidad base con presentaciones y factor, en lugar de productos-fracción separados. Lotes FEFO, envases abiertos, 13 movimientos con dirección fija y una sola puerta de entrada.
- **Receptor:** varios perfiles de facturación por cliente, contra un solo nombre alterno. Además, la cuenta es del dueño, la factura del receptor y la deuda de quien recibe a crédito.
- **Expediente:** atención firmada con adendas, vacunas y desparasitaciones como eventos con lote y próxima fecha, laboratorios con rangos por especie y tendencias, lista de problemas, alergias y alerta de manejo, predisposiciones raciales, casos de Vetline Ai y resumen con IA.
- **CRM:** línea de tiempo, consentimientos por canal y propósito, WhatsApp y un solo punto de control de envíos.
- **Análisis:** tableros por clínica, médico, cliente y paciente, con drill-down, rentabilidad por línea de negocio y correlaciones. Digital Vet solo tiene reportes tabulares.
- **Experiencia de uso:** búsqueda global, atajos, diseño moderno y tema por clínica.

### 4.2 Vacíos que conviene cubrir

Ordenados según su impacto para que Medicavet pueda dejar Digital Vet.

**Imprescindibles para la paridad operativa:**

1. **Presupuestos (proformas):** crear, enviar, vencer, aprobar y convertir en cuenta o factura, con varios abiertos a la vez. Hoy no hay presupuesto explícito en el 08.
2. **Comisiones y producción por funcionario:** médico que atiende, **funcionario referente** y reglas (porcentaje sobre la venta con o sin descuento, honorario fijo por servicio), descontando el costo financiero de la tarjeta. Encaja en finanzas (04, sección 8.3).
3. **Comisiones de tarjeta y conciliación con el datáfono:** comisión por tipo de tarjeta y banco, y conciliación del cierre de caja contra el reporte del datáfono BAC.
4. **Recepción automática de comprobantes de proveedores:** buzón de correo, tablero, aceptación total o parcial, **registro de la entrada a inventario desde el XML**, descarga masiva de XML y PDF, y bitácora de envío.
5. **Actividad económica por comprobante y por emisor:** elegir con cuál actividad se emite. Medicavet tiene dos. Hay que verificar que el facturador del 09a lo soporte; hay que confirmar también si se necesita más de un emisor (compañía actual e histórica).
6. **Campos fiscales del producto según v4.4:** registro sanitario, forma farmacéutica, código comercial, partida arancelaria. Hay que verificar en la documentación oficial el **decreto 44863 de precios regulados** y si aplica el **IVA devuelto** a servicios veterinarios.
7. **Unificar clientes duplicados**, conservando todo su historial.
8. **Autocompletar por cédula** desde el padrón del TSE y desde la consulta pública de Hacienda (nombre y actividad económica).
9. **Arqueo por denominación** de billetes y monedas en el cierre de caja, y vales de caja.
10. **Autorización de descuentos:** porcentaje máximo por producto y por rol, y autorización de un supervisor por encima de ese límite.
11. **Reportes fiscales y operativos equivalentes:** D-151, consecutivos, comprobantes rechazados o pendientes, cuentas por cobrar por vencimiento, cierres consolidados, comisiones y utilidad por producto. Las clínicas los van a pedir el primer día.

**Mejoras al expediente** (para agregar al 07):

12. **Examen físico por sistemas** con "Normal" y "No aplica" en un clic y detalle solo para lo anormal, más condición corporal, TLLC, mucosas e hidratación. Es mucho más rápido que el texto libre, y conviene que sea la plantilla SOAP por defecto.
13. **Ingreso y salida** en la atención, como base de un módulo de **hospitalización** (internamiento con hoja de tratamiento) más adelante.
14. **Datos de la mascota opcionales:** pelaje, manto, carácter, hábitat, pedigrí, alimentación, partos y motivo de baja, con el nivel de completitud ya definido.
15. **Autoguardado** de notas largas y documentos.
16. **Catálogos de receta:** dosis, frecuencias, duración y vías, para recetar en un clic.

**Para el CRM y la fidelización** (03 y 05):

17. **Fuente de referencia** del cliente (cómo llegó), para atribuir el marketing.
18. **Forma de contacto preferida**, que complementa los consentimientos.
19. **Plantillas de cumpleaños del cliente y de la mascota**, seguimiento al día siguiente y recordatorio de citas canceladas.
20. **Encuesta de satisfacción después de la cita** (NPS).
21. **Citas por reagendar:** cola de ausentes y canceladas para recuperar.
22. **Lista de precios por cliente** (convenios, criadores, fundaciones).
23. **Planes y contratos con cuotas:** planes de salud preventiva con pago mensual. Es una gran palanca de fidelización y de ingreso recurrente.

**Para más adelante:**

24. Aseguradoras y pólizas de mascotas.
25. Productos en consignación.
26. Pedidos de e-commerce.
27. Liquidación de pagos a terceros (laboratorio externo, especialista visitante).
28. Restricción de horario de uso y política de contraseñas (con Keycloak se configura casi todo).

### 4.3 Migración desde Digital Vet

Digital Vet tiene **importación** con plantillas, pero no se vio una exportación general de datos. La vía razonable para migrar es que **Medicavet exporte sus propios datos** desde los reportes completos que ya tiene: clientes completo, pacientes completo, inventario completo con vencimiento, cuentas por cobrar detallado, histórico de pacientes y lotes activos. Después se importan en Vetline Clinic con un importador que valide y deduplique. Las fichas clínicas en texto libre se pueden traer como historia previa, de solo lectura, adjunta al paciente.

## 5. Próximos pasos sugeridos

1. Confirmar con Medicavet **qué reportes usan de verdad** cada día, cada semana y cada mes. Esos definen el alcance mínimo de reportes.
2. Incorporar los vacíos 1 a 11 en los prompts que corresponden: 08 (presupuestos, denominaciones, autorización de descuentos, conciliación de tarjetas), 09a (actividad económica, recepción automática, campos v4.4), 04 y 8.3 (comisiones y producción) y 01 o 03 (unificar clientes, autocompletar por cédula).
3. Agregar al 07 los puntos 12 a 16, sobre todo el examen físico por sistemas.
4. Agregar al 03 y al 05 los puntos 17 a 23.
5. Preparar el importador para la migración (4.3), cuando toque.
