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
                // El armazón (JS/CSS/íconos) se precarga para que la segunda
                // apertura sea instantánea. "html" quedó afuera a propósito — ver
                // el bug real de dos despliegues seguidos: index.html precacheado
                // referencia los archivos con huella de ESE build; el build
                // siguiente borra esos archivos del servidor, así que el navegador
                // que ya visitó la app queda pidiendo assets que ya no existen,
                // roto hasta que se le borren los datos del sitio a mano. index.html
                // nunca debe sacarse de una caché fija — solo de la red, con la
                // caché como respaldo para cuando no hay conexión (ver
                // navigateFallback + runtimeCaching de navegación, abajo).
                globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
                // Toda navegación (carga de página, no assets) que no matchee un
                // archivo precacheado cae acá — es lo que hace que la app siga
                // sirviendo algo offline, pero SIEMPRE intentando la red primero
                // (ver la regla de navegación en runtimeCaching): nunca sirve
                // index.html directo desde una caché fija como haría el precache.
                navigateFallback: "/index.html",
                runtimeCaching: [
                    {
                        // El documento principal — SIEMPRE a la red primero. Si la red
                        // responde (el caso normal), esa respuesta fresca reemplaza lo
                        // que hubiera en caché y es la que se sirve. La copia en caché
                        // solo se usa como último recurso, sin conexión. Con esto, un
                        // despliegue nuevo es visible en la próxima carga de página,
                        // sin esperar ninguna expiración.
                        urlPattern: function (_a) {
                            var request = _a.request;
                            return request.mode === "navigate";
                        },
                        handler: "NetworkFirst",
                        options: { cacheName: "html-navigation", networkTimeoutSeconds: 10 },
                    },
                    {
                        // Decisión de privacidad del prompt: las respuestas de la API
                        // (expedientes, pacientes, informes, casos) NUNCA se cachean.
                        // Siempre a la red; sin conexión, falla en vez de servir datos
                        // clínicos viejos guardados en el teléfono.
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.pathname.startsWith("/api/");
                        },
                        handler: "NetworkOnly",
                    },
                    {
                        // Tipografías de Google Fonts: sí forman parte del "armazón" que
                        // el Paso 3 pide precargar (están fuera del build de Vite porque
                        // se cargan por <link> en index.html, no las agarra globPatterns).
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.origin === "https://fonts.googleapis.com";
                        },
                        handler: "StaleWhileRevalidate",
                        options: { cacheName: "google-fonts-stylesheets" },
                    },
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.origin === "https://fonts.gstatic.com";
                        },
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
