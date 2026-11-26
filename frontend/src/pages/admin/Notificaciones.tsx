import { PageHeader } from "../../components/ui";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardDescription, CardTitle } from "../../components/ui/Card";
import { adminApi, ConfiguracionNotificaciones } from "../../lib/adminApi";

// prompt_code_notificaciones, PARTE C — pantalla dedicada de configuración
// de notificaciones. Solo las que realmente envían de verdad (ver
// verificación del prompt); ni acá ni en el backend se expone ningún
// canal de envío — hoy es siempre correo, y mostrar un selector sin otra
// opción real se percibiría como una carencia del producto.
//
// prompt_code_notificaciones_pendientes.md, Parte D — con 9 avisos la
// pantalla se agrupa por destinatario (clientes / médicos), cada sección
// con la cuenta de cuántos están activos — sin diseño de Figma para esto
// (no lo tenía tampoco la pantalla anterior).

function ToggleDestinatario({ activo, onChange, disabled }: { activo: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={activo}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="h-6 w-11 rounded-full bg-black/10 peer-checked:bg-accent peer-disabled:opacity-50" />
      <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
    </label>
  );
}

function SeccionHeader({ titulo, activos, total }: { titulo: string; activos: number; total: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">{titulo}</h2>
      <span className="text-xs text-text-muted">
        {activos} de {total} activos
      </span>
    </div>
  );
}

