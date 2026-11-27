import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { LoadingState } from "../components/ui/LoadingState";
import { PanelFirma } from "../components/ui/PanelFirma";

// ---------------------------------------------------------------------
// FIRMAR A DISTANCIA — la página que abre el CLIENTE desde su teléfono.
//
// SE ABRE SIN INICIAR SESIÓN, y por eso no se parece a ninguna otra
// pantalla del sistema:
//
//   * no tiene el marco de la aplicación (ni menú, ni barra, ni nada
//     que insinúe que hay más para ver);
//   * no usa `useAuth` ni el token: si lo usara, un cliente con la
//     sesión de otra persona abierta en el mismo navegador firmaría con
//     esa sesión;
//   * **pide el código antes de mostrar el texto.** El enlace solo no
//     alcanza: un WhatsApp reenviado no puede dejar leer de qué se
//     operan los pacientes de la clínica.
//
// Está pensada para un teléfono: un paso por pantalla, el texto legible
// y la firma con el dedo.
// ---------------------------------------------------------------------

const API = (import.meta.env.VITE_API_URL as string) ?? "/api";

interface Estado {
  titulo: string;
  paciente: string;
  clinica: string;
  pistaDestino: string;
  texto?: string;
  verificado: boolean;
}

export function FirmarADistancia() {
  const { token = "" } = useParams();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [identificacion, setIdentificacion] = useState("");
  const [relacion, setRelacion] = useState<"propietario" | "autorizado">("propietario");
  const [autorizadoPor, setAutorizadoPor] = useState("");
  const [firmaPng, setFirmaPng] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [listo, setListo] = useState(false);

  const pedir = async (ruta: string, cuerpo?: unknown) => {
    const r = await fetch(`${API}/firma/${token}${ruta}`, {
      method: cuerpo ? "POST" : "GET",
      headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const datos = await r.json();
    if (!r.ok) throw new Error(datos?.error ?? "No se pudo completar la operación.");
    return datos;
  };

  useEffect(() => {
    pedir("")
      .then(setEstado)
      .catch((e) => setError((e as Error).message));
  }, [token]);

  const verificar = async () => {
    setOcupado(true);
    try {
      setEstado(await pedir("/verificar", { codigo }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const firmar = async () => {
    setOcupado(true);
    try {
      await pedir("/firmar", {
        codigo,
        firmaPng,
        firmanteNombre: nombre,
        firmanteIdentificacion: identificacion || undefined,
        relacion,
        autorizadoPor: relacion === "autorizado" ? autorizadoPor : undefined,
      });
      setListo(true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  // --- Pantallas ----------------------------------------------------
  const marco = (contenido: React.ReactNode) => (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-lg rounded-2xl bg-surface p-6 shadow-sm">{contenido}</div>
    </div>
  );

  if (listo) {
    return marco(
      <>
        <h1 className="text-xl font-bold text-primary">Listo, quedó firmado</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Te vamos a mandar una copia del documento firmado. Ya podés cerrar esta página: este
          enlace no sirve otra vez.
        </p>
      </>
    );
  }

  if (error && !estado) {
    return marco(
      <>
        <h1 className="text-xl font-bold text-primary">No se pudo abrir</h1>
        <p className="mt-2 text-sm text-text-secondary">{error}</p>
      </>
    );
  }

  if (!estado) return marco(<LoadingState />);

  return marco(
    <>
      <p className="text-xs uppercase tracking-wide text-text-muted">{estado.clinica}</p>
      <h1 className="mt-1 text-xl font-bold text-primary">{estado.titulo}</h1>
      <p className="mt-1 text-sm text-text-secondary">Paciente: {estado.paciente}</p>

      {!estado.verificado ? (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-text-secondary">
            Para abrir el documento, escribí el código que te llegó en el mismo mensaje (termina en{" "}
            <strong>{estado.pistaDestino}</strong>).
          </p>
          <Input
            name="codigo"
            label="Código"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <Button onClick={verificar} disabled={ocupado || codigo.trim().length < 4}>
            {ocupado ? "Comprobando…" : "Continuar"}
          </Button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {/* EL TEXTO COMPLETO, legible. No se resume ni se acorta: es
              lo que la persona va a firmar. */}
          <div className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-sm text-text-primary">
            {estado.texto}
          </div>

          <div className="grid gap-3">
            <Input
              name="nombre"
              label="Tu nombre completo"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            <Input
              name="identificacion"
              label="Tu identificación"
              value={identificacion}
              onChange={(e) => setIdentificacion(e.target.value)}
            />
            <Select
              name="relacion"
              label="Firmás como"
              value={relacion}
              onChange={(e) => setRelacion(e.target.value as typeof relacion)}
              options={[
                { value: "propietario", label: "Propietario del paciente" },
                { value: "autorizado", label: "Persona autorizada por el propietario" },
              ]}
            />
            {relacion === "autorizado" && (
              <Input
                name="autorizado-por"
                label="Nombre del propietario que te autorizó"
                value={autorizadoPor}
                onChange={(e) => setAutorizadoPor(e.target.value)}
              />
            )}
          </div>

          {firmaPng ? (
            <div className="rounded-lg border border-success/40 bg-success/10 p-3">
              <p className="text-sm font-semibold text-text-primary">Firma tomada</p>
              <img src={firmaPng} alt="Tu firma" className="mt-2 max-h-28 bg-white" />
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => setFirmaPng(null)}
              >
                Volver a firmar
              </Button>
            </div>
          ) : (
            <PanelFirma etiqueta="Firmá con el dedo" onFirmar={setFirmaPng} />
          )}

          {error && <p className="text-sm text-error">{error}</p>}
          <Button onClick={firmar} disabled={ocupado || !firmaPng || !nombre.trim()}>
            {ocupado ? "Firmando…" : "Firmar y enviar"}
          </Button>
          <p className="text-xs text-text-muted">
            Queda registrada la fecha y la hora, y el documento firmado se guarda en el expediente
            de {estado.paciente}. Te mandamos una copia.
          </p>
        </div>
      )}
    </>
  );
}
