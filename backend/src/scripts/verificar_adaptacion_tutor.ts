// La barrera estructural de la adaptación para el tutor.
//
// Es una función pura, así que se verifica sin llamar al modelo: se le dan
// respuestas adaptadas que hacen lo que está prohibido y se comprueba que
// gane el original. El prompt es lo único que puede impedir que un
// pronóstico se suavice; ESTO es lo que impide que se agregue o se borre
// contenido, y eso sí se puede probar.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/verificar_adaptacion_tutor.ts
import { mezclarConservandoForma } from "../adaptarInformeTutor";

let ok = 0;
let fallos = 0;
function afirmar(condicion: boolean, descripcion: string, detalle?: unknown): void {
  if (condicion) {
    ok++;
    console.log(`  [OK]    ${descripcion}`);
  } else {
    fallos++;
    console.log(`  [FALLA] ${descripcion}${detalle !== undefined ? `\n          ${JSON.stringify(detalle)}` : ""}`);
  }
}

const mezclar = (o: any, a: any, esquema?: any) => {
  const d: string[] = [];
  return { r: mezclarConservandoForma(o, a, esquema, "", d), d };
};

// Esquema mínimo para el caso 5: `nivel` es vocabulario cerrado, `texto` no.
const ESQUEMA_PRONOSTICO = {
  type: "object",
  properties: {
    pronostico: {
      type: "object",
      properties: {
        texto: { type: "string" },
        nivel: { type: "string", enum: ["favorable", "reservado", "grave"] },
      },
    },
  },
};

function main() {
  console.log("\n1. Lo que SÍ tiene que dejar pasar: texto reformulado");
  {
    const { r, d } = mezclar(
      { historia_clinica: "Paciente con emesis aguda de 72 h de evolución." },
      { historia_clinica: "Tu perro viene vomitando desde hace tres días." }
    );
    afirmar(r.historia_clinica === "Tu perro viene vomitando desde hace tres días.", "el texto adaptado reemplaza al técnico");
    afirmar(d.length === 0, "y no descarta nada", d);
  }

  console.log("\n2. Contenido clínico AGREGADO — lo prohibido más grave");
  {
    const original = { diagnostico_diferencial: [{ diagnostico: "Gastritis", probabilidad: "alta" }] };
    const { r, d } = mezclar(original, {
      diagnostico_diferencial: [
        { diagnostico: "Gastritis", probabilidad: "alta" },
        { diagnostico: "Linfoma gástrico", probabilidad: "baja" },
      ],
    });
    afirmar(r.diagnostico_diferencial.length === 1, "un diagnóstico agregado NO entra al informe del tutor");
    afirmar(d.length === 1 && d[0].includes("2 vs 1"), "y queda registrado por qué se descartó", d);
  }

  console.log("\n3. Advertencia BORRADA");
  {
    const original = { recomendaciones: ["Volver si hay sangre en el vómito", "Dieta blanda 5 días"] };
    const { r, d } = mezclar(original, { recomendaciones: ["Dieta blanda 5 días"] });
    afirmar(r.recomendaciones.length === 2, "no se puede eliminar una recomendación");
    afirmar(r.recomendaciones[0].includes("sangre"), "la advertencia sigue estando", r.recomendaciones);
  }

  console.log("\n4. Una sección en null NO se completa");
  {
    const { r, d } = mezclar(
      { evolucion_clinica: null },
      { evolucion_clinica: "Tu mascota viene mejorando mucho." }
    );
    afirmar(r.evolucion_clinica === null, "null significa 'no aplica', y sigue en null");
    afirmar(d.length === 1, "el intento de completarla se descarta", d);
  }

  console.log("\n5. Claves agregadas y valores no textuales");
  {
    const { r, d } = mezclar(
      { pronostico: { texto: "Reservado", nivel: "reservado" } },
      { pronostico: { texto: "Hay que esperar a ver cómo evoluciona", nivel: "favorable", extra: "ánimo" } },
      ESQUEMA_PRONOSTICO
    );
    afirmar(r.pronostico.texto === "Hay que esperar a ver cómo evoluciona", "el texto del pronóstico sí se adapta");
    afirmar(r.pronostico.nivel === "reservado", "pero el NIVEL del pronóstico no se puede cambiar", r.pronostico);
    afirmar(r.pronostico.extra === undefined, "y una clave agregada no entra");
    afirmar(
      d.some((x) => x.includes("nivel") && x.includes("vocabulario cerrado")) && d.some((x) => x.includes("extra")),
      "los dos quedan registrados, el nivel como vocabulario cerrado",
      d
    );
  }

  console.log("\n6. Estructura cambiada de raíz");
  {
    const { r } = mezclar({ apendices: [{ titulo: "A", contenido: "x" }] }, { apendices: "todo junto" });
    afirmar(Array.isArray(r.apendices), "una lista que vuelve como texto se descarta entera");
  }
  {
    const { r } = mezclar({ historia_clinica: "Emesis aguda." }, { historia_clinica: "   " });
    afirmar(r.historia_clinica === "Emesis aguda.", "un texto vacío no reemplaza al original");
  }

  console.log(`\n=== ${ok} OK, ${fallos} fallas ===`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
