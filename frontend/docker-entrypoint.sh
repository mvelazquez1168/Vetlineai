#!/bin/sh
set -e

# Genera env-config.js a partir del template, con las variables de entorno
# REALES de este contenedor — corre en cada arranque, no en el build, así
# la misma imagen sirve para cualquier ambiente (ver runtimeEnv.ts en el
# frontend sobre por qué). Lista explícita de variables a sustituir: si se
# pasa el string vacío a envsubst, sustituye TODO lo que empiece con "$" en
# el archivo, lo cual rompería cualquier otro literal "${...}" que hubiera
# ahí sin querer.
envsubst '${VITE_API_URL} ${VITE_KEYCLOAK_ISSUER} ${VITE_KEYCLOAK_CLIENT_ID}' \
  < /usr/share/nginx/html/env-config.js.template \
  > /usr/share/nginx/html/env-config.js

exec nginx -g 'daemon off;'
