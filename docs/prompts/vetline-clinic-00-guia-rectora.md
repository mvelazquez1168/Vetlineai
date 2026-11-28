# Vetline Clinic 00 — Guía rectora del desarrollo

Esta guía gobierna **todo** el desarrollo de Vetline Clinic. No es una tarea: es el marco contra el
que se construye y se revisa cada prompt de la serie `vetline-clinic-NN-*.md`. Cuando un prompt
puntual y esta guía no coincidan, gana el prompt puntual para ese alcance, y se reporta la
diferencia para corregir la guía.

Al leerla por primera vez: agregá en `CLAUDE.md` una referencia a este archivo para que aplique a
todo trabajo de Vetline Clinic, y no construyas nada más con este prompt.

---

## 1. Qué es Vetline Clinic

El sistema de gestión de la clínica veterinaria, integrado a Vetline Ai como un solo producto:
expediente clínico del paciente, agenda, inventario y farmacia, ventas y caja, facturación
electrónica de Costa Rica, CRM (relación con el cliente, campañas, oportunidades y fidelización),
administración de la clínica, finanzas, dashboards y análisis, y un agente de IA que opera sobre
todo eso. Primer usuario: Medicavet.

Tiene que sentirse **inteligente**: anticipa lo que el usuario necesita, encuentra cualquier cosa
en segundos y convierte los datos de la clínica en decisiones. Y **eficiente**: cada tarea
frecuente se resuelve en el menor número de pasos posible, sin pantallas intermedias inútiles.

## 2. Arquitectura — no negociable

Viene de `docs/relevamientos/modelo-compartido-gestion.md`, que sigue siendo la fuente de verdad del
estado actual.

- **Mismo repositorio, mismo backend, misma base** que Vetline Ai. Nada de servicios paralelos.
- Módulos habilitados por clínica con `tenant_modulos` y su único punto de consulta. Los módulos
  son `expediente`, `inventario`, `ventas`, `facturacion`, `crm`, `administracion` y `finanzas`;
  los dos últimos se agregan al CHECK con una migración en el prompt de administración base.
- Toda tabla nueva con `tenant_id`: RLS habilitado **y forzado**, política estándar, FK a
  `tenants` con `ON DELETE CASCADE`. La auditoría de RLS tiene que pasar limpia.
- Requests de usuario con `vetplatform_app` y `app.tenant_id` por transacción. Ninguna llamada
  externa (modelo de IA, Google, Hacienda, correo) dentro de una transacción abierta: patrón de
  transacción corta (`cerrarTransaccion` / `conAlcanceTenant`).
- Se reusa lo que existe, no se copia: `enviarEmail`, `emitirNotificacion`, `formatFecha`,
  `apiFetch`, `useAuth`, la compuerta de crédito de IA (`verificarAntesDeGenerar` +
  `registrarUsoApi`), la auditoría global de escrituras, `crearCita()`.
- **Lo que mueve dinero o stock se impone en la base, no solo en el backend:**
  - los movimientos de inventario solo se agregan; nunca se editan ni se borran (se corrigen con un
    movimiento inverso);
  - el stock no queda negativo, salvo en productos marcados explícitamente como que lo permiten;
  - consecutivo de comprobantes único por clínica, sucursal y terminal;
  - un comprobante emitido nunca se borra: se anula con nota de crédito;
  - un mismo cargo de una atención no se cobra dos veces.
- Toda fuente de verdad tiene **una sola copia**. Si para resolver algo hace falta duplicar un dato,
  una regla o un mapa de etiquetas, se detiene y se reporta.

## 3. Modelo de dominio — los ejes

- **El paciente es el eje.** Su expediente reúne visitas (`atenciones`), casos de Vetline Ai,
  cuidados preventivos, recetas, cargos, productos dispensados y comunicaciones.
- **La atención es la bisagra** entre lo clínico y lo administrativo. Lo que se cobra o se descarga
  se elige de un catálogo vinculado a precios e inventario; las notas clínicas son libres pero no
  generan cargos. Cerrar la atención dispara la cuenta, el descargo y los recordatorios.
- **Línea de negocio en todo ingreso y toda salida**: consulta, cirugía, hospitalización,
  laboratorio, imagen, farmacia, pet shop, grooming, hotel, vacunación. Es la dimensión sobre la que
  se construyen los dashboards y las correlaciones; sin ella no hay análisis. Junto a la línea de
  negocio, todo cargo lleva también **especialidad** cuando aplica (medicina general,
  gastroenterología y endoscopia, cardiología, dermatología, ortopedia…) y el **médico** que lo
  realizó: son las tres dimensiones de la rentabilidad.
- **Todo movimiento de inventario tiene un origen** (venta de mostrador, atención, consumo interno
  de un servicio, merma, vencimiento, ajuste de conteo, traslado, devolución a proveedor) y vínculos
  **opcionales** a paciente, atención, comprobante y persona que lo hizo. Que un movimiento no tenga
  paciente es normal, no un error: la venta de mostrador, la merma o el consumo general del
  quirófano no lo tienen.
