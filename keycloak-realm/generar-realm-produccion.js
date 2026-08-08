#!/usr/bin/env node
// Deriva Vetplatform-realm-produccion.json a partir de Vetplatform-realm.json
// (la exportación real de desarrollo, kc.sh export --users, ver inventario de
// configuración). Es un script versionado, no un archivo estático a mano: la
// config real de clientes/roles/flujos/atributos de perfil de usuario vive en
// el export de dev, así que este script la deriva de la fuente real en vez
// de duplicarla a mano y arriesgar que se desactualice en silencio. Volver a
// correrlo cada vez que cambie a propósito la configuración estructural del
// reino en dev (un cliente nuevo, un flujo nuevo, un atributo de perfil
// nuevo) y haga falta rebasear el archivo de producción.
//
// Qué saca y por qué:
//   - users: dev tiene 33 usuarios reales de prueba — producción arranca
//     vacía, las clínicas se registran por autoservicio (igual que las
//     semillas de plataforma, ver seedPlataforma.ts).
//   - components["org.keycloak.keys.KeyProvider"]: son las claves de firma
//     REALES de dev (RSA/HMAC/AES en texto claro dentro del export). Nunca
//     deben viajar a producción — si se importan tal cual, un token firmado
//     en dev sería válido en prod. Sin este componente, Keycloak genera
//     claves nuevas al crear el reino (comportamiento estándar al importar
//     un realm sin ese componente).
//   - El secreto del cliente vetplatform-backend-service: es el secreto
//     VIEJO de dev (ya rotado ahí, ver inventario). Se borra el campo entero
//     — Keycloak genera un secreto nuevo al crear el cliente sin él, mismo
//     mecanismo que "Regenerate secret" en la consola.
//   - webOrigins/redirectUris/rootUrl/adminUrl/baseUrl de vetplatform-web:
//     apuntan a localhost/IP de LAN de desarrollo. Se reemplazan por el
//     dominio real de producción.
//
// Qué NO se toca (se copia tal cual del export real):
//   roles, groups, clientScopes, authenticationFlows, authenticatorConfig,
//   requiredActions, userProfile (atributo tenant_id incluido), y los ids
//   internos de realm/clientes/roles — kc.sh import está diseñado para
//   aceptar el export tal cual como mecanismo de restauración/bootstrap, y
//   dev/prod son bases de Keycloak completamente separadas, así que no hay
//   riesgo de colisión de ids.

const fs = require("fs");
const path = require("path");

const ORIGEN = path.join(__dirname, "Vetplatform-realm.json");
const DESTINO = path.join(__dirname, "Vetplatform-realm-produccion.json");
const DOMINIO_PROD = process.argv[2] || "https://app.vetlineai.com";

const realm = JSON.parse(fs.readFileSync(ORIGEN, "utf8"));

const usuariosQuitados = (realm.users || []).length;
realm.users = [];

const teniaKeyProvider = !!(realm.components && realm.components["org.keycloak.keys.KeyProvider"]);
if (realm.components) {
  delete realm.components["org.keycloak.keys.KeyProvider"];
}

const backendService = realm.clients.find((c) => c.clientId === "vetplatform-backend-service");
if (!backendService) {
  throw new Error("No se encontró el cliente vetplatform-backend-service en el export — ¿cambió el nombre?");
}
const teniaSecreto = "secret" in backendService;
delete backendService.secret;

const web = realm.clients.find((c) => c.clientId === "vetplatform-web");
if (!web) {
  throw new Error("No se encontró el cliente vetplatform-web en el export — ¿cambió el nombre?");
}
const origenesViejos = { rootUrl: web.rootUrl, redirectUris: web.redirectUris, webOrigins: web.webOrigins };
web.rootUrl = DOMINIO_PROD;
web.adminUrl = DOMINIO_PROD;
web.baseUrl = DOMINIO_PROD;
web.redirectUris = [`${DOMINIO_PROD}/*`];
web.webOrigins = [DOMINIO_PROD];
if (web.attributes && "post.logout.redirect.uris" in web.attributes) {
  web.attributes["post.logout.redirect.uris"] = DOMINIO_PROD;
}

fs.writeFileSync(DESTINO, JSON.stringify(realm, null, 2) + "\n", "utf8");

console.log(`Escrito: ${DESTINO}`);
console.log(`- usuarios quitados: ${usuariosQuitados}`);
console.log(`- claves de firma de dev quitadas: ${teniaKeyProvider ? "sí" : "NO HABÍA (revisar)"} (Keycloak genera nuevas al importar)`);
console.log(`- secreto viejo de vetplatform-backend-service quitado: ${teniaSecreto ? "sí" : "NO HABÍA (revisar)"} (Keycloak genera uno nuevo al importar)`);
console.log(`- vetplatform-web reapuntado de ${JSON.stringify(origenesViejos)} a ${DOMINIO_PROD}`);
