import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, EstadoSuscripcionResumen } from "../lib/adminApi";

// Pantallas faltantes, Prompt B, Paso 1 — barra persistente en toda la
// app mientras la suscripción esté en 'ventana_purga'. Tono informativo,
// no punitivo (pedido explícito del prompt): el cliente todavía puede
// convertirse, y esta barra es el último punto de contacto comercial, no
// una advertencia de castigo.
//
// Vetline_Ai_Suspension_Bloqueo.md — se amplía para cubrir también
// 'suspendida' (Pantalla 2 del spec) y para distinguir, dentro de
// 'ventana_purga', el cierre por impago prolongado (Pantalla 3) de una
// prueba no convertida — mismo componente, tono y ubicación (montado una
// sola vez en AdminLayout), porque ambos casos comparten la regla de
// "nunca se interrumpe el acceso clínico" que es lo que más ansiedad
// evita en los dos.
export function BarraVentanaPurga() {
  const [estado, setEstado] = useState<EstadoSuscripcionResumen | null>(null);

  useEffect(() => {
    adminApi
      .obtenerEstadoSuscripcion()
      .then(setEstado)
      .catch(() => {});
  }, []);

  if (!estado) return null;

  if (estado.estado === "suspendida") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
        <p className="text-text">
          <span className="font-semibold">Tu suscripción está suspendida.</span> No se otorgará crédito nuevo
          para agentes de inteligencia artificial, pero puede seguir utilizando el saldo existente en su cuenta.
          El acceso a expedientes, agenda, recetas e informes clínicos NO se interrumpe en ningún momento.
        </p>
        <Link
          to="/admin/facturacion/medio-de-pago"
          className="flex-shrink-0 rounded-lg bg-warning px-3 py-1.5 font-semibold text-white hover:opacity-90"
        >
          Regularizar suscripción
        </Link>
      </div>
    );
  }

  if (estado.estado !== "ventana_purga") return null;

  const dias = estado.diasRestantes ?? 0;
  const esImpago = estado.ventanaPurgaOrigen === "impago";
  const urgente = dias < 3;

  const textoDias =
    dias === 0
      ? "Tus datos se eliminan hoy."
      : dias === 1
        ? "Queda 1 día antes de eliminar tus datos."
        : `Quedan ${dias} días antes de eliminar tus datos.`;

  const encabezado = esImpago
    ? "Tu cuenta entró en ventana de cierre por impago prolongado."
    : "Tu período de prueba terminó.";

  const accionPrincipal = esImpago
    ? { texto: "Regularizar mi pago", to: "/admin/facturacion/medio-de-pago" }
    : { texto: "Contratar un plan", to: "/admin/plan-consumo/cambiar-plan" };

  return (
    <div
      className={[
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
        urgente ? "border-error/40 bg-error/10" : "border-warning/40 bg-warning/10",
      ].join(" ")}
    >
      <p className="text-text">
        <span className="font-semibold">{encabezado}</span> {textoDias} Todavía puede consultar sus casos y
        llevarte tu información.
      </p>
      <div className="flex flex-shrink-0 gap-2">
        <Link
          to="/admin/plan-consumo/exportar"
          className="rounded-lg border border-primary px-3 py-1.5 font-semibold text-primary hover:bg-primary/5"
        >
          Exportar datos
        </Link>
        <Link
          to={accionPrincipal.to}
          className={[
            "rounded-lg px-3 py-1.5 font-semibold text-white hover:opacity-90",
            urgente ? "bg-error" : "bg-primary hover:bg-secondary",
          ].join(" ")}
        >
          {accionPrincipal.texto}
        </Link>
      </div>
    </div>
  );
}
