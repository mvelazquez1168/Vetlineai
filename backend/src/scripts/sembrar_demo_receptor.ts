// Siembra de DEMOSTRACIÓN de los perfiles de facturación (sección 3 bis
// del prompt 08).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/sembrar_demo_receptor.ts <tenantId>
//
// Deja lo necesario para ver el caso completo en pantalla: una empresa
// marcada como la habitual del cliente, una fundación que también le
// sirve, y un perfil sin ningún cliente ligado (el tercero de paso que
// pidió factura una vez).
//
// RE-CORRIBLE: cada perfil se busca por su identificación antes de
// crearse. No emite comprobantes: la emisión a nombre de la empresa se
// prueba en `verificar_receptor_factura.ts`, y en la demostración se
// hace desde la pantalla, que es donde se quiere mirar.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { crearPerfil, ligarACliente, listarPerfiles } from "../facturacion/perfilesFacturacion";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

async function main() {
  exigirEntornoDeDesarrollo("sembrar_demo_receptor");

  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: … sembrar_demo_receptor.ts <tenantId>");
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

  const clientes = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM propietarios WHERE tenant_id = $1 ORDER BY creado_en LIMIT 2`,
    [tenantId]
  );
  if (clientes.rows.length === 0) {
    console.log("Esta clínica no tiene clientes: no hay a quién ligarle un perfil.");
    await pool.end();
    return;
  }
  const cliente = clientes.rows[0];

  const existentes = await conAlcanceTenant(tenantId, (db) => listarPerfiles(db, tenantId));
  const yaEsta = (cedula: string) =>
    existentes.some((p) => p.numero_identificacion === cedula);

  const aCrear = [
    {
      cedula: "3101456789",
      datos: {
        nombre: "Transportes del Valle S.A.",
        nombreComercial: "Transvalle",
        tipoIdentificacion: "02",
        numeroIdentificacion: "3101456789",
        ubicacionProvincia: "1",
        ubicacionCanton: "01",
        ubicacionDistrito: "01",
        ubicacionOtrasSenas: "Oficentro La Sabana, torre B, piso 3",
        correo: "pagos@transvalle.test",
        telefonoCodigoPais: "506",
        telefonoNumero: "22334455",
        propietarioId: cliente.id,
        esPredeterminado: true,
      },
      nota: `la empresa de ${cliente.nombre}, marcada como la habitual`,
    },
    {
      cedula: "3002887766",
      datos: {
        nombre: "Fundación Patitas Felices",
        tipoIdentificacion: "02",
        numeroIdentificacion: "3002887766",
        ubicacionProvincia: "1",
        ubicacionCanton: "02",
        ubicacionDistrito: "01",
        ubicacionOtrasSenas: "Contiguo al parque de Escazú",
        correo: "tesoreria@patitasfelices.test",
        propietarioId: cliente.id,
      },
      nota: "una fundación que también paga por ese cliente",
    },
    {
      cedula: "3101998877",
      datos: {
        nombre: "Consultores Pérez y Asociados S.A.",
        tipoIdentificacion: "02",
        numeroIdentificacion: "3101998877",
        correo: "admin@perezyasociados.test",
      },
      nota: "sin cliente ligado: el tercero que pidió factura una vez",
    },
  ];

  for (const p of aCrear) {
    if (yaEsta(p.cedula)) {
      console.log(`· ${p.datos.nombre}: ya estaba, no se toca.`);
      continue;
    }
    const r = await conAlcanceTenant(tenantId, (db) => crearPerfil(db, tenantId, p.datos));
    console.log(`· ${p.datos.nombre} — ${p.nota} (${r.id})`);
  }

  // Si hay un segundo cliente, la empresa le sirve también: es el caso
  // de una empresa que paga por varios empleados.
  if (clientes.rows.length > 1) {
    const empresa = (await conAlcanceTenant(tenantId, (db) => listarPerfiles(db, tenantId))).find(
      (p) => p.numero_identificacion === "3101456789"
    );
    if (empresa) {
      await conAlcanceTenant(tenantId, (db) =>
        ligarACliente(db, tenantId, empresa.id, clientes.rows[1].id, false)
      );
      console.log(
        `· la empresa queda ligada también a ${clientes.rows[1].nombre}: un perfil sirve a varios clientes`
      );
    }
  }

  console.log("\nListo. Pantalla: /facturacion/perfiles");
  console.log("Se elige al cobrar (/ventas/cobro) o al emitir (/facturacion/emitir).");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
