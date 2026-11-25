# Vetline Clinic 01b + 02 — Sesión nocturna

Sesión **sin supervisión**: nadie va a responder preguntas hasta mañana. Rige la guía rectora
(`docs/prompts/vetline-clinic-00-guia-rectora.md`) y la fuente de verdad sigue siendo
`docs/relevamientos/modelo-compartido-gestion.md`.

## Reglas de la sesión

- Tres bloques, en este orden. Cada uno se construye, se verifica y se commitea por separado, con
  un mensaje claro, y se hace push al repositorio privado como respaldo. **No se despliega nada ni
  se toca producción.**
- No se pide confirmación. Si un bloque llega a una contradicción con el código, a una decisión
  irreversible sobre datos existentes o a un trabajo mucho mayor al supuesto: se detiene **ese
  bloque**, se deja el repositorio en estado consistente (sin cambios a medias commiteados) y se
  sigue con el siguiente bloque si no depende de él.
- Antes de creerle a una medición, verificar que el código nuevo está dentro del contenedor.
- Un verificador tiene que fallar contra el defecto antes de que le creamos el visto bueno.
- Al terminar, todos los scripts `verificar_*` existentes siguen pasando. Si alguno falla, se
  reporta qué cambio lo rompió.
- El reporte final va a `docs/reportes/sesion-nocturna-2026-11-25.md`: lo construido por bloque,
  lo verificado con su resultado, lo que no se pudo y por qué, las decisiones que tomaste solo, y
  lo que queda para que yo decida.

---

## Bloque A — 01b: la respuesta sale después del COMMIT

**El defecto.** `withTenantClient` sostiene la transacción durante toda la request y la confirma
después de enviar la respuesta. Un 201 llega al cliente antes del `COMMIT`, así que una operación
inmediata sobre la fila recién creada no la encuentra (reproducido en el prompt 01: `POST` seguido
de `PATCH` da 404). El flujo central de Vetline Clinic hace justo eso: "Guardar y agendar cita"
crea el paciente y en el mismo segundo agenda una cita con él.

**Resultado que tiene que existir:**

- Ninguna respuesta exitosa llega al cliente antes de que su transacción esté confirmada. Si el
  `COMMIT` falla, el cliente recibe un error, no un éxito.
- La solución vive en **un solo lugar** (el middleware o el punto único de cierre), no repartida en
  las rutas. Ninguna ruta tiene que acordarse de nada.
- Cubre todas las formas de responder que usa el backend: JSON, envío de archivos y descargas,
  respuestas vacías (204) y redirecciones. Relevá cuáles se usan antes de elegir el mecanismo.
- Convive con `req.cerrarTransaccion()` y `conAlcanceTenant()`: una ruta que ya confirmó antes de
  una llamada externa no se confirma dos veces ni falla al responder.
- El pool de staff de plataforma (sin `set_config`) sigue funcionando igual.

**Verificación:**

1. Antes del arreglo: un script que haga `POST` de un paciente y de inmediato `PATCH` o `GET` por
   el id devuelto, en bucle (al menos 50 veces), y **falle** reproduciendo el 404.
2. Después del arreglo: el mismo script pasa las 50 veces.
3. Un caso de `COMMIT` fallido forzado (por ejemplo, una restricción diferida que falla al
   confirmar) devuelve error al cliente y no deja datos.
4. Medir el tiempo de respuesta de una ruta simple antes y después, para confirmar que no hay
   regresión apreciable.

Si al relevar aparece una forma de responder que el mecanismo no puede cubrir sin reescribir rutas,
cubrí todas las demás, listá esas rutas en el reporte y no las reescribas.

---

## Bloque B — Decisiones sobre el reporte del 01

1. Los valores viejos de `pacientes.sexo` vienen del seed de desarrollo, no de datos clínicos:
   ningún endpoint escribía esa columna. Que en desarrollo queden normalizados ('Macho' → macho;
   'Hembra' → hembra; 'Macho castrado' → macho + `estado_reproductivo` castrado), que `seed.ts`
   escriba ya en el formato nuevo, y que el CHECK de sexo quede validado (`VALIDATE CONSTRAINT`).
   Que exista un script **de solo lectura** para correr en producción antes del despliegue, que
   liste cualquier valor de `sexo` fuera de `macho|hembra|NULL`. No se corre en producción: queda
   listo para mañana.
2. Que `frontend/vite.config.js` y `vite.config.d.ts` dejen de estar versionados y queden en
   `.gitignore`, con la configuración real solo en `vite.config.ts`. Confirmá que el servidor de
   desarrollo y el build de producción leen el `.ts`.

---

## Bloque C — 02: sistema de diseño ampliado, paleta de comandos y atajos

