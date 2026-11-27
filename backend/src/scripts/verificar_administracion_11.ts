// Verificación del prompt 11 (administración completa).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_administracion_11.ts
//
// SIN --transpile-only. Re-corrible: borra su clínica de prueba al
// empezar.
//
// Los escenarios son los que pide el prompt:
//
//   * la familia «Antiparasitarios» con sus productos, y el filtro;
//   * un kit con tres componentes que al venderse descuenta los tres;
//   * un consentimiento en PDF desde el expediente, con sus variables;
//   * turnos de una semana copiados a la siguiente, y unas vacaciones
//     que bloquean la agenda;
//   * una comisión del 10 % sobre cirugías, dos cirugías cobradas, la
//     liquidación aprobada, y una anulación posterior que deja su ajuste
//     en el período siguiente;
//   * el permiso sanitario con su vencimiento y su aviso;
//   * la entrada y la salida por paciente de un controlado, y el cierre
//     firmado por el regente;
//   * buscar en la auditoría quién anuló un cobro.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import {
  alternarActivo,
  CATALOGOS,
  guardar as guardarItem,
  listar as listarCatalogo,
  revisarImportacion,
} from "../clinica/catalogos";
import {
  ausencias,
  copiarSemana,
  credenciales,
  guardarCredencial,
  guardarTurno,
  horasParaPlanilla,
  pedirAusencia,
  porVencer,
  resolverAusencia,
  tieneTurno,
  turnos,
} from "../clinica/personal";
import {
  ajustesPendientes,
  aplicarAjustesPendientes,
  aprobar,
  generarBorrador,
  guardarRegla,
  detalleDeLiquidacion,
} from "../clinica/comisiones";
import {
  cerrarLibro,
  cierresDeControlados,
  guardarPermiso,
  libroDeControlados,
  permisos as permisosDeCumplimiento,
  registrarDesecho,
  saldosDeControlados,
} from "../clinica/cumplimiento";
import { eventos } from "../clinica/auditoria";
import {
  confirmarLectura,
  generarPdf,
  guardarPlantilla,
  guardarProcedimiento,
  procedimientos,
  reemplazar,
  valoresDe,
  variablesDesconocidas,
} from "../clinica/documentosClinicos";
import { sePuedeAgendar } from "../clinica/horarios";