- **El cliente es `propietarios`, con sus mascotas.** No existe una segunda tabla de clientes o
  contactos en ningún módulo, tampoco en el CRM.
- **El receptor de la factura no es necesariamente el cliente.** Los perfiles de facturación (empresa
  del dueño, fundación, familiar) son una entidad propia, ligable a uno o varios clientes o a
  ninguno. La cuenta, la atención y el gasto en el CRM son del dueño de la mascota; la factura es del
  receptor, y en una venta a crédito el deudor es el receptor. El comprobante guarda una copia de
  los datos del receptor tal como se emitió.
- **Clientes y pacientes: una sola lógica, distintos niveles de completitud.** Vetline Ai y Vetline
  Clinic crean y editan clientes y pacientes por los mismos endpoints y con las mismas reglas, con un
  único componente de alta usado desde ambos lados. Vetline Ai pide lo mínimo; Vetline Clinic ofrece
  el formulario completo. Los datos se exigen cuando una acción los necesita (por ejemplo, la
  identificación al emitir una factura), no al crear el registro. El registro de clientes y
  pacientes es núcleo y no depende de ningún módulo.
- **La línea de tiempo de interacciones es el pegamento entre módulos.** Todo lo que le pasa a un
  cliente o a su mascota (cita, atención, compra, cobro, recordatorio, campaña recibida o
  respondida, conversación, encuesta, reclamo) se registra como un evento con su tipo, fecha, el
  módulo que lo originó y una **referencia** al registro de origen, nunca una copia de su contenido.
  Cada módulo escribe ahí por un único punto de registro; el CRM, los dashboards y el agente leen de
  ahí. Ver sección 7.

## 4. Experiencia de usuario

Patrones de Vetline Ai sin divergencias: tokens de `tailwind.config.js`, primitivas de
`components/ui/`, textos con el tono y el voseo de la aplicación, fechas solo por `formatFecha`.
Lo que esta guía agrega al sistema de diseño se agrega **al sistema de diseño compartido**, no a
Vetline Clinic solamente, para que Vetline Ai lo adopte y no quede divergente.

### 4.1 Lo que se suma al sistema de diseño

- **Íconos:** una sola librería de íconos de línea, liviana y con buen soporte de tree-shaking.
  Elegila, justificala en una línea y usala en todo componente nuevo.
- **Gráficos:** una sola librería de charts para React. Elegila con el mismo criterio. Todos los
  charts pasan por componentes propios (`ChartBarras`, `ChartLinea`, `ChartDona`, `ChartArea`,
  `Sparkline`) para que la librería quede detrás de una sola puerta.
- **Paleta de datos en colores:** una paleta categórica de 10 colores (uno por línea de negocio; la separación mínima entre ellos queda en ΔE2000 ≈ 19 por la exigencia de contraste, así que en un mismo chart conviene no poner juntos los dos más parecidos), agregada como tokens junto a
  la paleta actual, con contraste suficiente sobre `surface` y `background`. **Cada línea de negocio
  tiene un color fijo**, definido en un solo mapa y usado en todo chart, badge y leyenda: la
  consulta es del mismo color en todas las pantallas. Los semánticos (`success`, `warning`,
  `error`) se reservan para estados, nunca para categorías. El color nunca es la única forma de
  leer un dato: siempre hay etiqueta o valor.
- **Componentes que hoy no existen y se escriben una vez:** `Pagination`, `EmptyState`,
  `LoadingState` (skeleton, no solo "Cargando…"), `Modal` con prop de ancho, `Toast`,
  `KpiCard` (valor, variación contra el período anterior con flecha y color, sparkline),
  `SelectorPeriodo` (hoy, 7 días, mes, trimestre, año, personalizado, comparar con período
  anterior), `MenuExportar`.

### 4.2 Navegación y atajos

