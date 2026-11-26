# Contrato del proveedor de mensajería

Este documento es lo que hace falta para conectar un proveedor real —Converza— **sin tocar el CRM**.
Lo escribe el prompt 03; la conexión real va en un prompt aparte.

Hoy hay una sola implementación, `MensajeriaSimulada`, en
`backend/src/crm/mensajeria.ts`. Es la que usan los verificadores y la demostración.

---

## 1. La interfaz de salida

```ts
export interface MensajeAEnviar {
  canal: "correo" | "whatsapp";
  /** El teléfono o el correo del destinatario, ya validado por el CRM. */
  destino: string;
  texto: string;
  /** Opcional: para que el proveedor pueda correlacionar la respuesta. */
  referencia?: string;
}

export interface ResultadoProveedor {
  entregado: boolean;
  /** El identificador del proveedor. Se guarda en `crm_mensajes`. */
  proveedorMensajeId?: string;
  /** Si no se entregó: por qué, en una frase que una persona pueda leer. */
  error?: string;
}

export interface ProveedorMensajeria {
  nombre: string;
  enviar(m: MensajeAEnviar): Promise<ResultadoProveedor>;
}
```

Para conectar el proveedor real:

```ts
import { usarProveedorMensajeria } from "./crm/mensajeria";
usarProveedorMensajeria(new MensajeriaConverza(/* credenciales */));
```

No hay nada más que cambiar. El CRM ya resolvió, antes de llamar a `enviar`, **todo** lo que no es
del proveedor:

- el consentimiento para ese canal y esa finalidad;
- que la mascota no esté fallecida;
- que el dato de contacto exista y tenga forma válida;
- la franja horaria (y si está fuera, reprograma en vez de descartar);
- el tope de mensajes promocionales del mes;
- la ventana de duplicados.

**El proveedor no decide nada de eso.** Su única responsabilidad es entregar el texto y decir si
pudo.

### Qué NO debe hacer el proveedor

- **No reintentar solo.** Un reintento que el CRM no ve es un mensaje que no se cuenta para el tope
  ni para la ventana de duplicados. Si hace falta reintentar, se resuelve en el CRM.
- **No armar el texto.** El contenido lo decide quien manda el mensaje; el proveedor transporta.
- **No consultar la base.** La interfaz recibe todo lo que necesita por parámetro.

---

## 2. La entrada de respuestas

Las respuestas del cliente entran por una sola puerta:

```
POST /api/crm/respuestas
{ "canal": "whatsapp", "remitente": "+50688887777", "texto": "BAJA" }
```

o, desde el backend, por `recibirRespuesta(db, tenantId, { canal, remitente, texto })`.

Lo que hace el CRM con eso:

1. **Identifica al cliente** por el teléfono (comparando solo los dígitos) o por el correo. Si no lo
   reconoce, **la respuesta se guarda igual**: un mensaje de alguien que no está en la base es
   justamente lo que hay que poder ver.
2. **Si el texto es una palabra de baja** —`baja`, `stop`, `cancelar`, `no mas`, `salir`, más las
   que agregue la clínica en `crm_palabras_baja`— retira el consentimiento de **promociones** de ese
   canal, lo deja en el historial con fuente `respuesta_cliente` y le confirma al cliente.
   El consentimiento de **salud** no se toca: nadie que escribe «baja» está renunciando a que le
   avisen de la vacuna de su perro.
3. **Registra la respuesta en la línea de tiempo** (`mensaje_respondido`).

Cuando Converza se conecte, su webhook tiene que:

- autenticarse (la forma queda para el prompt de la conexión: firma HMAC o token de servicio);
- resolver el `tenantId` —un webhook no trae sesión de usuario—;
- llamar a este mismo punto. **No** debe escribir en las tablas del CRM por su cuenta.

---

## 3. Lo que el CRM guarda de cada mensaje

En `crm_mensajes`, una fila por intento, salga o no:

| Columna | Qué guarda |
| --- | --- |
| `canal`, `finalidad`, `tipo` | Por dónde, para qué y qué clase de mensaje |
| `estado` | `enviado`, `fallido`, `bloqueado` o `reprogramado` |
| `motivo` | Por qué no salió, en lenguaje de persona |
| `reprogramado_para` | Cuándo se puede volver a intentar, si fue por la franja horaria |
| `proveedor_mensaje_id` | El identificador del proveedor |
| `correo_enviado_id` | El correo, cuando el canal fue correo: **el contenido vive ahí** |

**Un mensaje bloqueado también se guarda.** El día que alguien pregunte «¿por qué no le avisaron?»,
la respuesta tiene que estar en algún lado.

---

## 4. El simulado, y por qué decide por el destino

`MensajeriaSimulada` no es aleatoria: un destino que contiene `falla` falla, y cualquier otro se
entrega con un identificador reproducible (`sim-wa-1`, `sim-mail-2`…).

Un proveedor de prueba que decidiera al azar haría que un verificador pase hoy y falle mañana sin
que nada haya cambiado, que es la peor clase de verificador.

---

## 5. Lo que queda para el prompt de la conexión real

- Las credenciales por clínica y dónde se guardan (el repo ya tiene el patrón de
  `fact_credenciales` y de las credenciales de pasarela por país).
- La autenticación del webhook entrante.
- Las plantillas aprobadas de WhatsApp: el canal exige plantilla preaprobada para iniciar una
  conversación, y eso cambia **qué** se puede mandar, no **si** se puede. El punto único del CRM
  seguirá contestando lo mismo.
- El reintento y la cola, si el proveedor los necesita.
