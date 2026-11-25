// Verificación del modelo de datos del facturador (vetline-clinic-09a,
// punto 1): las reglas que el prompt pide imponer EN LA BASE.
//
// Todo se prueba contra la base real, con el pool admin — que es
// superusuario y se saltea RLS. Eso es a propósito: la pregunta no es
// "¿el backend respeta las reglas?" sino "¿las respeta alguien que entra
// por abajo?". Si una regla se puede violar desde acá, se puede violar
// desde un script de mantenimiento o desde una consola de psql.
//
// Crea su propia clínica desechable y la borra al final, así que se puede
// correr cuantas veces haga falta sin ensuciar los datos de desarrollo.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_facturacion_modelo.ts
import { pool } from "../db";
import { auditarRlsPorTenant } from "../jobs/auditoriaRls.job";

const PREFIJO = "probe-fact-modelo";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

/**
 * Corre algo que TIENE que fallar y devuelve el error. Que la operación
 * funcione es el fallo: un `await` suelto sin esto convierte "la base
 * dejó borrar un comprobante enviado" en un verificador que pasa.
 */
async function debeFallar(
  descripcion: string,
  fn: () => Promise<unknown>,
  codigoEsperado?: string
): Promise<void> {
  try {
    await fn();
    assert(false, `${descripcion} — NO falló, y tenía que fallar`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const codigoOk = !codigoEsperado || e.code === codigoEsperado;
    assert(
      codigoOk,
      `${descripcion} — rechazado (${e.code})`,
      codigoOk ? (e.message ?? "").split("\n")[0].slice(0, 110) : { esperado: codigoEsperado, recibido: e.code }
    );
  }
}

const TABLAS_FACT = [
  "fact_emisores",
  "fact_credenciales",
  "fact_consecutivos",
  "fact_comprobantes",
  "fact_comprobante_lineas",
  "fact_linea_impuestos",
  "fact_linea_descuentos",
  "fact_comprobante_medios_pago",
  "fact_comprobante_referencias",
  "fact_comprobante_otros_cargos",
  "fact_comprobante_eventos",
  "fact_recibidos",
];

const TABLAS_CATALOGO = [
  "fact_cat_tipo_comprobante",
  "fact_cat_tipo_identificacion",
  "fact_cat_condicion_venta",
  "fact_cat_medio_pago",
  "fact_cat_codigo_impuesto",
  "fact_cat_tarifa_iva",
  "fact_cat_unidad_medida",
  "fact_cat_moneda",
  "fact_cat_codigo_descuento",
  "fact_cat_tipo_doc_referencia",
  "fact_cat_codigo_referencia",
  "fact_cat_condicion_impuesto",
  "fact_cat_cabys",
];

async function limpiar() {
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

async function crearTenant(sufijo: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
    [`${PREFIJO}-${sufijo}`]
  );
  return r.rows[0].id;
}

async function crearEmisor(tenantId: string, cedula: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO fact_emisores (
       tenant_id, tipo_identificacion, numero_identificacion, nombre,
       codigo_actividad_economica, ubicacion_provincia, ubicacion_canton,
       ubicacion_distrito, ubicacion_otras_senas, correo, proveedor_sistemas
     ) VALUES ($1, '02', $2, 'Clínica Veterinaria de Prueba S.A.', '750000',
               '1', '01', '01', '200 metros norte de la iglesia',
               'facturacion@clinica-prueba.test', '3101999999')
     RETURNING id`,
    [tenantId, cedula]
  );
  return r.rows[0].id;
}

/** 50 dígitos a partir de un número, para no repetir claves entre casos. */
function clave(n: number): string {
  return String(n).padStart(50, "5");
}
/** 20 dígitos: los 10 del prefijo sucursal/terminal/tipo más el contador. */
function consecutivo(n: number): string {
  return "0010000101" + String(n).padStart(10, "0");
}

async function crearComprobante(
  tenantId: string,
  emisorId: string,
  opciones: { clave: string; consecutivo: string; estado?: string; idempotencia?: string | null }
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO fact_comprobantes (
       tenant_id, emisor_id, tipo_comprobante, clave, consecutivo, sucursal, terminal,
       fecha_emision, condicion_venta, estado, clave_idempotencia
     ) VALUES ($1, $2, '01', $3, $4, '001', '00001', now(), '01', $5, $6)
     RETURNING id`,
    [
      tenantId,
      emisorId,
      opciones.clave,
      opciones.consecutivo,
      opciones.estado ?? "borrador",
      opciones.idempotencia ?? null,
    ]
  );
  return r.rows[0].id;
}

