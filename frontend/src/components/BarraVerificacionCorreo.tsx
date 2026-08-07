import { useEffect, useState } from "react";
import { adminApi, EstadoMiCorreo } from "../lib/adminApi";
import { ModalCorregirCorreo } from "./ModalCorregirCorreo";

// Prompt de verificación de correo, Capas 2/3 — barra persistente mientras
// el correo del administrador no esté verificado. Mismo lugar que
// BarraVentanaPurga (AdminLayout), mismo criterio de "no punitivo": el
// resto del producto sigue disponible, esto solo explica por qué el
// crédito de prueba está retenido y ofrece corregirlo si rebotó.
export function BarraVerificacionCorreo() {
  const [estado, setEstado] = useState<EstadoMiCorreo | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  const recargar = () => {
    adminApi
      .obtenerEstadoMiCorreo()
      .then(setEstado)
      .catch(() => {});
  };

  useEffect(recargar, []);

  if (!estado || estado.verificado) return null;

  return (
    <>
      <div
        className={[
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
          estado.rebotado ? "border-error/40 bg-error/10" : "border-accent/40 bg-accent/10",
        ].join(" ")}
      >
        <p className="text-text">
          {estado.rebotado ? (
            <>
              <span className="font-semibold">El correo de verificación rebotó.</span> Revisá si{" "}
              <strong>{estado.email}</strong> está bien escrito.
            </>
          ) : (
            <>
              <span className="font-semibold">Verificá tu correo.</span> Te mandamos un enlace a{" "}
              <strong>{estado.email}</strong> — hasta que lo confirmes, el crédito de prueba queda retenido.
            </>
          )}
        </p>
        <button
          onClick={() => setModalAbierto(true)}
          className="flex-shrink-0 rounded-lg border border-primary px-3 py-1.5 font-semibold text-primary hover:bg-primary/5"
        >
          Corregir mi correo
        </button>
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
