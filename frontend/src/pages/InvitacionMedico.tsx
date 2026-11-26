import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ApiError } from "../lib/api";
import { invitacionesApi, InvitacionPublica } from "../lib/invitacionesApi";
import { useAuth } from "../hooks/useAuth";

// Pantalla pública (sin sesión) a la que llega el médico invitado —
// Pantallas faltantes, Prompt A, Paso 3. Mismo layout de dos paneles que
// Login.tsx/Registro.tsx, pero sin stepper: acá solo hay un formulario.

const MENSAJES_NO_FORMULARIO: Record<string, string> = {
  no_encontrada: "Este enlace de invitación no es válido.",
  cancelada: "Esta invitación fue cancelada por la clínica que te invitó.",
  vencida: "Esta invitación venció. Pedile a la clínica que te envíe una nueva.",
};

export function InvitacionMedico() {
  const { token } = useParams<{ token: string }>();
  const { iniciarSesionConTokensKeycloak } = useAuth();

  const [cargando, setCargando] = useState(true);
  const [invitacion, setInvitacion] = useState<InvitacionPublica | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [colegiatura, setColegiatura] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinAutoLogin, setSinAutoLogin] = useState(false);

  useEffect(() => {
    if (!token) return;
    invitacionesApi
      .obtener(token)
      .then((datos) => {
        setInvitacion(datos);
        // Precarga el nombre que cargó el administrador al invitar, pero
        // queda editable — los datos profesionales los confirma el
        // propio médico, no quien lo invitó.
        if (datos.nombre) setNombre(datos.nombre);
      })
      .catch(() => setErrorCarga("No pudimos consultar esta invitación. Inténtelo de nuevo."))
      .finally(() => setCargando(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setEnviando(true);
    try {
      const resultado = await invitacionesApi.aceptar(token, { nombre, colegiatura, password });
      if (resultado.autoLogin) {
        await iniciarSesionConTokensKeycloak({
          access_token: resultado.access_token,
          refresh_token: resultado.refresh_token,
          expires_in: resultado.expires_in,
        });
        window.location.href = "/workspace";
      } else {
        setSinAutoLogin(true);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const motivo = (err.data as { motivo?: string } | undefined)?.motivo;
        if (motivo && motivo !== "keycloak_existente") {
          // El estado cambió entre que cargamos la pantalla y que
          // enviamos el formulario (ej. alguien más ya la aceptó, o
          // venció mientras completaba los datos) — volvemos a
          // consultar para mostrar la pantalla de estado correcta.
          invitacionesApi.obtener(token).then(setInvitacion);
        }
      } else {
        setError("No pudimos completar el alta. Inténtelo de nuevo.");
      }
    } finally {
      setEnviando(false);
    }
  };

  let contenido: React.ReactNode;

  if (cargando) {
    contenido = <p className="text-text-muted">Cargando…</p>;
  } else if (errorCarga) {
    contenido = <p className="text-error">{errorCarga}</p>;
  } else if (!invitacion || invitacion.estado === "no_encontrada" || invitacion.estado === "cancelada" || invitacion.estado === "vencida") {
    contenido = (
      <div className="text-center">
        <h2 className="text-2xl font-bold text-primary">No pudimos abrir esta invitación</h2>
        <p className="mt-3 text-text-muted">
          {MENSAJES_NO_FORMULARIO[invitacion?.estado ?? "no_encontrada"]}
        </p>
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-accent">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  } else if (invitacion.estado === "aceptada") {
    contenido = (
      <div className="text-center">
        <h2 className="text-2xl font-bold text-primary">Este enlace ya fue utilizado</h2>
        <p className="mt-3 text-text-muted">Si ya completaste tu alta, iniciá sesión con tu cuenta.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-accent">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  } else if (sinAutoLogin) {
    contenido = (
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
          <span className="text-3xl text-success">✓</span>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-primary">Tu cuenta se creó</h2>
        <p className="mt-3 text-text-muted">
          No pudimos iniciar sesión automáticamente. Iniciá sesión manualmente con el correo y la
          contraseña que definiste.
        </p>
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-accent">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  } else {
    contenido = (
      <>
        <h2 className="text-3xl font-bold text-primary">Completá tu alta</h2>
        <p className="mt-2 text-sm text-text-muted">
          {invitacion.nombreClinica ?? "Tu clínica"} te invitó a sumarte como médico veterinario
          {invitacion.email ? ` con el correo ${invitacion.email}` : ""}.
        </p>

        <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
          <Input
            label="Nombre completo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
          />
          <Input
            label="Colegiatura"
            value={colegiatura}
            onChange={(e) => setColegiatura(e.target.value)}
            required
          />
          <Input
            label="Contraseña"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <p className="rounded-lg bg-error/10 px-4 py-2 text-sm text-error" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" fullWidth disabled={enviando}>
            {enviando ? "Creando cuenta…" : "Crear mi cuenta"}
          </Button>
        </form>
      </>
    );
  }

  return (
    <div className="flex min-h-screen w-full">
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
          <h1 className="font-display text-5xl leading-tight">Sumate como médico veterinario</h1>
          <p className="mt-6 max-w-md text-white/70">
            Completá tu registro para empezar a atender casos con el respaldo de inteligencia
            artificial clínica.
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm text-white/50">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="font-semibold text-white/70">V3.2 Activa</span>
          <span>Seguridad garantizada bajo estándares de encriptación médica.</span>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-1/2">
        <div className="w-full max-w-md rounded-2xl bg-surface p-10 shadow-sm">{contenido}</div>
      </div>
    </div>
  );
}
