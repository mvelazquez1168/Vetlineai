import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useAuth } from "../hooks/useAuth";
import { ApiError } from "../lib/api";
import {
  AgentePrueba,
  DatosRegistro,
  PaisRegistro,
  TipoIdentificacionRegistro,
  registroApi,
} from "../lib/registroApi";

// ---------------------------------------------------------------------
// Prompt B (platform_admin_registro) — wizard de alta con prueba, 5 pasos:
// país → datos → verificación → agente → garantía (tarjeta) → bienvenida.
// No cobra nada: la suscripción queda en 'prueba' apenas se completa el
// paso de tarjeta, sin pasar por ninguna pasarela.
//
// PASO DE TARJETA — cómo queda para una integración limpia después:
// PasoGarantia es un componente aislado. Su contrato es exactamente el de
// cualquier paso del wizard (recibe onContinuar, no hace ningún llamado de
// red) — junta los campos de tarjeta en estado local y, al tocar
// "Registrar tarjeta y comenzar prueba", simplemente llama a onContinuar()
// sin mandar esos datos a ningún lado (la tokenización de la pasarela está
// pendiente de confirmación con el proveedor). El único punto de red de
// todo el wizard es handleRegistrar() en el componente Registro, que llama
// a POST /registro-publico con los datos de los pasos 1-4 — nunca con los
// de la tarjeta. Cuando la pasarela esté lista, se agrega la llamada de
// tokenización DENTRO de PasoGarantia, antes de su onContinuar, y su
// resultado (token/método de pago) se agrega al payload de
// handleRegistrar — el resto del wizard no cambia.
// ---------------------------------------------------------------------

type Paso =
  | "pais"
  | "esperaPais"
  | "datos"
  | "verificacion"
  | "agente"
  | "garantia"
  | "confirmarCorreo"
  | "bienvenida";

interface EstadoWizard {
  paisCodigo: string;
  paisNombre: string;
  nombreComercial: string;
  tipoPersona: "fisica" | "juridica";
  tipoIdentificacionId: string;
  numeroIdentificacion: string;
  nombreFiscal: string;
  nombreTitular: string;
  email: string;
  telefono: string;
  password: string;
  esMedico: boolean;
  colegiatura: string;
  universidadEgreso: string;
  anioGraduacion: string;
  correoMedicoInvitado: string;
  agenteId: string;
  agenteNombre: string;
}

const ESTADO_INICIAL: EstadoWizard = {
  paisCodigo: "",
  paisNombre: "",
  nombreComercial: "",
  tipoPersona: "fisica",
  tipoIdentificacionId: "",
  numeroIdentificacion: "",
  nombreFiscal: "",
  nombreTitular: "",
  email: "",
  telefono: "",
  password: "",
  esMedico: true,
  colegiatura: "",
  universidadEgreso: "",
  anioGraduacion: "",
  correoMedicoInvitado: "",
  agenteId: "",
  agenteNombre: "",
};

