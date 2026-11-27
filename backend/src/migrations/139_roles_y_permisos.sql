-- ---------------------------------------------------------------------
-- 139 — ROLES Y PERMISOS (prompt 04, sección 1)
--
-- Hoy los roles son dos columnas booleanas de `personas`: `es_medico` y
-- `es_admin_clinica`. Para que Medicavet use el sistema todos los días
-- hace falta que la recepcionista entre con lo suyo, y hoy tendría que
-- entrar como médica o como administradora.
--
-- LA DECISIÓN QUE GOBIERNA ESTA MIGRACIÓN: los dos booleanos **no se
-- borran, se derivan**.
--
-- Hay 100 chequeos directos en el backend (70 de `esMedico`, 30 de
-- `esAdminClinica`) y el menú entero del frontend colgando de ellos.
-- Reescribir los 100 en la misma entrega que introduce el modelo es la
-- forma de romper algo sin que nadie lo note. Así que:
--
--   * `persona_roles` pasa a ser la FUENTE;
--   * `es_medico` y `es_admin_clinica` se CALCULAN desde ahí en
--     `resolverPrincipal`, y siguen diciendo la verdad;
--   * los permisos nuevos se expresan con `exigirPermiso("caja.anular")`
--     y los chequeos viejos siguen funcionando.
--
-- Las columnas quedan, con su comentario diciendo que son derivadas, y
-- se borran el día que nadie las lea.
--
-- EL PERMISO SE RESUELVE SIEMPRE DESDE LA BASE, nunca desde el token.
-- Eso ya era así —los roles del token se leen y se descartan a
-- propósito— y esta migración no lo cambia: le da más que resolver.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- LOS ROLES SON DE LA PLATAFORMA, no de cada clínica.
--
-- Un rol es un conjunto de capacidades del producto: «recepción» hace lo
-- mismo en todas las clínicas. Lo que cada clínica configura son unos
-- pocos permisos sueltos (ver costos, aplicar descuentos, anular), y eso
-- va en `tenant_rol_permiso`.
--
-- Si los roles fueran por clínica, cada una tendría su propia idea de
-- qué es «caja» y el soporte sería imposible.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  codigo      VARCHAR(30) PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL,
  descripcion TEXT,
  /* La pantalla a la que entra quien tiene este rol, si no eligió otra.
     La regla del 01c: según rol y módulos, elegible por el usuario. */
  pantalla_inicio VARCHAR(80),
  /* Los roles clínicos no se configuran: escribir y firmar contenido
     clínico es del médico y punto (lo dice el prompt). */
  es_clinico  BOOLEAN NOT NULL DEFAULT false,
  orden       SMALLINT NOT NULL DEFAULT 100
);

INSERT INTO roles (codigo, nombre, descripcion, pantalla_inicio, es_clinico, orden)
SELECT * FROM (VALUES
  ('admin_clinica', 'Administrador',
   'Configura la clínica, sus personas y sus políticas. Autoriza lo que otros piden.',
   '/admin/clinica', false, 10),
  ('medico', 'Médico',
   'Atiende, escribe y firma el expediente, prescribe y pide estudios.',
   '/workspace', true, 20),
  ('recepcion', 'Recepción',
   'Agenda, check-in, clientes y pacientes (datos no clínicos), presupuestos y mensajes al cliente.',
   '/agenda', false, 30),
  ('caja', 'Caja',
   'Sesiones de caja, cobros, abonos, anticipos, emisión de comprobantes y cierre.',
   '/ventas', false, 40),
  ('farmacia', 'Farmacia',
   'Venta de mostrador, inventario, recepción de compras y toma física.',
   '/inventario', false, 50),
  ('estetica', 'Estética',
   'Grooming y sus hallazgos. Registra grooming y no contenido clínico.',
   '/pacientes', false, 60),
  ('asistente', 'Asistente técnico',
   'Signos y peso en el check-in, preparación del paciente. No firma ni escribe contenido clínico.',
   '/agenda', false, 70),
  ('contador', 'Contador',
   'Solo lectura de caja, comprobantes, cuentas y reportes. Sin datos clínicos.',
   '/facturacion', false, 80)
) AS v(codigo, nombre, descripcion, pantalla_inicio, es_clinico, orden)
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.codigo = v.codigo);

COMMENT ON TABLE roles IS
  'Los roles del producto. De la plataforma y no de cada clínica: «recepción» hace lo mismo en todas (prompt 04).';

