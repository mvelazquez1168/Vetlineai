// Muestras en PDF y Excel de todo lo que el sistema exporta.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/muestras_exportaciones.ts /app/muestras
//   docker compose cp backend:/app/muestras docs/reportes/muestras-pdf
//
// POR QUÉ EXISTE: el barrido de exportaciones cambia el encabezado de
// documentos que un cliente recibe —entre ellos la representación
// gráfica de un comprobante electrónico—. Eso no se mira en una
// aserción: se mira en papel. Este script genera un juego de muestras
// con la clínica que tiene logo y con una que no, para poder revisarlas
// antes de que lleguen a alguien.
//
// NO TOCA NADA: solo lee y escribe archivos en el directorio que se le
// pasa.

import fs from "fs";
import path from "path";
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { marcaDeLaClinica } from "../marca/marcaClinica";
import { aExcel, aPdf } from "../exportacion/tabla";
import { generarPdfReceta } from "../routes/recetas.routes";
import { generarPdfReporteAtenciones } from "../reporteAtencionesPdf";
import { pdfDeComprobante } from "../facturacion/entrega";

const destino = process.argv[2] ?? "/app/muestras";

const TABLA_EJEMPLO = {
  titulo: "Kardex del producto",
  subtitulo: "Del 2026-11-01 al 2026-11-27 · bodega: Principal · todos los movimientos",
  columnas: [
    { clave: "fecha", titulo: "Fecha", tipo: "fecha" as const },
    { clave: "tipo", titulo: "Movimiento" },
    { clave: "lote", titulo: "Lote" },
    { clave: "cantidad", titulo: "Cantidad", tipo: "numero" as const },
    { clave: "costo", titulo: "Costo unitario", tipo: "dinero" as const },
    { clave: "total", titulo: "Total", tipo: "dinero" as const },
  ],
  filas: [
    { fecha: "2026-11-02", tipo: "Compra", lote: "L-2291", cantidad: 60, costo: 1200, total: 72000 },
    { fecha: "2026-11-05", tipo: "Atención", lote: "L-2291", cantidad: -2, costo: 1200, total: -2400 },
    { fecha: "2026-11-09", tipo: "Venta de mostrador", lote: "L-2291", cantidad: -1, costo: 1200, total: -1200 },
    { fecha: "2026-11-21", tipo: "Merma por vencimiento", lote: "L-2290", cantidad: -3, costo: 1200, total: -3600 },
  ],
};

