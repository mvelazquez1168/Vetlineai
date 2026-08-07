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
        // El armazón (JS/CSS/HTML/íconos) se precarga para que la segunda
        // apertura sea instantánea y la instalación tenga sentido.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
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
