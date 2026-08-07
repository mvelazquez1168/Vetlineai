import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { ApiError } from "../lib/api";
import { verificacionCorreoApi } from "../lib/verificacionCorreoApi";

// Pantalla pública (sin sesión) a la que se llega por el enlace del
// correo de verificación — prompt de verificación de correo, Capa 2.
// Mismo layout simple que las demás pantallas públicas por token.

type Resultado = "cargando" | "ok" | "token_invalido" | "token_vencido" | "error";

export function VerificarCorreo() {
  const { token } = useParams<{ token: string }>();
  const [resultado, setResultado] = useState<Resultado>("cargando");

  useEffect(() => {
    if (!token) return;
    verificacionCorreoApi
      .confirmar(token)
      .then(() => setResultado("ok"))
      .catch((err) => {
        if (err instanceof ApiError) {
          const motivo = (err.data as { motivo?: string } | undefined)?.motivo;
          if (motivo === "token_invalido" || motivo === "token_vencido") {
            setResultado(motivo);
            return;
          }
        }
        setResultado("error");
      });
  }, [token]);

  const contenido = () => {
    switch (resultado) {
      case "cargando":
        return <p className="text-text-muted">Confirmando tu correo…</p>;
      case "ok":
        return (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
              <span className="text-3xl text-success">✓</span>
            </div>
            <h1 className="mt-6 text-2xl font-bold text-primary">¡Correo verificado!</h1>
            <p className="mt-3 text-text-muted">
              Ya podés seguir usando Vetline Ai con normalidad. Si tu crédito de prueba estaba retenido, ya
              quedó habilitado.
            </p>
            <Button className="mt-8" fullWidth onClick={() => (window.location.href = "/login")}>
              Ir a iniciar sesión
            </Button>
          </>
        );
      case "token_vencido":
        return (
          <>
            <h1 className="text-2xl font-bold text-primary">Este enlace venció</h1>
            <p className="mt-3 text-text-muted">
              Iniciá sesión y pedí que te reenvíen la verificación desde Clínica → Correo de acceso.
            </p>
            <Link to="/login" className="mt-8 block text-sm font-semibold text-accent hover:underline">
              Ir a iniciar sesión
            </Link>
          </>
        );
      case "token_invalido":
      case "error":
      default:
        return (
          <>
            <h1 className="text-2xl font-bold text-primary">No pudimos confirmar tu correo</h1>
            <p className="mt-3 text-text-muted">
              Este enlace no es válido. Si ya tenés cuenta, iniciá sesión y pedí que te reenvíen la
              verificación.
            </p>
            <Link to="/login" className="mt-8 block text-sm font-semibold text-accent hover:underline">
              Ir a iniciar sesión
            </Link>
          </>
        );
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-md rounded-2xl bg-surface p-10 text-center shadow-sm">{contenido()}</div>
    </div>
  );
}
