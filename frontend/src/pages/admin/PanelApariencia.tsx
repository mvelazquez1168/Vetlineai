import { useEffect, useRef, useState } from "react";
import { Card, CardDescription, CardTitle, LoadingState } from "../../components/ui";
import { Icono } from "../../components/ui/Icono";
import { aplicarTema, useApariencia } from "../../hooks/useApariencia";
import { useAuth } from "../../hooks/useAuth";
import { adminApi, AparienciaApi } from "../../lib/adminApi";
import { API_ORIGIN } from "../../lib/api";

// ---------------------------------------------------------------------
// APARIENCIA DE LA CLÍNICA — prompt 01c, sección 2.
//
// Administración › Clínica y usuarios › Apariencia.
//
// Tres cosas y nada más: el COLOR, el LOGO y el TEMA. Todo lo demás del
// sistema se deriva de esos tres, que es justamente el punto: una
// clínica no elige dieciocho colores, elige el suyo.
//
// LA VISTA PREVIA ES EL SISTEMA, NO UNA MAQUETA. Al mover el color, las
// variables CSS del documento cambian de verdad: el menú, los botones y
// esta misma pantalla se repintan. Una vista previa dibujada aparte
// miente el día que alguna pantalla usa un tono que la maqueta no tenía.
// Si se sale sin guardar, se restaura lo guardado.
//
// EL CÁLCULO NO SE HACE ACÁ. El color que se guarda puede no ser el
// elegido: si no llega a 4.5:1 con el texto que va encima, el servidor lo
// oscurece y lo dice. Esta pantalla pregunta y muestra la respuesta.
// ---------------------------------------------------------------------

const TEMAS: { clave: "marca" | "sereno" | "vibrante"; nombre: string; descripcion: string }[] = [
  {
    clave: "marca",
    nombre: "Marca",
    descripcion: "El color de la clínica manda. Fondos claros y mucho contraste.",
  },
  {
    clave: "sereno",
    nombre: "Sereno",
    descripcion: "Más gris y menos saturación, para jornadas largas frente a la pantalla.",
  },
  {
    clave: "vibrante",
    nombre: "Vibrante",
    descripcion: "Acentos más vivos. Los estados se distinguen de lejos.",
  },
];

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TIPOS = ["image/png", "image/jpeg", "image/webp"];

