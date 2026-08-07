import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatearFechaCorta } from "../lib/formatFecha";
import { DocumentoLegal, legalApi, TipoDocumentoLegal } from "../lib/legalApi";

const DOCUMENTOS: { tipo: TipoDocumentoLegal; label: string }[] = [
  { tipo: "terminos_condiciones", label: "Términos y Condiciones" },
  { tipo: "politica_privacidad", label: "Política de Privacidad" },
];

// Página pública de solo lectura — sin sesión, sin registro de aceptación.
// Accesible desde el pie del sidebar del workspace y del admin de clínica,
// o directamente por URL (ej. desde /registro o /login).
export function Legal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tipoInicial = searchParams.get("doc") === "politica_privacidad"
    ? "politica_privacidad"
    : "terminos_condiciones";

  const [tipo, setTipo] = useState<TipoDocumentoLegal>(tipoInicial);
  const [documento, setDocumento] = useState<DocumentoLegal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    legalApi
      .obtener(tipo)
      .then((data) => setDocumento(data.documento))
      .catch(() => setError("No pudimos cargar este documento."))
      .finally(() => setIsLoading(false));
  }, [tipo]);

  const cambiarTipo = (nuevoTipo: TipoDocumentoLegal) => {
    setTipo(nuevoTipo);
    setSearchParams({ doc: nuevoTipo });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between border-b border-black/5 bg-surface px-8 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <div className="h-3 w-3 rounded-full bg-white" />
          </div>
          <span className="font-bold text-primary">Vetline Ai</span>
        </div>
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          Volver al sistema
        </Link>
      </div>

      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="flex gap-2 border-b border-black/5">
          {DOCUMENTOS.map((d) => (
            <button
              key={d.tipo}
              onClick={() => cambiarTipo(d.tipo)}
              className={[
                "-mb-px border-b-2 px-4 py-2 text-sm font-semibold",
                tipo === d.tipo ? "border-primary text-primary" : "border-transparent text-text-muted",
              ].join(" ")}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {isLoading ? (
            <p className="text-text-muted">Cargando…</p>
          ) : error ? (
            <p className="text-error">{error}</p>
          ) : (
            documento && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-display text-3xl text-primary">
                    {DOCUMENTOS.find((d) => d.tipo === tipo)?.label}
                  </h1>
                  <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-bold uppercase text-success">
                    Versión {documento.version}
                  </span>
                </div>
                <p className="mt-2 text-sm text-text-muted">
                  Última actualización: {formatearFechaCorta(documento.fecha_publicacion, undefined)}
                </p>
                <div className="mt-6 whitespace-pre-wrap rounded-2xl border border-black/5 bg-surface p-8 text-sm leading-relaxed text-text-primary">
                  {documento.contenido}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