async function main() {
  fs.mkdirSync(destino, { recursive: true });

  // LA QUE TIENE LOGO **Y** COMPROBANTES: la muestra del comprobante es
  // la que el dueño del producto más necesita ver en papel, así que se
  // elige la clínica que pueda producirla.
  const clinicas = await pool.query<{ id: string; nombre: string; logo_url: string | null }>(
    `SELECT t.id, t.nombre, t.logo_url FROM tenants t
      WHERE t.logo_url IS NOT NULL
      ORDER BY (SELECT count(*) FROM fact_comprobantes f WHERE f.tenant_id = t.id) DESC,
               t.creado_en
      LIMIT 1`
  );
  const sinLogo = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM tenants WHERE logo_url IS NULL ORDER BY creado_en LIMIT 1`
  );

  const casos: Array<{ id: string; nombre: string; etiqueta: string }> = [];
  if (clinicas.rows[0]) {
    casos.push({ ...clinicas.rows[0], etiqueta: "con-logo" });
  }
  if (sinLogo.rows[0]) {
    casos.push({ ...sinLogo.rows[0], etiqueta: "sin-logo" });
  }

  for (const caso of casos) {
    const marca = await conAlcanceTenant(caso.id, (db) => marcaDeLaClinica(db, caso.id));
    const usuario = "Muestra del barrido";
    console.log(`\n${caso.etiqueta}: ${caso.nombre} (primario ${marca.primario})`);

    // --- Una lista cualquiera, en los dos formatos ----------------
    fs.writeFileSync(
      path.join(destino, `lista-${caso.etiqueta}.pdf`),
      await aPdf(TABLA_EJEMPLO, { marca, usuario })
    );
    fs.writeFileSync(
      path.join(destino, `lista-${caso.etiqueta}.xlsx`),
      aExcel(TABLA_EJEMPLO, { marca, usuario })
    );
    console.log("  lista: pdf y xlsx");

    // --- La receta --------------------------------------------------
    fs.writeFileSync(
      path.join(destino, `receta-${caso.etiqueta}.pdf`),
      await generarPdfReceta({
        marca,
        logoBuffer: marca.logo ?? Buffer.alloc(0),
        pacienteNombre: "Kira",
        especie: "Canino",
        raza: "Golden Retriever",
        sexo: "hembra",
        edadAnios: 4,
        propietarioNombre: "Ana Rodríguez",
        medicoNombre: "Dra. Demo Vetline",
        medicoColegiatura: "MV-1234",
        pesoKg: 32.4,
        zonaHoraria: "America/Costa_Rica",
        instruccionesGenerales: "Administrar con comida. No suspender antes de terminar.",
        instruccionesPropietario: "Si vomita, suspender y llamar a la clínica.",
        items: [
          {
            medicamentoNombre: "Amoxicilina 500 mg",
            dosis: "1 comprimido",
            via: "Oral",
            frecuencia: "Cada 12 horas",
            duracion: "7 días",
            cantidad: "14 comprimidos",
            indicaciones: "Con comida",
          },
        ],
      } as never)
    );
    console.log("  receta: pdf");

    // --- El reporte de atenciones -----------------------------------
    fs.writeFileSync(
      path.join(destino, `reporte-atenciones-${caso.etiqueta}.pdf`),
      await generarPdfReporteAtenciones(
        {
          clinica: {
            nombre: caso.nombre,
            nombre_fiscal: null,
            numero_identificacion: "3101234567",
            tipo_identificacion_etiqueta: "Cédula jurídica",
          },
          rango: { desde: new Date("2026-11-01"), hasta: new Date("2026-11-27") },
          generadoPor: usuario,
          generadoEn: new Date(),
          atenciones: [
            {
              id: "1",
              fecha: new Date("2026-11-05"),
              hora_inicio: "09:00:00",
              hora_fin: "09:30:00",
              numero_expediente: 1024,
              colegiatura: "MV-1234",
            },
          ],
          casosSinCita: [],
          totalAtenciones: 1,
          totalesPorMedico: [{ medicoNombre: "Dra. Demo Vetline", total: 1 }],
        } as never,
        marca,
        usuario
      )
    );
    console.log("  reporte de atenciones: pdf");

    // --- El comprobante electrónico, con uno REAL -------------------
    const comprobante = await pool.query<{ id: string; consecutivo: string }>(
      `SELECT id, consecutivo FROM fact_comprobantes
        WHERE tenant_id = $1 AND clave IS NOT NULL AND consecutivo IS NOT NULL
        ORDER BY creado_en DESC LIMIT 1`,
      [caso.id]
    );
    if (comprobante.rows[0]) {
      try {
        fs.writeFileSync(
          path.join(destino, `comprobante-${caso.etiqueta}.pdf`),
          await pdfDeComprobante(caso.id, comprobante.rows[0].id)
        );
        console.log(`  comprobante ${comprobante.rows[0].consecutivo}: pdf`);
      } catch (err) {
        console.log(`  comprobante: NO se pudo generar — ${(err as Error).message}`);
      }
    } else {
      console.log("  comprobante: esta clínica no tiene ninguno emitido");
    }
  }

  console.log(`\nMuestras en ${destino}:`);
  for (const f of fs.readdirSync(destino).sort()) {
    const tam = fs.statSync(path.join(destino, f)).size;
    console.log(`  ${f} — ${tam} bytes`);
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
