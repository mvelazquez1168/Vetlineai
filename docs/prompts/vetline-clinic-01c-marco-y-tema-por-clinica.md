# Vetline Clinic — 01c · Marco único, dirección visual "Marca de la clínica" y tema por clínica

Rama: `vetline-clinic/marco-y-tema`. No se fusiona a `main` sin revisión.
Se rige por `docs/prompts/vetline-clinic-00-guia-rectora.md`, sobre todo la sección 4 (UX) y la 12 (cómo se trabaja).

## Por qué existe este prompt

La revisión visual del sistema mostró que funciona, pero que es plano y no tiene un marco común:

- **Dos marcos distintos.** Las pantallas de Vetline Ai (Casos, Facturación) tienen menú lateral. Las de Vetline Clinic (Inventario, Pacientes, Agenda, Caja) tienen un "← Volver" y ningún menú. Al pasar de una a otra parece otro producto.
- **El menú lateral es una lista larga de texto**, sin íconos ni grupos, que mezcla lo clínico, lo comercial, la IA y la administración.
- **Casi no hay color.** Todo es tarjeta blanca; el color aparece solo en badges diminutos.
- **Las pantallas no resumen nada antes de la lista**: no hay indicadores.
- **Hay demasiados botones con el mismo peso.** Inventario tiene nueve en fila.
- **Las tablas son solo texto, y los estados vacíos son un renglón suelto.**
- **Hay errores sueltos:** dos campanas en Casos; el título del modal de cita queda cortado; "cargo(s)" sin cantidad ni monto en las cuentas abiertas de caja; enumeraciones en minúscula ("canino", "macho"); textos con voseo.

La dirección visual elegida con Medicavet es la **C · Marca de la clínica**. La maqueta navegable de referencia está en `docs/diseno/vetline-clinic-direccion-visual.html`. Use el selector de dirección C y vea las tres pantallas: Inventario, Caja y Agenda con Nueva cita. La maqueta es una referencia de estilo y jerarquía, no un diseño a copiar píxel por píxel. Donde la maqueta y una funcionalidad existente choquen, gana la funcionalidad, y se anota en el informe.

Sobre la dirección C se aplican dos ajustes:

1. **Color por módulo solo en los íconos.** El ícono del encabezado y los íconos de los indicadores llevan el color del módulo (Caja verde, Inventario teal, Agenda violeta, etc.). Las tarjetas completas no se tiñen.
2. **Franja superior compacta en pantallas de trabajo largo.** En el expediente, la atención, la emisión de comprobantes y los formularios largos, la franja ocupa menos alto y, al hacer scroll, queda como una barra delgada con el título. En listados y dashboards se muestra completa.

## 0. Relevamiento antes de tocar nada

Antes de cambiar una sola pantalla debe existir `docs/diseno/relevamiento-marco.md` con:

- **Los marcos (layouts) que existen hoy**, qué pantallas usa cada uno y en qué se diferencian.
- **Cada pantalla autenticada del sistema:** ruta; cómo se llega hoy (camino de clics); acciones, botones, filtros, atajos y modales que tiene; marco actual y marco nuevo.
- **Los componentes del sistema de diseño** (los de la sesión nocturna: iconos, gráficos, Pagination, EmptyState, LoadingState, Modal, Toast, KpiCard, SelectorPeriodo, MenuExportar, la paleta Ctrl+K), dónde se usan y dónde no se usan aunque deberían.
- **Los tokens de color, tipografía y espaciado actuales** y dónde hay colores escritos a mano en lugar de tokens.
- **Las pantallas de administración de plataforma** (las del superadministrador de Vetline Ai, si existen y son distintas de las de la clínica). Se decide y se anota si quedan con su propio marco o entran al nuevo. Una pantalla de plataforma no muestra el tema de una clínica.

Ese documento es la lista de control de la entrega: **ninguna acción, filtro, botón ni atajo que existe hoy puede desaparecer**. Al final, cada fila se marca como verificada en el navegador.

## 1. Un solo marco para todo el sistema

