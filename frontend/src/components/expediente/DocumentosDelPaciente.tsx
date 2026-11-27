import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Icono } from "../ui/Icono";
import { Input } from "../ui/Input";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import { useToast } from "../ui/Toast";
import { apiFetchFile } from "../../lib/api";
import { getStoredToken, useAuth } from "../../hooks/useAuth";
import { formatearFechaCorta } from "../../lib/formatFecha";

// ---------------------------------------------------------------------
// IMÁGENES Y DOCUMENTOS DEL PACIENTE — hallazgo de la revisión del
// 2026-11-27: la pestaña mostraba la línea de tiempo filtrada y **no
// permitía agregar nada**.
//
// Era peor que un faltante: el médico que saca una radiografía la manda
// por WhatsApp, el expediente queda sin el estudio y la imagen queda en
// un teléfono.
//
// DECISIONES:
//
//   * **Carga múltiple por arrastre o por selector**, y en el teléfono
//     el botón de cámara (`capture="environment"`). Son tres entradas
//     al mismo flujo, no tres flujos.
//   * **Los metadatos se piden UNA vez para todo el lote.** Cinco fotos
//     de la misma radiografía tienen el mismo tipo y la misma fecha;
//     pedirlos cinco veces es cómo se consigue que nadie los complete.
//   * **Cada archivo sube en su propia solicitud y se informa de a
//     uno.** Si el tercero falla, los dos primeros ya están: un lote
//     que se cae entero porque uno pesaba 30 MB es un lote que hay que
//     volver a armar.
//   * **El origen se muestra siempre**, con su enlace: un PDF que llegó
//     como resultado de laboratorio y uno que alguien escaneó no son lo
//     mismo.
//   * **Las imágenes se ven con el descargador autenticado**, no con un
//     `<img src>` directo: los archivos del expediente son privados y
//     se sirven con sesión.
// ---------------------------------------------------------------------

interface Documento {
  id: string;
  nombre_archivo: string;
  tipo: string;
  tipo_documento: string | null;
  tipo_documento_nombre: string | null;
  descripcion: string | null;
  fecha_documento: string | null;
  creado_en: string;
  atencion_id: string | null;
  origen: "subido" | "laboratorio" | "caso";
  origen_id: string | null;
  subido_por: string | null;
  es_imagen: boolean;
}

interface TipoDocumento {
  id: string;
  codigo: string;
  nombre: string;
  administrativo: boolean;
}

const ETIQUETA_ORIGEN: Record<Documento["origen"], string> = {
  subido: "Subido acá",
  laboratorio: "Resultado de laboratorio",
  caso: "Caso de Vetline Ai",
};

