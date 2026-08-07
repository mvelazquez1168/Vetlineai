import { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Modal } from "./ui/Modal";
import { useAuth } from "../hooks/useAuth";
import { adminApi } from "../lib/adminApi";
import { ApiError } from "../lib/api";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Prompt de verificación de correo, Capa 3 — un solo componente, dos
// puntos de entrada (BarraVerificacionCorreo y Datos de la Clínica), no
// dos implementaciones. El username de Keycloak cambia junto con el
// correo (username=email en este reino) — la sesión actual queda
// inválida en la práctica apenas cambia, así que cerramos sesión acá
// mismo y avisamos que el próximo login es con la dirección nueva.
export function ModalCorregirCorreo({
  open,
  onClose,
  emailActual,
}: {
  open: boolean;
  onClose: () => void;
  emailActual: string;
}) {
  const { logout } = useAuth();
  const [email, setEmail] = useState(emailActual);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const emailValido = EMAIL_REGEX.test(email.trim());

  const confirmar = async () => {
    setError(null);
    setGuardando(true);
    try {
      await adminApi.cambiarMiCorreo(email.trim());
      setListo(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No pudimos cambiar tu correo. Intentá de nuevo."
      );
    } finally {
      setGuardando(false);
    }
  };

  const cerrar = () => {
    setListo(false);
    setError(null);
    onClose();
  };

  if (listo) {
    return (
      <Modal open={open} onClose={cerrar} title="Correo actualizado">
        <p className="text-sm text-text-muted">
          Te mandamos un nuevo enlace de verificación a <strong>{email.trim()}</strong>. Desde ahora
          iniciá sesión con esa dirección — vamos a cerrar tu sesión actual.
        </p>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => { cerrar(); logout(); }}>Entendido</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={cerrar}
      title="Corregir mi correo"
      description="Es el correo con el que iniciás sesión y recibís los avisos importantes de tu clínica."
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!emailValido || email.trim() === emailActual || guardando}>
            {guardando ? "Guardando…" : "Guardar y reenviar verificación"}
          </Button>
        </>
      }
    >
      <Input
        label="Nuevo correo"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={!emailValido && email ? "Formato de correo inválido." : undefined}
      />
      {error && <p className="mt-3 text-sm text-error">{error}</p>}
    </Modal>
  );
}
