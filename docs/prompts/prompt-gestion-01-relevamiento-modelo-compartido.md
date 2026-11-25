# Prompt Gestión 01 — Relevamiento del modelo compartido en Vetline Ai

## Contexto
Vamos a construir **Vetline Clinic**, un proyecto separado, en un repo propio y con el mismo stack, que contiene los módulos de gestión administrativa de la clínica: expediente clínico, agenda y recepción, clientes, ventas y caja, inventario y farmacia, compras, servicios y precios, facturación electrónica de Hacienda, marketing, reportes y un agente de IA administrativo.

Este proyecto y Vetline Ai van a funcionar como **un solo sistema**, con la misma experiencia de usuario:
- comparten la **misma base de datos**, el **mismo Keycloak** y la **misma configuración de Resend**;
- se despliegan en la **misma instancia**;
- **pacientes, propietarios (clientes) y médicos se crean desde el expediente clínico** del proyecto nuevo, y Vetline Ai los lee de forma natural porque son las mismas tablas;
- la **agenda es una sola**: la que ya existe en Vetline Ai;
- los **casos de Vetline Ai** se ven como complementos del expediente clínico del paciente (el paciente es el eje, la cita es la visita y el caso es el episodio diagnóstico).

Antes de diseñar nada necesito saber con exactitud qué existe hoy.

## Resultado esperado
Que exista el documento `docs/relevamientos/modelo-compartido-gestion.md` con el estado **actual** de Vetline Ai en cada uno de estos puntos. Cada afirmación debe citar el archivo, la migración o el endpoint de donde sale.

1. **Entidades maestras:** tablas, columnas clave, restricciones y relaciones de tenants, personas, staff y médicos, propietarios, pacientes, citas, cuidados preventivos y casos (incluida su relación con paciente y cita). Qué migración crea y modifica cada una.
2. **Quién crea cada entidad hoy:** pantallas, endpoints y servicios que dan de alta y editan propietarios, pacientes, médicos y citas. Cómo es el alta de usuarios con Keycloak (las dos mitades y su vínculo) y qué pasa si se crea solo una.
3. **Agenda:** el modelo de citas, su máquina de estados, las pantallas (web y móvil), los avisos que dispara y las reglas de disponibilidad.
4. **Keycloak:** realm, clientes, roles y cómo se mapean a permisos en el backend y en el frontend.
5. **Multi-tenant:** cómo se aísla cada tenant (withTenantClient, RLS u otro) y qué tendría que respetar un segundo backend que escriba en las mismas tablas.
6. **Habilitación por tenant:** el mecanismo actual para activar capacidades por clínica (por ejemplo tenant_agentes) y si sirve como patrón para habilitar los módulos de gestión solo a ciertos tenants.
7. **Resend y notificaciones:** dónde vive la configuración, el punto único de envío, las plantillas con la marca del comercio y la emisión de notificaciones.
8. **Despliegue:** composición de producción, Caddy, imágenes, variables de entorno, migraciones (migrate:prod) y sembrado, y qué haría falta para que un segundo servicio conviva en la misma instancia.
9. **Ficha del paciente y expediente:** qué existe hoy de la ficha del paciente y del expediente longitudinal, y qué quedó solo diseñado.
10. **Sistema de diseño y patrones de UX:** los módulos nuevos deben verse y comportarse exactamente como Vetline Ai, sin divergencias. Documentá la librería de componentes y dónde vive, los tokens (paleta de marca, tipografía, espaciados, radios, sombras), el layout (navegación lateral, encabezados, área de trabajo, paneles), y los patrones de listas con filtros, formularios, validación y mensajes de error, modales y confirmaciones, estados vacíos, carga, avisos y toasts, tablas, paginación y comportamiento móvil. También los textos e íconos recurrentes y la convención de nombres de acciones. Señalá qué conviene extraer a un paquete compartido para que los dos repos usen los mismos componentes en lugar de copiarlos.
11. **Riesgos de compartir la base entre dos repos:** dónde hoy hay lógica de negocio en el backend (no en la base) que un segundo escritor podría saltarse; por ejemplo validaciones, saneo de correos, máquinas de estado o efectos secundarios.

## Reglas
- **Solo lectura:** no modifiques código, migraciones ni datos, y no ejecutes nada contra producción.
- Lo que no encuentres, márcalo como "no encontrado" con dónde buscaste. No lo asumas.
- Los hallazgos van al documento, **no los conviertas en tareas ni en cambios**.
- Si algo contradice el contexto de arriba (por ejemplo, que la agenda no exista como creo), señálalo al principio del documento.

## Al terminar
Un resumen de 10 líneas como máximo, con las tres cosas que más condicionan el diseño del proyecto nuevo.
