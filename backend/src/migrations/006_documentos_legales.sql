-- =====================================================================
-- VetPlatform — Migración 006
-- Documentos Legales (Términos y Condiciones, Política de Privacidad):
-- configurables por el equipo de plataforma, de solo consulta para
-- médicos y admins de clínica. Sin registro de aceptación por usuario —
-- decisión explícita, no es un gate de ninguna acción del sistema.
-- =====================================================================

CREATE TABLE documentos_legales (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo                VARCHAR NOT NULL
                            CHECK (tipo IN ('terminos_condiciones', 'politica_privacidad')),
    contenido           TEXT NOT NULL,
    version             VARCHAR NOT NULL DEFAULT '1.0',
    fecha_publicacion   TIMESTAMPTZ NOT NULL DEFAULT now(),
    activo              BOOLEAN NOT NULL DEFAULT true,
    publicado_por       UUID REFERENCES staff_plataforma(id)
);
-- Sin RLS: no tiene tenant_id, es contenido global de la plataforma (igual
-- que agentes, paises, documentos_conocimiento).

CREATE INDEX idx_documentos_legales_tipo_activo ON documentos_legales(tipo, activo);

-- Fila inicial activa de cada tipo, con contenido placeholder claramente
-- marcado como texto de ejemplo a reemplazar por el legal real.
INSERT INTO documentos_legales (tipo, contenido, version, publicado_por) VALUES
  (
    'terminos_condiciones',
    E'[CONTENIDO DE EJEMPLO — reemplazar por el texto legal real antes de producción]\n\n' ||
    E'Al utilizar VetPlatform, la clínica y sus profesionales aceptan estos Términos y ' ||
    E'Condiciones de uso. La plataforma provee agentes de inteligencia artificial como ' ||
    E'herramienta de apoyo al diagnóstico veterinario; en ningún caso sustituye el criterio ' ||
    E'profesional del médico veterinario a cargo, quien conserva la responsabilidad final ' ||
    E'sobre cada caso clínico.\n\n' ||
    E'El servicio se presta bajo un modelo de suscripción mensual. El uso indebido de la ' ||
    E'plataforma, incluyendo el acceso no autorizado a datos de otras clínicas, puede ' ||
    E'resultar en la suspensión de la cuenta.',
    '1.0',
    (SELECT id FROM staff_plataforma WHERE rol = 'super_admin' LIMIT 1)
  ),
  (
    'politica_privacidad',
    E'[CONTENIDO DE EJEMPLO — reemplazar por el texto legal real antes de producción]\n\n' ||
    E'VetPlatform trata los datos clínicos de pacientes y propietarios cargados por cada ' ||
    E'clínica con estrictos estándares de confidencialidad. La información de una clínica ' ||
    E'nunca es accesible por otras clínicas de la plataforma.\n\n' ||
    E'Los datos se utilizan exclusivamente para prestar el servicio contratado (asistencia ' ||
    E'diagnóstica, gestión de casos, facturación) y no se comparten con terceros salvo ' ||
    E'requerimiento legal.',
    '1.0',
    (SELECT id FROM staff_plataforma WHERE rol = 'super_admin' LIMIT 1)
  );
