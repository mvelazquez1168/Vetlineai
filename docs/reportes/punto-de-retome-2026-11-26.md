# Punto de retome — 2026-11-26 (tarde)

Estado al pausar. **Nada fusionado a `main`.**

## 1. Dónde estoy parado

**Rama actual: `vetline-clinic/07c-atencion-y-receta`**, último commit `6ddbeb4 WIP: pausa`,
empujada al remoto.

Linaje: `01c-marco-y-tema` → `07c-atencion-y-receta`. La rama del 01c parte de `03-crm`, que
desciende de `07-expediente`, que desciende de la del 08: los cuatro prompts cerrados están
incluidos y no hizo falta rama de integración.

**El estado es consistente para dejarlo:**

- `tsc --noEmit` limpio en backend y en frontend.
- `npm run migrate` → «Nada por aplicar (117 migraciones, todas ya registradas)». Ninguna
  migración quedó a medias.
- `verificar_atencion_07c.ts` → **TODO OK** (13 secciones).
- `verificar_expediente_bloque_b.ts` → **TODO OK**.
- `verificar_rutas_unicas.ts` → 405 rutas, ninguna duplicada.
- `verificar_tema_por_clinica.ts` → 8/8.
- `verificar_envios_simulados.ts` → pasa.

---

## 2. El 01c: terminado

Rama `vetline-clinic/01c-marco-y-tema`, 7 commits, empujada. Informe completo en
`docs/reportes/marco-y-tema-2026-11-26.md` y 14 capturas en `docs/diseno/capturas/`.

Lo entregado: marco único (`AppShell` reemplaza los tres marcos de clínica, ya borrados), tema
por clínica con su pantalla de Apariencia, pantalla de Inicio, Caja e Inventario con sus
indicadores y pestañas, 37 pantallas más con el encabezado del patrón, los 19 «← Volver» sueltos
movidos dentro del encabezado, trato de usted en 30 archivos y los 38 «(s)» resueltos,
`ControlSegmentado`, la barra de existencia contra el mínimo y el ícono de especie en el listado.

### Lo que falta del 01c

1. **La pasada clic a clic de la lista de control.** En `docs/diseno/relevamiento-marco.md` están
   marcadas con `V` las **9 pantallas abiertas en el navegador**. Las demás están verificadas
   **por diferencia** (la migración tocó encabezado y navegación, nunca el cuerpo; el diff lo
   muestra), que no es lo mismo.
2. **El selector de paciente en tarjetas** del modal de cita: sigue siendo una lista.
3. **El menú «⋯» de fila** solo está donde ya estaba (catálogo, movimientos).

---

## 3. El 07c: a medias

### Terminado y verificado (backend)

| Qué | Dónde |
|---|---|
| `inv_productos.tipo_clinico` + protocolos preventivos + receta atada a la atención + histórico + estudio con cargo | `backend/src/migrations/115_atencion_acciones_y_receta.sql`, `116_protocolos_preventivos_de_fabrica.sql` |
| **Defecto real corregido**: borrar una presentación rompía la línea de receta y bloqueaba el borrado (y la purga) | `117_la_receta_sobrevive_al_catalogo.sql` |
| Filtro por tipo clínico, lotes en orden FEFO, próxima fecha del protocolo, histórico, estudio | `backend/src/expediente/preventivos.ts` |
| Receta: dosis por kilo con su explicación, cantidad total, indicaciones generadas, dispensar/no dispensar, repetir, medicación activa | `backend/src/expediente/receta.ts` |
| PDF de la receta (reusa `generarPdfReceta`) y envío con `emitirNotificacion` | `backend/src/expediente/recetaPdf.ts` |
| Resumen del cierre y firma de la receta al cerrar | `backend/src/expediente/atencion.ts` |
| 16 rutas nuevas | `backend/src/routes/expediente.routes.ts` |
| Verificador de 13 secciones | `backend/src/scripts/verificar_atencion_07c.ts` |

También se trajo acá, con `git cherry-pick 6ae9df4`, el modelo y los catálogos clínicos que
estaban en pausa en la rama del anexo (migraciones **111** y **112** y
`backend/src/expediente/catalogosClinicos.ts`): el prompt 07c dice que los catálogos de receta se
construyen acá y el anexo los da por hechos. **Cuando se retome `07-anexo-digital-vet` hay que
tener esto en cuenta: su commit `6ae9df4` ya está incluido en 07c.**

### A medias (frontend)

Compila y no rompe nada, pero **no está verificado en el navegador**:

| Archivo | Estado |
|---|---|
| `frontend/src/components/expediente/AccionesClinicas.tsx` | **Nuevo.** Modal de vacuna/desparasitación, modal de estudio, panel de receta y resumen del cierre. Escrito completo, sin abrir nunca en el navegador. |
| `frontend/src/components/expediente/AtencionActual.tsx` | Las 7 acciones con sus atajos, el examen por sistemas con color de estado y «Todo normal», el resumen del cierre. El campo «¿Es un preventivo?» ya no está. |
| `frontend/src/lib/expedienteApi.ts` | Los 14 métodos nuevos y sus tipos. |
| `frontend/src/components/expediente/PestanasExpediente.tsx` | Solo se le pasó la especie del paciente. **Falta todo lo de la sección 4 del prompt.** |

### Lo que falta del 07c