async function crearLinea(comprobanteId: string, numero = 1): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO fact_comprobante_lineas (
       comprobante_id, numero_linea, codigo_cabys, cantidad, unidad_medida, detalle,
       precio_unitario, monto_total, subtotal, base_imponible, impuesto_neto, monto_total_linea
     ) VALUES ($1, $2, '1234567890123', 1, 'Unid', 'Consulta veterinaria general',
               10000, 10000, 10000, 10000, 1300, 11300)
     RETURNING id`,
    [comprobanteId, numero]
  );
  return r.rows[0].id;
}

async function main() {
  await limpiar();
  try {
    const tenantA = await crearTenant("a");
    const tenantB = await crearTenant("b");
    const emisorA = await crearEmisor(tenantA, "3101111111");
    const emisorB = await crearEmisor(tenantB, "3102222222");

    // -----------------------------------------------------------------
    console.log("=== 1. Las 25 tablas existen; las de tenant con RLS forzado y cascada ===");
    for (const t of [...TABLAS_FACT, ...TABLAS_CATALOGO]) {
      const r = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = $1`,
        [t]
      );
      assert(r.rows[0].n === "1", `existe la tabla ${t}`);
    }

    for (const t of TABLAS_FACT) {
      const r = await pool.query<{ rls: boolean; forzado: boolean; politicas: number }>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado,
                (SELECT count(*)::int FROM pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politicas
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = $1`,
        [t]
      );
      const f = r.rows[0];
      assert(
        f.rls && f.forzado && f.politicas === 1,
        `${t}: RLS habilitado, forzado y con su política`,
        f.rls && f.forzado && f.politicas === 1 ? "" : f
      );
      const fk = await pool.query<{ accion: string }>(
        `SELECT con.confdeltype AS accion FROM pg_constraint con
         WHERE con.contype = 'f' AND con.conrelid = $1::regclass AND con.confrelid = 'tenants'::regclass`,
        [t]
      );
      assert(
        fk.rows.length === 1 && fk.rows[0].accion === "c",
        `${t}: una FK a tenants, ON DELETE CASCADE`,
        fk.rows
      );
    }

    // Los catálogos NO llevan tenant_id, y eso tiene que ser a propósito
    // y verificado: si alguno lo llevara, la auditoría de RLS lo
    // reportaría como tabla sin RLS para siempre.
    for (const t of TABLAS_CATALOGO) {
      const r = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'`,
        [t]
      );
      assert(r.rows[0].n === "0", `${t}: catálogo de plataforma, sin tenant_id`);
    }

    const auditoria = await auditarRlsPorTenant(pool);
    assert(auditoria.sinRls.length === 0, "la auditoría de RLS no ve tablas sin RLS", auditoria.sinRls);
    assert(auditoria.sinForzar.length === 0, "…ni sin forzar", auditoria.sinForzar);
    assert(auditoria.sinPolitica.length === 0, "…ni sin política", auditoria.sinPolitica);
    assert(auditoria.fkSinCascada.length === 0, "…ni FK a tenants sin cascada", auditoria.fkSinCascada);

    // -----------------------------------------------------------------
    console.log("\n=== 2. Consecutivo único por emisor, sucursal, terminal y tipo ===");
    await crearComprobante(tenantA, emisorA, { clave: clave(1), consecutivo: consecutivo(1) });
    await debeFallar(
      "el mismo consecutivo repetido en el mismo emisor",
      () => crearComprobante(tenantA, emisorA, { clave: clave(2), consecutivo: consecutivo(1) }),
      "23505"
    );
    // Dos emisores distintos SÍ pueden tener el mismo consecutivo: la
    // numeración es por emisor, no global.
    const compB = await crearComprobante(tenantB, emisorB, {
      clave: clave(3),
      consecutivo: consecutivo(1),
    });
    assert(!!compB, "otro emisor puede usar el mismo consecutivo (la numeración es por emisor)");

    // -----------------------------------------------------------------
    console.log("\n=== 3. Clave numérica de 50 dígitos única y bien formada ===");
    await debeFallar(
      "la misma clave de 50 dígitos repetida",
      () => crearComprobante(tenantA, emisorA, { clave: clave(1), consecutivo: consecutivo(9) }),
      "23505"
    );
    await debeFallar(
      "una clave de 49 dígitos",
      () =>
        crearComprobante(tenantA, emisorA, {
          clave: "4".repeat(49),
          consecutivo: consecutivo(10),
        }),
      "23514"
    );
    await debeFallar(
      "una clave con una letra",
      () =>
        crearComprobante(tenantA, emisorA, {
          clave: "A" + "4".repeat(49),
          consecutivo: consecutivo(11),
        }),
      "23514"
    );
    await debeFallar(
      "un consecutivo de 19 dígitos",
      () =>
        crearComprobante(tenantA, emisorA, {
          clave: clave(12),
          consecutivo: "1".repeat(19),
        }),
      "23514"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 4. Idempotencia: la misma solicitud no genera dos comprobantes ===");
    await crearComprobante(tenantA, emisorA, {
      clave: clave(20),
      consecutivo: consecutivo(20),
      idempotencia: "venta-caja-0001",
    });
    await debeFallar(
      "la misma clave de idempotencia en el mismo emisor",
      () =>
        crearComprobante(tenantA, emisorA, {
          clave: clave(21),
          consecutivo: consecutivo(21),
          idempotencia: "venta-caja-0001",
        }),
      "23505"
    );
    const otroEmisorMismaClave = await crearComprobante(tenantB, emisorB, {
      clave: clave(22),
      consecutivo: consecutivo(22),
      idempotencia: "venta-caja-0001",
    });
    assert(
      !!otroEmisorMismaClave,
      "la misma clave de idempotencia en OTRO emisor sí entra (el UNIQUE es por emisor)"
    );
    // Dos emisiones sin clave de idempotencia no deben chocar entre sí:
    // NULL no colisiona con NULL en Postgres, y eso es lo que permite
    // emitir desde la pantalla propia sin inventar una clave.
    await crearComprobante(tenantA, emisorA, {
      clave: clave(23),
      consecutivo: consecutivo(23),
      idempotencia: null,
    });
    await crearComprobante(tenantA, emisorA, {
      clave: clave(24),
      consecutivo: consecutivo(24),
      idempotencia: null,
    });
    assert(true, "dos emisiones SIN clave de idempotencia no chocan entre sí");

    // -----------------------------------------------------------------
    console.log("\n=== 5. Un comprobante enviado a Hacienda no se borra ===");
    const borrador = await crearComprobante(tenantA, emisorA, {
      clave: clave(30),
      consecutivo: consecutivo(30),
      estado: "borrador",
    });
    const firmado = await crearComprobante(tenantA, emisorA, {
      clave: clave(31),
      consecutivo: consecutivo(31),
      estado: "firmado",
    });
    const borradoBorrador = await pool.query(`DELETE FROM fact_comprobantes WHERE id = $1`, [
      borrador,
    ]);
    assert(
      borradoBorrador.rowCount === 1,
      "un BORRADOR sí se puede borrar (todavía no existe para Hacienda)"
    );
    const borradoFirmado = await pool.query(`DELETE FROM fact_comprobantes WHERE id = $1`, [
      firmado,
    ]);
    assert(borradoFirmado.rowCount === 1, "un FIRMADO que nunca salió también se puede borrar");

    for (const estado of ["enviado", "aceptado", "aceptado_parcial", "rechazado"]) {
      const id = await crearComprobante(tenantA, emisorA, {
        clave: clave(40 + estado.length),
        consecutivo: consecutivo(40 + estado.length),
        estado,
      });
      await debeFallar(
        `borrar un comprobante en estado '${estado}'`,
        () => pool.query(`DELETE FROM fact_comprobantes WHERE id = $1`, [id]),
        "23001"
      );
    }

    // -----------------------------------------------------------------
    console.log("\n=== 6. El XML firmado y la respuesta de Hacienda no cambian ===");
    const conXml = await crearComprobante(tenantA, emisorA, {
      clave: clave(50),
      consecutivo: consecutivo(50),
      estado: "firmado",
    });
    const primerGuardado = await pool.query(
      `UPDATE fact_comprobantes SET xml_firmado = $2 WHERE id = $1`,
      [conXml, Buffer.from("<FacturaElectronica>uno</FacturaElectronica>")]
    );
    assert(primerGuardado.rowCount === 1, "el XML firmado se puede guardar la primera vez (NULL → valor)");

    await debeFallar(
      "cambiar un XML firmado ya guardado",
      () =>
        pool.query(`UPDATE fact_comprobantes SET xml_firmado = $2 WHERE id = $1`, [
          conXml,
          Buffer.from("<FacturaElectronica>DOS</FacturaElectronica>"),
        ]),
      "23001"
    );
    await debeFallar(
      "borrar un XML firmado (volverlo NULL)",
      () => pool.query(`UPDATE fact_comprobantes SET xml_firmado = NULL WHERE id = $1`, [conXml]),
      "23001"
    );

    await pool.query(
      `UPDATE fact_comprobantes
         SET estado = 'enviado', enviado_en = now(),
             respuesta_xml = $2, respuesta_ind_estado = 'aceptado'
       WHERE id = $1`,
      [conXml, Buffer.from("<MensajeHacienda>aceptado</MensajeHacienda>")]
    );
    assert(true, "la respuesta de Hacienda se puede guardar la primera vez");
    await debeFallar(
      "cambiar la respuesta de Hacienda ya guardada",
      () =>
        pool.query(`UPDATE fact_comprobantes SET respuesta_xml = $2 WHERE id = $1`, [
          conXml,
          Buffer.from("<MensajeHacienda>rechazado</MensajeHacienda>"),
        ]),
      "23001"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 7. Un comprobante enviado no se edita (salvo su propio seguimiento) ===");
    await debeFallar(
      "cambiar el total de un comprobante enviado",
      () =>
        pool.query(`UPDATE fact_comprobantes SET total_comprobante = 999 WHERE id = $1`, [conXml]),
      "23001"
    );
    await debeFallar(
      "cambiar el receptor de un comprobante enviado",
      () =>
        pool.query(`UPDATE fact_comprobantes SET receptor_nombre = 'Otro' WHERE id = $1`, [conXml]),
      "23001"
    );
    await debeFallar(
      "cambiar la clave de un comprobante enviado",
      () => pool.query(`UPDATE fact_comprobantes SET clave = $2 WHERE id = $1`, [conXml, clave(51)]),
      "23001"
    );
    await debeFallar(
      "mover un comprobante a otra clínica",
      () =>
        pool.query(`UPDATE fact_comprobantes SET tenant_id = $2 WHERE id = $1`, [conXml, tenantB]),
      "23001"
    );
    // Lo que SÍ tiene que poder cambiar: es la única forma de registrar
    // que Hacienda contestó.
    const seguimiento = await pool.query(
      `UPDATE fact_comprobantes
          SET estado = 'aceptado', respuesta_ind_estado = 'aceptado',
              respuesta_recibida_en = now(), respuesta_detalle = 'Comprobante aceptado',
              intentos_envio = intentos_envio + 1, proximo_intento_en = NULL
        WHERE id = $1`,
      [conXml]
    );
    assert(
      seguimiento.rowCount === 1,
      "el estado y la respuesta de Hacienda SÍ se pueden actualizar (lista blanca)"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 8. Las líneas de un comprobante enviado quedan congeladas ===");
    const conLineas = await crearComprobante(tenantA, emisorA, {
      clave: clave(60),
      consecutivo: consecutivo(60),
      estado: "borrador",
    });
    const linea = await crearLinea(conLineas);
    await pool.query(
      `INSERT INTO fact_linea_impuestos (linea_id, codigo_impuesto, codigo_tarifa_iva, tarifa, monto)
       VALUES ($1, '01', '08', 13, 1300)`,
      [linea]
    );
    await pool.query(
      `INSERT INTO fact_comprobante_medios_pago (comprobante_id, codigo_medio_pago, monto)
       VALUES ($1, '06', 11300)`,
      [conLineas]
    );
    assert(true, "con el comprobante en borrador, las líneas y los pagos se escriben normal");

    await pool.query(`UPDATE fact_comprobantes SET estado = 'aceptado' WHERE id = $1`, [conLineas]);
    await debeFallar(
      "agregar una línea a un comprobante enviado",
      () => crearLinea(conLineas, 2),
      "23001"
    );
    await debeFallar(
      "cambiar el monto de una línea de un comprobante enviado",
      () =>
        pool.query(`UPDATE fact_comprobante_lineas SET monto_total = 1 WHERE id = $1`, [linea]),
      "23001"
    );
    await debeFallar(
      "borrar una línea de un comprobante enviado",
      () => pool.query(`DELETE FROM fact_comprobante_lineas WHERE id = $1`, [linea]),
      "23001"
    );
    await debeFallar(
      "cambiar el impuesto de una línea de un comprobante enviado",
      () => pool.query(`UPDATE fact_linea_impuestos SET monto = 0 WHERE linea_id = $1`, [linea]),
      "23001"
    );
    await debeFallar(
      "cambiar el medio de pago de un comprobante enviado",
      () =>
        pool.query(`UPDATE fact_comprobante_medios_pago SET monto = 1 WHERE comprobante_id = $1`, [
          conLineas,
        ]),
      "23001"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 9. Los eventos solo se agregan ===");
    const evento = await pool.query<{ id: string }>(
      `INSERT INTO fact_comprobante_eventos (comprobante_id, tipo_evento, detalle)
       VALUES ($1, 'creado', '{"origen":"verificador"}'::jsonb) RETURNING id`,
      [conLineas]
    );
    assert(!!evento.rows[0].id, "un evento se puede insertar");
    await debeFallar(
      "modificar un evento",
      () =>
        pool.query(`UPDATE fact_comprobante_eventos SET tipo_evento = 'error' WHERE id = $1`, [
          evento.rows[0].id,
        ]),
      "23001"
    );
    await debeFallar(
      "borrar un evento",
      () => pool.query(`DELETE FROM fact_comprobante_eventos WHERE id = $1`, [evento.rows[0].id]),
      "23001"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 10. El tenant_id de las hijas es DERIVADO, no una copia ===");
    const paraDerivar = await crearComprobante(tenantA, emisorA, {
      clave: clave(70),
      consecutivo: consecutivo(70),
    });
    // La inserción de arriba (crearLinea) nunca manda tenant_id: si la
    // columna fuera una copia a mano, sería NOT NULL violado.
    const lineaDerivada = await crearLinea(paraDerivar);
    const derivado = await pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM fact_comprobante_lineas WHERE id = $1`,
      [lineaDerivada]
    );
    assert(
      derivado.rows[0].tenant_id === tenantA,
      "la línea hereda el tenant del comprobante sin que nadie lo escriba"
    );

    // Y si alguien lo escribe MAL, el trigger lo corrige en vez de
    // guardar una fila que RLS le ocultaría a su dueño.
    const conTenantFalso = await pool.query<{ id: string; tenant_id: string }>(
      `INSERT INTO fact_comprobante_lineas (
         tenant_id, comprobante_id, numero_linea, codigo_cabys, cantidad, unidad_medida,
         detalle, precio_unitario, monto_total, subtotal, monto_total_linea
       ) VALUES ($1, $2, 2, '1234567890123', 1, 'Unid', 'Línea con tenant falso',
                 1000, 1000, 1000, 1130)
       RETURNING id, tenant_id`,
      [tenantB, paraDerivar]
    );
    assert(
      conTenantFalso.rows[0].tenant_id === tenantA,
      "un tenant_id escrito a mano y equivocado se corrige al del padre",
      conTenantFalso.rows[0].tenant_id === tenantA ? "" : conTenantFalso.rows[0]
    );
    await debeFallar(
      "reasignar una línea a otra clínica",
      () =>
        pool.query(`UPDATE fact_comprobante_lineas SET tenant_id = $2 WHERE id = $1`, [
          lineaDerivada,
          tenantB,
        ]),
      "23001"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 11. Las credenciales quedan cifradas en reposo ===");
    const CLAVE = "clave-de-prueba-del-verificador";
    const PASSWORD = "Contrasena-ATV-de-prueba-2026!";
    await pool.query(
      `INSERT INTO fact_credenciales (
         tenant_id, emisor_id, ambiente, usuario_api,
         password_api_cifrada, llave_p12_cifrada, pin_llave_cifrado,
         llave_vence_en, llave_nombre_archivo
       ) VALUES ($1, $2, 'pruebas', 'cpj-3-101-111111@stag.comprobanteselectronicos.go.cr',
                 pgp_sym_encrypt($3, $4), pgp_sym_encrypt('contenido-p12-falso', $4),
                 pgp_sym_encrypt('1234', $4), '2027-06-30', 'llave-prueba.p12')`,
      [tenantA, emisorA, PASSWORD, CLAVE]
    );
    const bytes = await pool.query<{ password_api_cifrada: Buffer }>(
      `SELECT password_api_cifrada FROM fact_credenciales WHERE emisor_id = $1`,
      [emisorA]
    );
    const enClaro = bytes.rows[0].password_api_cifrada.toString("utf-8");
    assert(
      !enClaro.includes(PASSWORD),
      "la contraseña NO aparece en claro en la columna (está cifrada)"
    );
    const descifrada = await pool.query<{ p: string }>(
      `SELECT pgp_sym_decrypt(password_api_cifrada, $2) AS p FROM fact_credenciales WHERE emisor_id = $1`,
      [emisorA, CLAVE]
    );
    assert(descifrada.rows[0].p === PASSWORD, "y se descifra correctamente con la clave correcta");
    await debeFallar(
      "descifrar con la clave equivocada",
      () =>
        pool.query(`SELECT pgp_sym_decrypt(password_api_cifrada, 'clave-mala') FROM fact_credenciales WHERE emisor_id = $1`, [
          emisorA,
        ]),
      "39000"
    );
    await debeFallar(
      "dos juegos de credenciales para el mismo emisor y ambiente",
      () =>
        pool.query(
          `INSERT INTO fact_credenciales (tenant_id, emisor_id, ambiente, usuario_api,
             password_api_cifrada, llave_p12_cifrada, pin_llave_cifrado)
           VALUES ($1, $2, 'pruebas', 'otro', pgp_sym_encrypt('x', 'k'),
                   pgp_sym_encrypt('x', 'k'), pgp_sym_encrypt('x', 'k'))`,
          [tenantA, emisorA]
        ),
      "23505"
    );

    // -----------------------------------------------------------------
    console.log("\n=== 12. Un contador de consecutivo por emisor, sucursal, terminal y tipo ===");
    await pool.query(
      `INSERT INTO fact_consecutivos (tenant_id, emisor_id, sucursal, terminal, tipo_comprobante)
       VALUES ($1, $2, '001', '00001', '01')`,
      [tenantA, emisorA]
    );
    await debeFallar(
      "dos contadores para el mismo emisor, sucursal, terminal y tipo",
      () =>
        pool.query(
          `INSERT INTO fact_consecutivos (tenant_id, emisor_id, sucursal, terminal, tipo_comprobante)
           VALUES ($1, $2, '001', '00001', '01')`,
          [tenantA, emisorA]
        ),
      "23505"
    );
    // Cambiar cualquiera de los cuatro da un contador distinto, que es
    // justo lo que la Nota 3 pide.
    for (const [suc, term, tipo] of [
      ["002", "00001", "01"],
      ["001", "00002", "01"],
      ["001", "00001", "04"],
    ] as const) {
      await pool.query(
        `INSERT INTO fact_consecutivos (tenant_id, emisor_id, sucursal, terminal, tipo_comprobante)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantA, emisorA, suc, term, tipo]
      );
    }
    const contadores = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fact_consecutivos WHERE emisor_id = $1`,
      [emisorA]
    );
    assert(
      contadores.rows[0].n === "4",
      "cambiar sucursal, terminal o tipo da un contador independiente",
      contadores.rows[0].n
    );

    // -----------------------------------------------------------------
    console.log("\n=== 13. La purga de la clínica SÍ se lleva todo (regresión real) ===");
    // Con los triggers sin excepción para la cascada, una clínica con una
    // sola factura aceptada no se podía purgar NUNCA: el DELETE FROM
    // tenants fallaba con "ya fue enviado a Hacienda". Es el mismo modo
    // de falla que la auditoría de RLS vigila para las FK sin cascada, y
    // la auditoría no lo habría visto porque la FK sí es CASCADE.
    const tenantPurga = await crearTenant("purga");
    const emisorPurga = await crearEmisor(tenantPurga, "3103333333");
    const compPurga = await crearComprobante(tenantPurga, emisorPurga, {
      clave: clave(80),
      consecutivo: consecutivo(80),
      estado: "borrador",
    });
    const lineaPurga = await crearLinea(compPurga);
    await pool.query(
      `INSERT INTO fact_linea_impuestos (linea_id, codigo_impuesto, codigo_tarifa_iva, tarifa, monto)
       VALUES ($1, '01', '08', 13, 1300)`,
      [lineaPurga]
    );
    await pool.query(
      `INSERT INTO fact_linea_descuentos (linea_id, monto, codigo_descuento) VALUES ($1, 500, '04')`,
      [lineaPurga]
    );
    await pool.query(
      `INSERT INTO fact_comprobante_referencias (comprobante_id, tipo_documento, numero, fecha_emision, codigo)
       VALUES ($1, '01', $2, now(), '01')`,
      [compPurga, clave(80)]
    );
    await pool.query(
      `INSERT INTO fact_comprobante_otros_cargos (comprobante_id, tipo_documento, detalle, monto)
       VALUES ($1, '07', 'Timbre de colegio profesional', 300)`,
      [compPurga]
    );
    await pool.query(
      `INSERT INTO fact_comprobante_eventos (comprobante_id, tipo_evento) VALUES ($1, 'creado')`,
      [compPurga]
    );
    await pool.query(
      `INSERT INTO fact_recibidos (tenant_id, emisor_id, clave, xml_recibido)
       VALUES ($1, $2, $3, $4)`,
      [tenantPurga, emisorPurga, clave(81), Buffer.from("<FacturaElectronica/>")]
    );
    // Y ahora el caso que rompía: dejarlo en un estado ya enviado.
    await pool.query(`UPDATE fact_comprobantes SET estado = 'aceptado' WHERE id = $1`, [compPurga]);

    const purgado = await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantPurga]);
    assert(
      purgado.rowCount === 1,
      "DELETE FROM tenants funciona aunque la clínica tenga un comprobante ACEPTADO"
    );
    for (const t of TABLAS_FACT) {
      const r = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${t} WHERE tenant_id = $1`,
        [tenantPurga]
      );
      assert(r.rows[0].n === "0", `${t}: la cascada no dejó filas huérfanas`, r.rows[0].n);
    }

    // Pero seguir borrando a mano un comprobante enviado tiene que
    // seguir prohibido: la excepción es para la cascada, no para todos.
    await debeFallar(
      "borrar a mano un comprobante aceptado DESPUÉS de la excepción de la purga",
      () => pool.query(`DELETE FROM fact_comprobantes WHERE id = $1`, [conLineas]),
      "23001"
    );
  } finally {
    await limpiar();
    const quedan = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tenants WHERE nombre LIKE $1`,
      [`${PREFIJO}%`]
    );
    assert(quedan.rows[0].n === "0", "las clínicas de prueba quedaron borradas");
  }

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await limpiar().catch(() => undefined);
  await pool.end();
  process.exit(1);
});
