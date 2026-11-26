import { useEffect, useRef, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Table, TableColumn } from "../../components/ui/Table";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { AgenteCatalogo, platformApi } from "../../lib/platformApi";
import {
  DocumentoConocimiento,
  esArchivoPdf,
  platformAdminApi,
  TipoDocumento,
} from "../../lib/platformAdminApi";
import { guardarComoArchivo } from "../../lib/descargas";

const TIPO_LABEL: Record<TipoDocumento, string> = {
  banderas_rojas: "Banderas rojas",
  breed_intelligence: "Breed Intelligence",
  farmacoterapia: "Farmacoterapia",
  nutricion: "Nutrición",
  otro: "Otro",
};

const TIPO_OPTIONS = Object.entries(TIPO_LABEL).map(([value, label]) => ({ value, label }));

function MenuAcciones({
  puedePreview,
  onVistaPrevia,
  onDescargar,
  onEditar,
  onArchivar,
  onEliminar,
}: {
  puedePreview: boolean;
  onVistaPrevia: () => void;
  onDescargar: () => void;
  onEditar: () => void;
  onArchivar: (() => void) | null;
  onEliminar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={contenedorRef}>
      <button
        onClick={() => setAbierto((v) => !v)}
        className="rounded-lg px-2 py-1 text-lg font-bold leading-none text-text-muted hover:bg-black/5"
        aria-label="Acciones"
      >
        ⋯
      </button>
      {abierto && (
        <ul className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-lg border border-black/10 bg-surface shadow-lg">
          <li>
            <button
              onClick={() => {
                if (!puedePreview) return;
                setAbierto(false);
                onVistaPrevia();
              }}
              disabled={!puedePreview}
              title={puedePreview ? undefined : "Vista previa disponible solo para PDF — descargá para verlo."}
              className={[
                "block w-full px-4 py-2 text-left text-sm",
                puedePreview
                  ? "text-text-primary hover:bg-black/5"
                  : "cursor-not-allowed text-text-muted/50",
              ].join(" ")}
            >
              Vista previa
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                setAbierto(false);
                onDescargar();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-black/5"
            >
              Descargar
            </button>
          </li>
          <li className="border-t border-black/5">
            <button
              onClick={() => {
                setAbierto(false);
                onEditar();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-black/5"
            >
              Editar metadata
            </button>
          </li>
          {onArchivar && (
            <li>
              <button
                onClick={() => {
                  setAbierto(false);
                  onArchivar();
                }}
                className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-black/5"
              >
                Archivar
              </button>
            </li>
          )}
          <li className="border-t border-black/5">
            <button
              onClick={() => {
                setAbierto(false);
                onEliminar();
              }}
              className="block w-full px-4 py-2 text-left text-sm font-semibold text-error hover:bg-error/10"
            >
              Eliminar
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

// Sin zona horaria explícita: estos documentos no pertenecen a ningún
// tenant (catálogo global de la plataforma), así que formatearFechaCorta
// cae al default de la plataforma en vez de UTC implícito.
function formatearFecha(fecha: string) {
  return formatearFechaCorta(fecha, undefined);
}

export function BaseConocimiento() {
  const [agentesCatalogo, setAgentesCatalogo] = useState<AgenteCatalogo[]>([]);
  const [tab, setTab] = useState<string>("todas"); // "todas" | "compartidos" | agenteId
  const [documentos, setDocumentos] = useState<DocumentoConocimiento[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  const [modalCargaAbierto, setModalCargaAbierto] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [nombreDoc, setNombreDoc] = useState("");
  const [descripcionDoc, setDescripcionDoc] = useState("");
  const [tipoDoc, setTipoDoc] = useState<TipoDocumento>("otro");
  const [agenteDoc, setAgenteDoc] = useState(""); // "" = compartido
  const [subiendo, setSubiendo] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [documentoArchivar, setDocumentoArchivar] = useState<DocumentoConocimiento | null>(null);
  const [archivando, setArchivando] = useState(false);

  const [documentoEditar, setDocumentoEditar] = useState<DocumentoConocimiento | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const [descripcionEdit, setDescripcionEdit] = useState("");
  const [tipoEdit, setTipoEdit] = useState<TipoDocumento>("otro");
  const [agenteEdit, setAgenteEdit] = useState("");
  const [versionEdit, setVersionEdit] = useState("");
  const [archivoEdit, setArchivoEdit] = useState<File | null>(null);
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [errorEdit, setErrorEdit] = useState<string | null>(null);

  const [documentoEliminar, setDocumentoEliminar] = useState<DocumentoConocimiento | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const [documentoPreview, setDocumentoPreview] = useState<DocumentoConocimiento | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [errorPreview, setErrorPreview] = useState<string | null>(null);

  useEffect(() => {
    platformApi.listarAgentes().then((data) => setAgentesCatalogo(data.agentes));
  }, []);

  const cargarDocumentos = () => {
    setIsLoading(true);
    const agenteFiltro = tab === "todas" ? undefined : tab === "compartidos" ? null : tab;
    platformAdminApi
      .listarDocumentos(agenteFiltro)
      .then((data) => setDocumentos(data.documentos))
      .finally(() => setIsLoading(false));
  };

  useEffect(cargarDocumentos, [tab]);

  const documentosFiltrados = documentos.filter((d) =>
    d.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const limpiarFormularioCarga = () => {
    setArchivo(null);
    setNombreDoc("");
    setDescripcionDoc("");
    setTipoDoc("otro");
    setAgenteDoc("");
    setErrorCarga(null);
  };

  const subirDocumento = async () => {
    if (!archivo || !nombreDoc.trim()) return;
    setSubiendo(true);
    setErrorCarga(null);
    try {
      await platformAdminApi.subirDocumento({
        nombre: nombreDoc.trim(),
        descripcion: descripcionDoc.trim() || undefined,
        tipo: tipoDoc,
        agenteId: agenteDoc || null,
        archivo,
      });
      setModalCargaAbierto(false);
      limpiarFormularioCarga();
      cargarDocumentos();
    } catch (err: any) {
      setErrorCarga(err?.message ?? "No pudimos subir el documento.");
    } finally {
      setSubiendo(false);
    }
  };

  const confirmarArchivar = async () => {
    if (!documentoArchivar) return;
    setArchivando(true);
    try {
      await platformAdminApi.archivarDocumento(documentoArchivar.id);
      setDocumentoArchivar(null);
      cargarDocumentos();
    } finally {
      setArchivando(false);
    }
  };

  const abrirEditar = (d: DocumentoConocimiento) => {
    setDocumentoEditar(d);
    setNombreEdit(d.nombre);
    setDescripcionEdit(d.descripcion ?? "");
    setTipoEdit(d.tipo);
    setAgenteEdit(d.agente_id ?? "");
    setVersionEdit(d.version);
    setArchivoEdit(null);
    setErrorEdit(null);
  };

  const cerrarEditar = () => {
    setDocumentoEditar(null);
    setArchivoEdit(null);
    setErrorEdit(null);
  };

  const guardarEdicion = async () => {
    if (!documentoEditar || !nombreEdit.trim()) return;
    setGuardandoEdit(true);
    setErrorEdit(null);
    try {
      await platformAdminApi.editarDocumento(documentoEditar.id, {
        nombre: nombreEdit.trim(),
        descripcion: descripcionEdit.trim() || undefined,
        tipo: tipoEdit,
        agenteId: agenteEdit || null,
        version: versionEdit.trim() || "1.0",
        archivo: archivoEdit ?? undefined,
      });
      cerrarEditar();
      cargarDocumentos();
    } catch (err: any) {
      setErrorEdit(err?.message ?? "No pudimos guardar los cambios.");
    } finally {
      setGuardandoEdit(false);
    }
  };

  const confirmarEliminar = async () => {
    if (!documentoEliminar) return;
    setEliminando(true);
    try {
      await platformAdminApi.eliminarDocumento(documentoEliminar.id);
      setDocumentoEliminar(null);
      cargarDocumentos();
    } finally {
      setEliminando(false);
    }
  };

  const abrirVistaPrevia = async (d: DocumentoConocimiento) => {
    setDocumentoPreview(d);
    setPreviewUrl(null);
    setErrorPreview(null);
    setCargandoPreview(true);
    try {
      const blob = await platformAdminApi.obtenerArchivo(d.id);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      setErrorPreview(err?.message ?? "No pudimos cargar la vista previa.");
    } finally {
      setCargandoPreview(false);
    }
  };

  const cerrarVistaPrevia = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setDocumentoPreview(null);
    setPreviewUrl(null);
    setErrorPreview(null);
  };

  const descargarDocumento = async (d: DocumentoConocimiento) => {
    const blob = await platformAdminApi.obtenerArchivo(d.id, true);
    const ext = d.archivo_ref.slice(d.archivo_ref.lastIndexOf("."));
    guardarComoArchivo(blob, `${d.nombre}${ext}`);
  };

  const columns: TableColumn<DocumentoConocimiento>[] = [
    {
      key: "nombre",
      header: "Nombre",
      // min-width, no width/max-width: en una tabla con table-layout auto
      // (el default), un width fijo en una celda es solo una sugerencia
      // que el navegador puede achicar bajo presión de espacio — min-width
      // es lo único que realmente lo garantiza, dejando que el contenedor
      // (que ya tiene overflow-x-auto) scrollee si hace falta.
      className: "min-w-[380px]",
      render: (d) => (
        <div>
          <p className="font-semibold text-primary">{d.nombre}</p>
          {d.descripcion && (
            <p className="line-clamp-2 text-xs text-text-muted" title={d.descripcion}>
              {d.descripcion}
            </p>
          )}
          {!d.tiene_texto && (
            <Badge variant="warning" dot className="mt-1">
              Sin texto extraído — el agente no lo puede leer
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "tipo",
      header: "Tipo",
      render: (d) => <Badge variant="neutral">{TIPO_LABEL[d.tipo]}</Badge>,
    },
    {
      key: "agente",
      header: "Agente",
      render: (d) =>
        d.agente_nombre ? (
          <Badge variant="info">{d.agente_nombre}</Badge>
        ) : (
          <span className="text-sm text-text-muted">Compartido</span>
        ),
    },
    {
      key: "caracteres",
      header: "Caracteres",
      // Lo que realmente importa acá no es el peso del archivo, sino
      // cuánto entra al contexto del modelo — y por lo tanto cuánto
      // cuesta cada llamada que lo incluye.
      render: (d) => (
        <span className="text-sm text-text-primary">
          {d.caracteres_texto != null ? d.caracteres_texto.toLocaleString("es") : "—"}
        </span>
      ),
    },
    {
      key: "en_contexto",
      header: "En contexto",
      render: (d) => (
        <Badge variant={d.incluir_en_contexto ? "success" : "neutral"} dot>
          {d.incluir_en_contexto ? "Sí" : "No"}
        </Badge>
      ),
    },
    { key: "version", header: "Versión", render: (d) => d.version },
    {
      key: "estado",
      header: "Estado",
      render: (d) => (
        <Badge variant={d.estado === "activo" ? "success" : "neutral"} dot>
          {d.estado === "activo" ? "Activo" : "Archivado"}
        </Badge>
      ),
    },
    { key: "cargado_por", header: "Cargado por", render: (d) => d.cargado_por_nombre ?? "—" },
    { key: "fecha", header: "Fecha", render: (d) => formatearFecha(d.fecha_carga) },
    {
      key: "acciones",
      header: "Acciones",
      render: (d) => (
        <MenuAcciones
          puedePreview={esArchivoPdf(d.archivo_ref)}
          onVistaPrevia={() => abrirVistaPrevia(d)}
          onDescargar={() => descargarDocumento(d)}
          onEditar={() => abrirEditar(d)}
          onArchivar={d.estado === "activo" ? () => setDocumentoArchivar(d) : null}
          onEliminar={() => setDocumentoEliminar(d)}
        />
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Base de Conocimiento</h1>
          <p className="mt-1 text-text-muted">
            Documentos de referencia usados por los agentes de IA: banderas rojas, breed
            intelligence, farmacoterapia y más.
          </p>
        </div>
        <Button onClick={() => setModalCargaAbierto(true)}>+ Cargar documento</Button>
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto border-b border-black/5">
        {[
          { key: "todas", label: "Todos" },
          { key: "compartidos", label: "Compartidos" },
          ...agentesCatalogo.map((a) => ({ key: a.id, label: a.nombre })),
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold",
              tab === t.key ? "border-primary text-primary" : "border-transparent text-text-muted",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <Input
          placeholder="Buscar documento…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-text-muted">Cargando…</p>
        ) : (
          <Table
            columns={columns}
            data={documentosFiltrados}
            rowKey={(d) => d.id}
            emptyMessage="No hay documentos en esta vista."
          />
        )}
      </div>

      <Modal
        open={modalCargaAbierto}
        onClose={() => {
          setModalCargaAbierto(false);
          limpiarFormularioCarga();
        }}
        title="Cargar documento"
        description="Se guarda en el almacenamiento local de desarrollo (todavía sin integración con S3)."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setModalCargaAbierto(false);
                limpiarFormularioCarga();
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={subirDocumento}
              disabled={subiendo || !archivo || !nombreDoc.trim()}
            >
              {subiendo ? "Subiendo…" : "Cargar documento"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setArchivo(f);
            }}
            className={[
              "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center text-sm",
              arrastrando ? "border-accent bg-accent/5" : "border-black/15 bg-background",
            ].join(" ")}
          >
            <input
              type="file"
              className="hidden"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
            {archivo ? (
              <span className="font-semibold text-text-primary">{archivo.name}</span>
            ) : (
              <>
                <span className="font-semibold text-text-primary">
                  Arrastrá un archivo o hacé clic para elegirlo
                </span>
                <span className="text-text-muted">PDF, DOCX o TXT — máximo 20MB</span>
              </>
            )}
          </label>

          <Input
            label="Nombre"
            value={nombreDoc}
            onChange={(e) => setNombreDoc(e.target.value)}
          />
          <Input
            label="Descripción (opcional)"
            value={descripcionDoc}
            onChange={(e) => setDescripcionDoc(e.target.value)}
          />
          <Select
            label="Tipo"
            value={tipoDoc}
            onChange={(e) => setTipoDoc(e.target.value as TipoDocumento)}
            options={TIPO_OPTIONS}
          />
          <Select
            label="Agente"
            value={agenteDoc}
            onChange={(e) => setAgenteDoc(e.target.value)}
            options={[
              { value: "", label: "Compartido (todos los agentes)" },
              ...agentesCatalogo.map((a) => ({ value: a.id, label: a.nombre })),
            ]}
          />
          {errorCarga && <p className="text-sm text-error">{errorCarga}</p>}
        </div>
      </Modal>

      <Modal
        open={!!documentoArchivar}
        onClose={() => setDocumentoArchivar(null)}
        title="Archivar documento"
        description={
          documentoArchivar
            ? `¿Confirmas archivar "${documentoArchivar.nombre}"? Deja de estar disponible para los agentes, pero no se elimina.`
            : ""
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDocumentoArchivar(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmarArchivar} disabled={archivando}>
              {archivando ? "Archivando…" : "Archivar documento"}
            </Button>
          </>
        }
      />

      <Modal
        open={!!documentoEditar}
        onClose={cerrarEditar}
        title="Editar documento"
        description="Actualiza los metadatos o reemplaza el archivo. La versión actual queda sobrescrita."
        footer={
          <>
            <Button variant="secondary" onClick={cerrarEditar}>
              Cancelar
            </Button>
            <Button
              onClick={guardarEdicion}
              disabled={guardandoEdit || !nombreEdit.trim()}
            >
              {guardandoEdit ? "Guardando…" : "Guardar cambios"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Nombre" value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} />
          <Input
            label="Descripción (opcional)"
            value={descripcionEdit}
            onChange={(e) => setDescripcionEdit(e.target.value)}
          />
          <Select
            label="Tipo"
            value={tipoEdit}
            onChange={(e) => setTipoEdit(e.target.value as TipoDocumento)}
            options={TIPO_OPTIONS}
          />
          <Select
            label="Alcance"
            value={agenteEdit}
            onChange={(e) => setAgenteEdit(e.target.value)}
            options={[
              { value: "", label: "Compartido (todos los agentes)" },
              ...agentesCatalogo.map((a) => ({ value: a.id, label: a.nombre })),
            ]}
          />
          <Input label="Versión" value={versionEdit} onChange={(e) => setVersionEdit(e.target.value)} />

          <label className="flex cursor-pointer flex-col gap-1.5">
            <span className="text-sm font-semibold text-text-primary">
              Reemplazar archivo (opcional)
            </span>
            <input
              type="file"
              className="text-sm text-text-muted"
              onChange={(e) => setArchivoEdit(e.target.files?.[0] ?? null)}
            />
            {archivoEdit && (
              <span className="text-xs text-text-muted">Nuevo archivo: {archivoEdit.name}</span>
            )}
          </label>

          {errorEdit && <p className="text-sm text-error">{errorEdit}</p>}
        </div>
      </Modal>

      <Modal
        open={!!documentoEliminar}
        onClose={() => setDocumentoEliminar(null)}
        title="Eliminar documento permanentemente"
        description={
          documentoEliminar
            ? `Esta acción no se puede deshacer. "${documentoEliminar.nombre}" y su archivo se eliminan por completo, a diferencia de archivar.`
            : ""
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDocumentoEliminar(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmarEliminar} disabled={eliminando}>
              {eliminando ? "Eliminando…" : "Eliminar definitivamente"}
            </Button>
          </>
        }
      />

      {documentoPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={cerrarVistaPrevia}
        >
          <div
            className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-primary">{documentoPreview.nombre}</h2>
                <Badge variant="neutral">v{documentoPreview.version}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => descargarDocumento(documentoPreview)}>
                  Descargar
                </Button>
                <button
                  onClick={cerrarVistaPrevia}
                  aria-label="Cerrar"
                  className="rounded-lg px-2 py-1 text-lg text-text-muted hover:bg-black/5"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 bg-background">
              {cargandoPreview && (
                <div className="flex h-full items-center justify-center text-text-muted">
                  Cargando vista previa…
                </div>
              )}
              {errorPreview && (
                <div className="flex h-full items-center justify-center text-error">{errorPreview}</div>
              )}
              {previewUrl && !cargandoPreview && !errorPreview && (
                <iframe src={previewUrl} title={documentoPreview.nombre} className="h-full w-full" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