Todas las pantallas autenticadas de la clínica, de Vetline Ai y de Vetline Clinic, usan un único marco (`AppShell`).

**Menú lateral:**
- **Logo y nombre de la clínica arriba.** Sin logo cargado, se muestra un ícono con el color primario.
- **Grupos:**
  - Inicio
  - **Clínica:** Agenda, Pacientes, Propietarios
  - **Comercial:** Caja, Facturación electrónica, Inventario, CRM y campañas
  - **Inteligencia:** Casos clínicos, Casos sin actividad, Agentes IA
  - **Administración:** Reportes, Médicos, Clínica y usuarios, Notificaciones, Plan y consumo, Facturación de la suscripción

  Los nombres finales salen del relevamiento: si una opción de hoy no encaja, se ubica en el grupo más natural y se anota.
- **Cada opción tiene ícono** (del componente de íconos existente) y, donde aplica, un contador: citas de hoy, casos pendientes, aprobaciones.
- **Las opciones se muestran según `tenant_modulos` y el rol.** Un grupo sin opciones visibles no aparece.
- **Los grupos se pliegan y despliegan**, y se recuerda el estado por usuario.
- **Hay un modo colapsado de solo íconos**, con el nombre al pasar el cursor.
- **En pantallas angostas el menú es un cajón** que se abre con un botón.
- **La opción activa es clara:** fondo suave del color primario y texto en el tono oscuro del primario.

**Barra superior:**
- La ruta de la pantalla (por ejemplo, "Comercial › Inventario").
- El buscador con la paleta Ctrl K que ya existe.
- **Una sola campana** de notificaciones (se corrige la duplicada de Casos).
- El menú del usuario con su nombre, su rol y "Cerrar sesión".

**Navegación dentro de un módulo:**
- **Desaparecen los encabezados "← Volver".**
- Una pantalla hija lleva un enlace al padre dentro de la página (por ejemplo, "← Catálogo" en la ficha de un producto), además de la ruta.
- La regla de la guía sigue vigente: toda pantalla es accesible desde el menú, desde la barra de su sección o desde una acción de la pantalla padre.

## 2. Tokens y tema por clínica

**Tokens:**
- Todo color, radio, sombra y tipografía sale de variables CSS.
- Los colores escritos a mano que aparecieron en el relevamiento pasan a tokens.
- **Tipografía: Manrope** (cargada localmente o con `font-display: swap`, sin bloquear el render), con la fuente del sistema como respaldo.

**Lo que la clínica configura:**
- **Color primario.** De él se derivan automáticamente los tonos de hover, el fondo suave, el texto sobre fondo suave y el tono oscuro para texto. No se le piden cinco colores al usuario.
- **Logo** en PNG, JPG o WebP, con límite de tamaño y de dimensiones. SVG solo si se sanitiza en el servidor; si no, no se acepta SVG. Se guarda con el almacenamiento de archivos que ya existe, aislado por tenant.
- **Tema predefinido:**
  - "Marca de la clínica", la dirección C, que es el predeterminado;
  - "Sereno", la dirección A: franja y menú azul marino, sobrio;
  - "Vibrante", la dirección B: menú índigo, más color.

  Los tres comparten estructura y componentes; solo cambian los tokens.
- **Modo claro.** Los tokens se organizan para que un modo oscuro sea posible después, pero el modo oscuro **no se construye ahora**.

**Lo que no se configura:**
- Los colores de estado: éxito, aviso, error e información.
- La paleta de datos de 10 colores de la guía (sección 4.1) y el color de cada línea de negocio. Un gráfico o una alerta se tiene que leer igual en cualquier clínica.
- Los colores por módulo de los íconos.

**Contraste:**
- El sistema verifica el color primario contra el texto blanco con WCAG AA (4,5:1 para texto normal).
- Si no cumple, se oscurece automáticamente lo justo para cumplir, y la pantalla de configuración avisa "Ajustamos el tono para que el texto se lea bien" mostrando el color original y el ajustado.
- Lo mismo vale para el texto oscuro sobre el fondo suave.
- Ninguna combinación de configuración puede producir texto ilegible.

