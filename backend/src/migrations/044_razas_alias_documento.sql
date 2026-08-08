-- =====================================================================
-- VetPlatform — Migración 044
-- Selección de raza en predisposiciones, Paso 2 del ajuste pedido por el
-- usuario tras el hallazgo de 57,8% de coincidencia: mapeo explícito
-- raza↔sección del documento para las 23 razas que solo difieren en el
-- nombre entre el catálogo (lo que elige el veterinario) y el documento
-- (con el que se escribió su contenido) — mismo patrón que
-- farmacos_equivalencias (tabla dedicada, no una columna en razas: el
-- alias es propiedad de la relación raza↔documento, no de la raza).
-- =====================================================================

CREATE TABLE razas_alias_documento (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raza_id        uuid NOT NULL REFERENCES razas(id) ON DELETE CASCADE,
    documento_id   uuid NOT NULL REFERENCES documentos_conocimiento(id) ON DELETE CASCADE,
    titulo_seccion text NOT NULL,
    nota           text,
    creado_en      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (raza_id, documento_id)
);

-- Las 23 filas de alias (Lista 1) NO se insertan acá: dependen de un
-- documento en documentos_conocimiento que esta migración no crea (ese
-- documento tiene contenido real de varias decenas de miles de caracteres,
-- no algo para hardcodear en una migración de esquema). Insertarlas acá
-- con un SELECT id FROM documentos_conocimiento WHERE nombre = '...' fallaba
-- en cualquier base sin ese documento ya sembrado por fuera de las
-- migraciones — exactamente el caso de una base nueva — con
-- "documento_id" NULL violando el NOT NULL de arriba.
--
-- El documento y sus 23 alias ahora se siembran juntos, con IDs fijos
-- conocidos de antemano, en backend/src/seed/seedPlataforma.ts — ver
-- backend/src/seed/plataforma/documentos/documentos.json y
-- backend/src/seed/plataforma/razas_alias_documento.json. Esta migración
-- solo deja creada la tabla.
