import { useEffect, useMemo, useRef, useState } from "react";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";
import { useFormularioSucio } from "../../hooks/useFormularioSucio";
import { Link } from "react-router-dom";
import { ModalCorregirCorreo } from "../../components/ModalCorregirCorreo";
import { ConfiguracionAgenda } from "./ConfiguracionAgenda";
import { Notificaciones } from "./Notificaciones";
import { Politicas } from "./Politicas";
import { SalasYEquipos } from "./SalasYEquipos";
import { PageHeader, Tabs } from "../../components/ui";
import { PanelApariencia } from "./PanelApariencia";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { adminApi, EstadoMiCorreo, PlanInfo, TenantInfo } from "../../lib/adminApi";
import { Pais, paisesApi } from "../../lib/paisesApi";

// Etiqueta legible con offset ("Argentina (GMT-3)"), armada acá con el
// Intl del browser a partir del identificador IANA crudo que da el backend
// — el backend nunca manda un offset, solo la zona (ver paises.routes.ts).
function etiquetaZonaHoraria(nombrePais: string, zonaHoraria: string): string {
  try {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone: zonaHoraria,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const offset = partes.find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${nombrePais} (${offset})`;
  } catch {
    return `${nombrePais} (${zonaHoraria})`;
  }
}

export function Clinica() {
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [paises, setPaises] = useState<Pais[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const [numeroInicioInput, setNumeroInicioInput] = useState("");
  const [guardandoNumeracion, setGuardandoNumeracion] = useState(false);
  const [mensajeNumeracion, setMensajeNumeracion] = useState<string | null>(null);
  const [errorNumeracion, setErrorNumeracion] = useState<string | null>(null);

  const [miCorreo, setMiCorreo] = useState<EstadoMiCorreo | null>(null);
  const [modalCorreoAbierto, setModalCorreoAbierto] = useState(false);

  const recargarMiCorreo = () => {
    adminApi.obtenerEstadoMiCorreo().then(setMiCorreo).catch(() => {});
  };

  useEffect(() => {
    Promise.all([adminApi.obtenerClinica(), paisesApi.listar()]).then(([clinica, paisesData]) => {
      setTenant(clinica.tenant);
      setPlan(clinica.plan);
      setPaises(paisesData.paises);
      setIsLoading(false);
    });
    recargarMiCorreo();
  }, []);

  const paisSeleccionado = useMemo(
    () => paises.find((p) => p.codigo_iso === tenant?.pais_codigo) ?? null,
    [paises, tenant?.pais_codigo]
  );

  const actualizarCampo = (campo: keyof TenantInfo, valor: string) => {
    setTenant((prev) => (prev ? { ...prev, [campo]: valor } : prev));
  };

  const guardar = async () => {
    if (!tenant) return;
    setGuardando(true);
    setMensaje(null);
    setErrorGuardar(null);
    try {
      const { tenant: actualizado } = await adminApi.actualizarClinica({
        nombre: tenant.nombre,
        ciudad: tenant.ciudad ?? undefined,
        idioma: tenant.idioma,
        telefono: tenant.telefono ?? undefined,
        email: tenant.email ?? undefined,
        direccion: tenant.direccion ?? undefined,
        zona_horaria: tenant.zona_horaria,
      });
      setTenant({ ...actualizado, logo_url: tenant.logo_url });
      setMensaje("Cambios guardados.");
    } catch (err: any) {
      setErrorGuardar(err?.message ?? "No pudimos guardar los cambios.");
    } finally {
      setGuardando(false);
    }
  };

  const guardarNumeracion = async () => {
    const numeroInicio = Number(numeroInicioInput);
    if (!Number.isInteger(numeroInicio) || numeroInicio < 1) return;
    setGuardandoNumeracion(true);
    setMensajeNumeracion(null);
    setErrorNumeracion(null);
    try {
      const { expedienteProximoNumero } = await adminApi.configurarNumeracionExpedientes(numeroInicio);
      setTenant((prev) => (prev ? { ...prev, expediente_proximo_numero: expedienteProximoNumero } : prev));
      setNumeroInicioInput("");
      setMensajeNumeracion(`Listo. El próximo caso será el N.º ${expedienteProximoNumero}.`);
    } catch (err: any) {
      setErrorNumeracion(err?.message ?? "No pudimos configurar la numeración.");
    } finally {
      setGuardandoNumeracion(false);
    }
  };

  const opcionesZonaHoraria = useMemo(() => {
    if (!paisSeleccionado) return [];
    const zonas = [...paisSeleccionado.zonas_horarias];
    if (tenant?.zona_horaria && !zonas.includes(tenant.zona_horaria)) {
      zonas.push(tenant.zona_horaria);
    }
    return zonas.map((z) => ({ value: z, label: etiquetaZonaHoraria(paisSeleccionado.nombre, z) }));
  }, [paisSeleccionado, tenant?.zona_horaria]);

  if (isLoading || !tenant || !plan) {
    return <p className="text-text-muted">Cargando…</p>;
  }

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>}>
      {dialogoSalida}
      <PageHeader
        titulo="Clínica"
        subtitulo="Los datos del establecimiento y cómo trabaja: su apariencia, su agenda, sus avisos y sus políticas."
        icono="clinica"
        modulo="admin"
      />

      <Tabs
        // TODO LO QUE SE CONFIGURA DE LA CLÍNICA, EN UN SOLO LUGAR
        // (punto 6 del 2026-11-27). Antes eran cuatro opciones sueltas
        // del menú —Clínica, Configuración de la agenda, Notificaciones
        // y Políticas— que contestan la misma pregunta: «cómo trabaja
        // esta clínica».
        pestanas={[
          { clave: "datos", etiqueta: "Datos", icono: "clinica" },
          { clave: "apariencia", etiqueta: "Apariencia", icono: "panel" },
          { clave: "salas", etiqueta: "Salas y equipos", icono: "clinica" },
          { clave: "agenda", etiqueta: "Agenda", icono: "cita" },
          { clave: "notificaciones", etiqueta: "Notificaciones y servicios de IA", icono: "campana" },
          { clave: "politicas", etiqueta: "Políticas", icono: "ajustes" },
        ]}
      >
        {(activa) =>
          activa === "apariencia" ? (
            <PanelApariencia />
          ) : activa === "salas" ? (
            <SalasYEquipos sinEncabezado />
          ) : activa === "agenda" ? (
            <ConfiguracionAgenda sinEncabezado />
          ) : activa === "notificaciones" ? (
            <Notificaciones sinEncabezado />
          ) : activa === "politicas" ? (
            <Politicas sinEncabezado />
          ) : (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-black/5 bg-surface p-6">
            <h2 className="text-lg font-bold text-primary">Información General</h2>


            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Nombre de la clínica"
                className="sm:col-span-2"
                value={tenant.nombre}
                onChange={(e) => actualizarCampo("nombre", e.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-text-primary">País</label>
                <p className="rounded-lg border border-black/10 bg-background/60 px-4 py-2.5 text-sm text-text-muted">
                  {paisSeleccionado?.nombre ?? tenant.pais_codigo ?? "—"}
                </p>
                <span className="text-xs text-text-muted">
                  El país se fija en el registro. Para cambiarlo, contacte a soporte.
                </span>
              </div>
              <Input
                label="Ciudad"
                value={tenant.ciudad ?? ""}
                onChange={(e) => actualizarCampo("ciudad", e.target.value)}
              />
              <Input
                label="Idioma principal"
                value={tenant.idioma === "es" ? "Español" : tenant.idioma}
                onChange={(e) => actualizarCampo("idioma", e.target.value)}
              />
              <Select
                label="Zona horaria"
                value={tenant.zona_horaria}
                onChange={(e) => actualizarCampo("zona_horaria", e.target.value)}
                options={opcionesZonaHoraria}
                disabled={opcionesZonaHoraria.length === 0}
              />
            </div>
          </div>

          {miCorreo && (
            <div className="rounded-2xl border border-black/5 bg-surface p-6">
              <h2 className="text-lg font-bold text-primary">Correo de acceso</h2>
              <p className="mt-1 text-sm text-text-muted">
                Con esta dirección iniciás sesión y recibís los avisos importantes de tu clínica.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background p-4">
                <div>
                  <p className="font-semibold text-text-primary">{miCorreo.email}</p>
                  <p
                    className={[
                      "mt-1 text-xs font-semibold",
                      miCorreo.rebotado ? "text-error" : miCorreo.verificado ? "text-success" : "text-accent",
                    ].join(" ")}
                  >
                    {miCorreo.rebotado ? "El correo de verificación rebotó" : miCorreo.verificado ? "Verificado" : "Pendiente de verificación"}
                  </p>
                </div>
                <button
                  onClick={() => setModalCorreoAbierto(true)}
                  className="rounded-lg border border-primary px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/5"
                >
                  Corregir
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-black/5 bg-surface p-6">
            <h2 className="text-lg font-bold text-primary">Contacto</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Teléfono"
                value={tenant.telefono ?? ""}
                onChange={(e) => actualizarCampo("telefono", e.target.value)}
              />
              <Input
                label="Email"
                type="email"
                value={tenant.email ?? ""}
                onChange={(e) => actualizarCampo("email", e.target.value)}
              />
              <Input
                label="Dirección"
                className="sm:col-span-2"
                value={tenant.direccion ?? ""}
                onChange={(e) => actualizarCampo("direccion", e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-black/5 bg-surface p-6">
            <h2 className="text-lg font-bold text-primary">Notificaciones</h2>
            <p className="mt-1 text-sm text-text-muted">
              Activá o desactivá los avisos automáticos de tu clínica y ajustá sus parámetros.
            </p>
            <Link
              to="/admin/notificaciones"
              className="mt-4 inline-block rounded-lg border border-primary px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/5"
            >
              Configurar notificaciones →
            </Link>
          </div>

          <div className="rounded-2xl border border-black/5 bg-surface p-6">
            <h2 className="text-lg font-bold text-primary">Numeración de Casos</h2>
            <p className="mt-1 text-sm text-text-muted">
              El próximo caso que se cree va a llevar el N.º{" "}
              <span className="font-semibold text-text-primary">{tenant.expediente_proximo_numero}</span>.
              Para saltar la numeración hacia adelante (por ejemplo, para continuar la serie de un
              sistema anterior), indicá desde qué número seguir. No se puede retroceder sobre casos
              ya emitidos. El número de expediente del paciente es otra serie, propia de cada
              paciente y asignada automáticamente.
            </p>
            <div className="mt-4 flex max-w-sm items-end gap-3">
              <Input
                label="El próximo caso será…"
                type="number"
                min={1}
                value={numeroInicioInput}
                onChange={(e) => setNumeroInicioInput(e.target.value)}
              />
              <Button
                onClick={guardarNumeracion}
                disabled={guardandoNumeracion || !numeroInicioInput.trim()}
              >
                {guardandoNumeracion ? "Guardando…" : "Aplicar"}
              </Button>
            </div>
            {mensajeNumeracion && <p className="mt-2 text-sm text-success">{mensajeNumeracion}</p>}
            {errorNumeracion && <p className="mt-2 text-sm text-error">{errorNumeracion}</p>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-primary p-6 text-white">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Tu Plan Actual</h2>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase">
                {tenant.plan}
              </span>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between border-t border-white/10 pt-3">
                <dt className="text-white/70">Agentes habilitados</dt>
                <dd className="font-semibold">
                  {plan.agentesHabilitados} de {plan.agentesTotal}
                </dd>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-3">
                <dt className="text-white/70">Médicos activos</dt>
                <dd className="font-semibold">
                  {plan.medicosActivos} de {plan.medicosTotal}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-surface p-4">
            <Button fullWidth onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar Cambios"}
            </Button>
            {mensaje && <p className="text-center text-sm text-success">{mensaje}</p>}
            {errorGuardar && <p className="text-center text-sm text-error">{errorGuardar}</p>}
          </div>
        </div>
      </div>
          )
        }
      </Tabs>

      {miCorreo && (
        <ModalCorregirCorreo
          open={modalCorreoAbierto}
          onClose={() => {
            setModalCorreoAbierto(false);
            recargarMiCorreo();
          }}
          emailActual={miCorreo.email}
        />
      )}
    </div>
  );
}
