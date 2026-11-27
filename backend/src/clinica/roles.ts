import { PoolClient } from "pg";
import { olvidarPermisos } from "../permisos";

// ---------------------------------------------------------------------
// LA MATRIZ DE ROLES Y PERMISOS — prompt 04, sección 1.
//
// De solo lectura para el núcleo: lo que cada rol puede hacer es parte
// del producto y no una configuración. Lo que la clínica sí puede
// cambiar son los permisos marcados `configurable` —cinco: ver costos y
// márgenes, aplicar descuentos, anular, ajustar inventario, exportar
// datos—, y cada cambio queda auditado.
//
// LOS PERMISOS CLÍNICOS NO SE CONFIGURAN. Escribir y firmar el
// expediente es del rol médico, punto: lo dice el prompt y es lo que
// hace que una firma en el expediente signifique algo. Ninguno de esos
// permisos está marcado configurable, así que esta función no los puede
// tocar aunque alguien lo pida.
// ---------------------------------------------------------------------

export interface MatrizDeRoles {
  roles: Array<{
    codigo: string;
    nombre: string;
    descripcion: string | null;
    pantallaInicio: string | null;
    esClinico: boolean;
    personas: number;
  }>;
  permisos: Array<{
    codigo: string;
    nombre: string;
    modulo: string;
    configurable: boolean;
  }>;
  /** `rol|permiso` de todo lo concedido, ya resuelto con lo de la clínica. */
  concedidos: string[];
  /** Lo que esta clínica cambió respecto del núcleo, para poder mostrarlo. */
  cambiados: Array<{ rol: string; permiso: string; concedido: boolean }>;
}

export async function matrizDeRoles(db: PoolClient, tenantId: string): Promise<MatrizDeRoles> {
  const roles = await db.query<{
    codigo: string;
    nombre: string;
    descripcion: string | null;
    pantalla_inicio: string | null;
    es_clinico: boolean;
    personas: string;
  }>(
    `SELECT r.codigo, r.nombre, r.descripcion, r.pantalla_inicio, r.es_clinico,
            (SELECT count(*) FROM persona_roles pr
               JOIN personas p ON p.id = pr.persona_id
              WHERE pr.rol = r.codigo AND p.estado = 'activo')::text AS personas
       FROM roles r ORDER BY r.orden`
  );
  const permisos = await db.query<{
    codigo: string;
    nombre: string;
    modulo: string;
    configurable: boolean;
  }>(`SELECT codigo, nombre, modulo, configurable FROM permisos ORDER BY orden`);

  const nucleo = await db.query<{ rol: string; permiso: string }>(
    `SELECT rol, permiso FROM rol_permisos`
  );
  const cambiados = await db.query<{ rol: string; permiso: string; concedido: boolean }>(
    `SELECT rol, permiso, concedido FROM tenant_rol_permiso WHERE tenant_id = $1`,
    [tenantId]
  );

  // EL RESULTADO ES LO QUE DE VERDAD RIGE, no la matriz del núcleo: la
  // pantalla tiene que mostrar lo que pasa, y lo que la clínica cambió
  // se marca aparte para poder decir «esto lo cambiaron ustedes».
  const efectivos = new Set(nucleo.rows.map((f) => `${f.rol}|${f.permiso}`));
  for (const c of cambiados.rows) {
    const llave = `${c.rol}|${c.permiso}`;
    if (c.concedido) efectivos.add(llave);
    else efectivos.delete(llave);
  }

  return {
    roles: roles.rows.map((r) => ({
      codigo: r.codigo,
      nombre: r.nombre,
      descripcion: r.descripcion,
      pantallaInicio: r.pantalla_inicio,
      esClinico: r.es_clinico,
      personas: Number(r.personas),
    })),
    permisos: permisos.rows,
    concedidos: [...efectivos],
    cambiados: cambiados.rows,
  };
}

export class PermisoNoConfigurable extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PermisoNoConfigurable";
  }
}

/**
 * Activa o desactiva un permiso configurable para un rol de esta clínica.
 *
 * SOLO LOS `configurable`. El chequeo no se puede escribir como
 * constraint de la base —necesitaría una subconsulta— así que vive acá,
 * y el verificador comprueba que no se pueda saltar.
 */
export async function guardarPermisoDeRol(
  db: PoolClient,
  tenantId: string,
  datos: { rol: string; permiso: string; concedido: boolean; personaId?: string }
): Promise<{ rol: string; permiso: string; concedido: boolean }> {
  const p = await db.query<{ configurable: boolean; nombre: string }>(
    `SELECT configurable, nombre FROM permisos WHERE codigo = $1`,
    [datos.permiso]
  );
  if (p.rows.length === 0) {
    throw new PermisoNoConfigurable(`No existe el permiso «${datos.permiso}».`);
  }
  if (!p.rows[0].configurable) {
    throw new PermisoNoConfigurable(
      `«${p.rows[0].nombre}» es parte del rol y no se configura. Los permisos clínicos —escribir y firmar el expediente— son del médico y no se pueden mover.`
    );
  }
  const r = await db.query<{ codigo: string }>(`SELECT codigo FROM roles WHERE codigo = $1`, [
    datos.rol,
  ]);
  if (r.rows.length === 0) throw new PermisoNoConfigurable(`No existe el rol «${datos.rol}».`);

  await db.query(
    `INSERT INTO tenant_rol_permiso (tenant_id, rol, permiso, concedido, actualizado_por)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, rol, permiso) DO UPDATE
       SET concedido = EXCLUDED.concedido, actualizado_en = now(),
           actualizado_por = EXCLUDED.actualizado_por`,
    [tenantId, datos.rol, datos.permiso, datos.concedido, datos.personaId ?? null]
  );

  // CADA CAMBIO QUEDA AUDITADO, en el mismo historial que las políticas:
  // el prompt lo pide para las dos cosas y dos historiales serían dos
  // pantallas donde buscar lo mismo.
  await db.query(
    `INSERT INTO politicas_historial
       (tenant_id, clave, rol, valor_anterior, valor_nuevo, cambiado_por)
     VALUES ($1, $2, $3, NULL, $4, $5)`,
    [
      tenantId,
      `permiso.${datos.permiso}`,
      datos.rol,
      datos.concedido ? "concedido" : "quitado",
      datos.personaId ?? null,
    ]
  );

  // Todos los permisos de todos: el cambio es por rol y no por persona.
  olvidarPermisos();
  return { rol: datos.rol, permiso: datos.permiso, concedido: datos.concedido };
}
