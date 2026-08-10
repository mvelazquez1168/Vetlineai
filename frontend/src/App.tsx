import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { Legal } from "./pages/Legal";
import { Login } from "./pages/Login";
import { Registro } from "./pages/Registro";
import { InvitacionMedico } from "./pages/InvitacionMedico";
import { VerificarCorreo } from "./pages/VerificarCorreo";
import { Unauthorized } from "./pages/Unauthorized";
import { ClinicaBloqueada } from "./pages/ClinicaBloqueada";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AgendaLayout } from "./pages/agenda/AgendaLayout";
import { Analiticas as AgendaAnaliticas } from "./pages/agenda/Analiticas";
import { Calendario as AgendaCalendario } from "./pages/agenda/Calendario";
import { CentroComando as AgendaCentroComando } from "./pages/agenda/CentroComando";
import { ConfiguracionHorarios as AgendaConfiguracionHorarios } from "./pages/agenda/ConfiguracionHorarios";
import { ListaEspera as AgendaListaEspera } from "./pages/agenda/ListaEspera";
import { Notificaciones as AgendaNotificaciones } from "./pages/agenda/Notificaciones";
import { Agentes } from "./pages/admin/Agentes";
import { Casos } from "./pages/admin/Casos";
import { Propietarios } from "./pages/admin/Propietarios";
import { ReporteAtenciones } from "./pages/admin/ReporteAtenciones";
import { CasoDetalleAdmin } from "./pages/admin/CasoDetalleAdmin";
import { Clinica } from "./pages/admin/Clinica";
import { Notificaciones } from "./pages/admin/Notificaciones";
import { Facturacion } from "./pages/admin/Facturacion";
import { Medicos } from "./pages/admin/Medicos";
import { PlanConsumo } from "./pages/admin/PlanConsumo";
import { CambiarPlan } from "./pages/admin/CambiarPlan";
import { RecargarCredito } from "./pages/admin/RecargarCredito";
import { ConfigurarAutorecarga } from "./pages/admin/ConfigurarAutorecarga";
import { MedioDePago } from "./pages/admin/MedioDePago";
import { ExportacionPage } from "./pages/admin/Exportacion";
import { Agentes as PlatformAgentes } from "./pages/platform-admin/Agentes";
import { Auditoria } from "./pages/platform-admin/Auditoria";
import { BaseConocimiento } from "./pages/platform-admin/BaseConocimiento";
import { Clinicas } from "./pages/platform-admin/Clinicas";
import { Facturacion as PlatformFacturacion } from "./pages/platform-admin/Facturacion";
import { Dashboard as PlatformDashboard } from "./pages/platform-admin/Dashboard";
import { Legal as PlatformLegal } from "./pages/platform-admin/Legal";
import { PlatformAdminLayout } from "./pages/platform-admin/PlatformAdminLayout";
import { Tarifas as PlatformTarifas } from "./pages/platform-admin/Tarifas";
import { Parametros as PlatformParametros } from "./pages/platform-admin/Parametros";
import { RecargasProveedorIa } from "./pages/platform-admin/RecargasProveedorIa";
import { SaldoProveedorIa } from "./pages/platform-admin/SaldoProveedorIa";
import { DirectorioPaises } from "./pages/platform-admin/DirectorioPaises";
import { DetallePais } from "./pages/platform-admin/DetallePais";
import { ListaEsperaPaises } from "./pages/platform-admin/ListaEsperaPaises";
import { ConsumoClinicas } from "./pages/platform-admin/ConsumoClinicas";
import { DetalleClinicaConsumo } from "./pages/platform-admin/DetalleClinicaConsumo";
import { AgentSelector } from "./pages/workspace/AgentSelector";
import { CasoWorkspace } from "./pages/workspace/CasoWorkspace";
import { ProtectedRoute } from "./routes/ProtectedRoute";

function IndexRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;

  if (user.rol === "medico") return <Navigate to="/workspace" replace />;
  if (user.rol === "admin_clinica") return <Navigate to="/admin" replace />;
  return <Navigate to="/platform-admin" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<IndexRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Registro />} />
      <Route path="/invitacion/:token" element={<InvitacionMedico />} />
      <Route path="/verificar-correo/:token" element={<VerificarCorreo />} />
      <Route path="/legal" element={<Legal />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/bloqueada" element={<ClinicaBloqueada />} />

      <Route
        path="/workspace"
        element={
          <ProtectedRoute allowedRoles={["medico"]}>
            <AgentSelector />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/agentes/:agenteId"
        element={
          <ProtectedRoute allowedRoles={["medico"]}>
            <CasoWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/agentes/:agenteId/casos/:casoId"
        element={
          <ProtectedRoute allowedRoles={["medico"]}>
            <CasoWorkspace />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["admin_clinica"]}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="medicos" replace />} />
        <Route path="medicos" element={<Medicos />} />
        <Route path="casos" element={<Casos />} />
        <Route path="propietarios" element={<Propietarios />} />
        <Route path="reporte-atenciones" element={<ReporteAtenciones />} />
        <Route path="agentes" element={<Agentes />} />
        <Route path="plan-consumo" element={<PlanConsumo />} />
        <Route path="plan-consumo/cambiar-plan" element={<CambiarPlan />} />
        <Route path="plan-consumo/recargar" element={<RecargarCredito />} />
        <Route path="plan-consumo/autorecarga" element={<ConfigurarAutorecarga />} />
        <Route path="plan-consumo/exportar" element={<ExportacionPage />} />
        <Route path="clinica" element={<Clinica />} />
        <Route path="notificaciones" element={<Notificaciones />} />
        <Route path="facturacion" element={<Facturacion />} />
        <Route path="facturacion/medio-de-pago" element={<MedioDePago />} />
      </Route>

      {/* Agenda de Citas — layout propio, accesible tanto a medico como a
          admin_clinica (el backend gatea ambos roles por igual en todos
          los endpoints del módulo). */}
      <Route
        path="/agenda"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AgendaLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="calendario" replace />} />
        <Route path="calendario" element={<AgendaCalendario />} />
        <Route path="centro-comando" element={<AgendaCentroComando />} />
        <Route path="lista-espera" element={<AgendaListaEspera />} />
        <Route path="horarios" element={<AgendaConfiguracionHorarios />} />
        <Route path="analiticas" element={<AgendaAnaliticas />} />
        <Route path="notificaciones" element={<AgendaNotificaciones />} />
      </Route>

      {/* Vista de detalle de caso de solo lectura — fuera del layout con
          padding de AdminLayout porque necesita el mismo diseño full-height
          de 2 columnas que usa el workspace del médico. */}
      <Route
        path="/admin/casos/:casoId"
        element={
          <ProtectedRoute allowedRoles={["admin_clinica"]}>
            <CasoDetalleAdmin />
          </ProtectedRoute>
        }
      />

      <Route
        path="/platform-admin"
        element={
          <ProtectedRoute allowedRoles={["super_admin", "soporte_senior", "soporte"]}>
            <PlatformAdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<PlatformDashboard />} />
        <Route path="clinicas" element={<Clinicas />} />
        <Route path="agentes" element={<PlatformAgentes />} />
        <Route
          path="base-conocimiento"
          element={
            <ProtectedRoute allowedRoles={["super_admin", "soporte_senior"]}>
              <BaseConocimiento />
            </ProtectedRoute>
          }
        />
        <Route
          path="auditoria"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <Auditoria />
            </ProtectedRoute>
          }
        />
        <Route
          path="facturacion"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <PlatformFacturacion />
            </ProtectedRoute>
          }
        />
        <Route
          path="tarifas"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <PlatformTarifas />
            </ProtectedRoute>
          }
        />
        <Route
          path="parametros"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <PlatformParametros />
            </ProtectedRoute>
          }
        />
        <Route
          path="recargas-proveedor-ia"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <RecargasProveedorIa />
            </ProtectedRoute>
          }
        />
        <Route
          path="saldo-proveedor-ia"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <SaldoProveedorIa />
            </ProtectedRoute>
          }
        />
        <Route
          path="paises"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <DirectorioPaises />
            </ProtectedRoute>
          }
        />
        <Route
          path="paises/lista-espera"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <ListaEsperaPaises />
            </ProtectedRoute>
          }
        />
        <Route
          path="paises/:codigo"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <DetallePais />
            </ProtectedRoute>
          }
        />
        <Route
          path="consumo-clinicas"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <ConsumoClinicas />
            </ProtectedRoute>
          }
        />
        <Route
          path="clinicas/:tenantId"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <DetalleClinicaConsumo />
            </ProtectedRoute>
          }
        />
        <Route
          path="legal"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <PlatformLegal />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