Todo lo que se agrega va al sistema de diseño **compartido** (`frontend/src/components/ui/` y
`tailwind.config.js`), no a una carpeta de Vetline Clinic, para que Vetline Ai lo adopte sin
divergir. Seguí la sección 4 de la guía rectora.

### C.1 Deuda previa, primero

- El barrel `components/ui/index.ts` exporta los 12 componentes, no 9.
- Las 2 llamadas a `Button` con el override de tamaño muerto pasan a usar `size`.

### C.2 Íconos y gráficos

- Una librería de íconos de línea, liviana y con tree-shaking. Elegila y justificala en una línea
  en el reporte. Un componente `Icono` como única puerta, para que la librería se pueda cambiar.
- Una librería de charts para React, con el mismo criterio. Los charts se usan **solo** a través de
  componentes propios: `ChartBarras` (vertical y horizontal, apiladas o no), `ChartLinea`,
  `ChartDona`, `ChartArea`, `Sparkline`. Ninguna pantalla importa la librería directamente.
- Los charts aceptan un manejador de clic por elemento, porque el drill-down es obligatorio en
  toda la aplicación.

### C.3 Paleta de datos

- Paleta categórica de 8 colores como tokens en `tailwind.config.js`, junto a la paleta actual, con
  contraste suficiente sobre `surface` y `background`.
- **Un solo mapa** de color por línea de negocio (consulta, cirugía, hospitalización, laboratorio,
  imagen, farmacia, pet shop, grooming, hotel, vacunación), exportado desde un único archivo y
  usado por charts, badges y leyendas.
- Los semánticos (`success`, `warning`, `error`) quedan para estados. Los colores de la paleta de
  datos que deban distinguirse entre sí también difieren en luminosidad, no solo en tono.

### C.4 Componentes nuevos

Cada uno con sus props documentadas en el propio archivo, sin dependencias nuevas salvo las de C.2:

- `Pagination`, que reemplaza el patrón copiado a mano ("Mostrando X–Y de Z" + Anterior/Siguiente).
- `EmptyState` (ícono, título, texto, acción opcional).
- `LoadingState` con skeleton (líneas, tarjetas, tabla), no solo "Cargando…".
- `Modal` con prop de ancho (`sm`, `md`, `lg`, `xl`), compatible con el uso actual: los 16 usos
  existentes no cambian.
- `Toast` con proveedor y hook único (`useToast`), variantes de éxito, aviso y error.
- `KpiCard`: valor, variación contra el período anterior con flecha y color, sparkline opcional,
  clic para drill-down.
- `SelectorPeriodo`: hoy, 7 días, mes, trimestre, año, personalizado, y "comparar con el período
  anterior". Las fechas se resuelven con `formatFecha` y en la zona horaria del tenant.
- `MenuExportar` (Excel y PDF): por ahora solo el componente y su contrato; la exportación en el
  backend llega en el prompt de dashboards.

No migres pantallas existentes de Vetline Ai a estos componentes en esta sesión, salvo la ficha y
el listado de pacientes del prompt 01, que sí adoptan `Pagination`, `EmptyState` y `LoadingState`.
Los 8 modales escritos a mano quedan listados en el reporte como candidatos para migrar después.

### C.5 Paleta de comandos y atajos

- **Paleta global** con `Ctrl+K` / `Cmd+K`, disponible en todas las zonas (workspace, admin,
  agenda). Busca pacientes (nombre, número de expediente, microchip), propietarios (nombre,
  teléfono, identificación) y pantallas, y ejecuta acciones ("Nuevo paciente", "Nueva cita").
  Navegable con teclado.
- La búsqueda se resuelve en un endpoint del backend, tolerante a errores de tipeo y a acentos
  (`pg_trgm` + `unaccent`), con índices para que responda en menos de un segundo, y respetando
  tenant y permisos como cualquier otra ruta.
- **Recientes:** los últimos pacientes y pantallas visitados por el usuario aparecen primero en la
  paleta vacía.
- **Atajos de teclado** para las acciones frecuentes, con una ayuda visible al apretar `?`. No
  chocan con atajos del navegador y no se disparan mientras se escribe en un campo.
- Un único registro de atajos y acciones, que usan la paleta y la ayuda: no dos listas.

### C.6 Verificación

- Una página de muestra interna (solo en desarrollo) con todos los componentes nuevos y sus
  variantes, para revisarlos mañana de un vistazo.
- La búsqueda de la paleta encuentra "Tobi" cuando el paciente se llama "Toby", y "Mendez" cuando
  el propietario es "Méndez". Una clínica no ve resultados de otra.
- El build de producción del frontend pasa sin errores ni advertencias nuevas.
