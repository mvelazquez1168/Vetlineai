# Vetline Ai — Aprovisionamiento en AWS

Guía paso a paso. Cada paso indica qué hacer, qué esperar, y qué suele salir mal.

**Decisiones ya tomadas:** región Norte de Virginia, dirección `app.vetlineai.com`,
servidor de 4 GB, una sola instancia de base con dos bases adentro, y
almacenamiento de objetos para los adjuntos.

---

## Antes de empezar

**Confirmá la región** en la esquina superior derecha de la consola: **Norte de
Virginia**. Todo lo que crees tiene que estar ahí; los recursos de regiones
distintas no se ven entre sí.

**Y tené a mano** el archivo de entorno de desarrollo, porque varias claves se
reutilizan: Anthropic, Resend, Tilopay.

---

## Paso 1 — Par de claves para acceder al servidor

En **EC2 → Pares de claves → Crear par de claves**.

Nombre `vetline-prod`, tipo RSA, formato `.pem`.

**Se descarga una sola vez y no se puede volver a bajar.** Guardalo con el resto
de tus credenciales, no en el proyecto.

---

## Paso 2 — Grupos de seguridad

Son las reglas de quién puede conectarse a qué. **Es el paso que más problemas
causa después**, así que conviene hacerlo con cuidado.

Creá **dos** en **EC2 → Grupos de seguridad**.

### `vetline-servidor`

Reglas de entrada:

| Tipo | Puerto | Origen |
|---|---|---|
| HTTP | 80 | Cualquier lugar |
| HTTPS | 443 | Cualquier lugar |
| SSH | 22 | Mi IP |

El puerto 80 hace falta aunque todo vaya por HTTPS: es por donde se validan los
certificados.

**SSH solo desde tu IP.** Si tu conexión cambia de dirección, se actualiza la
regla — es preferible a dejarlo abierto.

### `vetline-base`

Una sola regla de entrada:

| Tipo | Puerto | Origen |
|---|---|---|
| PostgreSQL | 5432 | El grupo `vetline-servidor` |

**El origen es el otro grupo de seguridad, no una dirección.** Así solo el
servidor llega a la base, y nadie más — ni siquiera vos desde tu casa.

---

## Paso 3 — La base de datos

En **RDS → Crear base de datos**.

**Creación estándar**, motor **PostgreSQL**, versión **17**.

**Plantilla:** producción. **Identificador:** `vetline-prod`.

**Usuario maestro:** `postgres`. Generá una contraseña larga y guardala — no la
vas a poder recuperar después.

**Clase de instancia:** la más chica disponible de la familia `db.t4g`. Con 20 GB
de almacenamiento sobra: tu volcado actual pesa poco más de un megabyte.

**Conectividad:** acceso público **no**. Grupo de seguridad: `vetline-base`.

**Respaldos:** activados, retención de 7 días. Esta es la razón principal para
tener la base administrada en vez de en un contenedor.

**Cifrado:** activado.

Tarda entre cinco y diez minutos. **Cuando termine, copiá el punto de conexión** —
lo vas a necesitar varias veces.

---

## Paso 4 — Almacenamiento de objetos

Creá **dos** depósitos en **S3**. Dos y no uno con carpetas, porque tienen
políticas de acceso opuestas y una excepción dentro de un mismo depósito es un
accidente esperando.

### `vetlineai-privado`

Para adjuntos clínicos, documentos de conocimiento y exportaciones.

**Bloquear todo el acceso público: sí.** Estos archivos solo se sirven a través de
la aplicación, que verifica que el usuario pertenezca a esa clínica.

### `vetlineai-publico`

Solo para los logos de clínica, que se embeben en correos que se leen sin sesión.

**Bloquear todo el acceso público: no**, con una política que permita solo lectura.

---

## Paso 5 — Usuario para que la aplicación escriba

En **IAM → Usuarios → Crear usuario**, nombre `vetline-app`.

**Sin acceso a la consola.** Solo clave de acceso programático.

Adjuntale una política que permita **únicamente** leer, escribir y borrar objetos
en esos dos depósitos. Nada más.

**Al crearlo se muestran la clave y el secreto una sola vez.** Copialos al archivo
de entorno de producción en ese momento.

---

## Paso 6 — El servidor

En **EC2 → Instancias → Lanzar instancia**.

**Nombre:** `vetline-prod`. **Sistema:** Ubuntu Server LTS.

**Tipo:** `t3.medium` — 4 GB de memoria. Con 2 GB entra justo y Keycloak no
perdona.

**Par de claves:** `vetline-prod`. **Grupo de seguridad:** `vetline-servidor`
(seleccionar existente, no crear uno nuevo).

**Almacenamiento:** 30 GB.

### Dirección fija

**EC2 → IP elásticas → Asignar**, y asociala a la instancia.

Sin esto, la dirección cambia cada vez que se reinicia el servidor y el dominio
deja de apuntar a ningún lado.

### Instalar Docker

Conectate por SSH y corré:

