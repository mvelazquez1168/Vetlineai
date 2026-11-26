import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ApiError } from "../lib/api";
import { MotivoTokenInvalido, restablecerContrasenaApi } from "../lib/restablecerContrasenaApi";

// prompt_code_restablecer_contrasena, Paso 4 — pantalla pública a la que
// se llega por el enlace del correo. Valida el token al cargar (para no
// mostrar el formulario si ya está vencido/usado) y de nuevo al
// confirmar (el token puede vencer mientras el usuario está escribiendo).

type Estado = "validando" | "listo" | "invalido" | "enviando" | "ok" | "error";

const MENSAJES_INVALIDO: Record<MotivoTokenInvalido, { titulo: string; texto: string }> = {
  token_invalido: {
    titulo: "Este enlace no es válido",
    texto: "Puede que ya lo hayas usado o que el enlace esté incompleto.",
  },
  token_vencido: {
    titulo: "Este enlace venció",
    texto: "Los enlaces de restablecimiento son válidos por poco tiempo, por seguridad.",
  },
  token_usado: {
    titulo: "Este enlace ya fue usado",
    texto: "Cada enlace de restablecimiento sirve una sola vez.",
  },
};

export function EstablecerContrasenaNueva() {
  const { token } = useParams<{ token: string }>();
  const [estado, setEstado] = useState<Estado>("validando");
  const [motivoInvalido, setMotivoInvalido] = useState<MotivoTokenInvalido>("token_invalido");
  const [password, setPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    restablecerContrasenaApi
      .validarToken(token)
      .then(() => setEstado("listo"))
      .catch((err) => {
        const motivo = err instanceof ApiError ? (err.data as { motivo?: MotivoTokenInvalido })?.motivo : undefined;
        setMotivoInvalido(motivo ?? "token_invalido");
        setEstado("invalido");
      });
  }, [token]);

  const passwordsCoinciden = !confirmarPassword || password === confirmarPassword;
  const passwordValida = password.length >= 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !passwordValida || password !== confirmarPassword) return;
    setEstado("enviando");
    setError(null);
    try {
      await restablecerContrasenaApi.confirmar(token, password);
      setEstado("ok");
    } catch (err) {
      const motivo = err instanceof ApiError ? (err.data as { motivo?: MotivoTokenInvalido })?.motivo : undefined;
      if (motivo) {
        setMotivoInvalido(motivo);
        setEstado("invalido");
        return;
      }
      setError(err instanceof ApiError ? err.message : "No pudimos restablecer tu contraseña. Inténtelo de nuevo.");
      setEstado("listo");
    }
  };

  let contenido: React.ReactNode;
  if (estado === "validando") {
    contenido = <p className="text-text-muted">Verificando tu enlace…</p>;
  } else if (estado === "invalido") {
    const { titulo, texto } = MENSAJES_INVALIDO[motivoInvalido];
    contenido = (
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary">{titulo}</h1>
        <p className="mt-3 text-text-muted">{texto}</p>
        <Link
          to="/restablecer-contrasena"
          className="mt-8 inline-block rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-secondary"
        >
          Pedir un enlace nuevo
        </Link>
      </div>
    );
  } else if (estado === "ok") {
    contenido = (
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
          <span className="text-3xl text-success">✓</span>
        </div>
        <h1 className="mt-6 text-2xl font-bold text-primary">Contraseña actualizada</h1>
        <p className="mt-3 text-text-muted">Ya puede ingresar con su contraseña nueva.</p>
        <Button className="mt-8" fullWidth onClick={() => (window.location.href = "/login")}>
          Ir a iniciar sesión
        </Button>
      </div>
    );
  } else {
    contenido = (
      <>
        <h1 className="text-2xl font-bold text-primary">Elija su contraseña nueva</h1>
        <p className="mt-2 text-sm text-text-muted">
          Al confirmar, vamos a cerrar cualquier sesión activa de tu cuenta.
        </p>
        <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Contraseña nueva"
                type={mostrarPassword ? "text" : "password"}
                autoComplete="new-password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="button"
              onClick={() => setMostrarPassword((v) => !v)}
              className="mb-2.5 shrink-0 text-xs font-semibold text-accent hover:underline"
            >
              {mostrarPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {password && !passwordValida && <p className="-mt-2 text-xs text-text-muted">Mínimo 8 caracteres.</p>}

          <Input
            label="Confirmar contraseña"
            type={mostrarPassword ? "text" : "password"}
            autoComplete="new-password"
            name="passwordConfirmacion"
            value={confirmarPassword}
            onChange={(e) => setConfirmarPassword(e.target.value)}
            error={!passwordsCoinciden ? "Las contraseñas no coinciden." : undefined}
            required
          />

          {error && (
            <p className="rounded-lg bg-error/10 px-4 py-2 text-sm text-error" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            fullWidth
            disabled={estado === "enviando" || !passwordValida || password !== confirmarPassword}
          >
            {estado === "enviando" ? "Guardando…" : "Guardar contraseña nueva"}
          </Button>
        </form>
      </>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-md rounded-2xl bg-surface p-10 shadow-sm">{contenido}</div>
    </div>
  );
}
