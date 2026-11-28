import { Navigate, Route } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { Legal } from "./pages/Legal";
import { Login } from "./pages/Login";
import { Registro } from "./pages/Registro";
import { InvitacionMedico } from "./pages/InvitacionMedico";
import { VerificarCorreo } from "./pages/VerificarCorreo";
import { RestablecerContrasena } from "./pages/RestablecerContrasena";
import { EstablecerContrasenaNueva } from "./pages/EstablecerContrasenaNueva";
import { Unauthorized } from "./pages/Unauthorized";
import { ClinicaBloqueada } from "./pages/ClinicaBloqueada";
import { AppShell } from "./components/AppShell";
import { rutaDeEntrada } from "./lib/pantallaDeEntrada";
import { Inicio } from "./pages/Inicio";
import { Pacientes } from "./pages/pacientes/Pacientes";
import { FichaPaciente } from "./pages/pacientes/FichaPaciente";
import { ClinicEstado } from "./pages/clinic/ClinicEstado";
import { AprobacionesVentas } from "./pages/ventas/AprobacionesVentas";
import { CajaDelDia } from "./pages/ventas/CajaDelDia";
import { Cobro } from "./pages/ventas/Cobro";
import { Contingencia } from "./pages/ventas/Contingencia";
import { CuentaCorriente } from "./pages/ventas/CuentaCorriente";
import { Encargos } from "./pages/ventas/Encargos";
import { ReportesVentas } from "./pages/ventas/ReportesVentas";
import { Dashboards } from "./pages/reportes/Dashboards";
import { FirmarADistancia } from "./pages/FirmarADistancia";
import { ListaDeMetrica } from "./pages/reportes/ListaDeMetrica";
import { ConsumoDeProductoPagina } from "./pages/inventario/ConsumoDeProductoPagina";
import { ConfiguracionCaja } from "./pages/ventas/ConfiguracionCaja";
import { Presupuestos } from "./pages/ventas/Presupuestos";
import { PresupuestoDetalle } from "./pages/ventas/PresupuestoDetalle";
import { PresupuestoNuevo } from "./pages/ventas/PresupuestoNuevo";
import { SeccionesCaja } from "./pages/ventas/SeccionesCaja";
import { TiqueteTermico } from "./pages/ventas/TiqueteTermico";
import { AlertasInventario } from "./pages/inventario/AlertasInventario";
import { CatalogoProductos } from "./pages/inventario/CatalogoProductos";
import { KardexGeneral } from "./pages/inventario/KardexGeneral";
import { ListasPrecio } from "./pages/inventario/ListasPrecio";
import { Compras } from "./pages/inventario/Compras";
import { ConteoFisico } from "./pages/inventario/ConteoFisico";
import { MovimientosInventario } from "./pages/inventario/MovimientosInventario";
import { ProductoEditor } from "./pages/inventario/ProductoEditor";
import { ProductoFicha } from "./pages/inventario/ProductoFicha";
import { SeccionesInventario } from "./pages/inventario/SeccionesInventario";
import { SinClasificar } from "./pages/inventario/SinClasificar";
import { Servicios as ServiciosInventario } from "./pages/inventario/Servicios";
import { VentaMostrador } from "./pages/inventario/VentaMostrador";
import { ComprobanteDetalle } from "./pages/facturacion/ComprobanteDetalle";
import { ComprobantesLista } from "./pages/facturacion/ComprobantesLista";
import { ComprobantesRecibidos } from "./pages/facturacion/ComprobantesRecibidos";
import { PerfilesFacturacion } from "./pages/facturacion/PerfilesFacturacion";
import { ConfiguracionEmisor } from "./pages/facturacion/ConfiguracionEmisor";
import { EmitirComprobante } from "./pages/facturacion/EmitirComprobante";
import { SeccionesAgenda } from "./pages/agenda/SeccionesAgenda";
import { Analiticas as AgendaAnaliticas } from "./pages/agenda/Analiticas";
import { Calendario as AgendaCalendario } from "./pages/agenda/Calendario";
import { CentroComando as AgendaCentroComando } from "./pages/agenda/CentroComando";
import { ConfiguracionHorarios as AgendaConfiguracionHorarios } from "./pages/agenda/ConfiguracionHorarios";
import { ListaEspera as AgendaListaEspera } from "./pages/agenda/ListaEspera";
import { Notificaciones as AgendaNotificaciones } from "./pages/agenda/Notificaciones";
import { Agentes } from "./pages/admin/Agentes";
import { Casos } from "./pages/admin/Casos";
import { CasosSinActividad } from "./pages/admin/CasosSinActividad";
import { Propietarios } from "./pages/admin/Propietarios";
import { ReporteAtenciones } from "./pages/admin/ReporteAtenciones";
import { CasoDetalleAdmin } from "./pages/admin/CasoDetalleAdmin";
import { Clinica } from "./pages/admin/Clinica";
import { Finanzas } from "./pages/finanzas/Finanzas";
import { PersonasContainer } from "./pages/admin/Personas.container";
import { CalidadDeDatos } from "./pages/admin/CalidadDeDatos";
import { SalasYEquipos } from "./pages/admin/SalasYEquipos";
import { PlanYSuscripcion } from "./pages/admin/PlanYSuscripcion";
import { AdministracionCompleta } from "./pages/admin/AdministracionCompleta";
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
import { CasosSinActividad as WorkspaceCasosSinActividad } from "./pages/workspace/CasosSinActividad";
import { Muestrario } from "./pages/dev/Muestrario";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { ConPermiso } from "./routes/ConPermiso";

