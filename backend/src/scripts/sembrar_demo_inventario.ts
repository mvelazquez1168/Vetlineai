// Siembra de datos de DEMOSTRACIÓN del módulo `inventario`.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/sembrar_demo_inventario.ts <tenantId>
//
// Qué deja cargado:
//   * los TRES productos de ejemplo del prompt, con sus presentaciones:
//     caja de 20 tabletas que se vende entera o por tableta, litro de
//     alcohol con dosis de 100 ml, y paquete de 1 kg de algodón que se
//     consume por gramo;
//   * lotes con vencimientos distintos, uno por vencer y un envase
//     abierto;
//   * al menos un movimiento de cada uno de los TRECE tipos, algunos
//     ligados a un paciente y otros sin paciente;
//   * un ajuste pendiente de aprobación;
//   * un producto bajo el mínimo;
//   * una orden de compra sugerida y otra recibida parcialmente;
//   * un servicio con su receta de insumos.
//
// TODO pasa por `registrarMovimiento`, el punto único: no hay un solo
// INSERT a `inv_lotes` acá. Si lo hubiera, los datos de demostración
// mostrarían existencias que el código real nunca produciría.
//
// Es re-corrible: si la clínica ya tiene productos, no hace nada. Los
// movimientos no se borran (son inmutables por diseño), así que volver
// a sembrar duplicaría el kardex.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { registrarMovimiento, registrarTraslado } from "../inventario/movimientos";
import { solicitarAjuste } from "../inventario/ajustes";
import { crearOrden, recibirOrden, sugerirOrden } from "../inventario/compras";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

function paso(t: string) {
  console.log(`\n=== ${t} ===`);
}