-- ---------------------------------------------------------------------
-- LOS PERMISOS SON ACCIONES, con el nombre de lo que dejan hacer.
--
-- `modulo.accion`, en infinitivo, legible en un mensaje de error: el
-- texto que el usuario ve cuando le falta uno sale de `nombre`.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permisos (
  codigo      VARCHAR(50) PRIMARY KEY,
  nombre      VARCHAR(120) NOT NULL,
  modulo      VARCHAR(30) NOT NULL,
  /* Si la clínica puede activarlo o desactivarlo por rol. El prompt
     nombra cinco: ver costos y márgenes, aplicar descuentos, anular,
     ajustar inventario, exportar datos. El resto es del núcleo y no se
     configura. */
  configurable BOOLEAN NOT NULL DEFAULT false,
  orden       SMALLINT NOT NULL DEFAULT 100
);

INSERT INTO permisos (codigo, nombre, modulo, configurable, orden)
SELECT * FROM (VALUES
  -- Expediente y clínica. NINGUNO ES CONFIGURABLE: lo dice el prompt.
  ('expediente.ver',          'Ver el expediente clínico',            'expediente', false, 10),
  ('expediente.escribir',     'Escribir en el expediente',            'expediente', false, 11),
  ('expediente.firmar',       'Firmar y cerrar una atención',         'expediente', false, 12),
  ('expediente.signos',       'Anotar signos vitales y peso',         'expediente', false, 13),
  ('expediente.grooming',     'Registrar grooming y sus hallazgos',   'expediente', false, 14),
  ('receta.emitir',           'Emitir recetas',                       'expediente', false, 15),
  -- Clientes y pacientes.
  ('cliente.ver',             'Ver clientes y pacientes',             'clientes',   false, 20),
  ('cliente.editar',          'Crear y editar clientes y pacientes',  'clientes',   false, 21),
  ('cliente.unificar',        'Unificar fichas duplicadas',           'clientes',   false, 22),
  ('cliente.mensajes',        'Escribirle al cliente',                'clientes',   false, 23),
  -- Agenda.
  ('agenda.ver',              'Ver la agenda',                        'agenda',     false, 30),
  ('agenda.editar',           'Agendar, mover y cancelar citas',      'agenda',     false, 31),
  ('agenda.fuera_de_horario', 'Citar fuera de horario o en un bloqueo', 'agenda',   true,  32),
  -- Caja y ventas.
  ('caja.ver',                'Ver la caja y sus movimientos',        'caja',       false, 40),
  ('caja.cobrar',             'Cobrar y emitir comprobantes',         'caja',       false, 41),
  ('caja.abrir_cerrar',       'Abrir y cerrar sesiones de caja',      'caja',       false, 42),
  ('caja.anular',             'Anular cobros y comprobantes',         'caja',       true,  43),
  ('caja.aprobar',            'Aprobar lo que otros solicitan',       'caja',       false, 44),
  ('caja.descuento',          'Aplicar descuentos',                   'caja',       true,  45),
  ('presupuesto.editar',      'Armar y convertir presupuestos',       'caja',       false, 46),
  -- Inventario.
  ('inventario.ver',          'Ver el inventario',                    'inventario', false, 50),
  ('inventario.mover',        'Registrar entradas y salidas',         'inventario', false, 51),
  ('inventario.ajustar',      'Ajustar existencias y cerrar conteos', 'inventario', true,  52),
  ('inventario.comprar',      'Recibir compras y órdenes',            'inventario', false, 53),
  ('catalogo.editar',         'Editar el catálogo y los precios',     'inventario', false, 54),
  ('catalogo.ver_costos',     'Ver costos y márgenes',                'inventario', true,  55),
  -- Facturación electrónica.
  ('facturacion.ver',         'Ver comprobantes electrónicos',        'facturacion', false, 60),
  ('facturacion.emitir',      'Emitir y responder comprobantes',      'facturacion', false, 61),
  ('facturacion.configurar',  'Configurar el emisor y sus llaves',    'facturacion', false, 62),
  -- Administración.
  ('reportes.ver',            'Ver reportes',                         'admin',      false, 70),
  ('datos.exportar',          'Exportar datos de la clínica',         'admin',      true,  71),
  ('personas.administrar',    'Invitar, editar y desactivar personas', 'admin',     false, 72),
  ('clinica.configurar',      'Configurar la clínica y sus políticas', 'admin',     false, 73),
  ('agentes.administrar',     'Administrar los agentes de IA',        'admin',      false, 74)
) AS v(codigo, nombre, modulo, configurable, orden)
WHERE NOT EXISTS (SELECT 1 FROM permisos p WHERE p.codigo = v.codigo);

COMMENT ON TABLE permisos IS
  'Las acciones que un rol puede tener. `configurable` marca las cinco que cada clínica puede activar o desactivar por rol (prompt 04).';

