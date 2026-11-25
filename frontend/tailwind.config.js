import { createRequire } from "node:module";

// Los diez colores de la paleta de datos se leen de su fuente única
// (`src/lib/paleta-datos.json`), no se repiten acá. Los mismos valores
// los usan los charts y las leyendas desde `src/lib/paletaDatos.ts`, y
// `scripts/verificar-paleta-datos.mjs` los mide. Un hex en tres lugares
// es un hex que va a divergir.
//
// `createRequire` y no `import ... with { type: "json" }`: este archivo
// lo evalúa Node (no Vite), y el require de JSON es el camino que
// funciona igual en las versiones de Node que usa el proyecto sin
// depender de import attributes.
const require = createRequire(import.meta.url);
const paletaDatos = require("./src/lib/paleta-datos.json");

const tokensDatos = Object.fromEntries(
  Object.entries(paletaDatos)
    .filter(([clave]) => !clave.startsWith("_"))
    .map(([clave, valor]) => [clave.replace(/^datos/, "datos-"), valor])
);

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#1B2A4A",
        secondary: "#3A4E7A",
        accent: "#4A90D9",
        background: "#FAF7F2",
        surface: "#FFFFFF",
        "text-primary": "#121E36",
        "text-muted": "#5A6B82",
        success: "#7BA68C",
        warning: "#E8B45C",
        error: "#E8725C",
        info: "#4A90D9",
        // Paleta categórica para datos: `datos-1` .. `datos-10`.
        // Reservada para CATEGORÍAS (líneas de negocio, series de un
        // chart). Los semánticos de arriba quedan para ESTADOS y no se
        // usan como categoría, ni al revés.
        ...tokensDatos,
      },
      fontFamily: {
        display: ["'Instrument Serif'", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