/** Fechas relativas, para que la demo no envejezca. */
function enDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function main() {
  exigirEntornoDeDesarrollo("sembrar_demo_inventario");

  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: … sembrar_demo_inventario.ts <tenantId>");
    process.exit(1);
  }

  const t = await pool.query<{ nombre: string }>(`SELECT nombre FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  if (t.rows.length === 0) {
    console.error(`No existe la clínica ${tenantId}.`);
    process.exit(1);
  }
  console.log(`Clínica: ${t.rows[0].nombre} — ${tenantId}`);

  const yaHay = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM inv_productos WHERE tenant_id = $1`,
    [tenantId]
  );
  if (Number(yaHay.rows[0].n) > 0) {
    console.log(
      `\nEsta clínica ya tiene ${yaHay.rows[0].n} producto(s). No se siembra nada: los movimientos ` +
        `son inmutables por diseño, así que volver a sembrar duplicaría el kardex.`
    );
    return;
  }

  // -------------------------------------------------------------------
  paso("1. Bodegas, parámetros y un proveedor");
  const bodega = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,'FARM','Farmacia',true) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  const quirofano = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre) VALUES ($1,'QUIR','Quirófano') RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO inv_parametros (tenant_id, umbral_aprobacion_ajuste, dias_stock_seguridad)
     VALUES ($1, 8000, 7) ON CONFLICT (tenant_id) DO UPDATE SET
       umbral_aprobacion_ajuste = EXCLUDED.umbral_aprobacion_ajuste`,
    [tenantId]
  );
  const proveedor = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_proveedores (tenant_id, nombre, tipo_identificacion, numero_identificacion,
                                    contacto_nombre, contacto_telefono, contacto_email,
                                    condiciones_pago, dias_entrega)
       VALUES ($1,'Droguería Veterinaria del Valle S.A.','02','3101222333','Marta Solís',
               '22551212','ventas@demo-drovet.invalid','30 días',3) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  console.log("  dos bodegas, umbral de aprobación en ₡8 000 y un proveedor");

  // Una persona para firmar los movimientos y un paciente para ligar
  // algunos: los dos salen de lo que la clínica ya tiene.
  const persona = (
    await pool.query<{ id: string }>(
      `SELECT id FROM personas WHERE tenant_id = $1 AND estado = 'activo' ORDER BY creado_en LIMIT 1`,
      [tenantId]
    )
  ).rows[0]?.id;
  // Un paciente para poder ligar los movimientos de atención. Si la
  // clínica no tiene ninguno se crea uno de demostración: sin paciente
  // no hay forma de mostrar el drill-down, que es justamente lo que
  // distingue un movimiento con paciente de uno sin.
  let paciente = (
    await pool.query<{ id: string }>(
      `SELECT id FROM pacientes WHERE tenant_id = $1 ORDER BY creado_en LIMIT 1`,
      [tenantId]
    )
  ).rows[0]?.id;
  if (!paciente) {
    const propietario = (
      await pool.query<{ id: string }>(
        `INSERT INTO propietarios (tenant_id, nombre, telefono, email)
         VALUES ($1,'Ana María Rodríguez Jiménez','88887777','ana@demo-vetline.invalid')
         RETURNING id`,
        [tenantId]
      )
    ).rows[0].id;
    paciente = (
      await pool.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
         VALUES ($1,$2,'Nina','canino',
                 (SELECT COALESCE(max(numero_expediente),0) + 1 FROM pacientes WHERE tenant_id = $1))
         RETURNING id`,
        [tenantId, propietario]
      )
    ).rows[0].id;
    console.log("  se creó el paciente de demostración Nina (Ana María Rodríguez Jiménez)");
  }
  console.log(
    `  persona: ${persona ?? "(ninguna activa)"} · paciente para ligar: ${paciente ?? "(ninguno)"}`
  );

  // -------------------------------------------------------------------
  paso("2. Los tres productos de ejemplo, con sus presentaciones");

  const crearProducto = async (d: Record<string, unknown>) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO inv_productos (tenant_id, codigo, nombre, principio_activo, concentracion,
                                    categoria, linea_negocio, codigo_cabys, codigo_tarifa_iva,
                                    unidad_base, requiere_receta, es_controlado,
                                    requiere_refrigeracion, vida_util_apertura_dias,
                                    minimo, punto_reorden, proveedor_preferido_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 COALESCE($11,false),COALESCE($12,false),COALESCE($13,false),$14,$15,$16,$17)
         RETURNING id`,
        [
          tenantId, d.codigo, d.nombre, d.principioActivo ?? null, d.concentracion ?? null,
          d.categoria ?? null, d.linea, d.cabys ?? null, d.tarifa ?? null, d.unidadBase,
          d.receta, d.controlado, d.frio, d.vidaApertura ?? null, d.minimo ?? 0,
          d.reorden ?? 0, d.proveedor ?? null,
        ]
      )
    ).rows[0].id;

  const crearPresentacion = async (
    productoId: string,
    d: Record<string, unknown>
  ) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                         unidad_medida, precio_venta,
                                         para_compra, para_venta, para_consumo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false),COALESCE($9,false),COALESCE($10,false))
         RETURNING id`,
        [
          tenantId, productoId, d.codigo, d.nombre, d.factor, d.unidad, d.precio ?? null,
          d.compra, d.venta, d.consumo,
        ]
      )
    ).rows[0].id;

  // (a) Caja de 20 tabletas que se vende entera o por tableta.
  const amoxi = await crearProducto({
    codigo: "FARM-001", nombre: "Amoxicilina 500 mg comprimidos",
    principioActivo: "Amoxicilina", concentracion: "500 mg", categoria: "Antibióticos",
    linea: "farmacia", cabys: "3564012000000", tarifa: "08", unidadBase: "tableta",
    receta: true, minimo: 40, reorden: 80, proveedor,
  });
  const amoxiCaja = await crearPresentacion(amoxi, {
    codigo: "1001", nombre: "Caja de 20 tabletas", factor: 20, unidad: "Unid",
    precio: 9000, compra: true, venta: true,
  });
  const amoxiTableta = await crearPresentacion(amoxi, {
    codigo: "1002", nombre: "Tableta", factor: 1, unidad: "Unid",
    precio: 600, venta: true, consumo: true,
  });

  // (b) Litro de alcohol con dosis de 100 ml, con vida útil tras abrir.
  const alcohol = await crearProducto({
    codigo: "INS-001", nombre: "Alcohol etílico 70%", categoria: "Insumos clínicos",
    linea: "farmacia", cabys: "3549900000000", tarifa: "08", unidadBase: "ml",
    vidaApertura: 30, minimo: 500, reorden: 1500, proveedor,
  });
  const alcoholLitro = await crearPresentacion(alcohol, {
    codigo: "2001", nombre: "Litro", factor: 1000, unidad: "L",
    precio: 4500, compra: true, venta: true,
  });
  const alcoholDosis = await crearPresentacion(alcohol, {
    codigo: "2002", nombre: "Dosis de 100 ml", factor: 100, unidad: "mL",
    precio: 700, venta: true, consumo: true,
  });

  // (c) Paquete de 1 kg de algodón que se consume por gramo.
  const algodon = await crearProducto({
    codigo: "INS-002", nombre: "Algodón hidrófilo", categoria: "Insumos clínicos",
    linea: "farmacia", cabys: "2679900000000", tarifa: "08", unidadBase: "g",
    minimo: 300, reorden: 700, proveedor,
  });
  const algodonKilo = await crearPresentacion(algodon, {
    codigo: "3001", nombre: "Paquete de 1 kg", factor: 1000, unidad: "Kg",
    precio: 6500, compra: true, venta: true,
  });
  const algodonGramo = await crearPresentacion(algodon, {
    codigo: "3002", nombre: "Gramo", factor: 1, unidad: "G", consumo: true,
  });

  // Un cuarto producto, que va a quedar BAJO EL MÍNIMO.
  const jeringa = await crearProducto({
    codigo: "INS-003", nombre: "Jeringa descartable 5 ml", categoria: "Insumos clínicos",
    linea: "farmacia", cabys: "4815001010100", tarifa: "08", unidadBase: "unidad",
    minimo: 100, reorden: 200, proveedor,
  });
  const jeringaCaja = await crearPresentacion(jeringa, {
    codigo: "4001", nombre: "Caja de 100", factor: 100, unidad: "Unid",
    precio: 18000, compra: true,
  });
  const jeringaUnidad = await crearPresentacion(jeringa, {
    codigo: "4002", nombre: "Unidad", factor: 1, unidad: "Unid",
    precio: 250, venta: true, consumo: true,
  });

  for (const [p, pres] of [
    [amoxi, amoxiCaja], [alcohol, alcoholLitro], [algodon, algodonKilo], [jeringa, jeringaCaja],
  ] as Array<[string, string]>) {
    await pool.query(
      `INSERT INTO inv_proveedor_productos (tenant_id, proveedor_id, producto_id,
                                            presentacion_compra_id, ultimo_costo)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, proveedor, p, pres, 0]
    );
  }
  console.log("  4 productos con 8 presentaciones, vinculados al proveedor");

  // -------------------------------------------------------------------
  paso("3. Los trece tipos de movimiento");
  //
  // El orden importa: primero entra stock, después sale. Cada tipo se
  // usa al menos una vez, y algunos con paciente y otros sin.
  const mover = (s: Parameters<typeof registrarMovimiento>[2]) =>
    conAlcanceTenant(tenantId, (db) =>
      registrarMovimiento(db, tenantId, { personaId: persona, ...s })
    );

  // (1) Inventario inicial — tres lotes con vencimientos DISTINTOS.
  await mover({
    tipo: "inventario_inicial", productoId: amoxi, bodegaId: bodega, cantidadBase: 120,
    lote: { numero: "AMX-2025-A", vencimiento: enDias(400), costoUnitario: 330 },
    motivoDetalle: "Carga inicial del inventario",
  });
  await mover({
    tipo: "inventario_inicial", productoId: amoxi, bodegaId: bodega, cantidadBase: 60,
    // POR VENCER: a 21 días, así cae en la alerta de 30.
    lote: { numero: "AMX-2025-B", vencimiento: enDias(21), costoUnitario: 310 },
    motivoDetalle: "Carga inicial del inventario",
  });
  await mover({
    tipo: "inventario_inicial", productoId: alcohol, bodegaId: bodega, cantidadBase: 3000,
    lote: { numero: "ALC-2026-A", vencimiento: enDias(700), costoUnitario: 3.2 },
  });
  await mover({
    tipo: "inventario_inicial", productoId: algodon, bodegaId: bodega, cantidadBase: 2000,
    lote: { numero: "ALG-2026-A", vencimiento: enDias(900), costoUnitario: 5.5 },
  });
  await mover({
    tipo: "inventario_inicial", productoId: jeringa, bodegaId: bodega, cantidadBase: 300,
    lote: { numero: "JER-2026-A", costoUnitario: 160 },
  });

  // (2) Compra — llega en la orden de más abajo, pero una suelta
  //     también, para que el tipo tenga su movimiento propio.
  await mover({
    tipo: "compra", productoId: algodon, bodegaId: bodega, presentacionId: algodonKilo,
    cantidadPresentacion: 1,
    lote: { numero: "ALG-2026-B", vencimiento: enDias(850), costoUnitario: 5.8 },
  });

  // (6) Venta — de mostrador, SIN paciente.
  await mover({
    tipo: "venta", productoId: amoxi, bodegaId: bodega,
    presentacionId: amoxiCaja, cantidadPresentacion: 1,
  });
  await mover({
    tipo: "venta", productoId: alcohol, bodegaId: bodega,
    presentacionId: alcoholDosis, cantidadPresentacion: 1,
  });

  // (3) Devolución de cliente — vuelve al lote del que salió.
  await mover({
    tipo: "devolucion_cliente", productoId: amoxi, bodegaId: bodega,
    presentacionId: amoxiTableta, cantidadPresentacion: 4,
    lote: { numero: "AMX-2025-B" },
    motivoDetalle: "El tutor devolvió 4 tabletas sin abrir",
  });

  // (7) Atención — CON paciente.
  if (paciente) {
    await mover({
      tipo: "atencion", productoId: amoxi, bodegaId: bodega,
      presentacionId: amoxiTableta, cantidadPresentacion: 10, pacienteId: paciente,
      motivoDetalle: "Tratamiento de 5 días",
    });
    await mover({
      tipo: "atencion", productoId: jeringa, bodegaId: bodega,
      presentacionId: jeringaUnidad, cantidadPresentacion: 2, pacienteId: paciente,
    });
  }

  // (8) Consumo interno — SIN paciente. Abre el envase de alcohol.
  await mover({
    tipo: "consumo_interno", productoId: alcohol, bodegaId: bodega,
    presentacionId: alcoholDosis, cantidadPresentacion: 3,
    motivoDetalle: "Consumo general del quirófano",
  });
  await mover({
    tipo: "consumo_interno", productoId: algodon, bodegaId: bodega,
    presentacionId: algodonGramo, cantidadPresentacion: 150,
    motivoDetalle: "Curaciones de la semana",
  });

  // (9) Merma.
  await mover({
    tipo: "merma", productoId: alcohol, bodegaId: bodega, cantidadBase: 200,
    motivo: "derrame", motivoDetalle: "Se volcó un frasco al trasladarlo",
  });

  // (10) Vencimiento.
  await mover({
    tipo: "vencimiento", productoId: algodon, bodegaId: bodega, cantidadBase: 50,
    motivo: "vencido", motivoDetalle: "Paquete abierto fuera de fecha",
  });

  // (13) Devolución a proveedor.
  await mover({
    tipo: "devolucion_proveedor", productoId: jeringa, bodegaId: bodega, cantidadBase: 20,
    motivo: "rotura", motivoDetalle: "Llegaron con el empaque roto",
  });

  // (5) y (12) Traslado: los dos lados de una vez.
  await conAlcanceTenant(tenantId, (db) =>
    registrarTraslado(db, tenantId, {
      productoId: algodon, bodegaOrigenId: bodega, bodegaDestinoId: quirofano,
      cantidadBase: 400, personaId: persona,
      motivoDetalle: "Reposición del quirófano",
    })
  );

  // (4) y (11) Ajustes: uno chico que se aplica solo…
  await conAlcanceTenant(tenantId, (db) =>
    solicitarAjuste(db, tenantId, {
      tipo: "positivo", motivo: "producto_encontrado",
      lineas: [{ productoId: algodon, bodegaId: bodega, cantidadBase: 30 }],
      solicitadoPor: persona,
    })
  );
  // … otro NEGATIVO chico, que también se aplica solo: así el tipo
  // `ajuste_negativo` tiene su movimiento en el kardex. El grande de
  // abajo queda pendiente y por eso todavía NO mueve nada.
  await conAlcanceTenant(tenantId, (db) =>
    solicitarAjuste(db, tenantId, {
      tipo: "negativo", motivo: "rotura",
      motivoDetalle: "Dos tabletas se partieron al abrir el blíster",
      lineas: [{ productoId: amoxi, bodegaId: bodega, cantidadBase: 2 }],
      solicitadoPor: persona,
    })
  );

  // … y uno grande que queda PENDIENTE DE APROBACIÓN.
  const pendiente = await conAlcanceTenant(tenantId, (db) =>
    solicitarAjuste(db, tenantId, {
      tipo: "negativo", motivo: "diferencia_conteo",
      motivoDetalle: "El conteo del viernes no cuadró con el sistema",
      lineas: [{ productoId: amoxi, bodegaId: bodega, cantidadBase: 40 }],
      solicitadoPor: persona,
    })
  );
  console.log(
    `  ajuste pendiente: ${pendiente.id} — vale ₡${Math.round(Number(pendiente.valor))} ` +
      `contra un umbral de ₡${Math.round(Number(pendiente.umbral))}, ` +
      `${pendiente.requiereAprobacion ? "espera aprobación" : "se aplicó solo"}`
  );

  const tipos = await pool.query<{ n: string }>(
    `SELECT count(DISTINCT tipo)::text AS n FROM inv_movimientos WHERE tenant_id = $1`,
    [tenantId]
  );
  console.log(`  tipos de movimiento usados: ${tipos.rows[0].n} de 13`);
  if (Number(tipos.rows[0].n) < 13) {
    const faltan = await pool.query<{ codigo: string }>(
      `SELECT codigo FROM inv_tipos_movimiento
        WHERE codigo NOT IN (SELECT DISTINCT tipo FROM inv_movimientos WHERE tenant_id = $1)
        ORDER BY orden`,
      [tenantId]
    );
    console.log(`  ATENCIÓN: faltan ${faltan.rows.map((f) => f.codigo).join(", ")}`);
  }

  // -------------------------------------------------------------------
  paso("4. Un producto bajo el mínimo");
  // La jeringa arrancó en 300, salieron 22 y 20: quedan 258 y el mínimo
  // es 100. Hay que bajarla a propósito para que la alerta tenga a quién
  // mostrar, y se hace por una venta real, no tocando la tabla.
  await mover({
    tipo: "venta", productoId: jeringa, bodegaId: bodega,
    presentacionId: jeringaUnidad, cantidadPresentacion: 190,
  });
  const jer = await pool.query<{ t: string }>(
    `SELECT COALESCE(sum(cantidad),0)::text AS t FROM inv_lotes WHERE producto_id = $1`,
    [jeringa]
  );
  console.log(`  jeringas: quedan ${jer.rows[0].t} con mínimo 100 → bajo el mínimo`);

  // -------------------------------------------------------------------
  paso("5. Un envase abierto");
  const abiertos = await pool.query<{ numero: string; vence: string }>(
    `SELECT numero, to_char(vencimiento_efectivo,'YYYY-MM-DD') AS vence
       FROM inv_lotes WHERE tenant_id = $1 AND fecha_apertura IS NOT NULL`,
    [tenantId]
  );
  for (const a of abiertos.rows) {
    console.log(`  lote ${a.numero} abierto · vencimiento efectivo ${a.vence}`);
  }

  // -------------------------------------------------------------------
  paso("6. Órdenes de compra: una sugerida y otra recibida parcialmente");
  const sugerida = await conAlcanceTenant(tenantId, (db) =>
    sugerirOrden(db, tenantId, proveedor)
  );
  if (sugerida.length > 0) {
    const o1 = await conAlcanceTenant(tenantId, (db) =>
      crearOrden(db, tenantId, {
        proveedorId: proveedor, bodegaId: bodega, estado: "sugerida", creadoPor: persona,
        lineas: sugerida.map((l) => ({
          productoId: l.productoId, presentacionId: l.presentacionId,
          cantidadPedida: l.cantidadPedida, costoUnitario: l.costoUnitario,
          explicacion: l.explicacion,
        })),
      })
    );
    console.log(`  orden #${o1.numero} SUGERIDA con ${sugerida.length} línea(s)`);
    for (const l of sugerida) console.log(`    · ${l.explicacion}`);
  } else {
    console.log("  (la sugerida no propuso nada: la existencia alcanza para el consumo medido)");
  }

  const o2 = await conAlcanceTenant(tenantId, (db) =>
    crearOrden(db, tenantId, {
      proveedorId: proveedor, bodegaId: bodega, estado: "aprobada", creadoPor: persona,
      lineas: [
        { productoId: amoxi, presentacionId: amoxiCaja, cantidadPedida: 6, costoUnitario: 340,
          explicacion: "Reposición mensual de antibiótico" },
        { productoId: jeringa, presentacionId: jeringaCaja, cantidadPedida: 4, costoUnitario: 160,
          explicacion: "Quedó bajo el mínimo" },
      ],
    })
  );
  const lineasO2 = await pool.query<{ id: string; producto_id: string }>(
    `SELECT id, producto_id FROM inv_orden_compra_lineas WHERE orden_id = $1`,
    [o2.id]
  );
  const lineaAmoxi = lineasO2.rows.find((l) => l.producto_id === amoxi)!;
  const parcial = await conAlcanceTenant(tenantId, (db) =>
    recibirOrden(db, tenantId, o2.id, {
      // Llegan 4 de las 6 cajas de amoxicilina y ninguna jeringa.
      lineas: [
        {
          lineaId: lineaAmoxi.id, cantidadRecibida: 4,
          lote: { numero: "AMX-2026-C", vencimiento: enDias(540) },
          costoUnitario: 345,
        },
      ],
      facturaProveedor: "DV-0098451",
      personaId: persona,
    })
  );
  console.log(
    `  orden #${o2.numero} quedó "${parcial.estado}" — faltan ` +
      parcial.diferencias.map((d) => `${d.producto}: ${d.faltanBase}`).join(", ")
  );

  // -------------------------------------------------------------------
  paso("7. Un servicio con su receta de insumos");
  const servicio = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_servicios (tenant_id, codigo, nombre, linea_negocio, especialidad,
                                  codigo_cabys, codigo_tarifa_iva, precio, duracion_min)
       VALUES ($1,'SRV-001','Castración de gata','cirugia','medicina_general',
               '8351000000000','04',55000,90) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  for (const [presentacionId, cantidad] of [
    [alcoholDosis, 1],
    [algodonGramo, 25],
    [jeringaUnidad, 3],
  ] as Array<[string, number]>) {
    await pool.query(
      `INSERT INTO inv_servicio_insumos (tenant_id, servicio_id, presentacion_id, cantidad)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, servicio, presentacionId, cantidad]
    );
  }
  console.log("  servicio 'Castración de gata' con 3 insumos en su receta");

  // -------------------------------------------------------------------
  paso("Resumen");
  const resumen = await pool.query(
    `SELECT p.nombre, p.unidad_base,
            COALESCE(sum(l.cantidad),0)::text AS existencia,
            p.minimo::text,
            to_char(min(l.vencimiento_efectivo),'YYYY-MM-DD') AS proximo_vencimiento
       FROM inv_productos p LEFT JOIN inv_lotes l ON l.producto_id = p.id
      WHERE p.tenant_id = $1 GROUP BY p.id ORDER BY p.nombre`,
    [tenantId]
  );
  console.table(resumen.rows);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
