import { renderToStaticMarkup } from "react-dom/server";
import { DashboardGcisPanel } from "../components/caso/DashboardGcisPanel";
import { DashboardGcis } from "./workspaceApi";
import { API_ORIGIN } from "./api";
import { formatearFecha, ZONA_HORARIA_PLATAFORMA } from "./formatFecha";

interface ExportarDashboardHtmlParams {
  dashboard: DashboardGcis;
  pacienteNombre: string;
  tenantLogoUrl: string | null;
  zonaHoraria: string | null | undefined;
}

// Export 100% client-side (sin endpoint nuevo de backend, ver FASE D del
// prompt): reusa el mismo componente y la misma lógica de condicionales
// de la Fase B vía renderToStaticMarkup — nunca se reescribe qué card se
// muestra u oculta en un lugar aparte.
//
// tenantLogoUrl es el logo de la clínica, no del agente — mismo logo
// para GCIS/ICIS/cualquier agente futuro (AD-BRAND-01 en
// backend/src/routes/casos.routes.ts — decisión de producto, no reabrir).
export async function exportarDashboardHtml({
  dashboard,
  pacienteNombre,
  tenantLogoUrl,
  zonaHoraria,
}: ExportarDashboardHtmlParams): Promise<void> {
  const [logoBase64, cssActual] = await Promise.all([
    obtenerLogoBase64(tenantLogoUrl),
    Promise.resolve(extraerCssActual()),
  ]);

  const markup = renderToStaticMarkup(<DashboardGcisPanel dashboard={dashboard} modoExport />);

  const ahoraIso = new Date().toISOString();
  const opcionesFecha: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  const generadoEnFmt = formatearFecha(dashboard.meta.generado_en, zonaHoraria, opcionesFecha);
  const exportadoEnFmt = formatearFecha(ahoraIso, zonaHoraria, opcionesFecha);

  const html = construirDocumentoHtml({
    pacienteNombre,
    logoBase64,
    cssActual,
    markup,
    generadoEnFmt,
    exportadoEnFmt,
  });

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const nombreArchivo = `Dashboard_${sanitizarNombreArchivo(pacienteNombre)}_${nombreFechaArchivo(ahoraIso, zonaHoraria)}.html`;

  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function obtenerLogoBase64(tenantLogoUrl: string | null): Promise<string | null> {
  if (!tenantLogoUrl) return null;
  try {
    const url = tenantLogoUrl.startsWith("http") ? tenantLogoUrl : `${API_ORIGIN}${tenantLogoUrl}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error("No se pudo embeber el logo de la clínica en el export:", err);
    return null;
  }
}

// Junta el CSS ya compilado que la app tiene cargado (Tailwind + tokens de
// diseño de tailwind.config.js) para que el HTML exportado se vea igual
// sin depender de ningún build/CDN aparte. Las hojas cross-origin (Google
// Fonts) tiran SecurityError al leer cssRules — se omiten silenciosamente
// y el documento cae a system fonts, que es el fallback que la spec ya
// contempla explícitamente.
function extraerCssActual(): string {
  const bloques: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const reglas = sheet.cssRules;
      for (const regla of Array.from(reglas)) {
        bloques.push(regla.cssText);
      }
    } catch {
      continue;
    }
  }
  return bloques.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizarNombreArchivo(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return limpio || "paciente";
}

function nombreFechaArchivo(fechaIso: string, zonaHoraria: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria ?? ZONA_HORARIA_PLATAFORMA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(fechaIso));
}

function construirDocumentoHtml(params: {
  pacienteNombre: string;
  logoBase64: string | null;
  cssActual: string;
  markup: string;
  generadoEnFmt: string;
  exportadoEnFmt: string;
}): string {
  const { pacienteNombre, logoBase64, cssActual, markup, generadoEnFmt, exportadoEnFmt } = params;
  const nombreEscapado = escapeHtml(pacienteNombre);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Dashboard clínico — ${nombreEscapado}</title>
<style>
${cssActual}

body {
  max-width: 900px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}
.export-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.export-header img {
  height: 48px;
  width: auto;
}
.export-header h1 {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1b2a4a;
  margin: 0;
}
.export-header p {
  font-size: 0.75rem;
  color: #5a6b82;
  margin: 4px 0 0;
}
</style>
</head>
<body class="bg-background text-text-primary font-sans">
  <header class="export-header">
    ${logoBase64 ? `<img src="${logoBase64}" alt="Logo de la clínica" />` : ""}
    <div>
      <h1>Dashboard clínico — ${nombreEscapado}</h1>
      <p>Generado el ${generadoEnFmt} · Exportado el ${exportadoEnFmt}</p>
    </div>
  </header>
  ${markup}
</body>
</html>
`;
}
