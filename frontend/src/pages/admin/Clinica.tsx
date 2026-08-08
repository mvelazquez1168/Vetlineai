import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ModalCorregirCorreo } from "../../components/ModalCorregirCorreo";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { adminApi, EstadoMiCorreo, PlanInfo, TenantInfo } from "../../lib/adminApi";
import { API_ORIGIN } from "../../lib/api";
import { Pais, paisesApi } from "../../lib/paisesApi";

const TIPOS_LOGO_VALIDOS = ["image/png", "image/jpeg"];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

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
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [paises, setPaises] = useState<Pais[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

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

  // El object URL de la preview es solo del File local pendiente — se
  // libera al reemplazarlo o al desmontar, nunca se usa para el logo ya
  // persistido (ese se muestra directo desde /uploads vía API_ORIGIN).
  useEffect(() => {
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    };
  }, [logoPreviewUrl]);

  const elegirLogo = (archivo: File | null) => {
    if (!archivo) return;
    setErrorLogo(null);

    if (!TIPOS_LOGO_VALIDOS.includes(archivo.type)) {
      setErrorLogo("Solo se aceptan archivos PNG o JPG.");
      return;
    }
    if (archivo.size > LOGO_MAX_BYTES) {
      setErrorLogo("El archivo supera el máximo de 2MB.");
      return;
    }

    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    setLogoFile(archivo);
    setLogoPreviewUrl(URL.createObjectURL(archivo));
  };

  const actualizarCampo = (campo: keyof TenantInfo, valor: string) => {
    setTenant((prev) => (prev ? { ...prev, [campo]: valor } : prev));
  };

  const guardar = async () => {
    if (!tenant) return;
    setGuardando(true);
    setMensaje(null);
    setErrorGuardar(null);
    try {
      let logoUrl = tenant.logo_url;
      if (logoFile) {
        const resultado = await adminApi.subirLogo(logoFile);
        logoUrl = resultado.logoUrl;
      }

      const { tenant: actualizado } = await adminApi.actualizarClinica({
        nombre: tenant.nombre,
        ciudad: tenant.ciudad ?? undefined,
        idioma: tenant.idioma,
        telefono: tenant.telefono ?? undefined,
        email: tenant.email ?? undefined,
        direccion: tenant.direccion ?? undefined,
        zona_horaria: tenant.zona_horaria,
      });
      setTenant({ ...actualizado, logo_url: logoUrl });

      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      setLogoFile(null);
      setLogoPreviewUrl(null);
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
      setMensajeNumeracion(`Listo. El próximo expediente será el N.º ${expedienteProximoNumero}.`);
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
    <div>
      <h1 className="text-2xl font-bold text-primary">Datos de la Clínica</h1>
      <p className="mt-1 text-text-muted">
        Administra la información de tu establecimiento, datos de contacto y revisa el estado de
        tu suscripción.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-black/5 bg-surface p-6">
            <h2 className="text-lg font-bold text-primary">Información General</h2>

            <div className="mt-4 flex items-center gap-4">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="flex h-16 w-40 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background hover:opacity-80"
                aria-label="Cambiar logo de la clínica"
              >
                {logoPreviewUrl ? (
                  <img src={logoPreviewUrl} alt="Logo de la clínica" className="h-full w-full object-contain" />
                ) : tenant.logo_url ? (
                  <img
                    src={tenant.logo_url.startsWith("http") ? tenant.logo_url : `${API_ORIGIN}${tenant.logo_url}`}
                    alt="Logo de la clínica"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-accent">
                    <path
                      d="M4 8a2 2 0 0 1 2-2h1.17a2 2 0 0 0 1.6-.8l.66-.88a2 2 0 0 1 1.6-.8h1.94a2 2 0 0 1 1.6.8l.66.88a2 2 0 0 0 1.6.8H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                )}
              </button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png, image/jpeg"
                className="hidden"
                onChange={(e) => elegirLogo(e.target.files?.[0] ?? null)}
              />
              <div>
                <p className="text-sm font-semibold text-text-primary">Logotipo de la Clínica</p>
                <p className="text-xs text-text-muted">PNG o JPG. Máximo 2MB.</p>
                {errorLogo && <p className="mt-1 text-xs text-error">{errorLogo}</p>}
              </div>
            </div>

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
                  El país se fija en el registro. Para cambiarlo, contactá a soporte.
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
            <h2 className="text-lg font-bold text-primary">Numeración de Expedientes</h2>
            <p className="mt-1 text-sm text-text-muted">
              El próximo caso que se cree va a llevar el expediente N.º{" "}
              <span className="font-semibold text-text-primary">{tenant.expediente_proximo_numero}</span>.
              Para saltar la numeración hacia adelante (por ejemplo, para continuar la serie de un
              sistema anterior), indicá desde qué número seguir. No se puede retroceder sobre
              expedientes ya emitidos.
            </p>
            <div className="mt-4 flex max-w-sm items-end gap-3">
              <Input
                label="El próximo expediente será…"
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