-- ---------------------------------------------------------------------
-- QUÉ PERMISOS TRAE CADA ROL — la matriz del núcleo.
--
-- Es de solo lectura en la pantalla: lo que la clínica puede cambiar son
-- los permisos marcados `configurable`, y eso va en la tabla de abajo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rol_permisos (
  rol     VARCHAR(30) NOT NULL REFERENCES roles(codigo) ON DELETE CASCADE,
  permiso VARCHAR(50) NOT NULL REFERENCES permisos(codigo) ON DELETE CASCADE,
  PRIMARY KEY (rol, permiso)
);

INSERT INTO rol_permisos (rol, permiso)
SELECT * FROM (VALUES
  -- ADMINISTRADOR: todo lo que no es clínico. NO escribe ni firma el
  -- expediente: ser administrador no te hace médico. El caso de
  -- Medicavet —médica y administradora— se resuelve con los dos roles,
  -- que es exactamente lo que el prompt pide.
  ('admin_clinica','expediente.ver'), ('admin_clinica','cliente.ver'),
  ('admin_clinica','cliente.editar'), ('admin_clinica','cliente.unificar'),
  ('admin_clinica','cliente.mensajes'),
  ('admin_clinica','agenda.ver'), ('admin_clinica','agenda.editar'),
  ('admin_clinica','agenda.fuera_de_horario'),
  ('admin_clinica','caja.ver'), ('admin_clinica','caja.cobrar'),
  ('admin_clinica','caja.abrir_cerrar'), ('admin_clinica','caja.anular'),
  ('admin_clinica','caja.aprobar'), ('admin_clinica','caja.descuento'),
  ('admin_clinica','presupuesto.editar'),
  ('admin_clinica','inventario.ver'), ('admin_clinica','inventario.mover'),
  ('admin_clinica','inventario.ajustar'), ('admin_clinica','inventario.comprar'),
  ('admin_clinica','catalogo.editar'), ('admin_clinica','catalogo.ver_costos'),
  ('admin_clinica','facturacion.ver'), ('admin_clinica','facturacion.emitir'),
  ('admin_clinica','facturacion.configurar'),
  ('admin_clinica','reportes.ver'), ('admin_clinica','datos.exportar'),
  ('admin_clinica','personas.administrar'), ('admin_clinica','clinica.configurar'),
  ('admin_clinica','agentes.administrar'),

  -- MÉDICO: lo clínico, más lo que necesita para atender.
  ('medico','expediente.ver'), ('medico','expediente.escribir'),
  ('medico','expediente.firmar'), ('medico','expediente.signos'),
  ('medico','receta.emitir'),
  ('medico','cliente.ver'), ('medico','cliente.editar'), ('medico','cliente.mensajes'),
  ('medico','agenda.ver'), ('medico','agenda.editar'),
  ('medico','caja.ver'), ('medico','caja.cobrar'), ('medico','presupuesto.editar'),
  ('medico','caja.descuento'),
  ('medico','inventario.ver'), ('medico','inventario.mover'),
  ('medico','facturacion.ver'), ('medico','reportes.ver'),

  -- RECEPCIÓN: agenda, check-in, clientes y presupuestos. Ve el
  -- expediente para saber a qué viene el paciente, y NO lo escribe.
  ('recepcion','expediente.ver'),
  ('recepcion','cliente.ver'), ('recepcion','cliente.editar'),
  ('recepcion','cliente.mensajes'),
  ('recepcion','agenda.ver'), ('recepcion','agenda.editar'),
  ('recepcion','presupuesto.editar'), ('recepcion','caja.ver'),

  -- CAJA.
  ('caja','cliente.ver'), ('caja','agenda.ver'),
  ('caja','caja.ver'), ('caja','caja.cobrar'), ('caja','caja.abrir_cerrar'),
  ('caja','presupuesto.editar'),
  ('caja','facturacion.ver'), ('caja','facturacion.emitir'),
  ('caja','inventario.ver'),

  -- FARMACIA.
  ('farmacia','cliente.ver'),
  ('farmacia','caja.ver'), ('farmacia','caja.cobrar'),
  ('farmacia','inventario.ver'), ('farmacia','inventario.mover'),
  ('farmacia','inventario.comprar'), ('farmacia','inventario.ajustar'),
  ('farmacia','catalogo.editar'),
  ('farmacia','facturacion.ver'), ('farmacia','facturacion.emitir'),

  -- ESTÉTICA: grooming y nada más del expediente. Es la regla del 07.
  ('estetica','expediente.ver'), ('estetica','expediente.grooming'),
  ('estetica','cliente.ver'), ('estetica','agenda.ver'), ('estetica','agenda.editar'),

  -- ASISTENTE TÉCNICO: signos y peso. No firma ni escribe contenido
  -- clínico, y por eso tiene `expediente.signos` y no
  -- `expediente.escribir`.
  ('asistente','expediente.ver'), ('asistente','expediente.signos'),
  ('asistente','cliente.ver'), ('asistente','agenda.ver'), ('asistente','agenda.editar'),
  ('asistente','inventario.ver'),

  -- CONTADOR: solo lectura y SIN datos clínicos. No tiene
  -- `expediente.ver`, que es el punto de este rol.
  ('contador','caja.ver'), ('contador','facturacion.ver'),
  ('contador','reportes.ver'), ('contador','datos.exportar'),
  ('contador','catalogo.ver_costos'), ('contador','inventario.ver')
) AS v(rol, permiso)
WHERE NOT EXISTS (
  SELECT 1 FROM rol_permisos rp WHERE rp.rol = v.rol AND rp.permiso = v.permiso
);

