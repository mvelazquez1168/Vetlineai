import cors from "cors";
import express from "express";
import path from "path";
import { config, validarFrontendUrlConfigurada } from "./config";
import { auditoria } from "./middleware/auditoria";
import { iniciarJobNotificaciones } from "./jobs/notificaciones.job";
import { iniciarJobCiclo } from "./jobs/ciclo.job";
import { iniciarJobCicloCobro } from "./jobs/cicloCobro.job";
import { iniciarJobTarjetaPorVencer } from "./jobs/tarjetaPorVencer.job";
import { iniciarJobAuditoriaRls } from "./jobs/auditoriaRls.job";
import { validarCredencialesPaisesHabilitados } from "./pagos/credencialesPasarela";
import { pool } from "./db";
import { authRouter } from "./routes/auth.routes";
import { adminRouter } from "./routes/admin.routes";
import { agendaRouter } from "./routes/agenda.routes";
import { archivosRouter } from "./routes/archivos.routes";
import { casosRouter } from "./routes/casos.routes";
import { citasRouter } from "./routes/citas.routes";
import { farmacosRouter } from "./routes/farmacos.routes";
import { horariosRouter } from "./routes/horarios.routes";
import { informesRouter } from "./routes/informes.routes";
import { listaEsperaRouter } from "./routes/listaEspera.routes";
import { legalRouter } from "./routes/legal.routes";
import { medicamentosRouter } from "./routes/medicamentos.routes";
import { notificacionesRouter } from "./routes/notificaciones.routes";
import { pacientesRouter } from "./routes/pacientes.routes";
import { pagosRouter } from "./routes/pagos.routes";
import { paisesRouter } from "./routes/paises.routes";
import { planesRouter } from "./routes/planes.routes";
import { platformRouter } from "./routes/platform.routes";
import { platformAdminRouter } from "./routes/platform-admin.routes";
import { platformTarifasRouter } from "./routes/platformTarifas.routes";
import { platformParametrosRouter } from "./routes/platformParametros.routes";
import { platformPaisesRouter } from "./routes/platformPaises.routes";
import { platformConsumoClinicasRouter } from "./routes/platformConsumoClinicas.routes";
import { platformCobrosRouter } from "./routes/platformCobros.routes";
import { propietariosRouter } from "./routes/propietarios.routes";
import { razasRouter } from "./routes/razas.routes";
import { recetasRouter } from "./routes/recetas.routes";
import { registroRouter } from "./routes/registro.routes";
import { invitacionesPublicasRouter } from "./routes/invitacionesPublicas.routes";
import { verificacionCorreoPublicaRouter } from "./routes/verificacionCorreoPublica.routes";
import { reportesRouter } from "./routes/reportes.routes";
import { salasRouter } from "./routes/salas.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import { workspaceRouter } from "./routes/workspace.routes";

const app = express();

app.use(cors({ origin: config.corsOrigin, credentials: true }));

// El webhook de Stripe va ANTES de express.json(): necesita el body crudo
// para verificar la firma (ver nota en webhooks.routes.ts). Cualquier ruta
// montada después de express.json() ya recibe el body parseado como
// objeto, y la verificación de firma de Stripe dejaría de funcionar.
app.use("/api/webhooks", webhooksRouter);

app.use(express.json());

// Global: audita automáticamente cualquier escritura autenticada exitosa,
// sin que cada endpoint tenga que llamarlo (ver middleware/auditoria.ts).
app.use(auditoria);

// Verifica también la base de datos, no solo que el proceso esté vivo: un
// orquestador que solo comprueba "el proceso responde" no detecta una base
// caída ni saca al contenedor de servicio en ese caso.
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    console.error("GET /api/health — base de datos no responde", err);
    res.status(503).json({ status: "error" });
  }
});

