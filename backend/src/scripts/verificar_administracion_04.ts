// Verificación del prompt 04 (administración base).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_administracion_04.ts
//
// SIN --transpile-only a propósito.
//
// Es re-corrible: borra su clínica de prueba al empezar.
//
// Lo que verifica:
//
//   * los ocho roles con su matriz, y que los permisos clínicos NO se
//     puedan configurar;
//   * los permisos efectivos de cada rol, y la unión cuando alguien
//     tiene dos;
//   * lo que la clínica activa o desactiva, en las dos direcciones;
//   * que cambiar roles se vea en la próxima consulta (caché invalidada);
//   * **el defecto del desactivado**: una persona inactiva no resuelve;
//   * que no se pueda dejar la clínica sin administrador;
//   * las políticas: su valor, su rango, su historial y el respaldo en
//     la columna vieja.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { permisosDePersona, olvidarPermisos } from "../permisos";
import {
  asignarRoles,
  CambioDeRolesImposible,
  desactivarPersona,
  personasDeLaClinica,
} from "../clinica/personas";
import { guardarPermisoDeRol, matrizDeRoles, PermisoNoConfigurable } from "../clinica/roles";
import {
  guardarPolitica,
  historialDePolitica,
  politica,
  politicaConOrigen,
  politicaNumero,
  PoliticaInvalida,
  olvidarPoliticas,
} from "../clinica/politicas";
import { topeDeDescuento } from "../ventas/descuentos";
import {
  guardarExcepcion,
  guardarHorarioDelDia,
  horarioDeLaClinica,
  sePuedeAgendar,
} from "../clinica/horarios";
import { exigirPermiso } from "../permisos";
import { autorizarFueraDeHorario } from "../routes/citas.routes";
import {
  contarInvitacionesPendientes,
  crearInvitacion,
  invitaAUnMedico,
} from "../invitaciones";
import { tiposDeCita, guardarNumeracion, numeraciones } from "../clinica/agendaConfig";

