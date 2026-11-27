import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";

// ---------------------------------------------------------------------
// HISTORIAL DE DEMOSTRACIÓN DE 12 MESES — prompt 12, §11.
//
//   npm run demo:historial               (la clínica de demostración)
//   npm run demo:historial -- <tenantId>
//
// POR QUÉ EXISTE: un dashboard contra una clínica con dos pacientes no
// se puede verificar. No se ve si la comparación contra el período
// anterior tiene sentido, ni si el drill-down suma, ni si la tendencia
// se dibuja. Con doce meses de historial sí.
//
// LA GUARDA, QUE ES LO PRIMERO QUE HACE: `tenants.es_demostracion`
// tiene que ser `true`. Si no, **se niega y no escribe nada**. Lo que
// este script hace es irreversible en el sentido que importa: una vez
// mezcladas, no hay forma de distinguir una atención inventada de una
// que la clínica registró de verdad. Por eso la guarda no es una
// convención de nombres —que cualquiera cambia desde la pantalla de
// configuración— sino una columna.
//
// ES RE-CORRIBLE: cada mes ya generado se saltea. No borra ni reescribe
// nada, porque no podría: los movimientos de inventario son de solo
// agregar y las atenciones cerradas son inmutables. Correrlo dos veces
// deja la base igual que correrlo una.
// ---------------------------------------------------------------------

const MESES = 12;
const PREFIJO = "Demo ·";

/**
 * Azar REPRODUCIBLE: la misma semilla da el mismo historial.
 *
 * Con `Math.random()`, dos corridas darían clínicas distintas y una
 * aserción del verificador que pase hoy podría fallar mañana sin que
 * nadie haya tocado el código.
 */
function azar(semilla: number) {
  let estado = semilla;
  return {
    siguiente(): number {
      estado = (estado * 1103515245 + 12345) & 0x7fffffff;
      return estado / 0x7fffffff;
    },
    entre(min: number, max: number): number {
      return min + Math.floor(this.siguiente() * (max - min + 1));
    },
    de<T>(lista: T[]): T {
      return lista[Math.floor(this.siguiente() * lista.length)];
    },
    moneda(p: number): boolean {
      return this.siguiente() < p;
    },
  };
}

const NOMBRES = [
  "Ana Rodríguez", "Carlos Jiménez", "María Vargas", "José Mora", "Laura Castro",
  "Luis Hernández", "Sofía Ramírez", "Diego Solano", "Paula Cordero", "Andrés Chaves",
  "Marcela Ureña", "Ricardo Araya", "Gabriela Brenes", "Esteban Rojas", "Valeria Núñez",
  "Óscar Fallas", "Natalia Quesada", "Felipe Alvarado", "Rebeca Sánchez", "Mauricio León",
  "Karla Montero", "Julio Villalobos", "Daniela Pérez", "Alberto Soto", "Fernanda Gómez",
  "Rodrigo Campos", "Silvia Delgado", "Javier Obando", "Patricia Zúñiga", "Alonso Barrantes",
  "Mónica Aguilar", "Guillermo Ramos", "Cecilia Pineda", "Hugo Espinoza", "Rosa Calderón",
  "Pablo Sandoval", "Irene Mendoza", "Tomás Herrera", "Lucía Salas", "Víctor Orozco",
];

const MASCOTAS_PERRO = ["Rocky", "Luna", "Max", "Nala", "Thor", "Mia", "Simba", "Kira", "Toby", "Lola"];
const MASCOTAS_GATO = ["Michi", "Pelusa", "Tom", "Nieve", "Milo", "Canela", "Zeus", "Maya"];

/**
 * Estacionalidad. Diciembre y julio arriba (vacaciones, regalos de
 * mascota), setiembre abajo. No es un adorno: sin estacionalidad, la
 * comparación contra el período anterior sale siempre en 0 % y no se
 * puede ver si la variación se calcula bien.
 */
const ESTACION: Record<number, number> = {
  1: 0.95, 2: 0.9, 3: 1.0, 4: 1.05, 5: 1.0, 6: 1.1,
  7: 1.2, 8: 1.05, 9: 0.85, 10: 0.95, 11: 1.1, 12: 1.3,
};

