// Imágenes y documentos del expediente — regresión del hallazgo de la
// revisión del 2026-11-27 («la pestaña no permite agregar nada»).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_documentos_expediente.ts
//
// SIN --transpile-only.
//
// Lo que se prueba por HTTP, con usuarios descartables creados por el
// flujo real de invitación: **la subida de verdad**, con un PNG y un
// PDF, y la regla de permisos. Un verificador que llame a la función no
// vería el `multipart`, que es por donde entra el archivo.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { crearInvitacion } from "../invitaciones";
import { buscarUsuarioKeycloakPorEmail, eliminarUsuarioKeycloak } from "../keycloakAdmin";
import {
  documentosDePaciente,
  puedeSubirTipo,
  tiposDeDocumento,
  validarDatosDeDocumento,
} from "../expediente/documentos";

const API = process.env.API_URL ?? "http://localhost:4000/api";
const PREFIJO = "probe-docs";
const CLAVE = "ProbeDocs2026!";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

const correo = (quien: string) => `${PREFIJO}-${quien}@probe.test`;

async function limpiar() {
  for (const quien of ["vet", "recep"]) {
    const id = await buscarUsuarioKeycloakPorEmail(correo(quien));
    if (id) await eliminarUsuarioKeycloak(id);
  }
  await pool.query(
    `DELETE FROM uso_api WHERE tenant_id IN (SELECT id FROM tenants WHERE nombre LIKE $1)`,
    [`${PREFIJO}%`]
  );
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

/** Un PNG de 2×2, para probar la subida de una imagen. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z/C/noGBgQEAGAgC/wQZmQAAAABJRU5ErkJggg==",
  "base64"
);
/** Un PDF mínimo pero válido. */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>",
  "latin1"
);

