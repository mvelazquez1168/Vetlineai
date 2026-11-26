import { Pool, PoolClient } from "pg";
import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "./almacenamiento";
import {
  PRIMARIO_POR_DEFECTO,
  TEMAS,
  TemaCalculado,
  TemaPredefinido,
  aRgb,
  calcularTema,
} from "./tema";

// ---------------------------------------------------------------------
// LA APARIENCIA DE LA CLÍNICA — prompt 01c, sección 2.
//
// Devuelve el tema YA CALCULADO: el color ajustado si hizo falta, sus
// derivados y el texto que va encima. El cliente no calcula nada; solo
// escribe variables CSS. Así la vista previa de la pantalla de
// configuración y la interfaz real no pueden discrepar.
//
// EL LOGO NO ESTÁ EN ESTA TABLA. Vive en `tenants.logo_url` desde antes,
// y lo usan los correos al cliente y el informe en .docx. Acá se LEE
// para devolverlo junto con el tema, que es lo que la pantalla necesita
// en una sola llamada.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export interface Apariencia {
  primario: string;
  tema: TemaPredefinido;
  logoUrl: string | null;
  nombreClinica: string;
  calculado: TemaCalculado;
}

export async function apariencia(db: EjecutorSql, tenantId: string): Promise<Apariencia> {
  const r = await db.query<{
    primario: string | null;
    tema: string | null;
    nombre: string;
    logo_url: string | null;
  }>(
    `SELECT a.primario, a.tema, t.nombre, t.logo_url
       FROM tenants t
       LEFT JOIN clinica_apariencia a ON a.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId]
  );
  if (r.rows.length === 0) throw new Error("Esa clínica no existe.");

  // SIN FILA, el tema por defecto. Se resuelve en la lectura y no con
  // una fila creada de oficio: una fila por clínica sería una fila que
  // hay que migrar el día que el valor por defecto cambie.
  const primario = r.rows[0].primario ?? PRIMARIO_POR_DEFECTO;
  const tema = (r.rows[0].tema ?? "marca") as TemaPredefinido;

  // `tenants.logo_url` guarda la CLAVE del almacenamiento
  // ("logos/x.jpg"), no una URL. Devolverla tal cual dejaba el logo
  // roto en el marco y en la pantalla de apariencia: el navegador
  // pedia "http://localhost:4000logos/x.jpg", sin la barra. Se resuelve
  // con el mismo helper que usa GET /admin/clinica.
  const logo = r.rows[0].logo_url;

  return {
    primario,
    tema,
    logoUrl: logo ? almacenamientoPublico.url(claveLogoDesdeValorGuardado(logo)) : null,
    nombreClinica: r.rows[0].nombre,
    calculado: calcularTema(primario),
  };
}

export async function guardarApariencia(
  db: PoolClient,
  tenantId: string,
  datos: { primario?: string; tema?: string; personaId?: string }
): Promise<Apariencia> {
  const actual = await apariencia(db, tenantId);

  const primario = datos.primario ?? actual.primario;
  // Se valida acá y no solo en la pantalla: esta función también la
  // llama el restablecer, y un color inválido guardado dejaría la
  // interfaz sin color hasta que alguien lo arregle en la base.
  aRgb(primario);

  const tema = (datos.tema ?? actual.tema) as TemaPredefinido;
  if (!TEMAS.includes(tema)) {
    throw new Error(`"${tema}" no es un tema. Los temas son: ${TEMAS.join(", ")}.`);
  }

  await db.query(
    `INSERT INTO clinica_apariencia (tenant_id, primario, tema, actualizado_por)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE
       SET primario = EXCLUDED.primario,
           tema = EXCLUDED.tema,
           actualizado_por = EXCLUDED.actualizado_por,
           actualizado_en = now()`,
    [tenantId, primario.toUpperCase(), tema, datos.personaId ?? null]
  );

  return apariencia(db, tenantId);
}

/** Vuelve al tema de fábrica. No toca el logo: es de la clínica. */
export async function restablecerApariencia(
  db: PoolClient,
  tenantId: string,
  personaId?: string
): Promise<Apariencia> {
  return guardarApariencia(db, tenantId, {
    primario: PRIMARIO_POR_DEFECTO,
    tema: "marca",
    personaId,
  });
}
