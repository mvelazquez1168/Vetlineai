import { ConsumoWorkspace, MotivoRechazoGeneracion } from "../../lib/workspaceApi";

// ---------------------------------------------------------------------
// Implementación de pantallas, prompt 1 — barra de consumo de prueba +
// avisos de saldo + manejo de rechazo del médico. El frontend NUNCA
// calcula umbrales ni compone el texto de los avisos de saldo (eso ya lo
// resolvió el backend en usoIa.ts/tarifas.ts) — acá solo se elige el tono
// visual (color/ícono) según el campo estructurado que manda el backend.
// ---------------------------------------------------------------------

type Tono = "normal" | "info" | "warning" | "error";

const TONO_CLASES: Record<Tono, string> = {
  normal: "border-black/5 bg-surface text-text-primary",
  info: "border-accent/30 bg-accent/5 text-text-primary",
  warning: "border-warning/40 bg-warning/10 text-text-primary",
  error: "border-error/40 bg-error/10 text-text-primary",
};

// PASO 2 — Barra de consumo de la prueba. Visible solo cuando la
// suscripción está en prueba. El único cálculo que hace el frontend acá
// es de presentación (formatear USD/días) — el propio umbral del 80% ya
// viene resuelto en `prueba.umbralAlcanzado`.
function BarraDePrueba({ prueba }: { prueba: NonNullable<ConsumoWorkspace["prueba"]> }) {
  const tono: Tono = prueba.umbralAlcanzado ? "warning" : "normal";
  return (
    <div className={["rounded-2xl border p-4", TONO_CLASES[tono]].join(" ")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Estás en período de prueba</p>
          <p className="text-sm text-text-muted">
            Crédito restante: <span className="font-semibold text-text-primary">USD {prueba.creditoRestanteUsd.toFixed(2)}</span>
            {" · "}
            {prueba.diasRestantes === 1 ? "1 día restante" : `${prueba.diasRestantes} días restantes`}
          </p>
        </div>
      </div>
      {prueba.umbralAlcanzado && (
        <p className="mt-2 text-sm font-medium text-warning">
          Ya usaste la mayor parte del crédito de tu prueba — contratá un plan para seguir sin interrupciones.
        </p>
      )}
    </div>
  );
}

// PASO 3 — Aviso de saldo (clínicas con plan pago, fuera de prueba). El
// médico nunca puede recargar: el mensaje que compone el backend ya
// orienta a avisar al administrador, acá solo se elige el tono.
const TONO_POR_UMBRAL: Record<NonNullable<ConsumoWorkspace["aviso"]>["umbral"], Tono> = {
  saldo_bajo: "info",
  saldo_agotado: "warning",
  colchon_agotado: "error",
};

function AvisoDeSaldo({ aviso }: { aviso: NonNullable<ConsumoWorkspace["aviso"]> }) {
  const tono = TONO_POR_UMBRAL[aviso.umbral];
  return (
    <div className={["rounded-2xl border p-4 text-sm", TONO_CLASES[tono]].join(" ")}>
      <p className="font-medium">{aviso.mensaje}</p>
      {aviso.umbral === "colchon_agotado" && (
        <p className="mt-1 text-xs text-text-muted">
          La generación con IA está detenida hasta que se recargue saldo.
        </p>
      )}
    </div>
  );
}

export function ConsumoBanner({ consumo }: { consumo: ConsumoWorkspace | null }) {
  if (!consumo) return null;
  if (consumo.prueba) return <BarraDePrueba prueba={consumo.prueba} />;
  if (consumo.aviso) return <AvisoDeSaldo aviso={consumo.aviso} />;
  return null;
}

// PASO 4 — Actualizar dashboard y generar informe se deshabilitan JUNTOS
// únicamente por colchon_agotado (el único estado donde el backend
// realmente detiene la generación — saldo_bajo/saldo_agotado son
// informativos, la generación sigue funcionando gracias al colchón).
export function generacionDetenidaPorSaldo(consumo: ConsumoWorkspace | null): boolean {
  return consumo?.aviso?.umbral === "colchon_agotado";
}

// PASO 5 — Manejo del rechazo estructurado de una generación (402). El
// texto siempre es el que compone el backend (mensajeRechazoGeneracion en
// tarifas.ts) — acá solo se elige el tono/ícono según el motivo, nunca se
// inventa texto nuevo ni se muestra el motivo crudo. `motivo` puede venir
// ausente (el único camino que todavía no lo manda es el límite de uso
// heredado, ver memoria del proyecto) — en ese caso se usa un tono neutro.
const TONO_POR_MOTIVO: Record<MotivoRechazoGeneracion, Tono> = {
  sin_saldo: "warning",
  colchon_agotado: "error",
  agente_no_habilitado: "warning",
  agente_en_mantenimiento: "warning",
  suscripcion_finalizada: "error",
  fuera_de_ventana: "warning",
};

export function RechazoGeneracionAviso({ error, motivo }: { error: string; motivo?: MotivoRechazoGeneracion }) {
  const tono: Tono = motivo ? TONO_POR_MOTIVO[motivo] : "warning";
  return <div className={["rounded-xl border p-3 text-sm font-medium", TONO_CLASES[tono]].join(" ")}>{error}</div>;
}

// PASO 6 — Aviso de suficiencia clínica. Se apoya en los mismos 3 campos
// estructurados + el mínimo de mensajes que ya usa la compuerta real del
// backend (casos.routes.ts: especie/raza/motivo + DASHBOARD_MENSAJES_MINIMOS/
// INFORME_MENSAJES_MINIMOS = 2 ambos) — el frontend ya tenía esos datos
// cargados para otros fines, así que no hace falta ningún endpoint nuevo.
// Es un espejo puramente informativo del lado del cliente: si el umbral
// de mensajes cambiara algún día solo en el backend, en el peor caso este
// aviso queda desactualizado un tiempo, pero la compuerta real (que sí
// bloquea) sigue siendo la del backend — nunca al revés.
const MENSAJES_MINIMOS = 2;

export interface SuficienciaClinica {
  suficiente: boolean;
  faltantes: string[];
}

export function calcularSuficienciaClinica(
  detalle: { especie?: string | null; raza?: string | null; motivo?: string | null } | null,
  cantidadMensajes: number
): SuficienciaClinica {
  const faltantes: string[] = [];
  if (!detalle?.especie) faltantes.push("la especie del paciente");
  if (!detalle?.raza) faltantes.push("la raza del paciente");
  if (!detalle?.motivo?.trim()) faltantes.push("el motivo de consulta");
  if (cantidadMensajes < MENSAJES_MINIMOS) faltantes.push("más historial de conversación");
  return { suficiente: faltantes.length === 0, faltantes };
}

export function AvisoSuficienciaClinica({ suficiencia }: { suficiencia: SuficienciaClinica }) {
  if (suficiencia.suficiente) return null;
  return (
    <p className="text-xs text-text-muted">
      Para un análisis más completo, todavía falta: {suficiencia.faltantes.join(", ")}.
    </p>
  );
}
