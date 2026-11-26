import { AlertaExpediente } from "../../lib/expedienteApi";
import { Icono } from "../ui";

// ---------------------------------------------------------------------
// LA FRANJA DE ALERTAS — sección 2 del prompt 07.
//
// Va arriba de todo y antes de cualquier dato, porque su razón de ser es
// que se lea ANTES de tocar al animal: una alergia grave, el perro que
// muerde al cortarle las uñas, el bulto que encontró el groomer, la
// vacuna vencida, el resultado de laboratorio que nadie miró.
//
// EL COLOR NO ES LA ÚNICA FORMA DE LEERLA (guía rectora §4.1): cada
// alerta lleva su ícono y su texto diciendo qué es. Una franja que solo
// cambia de color no sirve para quien no distingue el rojo del ámbar, y
// tampoco para quien la imprime.
//
// Las de severidad ALTA van primero y con más peso visual. El orden lo
// decide el backend, que es el que sabe de dónde salió cada una.
// ---------------------------------------------------------------------

const ICONO: Record<AlertaExpediente["tipo"], "aviso" | "info" | "campana" | "vacuna" | "panel"> = {
  alergia: "aviso",
  manejo: "aviso",
  cronico: "info",
  preventivo: "vacuna",
  saldo: "info",
  hallazgo: "campana",
  estudio: "panel",
};

const ETIQUETA_TIPO: Record<AlertaExpediente["tipo"], string> = {
  alergia: "Alergia",
  manejo: "Manejo",
  cronico: "Crónico",
  preventivo: "Preventivo",
  saldo: "Cuenta",
  hallazgo: "Hallazgo",
  estudio: "Laboratorio",
};

export function FranjaAlertas({ alertas }: { alertas: AlertaExpediente[] }) {
  if (alertas.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-black/5 bg-surface px-4 py-2.5 text-sm text-text-muted">
        Sin alertas: no hay alergias registradas, preventivos vencidos ni hallazgos pendientes.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {alertas.map((a, i) => (
        <div
          key={`${a.tipo}-${i}`}
          className={[
            "flex items-start gap-2 rounded-lg px-4 py-2.5 text-sm",
            a.severidad === "alta"
              ? "bg-error/15 font-semibold text-text-primary"
              : "bg-warning/15 text-text-primary",
          ].join(" ")}
        >
          <Icono nombre={ICONO[a.tipo]} tamano={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="text-xs font-bold uppercase tracking-wide text-text-muted">
              {ETIQUETA_TIPO[a.tipo]}
            </span>{" "}
            {a.texto}
            {a.detalle && (
              <span className="block text-xs font-normal text-text-muted">{a.detalle}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