const SERVICIOS_DEMO = [
  { codigo: "DEMO-CONS", nombre: "Consulta general", linea: "consulta", precio: 25000, minutos: 30 },
  { codigo: "DEMO-CONS-URG", nombre: "Consulta de urgencia", linea: "consulta", precio: 38000, minutos: 45 },
  { codigo: "DEMO-VAC", nombre: "Aplicación de vacuna", linea: "vacunacion", precio: 12000, minutos: 20 },
  { codigo: "DEMO-DESP", nombre: "Desparasitación", linea: "vacunacion", precio: 9000, minutos: 15 },
  { codigo: "DEMO-CAST-P", nombre: "Castración de perro", linea: "cirugia", precio: 85000, minutos: 90 },
  { codigo: "DEMO-CAST-G", nombre: "Castración de gato", linea: "cirugia", precio: 55000, minutos: 60 },
  { codigo: "DEMO-HEMO", nombre: "Hemograma completo", linea: "laboratorio", precio: 18000, minutos: 15 },
  { codigo: "DEMO-RX", nombre: "Radiografía", linea: "imagen", precio: 28000, minutos: 30 },
  { codigo: "DEMO-BANO", nombre: "Baño y corte", linea: "grooming", precio: 15000, minutos: 60 },
  { codigo: "DEMO-PROFI", nombre: "Profilaxis dental", linea: "cirugia", precio: 65000, minutos: 75 },
];

function aFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Días hábiles del mes: la clínica cierra los domingos. */
function diasHabiles(anio: number, mes: number): Date[] {
  const dias: Date[] = [];
  const d = new Date(Date.UTC(anio, mes - 1, 1));
  while (d.getUTCMonth() === mes - 1) {
    if (d.getUTCDay() !== 0) dias.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

async function main() {
  const argumento = process.argv[2];
  const cliente = await pool.connect();
  let tenantId: string;
  let nombreClinica: string;
  try {
    const r = argumento
      ? await cliente.query<{ id: string; nombre: string; es_demostracion: boolean }>(
          `SELECT id, nombre, es_demostracion FROM tenants WHERE id = $1`,
          [argumento]
        )
      : await cliente.query<{ id: string; nombre: string; es_demostracion: boolean }>(
          `SELECT id, nombre, es_demostracion FROM tenants WHERE es_demostracion ORDER BY creado_en LIMIT 1`
        );
    if (r.rows.length === 0) {
      console.error(
        argumento
          ? "No existe esa clínica."
          : "Ninguna clínica está marcada como de demostración (tenants.es_demostracion). " +
              "Marcá la de demostración y volvé a correr; este script NO escribe en una clínica real."
      );
      process.exit(1);
    }
    // LA GUARDA. Antes de leer nada más.
    if (!r.rows[0].es_demostracion) {
      console.error(
        `«${r.rows[0].nombre}» NO está marcada como clínica de demostración.\n` +
          "Este script inventa doce meses de citas, atenciones, cobros y mermas, y una vez " +
          "mezclados no hay forma de distinguirlos de los datos reales. No se escribe nada."
      );
      process.exit(1);
    }
    tenantId = r.rows[0].id;
    nombreClinica = r.rows[0].nombre;
  } finally {
    cliente.release();
  }

  console.log(`Generando historial de demostración para «${nombreClinica}».`);
  const rnd = azar(20261127);
  const resumen = {
    clientes: 0,
    pacientes: 0,
    citas: 0,
    atenciones: 0,
    cuentas: 0,
    cargos: 0,
    cobros: 0,
    compras: 0,
    comprobantes: 0,
    mermas: 0,
    mesesSalteados: 0,
  };

  // --- 1. Maestros: salas, servicios, clientes y pacientes ----------
  const { medicos, salas, servicios, clientes, productos, bodegaId, cajaId, emisorId } =
    await conAlcanceTenant(tenantId, async (db) => {
      const medicos = (
        await db.query<{ id: string }>(
          `SELECT id FROM personas WHERE tenant_id = $1 AND es_medico AND estado = 'activo' ORDER BY nombre`,
          [tenantId]
        )
      ).rows.map((f) => f.id);
      if (medicos.length === 0) throw new Error("La clínica de demostración no tiene médicos.");

      for (const nombre of ["Consultorio 1", "Consultorio 2", "Quirófano"]) {
        await db.query(
          `INSERT INTO salas (tenant_id, nombre, tipo, activa)
           SELECT $1, $2, $3, true
            WHERE NOT EXISTS (SELECT 1 FROM salas WHERE tenant_id = $1 AND nombre = $2)`,
          [tenantId, nombre, nombre === "Quirófano" ? "quirofano" : "consultorio"]
        );
      }
      const salas = (
        await db.query<{ id: string }>(`SELECT id FROM salas WHERE tenant_id = $1`, [tenantId])
      ).rows.map((f) => f.id);

      for (const s of SERVICIOS_DEMO) {
        await db.query(
          `INSERT INTO inv_servicios
             (tenant_id, codigo, nombre, linea_negocio, precio, duracion_min, codigo_tarifa_iva, activo)
           VALUES ($1, $2, $3, $4, $5, $6, '08', true)
           ON CONFLICT DO NOTHING`,
          [tenantId, s.codigo, s.nombre, s.linea, s.precio, s.minutos]
        );
      }
      const servicios = (
        await db.query<{
          id: string;
          nombre: string;
          linea_negocio: string;
          precio: string;
          duracion_min: number | null;
        }>(
          `SELECT id, nombre, linea_negocio, precio, duracion_min
             FROM inv_servicios WHERE tenant_id = $1 AND codigo LIKE 'DEMO-%'`,
          [tenantId]
        )
      ).rows;

      // Clientes y pacientes. El número de expediente se calcula acá
      // porque la columna es obligatoria y la secuencia vive en
      // `tenants.paciente_expediente_ultimo_numero`.
      for (const nombre of NOMBRES) {
        const completo = `${PREFIJO} ${nombre}`;
        const ya = await db.query<{ id: string }>(
          `SELECT id FROM propietarios WHERE tenant_id = $1 AND nombre = $2`,
          [tenantId, completo]
        );
        let propietarioId: string;
        if (ya.rows.length > 0) {
          propietarioId = ya.rows[0].id;
        } else {
          const ins = await db.query<{ id: string }>(
            `INSERT INTO propietarios (tenant_id, nombre, telefono, email)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [
              tenantId,
              completo,
              `8${rnd.entre(1000000, 9999999)}`,
              `demo${NOMBRES.indexOf(nombre)}@ejemplo.test`,
            ]
          );
          propietarioId = ins.rows[0].id;
          resumen.clientes++;
        }

        // DETERMINISTA POR CLIENTE, no del azar compartido: si saliera
        // del azar, cada corrida daría otro número y el script agregaría
        // mascotas en cada ejecución. Eso rompía la re-corribilidad.
        const cuantas = (NOMBRES.indexOf(nombre) % 3 === 0) ? 2 : 1;
        const tiene = (
          await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pacientes WHERE propietario_id = $1`,
            [propietarioId]
          )
        ).rows[0].n;
        for (let i = tiene; i < cuantas; i++) {
          const esPerro = rnd.moneda(0.65);
          const num = await db.query<{ numero: number }>(
            `UPDATE tenants
                SET paciente_expediente_ultimo_numero = COALESCE(paciente_expediente_ultimo_numero, 0) + 1
              WHERE id = $1
              RETURNING paciente_expediente_ultimo_numero AS numero`,
            [tenantId]
          );
          await db.query(
            `INSERT INTO pacientes
               (tenant_id, propietario_id, nombre, especie, sexo, fecha_nacimiento,
                numero_expediente, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'activo')`,
            [
              tenantId,
              propietarioId,
              rnd.de(esPerro ? MASCOTAS_PERRO : MASCOTAS_GATO),
              // El vocabulario único de `pacientes.especie` (migración
              // 165). Este script escribía «perro»/«gato» y era una de
              // las fuentes del desajuste con `razas.especie`.
              esPerro ? "Canino" : "Felino",
              rnd.moneda(0.5) ? "macho" : "hembra",
              aFecha(new Date(Date.UTC(rnd.entre(2016, 2025), rnd.entre(0, 11), rnd.entre(1, 28)))),
              String(num.rows[0].numero).padStart(5, "0"),
            ]
          );
          resumen.pacientes++;
        }
      }

      const clientes = (
        await db.query<{ propietario_id: string; paciente_id: string }>(
          `SELECT pr.id AS propietario_id, pa.id AS paciente_id
             FROM propietarios pr JOIN pacientes pa ON pa.propietario_id = pr.id
            WHERE pr.tenant_id = $1 AND pr.nombre LIKE $2`,
          [tenantId, `${PREFIJO}%`]
        )
      ).rows;

      // Productos con lote y existencia: los que se van a vender.
      const productos = (
        await db.query<{
          producto_id: string;
          presentacion_id: string;
          lote_id: string;
          precio: string;
          factor: string;
          linea: string;
          costo: string;
        }>(
          `SELECT p.id AS producto_id, pre.id AS presentacion_id, l.id AS lote_id,
                  pre.precio_venta::text AS precio, pre.factor::text AS factor,
                  p.linea_negocio AS linea, l.costo_unitario::text AS costo
             FROM inv_productos p
             JOIN inv_presentaciones pre ON pre.producto_id = p.id AND pre.para_venta AND pre.activo
             JOIN inv_lotes l ON l.producto_id = p.id
            WHERE p.tenant_id = $1 AND p.activo AND pre.precio_venta > 0
              AND l.cantidad > 0
            ORDER BY l.cantidad DESC
            LIMIT 25`,
          [tenantId]
        )
      ).rows;

      const bodega = await db.query<{ id: string }>(
        `SELECT id FROM inv_bodegas WHERE tenant_id = $1 ORDER BY es_default DESC LIMIT 1`,
        [tenantId]
      );
      const caja = await db.query<{ id: string }>(
        `SELECT id FROM vta_cajas WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );
      const emisor = await db.query<{ id: string; sucursal: string; terminal: string }>(
        `SELECT id, sucursal, terminal FROM fact_emisores WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );

      return {
        medicos,
        salas,
        servicios,
        clientes,
        productos,
        bodegaId: bodega.rows[0]?.id ?? null,
        cajaId: caja.rows[0]?.id ?? null,
        emisorId: emisor.rows[0]?.id ?? null,
      };
    });

  if (!bodegaId || !cajaId || !emisorId) {
    console.error(
      "La clínica de demostración necesita al menos una bodega, una caja y un emisor de facturación."
    );
    process.exit(1);
  }
  if (productos.length === 0) {
    console.error("La clínica de demostración no tiene productos con precio y existencia.");
    process.exit(1);
  }
  console.log(
    `  maestros: ${clientes.length} pacientes de ${NOMBRES.length} clientes, ` +
      `${servicios.length} servicios, ${productos.length} productos con existencia.`
  );

  // --- 2. Doce meses, uno por transacción ---------------------------
  const hoy = new Date();
  for (let atras = MESES - 1; atras >= 0; atras--) {
    const base = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - atras, 1));
    const anio = base.getUTCFullYear();
    const mes = base.getUTCMonth() + 1;

    const { hecho, conCompras, conMermas } = await conAlcanceTenant(tenantId, async (db) => {
      const ya = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM citas c JOIN pacientes pa ON pa.id = c.paciente_id
           JOIN propietarios pr ON pr.id = pa.propietario_id
          WHERE c.tenant_id = $1 AND pr.nombre LIKE $2
            AND date_trunc('month', c.fecha) = make_date($3, $4, 1)`,
        [tenantId, `${PREFIJO}%`, anio, mes]
      );
      const mov = await db.query<{ compras: number; mermas: number }>(
        `SELECT count(*) FILTER (WHERE tipo = 'compra')::int AS compras,
                count(*) FILTER (WHERE tipo = 'merma')::int AS mermas
           FROM inv_movimientos
          WHERE tenant_id = $1 AND date_trunc('month', creado_en) = make_date($2, $3, 1)`,
        [tenantId, anio, mes]
      );
      return {
        hecho: ya.rows[0].n > 0,
        conCompras: mov.rows[0].compras > 0,
        conMermas: mov.rows[0].mermas > 0,
      };
    });
    if (hecho && conCompras && conMermas) {
      resumen.mesesSalteados++;
      console.log(`  ${anio}-${String(mes).padStart(2, "0")}: ya estaba generado, se saltea.`);
      continue;
    }

    const dias = diasHabiles(anio, mes).filter((d) => d <= hoy);
    if (dias.length === 0) continue;
    const factor = ESTACION[mes] ?? 1;
    const citasDelMes = Math.round(dias.length * 2.2 * factor);

    /** Una a tres mermas del mes, con su motivo. */
    const mermasDelMes = async (db: import("pg").PoolClient) => {
      for (let i = 0; i < rnd.entre(1, 3); i++) {
        const prod = rnd.de(productos);
        await db.query("SAVEPOINT merma");
        try {
          await db.query(
            `INSERT INTO inv_movimientos
               (tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base,
                costo_unitario, motivo, motivo_detalle, persona_id, creado_en)
             VALUES ($1, 'merma', $2, $3, $4, $5, $6, 'vencido',
                     'Vencimiento detectado en la revisión mensual', $7, $8)`,
            [
              tenantId,
              prod.producto_id,
              bodegaId,
              prod.lote_id,
              rnd.entre(1, 2),
              prod.costo,
              medicos[0],
              `${anio}-${String(mes).padStart(2, "0")}-28T17:00:00Z`,
            ]
          );
          await db.query("RELEASE SAVEPOINT merma");
          resumen.mermas++;
        } catch (err) {
          // Lote agotado: no se fuerza. El inventario no admite stock
          // negativo y forzarlo acá sería mentirle al kardex.
          //
          // SE AVISA, no se traga: un catch mudo acá escondió que el
          // motivo 'vencimiento' no existía en `inv_motivos` (es
          // 'vencido') y el script decía «listo» con cero mermas.
          await db.query("ROLLBACK TO SAVEPOINT merma");
          console.warn(
            `    merma no registrada (${prod.producto_id}): ${
              err instanceof Error ? err.message : err
            }`
          );
        }
      }
    };

    await conAlcanceTenant(tenantId, async (db) => {
      // UNA SESIÓN DE CAJA POR MES. Los cobros exigen sesión abierta
      // (trigger `vta_cobros_sesion_abierta`), así que se abre, se
      // cobra y se cierra: es el ciclo real, condensado.
      // SI LA CAJA YA TIENE UNA SESIÓN ABIERTA, se usa esa: la clínica
      // de demostración puede tener una abierta de antes, y un índice
      // único impide dos abiertas por caja —que es correcto, no un
      // estorbo—. En ese caso NO se cierra al final: cerrar la sesión
      // de otro sería tocar datos que este script no creó.
      const abierta = await db.query<{ id: string }>(
        `SELECT id FROM vta_sesiones_caja
          WHERE tenant_id = $1 AND caja_id = $2 AND estado = 'abierta' LIMIT 1`,
        [tenantId, cajaId]
      );
      const sesionAjena = abierta.rows.length > 0;
      const sesionId = sesionAjena
        ? abierta.rows[0].id
        : (
            await db.query<{ id: string }>(
              `INSERT INTO vta_sesiones_caja
                 (tenant_id, caja_id, estado, abierta_por, abierta_en, fondo_crc)
               VALUES ($1, $2, 'abierta', $3, $4, 50000) RETURNING id`,
              [tenantId, cajaId, medicos[0], `${anio}-${String(mes).padStart(2, "0")}-01T08:00:00Z`]
            )
          ).rows[0].id;

      // LA COMPRA DEL MES, antes de vender. Es el ciclo real de una
      // clínica —se repone a principio de mes— y además es lo que deja
      // existencia: sin esto, las salidas del mes chocan con el tope de
      // stock y los ítems salen sin costo.
      if (!conCompras) {
        for (const prod of productos) {
          await db.query(
            `INSERT INTO inv_movimientos
               (tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base,
                costo_unitario, persona_id, creado_en)
             VALUES ($1, 'compra', $2, $3, $4, $5, $6, $7, $8)`,
            [
              tenantId,
              prod.producto_id,
              bodegaId,
              prod.lote_id,
              60 * Number(prod.factor),
              prod.costo,
              medicos[0],
              `${anio}-${String(mes).padStart(2, "0")}-01T09:00:00Z`,
            ]
          );
          resumen.compras++;
        }
      }

      if (hecho) {
        // El mes ya tenía su actividad: lo que faltaba eran las compras
        // y las mermas, que se acaban de agregar. No se duplican citas.
        if (!conMermas) await mermasDelMes(db);
        if (!sesionAjena) {
          await db.query(
            `UPDATE vta_sesiones_caja
                SET estado = 'cerrada', cerrada_en = $2, cerrada_por = $3
              WHERE id = $1`,
            [sesionId, `${anio}-${String(mes).padStart(2, "0")}-28T18:00:00Z`, medicos[0]]
          );
        }
        return;
      }

      for (let i = 0; i < citasDelMes; i++) {
        const dia = rnd.de(dias);
        const hora = rnd.entre(8, 17);
        const servicio = rnd.de(servicios);
        const cliente = rnd.de(clientes);
        const medicoId = rnd.de(medicos);
        const minutos = servicio.duracion_min ?? 30;
        const fecha = aFecha(dia);
        const inicio = `${String(hora).padStart(2, "0")}:00`;
        const fin = `${String(hora + Math.ceil(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

        // El reparto de estados es el que una clínica real tiene: la
        // mayoría se atiende, una de cada doce no se presenta y una de
        // cada catorce cancela con aviso.
        const dado = rnd.siguiente();
        const estado =
          dado < 0.78 ? "completada" : dado < 0.86 ? "no_show" : dado < 0.93 ? "cancelada" : "completada";

        const cita = await db.query<{ id: string }>(
          `INSERT INTO citas
             (tenant_id, sala_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin,
              duracion_minutos, estado, motivo_consulta, motivo_cancelacion, creado_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [
            tenantId,
            rnd.de(salas),
            cliente.paciente_id,
            medicoId,
            fecha,
            inicio,
            fin,
            minutos,
            estado,
            servicio.nombre,
            estado === "cancelada" ? rnd.de(["Se enfermó el dueño", "Reprogramó", "Viaje"]) : null,
            `${fecha}T07:00:00Z`,
          ]
        );
        resumen.citas++;
        if (estado !== "completada") continue;

        // --- La atención, ya cerrada --------------------------------
        const cerrada = `${fecha}T${String(hora).padStart(2, "0")}:45:00Z`;
        const atencion = await db.query<{ id: string }>(
          `INSERT INTO atenciones
             (tenant_id, cita_id, paciente_id, medico_id, estado, tipo_consulta,
              motivo_consulta, peso, temperatura, creado_en, cerrada_en,
              control_fecha, control_motivo)
           VALUES ($1, $2, $3, $4, 'cerrada', $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [
            tenantId,
            cita.rows[0].id,
            cliente.paciente_id,
            medicoId,
            servicio.linea_negocio === "cirugia" ? "cirugia" : "consulta",
            servicio.nombre,
            (rnd.entre(30, 400) / 10).toFixed(2),
            (rnd.entre(375, 392) / 10).toFixed(1),
            `${fecha}T${String(hora).padStart(2, "0")}:05:00Z`,
            cerrada,
            // Un control recomendado en una de cada cuatro atenciones:
            // es lo que llena «recomendaciones no agendadas» del §3.
            rnd.moneda(0.25)
              ? aFecha(new Date(dia.getTime() + rnd.entre(14, 90) * 86400000))
              : null,
            rnd.moneda(0.25) ? "Control de seguimiento" : null,
          ]
        );
        resumen.atenciones++;

        // --- La cuenta, sus cargos y su cobro -----------------------
        // `vta_cuentas.numero` es un ENTERO por clínica, no un texto.
        const numero = await db.query<{ numero: number }>(
          `SELECT COALESCE(max(numero), 0) + 1 AS numero
             FROM vta_cuentas WHERE tenant_id = $1`,
          [tenantId]
        );
        const cuenta = await db.query<{ id: string }>(
          `INSERT INTO vta_cuentas
             (tenant_id, numero, propietario_id, estado, sesion_id, abierta_en)
           VALUES ($1, $2, $3, 'abierta', $4, $5) RETURNING id`,
          [tenantId, numero.rows[0].numero, cliente.propietario_id, sesionId, cerrada]
        );
        resumen.cuentas++;

        let neto = 0;
        const precioServicio = Number(servicio.precio);
        await db.query(
          `INSERT INTO vta_cargos
             (tenant_id, cuenta_id, origen, origen_id, servicio_id, descripcion, paciente_id,
              cantidad, precio_unitario, linea_negocio, codigo_tarifa_iva, creado_por,
              realizado_por, creado_en)
           VALUES ($1, $2, 'atencion', $3, $4, $5, $6, 1, $7, $8, '08', $9, $9, $10)`,
          [
            tenantId,
            cuenta.rows[0].id,
            atencion.rows[0].id,
            servicio.id,
            servicio.nombre,
            cliente.paciente_id,
            precioServicio,
            servicio.linea_negocio,
            medicoId,
            cerrada,
          ]
        );
        neto += precioServicio;
        resumen.cargos++;

        // Uno o dos productos, con su movimiento de inventario: así el
        // margen tiene costo y la trazabilidad tiene a quién mostrar.
        const cuantosProductos = rnd.moneda(0.55) ? rnd.entre(1, 2) : 0;
        for (let k = 0; k < cuantosProductos; k++) {
          const prod = rnd.de(productos);
          const cantidad = rnd.entre(1, 2);
          const precio = Number(prod.precio);
          let movimientoId: string | null = null;
          // SAVEPOINT y no solo try/catch: cuando el lote se agota, el
          // trigger de stock negativo aborta la TRANSACCIÓN entera, no
          // solo la sentencia. Sin el punto de retorno, atrapar el error
          // deja la transacción muerta y lo que sigue falla con
          // «current transaction is aborted».
          await db.query("SAVEPOINT mov");
          try {
            const mov = await db.query<{ id: string }>(
              `INSERT INTO inv_movimientos
                 (tenant_id, tipo, producto_id, bodega_id, lote_id, cantidad_base,
                  presentacion_id, cantidad_presentacion, costo_unitario, paciente_id,
                  atencion_id, persona_id, creado_en)
               VALUES ($1, 'atencion', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               RETURNING id`,
              [
                tenantId,
                prod.producto_id,
                bodegaId,
                prod.lote_id,
                cantidad * Number(prod.factor),
                prod.presentacion_id,
                cantidad,
                prod.costo,
                cliente.paciente_id,
                atencion.rows[0].id,
                medicoId,
                cerrada,
              ]
            );
            movimientoId = mov.rows[0].id;
            await db.query("RELEASE SAVEPOINT mov");
          } catch {
            await db.query("ROLLBACK TO SAVEPOINT mov");
            // El lote se agotó: el cargo va igual, sin movimiento. Es lo
            // que pasa en la realidad con un servicio sin producto, y
            // deja ítems SIN COSTO, que es justamente el caso que la
            // pantalla tiene que mostrar como «sin costo».
          }
          await db.query(
            `INSERT INTO vta_cargos
               (tenant_id, cuenta_id, origen, origen_id, presentacion_id, descripcion,
                paciente_id, cantidad, precio_unitario, linea_negocio, codigo_tarifa_iva,
                movimiento_id, creado_por, realizado_por, creado_en)
             VALUES ($1, $2, 'atencion', $3, $4, $5, $6, $7, $8, $9, '08', $10, $11, $11, $12)`,
            [
              tenantId,
              cuenta.rows[0].id,
              atencion.rows[0].id,
              prod.presentacion_id,
              "Producto dispensado en la atención",
              cliente.paciente_id,
              cantidad,
              precio,
              prod.linea,
              movimientoId,
              medicoId,
              cerrada,
            ]
          );
          neto += precio * cantidad;
          resumen.cargos++;
        }

        // UNA DE CADA DIEZ CUENTAS QUEDA ABIERTA. No es un descuido del
        // generador: es el dato que hace visible «cargos fugados», que
        // sin cuentas abiertas de verdad se vería siempre en cero.
        if (rnd.moneda(0.1)) continue;

        const conIva = Math.round(neto * 1.13 * 100) / 100;
        const aCredito = rnd.moneda(0.12);

        const comprobante = await db.query<{ id: string }>(
          `INSERT INTO fact_comprobantes
             (tenant_id, emisor_id, tipo_comprobante, clave, consecutivo, sucursal, terminal,
              fecha_emision, condicion_venta, plazo_credito_dias, moneda, tipo_cambio,
              receptor_propietario_id, total_venta, total_venta_neta, total_gravado,
              total_impuesto, total_comprobante, estado, creado_en)
           VALUES ($1, $2, $3, $4, $5, '001', '00001', $6, $7, $8, 'CRC', 1, $9,
                   $10, $10, $10, $11, $12, 'aceptado', $6)
           RETURNING id`,
          [
            tenantId,
            emisorId,
            aCredito ? "01" : "04",
            // La clave son 50 DÍGITOS y el consecutivo 20 (lo exige el
            // CHECK, porque así los define Hacienda). Acá son sintéticos
            // y arrancan con 999 para que no choquen con una clave real.
            `999${String(anio)}${String(mes).padStart(2, "0")}${String(
              resumen.comprobantes + 1
            ).padStart(8, "0")}`.padEnd(50, "7").slice(0, 50),
            `999${String(anio)}${String(mes).padStart(2, "0")}${String(
              resumen.comprobantes + 1
            ).padStart(7, "0")}`.padEnd(20, "0").slice(0, 20),
            cerrada,
            aCredito ? "02" : "01",
            aCredito ? 30 : null,
            cliente.propietario_id,
            neto.toFixed(2),
            (conIva - neto).toFixed(2),
            conIva.toFixed(2),
          ]
        );
        resumen.comprobantes++;

        const cobro = await db.query<{ id: string }>(
          `INSERT INTO vta_cobros
             (tenant_id, cuenta_id, sesion_id, cobrado_por, total, comprobante_id,
              estado, creado_en)
           VALUES ($1, $2, $3, $4, $5, $6, 'aplicado', $7) RETURNING id`,
          [tenantId, cuenta.rows[0].id, sesionId, medicoId, conIva, comprobante.rows[0].id, cerrada]
        );
        const medio = aCredito ? "credito" : rnd.siguiente() < 0.45 ? "01" : rnd.siguiente() < 0.8 ? "02" : "06";
        await db.query(
          `INSERT INTO vta_cobro_medios
             (tenant_id, cobro_id, medio, es_fiscal, moneda, monto, tipo_cambio, monto_crc,
              referencia)
           VALUES ($1, $2, $3, $4, 'CRC', $5, 1, $5, $6)`,
          [
            tenantId,
            cobro.rows[0].id,
            medio,
            medio !== "credito",
            conIva,
            medio === "02" || medio === "06" ? `REF${rnd.entre(100000, 999999)}` : null,
          ]
        );
        await db.query(
          `UPDATE vta_cuentas SET estado = 'cobrada', cerrada_en = $2 WHERE id = $1`,
          [cuenta.rows[0].id, cerrada]
        );
        resumen.cobros++;
      }

      if (!conMermas) await mermasDelMes(db);

      if (!sesionAjena) {
        await db.query(
          `UPDATE vta_sesiones_caja
              SET estado = 'cerrada', cerrada_en = $2, cerrada_por = $3
            WHERE id = $1`,
          [sesionId, `${anio}-${String(mes).padStart(2, "0")}-28T18:00:00Z`, medicos[0]]
        );
      }
    });

    console.log(`  ${anio}-${String(mes).padStart(2, "0")}: ${citasDelMes} citas generadas.`);
  }

  console.log("\nResumen:");
  for (const [k, v] of Object.entries(resumen)) console.log(`  ${k}: ${v}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
