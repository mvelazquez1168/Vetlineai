// Verificación del prompt 08b/09b (complemento de caja y facturador).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_complemento_08b_09b.ts
//
// SIN --transpile-only a propósito.
//
// Es re-corrible: borra su clínica de prueba al empezar.
//
// Lo que verifica, punto por punto del prompt:
//
//   A1  presupuestos: consecutivo, vigencia, estados, conversión total,
//       precio cotizado dentro de la vigencia, el vencido que pregunta,
//       y el anticipo que queda disponible para el cobro;
//   A2  denominaciones desde la base y el vale con quién recibe;
//   A3  los tres topes de descuento y el menor que gana, el motivo
//       mapeado al código de Hacienda, y el autorizador verificado;
//   A4  la comisión congelada en el cobro y la conciliación contra el
//       lote del datáfono;
//   A5  quién realizó el servicio, heredado del ítem de la atención.
//
// Los puntos de la parte B se agregan cuando esos bloques estén
// construidos.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import {
  convertirPresupuesto,
  crearPresupuesto,
  listarPresupuestos,
  marcarEnviado,
  PresupuestoVencido,
  registrarRespuesta,
  vencerPresupuestos,
  verPresupuesto,
} from "../ventas/presupuestos";
import {
  motivosDeDescuento,
  puedeAutorizarDescuento,
  rolEfectivo,
  topeDeDescuento,
  validarDescuento,
  DescuentoSobreElTope,
} from "../ventas/descuentos";
import { comisionVigente, costoDelCobro } from "../ventas/comisionesTarjeta";
import { totalDeCuenta } from "../ventas/cuentas";
import { registrarMovimiento } from "../inventario/movimientos";
import {
  actividadesDelEmisor,
  actividadParaEmitir,
  ActividadesMezcladas,
  guardarReglaDeActividad,
  reglasDeActividad,
} from "../facturacion/actividades";