function IndexRedirect() {
  const { user, isLoading, modulos, pantallaInicio } = useAuth();

  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;

  // La entrada depende del rol, de los modulos habilitados y de lo que
  // el usuario haya elegido. La regla vive en un solo lugar
  // (`rutaDeEntrada`) porque el Login resuelve exactamente lo mismo.
  return (
    <Navigate
      to={rutaDeEntrada({
        rol: user.rol ?? "",
        esMedico: user.esMedico,
        esAdminClinica: user.esAdminClinica,
        modulos,
        pantallaElegida: pantallaInicio,
        pantallaDelRol: user.pantallaDelRol,
      })}
      replace
    />
  );
}

// ---------------------------------------------------------------------
// EL ÁRBOL DE RUTAS, como elementos y no como componente.
//
// Antes era `<Routes>` dentro de un `<BrowserRouter>`. Pasa a ser un
// fragmento de `<Route>` que `main.tsx` convierte con
// `createRoutesFromElements` en un ROUTER DE DATOS.
//
// POR QUÉ, y es la única razón: `useBlocker` —lo que impide salir de una
// pantalla con cambios sin guardar, regla 4.7 de la guía— SOLO existe en
// el router de datos. Con `<BrowserRouter>` no hay forma de interceptar
// una navegación interna, y la regla se quedaría en `beforeunload`, que
// solo cubre cerrar o recargar la pestaña: el caso más común —tocar otra
// opción del menú— quedaría afuera.
//
// El árbol es exactamente el mismo, elemento por elemento. No hay rutas
// condicionales acá a propósito: lo que depende de la sesión lo resuelve
// `ProtectedRoute` y `IndexRedirect` DENTRO de la ruta, que es lo que
// permite que el árbol sea estático.
// ---------------------------------------------------------------------

