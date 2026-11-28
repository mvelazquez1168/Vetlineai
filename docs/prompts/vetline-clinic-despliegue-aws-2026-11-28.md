# Vetline Clinic — Despliegue al ambiente de AWS (28 de noviembre)

> Prompt para Claude Code. Para ejecutar **después** de la consolidación en `integracion/2026-11-28` y con los dos bloqueantes corregidos (roles nuevos que terminan en "No autorizado" y "Failed to fetch" al cerrar la atención).

Mañana desplegamos Vetline Clinic al **ambiente de AWS existente** (app y auth). No tiene usuarios reales, así que funciona como ambiente de pruebas; no hace falta staging. Prepara:

1. **Guiones de despliegue.** `deploy/build-push.sh` construye las dos imágenes con el hash del commit, las sube e imprime la etiqueta. `deploy/deploy.sh`, en el servidor, actualiza la etiqueta (variable de entorno en la composición ya reconciliada), recrea los contenedores, corre `migrate:prod` y `seed:plataforma:prod`, y **verifica** que cada contenedor quedó corriendo la imagen pedida y que el chequeo de salud responde.
2. **Revisión de migraciones.** Lista de las migraciones pendientes desde la 082. Corre el script de auditoría de deriva del sembrado. Señala cualquier migración destructiva o lenta, y ensaya todas sobre una base local restaurada desde cero, para confirmar que corren en orden sin errores.
3. **Variables nuevas.** Las que necesitan los módulos de Clinic en producción (sin secretos, en `.env.prod.example`). Hacienda en sandbox, WhatsApp simulado. El correo puede quedar real, pero solo existen usuarios de prueba.
4. **Keycloak.** Los roles y la configuración que necesitan los roles nuevos de Clinic (según la corrección del bloqueante de invitaciones), aplicados por los flujos del producto o por migración, nunca a mano en la consola.
5. **Guía paso a paso** en `docs/deploy/despliegue-clinic.md`, con cada comando etiquetado: **PowerShell (local Windows)**, **AWS CLI** o **Servidor (SSH)**. Orden:
   1. snapshot manual del RDS;
   2. restauración de prueba de ese snapshot en una instancia temporal, para comprobar que el respaldo sirve, y luego borrarla;
   3. actualizaciones del sistema del servidor (hay unas 59 pendientes, 37 de seguridad) y reinicio;
   4. renovar el token del registro;
   5. construir y subir;
   6. desplegar;
   7. verificar.

   Incluye la verificación en el navegador módulo por módulo, cómo revisar el consumo de memoria (y cuándo conviene pasar de t3.medium a t3.large) y el **plan de reversión**: volver a la imagen anterior y restaurar el snapshot.

No despliegues nada tú mismo. Deja todo listo y documentado en la bitácora para que lo ejecutemos juntos.
