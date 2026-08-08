// ---------------------------------------------------------------------
// Vite resuelve import.meta.env.VITE_* en tiempo de COMPILACIÓN — la
// imagen de producción queda atada al valor que tenía en el momento del
// build. Para no atar la imagen a un ambiente (una imagen por ambiente
// sería otra opción, pero implica reconstruir para cada URL de API/
// Keycloak distinta), el contenedor de nginx genera public/env-config.js
// a partir de las variables de entorno reales del contenedor, en cada
// arranque (ver frontend/docker-entrypoint.sh) — ese script setea
// window.__ENV__ ANTES de que cargue el bundle (ver index.html).
//
// obtenerEnv() lee primero de ahí; si no existe (dev local, o el script
// nunca corrió) cae a import.meta.env, que sigue funcionando igual que
// antes para `npm run dev` / `vite build` sin Docker.
// ---------------------------------------------------------------------
declare global {
  interface Window {
    __ENV__?: Record<string, string | undefined>;
  }
}

export function obtenerEnv(clave: string): string | undefined {
  if (typeof window !== "undefined" && window.__ENV__?.[clave]) {
    return window.__ENV__[clave];
  }
  return import.meta.env[clave] as string | undefined;
}