const PREFIJO = "probe-08b";

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
  exigirEntornoDeDesarrollo("verificar_complemento_08b_09b");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@08b.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO configuracion_notificaciones (tenant_id, confirmacion_cita_activo,
                                               recordatorio_cita_activo)
     VALUES ($1,false,false)`,
    [tenantId]
  );
  await pool.query(
    `INSERT INTO vta_parametros (tenant_id, umbral_diferencia_arqueo, descuento_maximo_pct)
     VALUES ($1, 2000, 15)`,
    [tenantId]
  );
  // Los topes por rol, como los sembraría la migración para una clínica
  // que ya existía.
  await pool.query(
    `INSERT INTO vta_topes_descuento (tenant_id, rol, tope_pct, puede_autorizar)
     VALUES ($1,'medico',10,false), ($1,'admin_clinica',NULL,true)`,
    [tenantId]
  );

  const admin = (
    await pool.query<{ id: string }>(
      // `es_medico` tiene DEFAULT true y hay un CHECK que exige
      // colegiatura al médico: un administrador que no es médico hay que
      // declararlo en false explícitamente.
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico,
                             es_admin_clinica, estado)
       VALUES ($1,'Ana Administradora',$2,'x',false,true,'activo') RETURNING id`,
      [tenantId, `${PREFIJO}-admin@probe.test`]
    )
  ).rows[0].id;
  const medico = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, colegiatura, estado)
       VALUES ($1,'Dr. Beto Médico',$2,'x',true,'VET-8001','activo') RETURNING id`,
      [tenantId, `${PREFIJO}-medico@probe.test`]
    )
  ).rows[0].id;

  await conAlcanceTenant(tenantId, async (db) => {
    // -----------------------------------------------------------------
    console.log("\n=== A3. Los tres topes y el menor que gana ===");
    // -----------------------------------------------------------------
    igual(await rolEfectivo(db, admin), "admin_clinica", "el rol efectivo del administrador");
    igual(await rolEfectivo(db, medico), "medico", "el del médico");

    const topeMedico = await topeDeDescuento(db, tenantId, { personaId: medico });
    igual(topeMedico.topePct, 10, "el médico tiene el tope de su rol");
    igual(topeMedico.origen, "rol", "y dice de dónde salió");
    const topeAdmin = await topeDeDescuento(db, tenantId, { personaId: admin });
    igual(topeAdmin.topePct, 15, "el administrador, sin tope de rol, cae en el de la clínica");
    igual(topeAdmin.origen, "clinica", "y lo dice");

    // El producto con su propio tope, más bajo que los dos anteriores.
    const producto = (
      await db.query<{ id: string }>(
        `INSERT INTO inv_productos (tenant_id, codigo, nombre, categoria, linea_negocio,
                                    codigo_cabys, codigo_tarifa_iva, unidad_base,
                                    descuento_maximo_pct)
         VALUES ($1,'PROBE-1','Alimento medicado 10 kg','alimento','pet_shop',
                 '2311100000000','08','kg', 4) RETURNING id`,
        [tenantId]
      )
    ).rows[0].id;
    const presentacion = (
      await db.query<{ id: string }>(
        // Las columnas reales: `factor`, `unidad_medida`, `para_venta`
        // y `codigo_interno` obligatorio.
        `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                         unidad_medida, precio_venta, para_venta)
         VALUES ($1,$2,'PROBE-1-SACO','Saco de 10 kg',1,'Unid',25000,true) RETURNING id`,
        [tenantId, producto]
      )
    ).rows[0].id;

    // CONVERTIR UN PRESUPUESTO CON PRODUCTOS DESCUENTA INVENTARIO, así
    // que hace falta una bodega con existencias: es el mismo camino que
    // una venta de mostrador.
    const bodega = (
      await db.query<{ id: string }>(
        `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default, activo)
         VALUES ($1,'PROBE','Bodega de prueba',true,true) RETURNING id`,
        [tenantId]
      )
    ).rows[0].id;
    // POR LA FUNCIÓN DEL DOMINIO y no con un INSERT a mano: el stock
    // vive en lotes y hay un trigger que lo exige, así que
    // `registrarMovimiento` es el único camino que lo hace bien. Un
    // verificador que arma el estado por su cuenta verifica su propia
    // versión del modelo.
    await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial",
      productoId: producto,
      bodegaId: bodega,
      presentacionId: presentacion,
      cantidadPresentacion: 10,
      lote: { numero: "PROBE-L1", costoUnitario: 18000 },
    });

    const topeProducto = await topeDeDescuento(db, tenantId, {
      presentacionId: presentacion,
      personaId: admin,
    });
    igual(topeProducto.topePct, 4, "el tope del producto gana cuando es el más bajo");
    igual(topeProducto.origen, "producto", "y lo dice");
    igual(
      topeProducto.detalle,
      { producto: 4, servicio: null, rol: null, clinica: 15 },
      "y el detalle muestra los tres niveles, para poder explicarlo"
    );

    // -----------------------------------------------------------------
    console.log("\n=== A3. El motivo, su código de Hacienda y la autorización ===");
    // -----------------------------------------------------------------
    const motivos = await motivosDeDescuento(db);
    assert(motivos.length >= 8, "el catálogo de motivos tiene la semilla", `${motivos.length}`);
    const frecuente = motivos.find((m) => m.etiqueta === "Cliente frecuente")!;
    igual(frecuente.codigo_hacienda, "08", "«Cliente frecuente» va con el código 08 (frecuencia)");
    const cortesia = motivos.find((m) => m.etiqueta === "Cortesía de la clínica")!;
    igual(cortesia.codigo_hacienda, "99", "«Cortesía» es un 99 (otros)");
    assert(
      Boolean(cortesia.codigo_hacienda_otro),
      "y lleva su texto, porque un 99 sin explicar no se puede justificar",
      cortesia.codigo_hacienda_otro
    );
    assert(cortesia.exige_autorizacion, "y exige autorización pase lo que pase con el tope");

    // Los diez códigos usados existen en la enumeración oficial del XSD.
    const OFICIALES = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "99"];
    const usados = [...new Set(motivos.map((m) => m.codigo_hacienda))];
    assert(
      usados.every((c) => OFICIALES.includes(c)),
      "todos los códigos del catálogo están en CodigoDescuentoType del XSD",
      usados.join(", ")
    );

    igual(await puedeAutorizarDescuento(db, tenantId, admin), true, "el administrador autoriza");
    igual(await puedeAutorizarDescuento(db, tenantId, medico), false, "el médico no");

    // Un descuento dentro del tope pasa y trae el código.
    const dentro = await validarDescuento(db, tenantId, {
      bruto: 10000,
      descuento: 800,
      personaId: medico,
      motivoId: frecuente.id,
    });
    igual(dentro.codigoHacienda, "08", "un descuento dentro del tope sale con su código");
    igual(dentro.etiqueta, "Cliente frecuente", "y con su naturaleza, que es otro campo del XSD");

    // Por encima del tope, se pide autorización.
    let sobreElTope: DescuentoSobreElTope | null = null;
    try {
      await validarDescuento(db, tenantId, {
        bruto: 10000,
        descuento: 3000,
        personaId: medico,
        motivoId: frecuente.id,
      });
    } catch (err) {
      sobreElTope = err instanceof DescuentoSobreElTope ? err : null;
    }
    assert(Boolean(sobreElTope), "un 30 % con tope del 10 % se rechaza");
    igual(sobreElTope?.topePct, 10, "y dice cuál era el tope");

    // Con la autorización del administrador, pasa.
    const autorizado = await validarDescuento(db, tenantId, {
      bruto: 10000,
      descuento: 3000,
      personaId: medico,
      motivoId: frecuente.id,
      autorizadoPor: admin,
    });
    igual(autorizado.codigoHacienda, "08", "con autorización del administrador, pasa");

    // El médico no puede autorizar, aunque mande su propio id.
    let sinPermiso = "";
    try {
      await validarDescuento(db, tenantId, {
        bruto: 10000,
        descuento: 3000,
        personaId: admin,
        motivoId: frecuente.id,
        autorizadoPor: medico,
      });
    } catch (err) {
      sinPermiso = err instanceof Error ? err.message : "";
    }
    assert(
      sinPermiso.includes("permiso"),
      "quien no tiene permiso no autoriza, aunque llegue su id en el body",
      sinPermiso
    );

    // Nadie se autoriza a sí mismo.
    let aSiMismo = "";
    try {
      await validarDescuento(db, tenantId, {
        bruto: 10000,
        descuento: 3000,
        personaId: admin,
        motivoId: frecuente.id,
        autorizadoPor: admin,
      });
    } catch (err) {
      aSiMismo = err instanceof Error ? err.message : "";
    }
    assert(aSiMismo.includes("propio descuento"), "nadie autoriza su propio descuento", aSiMismo);

    // El motivo que siempre exige autorización, aunque el monto sea chico.
    let cortesiaSinAutorizar = false;
    try {
      await validarDescuento(db, tenantId, {
        bruto: 10000,
        descuento: 100,
        personaId: admin,
        motivoId: cortesia.id,
      });
    } catch (err) {
      cortesiaSinAutorizar = err instanceof DescuentoSobreElTope;
    }
    assert(
      cortesiaSinAutorizar,
      "una cortesía del 1 % también pide autorización: lo exige el motivo, no el monto"
    );

    // -----------------------------------------------------------------
    console.log("\n=== A2. Denominaciones desde la base ===");
    // -----------------------------------------------------------------
    const deno = await db.query<{ n: string; monedas: string }>(
      `SELECT count(*)::text AS n, string_agg(DISTINCT moneda, ',') AS monedas
         FROM vta_denominaciones WHERE activo`
    );
    assert(
      Number(deno.rows[0].n) >= 17,
      "el catálogo de denominaciones trae la semilla del BCCR",
      `${deno.rows[0].n} filas en ${deno.rows[0].monedas}`
    );
    const billetes = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM vta_denominaciones
        WHERE moneda = 'CRC' AND especie = 'billete' AND activo`
    );
    igual(billetes.rows[0].n, "5", "cinco billetes de colón: 1 000 a 20 000");

    // -----------------------------------------------------------------
    console.log("\n=== A4. La comisión del datáfono ===");
    // -----------------------------------------------------------------
    await db.query(
      `INSERT INTO vta_comisiones_tarjeta
         (tenant_id, banco, tipo_tarjeta, marca, comision_pct, comision_fija, vigente_desde)
       VALUES ($1,'BAC','credito',NULL,3.25,0,'2026-01-01'),
              ($1,'BAC','credito','AmEx',4.5,0,'2026-01-01'),
              ($1,'BAC','credito',NULL,2.95,0,'2026-06-01')`,
      [tenantId]
    );
    const enEnero = await comisionVigente(db, tenantId, {
      banco: "BAC",
      tipoTarjeta: "credito",
      fecha: "2026-03-15",
    });
    igual(enEnero?.comisionPct, 3.25, "en marzo rige la comisión de enero");
    const enJulio = await comisionVigente(db, tenantId, {
      banco: "BAC",
      tipoTarjeta: "credito",
      fecha: "2026-07-15",
    });
    igual(enJulio?.comisionPct, 2.95, "en julio rige la de junio: la vigencia más reciente");
    const conMarca = await comisionVigente(db, tenantId, {
      banco: "BAC",
      tipoTarjeta: "credito",
      marca: "AmEx",
      fecha: "2026-03-15",
    });
    igual(conMarca?.comisionPct, 4.5, "la marca exacta gana sobre la que no distingue marca");
    const sinConfigurar = await comisionVigente(db, tenantId, {
      banco: "Promerica",
      tipoTarjeta: "debito",
    });
    igual(sinConfigurar, null, "un banco sin configurar devuelve null y NO una comisión inventada");

    const costo = costoDelCobro(50000, enEnero);
    igual(costo.comisionEstimada, 1625, "₡50 000 al 3,25 % son ₡1 625 de comisión");
    igual(costo.netoEsperado, 48375, "y el neto esperado es ₡48 375");
    igual(
      costoDelCobro(50000, null).comisionEstimada,
      null,
      "sin comisión configurada, el cobro queda sin el dato en vez de con un cero"
    );

    // -----------------------------------------------------------------
    console.log("\n=== A1. Presupuestos ===");
    // -----------------------------------------------------------------
    const cliente = (
      await db.query<{ id: string }>(
        `INSERT INTO propietarios (tenant_id, nombre, telefono) VALUES ($1,'Doña Marta','88881111')
         RETURNING id`,
        [tenantId]
      )
    ).rows[0].id;
    const servicio = (
      await db.query<{ id: string }>(
        `INSERT INTO inv_servicios (tenant_id, codigo, nombre, precio, codigo_cabys,
                                    codigo_tarifa_iva, linea_negocio)
         VALUES ($1,'CIR-1','Ovariohisterectomía',95000,'8512200000000','08','cirugia')
         RETURNING id`,
        [tenantId]
      )
    ).rows[0].id;

    const p1 = await crearPresupuesto(db, tenantId, {
      propietarioId: cliente,
      observaciones: "Incluye el control a los ocho días.",
      personaId: medico,
      lineas: [
        { servicioId: servicio, cantidad: 1, nota: "Incluye anestesia y hospitalización del día." },
        // El descuento se autoriza AL COTIZAR: 1 000 sobre 25 000 es un
        // 4 % y el tope del producto es justo 4 %, así que entra sin
        // autorización.
        {
          presentacionId: presentacion,
          cantidad: 1,
          descuento: 1000,
          motivoDescuentoId: frecuente.id,
        },
      ],
    });
    igual(p1.numero, 1, "el primer presupuesto de la clínica es el número 1");
    igual(p1.total, 119000, "el total sale de las líneas menos el descuento");

    const p2 = await crearPresupuesto(db, tenantId, {
      propietarioId: cliente,
      personaId: medico,
      lineas: [{ servicioId: servicio, cantidad: 1 }],
    });
    igual(p2.numero, 2, "el consecutivo avanza");

    const visto = (await verPresupuesto(db, p1.id))!;
    igual(visto.estado, "borrador", "nace en borrador");
    igual(visto.vigencia_dias, 15, "con la vigencia por omisión de la clínica");
    assert(Boolean(visto.vence_el), "y con su fecha de vencimiento calculada", visto.vence_el);
    igual(visto.lineas.length, 2, "con sus dos líneas");
    assert(
      visto.lineas.some((l) => (l.nota ?? "").includes("anestesia")),
      "y la nota por línea, que es para lo que existe"
    );

    await marcarEnviado(db, tenantId, p1.id, medico);
    igual((await verPresupuesto(db, p1.id))!.estado, "enviado", "marcarlo enviado lo mueve de estado");

    // La respuesta la registra quien la recibió.
    await registrarRespuesta(db, tenantId, p1.id, {
      acepta: true,
      como: "whatsapp",
      nota: "Dijo que sí por WhatsApp, programa para el jueves.",
      personaId: admin,
    });
    const aceptado = (await verPresupuesto(db, p1.id))!;
    igual(aceptado.estado, "aceptado", "la respuesta del cliente lo deja aceptado");
    igual(aceptado.respondido_como, "whatsapp", "y queda registrado por dónde contestó");

    // El anticipo sobre el presupuesto.
    await db.query(
      `INSERT INTO vta_anticipos (tenant_id, propietario_id, motivo, monto, estado, presupuesto_id,
                                  medio, moneda)
       VALUES ($1,$2,'Anticipo de la cirugía',50000,'disponible',$3,'01','CRC')`,
      [tenantId, cliente, p1.id]
    );
    igual(
      (await verPresupuesto(db, p1.id))!.anticipado,
      50000,
      "el anticipo recibido viaja con el presupuesto"
    );

    // La conversión.
    const convertido = await convertirPresupuesto(db, tenantId, p1.id, {
      personaId: admin,
      bodegaId: bodega,
    });
    igual(convertido.cargos, 2, "la conversión es total: las dos líneas se vuelven cargos");
    igual(convertido.total, 119000, "por el total cotizado");
    igual(
      convertido.anticipoDisponible,
      50000,
      "y el anticipo queda disponible para aplicarse al cobrar"
    );
    assert(
      convertido.avisos.some((a) => a.includes("anticipo")),
      "y se avisa, para que nadie lo cobre dos veces",
      convertido.avisos.join(" | ")
    );
    const totalCuenta = await totalDeCuenta(db, convertido.cuentaId);
    assert(
      totalCuenta.neto === 119000,
      "la cuenta quedó con el neto del presupuesto",
      `${totalCuenta.neto}`
    );
    igual(
      (await verPresupuesto(db, p1.id))!.estado,
      "convertido",
      "y el presupuesto queda convertido"
    );

    // EL PRECIO COTIZADO SE RESPETA. Se sube el precio del servicio
    // DESPUÉS de cotizar: el cargo tiene que seguir en 95 000.
    const cargo = await db.query<{ precio_unitario: string; origen: string }>(
      `SELECT precio_unitario::text, origen FROM vta_cargos
        WHERE cuenta_id = $1 AND servicio_id = $2`,
      [convertido.cuentaId, servicio]
    );
    // El número y no su forma de texto: la escala decimal de la columna
    // es del esquema y comparar la cadena hace fallar la aserción por un
    // cero.
    igual(Number(cargo.rows[0].precio_unitario), 95000, "el cargo lleva el precio cotizado");
    igual(cargo.rows[0].origen, "presupuesto", "y dice que nació de un presupuesto");

    // No se convierte dos veces.
    let dosVeces = "";
    try {
      await convertirPresupuesto(db, tenantId, p1.id, { personaId: admin });
    } catch (err) {
      dosVeces = err instanceof Error ? err.message : "";
    }
    assert(dosVeces.includes("ya se convirtió"), "no se convierte dos veces", dosVeces);

    // EL VENCIDO PREGUNTA, no decide.
    await db.query(
      `UPDATE vta_presupuestos SET vence_el = CURRENT_DATE - 1 WHERE id = $1`,
      [p2.id]
    );
    igual((await verPresupuesto(db, p2.id))!.vencido, true, "el vencimiento se calcula al leer");
    let pregunto: PresupuestoVencido | null = null;
    try {
      await convertirPresupuesto(db, tenantId, p2.id, { personaId: admin });
    } catch (err) {
      pregunto = err instanceof PresupuestoVencido ? err : null;
    }
    assert(Boolean(pregunto), "convertir un vencido sin elegir precio pregunta en vez de decidir");

    // Respetar el precio vencido necesita el permiso de autorizar.
    let sinAutorizacion = "";
    try {
      await convertirPresupuesto(db, tenantId, p2.id, {
        personaId: medico,
        precioVencido: "cotizado",
      });
    } catch (err) {
      sinAutorizacion = err instanceof Error ? err.message : "";
    }
    assert(
      sinAutorizacion.includes("autoriza"),
      "respetar un precio vencido lo autoriza quien puede autorizar descuentos",
      sinAutorizacion
    );

    const conPrecioActual = await convertirPresupuesto(db, tenantId, p2.id, {
      personaId: admin,
      bodegaId: bodega,
      precioVencido: "actual",
    });
    assert(
      conPrecioActual.avisos.some((a) => a.includes("vencido")),
      "con el precio actual se convierte y queda dicho en los avisos",
      conPrecioActual.avisos.join(" | ")
    );

    // El job de vencimiento.
    const p3 = await crearPresupuesto(db, tenantId, {
      propietarioId: cliente,
      personaId: medico,
      lineas: [{ servicioId: servicio, cantidad: 1 }],
    });
    await db.query(`UPDATE vta_presupuestos SET vence_el = CURRENT_DATE - 3 WHERE id = $1`, [p3.id]);
    const vencidos = await vencerPresupuestos(db);
    assert(vencidos >= 1, "el job pasa a vencido lo que ya venció", `${vencidos}`);
    igual((await verPresupuesto(db, p3.id))!.estado, "vencido", "y el estado queda guardado");

    // El listado y sus filtros.
    const todos = await listarPresupuestos(db);
    assert(todos.length >= 3, "el listado trae los presupuestos", `${todos.length}`);
    const soloVencidos = await listarPresupuestos(db, { estado: "vencido" });
    assert(
      soloVencidos.length >= 1 && soloVencidos.every((x) => x.estado === "vencido"),
      "y el filtro por estado filtra"
    );

    // Un presupuesto sin líneas no existe.
    let sinLineas = "";
    try {
      await crearPresupuesto(db, tenantId, { propietarioId: cliente, lineas: [] });
    } catch (err) {
      sinLineas = err instanceof Error ? err.message : "";
    }
    assert(sinLineas.length > 0, "un presupuesto sin líneas se rechaza", sinLineas);

    // -----------------------------------------------------------------
    console.log("\n=== B3. Los campos fiscales del producto ===");
    // -----------------------------------------------------------------
    // Todo lo de este bloque sale del XSD oficial v4.4 del repo.
    await db.query(
      `UPDATE inv_productos
          SET registro_medicamento = 'RSM-12345-2026', forma_farmaceutica = 'INY',
              codigo_comercial = 'ALM-10K', codigo_comercial_tipo = '04'
        WHERE id = $1`,
      [producto]
    );
    const fiscales = await db.query<{
      registro_medicamento: string;
      forma_farmaceutica: string;
      codigo_comercial_tipo: string;
    }>(
      `SELECT registro_medicamento, forma_farmaceutica, codigo_comercial_tipo
         FROM inv_productos WHERE id = $1`,
      [producto]
    );
    igual(
      fiscales.rows[0].registro_medicamento,
      "RSM-12345-2026",
      "el producto guarda su registro del Ministerio de Salud"
    );
    igual(fiscales.rows[0].forma_farmaceutica, "INY", "y su forma farmacéutica, de tres");
    igual(fiscales.rows[0].codigo_comercial_tipo, "04", "y el tipo de su código comercial");

    // LA PARTIDA ARANCELARIA SON DOCE EXACTOS: lo dice el XSD de
    // exportación (minLength y maxLength en 12).
    let partidaCorta = false;
    await db.query("SAVEPOINT antes_partida");
    try {
      await db.query(`UPDATE inv_productos SET partida_arancelaria = '0101' WHERE id = $1`, [
        producto,
      ]);
      await db.query("RELEASE SAVEPOINT antes_partida");
    } catch {
      partidaCorta = true;
      await db.query("ROLLBACK TO SAVEPOINT antes_partida");
    }
    assert(partidaCorta, "una partida arancelaria de cuatro caracteres se rechaza");
    await db.query(
      `UPDATE inv_productos SET partida_arancelaria = '010129000000' WHERE id = $1`,
      [producto]
    );
    const conPartida = await db.query<{ partida_arancelaria: string }>(
      `SELECT partida_arancelaria FROM inv_productos WHERE id = $1`,
      [producto]
    );
    igual(
      conPartida.rows[0].partida_arancelaria.length,
      12,
      "y una de doce se acepta"
    );

    // EL TIPO Y EL CÓDIGO COMERCIAL VAN JUNTOS: el nodo del XML lleva
    // los dos, y un código sin tipo no se puede escribir.
    let sueltoRechazado = false;
    await db.query("SAVEPOINT antes_comercial");
    try {
      await db.query(
        `UPDATE inv_productos SET codigo_comercial_tipo = NULL WHERE id = $1`,
        [producto]
      );
      await db.query("RELEASE SAVEPOINT antes_comercial");
    } catch {
      sueltoRechazado = true;
      await db.query("ROLLBACK TO SAVEPOINT antes_comercial");
    }
    assert(sueltoRechazado, "un código comercial sin su tipo se rechaza");

    // Y LLEGAN A LA LÍNEA DEL COMPROBANTE. `lineasParaFacturar` es el
    // puente entre la caja y el facturador: si no los propaga, el dato
    // está en el catálogo y no en la factura.
    const { lineasParaFacturar } = await import("../ventas/cuentas");
    const paraFacturar = await lineasParaFacturar(db, convertido.cuentaId);
    const delProducto = paraFacturar.find((l) => l.registroMedicamento);
    assert(
      Boolean(delProducto),
      "los campos fiscales del producto llegan a la línea del comprobante",
      JSON.stringify(delProducto?.registroMedicamento)
    );
    igual(
      delProducto?.codigoComercial,
      { tipo: "04", codigo: "ALM-10K" },
      "el código comercial viaja con su tipo, como lo pide el XSD"
    );

    // -----------------------------------------------------------------
    console.log("\n=== B1. La actividad económica del comprobante ===");
    // -----------------------------------------------------------------
    const emisor = (
      await db.query<{ id: string }>(
        `INSERT INTO fact_emisores
           (tenant_id, tipo_identificacion, numero_identificacion, nombre,
            codigo_actividad_economica, ubicacion_provincia, ubicacion_canton,
            ubicacion_distrito, ubicacion_otras_senas, telefono_codigo_pais, telefono_numero,
            correo, proveedor_sistemas, sucursal, terminal, ambiente_activo)
         VALUES ($1,'02','3101234567','Veterinaria de Prueba S.A.','862100',
                 '1','01','01','200 metros al sur','506','22334455',
                 'probe@emisor.test','3101999999','001','00001','pruebas')
         RETURNING id`,
        [tenantId]
      )
    ).rows[0].id;

    // La que ya tenía el emisor se registra como predeterminada, igual
    // que hace la migración con los emisores que ya existían.
    await db.query(
      `INSERT INTO fact_emisor_actividades (tenant_id, emisor_id, codigo, descripcion,
                                            es_predeterminada)
       VALUES ($1,$2,'862100','Actividades veterinarias',true),
              ($1,$2,'464901','Venta al por mayor de productos farmacéuticos y veterinarios',false)`,
      [tenantId, emisor]
    );
    const actividades = await actividadesDelEmisor(db, emisor);
    igual(actividades.length, 2, "el emisor tiene sus dos actividades inscritas");
    igual(
      actividades[0].esPredeterminada,
      true,
      "y la predeterminada viene primero, que es la que se usa sin regla"
    );

    // Sin reglas, sale la predeterminada.
    const sinReglas = await actividadParaEmitir(db, tenantId, emisor, {
      lineasNegocio: ["pet_shop"],
    });
    igual(sinReglas.codigo, "862100", "sin reglas, sale la actividad predeterminada");
    igual(sinReglas.origen, "predeterminada", "y dice de dónde salió");

    // Con la regla, cada línea de negocio usa la suya.
    await guardarReglaDeActividad(db, tenantId, "pet_shop", actividades[1].id);
    await guardarReglaDeActividad(db, tenantId, "farmacia", actividades[1].id);
    await guardarReglaDeActividad(db, tenantId, "consulta", actividades[0].id);
    await guardarReglaDeActividad(db, tenantId, "cirugia", actividades[0].id);
    igual((await reglasDeActividad(db, tenantId)).length, 4, "las cuatro reglas quedaron guardadas");

    const porRegla = await actividadParaEmitir(db, tenantId, emisor, {
      lineasNegocio: ["pet_shop"],
    });
    igual(porRegla.codigo, "464901", "una cuenta de pet shop sale con la actividad de venta");
    igual(porRegla.origen, "regla", "y lo dice");
    const clinica = await actividadParaEmitir(db, tenantId, emisor, {
      lineasNegocio: ["cirugia", "consulta"],
    });
    igual(
      clinica.codigo,
      "862100",
      "dos líneas de la MISMA actividad no son un conflicto: sale la veterinaria"
    );

    // UN COMPROBANTE, UNA ACTIVIDAD. Lo dice el XSD y el sistema lo hace
    // cumplir en vez de emitir con una de las dos.
    let mezcla: ActividadesMezcladas | null = null;
    try {
      await actividadParaEmitir(db, tenantId, emisor, {
        lineasNegocio: ["pet_shop", "cirugia"],
      });
    } catch (err) {
      mezcla = err instanceof ActividadesMezcladas ? err : null;
    }
    assert(
      Boolean(mezcla),
      "una cuenta que mezcla alimento y cirugía NO se emite: hay que separarla"
    );
    assert(
      (mezcla?.message ?? "").includes("separarla en dos comprobantes"),
      "y el mensaje dice qué hacer",
      mezcla?.message
    );
    igual(
      mezcla?.porLinea.length,
      2,
      "y trae qué actividad le toca a cada línea, para poder separarla"
    );

    // Las líneas SIN línea de negocio no parten la factura: un cargo
    // manual sin clasificar no puede obligar a dos comprobantes.
    const conManual = await actividadParaEmitir(db, tenantId, emisor, {
      lineasNegocio: ["cirugia", null, null],
    });
    igual(conManual.codigo, "862100", "un cargo sin línea de negocio no parte el comprobante");

    // La elegida a mano gana, pero solo si está inscrita.
    const elegida = await actividadParaEmitir(db, tenantId, emisor, {
      lineasNegocio: ["pet_shop"],
      actividadElegida: "862100",
    });
    igual(elegida.origen, "elegida", "la actividad elegida en la pantalla gana sobre la regla");
    let inventada = "";
    try {
      await actividadParaEmitir(db, tenantId, emisor, { actividadElegida: "999999" });
    } catch (err) {
      inventada = err instanceof Error ? err.message : "";
    }
    assert(
      inventada.includes("no está entre las inscritas"),
      "una actividad que el emisor no tiene inscrita se rechaza",
      inventada
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
