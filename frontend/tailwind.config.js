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
        // Los colores salen de variables CSS (`src/index.css`), no de
        // hexadecimales compilados: es lo que permite que el tema cambie
        // por clínica sin recompilar el bundle. El `<alpha-value>` es lo
        // que mantiene vivo `bg-primary/10` en todo el sistema.
        primary: {
          DEFAULT: "rgb(var(--color-primary) / <alpha-value>)",
          hover: "rgb(var(--color-primary-hover) / <alpha-value>)",
          suave: "rgb(var(--color-primary-suave) / <alpha-value>)",
          oscuro: "rgb(var(--color-primary-oscuro) / <alpha-value>)",
          borde: "rgb(var(--color-primary-borde) / <alpha-value>)",
        },
        "sobre-primary": "rgb(var(--color-sobre-primary) / <alpha-value>)",
        secondary: "rgb(var(--color-secondary) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        background: "rgb(var(--color-background) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "text-primary": "rgb(var(--color-text-primary) / <alpha-value>)",
        "text-muted": "rgb(var(--color-text-muted) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        error: "rgb(var(--color-error) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",
        // Color por módulo: SOLO para íconos (ajuste 1 del prompt 01c).
        modulo: {
          caja: "rgb(var(--color-modulo-caja) / <alpha-value>)",
          inventario: "rgb(var(--color-modulo-inventario) / <alpha-value>)",
          agenda: "rgb(var(--color-modulo-agenda) / <alpha-value>)",
          facturacion: "rgb(var(--color-modulo-facturacion) / <alpha-value>)",
          pacientes: "rgb(var(--color-modulo-pacientes) / <alpha-value>)",
          ia: "rgb(var(--color-modulo-ia) / <alpha-value>)",
          admin: "rgb(var(--color-modulo-admin) / <alpha-value>)",
        },
        // Paleta categórica para datos: `datos-1` .. `datos-10`.
        // Reservada para CATEGORÍAS (líneas de negocio, series de un
        // chart). Los semánticos de arriba quedan para ESTADOS y no se
        // usan como categoría, ni al revés.
        ...tokensDatos,
      },
      fontFamily: {
        // Manrope en los dos, con la fuente del sistema como respaldo.
        // `display` deja de ser una serif: la dirección visual elegida
        // no la usa, y tener dos familias cargadas costaba una petición
        // de red por una tipografía que casi no aparecía.
        display: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        sm: "var(--radio-sm)",
        DEFAULT: "var(--radio-md)",
        md: "var(--radio-md)",
        lg: "var(--radio-lg)",
        xl: "var(--radio-xl)",
      },
      boxShadow: {
        suave: "var(--sombra-suave)",
        media: "var(--sombra-media)",
        franja: "var(--sombra-franja)",
      },
      minHeight: {
        control: "var(--alto-control)",
      },
    },
  },
  plugins: [],
};