**Datos:**
- El tema se guarda por tenant, en la tabla de configuración de la clínica que ya exista o en una tabla nueva.
- Si la tabla es nueva: RLS forzado, `ON DELETE CASCADE` al tenant, y migración en `schema_migrations`.
- Sin configuración, la clínica recibe el tema "Marca de la clínica" con el primario por defecto `#0F766E`.
- Medicavet queda así hasta que se cargue su logo y su color real.

**Carga del tema:**
- El tema viaja con la configuración de la sesión del tenant.
- Para que no haya destello del tema por defecto al cargar, se guarda en `localStorage` por tenant y se aplica antes del primer render.
- Si al llegar la configuración del servidor resulta distinta, se actualiza.

**Pantalla de configuración:**
- Ruta: Administración › Clínica y usuarios › Apariencia. Solo para el rol administrador.
- Tiene:
  - el selector de color, con muestras sugeridas;
  - la carga del logo;
  - el selector de tema predefinido;
  - una vista previa en vivo de una pantalla real: menú, franja, indicadores y una tabla;
  - "Restablecer al predeterminado".
- Los cambios se aplican a todos los usuarios de la clínica al guardar.

## 3. Patrón de encabezado de pantalla

Un componente `PageHeader` común con dos variantes:

**Completa** (listados, dashboards, Caja, Agenda):
- Una franja del color primario con título, subtítulo y acciones.
- **Una sola acción principal**, en botón blanco con el texto del color primario. Las secundarias van con borde translúcido.
- Debajo, la tira de indicadores (`KpiCard`) superpuesta al borde inferior de la franja.

**Compacta** (expediente, atención, emisión de comprobantes, formularios largos):
- Una franja baja con título, contexto (por ejemplo, paciente y propietario en el expediente) y acciones.
- Al hacer scroll queda fija como una barra delgada.

El ícono del módulo lleva el color del módulo.

## 4. Componentes

Se ajustan o crean los componentes, y luego se aplican en todo el sistema:

**KpiCard:**
- ícono con fondo suave del color del módulo o del estado; etiqueta; valor grande; línea de contexto; acción opcional ("Pedir", "Revisar", "Ver lotes").
- **Es clicable:** filtra la lista de la misma pantalla o lleva a la pantalla que corresponde.

**Tabs:**
- Reemplazan las filas de botones que en realidad son secciones de un módulo.
- En Inventario: Catálogo, Movimientos, Kardex, Toma física, Compras, Precios, Servicios.
- Alertas y Aprobaciones quedan como indicadores con contador junto a las pestañas.
- La pestaña activa queda en la URL, así que recargar no pierde el lugar.

**Botones:** un solo primario por vista; secundarios con borde; destructivos en rojo y con confirmación. Altura mínima de 44 px.

**Badges:** un solo componente con las variantes de estado y de color de datos, con un punto opcional. Reemplaza los badges sueltos que haya.

**Tablas:**
- ícono o avatar en la primera columna donde aporta (producto por categoría, paciente por especie, cliente por iniciales);
- números alineados a la derecha con su encabezado también a la derecha;
- barra de existencia contra el mínimo en Inventario;
- fila con hover;
- acciones de la fila en un menú "⋯";
- desplazamiento horizontal dentro de la tarjeta en pantallas angostas.

**EmptyState:** ícono, mensaje útil y una acción ("No hay casos con estos filtros", con "Limpiar filtros"). Nunca un renglón suelto.

**Controles segmentados** (duración, prioridad): la opción elegida va rellena del color primario o de su color de estado, con un ✓. Que se distinga a simple vista.

**Modal:**
- encabezado fijo arriba, con título y botón de cerrar; pie fijo abajo, con las acciones;
- el contenido se desplaza en medio;
- el título nunca queda cortado.

**Selector de paciente en formularios:** tarjetas con ícono de especie, nombre y datos, como en la maqueta.

## 5. Aplicación a las pantallas

Todas las pantallas del relevamiento migran al marco, los tokens y los componentes nuevos. Orden de prioridad:

