import { useEffect, useState } from "react";
import { Badge, Button, LoadingState, Select, useToast } from "../ui";
import { etiqueta } from "../../lib/etiquetas";
import {
  CambioConsentimiento,
  ConsentimientoCrm,
  PoliticasCrm,
  crmApi,
} from "../../lib/crmApi";

// ---------------------------------------------------------------------
// CONSENTIMIENTOS Y PREFERENCIAS — prompt 03, secciones 4 y 7.
//
// LO QUE ESTA PANTALLA TIENE QUE DEJAR CLARO es que «salud y servicio»
// no es lo mismo que «promociones». Por eso son dos filas separadas con
// su explicación, y no dos casillas con una etiqueta técnica: quien
// atiende al cliente tiene que poder decirle qué está marcando.
//
// EL HISTORIAL ESTÁ A LA VISTA y no detrás de un botón: es la respuesta
// a «yo nunca autoricé esto», y esa pregunta llega por teléfono.
// ---------------------------------------------------------------------

interface Props {
  propietarioId: string;
  /** La recepción puede cambiarlos; el prompt lo pide así. */
  puedeEditar: boolean;
}

const FINALIDADES: Array<{
  valor: "salud" | "promociones";
  titulo: string;
  explicacion: string;
}> = [
  {
    valor: "salud",
    titulo: "Salud y servicio",
    explicacion:
      "Recordatorios de citas, vacunas y desparasitaciones, resultados y comprobantes. Es lo que la clínica le debe al cliente.",
  },
  {
    valor: "promociones",
    titulo: "Promociones",
    explicacion:
      "Campañas y ofertas. Hace falta que el cliente lo autorice; si no lo autorizó, no sale.",
  },
];

const CANALES: Array<{ valor: "correo" | "whatsapp"; titulo: string }> = [
  { valor: "correo", titulo: "Correo" },
  { valor: "whatsapp", titulo: "WhatsApp" },
];

