-- Retira los catálogos de componentes enteros, ahora que cada uno está
-- partido en dos documentos por ámbito (ver migración 073).
--
-- Hace falta una migración y no alcanza con el sembrado: seedPlataforma
-- inserta con ON CONFLICT (id) DO NOTHING, o sea que AGREGA pero nunca
-- actualiza ni retira. Sin esto, una base ya sembrada terminaría con el
-- catálogo entero conviviendo con sus dos mitades — el mismo contenido
-- tres veces en el bloque cacheado, que es peor que no haber partido nada.
--
-- Se identifica por id, no por nombre: los ids son estables y vienen del
-- propio documentos.json, así que un renombre no rompe esta migración.
--
--   4cf4eda5-...  GCIS Clinical Components Catalog v2.0 (GCIS-ARCH-001)
--   13fddd2e-...  ICIS Clinical Components Catalog
--
-- 'archivado' y no DELETE: es el estado que el resto del sistema ya usa
-- para retirar un documento sin perderlo, las consultas de contexto
-- filtran por estado='activo', y deja el original disponible por si hay
-- que volver atrás.
--
-- Idempotente: correrla de nuevo no cambia nada (el WHERE ya no matchea),
-- y en una base nueva no matchea ninguna fila porque el sembrado nuevo ya
-- no trae los catálogos enteros.
UPDATE documentos_conocimiento
   SET estado = 'archivado'
 WHERE id IN (
         '4cf4eda5-7b78-446f-b747-822abee11d09',
         '13fddd2e-a1ce-46d6-81b5-a965aa0754bd'
       )
   AND estado = 'activo';
