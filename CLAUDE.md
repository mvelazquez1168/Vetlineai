# Instrucciones del repositorio

Este repo contiene **Vetline Ai** (plataforma de asistencia clínica veterinaria con IA) y, en el
mismo backend y la misma base, **Vetline Clinic** (gestión de la clínica: expediente, agenda,
inventario, ventas y caja, facturación electrónica, campañas, dashboards y agente administrativo).

## Vetline Clinic — guía rectora

**Todo trabajo de Vetline Clinic se rige por `docs/prompts/vetline-clinic-00-guia-rectora.md`.**
Leela antes de empezar cualquier prompt de la serie `vetline-clinic-NN-*.md` y antes de tocar
código de los módulos de gestión. Fija la arquitectura no negociable (mismo repo/backend/base,
RLS forzada, `tenant_modulos`, transacciones cortas, reuso en vez de copia, reglas de dinero y
stock impuestas en la base), el modelo de dominio (el paciente como eje, la atención como bisagra,
línea de negocio en todo ingreso y salida), la experiencia de usuario, el orden de construcción y
cómo se trabaja.

Cuando un prompt puntual y la guía no coincidan, **gana el prompt puntual para ese alcance**, y la
diferencia se reporta para corregir la guía.

## Fuente de verdad del estado actual

`docs/relevamientos/modelo-compartido-gestion.md` — relevamiento verificado contra el código y
contra el esquema real de la base (entidades maestras, quién crea cada cosa, agenda, Keycloak,
multi-tenant, habilitación por tenant, Resend, despliegue, ficha del paciente, sistema de diseño y
riesgos de compartir la base). Consultalo antes de asumir qué existe.

Los cuatro `docs/inventario-*.md` están **desactualizados**: no los uses como fuente sin verificar
contra el código.

## Defectos conocidos

`DEFECTOS_ABIERTOS.md` — defectos encontrados y **no corregidos**, con su criterio de cierre.
Incluye la regla de admisión R1: un resultado negativo de un verificador no es un defecto hasta que
alguien leyó la fuente y confirmó la ausencia.
