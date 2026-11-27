# Vetline Clinic — 04 · Administración base

Rama: `vetline-clinic/04-administracion-base`, que parte del último punto que contenga todo lo construido (01c, 07c, anexo del 07 y el 03, 08b/09b). Se rige por `vetline-clinic-00-guia-rectora.md`: sección 8.1 para el contenido y sección 12 para la forma de trabajo.

## Por qué existe

Para que Medicavet use el sistema todos los días hace falta que cada persona entre con lo que le corresponde. Hoy solo existen dos roles, médico y administrador, así que la recepcionista tendría que entrar como una de las dos cosas. También falta un lugar único donde configurar la clínica y sus políticas. Además, hay un defecto conocido: **un médico desactivado sigue entrando**.

**Fuera de alcance** (van en el 11): turnos y personal, honorarios y comisiones, cumplimiento y libro de controlados, auditoría consultable y procedimientos.

## 0. Relevamiento

El informe parte de una tabla con lo que ya existe y dónde, para reutilizarlo y no duplicarlo:

- **Usuarios y roles:** cómo se resuelve hoy un rol (base, token o Keycloak); cómo funciona el flujo de invitación; qué pasa al desactivar a alguien.
- **Configuración que hoy vive dispersa:**
  - datos fiscales y emisor, sucursal y terminal (en el facturador del 09a);
  - salas, horarios y tipos de cita (en la agenda de Vetline Ai);
  - numeraciones (expediente, presupuestos, recibos);
  - la apariencia del 01c;
  - las políticas que crearon el 03 (tope de mensajes) y el 08b (topes de descuento por producto y por rol).
- **Cada chequeo de permisos del frontend y del backend**, y si se resuelve desde la base o desde el token.

Lo que ya exista se **mueve o se enlaza** al lugar nuevo. No se crea una segunda copia: una sola fuente de verdad (sección 2 de la guía).

## 1. Roles y permisos

**Roles.** Además de médico y administrador, existen:

| Rol | Para qué |
|---|---|
| **Recepción** | Agenda, check-in, clientes y pacientes (datos no clínicos), presupuestos, mensajes al cliente |
| **Caja** | Sesiones de caja, cobros, abonos, anticipos, emisión de comprobantes, cierre |
| **Farmacia** | Venta de mostrador, inventario, recepción de compras, toma física |
| **Estética** | Grooming y sus hallazgos (con la regla del 07: el groomer registra solo grooming) |
| **Asistente técnico** | Signos y peso en el check-in, preparación del paciente; no firma ni escribe contenido clínico |
| **Contador** | Solo lectura de caja, comprobantes, cuentas y reportes; sin datos clínicos |

**Combinaciones.** Una persona puede tener **varios roles**. El caso de Medicavet es médica y administradora, y la recepcionista que también cobra tiene recepción y caja. Los permisos son la unión de sus roles.

**Matriz de permisos:**
- Los permisos se definen en la base como acciones (por ejemplo, `caja.anular`, `inventario.ajustar`, `expediente.firmar`, `catalogo.ver_costos`, `cliente.unificar`). Cada rol tiene su conjunto.
- **El permiso se resuelve siempre desde la base en cada solicitud**, nunca desde el token. El token solo identifica a la persona.
- Hay una pantalla de **matriz de roles y permisos** (Administración › Clínica y usuarios › Roles), de solo lectura para el núcleo. Una lista corta de **permisos configurables por clínica** se puede activar o desactivar por rol: ver costos y márgenes, aplicar descuentos, anular, ajustar inventario, exportar datos. Cada cambio queda auditado.
- Los permisos clínicos (escribir y firmar contenido clínico) son **fijos del rol médico** y no se configuran.

**Frontend.** El menú, los botones y las pantallas se muestran según los permisos efectivos. El backend rechaza siempre lo que el rol no permite, aunque el frontend lo muestre por error. Se verifica con pruebas que llaman a la API con cada rol.

## 2. Personas: invitar, editar y desactivar

**Invitar:**
- La pantalla Administración › Clínica y usuarios › Personas lista a todos con sus roles, su estado (invitado, activo, desactivado) y su último acceso.
- **La invitación usa el flujo existente**, que crea en un solo acto la persona en la base y en Keycloak. Se eligen sus roles y, para médicos, la especialidad y el **número de colegiado** (si el 07c ya creó el campo, se reutiliza).
- La invitación se envía por correo con `enviarEmail` (en desarrollo, el proveedor simulado), y caduca a los 7 días con opción de reenviar.

**Editar:** cambiar los roles de una persona actualiza sus permisos en su próxima solicitud, sin cerrar sesión.

**Desactivar:**
- Desactivar a una persona la desactiva en la base **y en Keycloak en el mismo acto**, y **revoca sus sesiones activas**. Su siguiente solicitud falla con 401 y el frontend la saca a la pantalla de acceso.
- Se corrige el defecto de que un médico inactivo sigue entrando, con una prueba que lo demuestre: iniciar sesión, desactivar desde otra sesión y comprobar que la primera queda fuera.
- No se puede desactivar al último administrador activo de la clínica.