- **Paleta de comandos global** (`Ctrl+K` / `Cmd+K`): busca pacientes, propietarios, productos,
  citas, comprobantes y pantallas desde cualquier lugar, y ejecuta acciones ("nueva cita para
  Luna", "vender", "registrar atención").
- **Atajos de teclado** para las acciones frecuentes, con una ayuda visible al apretar `?`. Que no
  choquen con los atajos del navegador ni se disparen dentro de un campo de texto.
- **Acciones rápidas contextuales:** en la ficha del paciente, a un clic: nueva cita, registrar
  atención, vender, cobrar, enviar recordatorio, ver cronología. En una cita: abrir ficha, registrar
  atención, reprogramar, cobrar.
- **Recientes y favoritos:** los últimos pacientes y pantallas visitados, accesibles desde la
  paleta y desde el menú.
- **Flujo lógico del médico:** agenda del día → paciente → atención → cierre → cuenta, sin volver
  al menú entre paso y paso. Migas de pan en toda pantalla de más de un nivel.

### 4.3 Búsqueda y filtros

- Búsqueda tolerante a errores de tipeo y acentos (por ejemplo `pg_trgm` + `unaccent`), por
  nombre, número de expediente, microchip, teléfono, identificación, número de comprobante.
- Todos los filtros se resuelven en el backend, viven en la URL (se pueden compartir y sobreviven
  al refresco) y la pantalla recuerda el último usado por cada usuario.
- Filtros guardados con nombre ("Clientes sin visita en 6 meses", "Productos por vencer en 60
  días").
- Paginación en el servidor; nunca se filtra un arreglo ya cargado.

### 4.4 Dashboards

Cuatro niveles, todos con `SelectorPeriodo`, comparación contra el período anterior, `KpiCard` en
colores, charts en colores y **drill-down en todo**: un clic en una barra, un sector o una tarjeta
lleva a la lista filtrada que la compone, y de ahí al registro.

- **Clínica:** ingresos por línea de negocio, ticket promedio, atenciones, ocupación de la agenda,
  inasistencias, margen por línea, top de productos y servicios, inventario crítico y por vencer,
  cuentas por cobrar, cargos fugados, retención y clientes nuevos, resultado de campañas.
- **Médico:** sus atenciones, facturación atribuida, ticket promedio, casos abiertos, seguimientos
  pendientes, recomendaciones suyas que el cliente no agendó, agenda de hoy y de la semana.
- **Cliente (propietario):** es la ficha 360 del CRM (sección 7): gasto acumulado y por línea,
  frecuencia de visita, última visita, mascotas, saldo pendiente, valor de vida, preventivos
  pendientes de sus mascotas, oportunidades abiertas, respuesta a campañas y la línea de tiempo.
- **Paciente:** cronología, curva de peso, estado de preventivos (al día / por vencer / vencido /
  sin registro, distinguiendo "sin registro" de "no vacunado"), tratamientos activos, casos, gasto.

### 4.5 Trazabilidad de productos

Desde cualquier producto: consumo en el período → desglose por origen del movimiento → para los
movimientos ligados a paciente, los pacientes que lo usaron y la atención concreta. Los movimientos
sin paciente aparecen como su propio grupo con su origen ("Venta de mostrador", "Consumo interno de
quirófano", "Merma por vencimiento"), nunca escondidos ni repartidos.

### 4.6 Exportación

Toda tabla y todo dashboard donde tenga sentido ofrece **Excel y PDF** desde `MenuExportar`:

- generados en el backend, respetando tenant, permisos y los filtros aplicados en ese momento;
- Excel con datos tipados (números como números, fechas como fechas), encabezados, filtros y
  formato de moneda;
- PDF con logo y nombre de la clínica, título, filtros y período aplicados, fecha de generación y
  usuario que lo generó; para PDF se reusa el motor que ya genera las recetas, salvo que no sirva
  y lo justifiques;
- cada exportación queda en la auditoría.

**Toda exportación a PDF o Excel lleva el logo y el nombre de la clínica, desde el punto único de
marca** (`backend/src/marca/marcaClinica.ts`). Ningún generador declara sus propios colores: el
color sale de `marca.primario`, que es el de la clínica. Ante la falta de logo **sale el nombre de
la clínica y el documento se genera igual** —nunca el logo de Vetline en su lugar, y nunca se
bloquea la emisión de un documento clínico o fiscal por un archivo de marca—. Lo prueba
`verificar_marca_exportaciones.ts`.

### 4.7 Calidad visual y de uso

Responsive con el breakpoint `md` de Vetline Ai y probado en móvil (la app es PWA). Skeletons en
toda carga. Estados vacíos que dicen qué hacer. Errores que explican la salida. Accesibilidad:
contraste, foco visible, navegación por teclado completa.

**Nunca se pierden datos al salir de una pantalla.** Todo formulario y todo modal con campos lleva la
cuenta de si tiene cambios sin guardar. Si el usuario intenta salir (menú, miga de pan, enlace de
volver, botón atrás del navegador o del teléfono, cerrar el modal con la X, Escape o un clic afuera,
recargar o cerrar la pestaña), el sistema pregunta: **Guardar**, **Descartar** o **Seguir editando**.
Las pantallas con autoguardado (la atención) no preguntan si todo ya se guardó; si hay un guardado en
curso o pendiente, esperan o avisan. Se implementa una sola vez (un hook común con el bloqueo de
navegación del router y `beforeunload`, integrado en el `Modal` compartido), no pantalla por pantalla.

**Un modal con formulario nunca se cierra con un clic fuera de él; cerrarlo con cambios sin guardar
pide confirmación.** Los modales son de dos tipos y el tipo decide el comportamiento:

| Tipo | Clic afuera | Esc, X o Cancelar |
|---|---|---|
| **Con formulario o acción** | **no cierra** | cierra si no hay cambios; con cambios, pregunta |
| **De consulta** (solo lectura) | cierra | cierra |

El tipo por omisión es *con formulario*, que es el caso seguro: un modal que se olvide de declarar
su tipo no pierde lo que alguien escribió. La regla vive en un solo componente
(`components/ui/CapaModal.tsx`) y **ninguna pantalla arma su propio fondo**: un fondo propio es una
copia de la regla, y lo prueba `npm run verificar-modales`. Mientras un modal está abierto, el foco
queda adentro y al cerrarse vuelve al botón que lo abrió.

## 5. Agenda y Google Calendar

La agenda de Vetline sigue siendo **la única fuente de verdad** de las citas, porque una cita lleva
paciente, dispara avisos al tutor y alimenta la atención. Google Calendar es una vista y una fuente
de disponibilidad, opcional por médico.

- Conexión por médico con OAuth de Google, desde su perfil, revocable en cualquier momento.
- **De Vetline a Google:** cada cita del médico aparece en su Google Calendar y se actualiza o
  desaparece cuando cambia en Vetline.
- **De Google a Vetline:** si el médico mueve o cancela en Google un evento que es una cita de
  Vetline, el cambio se aplica en Vetline **pasando por la misma lógica de citas** (transiciones,
  avisos al tutor), nunca escribiendo directo en la tabla. Los eventos propios de Google que no son
  citas no se convierten en citas: se toman como **bloques ocupados** en la disponibilidad del
  médico.
- Sincronización incremental con notificaciones push de Google y tokens de sincronización, con
  renovación de canales y reconciliación periódica como red de seguridad.
- Los tokens de Google se guardan cifrados. Ninguna llamada a Google ocurre dentro de una
  transacción abierta.
- La disponibilidad (horarios, bloqueos, duración por tipo de cita, buffer, recursos, bloques de
  Google) **impide** crear citas fuera de ella, salvo una sobrecarga explícita y registrada.

## 6. Análisis y correlaciones

El sistema analiza cómo se relacionan las líneas de negocio entre sí: por ejemplo, cuánto se
asocian las ventas de grooming con la consulta o con la venta de productos, o cuánto se asocia la
venta de servicios médicos con la venta de productos. Tres miradas complementarias, en una pantalla
de análisis con drill-down:

1. **Afinidad por cliente (la principal):** de los clientes que usaron la línea A en el período,
   qué porcentaje usó también la línea B (tasa de adhesión), y el *lift* contra el porcentaje
   general. Responde preguntas accionables: "el 40 % de los clientes de grooming nunca compró
   productos".
2. **Efecto posterior:** gasto en la línea B en los 30, 60 o 90 días posteriores a usar la línea A,
   comparado con clientes comparables que no la usaron.
3. **Correlación temporal:** correlación de Spearman entre las series semanales de las líneas, con
   matriz de calor en colores.

Reglas estadísticas obligatorias, porque una sola clínica tiene pocos datos:

- mostrar siempre el tamaño de muestra y la fuerza de la evidencia; por debajo de un mínimo
  (por ejemplo, 12 semanas o 30 clientes) se muestra "datos insuficientes", no un número;
- advertir en la propia pantalla que correlación no es causa, y que dos líneas pueden moverse
  juntas solo porque las dos dependen del volumen de visitas o de la estación;
- los cálculos se hacen con consultas y código, nunca con la aritmética del modelo de IA.

## 7. CRM — el pegamento entre módulos

Un CRM de clínica veterinaria, no de ventas corporativas: nada de embudos de negocio. Se construye
**encima** de `propietarios` y `pacientes`, sin datos de clientes propios. Seis piezas:

1. **Línea de tiempo de interacciones** (sección 3). Tabla de eventos que solo se agrega, con RLS
   forzado, un único punto de registro y referencias a su origen. Se alimenta también de lo que
   Vetline Ai ya tiene: `notificaciones`, `correos_enviados`, citas y atenciones, con un backfill
   del historial existente. Las conversaciones de WhatsApp viven en Converza y aparecen en la línea
   de tiempo por integración, sin copiar los mensajes.
2. **Ficha 360 del cliente:** mascotas, gasto por línea de negocio, saldo, preventivos pendientes,
   oportunidades abiertas, consentimientos, indicadores y la línea de tiempo, con acciones rápidas
   (agendar, vender, enviar mensaje, crear tarea).
3. **Segmentos dinámicos** definidos por reglas ("perros senior sin chequeo en 12 meses", "clientes
   de grooming que nunca compraron alimento"). Una sola definición que usan campañas, dashboards,
   filtros guardados y el agente; el segmento se evalúa en el momento, no se guarda como lista
   congelada.
4. **Oportunidades con ciclo de vida:** `detectada → contactada → convertida | descartada | vencida`,
   con origen (preventivo vencido, recompra, recomendación del médico no agendada, presupuesto no
   aceptado, etapa de vida, capacidad ociosa, inventario por vencer), responsable y valor estimado.
   Al convertirse quedan **ligadas a la cita o venta que generaron**, para medir cuánto vendió
   realmente el motor y no solo cuántos mensajes salieron. Cada cliente recibe solo la oportunidad
   de mayor valor cuando coinciden varias.
5. **Campañas y recordatorios comerciales:** segmento, mensaje, oferta, canal, fecha, costo
   estimado de envío e impacto en margen, aprobación, envío escalonado, conversación posterior y
   atribución de la venta. El canal principal es WhatsApp a través de Converza; el correo pasa por
   `enviarEmail` y la marca del comercio.
6. **Consentimientos, preferencias de contacto y tope de frecuencia** en un solo lugar, que
   **todo** envío consulta antes de salir, venga de la agenda, de una campaña o del agente.
   Ningún mensaje a pacientes fallecidos ni a clientes con una mascota hospitalizada o en
   tratamiento delicado. Los medicamentos de prescripción no se promocionan.

Más **indicadores por cliente** (valor de vida, riesgo de abandono, propensión por línea de negocio),
calculados con consultas y siempre explicables ("riesgo alto: 14 meses sin venir; antes venía cada
4"), y una **bandeja del día** para la recepción: a quién contactar hoy y por qué, con la acción a un
clic.

**Notificaciones existentes de Vetline Ai — se mantienen y se extienden, no se reemplazan.** Vetline
Ai ya tiene su configuración de avisos por clínica (Administración › Notificaciones, interruptores
leídos con `avisoActivo`), el trabajo diario `notificaciones.job.ts` y `emitirNotificacion` con sus
tipos: recordatorio de cita, vacunación y desparasitación próximas, seguimiento posterior a la
consulta, seguimiento faltante, agenda del día siguiente y cumpleaños. Todo aviso nuevo de Vetline
Clinic (recompra, informe posvisita, resultados, dosis, control, campañas, fidelización, app del
cliente) se agrega como **un tipo más de ese mismo mecanismo**: su interruptor en la misma pantalla
de configuración, su plantilla editable, su registro en `notificaciones`, el paso por
`puedeEnviar()` y su evento en la línea de tiempo. Lo que Vetline Clinic registra (vacunas y
desparasitaciones de la atención, controles agendados) alimenta las tablas que ese trabajo ya lee
(`cuidados_preventivos`, citas), para que los avisos existentes sigan funcionando sin duplicarse. Una
clínica solo con Vetline Ai conserva sus avisos exactamente como hoy.

### 7.1 Fidelización

Que el cliente vuelva, compre más en la clínica que afuera y recomiende a otros. Todo programa es
configurable por la clínica, se puede apagar, y su costo se mide contra lo que genera.

- **Planes de salud por suscripción:** un plan anual por mascota (por ejemplo, cachorro, adulto o
  senior) con cuota mensual cobrada por Tilopay con tarjeta tokenizada. Cada plan define qué
  incluye (vacunas, desparasitaciones, consultas, exámenes) y qué descuentos da. El sistema lleva
  el uso de cada beneficio por mascota, avisa lo que falta usar antes de que venza, gestiona
  renovación, morosidad y cancelación, y finanzas mide la rentabilidad de cada plan (cuota cobrada
  contra costo de lo usado).
- **Paquetes prepagados:** por ejemplo, cinco baños de grooming o un paquete de controles, con su
  saldo de sesiones visible en la ficha, en caja y para el cliente.
- **Programa de puntos:** acumulación por gasto con reglas por línea de negocio, canje por servicios,
  productos o descuentos, y vencimiento configurable. Por defecto **no** acumulan ni se canjean en
  medicamentos de prescripción ni controlados. Los puntos emitidos y no canjeados se reflejan en
  finanzas como un compromiso de la clínica, y el costo de los canjes entra en el análisis de
  márgenes.
- **Niveles de cliente** (por ejemplo, por gasto de los últimos 12 meses o antigüedad), con
  beneficios por nivel definidos por la clínica: prioridad en la agenda, descuento en grooming,
  recordatorios por adelantado. El cliente sube o baja de nivel automáticamente y se le avisa.
- **Referidos:** cada cliente tiene un código o enlace; cuando un cliente nuevo llega con él, ambos
  reciben el beneficio configurado, y el CRM registra quién trajo a quién y cuánto generó.
- **Momentos que importan:** bienvenida al cliente nuevo (un flujo de primeros 30 días),
  cumpleaños de la mascota (el aviso ya existe en Vetline Ai), aniversario como cliente, cambio de
  etapa de vida.
- **Fallecimiento de una mascota:** se detiene de inmediato todo envío sobre ella. Si la clínica lo
  configura, un único mensaje de condolencia aprobado y nada comercial durante el período que la
  clínica defina.
- **Experiencia posvisita:** encuesta NPS breve por WhatsApp. A los promotores se les invita a dejar
  una reseña pública; un detractor genera una tarea para dirección con plazo de 24 horas para
  contactarlo, y su resolución queda en la línea de tiempo.
- **Recuperación de clientes en riesgo:** cuando el indicador de riesgo de abandono sube, una
  secuencia de reactivación de hasta tres contactos espaciados, que se corta en cuanto el cliente
  responde o agenda.
- **Autoservicio del cliente por WhatsApp:** consultar sus puntos, el saldo de su plan o paquete,
  las próximas vacunas de sus mascotas y el carné digital de vacunación, y agendar, sin tener que
  llamar.

Reglas de fidelización:

- Todo envío respeta los consentimientos y el tope de frecuencia de la sección 7; los mensajes de
  servicio (saldo, plan, carné) no cuentan como promocionales.
- Ningún beneficio deja un servicio o producto por debajo del margen mínimo sin autorización de
  dirección.
- **Se mide:** retención anual, frecuencia de visita, recompra, valor de vida, NPS, participación en
  planes y su tasa de cancelación, costo del programa (puntos canjeados, descuentos, beneficios de
  planes) y retorno de la fidelización contra ese costo.

## 8. Administración y finanzas

### 8.1 Administración — cómo se gobierna la clínica

- **Usuarios, roles y permisos.** Roles nuevos además de médico y administrador: recepción, caja y
  farmacia. Una persona puede tener varios, como ya pasa con médico y admin. Todos entran por el
  flujo de invitación existente, que crea las dos mitades (base y Keycloak) en un solo acto. Los
  permisos se resuelven desde la base, nunca desde el token. Desactivar a una persona la desactiva
  también en Keycloak y le corta el acceso de inmediato (hoy un médico inactivo sigue entrando).
- **Configuración de la clínica:** datos fiscales, sucursal y terminales (las exige el consecutivo
  de Hacienda), salas, horarios y bloqueos, tipos de cita con su duración, numeraciones.
- **Políticas** en un solo lugar, que todos los módulos consultan: descuento máximo sin
  autorización, margen mínimo, tope de mensajes promocionales por cliente, umbral de aviso de stock,
  autonomía del agente por tipo de acción. Cada cambio de política queda auditado.
- **Personal:** turnos y guardias, vacaciones e incapacidades, vencimiento de colegiaturas,
  licencias y certificaciones, con aviso previo.
- **Honorarios y comisiones** por persona, calculados desde lo facturado y atribuido, para revisión
  y aprobación antes del pago.
- **Cumplimiento:** calendario de permisos sanitarios y de funcionamiento con vencimientos, libro de
  medicamentos controlados (entradas, salidas por paciente, saldo, firma del regente), registro de
  desechos bioinfecciosos.
- **Auditoría consultable:** la bitácora de escrituras que ya existe, con una pantalla para buscar
  quién hizo qué y cuándo.
- **Procedimientos de la clínica:** los manuales operativos cargados como documentos, que el agente
  usa para responder dudas del personal.

### 8.2 Finanzas — la salud económica, sin reemplazar al contador

- **Cierre diario:** ventas por medio de pago y conciliación contra datáfono, SINPE y banco, con
  diferencias señaladas.
- **Cuentas por cobrar** con antigüedad, abonos y cobranza amable por el CRM, dentro de sus
  consentimientos.
- **Cuentas por pagar:** nacen de las facturas de proveedores aceptadas en Hacienda y de las
  compras recibidas; calendario de pagos y registro de cada pago.
- **Gastos operativos** (alquiler, servicios, planilla, mantenimiento) clasificados por categoría y,
  cuando corresponde, por línea de negocio. Las facturas electrónicas recibidas se toman como
  fuente, no se retipean.
- **Estado de resultados por línea de negocio:** ingresos, costo de lo vendido desde los
  movimientos de inventario, gastos directos y margen. Es la base de la rentabilidad por servicio.
- **Flujo de caja** real y proyectado a 30, 60 y 90 días, con lo que hay por cobrar, por pagar y
  los gastos recurrentes.
- **Presupuesto contra real** por mes y por línea de negocio.
- **IVA del período:** resumen de IVA cobrado y de IVA soportado acreditable, como apoyo a la
  declaración. El cálculo final y la presentación siguen siendo del contador.
- **Exportación contable** de ventas, compras, gastos e inventario en un formato que el contador
  pueda importar.
- Todo dato financiero sale de las fuentes que ya existen (comprobantes, movimientos de inventario,
  pagos, facturas recibidas): finanzas consolida, no recaptura. Lo que mueve dinero cumple las
  reglas de integridad de la sección 2.

### 8.3 Análisis de rentabilidad y márgenes

Una pantalla de análisis dentro de finanzas, con `SelectorPeriodo`, comparación contra el período
anterior, charts en colores, drill-down hasta el comprobante o el movimiento, y exportación a Excel
y PDF.

- **Rentabilidad por línea de negocio** (consulta, cirugía, hospitalización, grooming, farmacia,
  pet shop, laboratorio, vacunación, hotel), **por especialidad** (gastroenterología y endoscopia,
  cardiología, etc.) y **por médico**: ingresos, costo directo, margen de contribución en monto y
  porcentaje, participación en el total y tendencia.
- **Margen por producto y por servicio:** precio, costo, margen unitario y total, volumen. El costo
  de un producto sale de su costo de compra; el de un servicio, de su receta de insumos más el
  tiempo de personal y de sala, con un costo por minuto configurable por rol y por sala.
- **Pareto y matriz de cuadrantes:** qué 20 % de productos y servicios explica el 80 % del margen, y
  una matriz volumen × margen (estrellas, volumen sin margen, margen sin volumen, candidatos a
  revisar), con cada punto clicable.
- **Erosión de margen:** alerta cuando el costo de un producto subió en una compra y el precio de
  venta no se ajustó, o cuando un servicio quedó por debajo del margen mínimo de la política.
- **Impacto de descuentos y campañas:** cuánto margen costaron los descuentos del período, por tipo
  y por persona que los aplicó, y el margen neto de cada campaña contra la venta que atribuyó.
- **Variación de precio, volumen y mezcla:** por qué cambió el margen de una línea entre dos
  períodos: porque se vendió más, a otro precio o con otra mezcla de productos y servicios.
- **Punto de equilibrio** de la clínica y por línea de negocio: cuánto hay que facturar en el mes
  para cubrir los costos fijos.
- **Rentabilidad por cliente:** margen acumulado por cliente, que alimenta el valor de vida del CRM.

Reglas del análisis:

- **El margen de contribución es la medida principal**: ingresos menos costos directos. Repartir
  costos fijos (alquiler, administración) entre líneas es opcional, se muestra aparte y con el
  criterio de reparto visible y configurable (por ingresos, por horas, por metros), porque cambiar
  el criterio cambia qué línea "parece" rentable.
- Un producto o servicio sin costo cargado se muestra como **"sin costo"**, nunca con margen del
  100 %, y la pantalla avisa cuántos hay.
- Los cálculos se hacen con consultas y código; el agente puede explicarlos y responder preguntas
  sobre ellos, pero nunca hace la aritmética.

## 9. Inteligencia del agente

- Responde preguntas en lenguaje natural sobre la clínica ("¿qué productos vencen este mes?",
  "¿cuánto facturó la Dra. X en cirugía contra el trimestre pasado?") consultando la base por
  herramientas, y muestra de dónde sale cada cifra. **Nunca inventa ni calcula números de memoria.**
- Alertas proactivas: cargos fugados, atenciones sin cerrar, stock crítico, vencimientos,
  recomendaciones no agendadas, caída de una línea de negocio.
- Detecta oportunidades y propone campañas **a través del CRM** (sección 7): no tiene un motor
  propio ni envía por fuera de los consentimientos y el tope de frecuencia.
- Todo consumo de IA pasa por la compuerta de crédito existente.
- Autonomía graduada: informa, sugiere, ejecuta con confirmación o ejecuta solo, según la acción.
  Nunca escribe ni modifica contenido clínico. Nunca mueve saldo de medicamentos controlados.
- **Sin dato no hay recomendación.** Toda sugerencia del agente trae el hecho que la sostiene (con su
  fuente), la lista concreta sobre la que se actúa (clientes, productos, presupuestos) con su acción, y
  cómo se medirá; al ejecutarse queda como iniciativa con su resultado a 30, 60 o 90 días. Las
  estimaciones dicen su supuesto; no se inventan comparaciones con "la industria".
- **Diagnósticos deterministas en su módulo.** Cada pregunta de gestión (rentabilidad, no rentables,
  inventario, ingresos por línea, ventas del mes, recuperación) tiene un diagnóstico en código con su
  pantalla, dentro del módulo dueño del dato: rentabilidad y no rentables en el 10b, inventario en el
  06/12, ingresos y ventas del mes en el 12/13, recuperación en el 14. El agente los ejecuta y
  explica; no los reemplaza.
- **Simulador de escenarios** (10b, Finanzas › Simulador): motor determinista del resultado
  operativo del período (volumen, precio, costo, costos fijos, capacidad, mezcla), con cascada,
  punto de equilibrio y sensibilidad. El agente traduce la pregunta a parámetros, los muestra para
  confirmar y explica el resultado; nunca hace la aritmética.
- **Ayuda del sistema:** el agente responde cómo se usa Vetline Clinic desde `docs/ayuda/`, que
  cada entrega mantiene actualizado con sus caminos de clics.

## 10. Rendimiento

Agregaciones en SQL, con índices pensados para los filtros reales; tablas de resumen precalculadas
solo cuando una consulta lo justifique con una medición. Objetivo: dashboards y búsquedas
respondiendo en menos de un segundo con los volúmenes de Medicavet. Medir antes de creer una
optimización.

## 11. Orden de construcción

Cada paso es un prompt aparte de la serie. La base del CRM y la administración base van temprano
porque los módulos siguientes se apoyan en ellas desde su primer día:

1. `01` — Auditoría de RLS, habilitación de módulos y ficha del paciente con su expediente
   (construido).
2. `01b` + `02` — Respuesta después del COMMIT; sistema de diseño ampliado, paleta de comandos y
   atajos.
3. `03` — Base del CRM: línea de tiempo de interacciones con su punto único de registro y el
   backfill del historial, y consentimientos con tope de frecuencia.
4. `04` — Administración base: roles de recepción, caja y farmacia por invitación, permisos desde
   la base, desactivación que corta el acceso, configuración de la clínica (sucursal, terminales,
   salas, horarios, tipos de cita) y políticas. Agrega `administracion` y `finanzas` a los módulos.
5. `05` — Agenda: disponibilidad que bloquea y sincronización con Google Calendar.
6. `06` — Catálogo de servicios y productos, líneas de negocio, precios, proveedores, inventario
   con movimientos y compras.
7. `07` — Atención con servicios, vacunas y recetas codificadas, cargos y descargo automático.
8. `08` — Ventas, caja, cobros y cierre diario.
9. `09` — Facturación electrónica de Costa Rica (versión 4.4), emisión y recepción de comprobantes
   de proveedores.
10. `10` — Finanzas: cuentas por cobrar y por pagar, gastos, estado de resultados por línea,
    flujo de caja, presupuesto, IVA del período, exportación contable y análisis de rentabilidad
    y márgenes (sección 8.3).
11. `11` — Administración completa: personal y turnos, honorarios y comisiones, cumplimiento y
    libro de controlados, auditoría consultable y procedimientos.
12. `12` — Dashboards de los cuatro niveles, trazabilidad de productos y exportación.
13. `13` — Análisis y correlaciones.
    `13b` — Ventas, estacionalidad y proyección: volumen y detalle, índices estacionales (mes,
    quincena, día, hora, eventos de Costa Rica), tendencia desestacionalizada y proyección con rango;
    única fuente de estacionalidad para 10b, 06, 05, 14 y 16b (después del 13).
14. `14` — CRM completo: ficha 360, segmentos, oportunidades, campañas (mensajería simulada, sin Converza por ahora), indicadores
    por cliente y bandeja del día.
15. `15` — Fidelización (sección 7.1), en tres partes: `15a` retención (recuperación de clientes,
    bienvenida, cumpleaños y aniversario, etapa de vida, fallecimiento, NPS; después del 14),
    `15b` paquetes prepagados paramétricos y referidos (los precios especiales para criadores y
    fundaciones quedan pendientes de definir), y `15c` planes de salud, puntos y
    niveles. El autoservicio del cliente va con la app del cliente (17).
16. `16` — Agente de IA de gestión: `16a` ayuda del sistema (puede adelantarse a la puesta en
    marcha) y `16b` asesor de gestión con diagnósticos, simulador e iniciativas (después del 10b,
    12, 13 y 14).

## 12. Cómo se trabaja

- Cada prompt se construye sin pedir confirmación. Se para solo ante una contradicción con el
  código, una decisión irreversible sobre datos existentes o un trabajo mucho mayor al supuesto.
- Antes de rediseñar una pantalla existente, primero se releva qué hace hoy.
- Un verificador tiene que fallar contra el defecto que dice detectar antes de creerle su visto
  bueno.
- Verificar que el código nuevo está realmente dentro del contenedor antes de creerle a una
  medición.
- **Toda pantalla nueva tiene que ser accesible desde la navegación**: el menú, la barra de la
  sección o una acción de la pantalla desde la que se llega naturalmente. Una pantalla a la que solo
  se llega escribiendo la dirección no existe para el usuario. Cada entrega lista sus pantallas
  nuevas con el camino de clics para llegar a cada una.
- **Manual de usuario: cada entrega actualiza `docs/ayuda/`.** Es a la vez el manual de usuario de
  Vetline Clinic y la fuente de la ayuda del agente. Está escrito para una persona que sabe de
  veterinaria pero no de administración, finanzas ni facturación electrónica. Cada funcionalidad
  tiene, en este orden: **para qué sirve** (el problema que resuelve en la clínica), **cuándo se
  usa**, **quién puede usarla** (rol), **paso a paso** con el camino de clics, **un ejemplo con
  números**, **qué pasa después** (qué se cobra, qué se descuenta, qué se avisa, qué ve el cliente),
  **preguntas frecuentes y errores comunes**, y los términos que usa enlazados a un **glosario**
  común (margen, anticipo, comprobante, mensaje receptor, FEFO, etc.). Una pantalla sin su página
  de manual no está terminada. Al cierre de cada bloque se genera el manual consolidado en PDF y
  Word, con el logo de la clínica, como continuación del manual de usuario de Vetline Ai que ya
  existe en `docs/`.
- **Las funciones se verifican desde la interfaz, en un navegador**, no solo desde la API: cada flujo
  nuevo se recorre clic a clic como lo haría el usuario, y el resultado se contrasta contra la base.
  La verificación de la API complementa, no reemplaza.
- Producción no se toca desde el desarrollo. Cada entrega termina con un reporte de lo construido,
  lo que no se pudo y por qué, y las contradicciones encontradas.
