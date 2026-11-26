import { plural } from "../../lib/plural";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icono,
  Input,
  LoadingState,
  Select,
  useToast,
  PageHeader,
} from "../../components/ui";
import { SelectorUbicacion } from "../../components/SelectorUbicacion";
import { useAuth } from "../../hooks/useAuth";
import {
  Catalogos,
  CredencialPublica,
  Emisor,
  facturacionCrApi,
} from "../../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// Configuración del emisor y carga de credenciales.
//
// La regla que gobierna esta pantalla: **de las credenciales solo se
// muestra SI están cargadas, para qué ambiente, con qué usuario y cuándo
// vence la llave.** La contraseña, el PIN y la llave no se muestran
// porque el backend no los devuelve — no es que la pantalla los oculte.
//
// Y no hay forma de "ver" una credencial cargada: si alguien la perdió,
// la carga de nuevo. Un botón de "mostrar" sería exactamente la puerta
// que el cifrado en reposo existe para cerrar.
// ---------------------------------------------------------------------

const AMBIENTES = [
  { value: "pruebas", label: "Pruebas (sandbox de Hacienda)" },
  { value: "produccion", label: "Producción" },
];

export function ConfiguracionEmisor() {
  const toast = useToast();
  const { esAdminClinica } = useAuth();
  const [emisor, setEmisor] = useState<Emisor | null>(null);
  const [credenciales, setCredenciales] = useState<CredencialPublica[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState<Partial<Emisor>>({
    tipoIdentificacion: "02",
    sucursal: "001",
    terminal: "00001",
    ambienteActivo: "pruebas",
  });

  const [credAmbiente, setCredAmbiente] = useState<"pruebas" | "produccion">("pruebas");
  const [usuarioApi, setUsuarioApi] = useState("");
  const [passwordApi, setPasswordApi] = useState("");
  const [pinLlave, setPinLlave] = useState("");
  const [archivoLlave, setArchivoLlave] = useState<File | null>(null);

  const recargar = () => {
    setCargando(true);
    facturacionCrApi
      .emisor()
      .then((r) => {
        setEmisor(r.emisor);
        setCredenciales(r.credenciales);
        if (r.emisor) setForm(r.emisor);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setCargando(false));
  };

  useEffect(recargar, []);
  useEffect(() => {
    facturacionCrApi.catalogos().then(setCatalogos).catch(() => setCatalogos(null));
  }, []);

  const guardarEmisor = async () => {
    setGuardando(true);
    try {
      const r = await facturacionCrApi.guardarEmisor(form);
      setEmisor(r.emisor);
      toast.exito("Datos fiscales guardados.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const guardarCredenciales = async () => {
    if (!archivoLlave) {
      toast.aviso("Hace falta el archivo de la llave criptográfica (.p12).");
      return;
    }
    setGuardando(true);
    try {
      const r = await facturacionCrApi.guardarCredenciales({
        ambiente: credAmbiente,
        usuarioApi,
        passwordApi,
        pinLlave,
        llave: archivoLlave,
      });
      toast.exito(
        `Credenciales de ${credAmbiente} cargadas. La llave vence el ${r.credencial.llaveVenceEn}.`
      );
      // Los campos se limpian en cuanto se guardan: dejar la contraseña
      // y el PIN escritos en la pantalla después de guardarlos es la
      // forma más fácil de que terminen en una captura de pantalla.
      setUsuarioApi("");
      setPasswordApi("");
      setPinLlave("");
      setArchivoLlave(null);
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const borrarCredenciales = async (ambiente: "pruebas" | "produccion") => {
    setGuardando(true);
    try {
      await facturacionCrApi.borrarCredenciales(ambiente);
      toast.exito(`Credenciales de ${ambiente} borradas.`);
      recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" cantidad={2} />;

  const campo = (
    etiqueta: string,
    clave: keyof Emisor,
    extra: { placeholder?: string; maxLength?: number } = {}
  ) => (
    <Input
      label={etiqueta}
      value={(form[clave] as string) ?? ""}
      onChange={(e) => setForm((f) => ({ ...f, [clave]: e.target.value }))}
      disabled={!esAdminClinica}
      {...extra}
    />
  );

  return (
    <div>
      <PageHeader
        padre={{ a: "/facturacion", etiqueta: "Comprobantes" }}
        titulo="Emisor y credenciales"
        subtitulo="Los datos fiscales con los que se emite, y las credenciales de Hacienda."
        icono="ajustes"
        modulo="facturacion"
      />

      {!esAdminClinica && (
        <div className="mt-4 rounded-xl border border-black/5 bg-surface p-3 text-sm text-text-muted">
          Solo un administrador de la clínica puede cambiar estos datos. Puede verlos.
        </div>
      )}

      <Card className="mt-6">
        <CardTitle>Datos fiscales</CardTitle>
        <CardDescription>
          Son los que van en cada comprobante. Tienen que coincidir con lo inscrito en el ATV: si no,
          Hacienda rechaza.
        </CardDescription>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Select
            label="Tipo de identificación"
            value={form.tipoIdentificacion ?? "02"}
            onChange={(e) => setForm((f) => ({ ...f, tipoIdentificacion: e.target.value }))}
            disabled={!esAdminClinica}
            options={(catalogos?.tiposIdentificacion ?? []).map((t) => ({
              value: t.codigo,
              label: t.nombre,
            }))}
          />
          {campo("Número de identificación", "numeroIdentificacion", { placeholder: "3101123456" })}
          {campo("Razón social", "nombre", { placeholder: "Veterinaria Los Robles S.A." })}
          {campo("Nombre comercial", "nombreComercial", { placeholder: "Veterinaria Los Robles" })}
          {campo("Actividad económica (6 dígitos)", "codigoActividadEconomica", {
            placeholder: "750000",
            maxLength: 6,
          })}
          {campo("Correo", "correo", { placeholder: "facturacion@clinica.com" })}
        </div>

        <CardTitle className="mt-6">Ubicación</CardTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Los tres códigos salen de la codificación oficial de
              Hacienda, encadenados, en vez de tres campos numéricos
              sueltos: la combinación tiene que existir, y ahora la base
              lo exige con una clave foránea (migración 093). */}
          <SelectorUbicacion
            idPrefijo="emisor"
            disabled={!esAdminClinica}
            valor={{
              provincia: form.ubicacionProvincia,
              canton: form.ubicacionCanton,
              distrito: form.ubicacionDistrito,
              barrio: form.ubicacionBarrio,
            }}
            onChange={(u) =>
              setForm((f) => ({
                ...f,
                ubicacionProvincia: u.provincia ?? "",
                ubicacionCanton: u.canton ?? "",
                ubicacionDistrito: u.distrito ?? "",
                ubicacionBarrio: u.barrio ?? "",
              }))
            }
          />
          <div className="sm:col-span-2 lg:col-span-4">
            {campo("Otras señas", "ubicacionOtrasSenas", {
              placeholder: "200 metros norte de la iglesia, local 3",
              maxLength: 250,
            })}
          </div>
          {campo("Código de país del teléfono", "telefonoCodigoPais", { placeholder: "506", maxLength: 3 })}
          {campo("Teléfono", "telefonoNumero", { placeholder: "22334455", maxLength: 20 })}
        </div>

        <CardTitle className="mt-6">Numeración y ambiente</CardTitle>
        <CardDescription>
          La sucursal y la terminal forman parte del consecutivo de cada comprobante. 001 es la casa
          matriz y 00001 la terminal única.
        </CardDescription>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {campo("Sucursal", "sucursal", { placeholder: "001", maxLength: 3 })}
          {campo("Terminal", "terminal", { placeholder: "00001", maxLength: 5 })}
          <Select
            label="Ambiente con el que se emite"
            value={form.ambienteActivo ?? "pruebas"}
            onChange={(e) =>
              setForm((f) => ({ ...f, ambienteActivo: e.target.value as "pruebas" | "produccion" }))
            }
            disabled={!esAdminClinica}
            options={AMBIENTES}
          />
        </div>

        {emisor && (
          <p className="mt-4 text-xs text-text-muted">
            Proveedor de sistemas declarado en cada comprobante:{" "}
            <span className="font-mono">{emisor.proveedorSistemas}</span>. Lo pone el servidor y es el
            mismo para todas las clínicas.
          </p>
        )}

        {esAdminClinica && (
          <div className="mt-4 flex justify-end">
            <Button onClick={guardarEmisor} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar datos fiscales"}
            </Button>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle>Credenciales de Hacienda</CardTitle>
        <CardDescription>
          El usuario y la contraseña de la API (se generan en el ATV y llegan al buzón electrónico) y
          la llave criptográfica .p12 con su PIN.
        </CardDescription>

        <div className="mt-4 space-y-3">
          {(["pruebas", "produccion"] as const).map((ambiente) => {
            const c = credenciales.find((x) => x.ambiente === ambiente);
            const vencida = c?.diasParaVencer !== null && c?.diasParaVencer !== undefined && c.diasParaVencer < 0;
            const porVencer =
              c?.diasParaVencer !== null &&
              c?.diasParaVencer !== undefined &&
              c.diasParaVencer >= 0 &&
              c.diasParaVencer <= 30;
            return (
              <div
                key={ambiente}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-black/5 bg-background/50 p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-text">
                    {ambiente === "pruebas" ? "Pruebas (sandbox)" : "Producción"}
                    {emisor?.ambienteActivo === ambiente && (
                      <span className="ml-2 text-xs font-normal text-text-muted">
                        — es el ambiente activo
                      </span>
                    )}
                  </p>
                  {c ? (
                    <>
                      <p className="mt-1 break-all text-xs text-text-muted">{c.usuarioApi}</p>
                      <p className="mt-1 text-xs text-text-muted">
                        Llave: {c.llaveNombreArchivo ?? "(sin nombre de archivo)"}
                        {c.llaveVenceEn && ` · vence el ${c.llaveVenceEn}`}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-text-muted">Sin credenciales cargadas.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!c && <Badge variant="neutral">No cargadas</Badge>}
                  {c && vencida && (
                    <Badge variant="error" dot>
                      La llave venció
                    </Badge>
                  )}
                  {c && porVencer && (
                    <Badge variant="warning" dot>
                      Vence en {plural(c.diasParaVencer ?? 0, "día", "días")}
                    </Badge>
                  )}
                  {c && !vencida && !porVencer && (
                    <Badge variant="success" dot>
                      Cargadas
                    </Badge>
                  )}
                  {c && esAdminClinica && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => borrarCredenciales(ambiente)}
                      disabled={guardando}
                    >
                      <Icono nombre="borrar" tamano={16} /> Borrar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {esAdminClinica && (
          <>
            <CardTitle className="mt-6">Cargar o reemplazar</CardTitle>
            <CardDescription>
              Lo que se carga acá queda cifrado y no se puede volver a ver. Si se pierde, se carga de
              nuevo.
            </CardDescription>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Select
                label="Ambiente"
                value={credAmbiente}
                onChange={(e) => setCredAmbiente(e.target.value as "pruebas" | "produccion")}
                options={AMBIENTES}
              />
              <Input
                label="Usuario de la API"
                value={usuarioApi}
                onChange={(e) => setUsuarioApi(e.target.value)}
                placeholder="cpj-3-101-123456@stag.comprobanteselectronicos.go.cr"
              />
              <Input
                label="Contraseña de la API"
                type="password"
                value={passwordApi}
                onChange={(e) => setPasswordApi(e.target.value)}
                placeholder="La que generó el ATV"
                autoComplete="new-password"
              />
              <Input
                label="PIN de la llave"
                type="password"
                value={pinLlave}
                onChange={(e) => setPinLlave(e.target.value)}
                autoComplete="new-password"
              />
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-text">Llave criptográfica (.p12)</span>
                <input
                  type="file"
                  accept=".p12,.pfx,application/x-pkcs12"
                  onChange={(e) => setArchivoLlave(e.target.files?.[0] ?? null)}
                  className="rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm"
                />
                <span className="text-xs text-text-muted">
                  La que entrega el banco o el BCCR. Tiene que ser RSA de 2048 o 4096 bits: si no,
                  Hacienda rechaza la firma y se avisa al cargarla, no al emitir.
                </span>
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={guardarCredenciales}
                disabled={guardando || !usuarioApi || !passwordApi || !pinLlave || !archivoLlave}
              >
                {guardando ? "Guardando…" : "Guardar credenciales"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
