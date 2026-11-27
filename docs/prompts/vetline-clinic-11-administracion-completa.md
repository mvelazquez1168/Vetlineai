# Vetline Clinic — 11 · Administración completa

Rama: `vetline-clinic/11-administracion-completa`, que parte del último punto que contenga todo lo construido (como mínimo el 04 y el 10a). Se rige por `vetline-clinic-00-guia-rectora.md`: sección 8.1 para el contenido y sección 12 para la forma de trabajo.

## Por qué existe

El 04 dejó a cada persona entrando con su rol, la clínica configurada y las políticas en un solo lugar. Falta lo que hace falta para **gobernar la clínica día a día**:
- quién trabaja cuándo;
- cuánto se le paga a cada uno por lo que hizo;
- qué permisos y registros exige la ley;
- quién hizo qué en el sistema;
- cómo se trabaja en la clínica.

Además, Medicavet viene de Digital Vet, que tiene un menú **Mantenimientos** con catálogos que hoy en Vetline están dispersos, son texto libre o no existen. Este prompt los ordena en un solo lugar.

**Fuera de alcance:**
- planilla y cargas sociales (CCSS, INS): las calcula el contador; aquí solo se exporta lo que el contador necesita;
- contabilidad;
- el agente de gestión (16), que usará lo que aquí se construye.

## 0. Relevamiento

El informe parte de dos tablas.

**Tabla 1 — lo que ya existe y dónde**, para reutilizarlo y no duplicarlo:
- personas, roles y horarios del 04;
- bloqueos de agenda;
- el registro de quién realizó y quién refirió cada cargo (08b);
- productos marcados `es_controlado` y los movimientos de inventario por paciente (06 y 07);
- la bitácora de escrituras;
- los archivos del expediente y de los casos, para reutilizar su almacenamiento;
- la base de conocimiento de Vetline Ai, para ver si los procedimientos pueden vivir ahí.

**Tabla 2 — catálogos de Digital Vet contra Vetline.** Fuentes:
- `docs/relevamientos/digital-vet-relevamiento-funcional.md`;
- el menú Mantenimientos de Digital Vet: Servicios, Egresos, Clientes, Compañías, Agenda, Veterinaria, Recetas, Transacciones, Inventarios (bodegas, insumos por servicio, insumos por insumo o compuestos, clasificación de insumos, unidades de medida, familias), Plantillas del sistema y Cargador de imágenes de insumos.

Cada catálogo queda en una de cuatro columnas:
- **existe en Vetline**, con dónde está;
- **existe como texto libre** y debe pasar a catálogo;
- **falta y aplica a una clínica veterinaria**;
- **no aplica**: los mantenimientos de otras industrias del ERP, como vehículos o embarques.

## 1. Catálogos de la clínica

**Un solo punto de entrada:** Administración › Catálogos, agrupado como Inventario, Veterinaria, Recetas, Clientes, Agenda y Documentos.
- Un catálogo que ya tiene su pantalla en su módulo **se enlaza** desde aquí; no se copia.
- Todos se comportan igual:
  - búsqueda;
  - activar o desactivar en lugar de borrar cuando algo lo usa;
  - orden manual;
  - exportar a Excel;
  - importar desde Excel con vista previa y errores fila por fila, con el mismo patrón que la importación de inventario del 06.

**Lo que se construye, si el relevamiento confirma que falta:**

*Inventario*
- **Clasificación de productos** en catálogo y no en texto libre: familia y subfamilia, marca y ubicación física. Hoy `inv_productos.categoria` es texto libre; se migra a familia sin perder lo cargado, y los filtros del inventario y de los dashboards usan la familia.
- **Productos compuestos (kits):** un producto hecho de otros, por ejemplo un kit de cirugía o un paquete de vacunas. Al venderlo o aplicarlo se descuentan sus componentes desde sus lotes, con FEFO. Su costo es la suma de los componentes. Si el inventario del 06 ya resuelve esto, se enlaza.
- **Insumos por servicio:** ya existe (`inv_servicio_insumos`); solo se enlaza.
- **Imágenes de productos:** una o varias fotos por producto, con el almacenamiento existente. Se ven en el catálogo, en la venta de mostrador y en la búsqueda. Incluye carga masiva, con el archivo nombrado por el código del producto.
- **Unidades:** las de Hacienda (Nota 15) no se editan; la lista de unidades base sí.

*Veterinaria y recetas*
- Lo que el relevamiento marque como faltante entre: motivos de consulta, mantos y pelaje, carácter, alimentación, tipos de corte de grooming, motivos de baja, dosis, frecuencias, duraciones y vías.
- Especies, razas, protocolos de vacunación y hábitat ya existen; solo se enlazan.

*Clientes*
- Tipo de cliente y zona.
- La fuente de referencia del anexo B3 se enlaza.

*Documentos*
- **Plantillas de documentos clínicos:** consentimientos, certificados de salud y de vacunación, autorización de eutanasia, alta. Llevan variables del paciente, del cliente y del médico, con la marca de la clínica. Se generan en PDF desde el expediente y se pueden firmar.
- Si el expediente ya tiene plantillas, se completan. Las plantillas de mensajes viven en Notificaciones y en el CRM; solo se enlazan.

## 2. Personal y turnos

- **Turnos y guardias** por persona, en una vista semanal y mensual. Se pueden copiar de una semana a otra.
  - Los turnos alimentan la disponibilidad de la agenda del 04 y el 05: un médico sin turno no recibe citas sin un permiso explícito.
- **Ausencias:** vacaciones, incapacidades y permisos, con fechas y aprobación del administrador.
  - Bloquean la agenda de esa persona.
  - Si ya había citas asignadas, se señalan para reasignar.
  - Solo se registran el tipo y las fechas, nunca el diagnóstico de una incapacidad.