export function PanelApariencia() {
  const { user } = useAuth();
  const { recargar } = useApariencia();
  const [datos, setDatos] = useState<AparienciaApi | null>(null);
  const [cargando, setCargando] = useState(true);
  const [color, setColor] = useState("");
  const [tema, setTema] = useState<"marca" | "sereno" | "vibrante">("marca");
  const [calculado, setCalculado] = useState<AparienciaApi["calculado"] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);

  // Lo guardado, para poder volver a ello si se sale sin guardar.
  const guardadoRef = useRef<{ calculado: AparienciaApi["calculado"]; tema: string } | null>(null);

  useEffect(() => {
    adminApi
      .obtenerApariencia()
      .then((a) => {
        setDatos(a);
        setColor(a.primario);
        setTema(a.tema);
        setCalculado(a.calculado);
        guardadoRef.current = { calculado: a.calculado, tema: a.tema };
      })
      .catch((e) => setError(e?.message ?? "No se pudo leer la apariencia."))
      .finally(() => setCargando(false));
  }, []);

  // Al salir de la pantalla, lo guardado vuelve a mandar. Sin esto, un
  // color probado y no guardado se quedaría pintado hasta recargar, y
  // parecería que se guardó.
  useEffect(() => {
    return () => {
      const g = guardadoRef.current;
      if (g) aplicarTema(g.calculado, g.tema, { recordar: true, tenantId: user?.tenantId ?? null });
    };
  }, [user]);

  // El color se pide al servidor con un respiro: el selector nativo
  // dispara un evento por cada pixel que se arrastra, y eso serían
  // cientos de llamadas para elegir un color.
  useEffect(() => {
    if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
    const id = setTimeout(() => {
      adminApi
        .previsualizarApariencia(color)
        .then((c) => {
          setCalculado(c);
          aplicarTema(c, tema);
        })
        .catch(() => {
          /* un color que el servidor rechaza no rompe la pantalla */
        });
    }, 250);
    return () => clearTimeout(id);
  }, [color, tema]);

  const guardar = async () => {
    setGuardando(true);
    setMensaje(null);
    setError(null);
    try {
      const a = await adminApi.guardarApariencia({ primario: color, tema });
      setDatos(a);
      setColor(a.primario);
      setCalculado(a.calculado);
      guardadoRef.current = { calculado: a.calculado, tema: a.tema };
      aplicarTema(a.calculado, a.tema, { recordar: true, tenantId: user?.tenantId ?? null });
      await recargar();
      setMensaje(
        a.calculado.ajustado
          ? `Guardado. El color se oscureció a ${a.calculado.primario} para que el texto encima se lea.`
          : "Guardado. Todo el personal de la clínica lo verá así."
      );
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  };

  const restablecer = async () => {
    setGuardando(true);
    setMensaje(null);
    setError(null);
    try {
      const a = await adminApi.restablecerApariencia();
      setDatos(a);
      setColor(a.primario);
      setTema(a.tema);
      setCalculado(a.calculado);
      guardadoRef.current = { calculado: a.calculado, tema: a.tema };
      aplicarTema(a.calculado, a.tema, { recordar: true, tenantId: user?.tenantId ?? null });
      await recargar();
      setMensaje("Se volvió al tema de fábrica. El logo no se tocó: es de la clínica.");
    } catch (e: any) {
      setError(e?.message ?? "No se pudo restablecer.");
    } finally {
      setGuardando(false);
    }
  };

  const subirLogo = async (archivo: File | null) => {
    setErrorLogo(null);
    if (!archivo) return;
    if (!LOGO_TIPOS.includes(archivo.type)) {
      setErrorLogo("Solo se aceptan archivos PNG, JPG o WebP.");
      return;
    }
    if (archivo.size > LOGO_MAX_BYTES) {
      setErrorLogo("El archivo supera el máximo de 2 MB.");
      return;
    }
    setSubiendoLogo(true);
    try {
      const { logoUrl } = await adminApi.subirLogo(archivo);
      setDatos((prev) => (prev ? { ...prev, logoUrl } : prev));
      await recargar();
    } catch (e: any) {
      setErrorLogo(e?.message ?? "No se pudo subir el logo.");
    } finally {
      setSubiendoLogo(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" cantidad={3} />;
  if (!datos) {
    return <p className="text-sm text-error">{error ?? "No se pudo leer la apariencia."}</p>;
  }

  const hayCambios = color !== datos.primario || tema !== datos.tema;
  const srcLogo = datos.logoUrl
    ? datos.logoUrl.startsWith("http")
      ? datos.logoUrl
      : `${API_ORIGIN}${datos.logoUrl}`
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card>
          <CardTitle>El color de la clínica</CardTitle>
          <CardDescription>
            De este color salen el menú, los encabezados, los botones y los enlaces.
          </CardDescription>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000"}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              className="h-11 w-16 cursor-pointer rounded-lg border border-black/10 bg-surface p-1"
              aria-label="Elegir el color de la clínica"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              spellCheck={false}
              className="h-11 w-32 rounded-lg border border-black/10 bg-surface px-3 font-mono text-sm uppercase"
              aria-label="Color en hexadecimal"
            />
            {calculado?.ajustado && (
              <p className="flex-1 text-sm text-text-muted">
                <strong className="text-text-primary">{calculado.primarioElegido}</strong> no llega
                a 4,5:1 con el texto que va encima. Se usa{" "}
                <strong className="text-text-primary">{calculado.primario}</strong>, que sí.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>El logo</CardTitle>
          <CardDescription>
            El mismo que va en los correos al cliente y en el informe clínico. Se guarda apenas se
            elige.
          </CardDescription>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => archivoRef.current?.click()}
              className="flex h-16 w-40 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background hover:opacity-80"
              aria-label="Cambiar el logo de la clínica"
            >
              {srcLogo ? (
                <img
                  src={srcLogo}
                  alt={`Logo de ${datos.nombreClinica}`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Icono nombre="clinica" tamano={24} className="text-text-muted" />
              )}
            </button>
            <input
              ref={archivoRef}
              type="file"
              accept="image/png, image/jpeg, image/webp"
              className="hidden"
              onChange={(e) => void subirLogo(e.target.files?.[0] ?? null)}
            />
            <div>
              <p className="text-sm text-text-muted">PNG, JPG o WebP. Máximo 2 MB.</p>
              {subiendoLogo && <p className="text-sm text-text-muted">Subiendo…</p>}
              {errorLogo && <p className="mt-1 text-sm text-error">{errorLogo}</p>}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>El tema</CardTitle>
          <CardDescription>
            Cambia los fondos y la intensidad, no el color de la clínica.
          </CardDescription>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {TEMAS.map((t) => (
              <button
                key={t.clave}
                type="button"
                onClick={() => setTema(t.clave)}
                aria-pressed={tema === t.clave}
                className={[
                  "rounded-xl border p-3 text-left transition-colors",
                  tema === t.clave
                    ? "border-primary bg-primary-suave"
                    : "border-black/10 hover:border-primary-borde",
                ].join(" ")}
              >
                <p className="text-sm font-semibold text-text-primary">{t.nombre}</p>
                <p className="mt-0.5 text-xs text-text-muted">{t.descripcion}</p>
              </button>
            ))}
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando || !hayCambios}
            className="min-h-11 rounded-xl bg-primary px-5 font-semibold text-sobre-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={() => void restablecer()}
            disabled={guardando}
            className="min-h-11 rounded-xl border border-black/10 px-5 font-medium text-text-primary hover:bg-black/5 disabled:opacity-50"
          >
            Restablecer
          </button>
          {mensaje && <p className="text-sm text-success">{mensaje}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </div>

      {/* La vista previa. No dibuja un sistema de mentira: el documento ya
          está pintado con el color elegido, así que lo que se ve acá se ve
          igual en el menú de la izquierda mientras se elige. */}
      <Card>
        <CardTitle>Así se ve</CardTitle>
        <CardDescription>El menú de la izquierda ya cambió: esto es el sistema.</CardDescription>

        <div className="mt-4 overflow-hidden rounded-xl border border-black/10">
          <div className="flex items-center gap-3 bg-primary px-4 py-3 text-sobre-primary">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sobre-primary/15">
              <Icono nombre="clinica" tamano={20} className="text-sobre-primary" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{datos.nombreClinica}</p>
              <p className="text-xs text-sobre-primary/75">Vetline</p>
            </div>
          </div>
          <div className="space-y-2 bg-surface p-4">
            <p className="text-sm text-text-primary">Texto normal sobre el fondo de la tarjeta.</p>
            <p className="text-sm text-text-muted">Texto secundario, el de las descripciones.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-sobre-primary">
                Botón principal
              </span>
              <span className="rounded-lg border border-primary-borde bg-primary-suave px-3 py-2 text-sm font-medium text-primary">
                Secundario
              </span>
            </div>
          </div>
        </div>

        {calculado && (
          <dl className="mt-4 space-y-1 text-xs text-text-muted">
            {/* Las dos medidas son distintas y las dos importan. La
                primera es el texto ENCIMA del color (la franja, el
                menu); la segunda es el color USADO COMO TEXTO sobre
                fondo claro (enlaces, pestaña activa). Un amarillo puro
                saca 16:1 en la primera y 1,07:1 en la segunda. Mostrar
                una sola, como estaba, era mostrar la que convenia. */}
            <div className="flex justify-between gap-2">
              <dt>Texto encima del color ({calculado.sobrePrimario})</dt>
              <dd className="font-semibold text-text-primary">
                {calculado.contrasteDelTextoEncima.toFixed(2)}:1
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>El color como texto ({calculado.primarioTexto})</dt>
              <dd className="font-semibold text-text-primary">
                {calculado.contrasteComoTexto.toFixed(2)}:1
              </dd>
            </div>
            {calculado.primarioTexto !== calculado.primario && (
              <p className="pt-1">
                Como texto sobre fondo claro se usa un tono más oscuro: el color elegido ahí no se
                leería.
              </p>
            )}
          </dl>
        )}
      </Card>
    </div>
  );
}
