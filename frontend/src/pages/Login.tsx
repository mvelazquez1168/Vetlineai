import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ApiError } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recordar, setRecordar] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const user = await login(email, password);
      if (user.rol === "medico") navigate("/workspace");
      else if (user.rol === "admin_clinica") navigate("/admin");
      else navigate("/platform-admin");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No pudimos iniciar sesión. Intentá de nuevo.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full">
      {/* Panel izquierdo — mensaje institucional */}
      <div className="hidden w-1/2 flex-col justify-between bg-primary p-16 text-white lg:flex">
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

        <div>
          <h1 className="font-display text-5xl leading-tight">
            Inteligencia artificial al servicio de la medicina veterinaria
          </h1>
          <p className="mt-6 max-w-md text-white/70">
            Optimice diagnósticos, agilice el triaje clínico y dedique más tiempo a lo que
            realmente importa: el bienestar de sus pacientes.
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm text-white/50">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="font-semibold text-white/70">V3.2 Activa</span>
          <span>Seguridad garantizada bajo estándares de encriptación médica.</span>
        </div>
      </div>

      {/* Panel derecho — formulario */}
      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-1/2">
        <div className="w-full max-w-md rounded-2xl bg-surface p-10 shadow-sm">
          <h2 className="text-3xl font-bold text-primary">Iniciar Sesión</h2>
          <p className="mt-2 text-sm text-text-muted">
            Ingrese sus credenciales de veterinario para continuar.
          </p>

          <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
            <Input
              label="Correo electrónico"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="dr.garcia@sanmartin.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Contraseña"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-black/20 text-accent focus:ring-accent"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
              />
              Recordar sesión
            </label>

            {error && (
              <p className="rounded-lg bg-error/10 px-4 py-2 text-sm text-error" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" fullWidth disabled={isSubmitting}>
              {isSubmitting ? "Ingresando…" : "Iniciar Sesión"}
            </Button>
          </form>

          {/*
            TODO(Keycloak): el botón "Acceder con SSO institucional" corresponde
            a la integración con Keycloak, que se implementa en una fase futura.
            No debe habilitarse todavía — cuando se integre, este flujo va a
            redirigir a Keycloak (OIDC/SAML) y useAuth() se reimplementa por
            dentro para que el resto de la app no tenga que cambiar nada.

            <div className="mt-6 flex items-center gap-3 text-xs text-text-muted">
              <span className="h-px flex-1 bg-black/10" />
              o
              <span className="h-px flex-1 bg-black/10" />
            </div>
            <Button variant="secondary" fullWidth className="mt-6" type="button">
              Acceder con SSO institucional
            </Button>
          */}

          <p className="mt-6 text-center text-sm text-accent">
            <a href="#">¿Olvidaste tu contraseña?</a>
          </p>
          <p className="mt-3 text-center text-sm text-text-muted">
            ¿No tenés cuenta todavía? <Link to="/registro" className="text-accent">Registrá tu clínica</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