export function PanelConsentimientos({ propietarioId, puedeEditar }: Props) {
  const toast = useToast();
  const [consentimientos, setConsentimientos] = useState<ConsentimientoCrm[]>([]);
  const [historial, setHistorial] = useState<CambioConsentimiento[]>([]);
  const [preferencias, setPreferencias] = useState<{
    canalPreferido: "correo" | "whatsapp" | null;
    horaDesde: string | null;
    horaHasta: string | null;
  }>({ canalPreferido: null, horaDesde: null, horaHasta: null });
  const [politicas, setPoliticas] = useState<PoliticasCrm | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const cargar = () => {
    setCargando(true);
    crmApi
      .consentimientos(propietarioId)
      .then((r) => {
        setConsentimientos(r.consentimientos);
        setHistorial(r.historial);
        setPreferencias(r.preferencias);
        setPoliticas(r.politicas);
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  };

  useEffect(cargar, [propietarioId]);

  const valor = (canal: string, finalidad: string): boolean | null => {
    const c = consentimientos.find((x) => x.canal === canal && x.finalidad === finalidad);
    return c ? c.otorgado : null;
  };

  // ---------------------------------------------------------------------
  // SI EL CANAL PREFERIDO NO SIRVE, DECIRLO ACÁ (anexo 07-03, B4).
  //
  // El envío ya no se cae cuando el preferido no está consentido: se usa
  // el siguiente que sí lo esté. Pero entonces la clínica cree que le
  // está escribiendo por WhatsApp y le está escribiendo por correo, y
  // sin este aviso no hay forma de saberlo desde la ficha.
  //
  // LA REGLA ES LA MISMA QUE LA DEL SERVIDOR, a propósito: sin fila,
  // salud SÍ sale (es lo que la clínica le debe al cliente) y
  // promociones NO (es opt-in). Calcularlo distinto acá haría que la
  // ficha prometa lo contrario de lo que pasa.
  // ---------------------------------------------------------------------
  const saleHoy = (canal: string, finalidad: string): boolean => {
    const v = valor(canal, finalidad);
    return v === null ? finalidad === "salud" : v;
  };
  const preferido = preferencias.canalPreferido;
  const otro = preferido === "correo" ? "whatsapp" : "correo";
  const avisoCanal =
    !preferido || saleHoy(preferido, "salud")
      ? null
      : saleHoy(otro, "salud")
        ? `Prefiere ${etiqueta(preferido)} pero no autorizó los avisos de salud por ahí: le van a salir por ${etiqueta(otro)}.`
        : `Prefiere ${etiqueta(preferido)} y no autorizó ningún canal para los avisos de salud: no le va a salir ninguno.`;

  const cambiar = async (canal: string, finalidad: string, otorgado: boolean) => {
    // La casilla cambia EN EL ACTO y despues se guarda. Es un control
    // controlado: sin esto, quien la marca ve la casilla volver a su
    // lugar hasta que el servidor contesta, y el clic parece no haber
    // pasado. Si el guardado falla, la recarga vuelve a la verdad.
    setConsentimientos((cs) => [
      ...cs.filter((c) => !(c.canal === canal && c.finalidad === finalidad)),
      {
        canal: canal as "correo" | "whatsapp",
        finalidad: finalidad as "salud" | "promociones",
        otorgado,
        actualizado_en: new Date().toISOString(),
      },
    ]);
    setOcupado(true);
    try {
      await crmApi.guardarConsentimiento(propietarioId, { canal, finalidad, otorgado });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
      cargar();
    }
  };

  const guardarPreferencias = async (cambios: Record<string, unknown>) => {
    setOcupado(true);
    try {
      await crmApi.guardarPreferencias(propietarioId, { ...preferencias, ...cambios });
      cargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" cantidad={4} />;

  return (
    <div className="space-y-4">
      {FINALIDADES.map((f) => (
        <div key={f.valor} className="rounded-lg border border-black/5 p-3">
          <p className="text-sm font-semibold text-text-primary">{f.titulo}</p>
          <p className="mt-0.5 text-xs text-text-muted">{f.explicacion}</p>
          <div className="mt-2 flex flex-wrap gap-4">
            {CANALES.map((c) => {
              const v = valor(c.valor, f.valor);
              return (
                <label key={c.valor} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-black/20"
                    checked={v === true}
                    disabled={!puedeEditar || ocupado}
                    onChange={(e) => cambiar(c.valor, f.valor, e.target.checked)}
                  />
                  {c.titulo}
                  {v === null && (
                    <span className="text-xs text-text-muted">
                      {f.valor === "salud" ? "(sin registrar: sale)" : "(sin registrar: no sale)"}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded-lg border border-black/5 p-3">
        <p className="text-sm font-semibold text-text-primary">Preferencias de contacto</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <Select
            label="Canal preferido"
            value={preferencias.canalPreferido ?? ""}
            disabled={!puedeEditar || ocupado}
            onChange={(e) => guardarPreferencias({ canalPreferido: e.target.value || null })}
            options={[
              { value: "", label: "El que haya" },
              { value: "correo", label: "Correo" },
              { value: "whatsapp", label: "WhatsApp" },
            ]}
          />
          <div>
            <label className="text-sm font-semibold text-text-primary">No antes de</label>
            <input
              type="time"
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
              value={preferencias.horaDesde ?? ""}
              disabled={!puedeEditar || ocupado}
              onChange={(e) => guardarPreferencias({ horaDesde: e.target.value || null })}
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-text-primary">No después de</label>
            <input
              type="time"
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
              value={preferencias.horaHasta ?? ""}
              disabled={!puedeEditar || ocupado}
              onChange={(e) => guardarPreferencias({ horaHasta: e.target.value || null })}
            />
          </div>
        </div>
        {avisoCanal && (
          <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
            {avisoCanal}
          </p>
        )}
        {politicas && (
          <p className="mt-2 text-xs text-text-muted">
            Sin franja propia, rige la de la clínica: {politicas.horaDesde}–{politicas.horaHasta}.
            Tope de promociones: {politicas.topePromocionesMes} por mes. Un mismo aviso no se
            repite antes de {politicas.ventanaDuplicadoHoras} horas.
          </p>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-text-primary">Historial</p>
        <p className="mt-0.5 text-xs text-text-muted">
          Cada cambio, con su fecha y de dónde salió. No se edita ni se borra: es la prueba de qué
          autorizó el cliente.
        </p>
        {historial.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Todavía no hay cambios registrados.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {historial.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={h.otorgado ? "success" : "neutral"}>
                  {h.otorgado ? "autorizó" : "retiró"}
                </Badge>
                <span className="text-text-primary">
                  {h.finalidad} por {h.canal}
                </span>
                <span className="text-text-muted">
                  {new Date(h.creado_en).toLocaleDateString("es-CR")} · {ETIQUETA_FUENTE[h.fuente] ?? h.fuente}
                  {h.registrado_por_nombre ? ` · ${h.registrado_por_nombre}` : ""}
                </span>
                {h.nota && <span className="text-text-muted">— {h.nota}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!puedeEditar && (
        <p className="text-xs text-text-muted">
          Para cambiar un consentimiento hace falta ser parte del personal de la clínica.
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={cargar} disabled={ocupado}>
          Actualizar
        </Button>
      </div>
    </div>
  );
}

const ETIQUETA_FUENTE: Record<string, string> = {
  registro: "formulario de registro",
  recepcion: "recepción",
  respuesta_cliente: "respuesta del cliente",
  importacion: "importación",
  existente_al_habilitar: "cliente que ya existía",
};