const PREFIJO = "probe-04";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_administracion_04");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@04.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  const persona = async (nombre: string, roles: string[], colegiatura?: string) => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico,
                             es_admin_clinica, colegiatura, estado)
       VALUES ($1,$2,$3,'x',$4,$5,$6,'activo') RETURNING id`,
      [
        tenantId,
        nombre,
        `${PREFIJO}-${nombre.toLowerCase().replace(/\s/g, "")}@probe.test`,
        roles.includes("medico"),
        roles.includes("admin_clinica"),
        colegiatura ?? null,
      ]
    );
    for (const rol of roles) {
      // ON CONFLICT: el trigger de la migración 143 ya insertó los
      // roles de médico y administrador al crear la persona.
      await pool.query(
        `INSERT INTO persona_roles (persona_id, rol) VALUES ($1,$2)
         ON CONFLICT (persona_id, rol) DO NOTHING`,
        [r.rows[0].id, rol]
      );
    }
    return r.rows[0].id;
  };

  const admin = await persona("Ana Admin", ["admin_clinica"]);
  const medica = await persona("Bea Medica", ["medico"], "VET-0401");
  const recepcion = await persona("Caro Recepcion", ["recepcion"]);
  const dobleRol = await persona("Dani Recepcion y Caja", ["recepcion", "caja"]);
  const contador = await persona("Eli Contador", ["contador"]);

  // -------------------------------------------------------------------
  console.log("\n=== Los roles y sus permisos ===");
  // -------------------------------------------------------------------
  const pAdmin = await permisosDePersona(admin, tenantId);
  const pMedica = await permisosDePersona(medica, tenantId);
  const pRecepcion = await permisosDePersona(recepcion, tenantId);
  const pDoble = await permisosDePersona(dobleRol, tenantId);
  const pContador = await permisosDePersona(contador, tenantId);

  igual(pAdmin.esAdminClinica, true, "el administrador se deriva del rol, no de la columna");
  igual(pAdmin.esMedico, false, "y un administrador NO es médico por ser administrador");
  igual(pMedica.esMedico, true, "la médica sí");

  assert(
    pMedica.permisos.has("expediente.firmar"),
    "el médico puede firmar una atención"
  );
  assert(
    !pRecepcion.permisos.has("expediente.firmar"),
    "recepción NO puede firmar"
  );
  assert(
    !pRecepcion.permisos.has("expediente.escribir"),
    "ni escribir en el expediente"
  );
  assert(
    pRecepcion.permisos.has("expediente.ver"),
    "pero sí ve el expediente: tiene que saber a qué viene el paciente"
  );
  assert(
    !pAdmin.permisos.has("expediente.escribir"),
    "el administrador tampoco escribe el expediente: ser administrador no te hace médico"
  );

  // EL CONTADOR NO VE DATOS CLÍNICOS. Es el punto de ese rol.
  assert(!pContador.permisos.has("expediente.ver"), "el contador NO ve el expediente");
  assert(pContador.permisos.has("catalogo.ver_costos"), "y sí ve costos");
  assert(!pContador.permisos.has("caja.cobrar"), "pero no cobra: es de solo lectura");

  // LA UNIÓN DE DOS ROLES.
  assert(
    pDoble.permisos.has("agenda.editar") && pDoble.permisos.has("caja.abrir_cerrar"),
    "quien tiene recepción y caja puede agendar Y abrir la caja: los permisos son la unión"
  );
  igual(pDoble.roles.length, 2, "con sus dos roles");

  // NADIE SIN ADMINISTRADOR puede anular.
  assert(pAdmin.permisos.has("caja.anular"), "el administrador puede anular");
  assert(!pDoble.permisos.has("caja.anular"), "recepción y caja juntas NO pueden anular");

  // -------------------------------------------------------------------
  console.log("\n=== Lo que la clínica configura, y lo que no ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const matriz = await matrizDeRoles(db, tenantId);
    igual(matriz.roles.length, 8, "los ocho roles del prompt");
    // LOS CINCO DEL 04 SON CONFIGURABLES. La lista total crece con cada
    // prompt —el 10a sumó `finanzas.registrar` y el 11
    // `controlados.firmar_cierre`—, así que lo que se verifica es que
    // los cinco de este prompt estén, no que no haya más: lo contrario
    // haría fallar este verificador cada vez que otro prompt agrega un
    // permiso legítimamente configurable.
    const configurables = matriz.permisos.filter((p) => p.configurable).map((p) => p.codigo);
    for (const codigo of [
      "caja.anular",
      "caja.descuento",
      "inventario.ajustar",
      "catalogo.ver_costos",
      "datos.exportar",
    ]) {
      assert(configurables.includes(codigo), `«${codigo}» es configurable, como pide el prompt`);
    }
    assert(
      !configurables.some((c) => c.startsWith("expediente.") || c === "receta.emitir"),
      "y NINGÚN permiso clínico es configurable",
      configurables.join(", ")
    );

    // LOS PERMISOS CLÍNICOS NO SE CONFIGURAN.
    let clinico = "";
    try {
      await guardarPermisoDeRol(db, tenantId, {
        rol: "recepcion",
        permiso: "expediente.firmar",
        concedido: true,
      });
    } catch (err) {
      clinico = err instanceof PermisoNoConfigurable ? err.message : "otro error";
    }
    assert(
      clinico.includes("no se configura"),
      "darle a recepción el permiso de firmar se rechaza",
      clinico
    );

    // QUITAR UNO CONFIGURABLE.
    await guardarPermisoDeRol(db, tenantId, {
      rol: "medico",
      permiso: "caja.descuento",
      concedido: false,
      personaId: admin,
    });
    // SE LEE CON `db`, la transacción de este verificador: con el pool
    // admin no vería lo que acaba de escribir (commit diferido).
    const sinDescuento = await permisosDePersona(medica, tenantId, db);
    assert(
      !sinDescuento.permisos.has("caja.descuento"),
      "la clínica le quitó al médico el permiso de descontar y se aplicó"
    );

    // AGREGAR UNO QUE EL NÚCLEO NO DABA: las dos direcciones funcionan.
    await guardarPermisoDeRol(db, tenantId, {
      rol: "recepcion",
      permiso: "caja.anular",
      concedido: true,
      personaId: admin,
    });
    const conAnular = await permisosDePersona(recepcion, tenantId, db);
    assert(
      conAnular.permisos.has("caja.anular"),
      "y le pudo AGREGAR a recepción uno que el núcleo no le daba"
    );

    // Y queda auditado.
    const auditoria = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM politicas_historial
        WHERE tenant_id = $1 AND clave LIKE 'permiso.%'`,
      [tenantId]
    );
    igual(auditoria.rows[0].n, "2", "los dos cambios de permiso quedaron auditados");
  });

  // -------------------------------------------------------------------
  console.log("\n=== Cambiar roles se ve en la próxima consulta ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    await asignarRoles(db, recepcion, ["recepcion", "caja"], admin);
    const ahora = await permisosDePersona(recepcion, tenantId, db);
    assert(
      ahora.permisos.has("caja.abrir_cerrar"),
      "agregarle el rol de caja se ve sin cerrar sesión: la caché se invalida al guardar"
    );
    const fila = await db.query<{ es_medico: boolean; es_admin_clinica: boolean }>(
      `SELECT es_medico, es_admin_clinica FROM personas WHERE id = $1`,
      [recepcion]
    );
    igual(
      fila.rows[0],
      { es_medico: false, es_admin_clinica: false },
      "y los booleanos derivados quedaron al día"
    );

    // Una persona sin roles no se guarda.
    let sinRoles = "";
    try {
      await asignarRoles(db, recepcion, [], admin);
    } catch (err) {
      sinRoles = err instanceof CambioDeRolesImposible ? err.message : "";
    }
    assert(
      sinRoles.includes("al menos un rol"),
      "dejar a alguien sin roles se rechaza: entraría y no vería nada",
      sinRoles
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== EL DEFECTO: un desactivado no entra ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // `desactivarPersona` llama a Keycloak, que en esta prueba no tiene
    // al usuario: se verifica lo que SÍ depende de nosotros —el estado,
    // los roles y el aviso de citas— y se comprueba que el camino de
    // Keycloak informe en vez de romper.
    const r = await desactivarPersona(db, medica, admin);
    igual(r.estado, "inactivo", "la médica queda inactiva");
    igual(r.keycloak, "sin_usuario", "y se informa qué pasó en Keycloak");

    const queda = await db.query<{ estado: string; n: string }>(
      `SELECT p.estado,
              (SELECT count(*)::text FROM persona_roles pr WHERE pr.persona_id = p.id) AS n
         FROM personas p WHERE p.id = $1`,
      [medica]
    );
    igual(queda.rows[0].estado, "inactivo", "el estado quedó guardado");
    igual(queda.rows[0].n, "0", "y se le quitaron los roles");

    // LO QUE NO SE BORRA: su autoría. Es la razón de desactivar en vez
    // de borrar.
    const sigue = await db.query<{ nombre: string }>(
      `SELECT nombre FROM personas WHERE id = $1`,
      [medica]
    );
    igual(sigue.rows[0].nombre, "Bea Medica", "la persona sigue existiendo con su nombre");

    // NADIE SE DESACTIVA A SÍ MISMO.
    let aSiMismo = "";
    try {
      await desactivarPersona(db, admin, admin);
    } catch (err) {
      aSiMismo = err instanceof CambioDeRolesImposible ? err.message : "";
    }
    assert(aSiMismo.includes("a vos mismo"), "nadie se desactiva a sí mismo", aSiMismo);

    // EL ÚLTIMO ADMINISTRADOR NO SE VA.
    let ultimo = "";
    try {
      await desactivarPersona(db, admin, dobleRol);
    } catch (err) {
      ultimo = err instanceof CambioDeRolesImposible ? err.message : "";
    }
    assert(
      ultimo.includes("única persona con el rol de administrador"),
      "no se puede desactivar al último administrador",
      ultimo
    );
    // Ni quitarle el rol por la otra puerta.
    let porRoles = "";
    try {
      await asignarRoles(db, admin, ["recepcion"], dobleRol);
    } catch (err) {
      porRoles = err instanceof CambioDeRolesImposible ? err.message : "";
    }
    assert(
      porRoles.includes("única persona"),
      "ni quitarle el rol de administrador, que es la misma cosa por otra puerta",
      porRoles
    );

    const lista = await personasDeLaClinica(db);
    igual(lista.length, 5, "el listado trae a las cinco personas, activas e inactivas");
    assert(
      lista.some((p) => p.estado === "inactivo"),
      "incluida la desactivada, con su estado"
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== Las políticas ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // Sin configurar nada, el valor por omisión del catálogo.
    const sinNada = await politicaConOrigen(db, tenantId, "margen.minimo");
    igual(sinNada.valor, "20", "una política sin configurar devuelve su valor por omisión");
    igual(sinNada.origen, "por_omision", "y lo dice");

    // EL RESPALDO EN LA COLUMNA VIEJA. Esta clínica tiene
    // `vta_parametros` con 25, que es lo que el 08 guardaba.
    await db.query(
      `INSERT INTO vta_parametros (tenant_id, umbral_diferencia_arqueo, descuento_maximo_pct)
       VALUES ($1, 2000, 25)`,
      [tenantId]
    );
    olvidarPoliticas(tenantId);
    const conRespaldo = await politicaConOrigen(
      db,
      tenantId,
      "descuento.maximo_sin_autorizacion"
    );
    igual(
      conRespaldo.valor,
      "25.00",
      "con la columna vieja cargada, la política la respeta: ninguna clínica cambia de comportamiento el día del despliegue"
    );
    igual(conRespaldo.origen, "columna_anterior", "y dice de dónde salió");

    // Guardar la política gana sobre la columna vieja.
    await guardarPolitica(db, tenantId, {
      clave: "descuento.maximo_sin_autorizacion",
      valor: "12",
      personaId: admin,
    });
    const guardada = await politicaConOrigen(db, tenantId, "descuento.maximo_sin_autorizacion");
    igual(guardada.valor, "12", "guardarla gana sobre la columna vieja");
    igual(guardada.origen, "clinica", "y lo dice");

    // EL RANGO SE VALIDA.
    let fuera = "";
    try {
      await guardarPolitica(db, tenantId, {
        clave: "descuento.maximo_sin_autorizacion",
        valor: "400",
        personaId: admin,
      });
    } catch (err) {
      fuera = err instanceof PoliticaInvalida ? err.message : "";
    }
    assert(
      fuera.includes("no puede ser mayor"),
      "un descuento del 400 % se rechaza: es un dedo que se resbaló",
      fuera
    );

    // EL VALOR POR ROL.
    await guardarPolitica(db, tenantId, {
      clave: "descuento.maximo_sin_autorizacion",
      valor: "5",
      rol: "recepcion",
      personaId: admin,
    });
    igual(
      await politica(db, tenantId, "descuento.maximo_sin_autorizacion", "recepcion"),
      "5",
      "recepción tiene su propio tope"
    );
    igual(
      await politica(db, tenantId, "descuento.maximo_sin_autorizacion", "caja"),
      "12",
      "y un rol sin tope propio hereda el general de la clínica"
    );

    // Y LA CAJA LO RESPETA: es la prueba que pide el prompt.
    //
    // Con UN SOLO rol, el de su rol. `recepcion` ya tiene también el rol
    // de caja —se lo agregó el bloque anterior—, así que para esto hace
    // falta alguien que solo sea recepción.
    const soloRecepcion = await persona("Fran Solo Recepcion", ["recepcion"]);
    const tope = await topeDeDescuento(db, tenantId, { personaId: soloRecepcion });
    igual(tope.topePct, 5, "el tope que la caja aplica a recepción es el de la política");
    igual(tope.origen, "rol", "y viene de su rol");

    // CON VARIOS ROLES GANA EL MÁS PERMISIVO, y eso es una decisión, no
    // un descuido: tener un rol adicional no te puede quitar
    // capacidades. `recepcion` es además caja, y caja no tiene tope
    // propio —o sea, no limita—, así que rige el general de la clínica.
    const topeDoble = await topeDeDescuento(db, tenantId, { personaId: recepcion });
    igual(
      topeDoble.topePct,
      12,
      "quien es recepción Y caja descuenta hasta el general: su rol más permisivo manda"
    );
    igual(topeDoble.origen, "clinica", "y el origen lo dice");

    // Una política que no admite rol lo rechaza.
    let noPorRol = "";
    try {
      await guardarPolitica(db, tenantId, {
        clave: "margen.minimo",
        valor: "30",
        rol: "medico",
        personaId: admin,
      });
    } catch (err) {
      noPorRol = err instanceof PoliticaInvalida ? err.message : "";
    }
    assert(
      noPorRol.includes("no admite"),
      "el margen mínimo no se configura por rol: es de la clínica",
      noPorRol
    );

    // EL HISTORIAL.
    const h = await historialDePolitica(db, tenantId, "descuento.maximo_sin_autorizacion");
    assert(h.length >= 2, "el historial guarda cada cambio", `${h.length} cambios`);
    const ultimoCambio = h[0] as { valor_anterior: string; valor_nuevo: string; rol: string | null };
    igual(ultimoCambio.valor_nuevo, "5", "el último cambio es el del rol");
    igual(ultimoCambio.rol, "recepcion", "con su rol");
    const general = h.find((x) => (x as { rol: string | null }).rol === null) as {
      valor_anterior: string;
      valor_nuevo: string;
    };
    igual(general.valor_anterior, "25.00", "y guarda el valor ANTERIOR, que venía de la columna vieja");
    igual(general.valor_nuevo, "12", "y el nuevo");

    // EL HISTORIAL NO SE REESCRIBE.
    let appendOnly = false;
    await db.query("SAVEPOINT antes");
    try {
      await db.query(`UPDATE politicas_historial SET valor_nuevo = '99' WHERE tenant_id = $1`, [
        tenantId,
      ]);
      await db.query("RELEASE SAVEPOINT antes");
    } catch {
      appendOnly = true;
      await db.query("ROLLBACK TO SAVEPOINT antes");
    }
    assert(appendOnly, "el historial de políticas es solo de inserción");

    // La autonomía del agente nace en su valor más restrictivo.
    igual(
      await politica(db, tenantId, "agente.autonomia"),
      "solo_sugiere",
      "la autonomía del agente nace en «solo sugiere», que es lo más restrictivo"
    );

    // La política de anulación existe con su plazo.
    igual(
      await politica(db, tenantId, "anulacion.requiere_aprobacion"),
      "true",
      "las anulaciones requieren aprobación por omisión"
    );
    igual(
      await politicaNumero(db, tenantId, "anulacion.plazo_horas"),
      72,
      "y el plazo para pedirla nace en 72 horas"
    );
  });


  // -------------------------------------------------------------------
  console.log("\n=== El horario de la clínica, los feriados y la agenda ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // La clínica nace con horario de lunes a sábado: la migración lo
    // siembra para que la agenda tenga contra qué comparar desde el
    // primer día.
    const horario = await horarioDeLaClinica(db, tenantId);
    igual(horario.length, 7, "los siete días de la semana están configurados");
    igual(
      horario.find((h) => h.dia_semana === 0)?.abierto,
      false,
      "el domingo nace cerrado"
    );

    // Las fechas de la prueba: un lunes y el domingo siguiente, dentro
    // del año que la migración sembró con feriados.
    const lunes = "2026-12-07";
    const domingo = "2026-12-06";
    const navidad = "2026-12-25";

    const enHorario = await sePuedeAgendar(db, tenantId, {
      fecha: lunes,
      horaInicio: "10:00",
      duracionMinutos: 30,
    });
    assert(enHorario.permitido, "un lunes a las 10 se puede agendar", enHorario.motivo);

    const domingoCerrado = await sePuedeAgendar(db, tenantId, {
      fecha: domingo,
      horaInicio: "10:00",
      duracionMinutos: 30,
    });
    assert(!domingoCerrado.permitido, "el domingo no, porque la clínica no abre");
    igual(domingoCerrado.nivel, "clinica", "y el nivel que lo frenó es la clínica");

    // LA CITA QUE TERMINA CON LA CLÍNICA CERRADA TAMPOCO ENTRA. Es lo
    // que comparar solo la hora de inicio dejaría pasar.
    const seMeVaDeLargo = await sePuedeAgendar(db, tenantId, {
      fecha: lunes,
      horaInicio: "16:50",
      duracionMinutos: 30,
    });
    assert(
      !seMeVaDeLargo.permitido,
      "una cita de 30 minutos a las 16:50 con cierre a las 17:00 no entra",
      seMeVaDeLargo.motivo
    );
    const justoEntra = await sePuedeAgendar(db, tenantId, {
      fecha: lunes,
      horaInicio: "16:30",
      duracionMinutos: 30,
    });
    assert(justoEntra.permitido, "y la de 16:30 a 17:00 sí: termina justo al cierre");

    // EL FERIADO BLOQUEA.
    const esNavidad = await sePuedeAgendar(db, tenantId, {
      fecha: navidad,
      horaInicio: "10:00",
      duracionMinutos: 30,
    });
    assert(!esNavidad.permitido, "el 25 de diciembre está bloqueado por feriado");
    igual(esNavidad.nivel, "excepcion", "y el nivel es la excepción");
    assert(
      (esNavidad.motivo ?? "").includes("Navidad"),
      "con el nombre del feriado, no un «no se puede»",
      esNavidad.motivo
    );

    // UN FERIADO QUE LA CLÍNICA TRABAJA no bloquea: se deja la fila
    // para que se vea en el calendario.
    await db.query(
      `UPDATE clinica_excepciones SET bloquea = false
        WHERE tenant_id = $1 AND desde = $2::date AND tipo = 'feriado'`,
      [tenantId, navidad]
    );
    const navidadTrabajada = await sePuedeAgendar(db, tenantId, {
      fecha: navidad,
      horaInicio: "10:00",
      duracionMinutos: 30,
    });
    assert(
      navidadTrabajada.permitido,
      "un feriado marcado como trabajado deja de bloquear: hay clínicas que abren"
    );

    // LAS VACACIONES DE UN MÉDICO son suyas y no de la clínica.
    await guardarExcepcion(db, tenantId, {
      tipo: "vacaciones",
      nombre: "Vacaciones de la Dra.",
      desde: lunes,
      hasta: lunes,
      medicoId: admin,
    });
    const deVacaciones = await sePuedeAgendar(db, tenantId, {
      fecha: lunes,
      horaInicio: "10:00",
      duracionMinutos: 30,
      medicoId: admin,
    });
    assert(!deVacaciones.permitido, "con ese médico de vacaciones, no se puede");
    const otroMedico = await sePuedeAgendar(db, tenantId, {
      fecha: lunes,
      horaInicio: "10:00",
      duracionMinutos: 30,
      medicoId: dobleRol,
    });
    assert(
      otroMedico.permitido,
      "y con otro médico sí: las vacaciones de uno no cierran la clínica"
    );

    // UN BLOQUEO DE UNAS HORAS bloquea solo esas horas.
    await guardarExcepcion(db, tenantId, {
      tipo: "bloqueo",
      nombre: "Reunión de equipo",
      desde: lunes,
      hasta: lunes,
      horaDesde: "12:00",
      horaHasta: "13:00",
    });
    const enLaReunion = await sePuedeAgendar(db, tenantId, {
      fecha: lunes,
      horaInicio: "12:30",
      duracionMinutos: 30,
    });
    assert(!enLaReunion.permitido, "durante el bloqueo de unas horas no se puede");
    const despues = await sePuedeAgendar(db, tenantId, {
      fecha: lunes,
      horaInicio: "13:00",
      duracionMinutos: 30,
    });
    assert(despues.permitido, "y justo después sí: el bloqueo es de 12 a 13");

    // EL HORARIO SE EDITA y la agenda lo respeta.
    await guardarHorarioDelDia(db, tenantId, {
      diaSemana: 0,
      bloques: [{ desde: "09:00", hasta: "12:00" }],
      abierto: true,
    });
    const domingoAbierto = await sePuedeAgendar(db, tenantId, {
      fecha: domingo,
      horaInicio: "10:00",
      duracionMinutos: 30,
    });
    assert(
      domingoAbierto.permitido,
      "abriendo el domingo de 9 a 12, el domingo a las 10 se puede agendar"
    );

    // Un bloque al revés se rechaza.
    let alReves = "";
    try {
      await guardarHorarioDelDia(db, tenantId, {
        diaSemana: 2,
        bloques: [{ desde: "18:00", hasta: "08:00" }],
        abierto: true,
      });
    } catch (err) {
      alReves = err instanceof Error ? err.message : "";
    }
    assert(
      alReves.includes("termina antes de empezar"),
      "un bloque de 18:00 a 08:00 se rechaza",
      alReves
    );
  });


  // -------------------------------------------------------------------
  console.log("\n=== La guarda de las rutas, y la del fuera de horario ===");
  // -------------------------------------------------------------------
  //
  // LAS RUTAS NO SE PRUEBAN POR HTTP ACÁ y hay que decirlo: cada rol
  // necesitaría su usuario real en Keycloak y su token. Lo que se prueba
  // es la guarda `exigirPermiso` —la función que TODAS las rutas usan
  // ahora— con un `req` armado a mano, que es exactamente lo que el
  // middleware recibe. La cadena que queda sin cubrir es
  // «token → resolverPrincipal → req.auth», y esa sí se probó a mano con
  // un token real (queda en el informe).
  {
    const comoPedido = (permisos: Set<string>, cuerpo: Record<string, unknown> = {}) =>
      ({ auth: { userId: admin, permisos }, body: cuerpo }) as never;

    // Un `res` de mentira que anota con qué contestaron.
    function resFalso() {
      const anotado: { estado?: number; cuerpo?: Record<string, unknown> } = {};
      const res = {
        status(n: number) {
          anotado.estado = n;
          return res;
        },
        json(c: Record<string, unknown>) {
          anotado.cuerpo = c;
          return res;
        },
      };
      return { res: res as never, anotado };
    }

    const guarda = exigirPermiso("caja.anular");

    let siguio = false;
    const permitida = resFalso();
    await guarda(comoPedido(pAdmin.permisos), permitida.res, () => {
      siguio = true;
    });
    assert(siguio, "con el permiso, la guarda deja pasar y no contesta nada");
    igual(permitida.anotado.estado, undefined, "y no toca la respuesta");

    siguio = false;
    const negada = resFalso();
    await guarda(comoPedido(pRecepcion.permisos), negada.res, () => {
      siguio = true;
    });
    assert(!siguio, "recepción no pasa la guarda de anular");
    igual(negada.anotado.estado, 403, "y recibe 403");
    assert(
      String(negada.anotado.cuerpo?.error ?? "").includes("Anular cobros y comprobantes"),
      "el mensaje dice QUÉ permiso falta, con su nombre, no «no autorizado»",
      negada.anotado.cuerpo?.error
    );
    igual(
      negada.anotado.cuerpo?.permisoFaltante,
      "caja.anular",
      "y el código, para que la pantalla pueda pedirlo"
    );

    // Sin sesión, 401 y no 403: no es que no pueda, es que no sabemos
    // quién es.
    const sinSesion = resFalso();
    await guarda({ body: {} } as never, sinSesion.res, () => {});
    igual(sinSesion.anotado.estado, 401, "sin sesión, 401");

    // --- El fuera de horario ---
    const sinNada = autorizarFueraDeHorario(comoPedido(pRecepcion.permisos), {
      pacienteId: "x",
      medicoId: "y",
      fecha: "2026-12-07",
      horaInicio: "10:00",
      duracionMinutos: 30,
    });
    igual(sinNada, null, "sin pedir excepción, no hay nada que autorizar");

    const cuerpo = {
      pacienteId: "x",
      medicoId: "y",
      fecha: "2026-12-07",
      horaInicio: "20:00",
      duracionMinutos: 30,
    };
    const sinPermiso = autorizarFueraDeHorario(
      comoPedido(pRecepcion.permisos, { forzarFueraDeHorario: { motivo: "el cliente viaja" } }),
      { ...cuerpo }
    );
    igual(sinPermiso?.estado, 403, "recepción no puede citar fuera de horario");
    igual(
      sinPermiso?.cuerpo.permisoFaltante,
      "agenda.sobrecarga",
      "y se le dice qué permiso le falta"
    );

    const sinMotivo = autorizarFueraDeHorario(
      comoPedido(pAdmin.permisos, { forzarFueraDeHorario: { motivo: "  " } }),
      { ...cuerpo }
    );
    igual(sinMotivo?.estado, 400, "con permiso pero sin motivo, tampoco: el motivo se registra");

    const conTodo = { ...cuerpo } as Record<string, unknown>;
    const autorizado = autorizarFueraDeHorario(
      comoPedido(pAdmin.permisos, { forzarFueraDeHorario: { motivo: "control posoperatorio" } }),
      conTodo as never
    );
    igual(autorizado, null, "con permiso y motivo, se puede seguir");
    igual(
      (conTodo.fueraDeHorario as { autorizadoPor: string; motivo: string })?.motivo,
      "control posoperatorio",
      "y la cita queda con quién autorizó y por qué"
    );
    igual(
      (conTodo.fueraDeHorario as { autorizadoPor: string })?.autorizadoPor,
      admin,
      "autorizada por quien estaba logueado, no por quien diga el cuerpo"
    );
  }

  // -------------------------------------------------------------------
  console.log("\n=== La invitación con roles, y el cupo que es de médicos ===");
  // -------------------------------------------------------------------
  {
    const antes = await contarInvitacionesPendientes(pool, tenantId);

    // Invitar a la recepción NO consume cupo de médico: el plan se cobra
    // por médico. Antes del 04 toda invitación era de médico y contarlas
    // todas daba igual.
    const recep = await crearInvitacion(
      pool,
      tenantId,
      "Clínica de prueba",
      admin,
      `${PREFIJO}-recep@probe.test`,
      "Caro Recepción",
      ["recepcion"]
    );
    assert(recep.ok, "se puede invitar a alguien que no es médico");
    igual(
      await contarInvitacionesPendientes(pool, tenantId),
      antes,
      "y no consume cupo de médicos"
    );
    assert(!invitaAUnMedico(["recepcion", "caja"]), "recepción y caja no es un médico");
    assert(invitaAUnMedico(["medico", "admin_clinica"]), "médico y administrador sí lo es");

    const med = await crearInvitacion(
      pool,
      tenantId,
      "Clínica de prueba",
      admin,
      `${PREFIJO}-med@probe.test`,
      "Fer Médico",
      ["medico"]
    );
    assert(med.ok, "y se puede invitar a un médico");
    igual(
      await contarInvitacionesPendientes(pool, tenantId),
      antes + 1,
      "esa sí reserva un cupo"
    );
    igual(med.ok && med.invitacion.roles, ["medico"], "la invitación guarda sus roles");

    // Un rol que no existe se rechaza en la base: un array con
    // 'recepcionista' dejaría a la persona sin permisos al aceptar, y eso
    // se descubre cuando ya entró.
    let rolInventado = "";
    try {
      await pool.query(
        `INSERT INTO invitaciones_medico (tenant_id, email, invitado_por, vence_en, roles)
         VALUES ($1,$2,$3, now() + interval '7 days', ARRAY['recepcionista']::varchar[])`,
        [tenantId, `${PREFIJO}-malo@probe.test`, admin]
      );
    } catch (err) {
      rolInventado = err instanceof Error ? err.message : "";
    }
    assert(
      rolInventado.includes("invitaciones_medico_roles_check"),
      "un rol que no existe se rechaza en la base",
      rolInventado
    );
  }

  // -------------------------------------------------------------------
  console.log("\n=== Los tipos de cita y las numeraciones ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // La clínica nace con los dos sembrados por el disparador de la 145.
    const tipos = await tiposDeCita(db, tenantId);
    assert(tipos.length >= 6, "la clínica nace con sus tipos de cita", tipos.length);
    assert(
      tipos.some((t) => t.nombre === "Consulta general" && t.duracion_minutos === 30),
      "«Consulta general» de 30 minutos entre ellos"
    );

    const nums = await numeraciones(db, tenantId);
    igual(nums.length, 4, "y con las cuatro numeraciones");
    igual(
      nums.find((n) => n.documento === "expediente")?.prefijo,
      "EXP-",
      "el expediente con su prefijo"
    );

    await guardarNumeracion(db, tenantId, { documento: "recibo", prefijo: "CAJA-", digitos: 6 });
    const cambiada = (await numeraciones(db, tenantId)).find((n) => n.documento === "recibo");
    igual(cambiada?.prefijo, "CAJA-", "el prefijo se cambia");
    igual(cambiada?.digitos, 6, "y los dígitos");

    let digitosLocos = "";
    try {
      await guardarNumeracion(db, tenantId, { documento: "recibo", digitos: 40 });
    } catch (err) {
      digitosLocos = err instanceof Error ? err.message : "";
    }
    assert(digitosLocos.includes("1 a 12"), "40 dígitos se rechaza", digitosLocos);
  });

  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS"}`);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = ok ? 0 : 1;
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
});