async function alta(
  tenantId: string,
  quien: string,
  nombre: string,
  roles: string[]
): Promise<string> {
  const inv = await crearInvitacion(
    pool,
    tenantId,
    `${PREFIJO} clínica`,
    null,
    correo(quien),
    nombre,
    roles
  );
  if (!inv.ok) throw new Error(`no se pudo invitar a ${quien}: ${inv.motivo}`);
  const r = await fetch(`${API}/invitaciones/${inv.invitacion.token}/aceptar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre,
      colegiatura: roles.includes("medico") ? `VET-${quien.toUpperCase()}` : undefined,
      password: CLAVE,
    }),
  });
  const cuerpo = (await r.json()) as { access_token?: string; error?: string };
  if (!cuerpo.access_token) throw new Error(`sin token para ${quien}: ${cuerpo.error}`);
  return cuerpo.access_token;
}

async function subir(
  token: string,
  datos: {
    archivo: Buffer;
    nombre: string;
    tipo: string;
    pacienteId: string;
    tipoDocumento?: string;
    fechaDocumento?: string;
    descripcion?: string;
    atencionId?: string;
  }
): Promise<{ estado: number; cuerpo: any }> {
  const forma = new FormData();
  forma.append(
    "archivo",
    new Blob([new Uint8Array(datos.archivo)], { type: datos.tipo }),
    datos.nombre
  );
  forma.append("pacienteId", datos.pacienteId);
  if (datos.tipoDocumento) forma.append("tipoDocumento", datos.tipoDocumento);
  if (datos.fechaDocumento) forma.append("fechaDocumento", datos.fechaDocumento);
  if (datos.descripcion) forma.append("descripcion", datos.descripcion);
  if (datos.atencionId) forma.append("atencionId", datos.atencionId);

  const r = await fetch(`${API}/archivos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: forma,
  });
  return { estado: r.status, cuerpo: await r.json().catch(() => null) };
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_documentos_expediente");
  await limpiar();

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@docs.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO tenant_modulos (tenant_id, modulo, estado)
     VALUES ($1,'expediente','habilitado') ON CONFLICT DO NOTHING`,
    [tenantId]
  );
  // El catálogo de tipos lo siembra la migración por clínica existente;
  // esta clínica nace después, así que se siembra acá igual que lo hará
  // el trigger de configuración inicial.
  await pool.query(
    `INSERT INTO exp_tipos_documento (tenant_id, codigo, nombre, administrativo, orden)
     SELECT $1, v.codigo, v.nombre, v.administrativo, v.orden
       FROM (VALUES
         ('radiografia','Radiografía',false,10),
         ('foto_clinica','Foto clínica',false,30),
         ('informe_externo','Informe externo',true,40),
         ('historial_previo','Historial previo',true,50)
       ) AS v(codigo, nombre, administrativo, orden)
     ON CONFLICT DO NOTHING`,
    [tenantId]
  );

  try {
    // --- Las reglas, sin HTTP -------------------------------------
    console.log("\n=== Quién puede subir qué ===");
    await conAlcanceTenant(tenantId, async (db) => {
      const tipos = await tiposDeDocumento(db, tenantId);
      assert(tipos.length === 4, "el catálogo de tipos es de la clínica", tipos.length);
      assert(
        tipos.filter((t) => t.administrativo).length === 2,
        "y dos de ellos son administrativos"
      );

      const medicoRadio = await puedeSubirTipo(db, tenantId, "radiografia", { esMedico: true });
      assert(medicoRadio.puede, "el médico puede subir una radiografía");

      const recepRadio = await puedeSubirTipo(db, tenantId, "radiografia", { esMedico: false });
      assert(!recepRadio.puede, "la recepción NO puede subir una radiografía", recepRadio.motivo);
      assert(
        /médico/i.test(recepRadio.motivo ?? ""),
        "y el motivo dice quién sí puede, no solo «no autorizado»",
        recepRadio.motivo
      );

      const recepHistorial = await puedeSubirTipo(db, tenantId, "historial_previo", {
        esMedico: false,
      });
      assert(
        recepHistorial.puede,
        "la recepción SÍ puede subir el historial previo que trae el cliente"
      );

      const inventado = await puedeSubirTipo(db, tenantId, "resonancia", { esMedico: true });
      assert(!inventado.puede, "un tipo que no existe en la clínica se rechaza");
    });

    console.log("\n=== Los datos del documento ===");
    let sinTipo = false;
    try {
      validarDatosDeDocumento({});
    } catch {
      sinTipo = true;
    }
    assert(sinTipo, "sin tipo de documento no se guarda");

    let futura = false;
    try {
      validarDatosDeDocumento({ tipoDocumento: "radiografia", fechaDocumento: "2099-01-01" });
    } catch {
      futura = true;
    }
    assert(futura, "una fecha futura se rechaza: una radiografía de la semana que viene no existe");

    validarDatosDeDocumento({ tipoDocumento: "historial_previo", fechaDocumento: "2019-03-04" });
    assert(true, "una fecha MUY anterior se acepta: un historial previo es de hace años");

    // --- Por HTTP, con archivos de verdad -------------------------
    console.log("\n=== La subida, por HTTP ===");
    const tokenVet = await alta(tenantId, "vet", "Dra. Documentos", ["medico"]);
    const tokenRecep = await alta(tenantId, "recep", "Recepción Documentos", ["recepcion"]);

    const { pacienteId } = await conAlcanceTenant(tenantId, async (db) => {
      const prop = await db.query<{ id: string }>(
        `INSERT INTO propietarios (tenant_id, nombre) VALUES ($1,'Dueña Docs') RETURNING id`,
        [tenantId]
      );
      const pac = await db.query<{ id: string }>(
        `INSERT INTO pacientes
           (tenant_id, propietario_id, nombre, especie, numero_expediente, estado)
         VALUES ($1,$2,'Nala','Canino','00001','activo') RETURNING id`,
        [tenantId, prop.rows[0].id]
      );
      return { pacienteId: pac.rows[0].id };
    });

    const imagen = await subir(tokenVet, {
      archivo: PNG,
      nombre: "radiografia-torax.png",
      tipo: "image/png",
      pacienteId,
      tipoDocumento: "radiografia",
      fechaDocumento: "2026-11-20",
      descripcion: "Proyección lateral",
    });
    assert(imagen.estado === 201, "el médico sube una imagen", {
      estado: imagen.estado,
      error: imagen.cuerpo?.error,
    });

    const pdf = await subir(tokenVet, {
      archivo: PDF,
      nombre: "informe.pdf",
      tipo: "application/pdf",
      pacienteId,
      tipoDocumento: "informe_externo",
    });
    assert(pdf.estado === 201, "y un PDF", { estado: pdf.estado, error: pdf.cuerpo?.error });

    // LA REGLA DE PERMISOS, POR HTTP: es donde de verdad tiene que
    // valer.
    const recepRadiografia = await subir(tokenRecep, {
      archivo: PNG,
      nombre: "no-deberia.png",
      tipo: "image/png",
      pacienteId,
      tipoDocumento: "radiografia",
    });
    assert(
      recepRadiografia.estado === 403,
      "la recepción recibe 403 al intentar subir una radiografía",
      { estado: recepRadiografia.estado, error: recepRadiografia.cuerpo?.error }
    );

    const recepHistorial = await subir(tokenRecep, {
      archivo: PDF,
      nombre: "historial-viejo.pdf",
      tipo: "application/pdf",
      pacienteId,
      tipoDocumento: "historial_previo",
      fechaDocumento: "2019-03-04",
    });
    assert(recepHistorial.estado === 201, "y SÍ puede subir el historial previo", {
      estado: recepHistorial.estado,
      error: recepHistorial.cuerpo?.error,
    });

    const sinTipoHttp = await subir(tokenVet, {
      archivo: PNG,
      nombre: "suelta.png",
      tipo: "image/png",
      pacienteId,
    });
    assert(sinTipoHttp.estado === 400, "sin tipo de documento, 400", sinTipoHttp.cuerpo?.error);

    // --- La galería y la línea de tiempo --------------------------
    console.log("\n=== La galería ===");
    await conAlcanceTenant(tenantId, async (db) => {
      const todos = await documentosDePaciente(db, pacienteId);
      assert(todos.length === 3, "la galería trae los tres documentos", todos.length);
      assert(
        todos[0].fecha_documento === "2019-03-04" || todos.some((d) => d.fecha_documento === "2019-03-04"),
        "con la fecha DEL DOCUMENTO y no la de la carga"
      );
      assert(
        todos.every((d) => d.origen === "subido"),
        "y el origen de cada uno",
        todos.map((d) => d.origen).join(",")
      );
      assert(
        todos.some((d) => d.es_imagen) && todos.some((d) => !d.es_imagen),
        "distinguiendo imágenes de documentos",
        todos.map((d) => `${d.nombre_archivo}:${d.tipo}:${d.es_imagen}`).join(" | ")
      );
      assert(
        todos.some((d) => d.tipo_documento_nombre === "Radiografía"),
        "con el nombre del tipo resuelto del catálogo de la clínica"
      );

      const soloRadio = await documentosDePaciente(db, pacienteId, { tipo: "radiografia" });
      assert(soloRadio.length === 1, "el filtro por tipo funciona", soloRadio.length);

      const porFecha = await documentosDePaciente(db, pacienteId, {
        desde: "2026-01-01",
        hasta: "2026-12-31",
      });
      assert(
        porFecha.length === 2 && !porFecha.some((d) => d.fecha_documento === "2019-03-04"),
        "y el de fecha deja afuera el historial de 2019",
        porFecha.length
      );

      // CADA CARGA EN LA LÍNEA DE TIEMPO, que es lo que el pedido pide.
      const eventos = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM crm_interacciones
          WHERE tenant_id = $1 AND paciente_id = $2 AND tipo = 'documento_adjunto'`,
        [tenantId, pacienteId]
      );
      assert(
        Number(eventos.rows[0].n) === 3,
        "cada carga dejó su evento en la historia del paciente",
        eventos.rows[0].n
      );
    });

    // --- Ligado a la atención -------------------------------------
    console.log("\n=== Adjuntar desde la atención ===");
    const { atencionId } = await conAlcanceTenant(tenantId, async (db) => {
      const persona = await db.query<{ id: string }>(
        `SELECT id FROM personas WHERE tenant_id = $1 AND es_medico LIMIT 1`,
        [tenantId]
      );
      const cita = await db.query<{ id: string }>(
        `INSERT INTO citas
           (tenant_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin, duracion_minutos, estado)
         VALUES ($1,$2,$3,CURRENT_DATE,'10:00','10:30',30,'en_consulta') RETURNING id`,
        [tenantId, pacienteId, persona.rows[0].id]
      );
      const at = await db.query<{ id: string }>(
        `INSERT INTO atenciones (tenant_id, cita_id, paciente_id, medico_id, estado)
         VALUES ($1,$2,$3,$4,'borrador') RETURNING id`,
        [tenantId, cita.rows[0].id, pacienteId, persona.rows[0].id]
      );
      return { atencionId: at.rows[0].id };
    });

    const deLaAtencion = await subir(tokenVet, {
      archivo: PNG,
      nombre: "foto-de-la-consulta.png",
      tipo: "image/png",
      pacienteId,
      tipoDocumento: "foto_clinica",
      atencionId,
    });
    assert(deLaAtencion.estado === 201, "se adjunta ligado a la atención", {
      estado: deLaAtencion.estado,
      error: deLaAtencion.cuerpo?.error,
    });
    assert(
      deLaAtencion.cuerpo?.archivo?.atencion_id === atencionId,
      "y el vínculo con la atención queda guardado"
    );

    const ajena = await subir(tokenVet, {
      archivo: PNG,
      nombre: "otra.png",
      tipo: "image/png",
      pacienteId,
      tipoDocumento: "foto_clinica",
      atencionId: "00000000-0000-0000-0000-000000000000",
    });
    assert(
      ajena.estado === 400,
      "una atención que no es de este paciente se rechaza",
      ajena.cuerpo?.error
    );
  } finally {
    await limpiar();
  }

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await limpiar().catch(() => {});
  await pool.end();
  process.exit(1);
});