1. **Sección 4 completa** — las pestañas de historia (Vacunas, Desparasitaciones, Prescripciones,
   Laboratorio) no dicen dónde se registra cada cosa, no tienen **«Registrar histórico»** (el
   backend ya lo soporta: `POST /expediente/pacientes/:id/preventivo-historico`) y no tienen el
   estado vacío para quien no es médico.
2. **Imprimir y enviar la receta desde la pantalla**: las rutas existen
   (`GET …/receta.pdf`, `POST …/receta/enviar`), ningún botón las llama.
3. **La medicación activa en la cabecera del expediente**: el endpoint existe, la cabecera no lo
   usa.
4. **Toda la verificación en el navegador** con `demo.medico`, que es el punto «Verificación y
   entrega» del prompt: la atención de Toby con vacuna, desparasitación, receta de dos líneas,
   estudio, cierre, caja, inventario por lote, PDF, medicación activa, repetir receta y registro
   histórico.
5. **El informe del 07c**, incluido el relevamiento extremo a extremo que pide su sección 0.

### Una decisión del 07c que hay que revisar

El prompt pide atajos **F2…F8**. No alcanzan: el navegador ya usa F1, F3, F5, F7, F10, F11 y F12,
y quedan cinco libres para siete acciones. Se eligió **Alt+letra** para las siete (Alt+S servicio,
Alt+P producto, Alt+V vacuna, Alt+D desparasitación, Alt+R receta, Alt+E estudio, Alt+C cerrar),
porque un juego mitad teclas de función y mitad Alt no se recuerda. Queda anotado como el prompt
pide, y se puede cambiar.

---

## 4. Los hallazgos pendientes

| # | Hallazgo | Estado |
|---|---|---|
| 1 | **Pantalla de entrada por rol y por módulos** | **Hecho.** `frontend/src/lib/pantallaDeEntrada.ts` la deriva del rol y de `tenant_modulos`; sin módulos de gestión el médico sigue entrando a `/workspace`. Cada usuario la puede elegir (`personas.pantalla_inicio`, migración 114). |
| 2 | **Tenant solo con Vetline Ai** | **Hecho y verificado.** Usuario `qa.soloai01c@test.local` en «Clínica Veterinaria San Martín 2» (cero módulos): aterriza en `/workspace` con su chrome de siempre, sin opciones de gestión y sin grupos vacíos. Captura `docs/diseno/capturas/10-clinica-solo-vetline-ai.png`. |
| 3 | **Indicador «Vencen en 60 días»** | **PENDIENTE, y es un defecto real.** En el catálogo hay un lote que vence el 25 dic 2026 —dentro de los 60 días desde hoy— y el indicador dice **0**. Las dos consultas (`/inicio/indicadores` y `/inventario/resumen`) filtran `cantidad > 0 AND vencimiento <= CURRENT_DATE + 60`; hay que revisar si ese lote tiene existencia en `inv_lotes` o si la fecha mostrada en la tabla sale de otro lado. **No lo investigué: queda abierto.** |
| 4 | **Orden de las pestañas bajo la franja** | **PENDIENTE.** En Caja e Inventario las pestañas del módulo quedaron **arriba** de la franja de color, no debajo. Funciona y se ve ordenado, pero no es lo que pide el patrón: la franja es el encabezado de la pantalla y las pestañas son del módulo. Hay que decidir cuál va primero y aplicarlo en los dos. |
| 5 | **Correo simulado en desarrollo** | **Hecho.** `backend/src/entorno.ts` + `email.ts`: en local ningún mensaje sale por un proveedor real salvo que se ponga `ENVIOS_REALES=1` a propósito. Verificado por `verificar_envios_simulados.ts`. |
| 6 | **Prueba de rutas duplicadas** | **Hecho.** `verificar_rutas_unicas.ts` recorre el árbol de Express; 405 rutas, ninguna repetida con el mismo método. Es lo que evita que vuelva a pasar lo de `/cerrar`. |

### Otros avisos del ambiente

- **`ts-node-dev` no recarga solo en Windows + Docker.** Pasó cuatro veces: hay que
  `docker compose restart backend` después de cada cambio de backend, y tarda ~1 minuto.
- **Tailwind tampoco relee su configuración** sin reiniciar el contenedor del frontend.
- **La base es compartida.** Otra sesión (`demo.facturacion@…`) cambió el color de la clínica de
  demostración a `#720AB8` mientras se verificaba el 01c.
- A pedido explícito se restableció la contraseña de `demo.medico@vetlineai-test.com` a
  `DemoMedico-01c!` **en el Keycloak local**. Usuarios desechables creados para verificar:
  `qa.marco01c@test.local` / `Qa-Marco-01c!` y `qa.soloai01c@test.local` / `Qa-SoloAi-01c!`.

---

## 5. El orden de la cola

1. **01c** — terminado salvo los tres puntos de §2.
2. **07c** — en curso; falta lo de §3.
3. **Anexo del 07 y del 03** (`docs/prompts/vetline-clinic-07-03-anexo-relevamiento-digital-vet.md`)
   — se retoma la rama `vetline-clinic/07-anexo-digital-vet`, que quedó en pausa en `6ae9df4`,
   **dando por hechos los catálogos de receta que el 07c ya construyó** (y teniendo en cuenta que
   ese mismo commit ya fue traído a 07c).
4. **08b/09b** (`docs/prompts/vetline-clinic-08b-09b-complemento-caja-y-facturador.md`).
