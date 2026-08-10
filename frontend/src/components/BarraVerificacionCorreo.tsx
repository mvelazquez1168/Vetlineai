import { useEffect, useState } from "react";
import { adminApi, EstadoMiCorreo } from "../lib/adminApi";
import { ApiError } from "../lib/api";
import { formatearHora } from "../lib/formatFecha";
import { useAuth } from "../hooks/useAuth";
import { ModalCorregirCorreo } from "./ModalCorregirCorreo";

// Prompt de verificación de correo, Capas 2/3 — barra persistente mientras
// el correo del administrador no esté verificado. Mismo lugar que
// BarraVentanaPurga (AdminLayout), mismo criterio de "no punitivo": el
// resto del producto sigue disponible, esto solo explica por qué el
// crédito de prueba está retenido y ofrece corregirlo si rebotó.
//
// prompt_code_reenvio_verificacion — antes esto solo tenía "Corregir mi
// correo", que exige cambiar la dirección para habilitarse (ver
// ModalCorregirCorreo). Con una dirección correcta y un enlace que no
// funciona, eso dejaba al usuario sin ninguna salida real — y de paso era
// la causa del reporte de "el token no coincide": la única vía de
// recuperación disponible reescribía el token silenciosamente apenas
// alguien la usaba para reintentar, no para corregir un error real. Ahora
// hay dos botones separados para las dos situaciones distintas: "no me
// llegó" reenvía sin tocar la dirección; "lo escribí mal" sigue abriendo
// el modal de siempre.
export function BarraVerificacionCorreo() {
  const { zonaHoraria } = useAuth();
  const [estado, setEstado] = useState<EstadoMiCorreo | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [mensajeReenvio, setMensajeReenvio] = useState<string | null>(null);

  const recargar = () => {
    adminApi
      .obtenerEstadoMiCorreo()
      .then(setEstado)
      .catch(() => {});
  };

  useEffect(recargar, []);

  const reenviar = async () => {
    setReenviando(true);
    setMensajeReenvio(null);
    try {
      await adminApi.reenviarVerificacionCorreo();
      setMensajeReenvio("Te mandamos un enlace nuevo — el anterior dejó de funcionar.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const disponibleEn = (err.data as { disponibleEn?: string } | null)?.disponibleEn;
        setMensajeReenvio(
          disponibleEn
            ? `Ya pediste el máximo de reenvíos por ahora. Podés volver a intentarlo a partir de las ${formatearHora(
                disponibleEn,
                zonaHoraria
              )}.`
            : "Ya pediste el máximo de reenvíos por ahora — probá de nuevo en un rato."
        );
      } else {
        setMensajeReenvio(err instanceof ApiError ? err.message : "No pudimos reenviar el correo. Intentá de nuevo.");
      }
    } finally {
      setReenviando(false);
    }
  };

  if (!estado || estado.verificado) return null;

  return (
    <>
      <div
        className={[
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
          estado.rebotado ? "border-error/40 bg-error/10" : "border-accent/40 bg-accent/10",
        ].join(" ")}
      >
        <div>
          <p className="text-text">
            {estado.rebotado ? (
              <>
                <span className="font-semibold">El correo de verificación rebotó.</span> Revisá si{" "}
                <strong>{estado.email}</strong> está bien escrito — si lo está, pedí que te lo reenvíen.
              </>
            ) : (
              <>
                <span className="font-semibold">Verificá tu correo.</span> Te mandamos un enlace a{" "}
                <strong>{estado.email}</strong> — hasta que lo confirmes, el crédito de prueba queda retenido.
              </>
            )}
          </p>
          {mensajeReenvio && <p className="mt-1 text-text-muted">{mensajeReenvio}</p>}
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <button
            onClick={reenviar}
            disabled={reenviando}
            className="rounded-lg border border-primary px-3 py-1.5 font-semibold text-primary hover:bg-primary/5 disabled:opacity-60"
          >
            {reenviando ? "Reenviando…" : "No me llegó — reenviar"}
          </button>
          <button
            onClick={() => setModalAbierto(true)}
            className="rounded-lg border border-primary px-3 py-1.5 font-semibold text-primary hover:bg-primary/5"
          >
            Lo escribí mal — corregir
          </button>
        </div>
      </div>

      <ModalCorregirCorreo
        open={modalAbierto}
        onClose={() => {
          setModalAbierto(false);
          recargar();
        }}
        emailActual={estado.email}
      />
    </>
  );
}