-- ---------------------------------------------------------------------
-- LO QUE CADA CLÍNICA PUEDE CAMBIAR.
--
-- Solo de los permisos `configurable`. Una fila acá GANA sobre la matriz
-- del núcleo: `true` lo agrega, `false` lo quita.
--
-- El CHECK contra `permisos.configurable` no se puede escribir como
-- constraint (necesitaría una subconsulta), así que lo impone la
-- función de escritura y el verificador lo comprueba.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_rol_permiso (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
              DEFERRABLE INITIALLY DEFERRED,
  rol       VARCHAR(30) NOT NULL REFERENCES roles(codigo) ON DELETE CASCADE,
  permiso   VARCHAR(50) NOT NULL REFERENCES permisos(codigo) ON DELETE CASCADE,
  concedido BOOLEAN NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por UUID REFERENCES personas(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_rol_permiso
  ON tenant_rol_permiso (tenant_id, rol, permiso);

ALTER TABLE tenant_rol_permiso ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_rol_permiso FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rol_permiso_tenant ON tenant_rol_permiso;
CREATE POLICY tenant_rol_permiso_tenant ON tenant_rol_permiso
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE tenant_rol_permiso IS
  'Los permisos configurables que cada clínica activa o desactiva por rol. Gana sobre la matriz del núcleo (prompt 04).';

-- ---------------------------------------------------------------------
-- QUÉ ROLES TIENE CADA PERSONA.
--
-- Varios por persona: los permisos son la UNIÓN. El caso de Medicavet
-- —médica y administradora— y la recepcionista que también cobra.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persona_roles (
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE
               DEFERRABLE INITIALLY DEFERRED,
  rol        VARCHAR(30) NOT NULL REFERENCES roles(codigo) ON DELETE CASCADE,
  /* Para auditar quién le dio qué. */
  asignado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  asignado_por UUID REFERENCES personas(id) ON DELETE SET NULL
               DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (persona_id, rol)
);

CREATE INDEX IF NOT EXISTS idx_persona_roles_rol ON persona_roles (rol);

-- SIN RLS POR TENANT, y es a propósito: `persona_roles` no tiene
-- `tenant_id` —lo tiene `personas`— y `resolverPrincipal` la consulta
-- ANTES de saber el tenant, con el pool admin, para poder resolver quién
-- es quien pregunta. El aislamiento lo da la FK: una fila solo puede
-- apuntar a una persona, y la persona tiene su tenant.
COMMENT ON TABLE persona_roles IS
  'Los roles de cada persona. Varios por persona: los permisos son la unión (prompt 04).';

-- ---------------------------------------------------------------------
-- LA SIEMBRA: cada persona que ya existe nace con el rol que tenía.
--
-- Es lo que hace que el despliegue no cambie el comportamiento de nadie.
-- Una persona que era las dos cosas queda con los dos roles, que es
-- exactamente lo que ya pasaba.
-- ---------------------------------------------------------------------
INSERT INTO persona_roles (persona_id, rol)
SELECT p.id, 'admin_clinica' FROM personas p
 WHERE p.es_admin_clinica
   AND NOT EXISTS (
     SELECT 1 FROM persona_roles pr WHERE pr.persona_id = p.id AND pr.rol = 'admin_clinica'
   );

INSERT INTO persona_roles (persona_id, rol)
SELECT p.id, 'medico' FROM personas p
 WHERE p.es_medico
   AND NOT EXISTS (
     SELECT 1 FROM persona_roles pr WHERE pr.persona_id = p.id AND pr.rol = 'medico'
   );

COMMENT ON COLUMN personas.es_medico IS
  'DERIVADA de persona_roles desde el prompt 04: la fuente es el rol «medico». Se conserva porque 70 chequeos la usan; se borra cuando nadie la lea.';
COMMENT ON COLUMN personas.es_admin_clinica IS
  'DERIVADA de persona_roles desde el prompt 04: la fuente es el rol «admin_clinica». Se conserva porque 30 chequeos la usan.';