```
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

**Cerrá la sesión y volvé a entrar** para que el cambio de grupo tome efecto.
Verificá con `docker ps`: si pide permisos, la sesión no se reinició.

---

## Paso 7 — El dominio

En el panel de HostGator, en la zona DNS de `vetlineai.com`, agregá un registro:

**Tipo A**, nombre `app`, valor **la IP elástica** del paso anterior.

**No toques nada más.** Los registros de correo siguen igual y Resend no se ve
afectado.

Verificá desde tu máquina:

```powershell
Resolve-DnsName app.vetlineai.com -Server 8.8.8.8
```

**Esperá a que responda con tu IP antes de seguir.** Si el certificado se intenta
emitir antes de que el dominio resuelva, falla — y es el error más común de todo
este proceso.

---

## Paso 8 — Subir las imágenes

En **ECR → Crear repositorio**, dos: `vetplatform-backend` y
`vetplatform-frontend`.

Desde tu máquina, con la herramienta de línea de comandos de AWS configurada:

```powershell
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin CUENTA.dkr.ecr.us-east-1.amazonaws.com
docker tag vetplatform-backend:7676b9d CUENTA.dkr.ecr.us-east-1.amazonaws.com/vetplatform-backend:7676b9d
docker tag vetplatform-frontend:7676b9d CUENTA.dkr.ecr.us-east-1.amazonaws.com/vetplatform-frontend:7676b9d
docker push CUENTA.dkr.ecr.us-east-1.amazonaws.com/vetplatform-backend:7676b9d
docker push CUENTA.dkr.ecr.us-east-1.amazonaws.com/vetplatform-frontend:7676b9d
```

El backend pesa 852 MB, así que la primera subida tarda. Las siguientes solo
suben lo que cambió.

---

## Paso 9 — Las dos bases

Desde el servidor, conectate a la instancia administrada y creá las dos:

```
docker run --rm -it postgres:17 psql -h PUNTO_DE_CONEXION -U postgres
```

```sql
CREATE DATABASE vetplatform;
CREATE DATABASE keycloak;
\q
```

**Si esto se queda esperando sin responder**, la regla del grupo de seguridad
`vetline-base` no está bien: revisá que su origen sea el grupo del servidor.

---

## Paso 10 — Configuración y arranque

En el servidor, cloná el repositorio o subí los archivos de despliegue:
`docker-compose.prod.yml`, `Caddyfile` y el archivo de entorno.

**Creá el archivo de entorno a partir del ejemplo**, completando:

Las dos direcciones de base con el punto de conexión y sus credenciales. Las
claves de Anthropic, Resend y Tilopay. Las del usuario de almacenamiento y los
nombres de los dos depósitos. La dirección pública `https://app.vetlineai.com` en
las variables de frontend, API y emisor de Keycloak. Y un secreto **nuevo** para
el cliente de servicio — no el de desarrollo.

**Permisos restrictivos** sobre ese archivo:

```
chmod 600 .env.prod
```

Y arrancá:

```
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

**Mirá los registros mientras levanta.** El certificado se emite solo, y ahí se ve
si lo logró.

---

## Paso 11 — Migraciones y sembrado

```
docker compose -f docker-compose.prod.yml exec backend npm run migrate
docker compose -f docker-compose.prod.yml exec backend npm run seed:plataforma
```

Deberías ver las 60 migraciones aplicarse y el sembrado reportar 5 tarifas, 9
agentes, 151 documentos y 23 alias.

**No corras el sembrado de desarrollo.** Producción arranca sin clínicas.

---

## Paso 12 — El reino de Keycloak

Entrá a Keycloak con las credenciales de administrador que definiste en el archivo
de entorno.

**Importá el reino de producción** —el archivo derivado, sin usuarios y sin
secreto— y después:

Poné el secreto nuevo del cliente de servicio, el mismo que configuraste en el
archivo de entorno.

Agregá `https://app.vetlineai.com` a los orígenes web del cliente, y
`https://app.vetlineai.com/*` a sus URIs de redirección.

**Reiniciá el backend** para que tome el secreto:

```
docker compose -f docker-compose.prod.yml up -d backend
```

---

## Paso 13 — Verificación

**Entrá a `https://app.vetlineai.com`.** Debería cargar con candado, sin
advertencias.

**Registrá una clínica de verdad** — la tuya, con tu correo real. Ese es el
circuito completo: registro, verificación de correo, creación de caso, análisis
con un agente e informe.

Y confirmá que **el correo de verificación llega**, que es lo que valida que
Resend funciona desde producción.

---

## Lo que suele salir mal

**El certificado no se emite.** Casi siempre porque el dominio todavía no
resuelve, o porque el puerto 80 está cerrado. Se ve en los registros del proxy.

**La base no responde.** El origen de la regla en `vetline-base` tiene que ser el
grupo de seguridad del servidor, no una dirección.

**El login falla.** El emisor que Keycloak usa tiene que coincidir exactamente con
el que el backend espera. Es el mismo problema que nos rompió el login al pasar a
la red local.

**El correo no sale.** Las variables de Resend no se copiaron, o el dominio
verificado no coincide con la dirección de envío.

---

## Después del primer despliegue

**Probá el respaldo antes de necesitarlo.** La base administrada respalda sola,
pero un respaldo sin probar es una suposición.

**Y respaldá la base de Keycloak**, que es donde viven los usuarios reales. La
instancia administrada la cubre, ya que las dos bases están ahí.
