// Script de un solo uso: mapea pacientes.raza (texto libre) a pacientes.raza_id
// contra el catálogo nuevo (migración 009). No se ejecuta en el arranque
// normal — es un paso manual de la migración de razas. No toca la columna
// vieja `raza`, que queda como respaldo hasta que se confirme el resultado.
import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ESPECIE_PACIENTE_A_RAZA: Record<string, string> = {
  Canino: "canina",
  Felino: "felina",
};

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

(async () => {
  try {
    const { rows: pacientes } = await pool.query(
      `SELECT id, nombre, especie, raza FROM pacientes WHERE raza IS NOT NULL AND raza_id IS NULL`
    );
    const { rows: razas } = await pool.query(`SELECT id, especie, nombre FROM razas`);

    const sinMapear: { nombre: string; raza: string }[] = [];

    for (const p of pacientes) {
      const especieRaza = ESPECIE_PACIENTE_A_RAZA[p.especie];
      if (!especieRaza) {
        sinMapear.push({ nombre: p.nombre, raza: p.raza });
        continue;
      }

      const candidatas = razas.filter((r) => r.especie === especieRaza);
      const razaNormalizada = normalizar(p.raza);

      // 1) match exacto (normalizado)
      let match = candidatas.find((r) => normalizar(r.nombre) === razaNormalizada);

      // 2) "Mestizo" suelto -> fila "Mestizo / No especificada" de esa especie
      if (!match && razaNormalizada.startsWith("mestizo")) {
        match = candidatas.find((r) => normalizar(r.nombre).startsWith("mestizo"));
      }

      // 3) contención en cualquier sentido (ej. "Labrador" dentro de "Labrador Retriever")
      if (!match) {
        match = candidatas.find(
          (r) =>
            normalizar(r.nombre).includes(razaNormalizada) ||
            razaNormalizada.includes(normalizar(r.nombre))
        );
      }

      if (match) {
        await pool.query(`UPDATE pacientes SET raza_id = $1 WHERE id = $2`, [match.id, p.id]);
        console.log(`OK: "${p.nombre}" (${p.raza}) -> ${match.nombre}`);
      } else {
        sinMapear.push({ nombre: p.nombre, raza: p.raza });
      }
    }

    if (sinMapear.length > 0) {
      console.log("\nSin mapear automáticamente:");
      for (const s of sinMapear) console.log(`  - ${s.nombre}: "${s.raza}"`);
    } else {
      console.log("\nTodos los pacientes con raza se mapearon correctamente.");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