**Lo que pasa con sus registros:** sus atenciones, cobros y movimientos **se conservan con su autoría**. Desactivar no borra nada. Sus citas futuras quedan señaladas para reasignar, y la pantalla lo avisa al desactivar.

**Pantalla de entrada:** la regla del 01c (según rol y módulos, elegible por el usuario) se respeta y se extiende a los roles nuevos. Recepción entra a la Agenda, caja a la Caja, farmacia a Inventario y el contador a Facturación electrónica.

## 3. Configuración de la clínica

Un solo lugar, Administración › Clínica y usuarios, con secciones:

- **Datos de la clínica:** nombre comercial, logo y apariencia (los del 01c, enlazados), teléfono, correo, dirección codificada (provincia, cantón, distrito), horario de atención para mostrar al cliente.
- **Datos fiscales:** el emisor o los emisores del facturador, con su identificación, actividades económicas, llave criptográfica y sucursal y terminales. **Se enlaza a la configuración del 09a/09b, no se duplica.** Esta sección muestra el resumen y lleva a la del facturador.
- **Salas y recursos.** El backend ya tiene la API de salas (`salas.routes.ts`: listar, crear, editar y desactivar) y la agenda las lee, pero **ninguna pantalla permite crearlas**: la agenda muestra "Sin salas configuradas" y no hay dónde configurarlas. Se construye la pantalla Administración › Clínica y usuarios › Salas y equipos, reutilizando esa API y extendiéndola:
  - **Dos clases de recurso:** **salas** (consultorio, quirófano, sala de grooming, laboratorio, hospitalización) y **equipos** que se reservan (endoscopio, ultrasonido, rayos X, máquina de anestesia). Cada uno con nombre, tipo, color, capacidad (cuántas citas simultáneas admite, normalmente 1) y horario propio si difiere del de la clínica. Los equipos pueden ser compartidos con otra clínica o profesional externo, con una nota.
  - **Recursos que exige cada tipo de cita:** por ejemplo, una cirugía requiere el quirófano y la máquina de anestesia, y una endoscopía requiere el endoscopio. Al agendar, la agenda los propone y **no permite reservar dos veces el mismo recurso a la misma hora**, salvo con un permiso explícito, que queda registrado.
  - La agenda muestra la ocupación por sala y por equipo (filtro que ya existe) y el 12 la usa para la ocupación.
  - Desactivar un recurso no borra su historia y avisa si tiene citas futuras.
- **Horarios y bloqueos:**
  - horario semanal de la clínica y de cada médico, con excepciones (feriados de Costa Rica precargados y editables, vacaciones, bloqueos puntuales);
  - **la agenda los respeta:** no se puede citar fuera de horario ni en un bloqueo sin un permiso explícito, que queda registrado.
  - La disponibilidad que bloquea y la sincronización con Google Calendar son del 05. Aquí se definen los datos que el 05 usará.
- **Tipos de cita:** nombre, duración predeterminada, color, sala sugerida, línea de negocio y servicio del catálogo asociado (para precargarlo en la atención). Si ya existen, se completan.
- **Numeraciones:** expediente, presupuestos, recibos y anticipos, con prefijo y siguiente número. Los consecutivos de Hacienda **no se editan aquí**: los controla el facturador.

## 4. Políticas

**Una tabla de políticas por clínica**, con su valor, su descripción y su historial, que **todos los módulos consultan** con una sola función (`politica(clave)`, con caché invalidada al cambiar). Si el 03 o el 08b crearon tablas o columnas propias para sus topes, se migran aquí y sus módulos pasan a leer de aquí.

Políticas iniciales:
- **Descuento máximo sin autorización, por rol.** Los topes por producto del 08b siguen en el producto, y vale el menor de los dos.
- **Margen mínimo**, que el análisis del 10 usará para alertar.
- **Tope de mensajes promocionales** por cliente y período (el del 03).
- **Umbral de aviso de stock** por defecto, para productos sin mínimo propio.
- **Vigencia de presupuestos** (la del 08b).
- **Anulación:** quién aprueba y plazo máximo.
- **Autonomía del agente por tipo de acción** (el 16 la usará): solo se crea la política con su valor más restrictivo.

Pantalla: Administración › Políticas, con cada política, su valor, quién la cambió y cuándo. **Cada cambio queda auditado**: valor anterior, valor nuevo, quién y cuándo.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador:

- invitar a una recepcionista con los roles de recepción y caja, aceptar la invitación (correo simulado) y entrar: ve la Agenda y la Caja, no ve el expediente clínico ni los costos, y la API le rechaza una anulación y la escritura clínica;
- dar a una persona los roles de médico y administrador;
- desactivar a un médico con sesión abierta y comprobar que queda fuera de inmediato;
- configurar un horario con un feriado y comprobar que la agenda no permite citar ahí sin el permiso;
- cambiar el tope de descuento de un rol y comprobar que caja lo respeta en el siguiente descuento;
- ver el historial de esa política.

Se prueba también un tenant solo con Vetline Ai: sus médicos y administradores funcionan igual que antes.

El informe incluye la tabla del relevamiento, la matriz final de roles y permisos, las pantallas nuevas con su camino de clics, las migraciones (con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant) y qué se movió desde otros módulos.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