const PREFIJO = "probe-11";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}
function cerca(obtenido: number, esperado: number, msg: string) {
  assert(Math.abs(obtenido - esperado) < 0.02, msg, { obtenido, esperado });
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_administracion_11");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@11.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  const persona = async (nombre: string, medico: boolean, admin: boolean, colegiatura?: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico,
                               es_admin_clinica, colegiatura, estado)
         VALUES ($1,$2,$3,'x',$4,$5,$6,'activo') RETURNING id`,
        [
          tenantId,
          nombre,
          `${PREFIJO}-${nombre.toLowerCase().replace(/\s/g, "")}@probe.test`,
          medico,
          admin,
          colegiatura ?? null,
        ]
      )
    ).rows[0].id;

  const admin = await persona("Ana Admin", false, true);
  const cirujana = await persona("Bea Cirujana", true, false, "VET-1101");
  const regente = await persona("Caro Regente", true, false, "VET-1102");

  // -------------------------------------------------------------------
  console.log("\n=== Los catálogos: lo que se enlaza y lo que se edita ===");
  // -------------------------------------------------------------------
  let familiaAntiparasitarios = "";
  await conAlcanceTenant(tenantId, async (db) => {
    const editables = CATALOGOS.filter((c) => c.donde === "aqui").length;
    const enlazados = CATALOGOS.filter((c) => c.donde !== "aqui").length;
    assert(enlazados >= 12, "la mayoría de los catálogos se ENLAZAN, no se copian", {
      enlazados,
      editables,
    });

    // La clínica nace con los catálogos clínicos del 11 sembrados.
    const motivos = await listarCatalogo(db, tenantId, "motivo_consulta");
    assert(motivos.length >= 9, "los motivos de consulta vienen sembrados", motivos.length);
    const cortes = await listarCatalogo(db, tenantId, "corte_grooming");
    assert(cortes.length >= 5, "y los tipos de corte también", cortes.length);
    const unidades = await listarCatalogo(db, tenantId, "unidades");
    assert(unidades.length >= 7, "las unidades base también", unidades.length);
    const tiposCliente = await listarCatalogo(db, tenantId, "tipos_cliente");
    assert(tiposCliente.length >= 4, "y los tipos de cliente", tiposCliente.length);

    const f = await guardarItem(db, tenantId, "familias", { nombre: "Antiparasitarios" });
    familiaAntiparasitarios = f.id;
    const sub = await guardarItem(db, tenantId, "familias", {
      nombre: "Antiparasitarios internos",
      padreId: f.id,
    });
    const familias = await listarCatalogo(db, tenantId, "familias");
    igual(
      familias.find((x) => x.id === sub.id)?.padre_id,
      f.id,
      "la subfamilia cuelga de su familia: es la misma tabla"
    );

    // DESACTIVAR, NO BORRAR.
    await alternarActivo(db, tenantId, "familias", sub.id, false);
    const activas = await listarCatalogo(db, tenantId, "familias");
    assert(
      !activas.some((x) => x.id === sub.id),
      "una familia desactivada desaparece de la lista normal"
    );
    const todas = await listarCatalogo(db, tenantId, "familias", true);
    assert(todas.some((x) => x.id === sub.id), "pero sigue existiendo: se desactiva, no se borra");

    // Un catálogo que se enlaza NO se puede editar desde acá.
    let enlazado = "";
    try {
      await guardarItem(db, tenantId, "bodegas", { nombre: "Inventada" });
    } catch (err) {
      enlazado = err instanceof Error ? err.message : "";
    }
    assert(
      enlazado.includes("no es un catálogo que se edite acá"),
      "las bodegas no se editan desde Catálogos: se enlazan a su módulo",
      enlazado
    );
  });

  // --- La importación, fila por fila ---
  {
    const { validas, conError } = revisarImportacion([
      { nombre: "Bayer", orden: 10 },
      { nombre: "", orden: 20 },
      { nombre: "Zoetis", orden: "no es un número" },
      { nombre: "Bayer" },
    ]);
    igual(validas.length, 1, "de cuatro filas, una sola es válida");
    igual(conError.length, 3, "y las otras tres traen su error");
    igual(conError[0].fila, 3, "la fila se cuenta como en la planilla: la 1 es el encabezado");
    assert(
      conError[0].error?.includes("Sin nombre") === true,
      "la vacía dice qué le falta",
      conError[0].error
    );
    assert(
      conError[2].error?.includes("Repetido") === true,
      "y la repetida también",
      conError[2].error
    );
  }

  // -------------------------------------------------------------------
  console.log("\n=== El producto con su familia, y el kit con sus componentes ===");
  // -------------------------------------------------------------------
  let kitId = "";
  const presentaciones: string[] = [];
  await conAlcanceTenant(tenantId, async (db) => {
    const bodega = await db.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,'PRINCIPAL','Bodega principal',true) RETURNING id`,
      [tenantId]
    );

    const producto = async (nombre: string, familia?: string) => {
      const p = await db.query<{ id: string }>(
        `INSERT INTO inv_productos
           (tenant_id, codigo, nombre, unidad_base, familia_id, linea_negocio)
         VALUES ($1,$2,$3,'unidad',$4,'farmacia') RETURNING id`,
        [tenantId, `${PREFIJO}-${nombre.slice(0, 10)}`, nombre, familia ?? null]
      );
      const pr = await db.query<{ id: string }>(
        `INSERT INTO inv_presentaciones
           (tenant_id, producto_id, nombre, factor, unidad_medida, para_venta, codigo_interno)
         VALUES ($1,$2,'Unidad',1,'Unid',true,$3) RETURNING id`,
        [tenantId, p.rows[0].id, `${PREFIJO}-${nombre.slice(0, 8)}-U`]
      );
      return { producto: p.rows[0].id, presentacion: pr.rows[0].id };
    };

    const pipeta = await producto("Pipeta antipulgas", familiaAntiparasitarios);
    const desparasitante = await producto("Desparasitante oral", familiaAntiparasitarios);
    const shampoo = await producto("Shampoo medicado");
    presentaciones.push(pipeta.presentacion, desparasitante.presentacion, shampoo.presentacion);

    // EL FILTRO POR FAMILIA, que es lo que la categoría en texto libre
    // no permitía.
    const porFamilia = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM inv_productos WHERE tenant_id = $1 AND familia_id = $2`,
      [tenantId, familiaAntiparasitarios]
    );
    igual(porFamilia.rows[0].n, 2, "dos productos quedan en «Antiparasitarios» y se pueden filtrar");

    // EL KIT.
    const kit = await producto("Kit antiparasitario");
    kitId = kit.producto;
    for (const pr of [pipeta.presentacion, desparasitante.presentacion, shampoo.presentacion]) {
      await db.query(
        `INSERT INTO inv_producto_componentes
           (tenant_id, producto_id, componente_presentacion_id, cantidad)
         VALUES ($1,$2,$3,1)`,
        [tenantId, kitId, pr]
      );
    }
    const comp = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM inv_producto_componentes WHERE producto_id = $1`,
      [kitId]
    );
    igual(comp.rows[0].n, 3, "el kit lleva sus tres componentes");

    // UN KIT NO SE CONTIENE A SÍ MISMO.
    await db.query("SAVEPOINT ciclo");
    let ciclo = "";
    try {
      const kitPres = await db.query<{ id: string }>(
        `INSERT INTO inv_presentaciones
           (tenant_id, producto_id, nombre, factor, unidad_medida, para_venta, codigo_interno)
         VALUES ($1,$2,'Kit',1,'Unid',true,$3) RETURNING id`,
        [tenantId, kitId, `${PREFIJO}-kit-U`]
      );
      await db.query(
        `INSERT INTO inv_producto_componentes
           (tenant_id, producto_id, componente_presentacion_id, cantidad)
         VALUES ($1,$2,$3,1)`,
        [tenantId, kitId, kitPres.rows[0].id]
      );
    } catch (err) {
      ciclo = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT ciclo");
    assert(
      ciclo.includes("no puede contenerse"),
      "un kit que se contiene a sí mismo lo rechaza la base",
      ciclo
    );

    // Las imágenes del producto.
    await db.query(
      `INSERT INTO inv_producto_imagenes (tenant_id, producto_id, clave, principal, subido_por)
       VALUES ($1,$2,'productos/pipeta.jpg',true,$3)`,
      [tenantId, pipeta.producto, admin]
    );
    await db.query("SAVEPOINT dos_principales");
    let dosPrincipales = "";
    try {
      await db.query(
        `INSERT INTO inv_producto_imagenes (tenant_id, producto_id, clave, principal)
         VALUES ($1,$2,'productos/pipeta-2.jpg',true)`,
        [tenantId, pipeta.producto]
      );
    } catch (err) {
      dosPrincipales = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT dos_principales");
    assert(
      dosPrincipales.length > 0,
      "un producto no puede tener dos imágenes principales: la venta mostraría una distinta cada vez"
    );
    void bodega;
  });

  // -------------------------------------------------------------------
  console.log("\n=== El consentimiento en PDF, con sus variables ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const dueno = await db.query<{ id: string }>(
      // El tipo y el número de identificación van juntos o no van: lo
      // dice un CHECK del anexo 07-03.
      `INSERT INTO propietarios
         (tenant_id, nombre, telefono, tipo_identificacion_id, numero_identificacion)
       VALUES ($1,'Marta Solano','88887777',
               (SELECT id FROM tipos_identificacion LIMIT 1),'112340567') RETURNING id`,
      [tenantId]
    );
    const paciente = await db.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, sexo,
                              numero_expediente, microchip)
       VALUES ($1,$2,'Luna','perro','hembra',911001,'900123456789012') RETURNING id`,
      [tenantId, dueno.rows[0].id]
    );

    const pl = await guardarPlantilla(db, tenantId, {
      tipo: "consentimiento",
      titulo: "Consentimiento para cirugía",
      cuerpo:
        "Yo, {{cliente}}, identificación {{identificacion}}, autorizo al equipo de {{clinica}} " +
        "a realizar el procedimiento quirúrgico a mi paciente {{paciente}} ({{especie}}, {{sexo}}), " +
        "expediente {{expediente}}.\n\n" +
        "Declaro que se me explicaron los riesgos. {{inventada}}",
    });
    igual(
      pl.variablesDesconocidas,
      ["inventada"],
      "la plantilla avisa qué variable no existe en vez de imprimirla vacía"
    );
    igual(
      variablesDesconocidas("Hola {{paciente}} de {{clinica}}"),
      [],
      "y con variables conocidas no se queja"
    );

    const valores = await valoresDe(db, tenantId, {
      pacienteId: paciente.rows[0].id,
      medicoId: cirujana,
    });
    igual(valores.paciente, "Luna", "los valores salen del paciente real");
    igual(valores.cliente, "Marta Solano", "y de su dueño");
    igual(valores.colegiatura, "VET-1101", "y la colegiatura del médico");
    igual(valores.peso, "", "lo que no se sabe queda VACÍO, no inventado");

    const texto = reemplazar("Autorizo para {{paciente}} de {{cliente}}. {{inventada}}", valores);
    assert(
      texto.includes("Autorizo para Luna de Marta Solano"),
      "el reemplazo pone los valores",
      texto
    );
    assert(
      texto.includes("{{inventada}}"),
      "y la variable desconocida se deja a la vista: quien imprime ve que falta algo"
    );

    const pdf = await generarPdf(db, tenantId, {
      plantillaId: pl.id,
      pacienteId: paciente.rows[0].id,
      medicoId: cirujana,
    });
    assert(pdf.buffer.length > 1000, "el PDF se genera y tiene contenido", pdf.buffer.length);
    assert(
      pdf.buffer.subarray(0, 5).toString() === "%PDF-",
      "y es un PDF de verdad, no un archivo con nombre de PDF"
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== Turnos, ausencias y credenciales ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const lunes = "2026-12-07";
    const lunesSiguiente = "2026-12-14";

    for (const dia of [0, 1, 2]) {
      const fecha = (
        await db.query<{ f: string }>(`SELECT ($1::date + $2::int)::text AS f`, [lunes, dia])
      ).rows[0].f;
      await guardarTurno(db, tenantId, {
        personaId: cirujana,
        fecha,
        horaDesde: "08:00",
        horaHasta: "13:00",
        personaQueRegistra: admin,
      });
    }
    const semana = await turnos(db, tenantId, lunes, "2026-12-13");
    igual(semana.length, 3, "la semana tiene sus tres turnos");

    const copia = await copiarSemana(db, tenantId, {
      desdeLunes: lunes,
      haciaLunes: lunesSiguiente,
      personaQueRegistra: admin,
    });
    igual(copia.copiados, 3, "se copian a la semana siguiente");
    const siguiente = await turnos(db, tenantId, lunesSiguiente, "2026-12-20");
    igual(siguiente.length, 3, "y ahí están");
    igual(siguiente[0].hora_desde.slice(0, 5), "08:00", "con su hora");

    // Copiar dos veces no duplica.
    await copiarSemana(db, tenantId, {
      desdeLunes: lunes,
      haciaLunes: lunesSiguiente,
      personaQueRegistra: admin,
    });
    igual(
      (await turnos(db, tenantId, lunesSiguiente, "2026-12-20")).length,
      3,
      "copiar dos veces no duplica los turnos"
    );

    // EL TURNO AVISA, NO PROHÍBE.
    const dentro = await tieneTurno(db, tenantId, {
      personaId: cirujana,
      fecha: lunes,
      horaInicio: "09:00",
      horaFin: "09:30",
    });
    assert(dentro.hayTurnos && dentro.dentro, "a las 9 está en su turno");
    const fuera = await tieneTurno(db, tenantId, {
      personaId: cirujana,
      fecha: lunes,
      horaInicio: "16:00",
      horaFin: "16:30",
    });
    assert(fuera.hayTurnos && !fuera.dentro, "a las 16 no, y la agenda lo puede avisar");
    const sinTurnos = await tieneTurno(db, tenantId, {
      personaId: regente,
      fecha: lunes,
      horaInicio: "09:00",
      horaFin: "09:30",
    });
    assert(
      !sinTurnos.hayTurnos && sinTurnos.dentro,
      "una clínica que no usa turnos no ve ningún aviso"
    );

    // --- LA AUSENCIA ---
    const vac = await pedirAusencia(db, tenantId, {
      personaId: cirujana,
      tipo: "vacaciones",
      desde: lunesSiguiente,
      hasta: "2026-12-20",
      solicitadaPor: cirujana,
      aprobarYa: false,
    });
    assert(vac.id.length > 0, "la médica pide sus vacaciones");

    // PEDIRLAS NO BLOQUEA LA AGENDA.
    const antesDeAprobar = await sePuedeAgendar(db, tenantId, {
      fecha: lunesSiguiente,
      horaInicio: "09:00",
      duracionMinutos: 30,
      medicoId: cirujana,
    });
    assert(
      antesDeAprobar.permitido,
      "pedir vacaciones NO cierra la agenda: todavía nadie las aprobó"
    );

    await resolverAusencia(db, tenantId, { id: vac.id, aprobar: true, personaId: admin });
    const despues = await sePuedeAgendar(db, tenantId, {
      fecha: lunesSiguiente,
      horaInicio: "09:00",
      duracionMinutos: 30,
      medicoId: cirujana,
    });
    assert(!despues.permitido, "aprobadas, la agenda ya no deja citarla");
    assert(
      (despues.motivo ?? "").includes("Vacaciones"),
      "con el motivo que se lee",
      despues.motivo
    );

    const lista = await ausencias(db, tenantId);
    igual(lista.length, 1, "la ausencia aparece en la lista");
    igual(lista[0].estado, "aprobada", "ya aprobada");

    // --- CREDENCIALES ---
    await guardarCredencial(db, tenantId, {
      personaId: cirujana,
      tipo: "Colegiatura",
      numero: "VET-1101",
      venceEl: (
        await db.query<{ f: string }>(`SELECT (CURRENT_DATE + 20)::text AS f`)
      ).rows[0].f,
    });
    await guardarCredencial(db, tenantId, {
      personaId: regente,
      tipo: "Regencia",
      numero: "REG-77",
      venceEl: (
        await db.query<{ f: string }>(`SELECT (CURRENT_DATE + 200)::text AS f`)
      ).rows[0].f,
    });
    const cred = await credenciales(db, tenantId);
    igual(cred.length, 2, "las dos credenciales quedan cargadas");

    const avisos = await porVencer(db, tenantId, 30);
    assert(
      avisos.some((a) => a.titulo === "Colegiatura" && a.clase === "credencial"),
      "la que vence en 20 días aparece en el aviso de 30"
    );
    assert(
      !avisos.some((a) => a.titulo === "Regencia"),
      "y la que vence en 200 días no"
    );

    // --- LAS HORAS PARA EL CONTADOR ---
    const planilla = await horasParaPlanilla(db, tenantId, lunes, "2026-12-13");
    const deLaCirujana = planilla.find((p) => p.persona === "Bea Cirujana");
    cerca(Number(deLaCirujana?.horas_turno), 15, "tres turnos de cinco horas son quince horas");
    igual(deLaCirujana?.dias, 3, "en tres días");
  });

  // -------------------------------------------------------------------
  console.log("\n=== Comisiones: regla, liquidación, aprobación y ajuste ===");
  // -------------------------------------------------------------------
  let liquidacionId = "";
  let cargoAnulable = "";
  await conAlcanceTenant(tenantId, async (db) => {
    const servicio = await db.query<{ id: string }>(
      `INSERT INTO inv_servicios (tenant_id, codigo, nombre, linea_negocio)
       VALUES ($1,$2,'Cirugía de rutina','cirugia') RETURNING id`,
      [tenantId, `${PREFIJO}-CIR`]
    );

    // 10 % sobre cirugías para la cirujana; 5 % general, para comprobar
    // que gana la más específica.
    await guardarRegla(db, tenantId, {
      personaId: cirujana,
      servicioId: servicio.rows[0].id,
      tipo: "porcentaje",
      valor: 10,
      base: "cobrado",
      personaQueRegistra: admin,
    });
    await guardarRegla(db, tenantId, {
      tipo: "porcentaje",
      valor: 5,
      base: "cobrado",
      personaQueRegistra: admin,
    });

    // Dos cirugías cobradas.
    const caja = await db.query<{ id: string }>(
      `INSERT INTO vta_cajas (tenant_id, nombre, bodega_id)
       VALUES ($1,'Caja 1',(SELECT id FROM inv_bodegas WHERE tenant_id = $1 LIMIT 1))
       RETURNING id`,
      [tenantId]
    );
    const sesion = await db.query<{ id: string }>(
      `INSERT INTO vta_sesiones_caja (tenant_id, caja_id, estado, abierta_por, fondo_crc)
       VALUES ($1,$2,'abierta',$3,0) RETURNING id`,
      [tenantId, caja.rows[0].id, admin]
    );

    const cobrarCirugia = async (numero: number, monto: number) => {
      const cuenta = await db.query<{ id: string }>(
        `INSERT INTO vta_cuentas (tenant_id, numero, cliente_nombre, estado, sesion_id)
         VALUES ($1,$2,'Cliente de prueba','abierta',$3) RETURNING id`,
        [tenantId, 92000 + numero, sesion.rows[0].id]
      );
      const cargo = await db.query<{ id: string }>(
        `INSERT INTO vta_cargos
           (tenant_id, cuenta_id, origen, servicio_id, descripcion, cantidad, precio_unitario,
            linea_negocio, realizado_por)
         VALUES ($1,$2,'manual',$3,'Cirugía de rutina',1,$4,'cirugia',$5)
         RETURNING id`,
        [tenantId, cuenta.rows[0].id, servicio.rows[0].id, monto, cirujana]
      );
      const cobro = await db.query<{ id: string }>(
        `INSERT INTO vta_cobros (tenant_id, cuenta_id, sesion_id, cobrado_por, total, estado)
         VALUES ($1,$2,$3,$4,$5,'aplicado') RETURNING id`,
        [tenantId, cuenta.rows[0].id, sesion.rows[0].id, admin, monto]
      );
      await db.query(
        `INSERT INTO vta_cobro_medios
           (tenant_id, cobro_id, medio, es_fiscal, moneda, monto, tipo_cambio, monto_crc)
         VALUES ($1,$2,'efectivo',true,'CRC',$3,1,$3)`,
        [tenantId, cobro.rows[0].id, monto]
      );
      return cargo.rows[0].id;
    };

    const cargo1 = await cobrarCirugia(1, 100000);
    cargoAnulable = await cobrarCirugia(2, 60000);

    const borrador = await generarBorrador(db, tenantId, {
      personaId: cirujana,
      desde: "2026-11-01",
      hasta: "2026-12-31",
      personaQueGenera: admin,
    });
    liquidacionId = borrador.id;
    igual(borrador.lineas, 2, "el borrador trae las dos cirugías");
    // 10 % de 160 000, sin IVA: los cargos de prueba no llevan tarifa,
    // así que el neto es el total.
    cerca(borrador.total, 16000, "y el 10 % de las dos: gana la regla específica, no el 5 %");

    const detalle = await detalleDeLiquidacion(db, tenantId, liquidacionId);
    igual(detalle.lineas.length, 2, "con una línea por cargo, para poder revisarlas");
    igual(detalle.lineas[0].porcentaje, "10.00", "y cada una dice con qué porcentaje salió");

    // Regenerar no duplica.
    const otraVez = await generarBorrador(db, tenantId, {
      personaId: cirujana,
      desde: "2026-11-01",
      hasta: "2026-12-31",
      personaQueGenera: admin,
    });
    cerca(otraVez.total, 16000, "regenerar el borrador da lo mismo, no el doble");

    await aprobar(db, tenantId, { liquidacionId, personaId: admin });
    const aprobada = await detalleDeLiquidacion(db, tenantId, liquidacionId);
    igual(aprobada.liquidacion.estado, "aprobada", "la liquidación queda aprobada");

    // UNA LIQUIDACIÓN APROBADA NO SE TOCA.
    await db.query("SAVEPOINT tocar_aprobada");
    let tocada = "";
    try {
      await db.query(
        `INSERT INTO com_liquidacion_lineas
           (tenant_id, liquidacion_id, descripcion, base, monto)
         VALUES ($1,$2,'Colado',0,999)`,
        [tenantId, liquidacionId]
      );
    } catch (err) {
      tocada = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT tocar_aprobada");
    assert(
      tocada.includes("ya está aprobada"),
      "no se le puede agregar una línea a una liquidación aprobada",
      tocada
    );

    await db.query("SAVEPOINT volver_a_borrador");
    let volvio = "";
    try {
      await db.query(`UPDATE com_liquidaciones SET estado = 'borrador' WHERE id = $1`, [
        liquidacionId,
      ]);
    } catch (err) {
      volvio = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT volver_a_borrador");
    assert(volvio.includes("no vuelve a borrador"), "ni volver a borrador", volvio);

    void cargo1;
  });

  // --- LA ANULACIÓN POSTERIOR Y SU AJUSTE ---
  await conAlcanceTenant(tenantId, async (db) => {
    await db.query(`UPDATE vta_cargos SET anulado_en = now() WHERE id = $1`, [cargoAnulable]);

    const pendientes = await ajustesPendientes(db, tenantId, cirujana);
    igual(pendientes.length, 1, "la cirugía anulada después del cierre deja un ajuste pendiente");
    cerca(Number(pendientes[0].monto), 6000, "por lo que se le había pagado");

    const siguiente = await generarBorrador(db, tenantId, {
      personaId: cirujana,
      desde: "2027-01-01",
      hasta: "2027-01-31",
      personaQueGenera: admin,
    });
    const aplicados = await aplicarAjustesPendientes(db, tenantId, {
      liquidacionId: siguiente.id,
      personaId: cirujana,
    });
    igual(aplicados.aplicados, 1, "el ajuste se aplica al período siguiente");
    cerca(aplicados.monto, -6000, "y resta lo que se había pagado de más");

    const detalle = await detalleDeLiquidacion(db, tenantId, siguiente.id);
    cerca(
      Number(detalle.liquidacion.total),
      -6000,
      "el período siguiente arranca con el ajuste negativo"
    );
    assert(
      String(detalle.lineas[0].motivo ?? "").includes("se anuló después"),
      "y el ajuste dice por qué",
      detalle.lineas[0].motivo
    );

    // La liquidación aprobada siguió intacta.
    const vieja = await detalleDeLiquidacion(db, tenantId, liquidacionId);
    cerca(
      Number(vieja.liquidacion.total),
      16000,
      "la liquidación cerrada NO cambió: eso es lo que hace que un pago firmado signifique algo"
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== Cumplimiento: permisos, controlados y desechos ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const sugeridos = await permisosDeCumplimiento(db, tenantId);
    assert(sugeridos.length >= 8, "la clínica nace con la lista sugerida", sugeridos.length);
    assert(
      sugeridos.every((p) => p.sugerido === true),
      "y TODOS nacen marcados como sugeridos, no como obligación legal"
    );
    assert(
      sugeridos.every((p) => p.fuente_confirmada === null),
      "con la fuente sin confirmar: este entorno no puede confirmarla"
    );

    const sanitario = sugeridos.find((p) => String(p.nombre).includes("Permiso sanitario"))!;
    await guardarPermiso(db, tenantId, {
      id: sanitario.id as string,
      nombre: sanitario.nombre as string,
      organismo: "Ministerio de Salud",
      numero: "PSF-2026-1234",
      venceEl: (await db.query<{ f: string }>(`SELECT (CURRENT_DATE + 15)::text AS f`)).rows[0].f,
      diasAviso: 30,
      responsableId: admin,
    });
    const despues = await permisosDeCumplimiento(db, tenantId);
    const cargado = despues.find((p) => p.id === sanitario.id)!;
    igual(cargado.sugerido, false, "al cargarlo deja de ser una sugerencia del sistema");
    igual(cargado.numero, "PSF-2026-1234", "con su número");

    const avisos = await porVencer(db, tenantId, 30);
    assert(
      avisos.some((a) => a.clase === "permiso" && String(a.titulo).includes("Permiso sanitario")),
      "y aparece en el aviso de vencimientos"
    );

    // --- EL LIBRO DE CONTROLADOS ---
    const controlado = await db.query<{ id: string }>(
      `INSERT INTO inv_productos
         (tenant_id, codigo, nombre, unidad_base, es_controlado, linea_negocio)
       VALUES ($1,$2,'Ketamina 50 mg/ml','ml',true,'farmacia') RETURNING id`,
      [tenantId, `${PREFIJO}-KET`]
    );
    const bodega = await db.query<{ id: string }>(
      `SELECT id FROM inv_bodegas WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    const lote = await db.query<{ id: string }>(
      `INSERT INTO inv_lotes (tenant_id, producto_id, bodega_id, numero, cantidad, costo_unitario)
       VALUES ($1,$2,$3,'L-2026-01',0,1500) RETURNING id`,
      [tenantId, controlado.rows[0].id, bodega.rows[0].id]
    );

    const paciente = await db.query<{ id: string }>(
      `SELECT id FROM pacientes WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );

    // ENTRADA por compra.
    await db.query(
      `INSERT INTO inv_movimientos
         (tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base, costo_unitario,
          motivo, persona_id)
       VALUES ($1,'compra',$2,$3,$4,100,1500,NULL,$5)`,
      [tenantId, controlado.rows[0].id, bodega.rows[0].id, lote.rows[0].id, admin]
    );
    // SALIDA por paciente, con el médico que lo indicó.
    await db.query(
      `INSERT INTO inv_movimientos
         (tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base, costo_unitario,
          motivo, persona_id, paciente_id)
       VALUES ($1,'atencion',$2,$3,$4,20,1500,NULL,$5,$6)`,
      [
        tenantId,
        controlado.rows[0].id,
        bodega.rows[0].id,
        lote.rows[0].id,
        cirujana,
        paciente.rows[0].id,
      ]
    );

    const hoy = (await db.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`)).rows[0].d;
    const libro = await libroDeControlados(db, tenantId, "2026-01-01", hoy);
    igual(libro.length, 2, "el libro tiene la entrada y la salida");
    igual(libro[1].paciente, "Luna", "y la salida dice de qué paciente fue");
    igual(libro[1].medico, "Bea Cirujana", "y qué médico la indicó");
    igual(libro[0].lote, "L-2026-01", "con su lote");

    const saldos = await saldosDeControlados(db, tenantId);
    igual(saldos.length, 1, "hay un saldo");
    cerca(Number(saldos[0].saldo), 80, "100 que entraron menos 20 que salieron");

    // EL CIERRE FIRMADO.
    const cierre = await cerrarLibro(db, tenantId, {
      desde: "2026-01-01",
      hasta: hoy,
      regenteId: regente,
      observaciones: "Conteo físico coincide.",
    });
    igual(cierre.productos, 1, "el cierre congela el saldo de un producto");

    const cierres = await cierresDeControlados(db, tenantId);
    igual(cierres.length, 1, "y queda el cierre firmado");
    igual(cierres[0].firmado_por, "Caro Regente", "con el nombre del regente");

    // SOLO DE AGREGAR.
    await db.query("SAVEPOINT editar_cierre");
    let editado = "";
    try {
      await db.query(`UPDATE cmp_controlados_cierres SET observaciones = 'otra cosa' WHERE id = $1`, [
        cierre.id,
      ]);
    } catch (err) {
      editado = err instanceof Error ? err.message : "";
    }
    await db.query("ROLLBACK TO SAVEPOINT editar_cierre");
    assert(
      editado.includes("no se edita"),
      "un cierre firmado no se edita: un error se corrige con un cierre nuevo",
      editado
    );

    // --- DESECHOS ---
    await registrarDesecho(db, tenantId, {
      fecha: hoy,
      tipo: "Punzocortantes",
      pesoKg: 3.5,
      gestor: "Gestor Autorizado S.A.",
      gestorAutorizacion: "MS-2026-55",
      personaId: admin,
    });
    let sinCantidad = "";
    try {
      await registrarDesecho(db, tenantId, {
        fecha: hoy,
        tipo: "Biológicos",
        gestor: "Gestor Autorizado S.A.",
        personaId: admin,
      });
    } catch (err) {
      sinCantidad = err instanceof Error ? err.message : "";
    }
    assert(
      sinCantidad.includes("peso o el volumen"),
      "un retiro sin cantidad se rechaza: no sirve para una inspección",
      sinCantidad
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== La auditoría: una lectura de siete fuentes ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    // Un cobro anulado con su aprobación, que es el caso del prompt.
    const cuenta = await db.query<{ id: string }>(
      `SELECT id FROM vta_cuentas WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    await db.query(
      `INSERT INTO vta_aprobaciones
         (tenant_id, tipo, estado, referencia_id, monto, motivo, solicitada_por,
          resuelta_por, resuelta_en, nota_resolucion)
       VALUES ($1,'anular_cobro','aprobada',$2,60000,'Cobro duplicado',$3,$4,now(),
               'Se verificó con el cliente')`,
      [tenantId, cuenta.rows[0].id, cirujana, admin]
    );

    // Un cambio de precio: el trigger de la 159 lo registra solo.
    const lista = await db.query<{ id: string }>(
      `INSERT INTO inv_listas_precio (tenant_id, codigo, nombre) VALUES ($1,'GEN','General') RETURNING id`,
      [tenantId]
    );
    const item = await db.query<{ id: string }>(
      `INSERT INTO inv_lista_precio_items (tenant_id, lista_id, presentacion_id, precio)
       VALUES ($1,$2,$3,5000) RETURNING id`,
      [tenantId, lista.rows[0].id, presentaciones[0]]
    );
    await db.query(`UPDATE inv_lista_precio_items SET precio = 6500 WHERE id = $1`, [item.rows[0].id]);

    const historial = await db.query<{ anterior: string; nuevo: string }>(
      `SELECT precio_anterior::text AS anterior, precio_nuevo::text AS nuevo
         FROM inv_precios_historial WHERE tenant_id = $1 AND precio_anterior IS NOT NULL`,
      [tenantId]
    );
    igual(historial.rows.length, 1, "el cambio de precio quedó registrado SIN que nadie lo escriba");
    igual(historial.rows[0].anterior, "5000.00", "con el precio anterior");
    igual(historial.rows[0].nuevo, "6500.00", "y el nuevo");

    const todos = await eventos(db, tenantId, {});
    assert(todos.length >= 3, "la auditoría trae eventos de varias fuentes", todos.length);

    const anulacion = todos.find((e) => e.tipo === "anular_cobro");
    assert(anulacion !== undefined, "entre ellos, la anulación del cobro");
    igual(anulacion?.quien, "Ana Admin", "y dice QUIÉN la aprobó, que es lo que el prompt pide");
    igual(anulacion?.modulo, "caja", "en el módulo de caja");

    const precio = todos.find((e) => e.tipo === "cambio_precio");
    assert(precio !== undefined, "y el cambio de precio");
    igual(precio?.valor_anterior, "5000.00", "con el valor anterior");
    igual(precio?.valor_nuevo, "6500.00", "y el nuevo");

    const soloCaja = await eventos(db, tenantId, { modulo: "caja" });
    assert(
      soloCaja.every((e) => e.modulo === "caja"),
      "el filtro por módulo deja solo lo de ese módulo"
    );
    const deAna = await eventos(db, tenantId, { personaId: admin });
    assert(
      deAna.every((e) => e.quien_id === admin),
      "y el filtro por persona, solo lo de esa persona"
    );
  });

  // -------------------------------------------------------------------
  console.log("\n=== Los procedimientos de la clínica ===");
  // -------------------------------------------------------------------
  await conAlcanceTenant(tenantId, async (db) => {
    const p = await guardarProcedimiento(db, tenantId, {
      categoria: "Quirófano",
      titulo: "Limpieza del quirófano",
      contenido: "1. Retirar el material. 2. Desinfectar superficies con…",
      roles: ["medico", "asistente"],
      exigeLectura: true,
      personaId: admin,
    });

    const paraMedico = await procedimientos(db, tenantId, { rol: "medico" });
    igual(paraMedico.length, 1, "el médico ve el procedimiento que le toca");
    const paraCaja = await procedimientos(db, tenantId, { rol: "caja" });
    igual(paraCaja.length, 0, "y quien está en caja no: no es suyo");

    const lectura = await confirmarLectura(db, tenantId, {
      procedimientoId: p.id,
      personaId: cirujana,
    });
    igual(lectura.version, "1", "la lectura se guarda con la versión que leyó");

    // UNA VERSIÓN NUEVA NO QUEDA LEÍDA POR ARRASTRE.
    await guardarProcedimiento(db, tenantId, {
      id: p.id,
      categoria: "Quirófano",
      titulo: "Limpieza del quirófano",
      contenido: "1. Retirar el material. 2. Desinfectar con el producto nuevo…",
      version: "2",
      personaId: admin,
    });
    const tras = await procedimientos(db, tenantId, {});
    igual(
      tras[0].lecturas,
      0,
      "al cambiar de versión, nadie la leyó todavía: la confirmación vieja no vale"
    );
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
