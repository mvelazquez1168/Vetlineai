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
      },
      fontFamily: {
        display: ["'Instrument Serif'", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
