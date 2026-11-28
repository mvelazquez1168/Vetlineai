import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": el usuario decide cuándo recargar (ver PwaUpdatePrompt.tsx) —
      // "autoUpdate" activaría la versión nueva sin avisar, justo lo que el
      // prompt de instalación pidió evitar.
      registerType: "prompt",
      // Este stack todavía no tiene build/imagen de producción (ver
      // docker-compose.yml, el Dockerfile del frontend solo corre `vite dev`)
      // — sin esto, el service worker y el manifiesto no se generan nunca en
      // este entorno y no hay forma de probar la instalación. localhost
      // cuenta como origen seguro, así que la instalación funciona igual sin
      // HTTPS acá. Cuando exista un pipeline de producción con HTTPS real,
      // esto deja de ser necesario para verificar (aunque no molesta dejarlo).
      devOptions: {
        enabled: true,
        type: "module",
      },
      manifest: {
        name: "Vetline Ai",
        short_name: "Vetline Ai",
        description: "Plataforma de asistencia clínica veterinaria con IA para equipos de Vetline Ai.",
        theme_color: "#1B2A4A",
        background_color: "#FAF7F2",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // EL TOPE DE PRECARGA, SUBIDO A 5 MiB — hallazgo del 2026-11-27,
        // corriendo `npm run build` de verdad por primera vez.
        //
        // El valor por omisión de workbox es 2 MiB y el bundle ya pesa
        // 2,11 MB, así que el build de producción FALLABA entero: no es
        // un aviso, workbox corta. Nadie lo había visto porque en
        // desarrollo Vite no empaqueta.
        //
        // Subir el tope es la decisión correcta hoy —un bundle de 2 MB
        // precargado es exactamente lo que hace que la segunda apertura
        // sea instantánea, que es para lo que está la PWA— pero NO es la
        // solución: lo que corresponde es partir el bundle por ruta con
        // `import()` para que el médico no descargue el facturador ni el
        // panel de plataforma. Queda anotado como deuda, con su número:
        // 2,11 MB en un solo archivo.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // El armazón (JS/CSS/íconos) se precarga para que la segunda
        // apertura sea instantánea. "html" quedó afuera a propósito — ver
        // el bug real de dos despliegues seguidos: index.html precacheado
        // referencia los archivos con huella de ESE build; el build
        // siguiente borra esos archivos del servidor, así que el navegador
        // que ya visitó la app queda pidiendo assets que ya no existen,
        // roto hasta que se le borren los datos del sitio a mano. index.html
        // nunca debe sacarse de una caché fija — solo de la red, con la
        // caché como respaldo para cuando no hay conexión (ver la regla de
        // navegación en runtimeCaching, abajo).
        //
        // navigateFallback: undefined es OBLIGATORIO, no cosmético.
        // vite-plugin-pwa mergea sus propios defaults con
        // Object.assign({}, defaultWorkbox, options.workbox) — y
        // defaultWorkbox.navigateFallback = "index.html" siempre, aunque
        // esta clave no aparezca acá. Con eso, workbox registra
        // NavigationRoute(createHandlerBoundToURL("index.html")) ANTES
        // que las reglas de runtimeCaching de abajo (gana el primer
        // match), buscando "index.html" DENTRO del precache — que ya no
        // existe, porque "html" salió de globPatterns a propósito. Sin
        // este override explícito, la regla NetworkFirst de navegación
        // de abajo nunca llegaría a ejecutarse. Esto NO se dedujo leyendo
        // la documentación: se encontró inspeccionando el sw.js
        // generado, que seguía trayendo esa ruta después de sacar
        // "navigateFallback" del config — no alcanzaba con omitir la
        // clave, hacía falta pisar el default explícitamente.
        navigateFallback: undefined,
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            // El documento principal — SIEMPRE a la red primero. Si la red
            // responde (el caso normal), esa respuesta fresca reemplaza lo
            // que hubiera en caché y es la que se sirve. La copia en caché
            // solo se usa como último recurso, sin conexión. Con esto, un
            // despliegue nuevo es visible en la próxima carga de página,
            // sin esperar ninguna expiración.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: { cacheName: "html-navigation", networkTimeoutSeconds: 10 },
          },
          {
            // Decisión de privacidad del prompt: las respuestas de la API
            // (expedientes, pacientes, informes, casos) NUNCA se cachean.
            // Siempre a la red; sin conexión, falla en vez de servir datos
            // clínicos viejos guardados en el teléfono.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
          {
            // Tipografías de Google Fonts: sí forman parte del "armazón" que
            // el Paso 3 pide precargar (están fuera del build de Vite porque
            // se cargan por <link> en index.html, no las agarra globPatterns).
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true, // necesario para exponer el server desde dentro de un contenedor Docker
    watch: {
      // Docker Desktop en Windows, con el código montado como volumen desde
      // el host, a veces no propaga los eventos de inotify hasta chokidar
      // (el watcher de Vite), así que los cambios de archivo no se detectan
      // solos. `usePolling` fuerza a Vite a chequear el disco periódicamente
      // en vez de depender de esos eventos — un poco más de uso de CPU, pero
      // confiable en este escenario.
      usePolling: true,
      interval: 300,
    },
  },
});
