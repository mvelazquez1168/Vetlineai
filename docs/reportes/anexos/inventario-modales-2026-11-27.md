# Inventario de modales del sistema

Generado el 2026-11-27, con el barrido de modales. El `tipo` decide si el clic afuera cierra:
**formulario** no cierra (y con cambios sin guardar, Esc y la X preguntan), **consulta** sí
(guía rectora §4.7). El tipo por omisión es *formulario*, así que un modal que no lo declara
está en el lado seguro.

| Archivo | Título | Tipo | Pregunta al descartar |
|---|---|---|---|
| `components/ModalCorregirCorreo.tsx` | Corregir mi correo | **formulario** | — |
| `components/ModalCorregirCorreo.tsx` | Correo actualizado> | **formulario** | — |
| `components/PaletaComandos.tsx` | Atajos de teclado | **consulta** | — |
| `components/PaletaComandos.tsx` | Paleta de comandos | **consulta** | — |
| `components/caso/CerrarCasoModal.tsx` | — | **formulario** | sí |
| `components/caso/CronologiaModal.tsx` | — | **consulta** | — |
| `components/caso/FichaPropietarioModal.tsx` | — | **formulario** | sí |
| `components/caso/ReabrirCasoModal.tsx` | — | **formulario** | sí |
| `components/caso/RegistroAtencionModal.tsx` | — | **formulario** | sí |
| `components/caso/RegistroAtencionModal.tsx` | — | **formulario** | — |
| `components/caso/ResolverCitaModal.tsx` | — | **formulario** | sí |
| `components/caso/VincularAtencionModal.tsx` | — | **formulario** | sí |
| `components/expediente/AccionesClinicas.tsx` | Receta | **formulario** | — |
| `components/expediente/AccionesClinicas.tsx` | esVacuna ? Aplicar una vacuna : Registrar una desparasitación | **formulario** | — |
| `components/expediente/AccionesClinicas.tsx` | esVacuna ? Registrar una vacuna histórica : Registrar una desparasitac | **formulario** | — |
| `components/expediente/AtencionActual.tsx` | Agregar un diagnóstico | **formulario** | — |
| `components/expediente/AtencionActual.tsx` | Agregar un producto | **formulario** | — |
| `components/expediente/AtencionActual.tsx` | Agregar un servicio | **formulario** | — |
| `components/expediente/AtencionActual.tsx` | Cerrar la atención | **formulario** | — |
| `components/expediente/ModalLaboratorio.tsx` | Registrar laboratorio | **formulario** | — |
| `components/expediente/PestanasExpediente.tsx` | Firmar un consentimiento | **formulario** | — |
| `components/expediente/PestanasExpediente.tsx` | Registrar grooming | **formulario** | — |
| `components/expediente/PestanasExpediente.tsx` | `Resultado de $estudio.tipo_estudio` | **formulario** | — |
| `components/metricas/ConsumoDeProducto.tsx` | `Lote $numero` | **formulario** | — |
| `components/paciente/DarDeBajaPacienteModal.tsx` | `Dar de baja a $paciente.nombre` | **formulario** | — |
| `components/paciente/EditarPacienteModal.tsx` | `Editar ficha de $paciente.nombre` | **formulario** | sí |
| `components/paciente/ModalNuevoPaciente.tsx` | Nuevo paciente | **formulario** | sí |
| `components/propietario/ModalNuevoPropietario.tsx` | Nuevo cliente | **formulario** | sí |
| `components/ui/Modal.tsx` | title | **formulario** | sí |
| `pages/admin/AdministracionCompleta.tsx` | Agregar un turno | **formulario** | — |
| `pages/admin/AdministracionCompleta.tsx` | Calcular el período | **formulario** | — |
| `pages/admin/AdministracionCompleta.tsx` | Pedir una ausencia | **formulario** | — |
| `pages/admin/AdministracionCompleta.tsx` | String(viendo?.titulo ?? ) | **formulario** | — |
| `pages/admin/AdministracionCompleta.tsx` | Un procedimiento de la clínica | **formulario** | — |
| `pages/admin/AdministracionCompleta.tsx` | Una regla de comisión | **formulario** | — |
| `pages/admin/AdministracionCompleta.tsx` | catalogos.find((c) => c.clave === abierto)?.nombre ??  | **formulario** | — |
| `pages/admin/AdministracionCompleta.tsx` | detalle ? `Comisiones de $detalle.liquidacion.persona` :  | **consulta** | — |
| `pages/admin/AdministracionCompleta.tsx` | editando?.nombre ??  | **formulario** | — |
| `pages/admin/Agentes.tsx` | Agregar agente | **formulario** | — |
| `pages/admin/Agentes.tsx` | `Desactivar agente — $agenteParaDesactivar?.nombre ?? ` | **formulario** | — |
| `pages/admin/CambiarPlan.tsx` |  | **formulario** | — |
| `pages/admin/CambiarPlan.tsx` | Cancelar tu suscripción | **formulario** | — |
| `pages/admin/Casos.tsx` | casoAReasignar ? `Reasignar $casoAReasignar.paciente_nombre a otro méd | **formulario** | — |
| `pages/admin/ConfiguracionAgenda.tsx` | Un feriado o un bloqueo | **formulario** | — |
| `pages/admin/ConfiguracionAgenda.tsx` | tipoEnEdicion?.id ? Editar el tipo de cita : Un tipo de cita nuevo | **formulario** | — |
| `pages/admin/Medicos.tsx` | Gestionar acceso a agentes | **formulario** | — |
| `pages/admin/Medicos.tsx` | Invitar a alguien del equipo | **formulario** | — |
| `pages/admin/MedioDePago.tsx` | metodo ? Reemplazar tarjeta : Agregar tarjeta | **formulario** | — |
| `pages/admin/Personas.tsx` | Desactivar a esta persona | **formulario** | — |
| `pages/admin/Personas.tsx` | editando ? `Roles de $editando.nombre` :  | **formulario** | — |
| `pages/admin/Politicas.tsx` | Un tope distinto para un rol | **formulario** | — |
| `pages/admin/Politicas.tsx` | historial ? `Historial de «$historial.nombre»` :  | **consulta** | — |
| `pages/admin/RecargarCredito.tsx` |  | **formulario** | — |
| `pages/agenda/NuevaCitaModal.tsx` | — | **formulario** | sí |
| `pages/dev/Muestrario.tsx` | `Modal ancho=$modalAbierto ?? ` | **formulario** | — |
| `pages/facturacion/ComprobanteDetalle.tsx` | modalNota === credito ? Nota de crédito : Nota de débito | **formulario** | — |
| `pages/facturacion/ComprobantesRecibidos.tsx` | Mensaje receptor | **formulario** | — |
| `pages/facturacion/ComprobantesRecibidos.tsx` | Registrar como gasto | **formulario** | — |
| `pages/facturacion/ComprobantesRecibidos.tsx` | Registrar la compra en inventario | **formulario** | — |
| `pages/facturacion/PerfilesFacturacion.tsx` | `Ligar $ligando?.nombre ??  a un cliente` | **formulario** | — |
| `pages/facturacion/PerfilesFacturacion.tsx` | editando ? Editar el perfil : Nuevo perfil de facturación | **formulario** | — |
| `pages/finanzas/Finanzas.tsx` | Registrar un depósito | **formulario** | — |
| `pages/finanzas/Finanzas.tsx` | Registrar un gasto | **formulario** | sí |
| `pages/finanzas/Finanzas.tsx` | pagando ? `Pagar a $pagando.nombre` :  | **formulario** | — |
| `pages/finanzas/Finanzas.tsx` | recordando ? `Recordarle el saldo a $recordando.nombre` :  | **formulario** | — |
| `pages/inventario/Compras.tsx` | ordenAbierta ? `Recibir la orden #$ordenAbierta.orden.numero` :  | **formulario** | — |
| `pages/inventario/ListasPrecio.tsx` | Actualizar precios por porcentaje | **formulario** | — |
| `pages/inventario/ListasPrecio.tsx` | Nueva lista de precio | **formulario** | — |
| `pages/inventario/Servicios.tsx` | Nuevo servicio | **formulario** | — |
| `pages/inventario/Servicios.tsx` | abierto ? `Receta de insumos — $abierto.servicio.nombre` :  | **formulario** | — |
| `pages/platform-admin/Agentes.tsx` | Editar agente | **formulario** | — |
| `pages/platform-admin/Agentes.tsx` | Nuevo agente | **formulario** | — |
| `pages/platform-admin/Agentes.tsx` | `Discontinuar agente — $agenteDiscontinuar?.especialidad || agenteDisc | **formulario** | — |
| `pages/platform-admin/Agentes.tsx` | `Poner en mantenimiento — $agenteMantenimiento?.nombre ?? ` | **formulario** | — |
| `pages/platform-admin/BaseConocimiento.tsx` | Archivar documento | **formulario** | — |
| `pages/platform-admin/BaseConocimiento.tsx` | Cargar documento | **formulario** | — |
| `pages/platform-admin/BaseConocimiento.tsx` | Editar documento | **formulario** | — |
| `pages/platform-admin/BaseConocimiento.tsx` | Eliminar documento permanentemente | **formulario** | — |
| `pages/platform-admin/BaseConocimiento.tsx` | documentoPreview.nombre | **consulta** | — |
| `pages/platform-admin/Clinicas.tsx` | Nueva clínica | **formulario** | — |
| `pages/platform-admin/DetalleClinicaConsumo.tsx` | Ajuste manual de saldo | **formulario** | — |
| `pages/platform-admin/DetalleClinicaConsumo.tsx` | `Bloquear clínica — $detalle.nombre` | **formulario** | — |
| `pages/platform-admin/DetalleClinicaConsumo.tsx` | `Desbloquear clínica — $detalle.nombre` | **formulario** | — |
| `pages/platform-admin/DetalleClinicaConsumo.tsx` | `Reactivar clínica — $detalle.nombre` | **formulario** | — |
| `pages/platform-admin/DetalleClinicaConsumo.tsx` | `Suspender clínica — $detalle.nombre` | **formulario** | — |
| `pages/platform-admin/DetallePais.tsx` | Nuevo impuesto vigente | **formulario** | — |
| `pages/platform-admin/DetallePais.tsx` | Nuevo tipo de identificación | **formulario** | — |
| `pages/platform-admin/DetallePais.tsx` | `Inactivar $detalle.pais.nombre` | **formulario** | — |
| `pages/platform-admin/Facturacion.tsx` | Facturar manualmente | **formulario** | — |
| `pages/platform-admin/Legal.tsx` | ¿Publicar nueva versión? | **formulario** | — |
| `pages/platform-admin/Tarifas.tsx` | modalTarifa ? `Nueva tarifa — $modalTarifa.modelo · $TIPO_TOKEN_LABEL[ | **formulario** | — |
| `pages/ventas/CajaDelDia.tsx` | Abrir caja | **formulario** | — |
| `pages/ventas/CajaDelDia.tsx` | Cerrar con arqueo | **formulario** | — |
| `pages/ventas/CajaDelDia.tsx` | Movimiento de efectivo | **formulario** | — |
| `pages/ventas/Encargos.tsx` |  | **formulario** | — |
| `pages/ventas/Encargos.tsx` | Nuevo encargo | **formulario** | — |
| `pages/ventas/PresupuestoDetalle.tsx` | Este presupuesto está vencido | **formulario** | — |
| `pages/ventas/PresupuestoDetalle.tsx` | Qué contestó el cliente | **formulario** | — |
| `pages/workspace/CasoWorkspace.tsx` | Archivos sin enviar | **formulario** | — |
| `pages/workspace/CasoWorkspace.tsx` | Informes anteriores | **formulario** | — |
| `pages/workspace/CasoWorkspace.tsx` | Nuevo caso | **formulario** | sí |
| `pages/workspace/CasoWorkspace.tsx` | ¿Para quién es este informe? | **formulario** | — |

**Total: 102 modales, 6 de consulta.**