- **Credenciales con vencimiento:** colegiatura del Colegio de Médicos Veterinarios, licencias y certificaciones (por ejemplo, regencia o radiología).
  - Aviso al administrador y a la persona 30 días antes del vencimiento y el día que vence.
- **Exportación para planilla:** horas y turnos del período por persona, en Excel, para el contador.

## 3. Honorarios y comisiones

**Reglas** por persona, por servicio, por familia o por línea de negocio. Gana la más específica.
- **Tipos de regla:** porcentaje o monto fijo.
- **Sobre qué se calcula:**
  - quién realizó y quién refirió, con el registro del 08b;
  - **por defecto, sobre lo cobrado**, configurable para que sea sobre lo facturado;
  - sin IVA, y opcionalmente descontando el costo de los insumos.

**Liquidación por período:**
1. El sistema calcula un borrador por persona, con el detalle de cada cargo que la origina.
2. El administrador revisa, ajusta con un motivo y aprueba.
3. La liquidación aprobada queda cerrada y se exporta.

Un cargo **anulado o devuelto** después del cierre genera un ajuste negativo en la liquidación siguiente; la liquidación cerrada nunca se edita.

**Visibilidad:** cada persona ve sus propias comisiones, y el administrador ve todas. El 10 usa las comisiones como costo en la rentabilidad por línea.

## 4. Cumplimiento

**Calendario de permisos y vencimientos de la clínica.**
- Ejemplos: permiso sanitario de funcionamiento, certificado veterinario de operación, patente municipal, regencia, póliza de riesgos del trabajo, revisión de equipos de rayos X, calibración de equipos.
- Cada uno guarda su documento adjunto, su fecha de vencimiento y su responsable.
- Avisa con anticipación configurable.
- Los permisos que exige la ley **se confirman contra la fuente oficial** (Ministerio de Salud, SENASA, Colegio de Médicos Veterinarios). La lista sugerida se marca como sugerida y es editable; no se presenta como obligación legal lo que no esté confirmado.

**Libro de medicamentos controlados**, para productos con `es_controlado`.
- **Entradas:** desde las compras.
- **Salidas:** por paciente, desde la atención, con el médico que lo indicó.
- **Saldo** por producto y lote.
- **Cierre periódico** con firma del regente: queda el registro de quién, cuándo y el saldo conciliado contra el inventario.
- Se arma desde los movimientos de inventario que ya existen, sin un segundo registro.
- Es de solo agregar: un error se corrige con un asiento inverso.
- Se exporta en el formato que pida la fuente oficial, si existe uno. Si no se confirma, se exporta en un formato tabular claro y se documenta.

**Registro de desechos bioinfecciosos:**
- fecha, tipo, peso o volumen;
- gestor autorizado que los retira;
- comprobante o manifiesto adjunto.

## 5. Auditoría consultable

Una pantalla para la bitácora existente: Administración › Auditoría.
- **Filtros:** persona, fecha, módulo, acción y registro afectado (por ejemplo, el paciente o la factura).
- **Lo que debe aparecer:**
  - anulaciones y descuentos autorizados;
  - cambios de política;
  - cambios de precio;
  - ajustes de inventario;
  - fusiones de clientes del B1;
  - cambios de roles y desactivaciones;
  - exportaciones de datos.
- **Detalle:** cada evento muestra el valor anterior y el nuevo cuando aplica.
- **Acceso y exportación:** solo para el administrador, con exportación a Excel.
- Si hay escrituras importantes que **no** quedan en la bitácora, el informe las lista y se cubren.

## 6. Procedimientos de la clínica

- **Los manuales operativos de la clínica** se cargan como documentos con categoría, versión y fecha de vigencia. Ejemplos: protocolo de limpieza del quirófano, atención de emergencias, cierre de caja, manejo de controlados.
- Cada procedimiento se puede marcar para ciertos roles. Opcionalmente, la persona confirma que lo leyó, con fecha.
- Quedan disponibles para que el agente de ayuda (16a) responda dudas del personal citando el procedimiento. Si la base de conocimiento de Vetline Ai sirve para esto, se reutiliza.

## Permisos

Lo que el 04 dejó en la matriz se extiende con:
- `catalogos.editar`;
- `personal.gestionar`;
- `comisiones.ver_propias`, `comisiones.ver_todas`, `comisiones.aprobar`;
- `cumplimiento.gestionar`;
- `controlados.registrar`, `controlados.firmar_cierre`, este último solo para el regente;
- `auditoria.ver`;
- `procedimientos.editar`.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador:

- crear la familia «Antiparasitarios», asignarle productos importados de Digital Vet y filtrar por ella en el inventario;
- crear un kit con tres componentes, venderlo en mostrador y ver bajar los tres desde sus lotes;
- subir fotos a dos productos y verlas en la venta de mostrador;
- generar un consentimiento de cirugía en PDF desde el expediente;
- asignar turnos de una semana, registrar unas vacaciones y comprobar que la agenda no deja citar a esa persona;
- definir una comisión del 10 % sobre cirugías para una médica, cobrar dos cirugías, liquidar el período, aprobarlo y anular una de las dos para ver el ajuste en el período siguiente;
- cargar el permiso sanitario con su vencimiento y ver el aviso;
- registrar la entrada y la salida por paciente de un controlado y cerrar el libro con la firma del regente;
- buscar en la auditoría quién anuló un cobro.

El informe incluye:
- las dos tablas del relevamiento;
- las pantallas nuevas con su camino de clics;
- las migraciones, con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant;
- las fuentes oficiales consultadas para cumplimiento y controlados, con lo que se confirmó y lo que no;
- las páginas de `docs/ayuda/`;
- lo documentado sin construir.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