function Stepper({ paso }: { paso: Paso }) {
  const pasos: { key: Paso; label: string }[] = [
    { key: "pais", label: "país" },
    { key: "datos", label: "datos" },
    { key: "verificacion", label: "verificación" },
    { key: "agente", label: "agente" },
    { key: "garantia", label: "garantía" },
  ];
  const indiceActual = pasos.findIndex((p) => p.key === paso);

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 text-sm">
        {pasos.map((p, i) => (
          <div key={p.key} className="flex items-center gap-2">
            <span
              className={[
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                i < indiceActual
                  ? "bg-success text-white"
                  : i === indiceActual
                  ? "bg-accent text-white"
                  : "bg-black/10 text-text-muted",
              ].join(" ")}
            >
              {i < indiceActual ? "✓" : i + 1}
            </span>
            <span className={i === indiceActual ? "font-semibold text-primary" : "text-text-muted"}>
              {p.label}
            </span>
            {i < pasos.length - 1 && <span className="text-black/10">—</span>}
          </div>
        ))}
      </div>
      <div className="mt-3 h-1 w-full rounded-full bg-black/5">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${((indiceActual + 1) / pasos.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function PasoPais({
  onDisponible,
  onEsperaPais,
}: {
  onDisponible: (pais: PaisRegistro) => void;
  onEsperaPais: (pais: PaisRegistro) => void;
}) {
  const [paises, setPaises] = useState<PaisRegistro[]>([]);
  const [codigo, setCodigo] = useState("");

  useEffect(() => {
    registroApi.listarPaises().then((r) => setPaises(r.paises));
  }, []);

  const seleccionado = paises.find((p) => p.codigo_iso === codigo) ?? null;

  return (
    <>
      <h2 className="text-3xl font-bold text-primary">Seleccione su país</h2>
      <p className="mt-2 text-sm text-text-muted">
        Vetline Ai está expandiéndose de forma progresiva. Iniciá tu registro seleccionando tu ubicación actual.
      </p>

      <div className="mt-8 flex flex-col gap-1.5">
        <label className="text-sm font-semibold text-text-primary">País de operación clínica</label>
        <select
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          className="rounded-lg border border-black/10 bg-background px-4 py-3 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">Seleccioná un país…</option>
          {paises.map((p) => (
            <option key={p.codigo_iso} value={p.codigo_iso}>
              {p.nombre} {p.estado === "habilitado" ? "(disponible)" : ""}
            </option>
          ))}
        </select>
      </div>

      <Button
        fullWidth
        className="mt-8"
        disabled={!seleccionado}
        onClick={() => {
          if (!seleccionado) return;
          if (seleccionado.estado === "habilitado") onDisponible(seleccionado);
          else onEsperaPais(seleccionado);
        }}
      >
        Continuar
      </Button>

      <p className="mt-6 text-center text-sm text-accent">
        <Link to="/login">¿Ya tenés cuenta? Iniciar sesión</Link>
      </p>
    </>
  );
}

function PasoEsperaPais({ pais, onVolver }: { pais: PaisRegistro; onVolver: () => void }) {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registrarse = async () => {
    setEnviando(true);
    setError(null);
    try {
      await registroApi.registrarListaEspera({ email, paisCodigo: pais.codigo_iso });
      setEnviado(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos registrar tu interés.");
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
          <span className="text-3xl text-success">✓</span>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-primary">¡Quedó registrado!</h2>
        <p className="mt-3 text-text-muted">
          Registramos tu interés para expandir operaciones a {pais.nombre}. Te avisaremos al correo provisto en
          cuanto Vetline Ai esté listo en tu país.
        </p>
        <button onClick={onVolver} className="mt-8 text-sm font-semibold text-accent hover:underline">
          ← Volver al inicio del registro
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-error/30 bg-error/10 p-4">
        <p className="font-bold text-error">Todavía no operamos en este país</p>
        <p className="mt-1 text-sm text-text-muted">
          Actualmente Vetline Ai solo cuenta con pasarelas de pago y regulaciones habilitadas en países
          seleccionados. Registrate en la lista de espera para priorizar {pais.nombre}.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <label className="text-sm font-semibold text-text-primary">Correo electrónico de contacto</label>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ejemplo@clinica.com" />
      </div>
      {error && <p className="mt-3 text-sm text-error">{error}</p>}

      <div className="mt-8 flex flex-col gap-3">
        <Button fullWidth disabled={!email.trim() || enviando} onClick={registrarse}>
          {enviando ? "Registrando…" : "Registrarme en la lista de espera"}
        </Button>
        <Button variant="secondary" fullWidth onClick={onVolver}>
          Volver a seleccionar país
        </Button>
      </div>
    </>
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PasoDatos({
  estado,
  onChange,
  onContinuar,
  onVolver,
}: {
  estado: EstadoWizard;
  onChange: (parcial: Partial<EstadoWizard>) => void;
  onContinuar: () => void;
  onVolver: () => void;
}) {
  const [tipos, setTipos] = useState<TipoIdentificacionRegistro[]>([]);
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);

  useEffect(() => {
    if (!estado.paisCodigo) return;
    registroApi.listarTiposIdentificacion(estado.paisCodigo, estado.tipoPersona).then((r) => setTipos(r.tipos));
  }, [estado.paisCodigo, estado.tipoPersona]);

  const emailValido = !estado.email.trim() || EMAIL_REGEX.test(estado.email.trim());
  const passwordsCoinciden = !confirmarPassword || confirmarPassword === estado.password;

  const completo =
    estado.nombreComercial.trim() &&
    estado.nombreTitular.trim() &&
    estado.email.trim() &&
    EMAIL_REGEX.test(estado.email.trim()) &&
    estado.password.length >= 8 &&
    confirmarPassword === estado.password;

  return (
    <>
      <h2 className="text-3xl font-bold text-primary">Datos de la clínica</h2>
      <p className="mt-2 text-sm text-text-muted">Especificá los datos operacionales de tu negocio en {estado.paisNombre}.</p>

      <div className="mt-6 flex flex-col gap-1.5">
        <label className="text-sm font-semibold text-text-primary">Tipo de personería</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onChange({ tipoPersona: "fisica", tipoIdentificacionId: "" })}
            className={[
              "flex-1 rounded-lg border px-4 py-3 text-sm font-semibold",
              estado.tipoPersona === "fisica" ? "border-accent bg-accent text-white" : "border-black/10 text-text-primary",
            ].join(" ")}
          >
            Persona física
          </button>
          <button
            type="button"
            onClick={() => onChange({ tipoPersona: "juridica", tipoIdentificacionId: "" })}
            className={[
              "flex-1 rounded-lg border px-4 py-3 text-sm font-semibold",
              estado.tipoPersona === "juridica" ? "border-accent bg-accent text-white" : "border-black/10 text-text-primary",
            ].join(" ")}
          >
            Persona jurídica
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Input
          label="Nombre comercial de la clínica"
          value={estado.nombreComercial}
          onChange={(e) => onChange({ nombreComercial: e.target.value })}
        />

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Tipo de identificación</label>
            <select
              value={estado.tipoIdentificacionId}
              onChange={(e) => onChange({ tipoIdentificacionId: e.target.value })}
              className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary"
            >
              <option value="">Seleccioná…</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Número de identificación"
            value={estado.numeroIdentificacion}
            onChange={(e) => onChange({ numeroIdentificacion: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Input
            label="Nombre fiscal"
            value={estado.nombreFiscal}
            onChange={(e) => onChange({ nombreFiscal: e.target.value })}
          />
          <span className="text-xs text-text-muted">Nombre al que se emiten los comprobantes electrónicos.</span>
        </div>

        <hr className="border-black/5" />
        <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Datos del titular</p>

        <Input
          label="Nombre completo"
          autoComplete="name"
          name="nombreTitular"
          value={estado.nombreTitular}
          onChange={(e) => onChange({ nombreTitular: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Correo electrónico"
            type="email"
            autoComplete="email"
            name="email"
            value={estado.email}
            onChange={(e) => onChange({ email: e.target.value })}
            error={!emailValido ? "Formato de correo inválido." : undefined}
          />
          <Input
            label="Teléfono"
            type="tel"
            autoComplete="tel"
            name="telefono"
            value={estado.telefono}
            onChange={(e) => onChange({ telefono: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Contraseña"
                type={mostrarPassword ? "text" : "password"}
                autoComplete="new-password"
                name="password"
                value={estado.password}
                onChange={(e) => onChange({ password: e.target.value })}
              />
            </div>
            <button
              type="button"
              onClick={() => setMostrarPassword((v) => !v)}
              className="mb-2.5 shrink-0 text-xs font-semibold text-accent hover:underline"
            >
              {mostrarPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {estado.password && estado.password.length < 8 && (
            <p className="-mt-2 text-xs text-text-muted">Mínimo 8 caracteres.</p>
          )}

          <Input
            label="Confirmar contraseña"
            type={mostrarPassword ? "text" : "password"}
            autoComplete="new-password"
            name="passwordConfirmacion"
            value={confirmarPassword}
            onChange={(e) => setConfirmarPassword(e.target.value)}
            error={!passwordsCoinciden ? "Las contraseñas no coinciden." : undefined}
          />
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <Button fullWidth disabled={!completo} onClick={onContinuar}>
          Continuar
        </Button>
        <button onClick={onVolver} className="text-sm font-semibold text-accent hover:underline">
          ← Volver
        </button>
      </div>
    </>
  );
}

function PasoVerificacion({
  estado,
  onChange,
  onContinuar,
  onVolver,
}: {
  estado: EstadoWizard;
  onChange: (parcial: Partial<EstadoWizard>) => void;
  onContinuar: () => void;
  onVolver: () => void;
}) {
  const completo = estado.esMedico ? !!estado.colegiatura.trim() : !!estado.correoMedicoInvitado.trim();

  return (
    <>
      <h2 className="text-3xl font-bold text-primary">Verificación profesional</h2>
      <p className="mt-2 text-sm text-text-muted">Configurá el acceso inicial al panel y definí el rol del responsable de la cuenta.</p>

      <label
        className={[
          "mt-6 flex cursor-pointer items-start gap-3 rounded-xl border p-4",
          estado.esMedico ? "border-accent bg-accent/5" : "border-black/10",
        ].join(" ")}
      >
        <input
          type="checkbox"
          checked={estado.esMedico}
          onChange={(e) => onChange({ esMedico: e.target.checked })}
          className="mt-1 h-4 w-4"
        />
        <span className="text-sm font-medium text-text-primary">
          También soy médico veterinario y atenderé casos en la plataforma
        </span>
      </label>

      {estado.esMedico ? (
        <div className="mt-4 flex flex-col gap-4">
          <Input
            label="Número de colegiatura o licencia"
            value={estado.colegiatura}
            onChange={(e) => onChange({ colegiatura: e.target.value })}
          />
          <Input
            label="Universidad de egreso"
            value={estado.universidadEgreso}
            onChange={(e) => onChange({ universidadEgreso: e.target.value })}
          />
          <Input
            label="Año de graduación"
            type="number"
            value={estado.anioGraduacion}
            onChange={(e) => onChange({ anioGraduacion: e.target.value })}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <Input
            label="Correo del primer médico veterinario"
            type="email"
            value={estado.correoMedicoInvitado}
            onChange={(e) => onChange({ correoMedicoInvitado: e.target.value })}
            placeholder="veterinario@clinica.com"
          />
          <div className="rounded-lg bg-background p-4 text-sm text-text-muted">
            <p>• Recibirá una invitación para completar sus datos y acceder al área de trabajo.</p>
            <p className="mt-1">• La prueba gratuita arranca cuando ese médico complete su alta.</p>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <Button fullWidth disabled={!completo} onClick={onContinuar}>
          Continuar
        </Button>
        <button onClick={onVolver} className="text-sm font-semibold text-accent hover:underline">
          ← Volver
        </button>
      </div>
    </>
  );
}

function PasoAgente({
  agenteId,
  onElegir,
  onContinuar,
  onVolver,
}: {
  agenteId: string;
  onElegir: (agente: AgentePrueba) => void;
  onContinuar: () => void;
  onVolver: () => void;
}) {
  const [agentes, setAgentes] = useState<AgentePrueba[]>([]);

  useEffect(() => {
    registroApi.listarAgentesPrueba().then((r) => setAgentes(r.agentes));
  }, []);

  return (
    <>
      <h2 className="text-3xl font-bold text-primary">Elegí tu agente de prueba</h2>
      <p className="mt-2 text-sm text-text-muted">
        Durante la prueba gratuita podés usar un solo agente. No se puede cambiar hasta contratar un plan.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {agentes.map((a) => (
          <button
            key={a.id}
            onClick={() => onElegir(a)}
            className={[
              "rounded-xl border p-4 text-left",
              agenteId === a.id ? "border-accent bg-accent/5" : "border-black/10",
            ].join(" ")}
          >
            <p className="font-semibold text-text-primary">{a.nombre}</p>
            <p className="mt-1 text-xs text-text-muted">{a.descripcion}</p>
          </button>
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <Button fullWidth disabled={!agenteId} onClick={onContinuar}>
          Continuar
        </Button>
        <button onClick={onVolver} className="text-sm font-semibold text-accent hover:underline">
          ← Volver
        </button>
      </div>
    </>
  );
}

// Máscaras de entrada — se aplican MIENTRAS se escribe (no solo al
// validar): corregir después de escrito es peor experiencia que guiar
// mientras se escribe (pedido explícito). Estos campos son inputs
// propios del wizard, no un formulario embebido del SDK de la pasarela
// (ver la nota grande al inicio del archivo — PasoGarantia nunca manda
// nada a ningún endpoint todavía), así que el formato es completamente
// nuestro para modificar.
function formatearNumeroTarjeta(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 16);
  return digitos.replace(/(.{4})/g, "$1 ").trim();
}

function formatearVencimiento(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 4);
  if (digitos.length <= 2) return digitos;
  return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
}

// Componente aislado (ver nota grande al inicio del archivo): nunca manda
// nada a ningún endpoint — solo junta campos en estado local y avisa que
// terminó. La integración real de la pasarela se agrega acá adentro, sin
// tocar el resto del wizard.
function PasoGarantia({ onContinuar, onVolver, cargando }: { onContinuar: () => void; onVolver: () => void; cargando: boolean }) {
  const [numero, setNumero] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [cvv, setCvv] = useState("");
  const [nombre, setNombre] = useState("");

  return (
    <>
      <h2 className="text-3xl font-bold text-primary">Registrá tu tarjeta</h2>
      <p className="mt-2 text-sm text-text-muted">
        No se realizará ningún cobro durante el período de prueba. La tarjeta sirve para verificar tu cuenta y
        para continuar sin interrupciones si decidís contratar.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <Input label="Nombre en la tarjeta" autoComplete="cc-name" name="nombreTarjeta" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Input
          label="Número de tarjeta"
          inputMode="numeric"
          autoComplete="cc-number"
          name="numeroTarjeta"
          value={numero}
          onChange={(e) => setNumero(formatearNumeroTarjeta(e.target.value))}
          placeholder="0000 0000 0000 0000"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Fecha de vencimiento"
            inputMode="numeric"
            autoComplete="cc-exp"
            name="vencimientoTarjeta"
            value={vencimiento}
            onChange={(e) => setVencimiento(formatearVencimiento(e.target.value))}
            placeholder="MM/AA"
          />
          <Input
            label="Código de seguridad (CVV)"
            inputMode="numeric"
            autoComplete="cc-csc"
            name="cvvTarjeta"
            value={cvv}
            onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="123"
          />
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <Button fullWidth disabled={cargando} onClick={onContinuar}>
          {cargando ? "Creando tu clínica…" : "Registrar tarjeta y comenzar prueba"}
        </Button>
        <button onClick={onVolver} className="text-sm font-semibold text-accent hover:underline">
          ← Volver
        </button>
      </div>
    </>
  );
}

// Capa 1 del prompt de verificación de correo — última pantalla antes de
// disparar el alta real (que es lo que dispara el envío del correo de
// verificación en el backend). Pedido explícito: mostrar el correo
// aislado y en grande, NO volver a pedirlo escrito una segunda vez —
// verlo así hace saltar el error mucho más que reescribirlo produce.
function PasoConfirmarCorreo({
  email,
  onConfirmar,
  onCorregir,
  cargando,
}: {
  email: string;
  onConfirmar: () => void;
  onCorregir: () => void;
  cargando: boolean;
}) {
  return (
    <>
      <h2 className="text-3xl font-bold text-primary">Confirmá tu correo</h2>
      <p className="mt-2 text-sm text-text-muted">
        A esta dirección te vamos a mandar el enlace para verificar tu cuenta.
      </p>

      <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-6 text-center">
        <p className="break-all text-xl font-bold text-primary">{email}</p>
      </div>
      <p className="mt-3 text-center text-sm text-text-muted">¿Es correcto?</p>

      <div className="mt-8 flex flex-col gap-3">
        <Button fullWidth disabled={cargando} onClick={onConfirmar}>
          {cargando ? "Creando tu clínica…" : "Sí, es correcto — continuar"}
        </Button>
        <button onClick={onCorregir} className="text-sm font-semibold text-accent hover:underline">
          ← Corregir correo
        </button>
      </div>
    </>
  );
}

function PantallaBienvenida({ estado }: { estado: EstadoWizard }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
        <span className="text-3xl text-success">✓</span>
      </div>
      <h2 className="mt-6 text-3xl font-bold text-primary">¡Bienvenido a Vetline Ai!</h2>
      <p className="mt-3 text-text-muted">Tu entorno clínico virtual se configuró correctamente y está listo para operar.</p>

      <div className="mt-6 rounded-xl bg-background p-4 text-left text-sm">
        <p className="font-semibold text-text-primary">{estado.agenteNombre}</p>
        <p className="text-text-muted">Agente clínico inicial asignado</p>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {estado.esMedico && (
          <Button fullWidth onClick={() => (window.location.href = "/workspace")}>
            Crear mi primer caso
          </Button>
        )}
        <Button variant="secondary" fullWidth onClick={() => (window.location.href = "/admin")}>
          Ir al panel de administración
        </Button>
      </div>
    </div>
  );
}

export function Registro() {
  const [paso, setPaso] = useState<Paso>("pais");
  const [estado, setEstado] = useState<EstadoWizard>(ESTADO_INICIAL);
  const [paisEnEspera, setPaisEnEspera] = useState<PaisRegistro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const { iniciarSesionConTokensKeycloak } = useAuth();

  const actualizar = (parcial: Partial<EstadoWizard>) => setEstado((prev) => ({ ...prev, ...parcial }));

  const registrar = async () => {
    setError(null);
    setRegistrando(true);
    try {
      const datos: DatosRegistro = {
        paisCodigo: estado.paisCodigo,
        nombreComercial: estado.nombreComercial,
        tipoPersona: estado.tipoPersona,
        tipoIdentificacionId: estado.tipoIdentificacionId || undefined,
        numeroIdentificacion: estado.numeroIdentificacion || undefined,
        nombreFiscal: estado.nombreFiscal || undefined,
        nombreTitular: estado.nombreTitular,
        email: estado.email,
        telefono: estado.telefono || undefined,
        password: estado.password,
        esMedico: estado.esMedico,
        colegiatura: estado.esMedico ? estado.colegiatura : undefined,
        universidadEgreso: estado.esMedico ? estado.universidadEgreso || undefined : undefined,
        anioGraduacion: estado.esMedico && estado.anioGraduacion ? Number(estado.anioGraduacion) : undefined,
        correoMedicoInvitado: estado.esMedico ? undefined : estado.correoMedicoInvitado,
        agenteId: estado.agenteId,
      };

      const respuesta = await registroApi.registrarClinica(datos);

      if ("listaEspera" in respuesta) {
        // Defensa en profundidad: el país dejó de estar habilitado entre
        // el paso 1 y este envío. Volvemos al paso de país con el mensaje.
        setError("Este país dejó de estar disponible. Volvé a seleccionar tu país.");
        setPaso("pais");
        return;
      }
      if (!respuesta.autoLogin) {
        setError("Tu clínica se creó, pero no pudimos iniciar sesión automáticamente. Iniciá sesión manualmente.");
        return;
      }

      await iniciarSesionConTokensKeycloak({
        access_token: respuesta.access_token,
        refresh_token: respuesta.refresh_token,
        expires_in: respuesta.expires_in,
      });

      setPaso("bienvenida");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos completar el registro. Intentá de nuevo.");
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full">
      <div className="hidden w-1/2 flex-col justify-between bg-primary p-16 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 21s-7-4.35-9.33-9C1.2 8.5 3 5 6.5 5c2 0 3.2 1 3.9 2 0 0 .6-2 3.1-2 3.5 0 5.3 3.5 3.83 7-2.33 4.65-9.33 9-9.33 9Z"
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <span className="text-xl font-bold">Vetline Ai</span>
        </div>

        <div>
          <h1 className="font-display text-5xl leading-tight">Comience su prueba gratuita</h1>
          <p className="mt-4 text-white/80">Pruebe la potencia de la IA veterinaria de forma inmediata.</p>
          <ul className="mt-6 space-y-3 text-white/80">
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-xs">✓</span>
              1 agente de IA activado
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-xs">✓</span>
              Requiere tarjeta de garantía — no se cobra durante la prueba
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-xs">✓</span>
              Seguridad médica de confianza
            </li>
          </ul>
        </div>

        <div className="flex items-center gap-3 text-sm text-white/50">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="font-semibold text-white/70">Región operativa: Costa Rica</span>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-1/2">
        <div className="w-full max-w-md rounded-2xl bg-surface p-10 shadow-sm">
          {paso !== "pais" && paso !== "esperaPais" && paso !== "confirmarCorreo" && paso !== "bienvenida" && (
            <Stepper paso={paso} />
          )}
          {error && <p className="mb-4 text-sm text-error">{error}</p>}

          {paso === "pais" && (
            <PasoPais
              onDisponible={(pais) => {
                actualizar({ paisCodigo: pais.codigo_iso, paisNombre: pais.nombre });
                setPaso("datos");
              }}
              onEsperaPais={(pais) => {
                setPaisEnEspera(pais);
                setPaso("esperaPais");
              }}
            />
          )}

          {paso === "esperaPais" && paisEnEspera && (
            <PasoEsperaPais pais={paisEnEspera} onVolver={() => setPaso("pais")} />
          )}

          {paso === "datos" && (
            <PasoDatos
              estado={estado}
              onChange={actualizar}
              onContinuar={() => setPaso("verificacion")}
              onVolver={() => setPaso("pais")}
            />
          )}

          {paso === "verificacion" && (
            <PasoVerificacion
              estado={estado}
              onChange={actualizar}
              onContinuar={() => setPaso("agente")}
              onVolver={() => setPaso("datos")}
            />
          )}

          {paso === "agente" && (
            <PasoAgente
              agenteId={estado.agenteId}
              onElegir={(a) => actualizar({ agenteId: a.id, agenteNombre: a.nombre })}
              onContinuar={() => setPaso("garantia")}
              onVolver={() => setPaso("verificacion")}
            />
          )}

          {paso === "garantia" && (
            <PasoGarantia
              onContinuar={() => setPaso("confirmarCorreo")}
              onVolver={() => setPaso("agente")}
              cargando={registrando}
            />
          )}

          {paso === "confirmarCorreo" && (
            <PasoConfirmarCorreo
              email={estado.email}
              onConfirmar={registrar}
              onCorregir={() => setPaso("datos")}
              cargando={registrando}
            />
          )}

          {paso === "bienvenida" && <PantallaBienvenida estado={estado} />}
        </div>
      </div>
    </div>
  );
}
