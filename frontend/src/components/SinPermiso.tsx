import { useNavigate } from "react-router-dom";
import { Button } from "./ui/Button";
import { Card, CardDescription, CardTitle } from "./ui/Card";
import { useAuth } from "../hooks/useAuth";
import { decodeJwtPayload, leerAccessToken } from "../lib/session";
import { rutaDeEntrada } from "../lib/pantallaDeEntrada";

// ---------------------------------------------------------------------
// «ESTA SECCIÓN NO» — defecto del 2026-11-27.
//
// Lo que había decía «Tu usuario no tiene permisos para acceder a esta
// sección de Vetline Ai» y ofrecía UN botón: volver al login. Tres
// cosas mal:
//
//   · no decía con qué usuario se había entrado ni qué se intentó
//     abrir, así que no se podía ni reportar el problema;
//   · el único camino era cerrar la sesión y empezar de nuevo, cuando
//     lo normal es que la persona sí tenga adónde ir;
//   · sacaba a la persona de la aplicación entera por una sección.
//
// Ahora dice quién, qué rol y qué sección, y lleva a su inicio. Cuando
// el rechazo es de una sección puntual se dibuja DENTRO del marco, con
// el menú al lado: la persona sigue en su sistema.
// ---------------------------------------------------------------------

export function SinPermiso({
  seccion,
  /** `true` cuando se dibuja dentro del marco y no como pantalla entera. */
  enElMarco = false,
}: {
  seccion?: string;
  enElMarco?: boolean;
}) {
  const navegar = useNavigate();
  const { user, modulos, pantallaInicio, rolesClinica, logout } = useAuth();

  const miInicio = user
    ? rutaDeEntrada({
        rol: user.rol ?? "",
        esMedico: user.esMedico,
        esAdminClinica: user.esAdminClinica,
        modulos,
        pantallaElegida: pantallaInicio,
        pantallaDelRol: user.pantallaDelRol,
      })
    : "/login";

  const roles = rolesClinica.length > 0 ? rolesClinica.join(", ") : "sin rol asignado";

  // CON QUÉ USUARIO SE ENTRÓ. El id interno no le dice nada a nadie; el
  // correo sí, y viene en el token de Keycloak. Si el token no lo trae,
  // se cae al id antes que a «—»: con el id se puede buscar en la base.
  const claims = decodeJwtPayload(leerAccessToken() ?? "");
  const quien =
    (claims?.email as string | undefined) ??
    (claims?.preferred_username as string | undefined) ??
    (claims?.name as string | undefined) ??
    user?.userId ??
    "—";

  const contenido = (
    <Card>
      <CardTitle>Esta sección no está habilitada para su rol</CardTitle>
      <CardDescription>
        {seccion ? (
          <>
            Intentó abrir <strong>{seccion}</strong>, y su rol no la incluye.
          </>
        ) : (
          "Su rol no incluye esta sección."
        )}{" "}
        No es un error del sistema: cada rol ve lo suyo. Si necesita entrar acá, pídale a quien
        administra el personal que le agregue el permiso.
      </CardDescription>

      <dl className="mt-4 grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-text-muted">Entró como:</dt>
          <dd className="font-semibold text-text-primary">{quien}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-text-muted">Rol:</dt>
          <dd className="font-semibold text-text-primary">{roles}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-3">
        <Button onClick={() => navegar(miInicio)}>Ir a mi inicio</Button>
        <Button variant="secondary" onClick={() => logout()}>
          Cerrar sesión
        </Button>
      </div>
    </Card>
  );

  if (enElMarco) return <div className="mt-4">{contenido}</div>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-lg">{contenido}</div>
    </div>
  );
}