1. Caja
2. Inventario y sus subpantallas
3. Facturación electrónica
4. Agenda y el modal de cita
5. Pacientes
6. Propietarios
7. Casos y casos sin actividad
8. Lo que exista del expediente
9. Las pantallas de administración

**Indicadores por pantalla.** Se calculan con datos reales; si un indicador requiere un endpoint nuevo, es una sola consulta agregada que respeta RLS. **Un indicador sin datos que lo respalden se omite; no se inventa.**

- **Inventario:** valor del inventario a costo; productos bajo el mínimo; productos con lotes que vencen en 60 días o menos; ajustes por aprobar.
- **Caja:** franja con el estado de la caja, quién la abrió y a qué hora, lo cobrado hoy en grande, la cantidad de cobros y la cantidad de facturas y de tiquetes. Una tarjeta por medio de pago: efectivo colones, efectivo dólares (con su equivalente en colones), tarjeta (datáfono BAC), SINPE Móvil y otros. Cada una con monto y cantidad de cobros.
- **Caja, cuentas abiertas:** paciente y propietario, cantidad de cargos con su detalle resumido, monto, antigüedad, y un badge de aviso cuando pasa de 24 horas. "Cliente sin registrar" en lugar de "sin cliente". Se corrige que aparezca "cargo(s)" sin cantidad ni monto.
- **Caja, últimos cobros:** hora, quién, monto, medio de pago como badge y tipo de comprobante como badge (Factura, Tiquete).
- **Agenda:** citas de hoy y cuántas faltan por confirmar; pacientes en sala de espera; confirmadas por WhatsApp. Las citas del calendario van coloreadas por tipo de servicio, con la paleta de datos.
- **Pacientes:** pacientes activos; vacunas vencidas o que vencen en 30 días; y cualquier otro indicador que los datos actuales respalden.

## 6. Textos

- **Trato de usted en toda la interfaz.** Se reemplaza el voseo: "No tenés" → "No tiene"; "buscá" → "busque"; "abrilos o reasignalos" → "ábralos o reasígnelos". En el filtro de médicos, "Vos" se reemplaza por el nombre del usuario con "(usted)".
- **Las enumeraciones se muestran con mayúscula inicial** mediante etiquetas de presentación ("Canino", "Macho", "Hembra esterilizada"), sin cambiar los valores guardados.
- Las fechas, los montos y los números siguen el formato de Costa Rica que ya usa el sistema.

## 7. Accesibilidad y rendimiento

- **Contraste AA** en todo texto, incluidos los grises pequeños.
- **Foco visible** en todos los controles; el menú lateral y las pestañas se recorren con teclado.
- `aria-label` en los botones que son solo ícono.
- **Ninguna biblioteca nueva de UI.** Los íconos y los gráficos siguen detrás de los componentes propios.
- Cambiar el tema no re-renderiza la aplicación: solo cambian variables CSS.

## 8. Verificación

Según la sección 12 de la guía, se verifica en el navegador, clic a clic:

- **Cada fila del relevamiento**, marcada como verificada: la acción existe y funciona en el marco nuevo.
- **Cada pantalla recorrida con los tres temas predefinidos** y con dos colores primarios extremos: un amarillo muy claro (que obliga a corregir el contraste) y un casi negro. Se confirma que todo se lee.
- **Que la configuración de apariencia de una clínica no afecte a otra.** Se prueba con dos tenants.
- **Que la recarga no muestre destello del tema por defecto.**
- **El menú en pantalla angosta** (cajón) y en modo colapsado.
- **Capturas antes y después** de las pantallas principales en `docs/diseno/capturas/`.
- **Que las pruebas existentes pasen.**

## 9. Entrega

El informe incluye:

- las pantallas nuevas (Apariencia) y las migradas, cada una con su camino de clics;
- el estado de la lista de control del relevamiento;
- las decisiones tomadas donde la maqueta chocó con una funcionalidad;
- los indicadores omitidos por falta de datos;
- lo que quedó pendiente.

Este trabajo no se detiene a preguntar. Se detiene solo ante:
- una contradicción con la guía o con una funcionalidad existente que no tenga solución obvia;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