export const rutasDeLaApp = (
  <>
      <Route path="/" element={<IndexRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Registro />} />
      <Route path="/invitacion/:token" element={<InvitacionMedico />} />
      <Route path="/verificar-correo/:token" element={<VerificarCorreo />} />
      <Route path="/restablecer-contrasena" element={<RestablecerContrasena />} />
      <Route path="/restablecer-contrasena/:token" element={<EstablecerContrasenaNueva />} />
      <Route path="/legal" element={<Legal />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/bloqueada" element={<ClinicaBloqueada />} />

      {/* Muestrario del sistema de diseño — SOLO en desarrollo. La
          condición es en tiempo de compilación, así que en el build de
          producción la ruta no existe y el componente no entra al
          bundle (Vite lo elimina junto con la rama muerta). */}
      {import.meta.env.DEV && <Route path="/dev/muestrario" element={<Muestrario />} />}

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
        path="/workspace/casos-sin-actividad"
        element={
          <ProtectedRoute allowedRoles={["medico"]}>
            <WorkspaceCasosSinActividad />
          </ProtectedRoute>
        }
      />

      {/* INICIO: la primera opcion del menu y donde aterriza toda
          sesion de clinica. */}
      <Route
        path="/inicio"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Inicio />} />
      </Route>

      {/* ADMINISTRACIÓN QUE VE TODO EL PERSONAL (prompt 04).
          Con ocho roles, `admin_clinica` dejó de ser «todo el que no es
          médico»: la recepción es un rol propio y resuelve como `medico`
          para el enrutador. Estas cuatro pantallas son de lectura para
          cualquiera del equipo —qué puede cada rol, qué políticas rigen,
          cuándo abre la clínica, quién trabaja acá— y cada acción de
          escritura la gatea el backend con su permiso. Dejarlas detrás
          del guard de administrador haría que la recepción no pueda
          contestar «¿por qué no puedo hacer esto?». */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        {/* ADMINISTRACIÓN REORGANIZADA (punto 6 del 2026-11-27).
            Eran trece opciones de menú y varias eran la misma cosa
            vista desde lugares distintos. Ahora son siete, con pestañas
            adentro, y LAS URL VIEJAS REDIRIGEN a su pestaña: no se
            rompen los enlaces de la ayuda, ni los guardados, ni los
            caminos de clics del relevamiento del marco. */}
        <Route
          path="personas"
          element={
            <ConPermiso permiso="personas.administrar"><PersonasContainer /></ConPermiso>
          }
        />
        <Route path="roles" element={<Navigate to="/admin/personas?tab=roles" replace />} />
        <Route path="politicas" element={<Navigate to="/admin/clinica?tab=politicas" replace />} />
        <Route
          path="configuracion-agenda"
          element={<Navigate to="/admin/clinica?tab=agenda" replace />}
        />
        <Route
          path="calidad-datos"
          element={
            <ConPermiso permiso="cliente.ver"><CalidadDeDatos /></ConPermiso>
          }
        />
        <Route
          path="salas-y-equipos"
          element={
            <ConPermiso permiso="clinica.configurar"><SalasYEquipos /></ConPermiso>
          }
        />
        {/* Prompt 11: catálogos, turnos, comisiones, cumplimiento,
            auditoría y procedimientos. Cada pestaña con su permiso. */}
        <Route
          path="administracion"
          element={
            <ConPermiso permiso={["catalogos.editar", "cumplimiento.gestionar", "auditoria.ver", "personal.gestionar", "comisiones.ver_todas", "procedimientos.editar", "controlados.registrar"]}><AdministracionCompleta /></ConPermiso>
          }
        />
        <Route
          path="duplicados"
          element={<Navigate to="/admin/calidad-datos?tab=duplicados" replace />}
        />
      </Route>

      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/admin/personas" replace />} />
        <Route
          path="medicos"
          element={<Navigate to="/admin/personas?tab=invitaciones" replace />}
        />
        <Route
          path="casos"
          element={
            <ConPermiso permiso="agentes.administrar"><Casos /></ConPermiso>
          }
        />
        <Route
          path="casos-sin-actividad"
          element={
            <ConPermiso permiso="agentes.administrar"><CasosSinActividad /></ConPermiso>
          }
        />
        <Route
          path="propietarios"
          element={
            <ConPermiso permiso="cliente.ver"><Propietarios /></ConPermiso>
          }
        />
        <Route
          path="reporte-atenciones"
          element={
            <ConPermiso permiso="reportes.ver"><ReporteAtenciones /></ConPermiso>
          }
        />
        <Route
          path="agentes"
          element={
            <ConPermiso permiso="agentes.administrar"><Agentes /></ConPermiso>
          }
        />
        <Route
          path="plan"
          element={
            <ConPermiso permiso="clinica.configurar"><PlanYSuscripcion /></ConPermiso>
          }
        />
        <Route path="plan-consumo" element={<Navigate to="/admin/plan?tab=plan" replace />} />
        <Route
          path="plan-consumo/cambiar-plan"
          element={
            <ConPermiso permiso="clinica.configurar"><CambiarPlan /></ConPermiso>
          }
        />
        <Route
          path="plan-consumo/recargar"
          element={
            <ConPermiso permiso="clinica.configurar"><RecargarCredito /></ConPermiso>
          }
        />
        <Route
          path="plan-consumo/autorecarga"
          element={
            <ConPermiso permiso="clinica.configurar"><ConfigurarAutorecarga /></ConPermiso>
          }
        />
        <Route
          path="plan-consumo/exportar"
          element={
            <ConPermiso permiso="datos.exportar"><ExportacionPage /></ConPermiso>
          }
        />
        <Route
          path="clinica"
          element={
            <ConPermiso permiso="clinica.configurar"><Clinica /></ConPermiso>
          }
        />
        <Route
          path="notificaciones"
          element={<Navigate to="/admin/clinica?tab=notificaciones" replace />}
        />
        <Route
          path="facturacion"
          element={<Navigate to="/admin/plan?tab=facturacion" replace />}
        />
        <Route
          path="facturacion/medio-de-pago"
          element={
            <ConPermiso permiso="clinica.configurar"><MedioDePago /></ConPermiso>
          }
        />
      </Route>

      {/* FINANZAS (prompt 10a) — detrás del módulo `finanzas` y del
          permiso `finanzas.ver`, los dos del lado del backend. Acá se
          deja entrar a todo el personal de la clínica porque el permiso
          es lo que decide, no el rol: una clínica puede darle finanzas a
          quien está en caja. */}
      {/* REPORTES — prompt 12. Abierto a médico y a administrador: el
          backend decide qué ve cada uno (el médico, lo suyo; la
          comparativa y el dashboard de la clínica piden `reportes.ver`),
          así que gatear la ruta por rol dejaría al médico sin su propio
          dashboard. */}
      <Route
        path="/reportes"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboards />} />
        <Route path="lista/:clave" element={<ListaDeMetrica />} />
      </Route>

      <Route
        path="/finanzas"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Finanzas />} />
      </Route>

      {/* Agenda de Citas — accesible tanto a medico como a admin_clinica
          (el backend gatea ambos roles por igual en todos los endpoints
          del módulo). Las seis secciones siguen siendo rutas propias: se
          navegan con las pestañas de `SeccionesAgenda`, dentro del marco
          único. */}
      <Route
        path="/agenda"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route element={<SeccionesAgenda />}>
        <Route index element={<Navigate to="calendario" replace />} />
        <Route path="calendario" element={<AgendaCalendario />} />
        <Route path="centro-comando" element={<AgendaCentroComando />} />
        <Route path="lista-espera" element={<AgendaListaEspera />} />
        <Route path="horarios" element={<AgendaConfiguracionHorarios />} />
        <Route path="analiticas" element={<AgendaAnaliticas />} />
        <Route path="notificaciones" element={<AgendaNotificaciones />} />
        </Route>
      </Route>

      {/* Ficha del paciente y su listado — NÚCLEO, no un módulo de
          Vetline Clinic gateado: Vetline Ai también los necesita (el
          contexto que recibe el agente clínico sale de acá). Accesible a
          médico y admin_clinica, igual que /api/pacientes. */}
      <Route
        path="/pacientes"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Pacientes />} />
        <Route path=":id" element={<FichaPaciente />} />
      </Route>

      {/* Vetline Clinic — la sección de gestión. A diferencia de la ficha
          del paciente, esta SÍ está gateada por tenant_modulos: el
          backend responde 403 si la clínica no tiene el módulo, y el menú
          no muestra la entrada (ver useModulos). */}
      <Route
        path="/clinic"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<ClinicEstado />} />
      </Route>

      {/* Facturador electrónico de Costa Rica — módulo `facturacion` de
          Vetline Clinic. Mismo layout que /clinic y mismos dos roles: el
          backend gatea médico y admin_clinica por igual para consultar y
          emitir, y restringe a admin SOLO el emisor y las credenciales
          (ver facturacionCr.routes.ts). La entrada al menú solo aparece
          si el módulo está habilitado — ver useModulos. */}
      <Route
        path="/facturacion"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<ComprobantesLista />} />
        <Route path="emitir" element={<EmitirComprobante />} />
        <Route path="comprobantes/:id" element={<ComprobanteDetalle />} />
        <Route path="recibidos" element={<ComprobantesRecibidos />} />
        <Route path="emisor" element={<ConfiguracionEmisor />} />
        <Route path="perfiles" element={<PerfilesFacturacion />} />
      </Route>

      {/* Catálogo, inventario y compras — módulo `inventario` de Vetline
          Clinic. Mismo layout y mismos dos roles que el facturador: el
          backend gatea médico y admin_clinica por igual para consultar y
          mover, y restringe a admin la aprobación de ajustes, los
          parámetros y la importación (ver inventario.routes.ts). La
          entrada al menú solo aparece si el módulo está habilitado. */}
      <Route
        path="/inventario"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        {/* La ficha de un producto, su edicion y la venta de mostrador
            son pantallas de trabajo: llevan su enlace al padre dentro
            de la pagina, no la barra de secciones del modulo. */}
        <Route path="productos/nuevo" element={<ProductoEditor />} />
        <Route path="productos/:id" element={<ProductoFicha />} />
        <Route path="productos/:id/editar" element={<ProductoEditor />} />
        <Route path="venta-mostrador" element={<VentaMostrador />} />
        <Route element={<SeccionesInventario />}>
          <Route index element={<CatalogoProductos />} />
          <Route path="servicios" element={<ServiciosInventario />} />
          <Route path="precios" element={<ListasPrecio />} />
          <Route path="movimientos" element={<MovimientosInventario />} />
          <Route path="kardex" element={<KardexGeneral />} />
          <Route path="compras" element={<Compras />} />
          <Route path="conteos" element={<ConteoFisico />} />
          <Route path="alertas" element={<AlertasInventario />} />
          <Route path="sin-clasificar" element={<SinClasificar />} />
          <Route path="producto/:id/consumo" element={<ConsumoDeProductoPagina />} />
        </Route>
      </Route>

      {/* Caja, ventas y cobros — módulo `ventas` de Vetline Clinic.
          Mismos dos roles que los otros dos módulos: el backend gatea
          médico y admin_clinica para cobrar, y restringe a admin la
          aprobación, la configuración de cajas y el tipo de cambio
          (ver ventas.routes.ts, donde cada permiso tiene nombre propio
          para asignarlo al rol de caja cuando exista). */}
      <Route
        path="/ventas"
        element={
          <ProtectedRoute allowedRoles={["medico", "admin_clinica"]}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        {/* El cobro y el tiquete quedan FUERA de las pestañas: son
            pantallas de trabajo con un solo camino de salida. */}
        <Route path="cobro" element={<Cobro />} />
        <Route path="cobro/:id" element={<Cobro />} />
        <Route path="tiquete/:id" element={<TiqueteTermico />} />
        <Route element={<SeccionesCaja />}>
          <Route index element={<CajaDelDia />} />
          <Route path="caja/:id" element={<CajaDelDia />} />
          <Route path="cuenta-corriente" element={<CuentaCorriente />} />
          <Route path="encargos" element={<Encargos />} />
          <Route path="aprobaciones" element={<AprobacionesVentas />} />
          <Route path="contingencia" element={<Contingencia />} />
          <Route path="reportes" element={<ReportesVentas />} />
        <Route path="configuracion" element={<ConfiguracionCaja />} />
        <Route path="presupuestos" element={<Presupuestos />} />
        <Route path="presupuestos/nuevo" element={<PresupuestoNuevo />} />
        <Route path="presupuestos/:id" element={<PresupuestoDetalle />} />
        </Route>
      </Route>

      {/* Vista de detalle de caso de solo lectura — fuera del layout con
          padding del marco porque necesita el mismo diseño full-height
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

      {/* FIRMA A DISTANCIA — SIN SESIÓN. Deliberadamente fuera de
          `ProtectedRoute`: la autorización es el token del enlace, que
          vence y sirve una sola vez. Ver el encabezado de la página. */}
      <Route path="/firmar/:token" element={<FirmarADistancia />} />

      <Route path="*" element={<Navigate to="/" replace />} />
  </>
);
