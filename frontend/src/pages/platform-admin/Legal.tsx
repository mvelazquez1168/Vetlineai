import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { DocumentoLegal, legalApi, TipoDocumentoLegal } from "../../lib/legalApi";

const DOCUMENTOS: { tipo: TipoDocumentoLegal; label: string }[] = [
  { tipo: "terminos_condiciones", label: "Términos y Condiciones" },
  { tipo: "politica_privacidad", label: "Política de Privacidad" },
];

// Sugiere el próximo número de versión incrementando el último segmento
// (ej. "1.0" -> "1.1"). Es solo un valor inicial editable, no una regla dura.
function sugerirSiguienteVersion(actual: string): string {
  const partes = actual.split(".");
  const ultimo = Number(partes[partes.length - 1]);
  if (Number.isNaN(ultimo)) return actual;
  partes[partes.length - 1] = String(ultimo + 1);
  return partes.join(".");
}

function TarjetaDocumento({ tipo, label }: { tipo: TipoDocumentoLegal; label: string }) {
  const [documento, setDocumento] = useState<DocumentoLegal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editando, setEditando] = useState(false);
  const [contenido, setContenido] = useState("");
  const [version, setVersion] = useState("");
  const [modalConfirmar, setModalConfirmar] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setIsLoading(true);
    legalApi
      .obtener(tipo)
      .then((data) => setDocumento(data.documento))
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, [tipo]);

  const empezarEdicion = () => {
    if (!documento) return;
    setContenido(documento.contenido);
    setVersion(sugerirSiguienteVersion(documento.version));
    setEditando(true);
  };

  const confirmarPublicar = async () => {
    setPublicando(true);
    setError(null);
    try {
      await legalApi.publicar(tipo, { contenido, version });
      setModalConfirmar(false);
      setEditando(false);
      cargar();
    } catch (err: any) {
      setError(err?.message ?? "No pudimos publicar la nueva versión.");
    } finally {
      setPublicando(false);
    }
  };

  if (isLoading || !documento) {
    return (
      <div className="rounded-2xl border border-black/5 bg-surface p-6">
        <p className="text-text-muted">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-primary">{label}</h2>
        {!editando && (
          <Button variant="secondary" onClick={empezarEdicion}>
            Editar
          </Button>
        )}
      </div>

      {!editando ? (
        <>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-full bg-background px-3 py-1 text-xs font-bold uppercase text-text-muted">
              Versión {documento.version}
            </span>
            <span className="text-xs text-text-muted">
              Publicado el {formatearFechaCorta(documento.fecha_publicacion, undefined)}
            </span>
          </div>
          <p className="mt-4 line-clamp-3 text-sm text-text-muted">{documento.contenido}</p>
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <Input
            label="Versión"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-primary">Contenido</label>
            <textarea
              className="min-h-[240px] rounded-lg border border-black/10 bg-background px-4 py-3 text-sm leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditando(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => setModalConfirmar(true)}
              disabled={!contenido.trim() || !version.trim()}
            >
              Publicar nueva versión
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={modalConfirmar}
        onClose={() => setModalConfirmar(false)}
        title="¿Publicar nueva versión?"
        description={`${label} — Versión ${version}. Reemplazará la versión ${documento.version} como la vigente para todos los usuarios. Esta acción no se puede deshacer.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalConfirmar(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmarPublicar} disabled={publicando}>
              {publicando ? "Publicando…" : `Publicar v${version}`}
            </Button>
          </>
        }
      />
    </div>
  );
}

export function Legal() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Documentos Legales</h1>
      <p className="mt-1 text-text-muted">
        Términos y Condiciones y Política de Privacidad visibles para todos los usuarios de la
        plataforma.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {DOCUMENTOS.map((d) => (
          <TarjetaDocumento key={d.tipo} tipo={d.tipo} label={d.label} />
        ))}
      </div>
    </div>
  );
}
