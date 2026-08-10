import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { restablecerContrasenaApi } from "../lib/restablecerContrasenaApi";

// prompt_code_restablecer_contrasena, Paso 2 — pantalla pública, un solo
// campo. DECISIÓN DE SEGURIDAD: la respuesta es SIEMPRE el mismo mensaje,
// exista o no la cuenta — nunca hay una rama de error distinta acá que
// pueda delatar qué direcciones están registradas.

export function RestablecerContrasena() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await restablecerContrasenaApi.solicitar(email);
    } catch {
      // Ni un error de red cambia lo que se muestra — ver nota de
      // seguridad arriba.
    } finally {
      setIsSubmitting(false);
      setEnviado(true);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-md rounded-2xl bg-surface p-10 shadow-sm">
        {enviado ? (
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
              <span className="text-3xl text-success">✓</span>
            </div>
            <h1 className="mt-6 text-2xl font-bold text-primary">Revisá tu correo</h1>
            <p className="mt-3 text-text-muted">
              Si esa dirección está registrada, te enviamos las instrucciones para restablecer tu contraseña.
            </p>
            <Link to="/login" className="mt-8 block text-sm font-semibold text-accent hover:underline">
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-primary">Restablecer contraseña</h1>
            <p className="mt-2 text-sm text-text-muted">
              Ingresá tu correo electrónico y te mandamos un enlace para elegir una contraseña nueva.
            </p>
            <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
              <Input
                label="Correo electrónico"
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" fullWidth disabled={isSubmitting}>
                {isSubmitting ? "Enviando…" : "Enviar instrucciones"}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-text-muted">
              <Link to="/login" className="text-accent">
                Volver a iniciar sesión
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