export function Notificaciones() {
  const [config, setConfig] = useState<ConfiguracionNotificaciones | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .obtenerConfiguracionNotificaciones()
      .then((c) => {
        setConfig(c);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  const actualizarCampo = (campo: keyof ConfiguracionNotificaciones, valor: boolean | number) => {
    setConfig((prev) => (prev ? { ...prev, [campo]: valor } : prev));
  };

  const guardar = async () => {
    if (!config) return;
    setGuardando(true);
    setMensaje(null);
    setError(null);
    try {
      const actualizado = await adminApi.actualizarConfiguracionNotificaciones(config);
      setConfig(actualizado);
      setMensaje("Cambios guardados.");
    } catch (err: any) {
      setError(err?.message ?? "No pudimos guardar los cambios.");
    } finally {
      setGuardando(false);
    }
  };

  if (isLoading || !config) {
    return <p className="text-text-muted">Cargando…</p>;
  }

  const avisosClientes: (keyof ConfiguracionNotificaciones)[] = [
    "recordatorioCitaActivo",
    "confirmacionCitaActivo",
    "cancelacionCitaActivo",
    "desparasitacionActivo",
    "vacunacionActivo",
    "seguimientoPosteriorActivo",
    "informeDisponibleActivo",
    "cumpleanosActivo",
  ];
  const avisosMedicos: (keyof ConfiguracionNotificaciones)[] = ["seguimientoFaltanteActivo", "agendaDiaSiguienteActivo"];
  const activosClientes = avisosClientes.filter((k) => config[k]).length;
  const activosMedicos = avisosMedicos.filter((k) => config[k]).length;

  return (
    <div>
      <PageHeader
        titulo="Notificaciones"
        subtitulo="Estos avisos se envían automáticamente en nombre de tu clínica."
        icono="campana"
        modulo="admin"
      />

      <div className="mt-8 max-w-2xl space-y-8">
        <div className="space-y-6">
          <SeccionHeader titulo="Avisos a tus clientes" activos={activosClientes} total={avisosClientes.length} />

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Recordatorio de cita</CardTitle>
                  <Badge variant="info">a tus clientes</Badge>
                </div>
                <CardDescription className="mt-1">
                  Aviso de recordatorio para que los dueños de mascotas no olviden su cita programada.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.recordatorioCitaActivo}
                onChange={(v) => actualizarCampo("recordatorioCitaActivo", v)}
              />
            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-black/5 pt-4">
              <label className="text-sm font-semibold text-text-primary">Anticipación del envío</label>
              <input
                type="number"
                min={1}
                max={168}
                value={config.horasAvisoRecordatorioCita}
                disabled={!config.recordatorioCitaActivo}
                onChange={(e) => actualizarCampo("horasAvisoRecordatorioCita", Number(e.target.value))}
                className="w-20 rounded-lg border border-black/10 bg-background px-3 py-1.5 text-sm disabled:opacity-50"
              />
              <span className="text-sm text-text-muted">horas antes</span>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Confirmación de cita</CardTitle>
                  <Badge variant="info">a tus clientes</Badge>
                </div>
                <CardDescription className="mt-1">
                  Al agendar un turno, confirma al instante que quedó registrado — fecha, hora, médico y paciente.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.confirmacionCitaActivo}
                onChange={(v) => actualizarCampo("confirmacionCitaActivo", v)}
              />
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Cita cancelada o reprogramada</CardTitle>
                  <Badge variant="info">a tus clientes</Badge>
                </div>
                <CardDescription className="mt-1">
                  Avisa apenas la clínica mueve o cancela un turno, para que nadie se presente a una cita que ya no existe.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.cancelacionCitaActivo}
                onChange={(v) => actualizarCampo("cancelacionCitaActivo", v)}
              />
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Desparasitación próxima a vencer</CardTitle>
                  <Badge variant="info">a tus clientes</Badge>
                </div>
                <CardDescription className="mt-1">
                  Aviso preventivo cuando se acerca la fecha sugerida de su siguiente dosis.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.desparasitacionActivo}
                onChange={(v) => actualizarCampo("desparasitacionActivo", v)}
              />
            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-black/5 pt-4">
              <label className="text-sm font-semibold text-text-primary">Margen de aviso previo</label>
              <input
                type="number"
                min={1}
                max={90}
                value={config.diasAvisoDesparasitacion}
                disabled={!config.desparasitacionActivo}
                onChange={(e) => actualizarCampo("diasAvisoDesparasitacion", Number(e.target.value))}
                className="w-20 rounded-lg border border-black/10 bg-background px-3 py-1.5 text-sm disabled:opacity-50"
              />
              <span className="text-sm text-text-muted">días antes</span>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Vacunación próxima a vencer</CardTitle>
                  <Badge variant="info">a tus clientes</Badge>
                </div>
                <CardDescription className="mt-1">
                  Aviso preventivo cuando se acerca la fecha recomendada de la próxima vacuna.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.vacunacionActivo}
                onChange={(v) => actualizarCampo("vacunacionActivo", v)}
              />
            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-black/5 pt-4">
              <label className="text-sm font-semibold text-text-primary">Margen de aviso previo</label>
              <input
                type="number"
                min={1}
                max={90}
                value={config.diasAvisoVacunacion}
                disabled={!config.vacunacionActivo}
                onChange={(e) => actualizarCampo("diasAvisoVacunacion", Number(e.target.value))}
                className="w-20 rounded-lg border border-black/10 bg-background px-3 py-1.5 text-sm disabled:opacity-50"
              />
              <span className="text-sm text-text-muted">días antes</span>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Seguimiento posterior a la consulta</CardTitle>
                  <Badge variant="info">a tus clientes</Badge>
                </div>
                <CardDescription className="mt-1">
                  De cortesía, unos días después de la última actividad del caso, preguntando cómo evolucionó el
                  paciente. Distinto del seguimiento clínico faltante, que es una alerta interna al médico.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.seguimientoPosteriorActivo}
                onChange={(v) => actualizarCampo("seguimientoPosteriorActivo", v)}
              />
            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-black/5 pt-4">
              <label className="text-sm font-semibold text-text-primary">Enviar a partir de</label>
              <input
                type="number"
                min={1}
                max={30}
                value={config.diasSeguimientoPosterior}
                disabled={!config.seguimientoPosteriorActivo}
                onChange={(e) => actualizarCampo("diasSeguimientoPosterior", Number(e.target.value))}
                className="w-20 rounded-lg border border-black/10 bg-background px-3 py-1.5 text-sm disabled:opacity-50"
              />
              <span className="text-sm text-text-muted">días sin actividad en el caso</span>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Informe clínico disponible</CardTitle>
                  <Badge variant="info">a tus clientes</Badge>
                </div>
                <CardDescription className="mt-1">
                  Avisa que el veterinario generó un informe nuevo, sin adjuntarlo — el contenido lo entrega el
                  médico en su próxima visita.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.informeDisponibleActivo}
                onChange={(v) => actualizarCampo("informeDisponibleActivo", v)}
              />
            </div>
          </Card>

          {/* prompt_code_paciente_nacimiento_estado.md, Parte B3 — el único
              aviso puramente comercial de los diez: la clínica lo apaga sin
              pensarlo dos veces, por eso no lleva ningún parámetro extra ni
              justificación adicional en el texto. */}
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Cumpleaños del paciente</CardTitle>
                  <Badge variant="info">a tus clientes</Badge>
                </div>
                <CardDescription className="mt-1">
                  Saludo breve y cálido en la fecha de nacimiento, solo para pacientes activos con fecha
                  registrada. Sin promociones ni invitación a agendar.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.cumpleanosActivo}
                onChange={(v) => actualizarCampo("cumpleanosActivo", v)}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <SeccionHeader titulo="Avisos a tus médicos" activos={activosMedicos} total={avisosMedicos.length} />

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Seguimiento clínico faltante</CardTitle>
                  <Badge variant="neutral">a tus médicos</Badge>
                </div>
                <CardDescription className="mt-1">
                  Se dispara cuando un caso de severidad alta (empeorando o crítico) no tiene ninguna cita
                  futura agendada.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.seguimientoFaltanteActivo}
                onChange={(v) => actualizarCampo("seguimientoFaltanteActivo", v)}
              />
            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-black/5 pt-4">
              <label className="text-sm font-semibold text-text-primary">Repetir el aviso cada</label>
              <input
                type="number"
                min={1}
                max={30}
                value={config.diasAvisoSeguimientoFaltante}
                disabled={!config.seguimientoFaltanteActivo}
                onChange={(e) => actualizarCampo("diasAvisoSeguimientoFaltante", Number(e.target.value))}
                className="w-20 rounded-lg border border-black/10 bg-background px-3 py-1.5 text-sm disabled:opacity-50"
              />
              <span className="text-sm text-text-muted">días, si el caso sigue sin resolverse</span>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Agenda del día siguiente</CardTitle>
                  <Badge variant="neutral">a tus médicos</Badge>
                </div>
                <CardDescription className="mt-1">
                  Un resumen de las citas de mañana — solo se envía si el médico tiene alguna agendada.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.agendaDiaSiguienteActivo}
                onChange={(v) => actualizarCampo("agendaDiaSiguienteActivo", v)}
              />
            </div>
          </Card>
        </div>

        {/* ---------------------------------------------------------
            SERVICIOS DE IA — prompt 07d fase 2.
            Va en esta pantalla porque es la fila única por clínica que
            ya se edita acá; el 04 reubica los servicios de IA y esto se
            mueve con él, no se duplica. Sección aparte de los avisos a
            propósito: los avisos son gratis y esto consume crédito. */}
        <div className="space-y-6">
          <SeccionHeader titulo="Servicios de IA" activos={config.dictadoIaActivo ? 1 : 0} total={1} />

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Dictado de la consulta</CardTitle>
                  <Badge variant="warning">consume crédito de IA</Badge>
                </div>
                <CardDescription className="mt-1">
                  El médico dicta la consulta de corrido y la IA la ordena como borrador en la
                  atención: motivo, signos, examen, evaluación, plan, receta y estudios. Nada se
                  registra, se firma ni se cobra sin que el médico lo acepte campo por campo.
                </CardDescription>
              </div>
              <ToggleDestinatario
                activo={config.dictadoIaActivo}
                onChange={(v) => actualizarCampo("dictadoIaActivo", v)}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-black/5 pt-4">
              <label className="text-sm font-semibold text-text-primary">Guardar el audio</label>
              <input
                type="number"
                min={0}
                max={720}
                value={config.dictadoRetencionAudioHoras}
                disabled={!config.dictadoIaActivo}
                onChange={(e) => actualizarCampo("dictadoRetencionAudioHoras", Number(e.target.value))}
                className="w-20 rounded-lg border border-black/10 bg-background px-3 py-1.5 text-sm disabled:opacity-50"
              />
              <span className="text-sm text-text-muted">
                horas después de transcribirlo. <strong>0 = no se guarda</strong>, que es lo
                recomendado: el texto queda en el expediente igual.
              </span>
            </div>
          </Card>
        </div>

        <div className="flex items-center gap-4">
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Button>
          {mensaje && <p className="text-sm text-success">{mensaje}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
