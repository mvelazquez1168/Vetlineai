// Vetline_Ai_Suspension_Bloqueo.md, Pantalla 4 — "sin sesión iniciada, sin
// menú, sin datos". Ruta pública top-level (ver App.tsx), no envuelta en
// ProtectedRoute: se llega acá tanto desde un intento de login fallido
// como desde una sesión activa interceptada en pleno vuelo por
// interceptarClinicaBloqueada() (ver lib/api.ts), que ya limpió la sesión
// local antes de redirigir.
export function ClinicaBloqueada() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-center">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 21s-7-4.35-9.33-9C1.2 8.5 3 5 6.5 5c2 0 3.2 1 3.9 2 0 0 .6-2 3.1-2 3.5 0 5.3 3.5 3.83 7-2.33 4.65-9.33 9-9.33 9Z"
              stroke="white"
              strokeWidth="1.5"
            />
          </svg>
        </div>
        <span className="text-xl font-bold">Vetline Ai</span>
      </div>

      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-error/10">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-error" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.5" className="text-error" />
        </svg>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-text">Acceso suspendido</h1>
        <p className="max-w-md text-text-muted">
          El ingreso a tu clínica de Vetline Ai ha sido temporalmente inhabilitado. Tus datos permanecen
          intactos y esta situación es reversible.
        </p>
      </div>

      <a
        href="mailto:soporte@vetlineai.com"
        className="rounded-lg bg-primary px-4 py-2 font-semibold text-white hover:bg-secondary"
      >
        Contacte al soporte de Vetline Ai
      </a>
    </div>
  );
}