export function DocumentosDelPaciente({
  pacienteId,
  /** Cuando se está en una atención, el adjunto queda ligado a ella. */
  atencionId,
  onCambio,
}: {
  pacienteId: string;
  atencionId?: string | null;
  onCambio?: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const { esMedico, zonaHoraria } = useAuth();

  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [tipos, setTipos] = useState<TipoDocumento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");

  const [subiendo, setSubiendo] = useState(false);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [tipoElegido, setTipoElegido] = useState("");
  const [fechaDocumento, setFechaDocumento] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [arrastrando, setArrastrando] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);

  const [viendo, setViendo] = useState<{ doc: Documento; url: string } | null>(null);
  const selector = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtroTipo) params.set("tipo", filtroTipo);
      if (filtroDesde) params.set("desde", filtroDesde);
      if (filtroHasta) params.set("hasta", filtroHasta);
      const r = await fetch(
        `${(import.meta.env.VITE_API_URL as string) ?? "/api"}/expediente/pacientes/${pacienteId}/documentos?${params}`,
        { headers: { Authorization: `Bearer ${getStoredToken() ?? ""}` } }
      );
      const datos = await r.json();
      if (!r.ok) throw new Error(datos?.error ?? "No se pudieron cargar los documentos.");
      setDocumentos(datos.documentos);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCargando(false);
    }
  }, [pacienteId, filtroTipo, filtroDesde, filtroHasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    fetch(`${(import.meta.env.VITE_API_URL as string) ?? "/api"}/expediente/tipos-documento`, {
      headers: { Authorization: `Bearer ${getStoredToken() ?? ""}` },
    })
      .then((r) => r.json())
      .then((d) => setTipos(d.tipos ?? []))
      .catch(() => setTipos([]));
  }, []);

  /** Los tipos que esta persona puede subir. La misma regla del backend. */
  const tiposQuePuedeSubir = tipos.filter((t) => esMedico || t.administrativo);

  const elegir = (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    setArchivos(Array.from(lista));
    setSubiendo(true);
    if (!tipoElegido && tiposQuePuedeSubir.length > 0) {
      setTipoElegido(tiposQuePuedeSubir[0].codigo);
    }
  };

  const subir = async () => {
    if (archivos.length === 0 || !tipoElegido) return;
    let subidos = 0;
    const fallidos: string[] = [];
    for (const [i, archivo] of archivos.entries()) {
      setProgreso(`Subiendo ${i + 1} de ${archivos.length}: ${archivo.name}`);
      const cuerpo = new FormData();
      cuerpo.append("archivo", archivo);
      cuerpo.append("pacienteId", pacienteId);
      cuerpo.append("tipoDocumento", tipoElegido);
      if (fechaDocumento) cuerpo.append("fechaDocumento", fechaDocumento);
      if (descripcion.trim()) cuerpo.append("descripcion", descripcion.trim());
      if (atencionId) cuerpo.append("atencionId", atencionId);
      try {
        const r = await fetch(
          `${(import.meta.env.VITE_API_URL as string) ?? "/api"}/archivos`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${getStoredToken() ?? ""}` },
            body: cuerpo,
          }
        );
        const datos = await r.json();
        if (!r.ok) throw new Error(datos?.error ?? "No se pudo subir.");
        subidos++;
      } catch (err) {
        // CADA ARCHIVO ES SU PROPIA SOLICITUD: el que falla no se lleva
        // a los que ya subieron.
        fallidos.push(`${archivo.name}: ${(err as Error).message}`);
      }
    }
    setProgreso(null);
    if (subidos > 0) {
      toast.exito(
        subidos === 1 ? "Documento agregado al expediente." : `${subidos} documentos agregados.`
      );
    }
    for (const f of fallidos) toast.error(f);
    setSubiendo(false);
    setArchivos([]);
    setDescripcion("");
    setFechaDocumento("");
    await cargar();
    onCambio?.();
  };

  const abrir = async (doc: Documento) => {
    try {
      const { blob } = await apiFetchFile(`/archivos/${doc.id}`, { token: getStoredToken() });
      setViendo({ doc, url: URL.createObjectURL(blob) });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const descargar = async (doc: Documento) => {
    try {
      const { blob } = await apiFetchFile(`/archivos/${doc.id}`, { token: getStoredToken() });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = doc.nombre_archivo;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {/* --- La carga ------------------------------------------------ */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          elegir(e.dataTransfer.files);
        }}
        className={[
          "rounded-xl border-2 border-dashed p-4 transition-colors",
          arrastrando ? "border-primary bg-primary/5" : "border-black/15",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => selector.current?.click()}>
            <Icono nombre="agregar" className="mr-1 h-4 w-4" />
            Agregar imagen o documento
          </Button>
          {/* LA CÁMARA, solo donde existe: `capture` en una computadora
              abre el selector igual, así que el botón se muestra siempre
              y en el escritorio hace lo mismo que el otro. */}
          <Button variant="secondary" onClick={() => camara.current?.click()}>
            <Icono nombre="producto" className="mr-1 h-4 w-4" />
            Tomar una foto
          </Button>
          <p className="text-xs text-text-muted">
            Se pueden arrastrar varios archivos acá. Hasta 25 MB cada uno.
          </p>
        </div>
        <input
          ref={selector}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => elegir(e.target.files)}
        />
        <input
          ref={camara}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => elegir(e.target.files)}
        />
      </div>

      {/* --- Los filtros --------------------------------------------- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            label="Tipo"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            options={[
              { value: "", label: "Todos los tipos" },
              ...tipos.map((t) => ({ value: t.codigo, label: t.nombre })),
            ]}
          />
        </div>
        <Input
          type="date"
          label="Desde"
          value={filtroDesde}
          onChange={(e) => setFiltroDesde(e.target.value)}
        />
        <Input
          type="date"
          label="Hasta"
          value={filtroHasta}
          onChange={(e) => setFiltroHasta(e.target.value)}
        />
        {(filtroTipo || filtroDesde || filtroHasta) && (
          <Button
            variant="ghost"
            onClick={() => {
              setFiltroTipo("");
              setFiltroDesde("");
              setFiltroHasta("");
            }}
          >
            Limpiar
          </Button>
        )}
      </div>

      {/* --- La galería ---------------------------------------------- */}
      {cargando ? (
        <LoadingState />
      ) : documentos.length === 0 ? (
        <EmptyState
          titulo="Todavía no hay imágenes ni documentos"
          texto="Las radiografías, las ecografías, las fotos clínicas y los informes que trae el cliente se cargan acá y quedan en la historia del paciente."
          icono="pdf"
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {documentos.map((d) => (
            <Card key={d.id} className="flex flex-col gap-2 p-3">
              <button
                type="button"
                onClick={() => abrir(d)}
                className="flex h-28 items-center justify-center rounded-lg bg-background"
              >
                <Icono
                  nombre={d.es_imagen ? "producto" : "pdf"}
                  tamano={32}
                  className="text-text-muted"
                />
              </button>
              <p className="truncate text-sm font-semibold text-text-primary" title={d.nombre_archivo}>
                {d.nombre_archivo}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {d.tipo_documento_nombre && (
                  <Badge variant="info">{d.tipo_documento_nombre}</Badge>
                )}
                {/* EL ORIGEN, SIEMPRE, con su enlace al registro. */}
                <Badge variant={d.origen === "subido" ? "neutral" : "warning"}>
                  {ETIQUETA_ORIGEN[d.origen]}
                </Badge>
              </div>
              <p className="text-xs text-text-muted">
                {formatearFechaCorta(d.fecha_documento ?? d.creado_en, zonaHoraria)}
                {d.subido_por ? ` · ${d.subido_por}` : ""}
              </p>
              {d.descripcion && <p className="text-xs text-text-secondary">{d.descripcion}</p>}
              <div className="mt-auto flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" onClick={() => abrir(d)}>
                  Ver
                </Button>
                <Button variant="ghost" size="sm" onClick={() => descargar(d)}>
                  Descargar
                </Button>
                {d.origen === "laboratorio" && d.origen_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/pacientes?id=${pacienteId}&tab=laboratorio`)}
                  >
                    Ver el estudio
                  </Button>
                )}
                {d.origen === "caso" && d.origen_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/workspace/casos/${d.origen_id}`)}
                  >
                    Ver el caso
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* --- El modal de carga --------------------------------------- */}
      <Modal
        open={subiendo}
        onClose={() => {
          setSubiendo(false);
          setArchivos([]);
        }}
        title={
          archivos.length === 1
            ? "Agregar un documento"
            : `Agregar ${archivos.length} documentos`
        }
        description="Los datos valen para todos los archivos del lote: cinco fotos de la misma radiografía son el mismo tipo y la misma fecha."
        hayCambios={archivos.length > 0}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setSubiendo(false);
                setArchivos([]);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={subir} disabled={!tipoElegido || !!progreso}>
              {progreso ?? "Subir"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <ul className="max-h-32 overflow-auto rounded-lg bg-background p-2 text-xs">
            {archivos.map((a) => (
              <li key={a.name} className="truncate">
                {a.name} — {(a.size / 1024 / 1024).toFixed(1)} MB
              </li>
            ))}
          </ul>
          <Select
            label="Tipo de documento"
            value={tipoElegido}
            onChange={(e) => setTipoElegido(e.target.value)}
            options={tiposQuePuedeSubir.map((t) => ({ value: t.codigo, label: t.nombre }))}
          />
          {!esMedico && (
            <p className="text-xs text-text-muted">
              Desde recepción se cargan el historial previo, los informes externos y los
              certificados. Las radiografías, las ecografías y las fotos clínicas las sube un
              médico.
            </p>
          )}
          <Input
            type="date"
            label="Fecha del documento"
            value={fechaDocumento}
            onChange={(e) => setFechaDocumento(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            Puede ser muy anterior a hoy: un historial previo es de hace años. Si se deja vacía, se
            usa la fecha de la carga.
          </p>
          <Input
            label="Descripción"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="radiografía de tórax, proyección lateral"
          />
          {atencionId && (
            <p className="text-xs text-text-secondary">
              Queda ligado a la atención en curso.
            </p>
          )}
        </div>
      </Modal>

      {/* --- El visor ------------------------------------------------ */}
      {viendo && (
        <Modal
          open
          onClose={() => {
            URL.revokeObjectURL(viendo.url);
            setViendo(null);
          }}
          title={viendo.doc.nombre_archivo}
          description={
            viendo.doc.descripcion ??
            (viendo.doc.tipo_documento_nombre ? viendo.doc.tipo_documento_nombre : undefined)
          }
          ancho="xl"
          tipo="consulta"
        >
          {viendo.doc.es_imagen ? (
            // ZOOM con el gesto nativo: el navegador ya sabe hacerlo
            // mejor que un visor propio, y en una tablet es el gesto que
            // el médico espera.
            <div className="max-h-[70vh] overflow-auto">
              <img
                src={viendo.url}
                alt={viendo.doc.nombre_archivo}
                className="w-full cursor-zoom-in"
                style={{ maxWidth: "none" }}
                onClick={(e) => {
                  const img = e.currentTarget;
                  img.style.width = img.style.width === "200%" ? "100%" : "200%";
                }}
              />
            </div>
          ) : (
            <iframe
              src={viendo.url}
              title={viendo.doc.nombre_archivo}
              className="h-[70vh] w-full rounded-lg"
            />
          )}
        </Modal>
      )}
    </div>
  );
}