// SOLO los logos de clínica quedan públicos sin autenticación — son un
// activo de marca cosmético (mismo criterio que un avatar de organización
// en cualquier SaaS), no dato clínico. Todo lo demás (documentos_conocimiento,
// archivos de casos) se sirve exclusivamente vía endpoints autenticados que
// validan pertenencia al tenant — ver GET /api/archivos/:id y
// GET /api/platform-admin/documentos/:id/archivo. Nunca vuelvas a montar
// express.static sobre /uploads en general: eso reabre la fuga de datos
// clínicos entre tenants que este mismo commit cierra.
//
// Este mount solo tiene sentido con el proveedor de almacenamiento local
// (dev): con S3 (producción), almacenamientoPublico.url() ya devuelve la
// URL directa del bucket — nada pasa por acá, y el directorio uploads/
// tampoco existe en la imagen de producción (ver Dockerfile).
if (config.almacenamientoProveedor === "local") {
  app.use("/uploads/logos", express.static(path.join(__dirname, "../uploads/logos")));
}

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/platform", platformRouter);
app.use("/api/platform-admin", platformAdminRouter);
app.use("/api/platform-admin", platformTarifasRouter);
app.use("/api/platform-admin", platformParametrosRouter);
app.use("/api/platform-admin", platformPaisesRouter);
app.use("/api/platform-admin", platformConsumoClinicasRouter);
app.use("/api/platform-admin/cobros", platformCobrosRouter);
app.use("/api/workspace", workspaceRouter);
app.use("/api/casos", casosRouter);
app.use("/api/informes", informesRouter);
app.use("/api/propietarios", propietariosRouter);
app.use("/api/pacientes", pacientesRouter);
app.use("/api/medicamentos", medicamentosRouter);
app.use("/api/recetas", recetasRouter);
app.use("/api/razas", razasRouter);
app.use("/api/reportes", reportesRouter);
app.use("/api/paises", paisesRouter);
app.use("/api/farmacos-equivalencias", farmacosRouter);
app.use("/api/archivos", archivosRouter);
app.use("/api/registro-publico", registroRouter);
app.use("/api/invitaciones", invitacionesPublicasRouter);
app.use("/api/verificar-correo", verificacionCorreoPublicaRouter);
app.use("/api/legal", legalRouter);
app.use("/api/notificaciones", notificacionesRouter);
app.use("/api/planes", planesRouter);
app.use("/api/pagos", pagosRouter);

// Módulo de Agenda de Citas — 100% CRUD/SQL, sin Anthropic en ninguna
// parte. Sin clinica_id/sede (tenant_id ES la clínica en este esquema,
// ver nota de diseño en la migración 017).
app.use("/api/salas", salasRouter);
app.use("/api/horarios", horariosRouter);
app.use("/api/citas", citasRouter);
app.use("/api/lista-espera", listaEsperaRouter);
app.use("/api", agendaRouter);

const server = app.listen(config.port, () => {
  console.log(`VetPlatform backend escuchando en http://localhost:${config.port}`);
  iniciarJobNotificaciones();
  iniciarJobCiclo();
  iniciarJobCicloCobro();
  iniciarJobTarjetaPorVencer();
  iniciarJobAuditoriaRls();
  validarFrontendUrlConfigurada();
  validarCredencialesPaisesHabilitados(pool).catch((err) =>
    console.error("[pagos] No se pudo validar las credenciales de pasarela por país al arrancar", err)
  );
});

// Apagado ordenado: en un contenedor descartable, el orquestador manda
// SIGTERM antes de matar el proceso. server.close() deja de aceptar
// conexiones nuevas pero espera a que terminen las peticiones en curso
// antes de resolver — sin esto, un despliegue corta a mitad una petición
// real (ej. generación de un informe).
function apagarOrdenadamente(señal: string) {
  console.log(`${señal} recibida, cerrando conexiones en curso...`);
  server.close((err) => {
    if (err) {
      console.error("Error al cerrar el servidor", err);
      process.exit(1);
    }
    pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => apagarOrdenadamente("SIGTERM"));
process.on("SIGINT", () => apagarOrdenadamente("SIGINT"));
