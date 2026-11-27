import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------
// ESLINT ACOTADO A LAS REGLAS DE LOS HOOKS — defecto del 2026-11-27.
//
// `AtencionActual.tsx` tenía un `if (cargando) return <LoadingState/>`
// ANTES de tres hooks. El primer render llamaba tres hooks menos que el
// segundo, React tiraba «Rendered more hooks than during the previous
// render» y la ficha del paciente entera quedaba en blanco. Un defecto
// que una regla de linter detecta en un segundo y que nadie ve leyendo
// un archivo de 1.200 líneas.
//
// POR QUÉ SOLO ESTAS DOS REGLAS, a propósito: el proyecto no tenía
// ESLint. Encender el preset completo sobre 400 archivos ya escritos
// deja miles de avisos, y un linter con miles de avisos es un linter
// que nadie mira y que no puede romper el build. Estas dos no son
// estilo: son correcciones de defectos que dejan la pantalla en blanco
// o congelan datos viejos. Se suman más cuando alguien quiera pagar la
// limpieza de las que faltan.
// ---------------------------------------------------------------------

export default [
  {
    ignores: ["dist/**", "dev-dist/**", "node_modules/**", "scripts/**", "*.config.js"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Rompe el build: un hook condicional es una pantalla en blanco.
      "react-hooks/rules-of-hooks": "error",
      // Avisa, no rompe: hay dependencias omitidas a propósito en el
      // código ya escrito y arreglarlas a ciegas cambia comportamiento.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
