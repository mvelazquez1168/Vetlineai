-- ---------------------------------------------------------------------
-- 142 — SON CINCO PERMISOS CONFIGURABLES, NO SEIS (prompt 04, §1)
--
-- La migración 139 marcó `agenda.fuera_de_horario` como configurable
-- por clínica. El prompt nombra exactamente cinco: ver costos y
-- márgenes, aplicar descuentos, anular, ajustar inventario y exportar
-- datos. Lo encontró el verificador, que cuenta los configurables
-- contra esa lista.
--
-- Citar fuera de horario SIGUE SIENDO UN PERMISO —el prompt pide que
-- haga falta uno explícito y que quede registrado— pero es parte del
-- rol y no algo que cada clínica reparta: lo tienen el administrador y
-- nadie más. Si una clínica necesitara dárselo a recepción, eso es una
-- decisión de producto y se agrega a la lista a propósito, no por un
-- descuido de esta migración.
-- ---------------------------------------------------------------------
UPDATE permisos SET configurable = false WHERE codigo = 'agenda.fuera_de_horario';

-- Y si alguna clínica ya lo había configurado, esa fila deja de regir:
-- se borra, porque una fila que nadie lee es una explicación que falta.
DELETE FROM tenant_rol_permiso WHERE permiso = 'agenda.fuera_de_horario';
