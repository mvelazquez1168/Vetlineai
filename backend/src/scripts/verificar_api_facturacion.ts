// Verificación de la API del facturador, contra el backend REAL por HTTP
// y con un token REAL de Keycloak (vetline-clinic-09a, punto 4).
//
// Crea su propia clínica y su propio usuario de Keycloak descartables, y
// los borra al terminar. NUNCA toca un usuario existente ni sus
// credenciales — esa regla ya costó un incidente en este proyecto.
//
// Lo que importa comprobar por HTTP y no llamando a las funciones:
//   * el gate del módulo devuelve 403 con su code;
//   * los permisos (un médico no puede tocar las credenciales);
//   * LAS CREDENCIALES NO APARECEN EN NINGUNA RESPUESTA;
//   * el PDF y el XML se descargan con su tipo de contenido y su nombre;
//   * la idempotencia funciona a través de la ruta, no solo del motor.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_api_facturacion.ts
import { pool } from "../db";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";
import { fijarEstadoModulo } from "../tenantModulos";
import { generarCertificadoPrueba } from "../facturacion/certificadoPrueba";
import { fijarEscenarioPorDefecto, reiniciarSimulado } from "../facturacion/haciendaSimulado";

const BASE = "http://localhost:4000/api";
const SUFIJO = Date.now().toString(36);
const PASSWORD = `Vp${SUFIJO}!1`;

let ok = 0;
let fail = 0;
function assert(cond: boolean, label: string, detalle?: unknown) {
  if (cond) {
    ok++;
    console.log(`OK   - ${label}`);
  } else {
    fail++;
    console.log(`FAIL - ${label}`, detalle === undefined ? "" : JSON.stringify(detalle).slice(0, 400));
  }
}

async function pedir(
  path: string,
  opts: RequestInit & { token?: string; crudo?: boolean } = {}
): Promise<{ status: number; json: any; texto: string; headers: Headers }> {
  const { token, crudo, ...rest } = opts;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) };
  if (!(rest.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const texto = crudo ? "" : await res.text();
  let json: any = null;
  if (!crudo) {
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = texto;
    }
  }
  return { status: res.status, json, texto, headers: res.headers };
}

/**
 * Busca recursivamente en una respuesta cualquier rastro de un secreto.
 *
 * Es la forma de comprobar "las credenciales no aparecen en ninguna
 * respuesta" sin tener que enumerar los campos de cada endpoint: busca el
 * VALOR, no el nombre de la propiedad. Si mañana alguien agrega un campo
 * nuevo que filtre la contraseña, esto lo encuentra.
 */
function contieneSecreto(valor: unknown, secretos: string[]): string | null {
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor ?? "");
  for (const s of secretos) {
    if (s.length >= 6 && texto.includes(s)) return s;
  }
  return null;
}

async function main() {
  let tenantId = "";
  let kcMedico = "";
  let kcAdmin = "";
  const emailMedico = `verif.fe.medico.${SUFIJO}@example.com`;
  const emailAdmin = `verif.fe.admin.${SUFIJO}@example.com`;

  const PASSWORD_API = `Contrasena-ATV-${SUFIJO}-secreta`;
  const PIN_LLAVE = "4321";

  reiniciarSimulado();
  fijarEscenarioPorDefecto({ escenario: "acepta" });

  try {
    // -----------------------------------------------------------------
    // Montaje: una clínica, un médico (sin admin) y un admin.
    // Dos usuarios y no uno porque lo que hay que probar es justamente
    // que el médico NO pueda tocar las credenciales.
    // -----------------------------------------------------------------
    const t = await pool.query(
      `INSERT INTO tenants (nombre, estado_suscripcion, zona_horaria, email)
       VALUES ($1, 'activa', 'America/Costa_Rica', $2) RETURNING id`,
      [`Clínica Verif FE ${SUFIJO}`, `clinica.fe.${SUFIJO}@example.com`]
    );
    tenantId = t.rows[0].id;

    kcMedico = await crearUsuarioKeycloak({
      email: emailMedico,
      nombreCompleto: `Dr. Verif FE ${SUFIJO}`,
      password: PASSWORD,
      tenantId,
      rol: "VETERINARIO",
    });
    kcAdmin = await crearUsuarioKeycloak({
      email: emailAdmin,
      nombreCompleto: `Admin Verif FE ${SUFIJO}`,
      password: PASSWORD,
      tenantId,
      rol: "ADMIN",
    });

    await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
       VALUES ($1, 'Dr. Verif FE', $2, 'x', true, false, $3, $4)`,
      [tenantId, emailMedico, kcMedico, `COL-FE-${SUFIJO}`]
    );
    await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id)
       VALUES ($1, 'Admin Verif FE', $2, 'x', false, true, $3)`,
      [tenantId, emailAdmin, kcAdmin]
    );

    const tokenMedico = (await obtenerTokenParaUsuario(emailMedico, PASSWORD)).access_token;
    const tokenAdmin = (await obtenerTokenParaUsuario(emailAdmin, PASSWORD)).access_token;

    // -----------------------------------------------------------------
    console.log("\n=== 1. Sin el módulo habilitado, 403 en TODA la API ===");
    for (const [metodo, ruta] of [
      ["GET", "/facturacion/catalogos"],
      ["GET", "/facturacion/emisor"],
      ["GET", "/facturacion/comprobantes"],
      ["POST", "/facturacion/comprobantes"],
      ["GET", "/facturacion/recibidos"],
    ] as const) {
      const r = await pedir(ruta, {
        method: metodo,
        token: tokenAdmin,
        body: metodo === "POST" ? JSON.stringify({}) : undefined,
      });
      assert(
        r.status === 403 && r.json?.code === "MODULO_NO_HABILITADO",
        `${metodo} ${ruta} → 403 MODULO_NO_HABILITADO`,
        { status: r.status, json: r.json }
      );
    }

    await fijarEstadoModulo(pool, tenantId, "facturacion", "habilitado");

    // -----------------------------------------------------------------
    console.log("\n=== 2. Con el módulo, los catálogos salen ===");
    const cat = await pedir("/facturacion/catalogos", { token: tokenMedico });
    assert(cat.status === 200, "GET /catalogos → 200", cat.status);
    assert(
      cat.json.tarifasIva.length === 8,
      "las tarifas de IVA que se ofrecen son 8: las 11 menos los 3 transitorios de notas",
      cat.json.tarifasIva?.length
    );
    assert(
      !cat.json.tarifasIva.some((t: { codigo: string }) => ["05", "06", "07"].includes(t.codigo)),
      "y no incluyen los transitorios, que en una factura producirían un rechazo"
    );
    assert(
      cat.json.unidadesMedida.length === 101,
      "las 101 unidades de medida de la Nota 15",
      cat.json.unidadesMedida?.length
    );
    assert(
      cat.json.mediosPago.some((m: { codigo: string; nombre: string }) => m.codigo === "06" && /SINPE/i.test(m.nombre)),
      "SINPE MÓVIL está, y es el código 06"
    );
    assert(
      !cat.json.condicionesVenta.some((c: { codigo: string }) => ["09", "11"].includes(c.codigo)),
      "las condiciones de venta 09 y 11 NO se ofrecen: son exclusivas del REP"
    );

    // CABYS: catálogo vacío reportado, no un 500 ni resultados inventados.
    const cabys = await pedir("/facturacion/cabys?q=consulta", { token: tokenMedico });
    assert(cabys.status === 200, "GET /cabys → 200 aunque el catálogo esté vacío", cabys.status);
    assert(cabys.json.catalogoVacio === true, "y lo dice con catalogoVacio: true");
    assert(
      typeof cabys.json.aviso === "string" && cabys.json.aviso.includes("13 dígitos"),
      "con un aviso que explica qué hacer mientras tanto",
      cabys.json.aviso
    );

    // -----------------------------------------------------------------
    console.log("\n=== 3. Emisor: solo el administrador lo configura ===");
    const sinEmisor = await pedir("/facturacion/emisor", { token: tokenMedico });
    assert(sinEmisor.status === 200 && sinEmisor.json.emisor === null, "GET /emisor sin emisor → null");

    const datosEmisor = {
      tipoIdentificacion: "02",
      numeroIdentificacion: "3101778899",
      nombre: "Clínica Veterinaria Verif FE S.A.",
      nombreComercial: "Verif FE",
      codigoActividadEconomica: "750000",
      ubicacionProvincia: "1",
      ubicacionCanton: "01",
      ubicacionDistrito: "01",
      ubicacionBarrio: "Barrio Amón",
      ubicacionOtrasSenas: "Avenida 9, casa amarilla",
      telefonoCodigoPais: "506",
      telefonoNumero: "22009900",
      correo: `facturacion.${SUFIJO}@example.com`,
    };

    const comoMedico = await pedir("/facturacion/emisor", {
      method: "PUT",
      token: tokenMedico,
      body: JSON.stringify(datosEmisor),
    });
    assert(comoMedico.status === 403, "PUT /emisor como MÉDICO → 403", comoMedico.status);

    const puesto = await pedir("/facturacion/emisor", {
      method: "PUT",
      token: tokenAdmin,
      body: JSON.stringify(datosEmisor),
    });
    assert(puesto.status === 200, "PUT /emisor como ADMIN → 200", { status: puesto.status, json: puesto.json });
    assert(
      puesto.json.emisor?.numeroIdentificacion === "3101778899",
      "con los datos fiscales guardados"
    );
    assert(
      puesto.json.emisor?.proveedorSistemas === "3101999999",
      "y el proveedorSistemas lo puso el SERVIDOR desde su configuración, no el cliente",
      puesto.json.emisor?.proveedorSistemas
    );

    // El cliente no puede declarar a otro como proveedor del software.
    const intentoProveedor = await pedir("/facturacion/emisor", {
      method: "PUT",
      token: tokenAdmin,
      body: JSON.stringify({ ...datosEmisor, proveedorSistemas: "9999999999" }),
    });
    assert(
      intentoProveedor.json.emisor?.proveedorSistemas === "3101999999",
      "mandar proveedorSistemas en el cuerpo NO lo cambia"
    );

    const faltante = await pedir("/facturacion/emisor", {
      method: "PUT",
      token: tokenAdmin,
      body: JSON.stringify({ ...datosEmisor, nombre: "" }),
    });
    assert(faltante.status === 400, "PUT /emisor sin un dato obligatorio → 400", faltante.status);
    assert(
      Array.isArray(faltante.json.faltan) && faltante.json.faltan.includes("nombre"),
      "y dice CUÁL falta",
      faltante.json.faltan
    );

    // -----------------------------------------------------------------
    console.log("\n=== 4. Credenciales: se cargan y NO se devuelven ===");
    const cert = generarCertificadoPrueba({ nombreComun: `VERIF FE ${SUFIJO} (FIRMA)`, pin: PIN_LLAVE });

    const formMedico = new FormData();
    formMedico.set("ambiente", "pruebas");
    formMedico.set("usuarioApi", `cpj-3-101-778899@stag.comprobanteselectronicos.go.cr`);
    formMedico.set("passwordApi", PASSWORD_API);
    formMedico.set("pinLlave", PIN_LLAVE);
    formMedico.set("llave", new Blob([new Uint8Array(cert.p12)]), "llave-prueba.p12");
    const credMedico = await pedir("/facturacion/emisor/credenciales", {
      method: "PUT",
      token: tokenMedico,
      body: formMedico,
    });
    assert(credMedico.status === 403, "PUT /emisor/credenciales como MÉDICO → 403", credMedico.status);

    const form = new FormData();
    form.set("ambiente", "pruebas");
    form.set("usuarioApi", `cpj-3-101-778899@stag.comprobanteselectronicos.go.cr`);
    form.set("passwordApi", PASSWORD_API);
    form.set("pinLlave", PIN_LLAVE);
    form.set("llave", new Blob([new Uint8Array(cert.p12)]), "llave-prueba.p12");
    const cred = await pedir("/facturacion/emisor/credenciales", {
      method: "PUT",
      token: tokenAdmin,
      body: form,
    });
    assert(cred.status === 200, "PUT /emisor/credenciales como ADMIN → 200", {
      status: cred.status,
      json: cred.json,
    });
    assert(
      cred.json.credencial?.llaveVenceEn === "2028-01-01",
      "devuelve cuándo vence la llave, leído del certificado",
      cred.json.credencial?.llaveVenceEn
    );
    assert(
      cred.json.certificado?.bitsRsa === 2048,
      "y los datos del certificado para confirmar que se cargó el correcto"
    );

    // LA ASERCIÓN QUE MÁS IMPORTA de todo este script.
    const secretos = [PASSWORD_API, PIN_LLAVE.repeat(2), cert.p12.toString("base64").slice(0, 40)];
    const filtrado = contieneSecreto(cred.json, secretos);
    assert(filtrado === null, "la respuesta NO contiene la contraseña, el PIN ni la llave", filtrado);

    const emisorConCred = await pedir("/facturacion/emisor", { token: tokenMedico });
    const filtrado2 = contieneSecreto(emisorConCred.json, secretos);
    assert(filtrado2 === null, "GET /emisor tampoco los contiene", filtrado2);
    assert(
      emisorConCred.json.credenciales?.[0]?.usuarioApi?.startsWith("cpj-3-101-778899@"),
      "pero sí dice el usuario de la API, que no es un secreto"
    );
    const camposCredencial = Object.keys(emisorConCred.json.credenciales?.[0] ?? {});
    assert(
      !camposCredencial.some((c) => /password|p12|pin|cifrad/i.test(c)),
      "y ningún campo se llama como un secreto",
      camposCredencial
    );

    // -----------------------------------------------------------------
    console.log("\n=== 5. Emitir por HTTP ===");
    const documento = {
      tipoComprobante: "01",
      condicionVenta: "01",
      receptor: {
        nombre: "Carlos Enrique Mora Castro",
        identificacion: { tipo: "01", numero: "203450678" },
        correo: `receptor.${SUFIJO}@example.com`,
      },
      lineas: [
        {
          codigoCabys: "8690100000000",
          cantidad: 1,
          unidadMedida: "Sp",
          detalle: "Consulta veterinaria general",
          precioUnitario: 20000,
          impuestos: [{ codigo: "01", codigoTarifaIva: "08" }],
        },
      ],
      mediosPago: [{ codigo: "06" }],
      claveIdempotencia: `api-${SUFIJO}-0001`,
    };

    const emitido = await pedir("/facturacion/comprobantes", {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify(documento),
    });
    assert(emitido.status === 201, "POST /comprobantes → 201", {
      status: emitido.status,
      json: emitido.json,
    });
    assert(emitido.json.estado === "aceptado", "el comprobante queda aceptado", emitido.json.estado);
    assert(emitido.json.clave?.length === 50, "con su clave de 50 dígitos");
    assert(emitido.json.yaExistia === false, "y no existía antes");
    const comprobanteId = emitido.json.comprobanteId;

    // Idempotencia a través de la ruta.
    const repetido = await pedir("/facturacion/comprobantes", {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify(documento),
    });
    assert(repetido.status === 200, "la misma clave de idempotencia → 200, no 201", repetido.status);
    assert(
      repetido.json.comprobanteId === comprobanteId,
      "y devuelve EL MISMO comprobante",
      repetido.json.comprobanteId
    );
    assert(repetido.json.yaExistia === true, "diciendo que ya existía");

    // Un documento inválido: 400 con un mensaje que explica, no un 500.
    const invalido = await pedir("/facturacion/comprobantes", {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ ...documento, lineas: [], claveIdempotencia: `api-${SUFIJO}-x` }),
    });
    assert(invalido.status === 400, "un documento sin líneas → 400", invalido.status);
    assert(
      typeof invalido.json.error === "string" && invalido.json.error.includes("línea"),
      "con un mensaje que dice qué falta",
      invalido.json.error
    );

    // -----------------------------------------------------------------
    console.log("\n=== 6. Listado y detalle ===");
    const listado = await pedir("/facturacion/comprobantes", { token: tokenMedico });
    assert(listado.status === 200 && listado.json.total >= 1, "GET /comprobantes → 200 con el total");
    assert(
      listado.json.comprobantes[0].estadoLegible === "Aceptado por Hacienda",
      "el listado trae el estado en palabras",
      listado.json.comprobantes[0]?.estadoLegible
    );
    assert(
      !("xmlFirmado" in listado.json.comprobantes[0]),
      "y NO trae el XML: son 6-10 KB por fila y nadie los lee desde una tabla"
    );

    const filtrado3 = await pedir("/facturacion/comprobantes?estado=rechazado", { token: tokenMedico });
    assert(filtrado3.json.total === 0, "filtrar por estado=rechazado no devuelve nada", filtrado3.json.total);
    const porReceptor = await pedir("/facturacion/comprobantes?receptor=Mora", { token: tokenMedico });
    assert(porReceptor.json.total >= 1, "filtrar por nombre del receptor sí", porReceptor.json.total);

    const detalle = await pedir(`/facturacion/comprobantes/${comprobanteId}`, { token: tokenMedico });
    assert(detalle.status === 200, "GET /comprobantes/:id → 200");
    assert(detalle.json.lineas?.length === 1, "con su línea");
    assert(
      JSON.stringify(detalle.json.eventos?.map((e: { tipo_evento: string }) => e.tipo_evento)) ===
        JSON.stringify(["creado", "firmado", "enviado", "respuesta_recibida"]),
      "y su historia de eventos completa",
      detalle.json.eventos?.map((e: { tipo_evento: string }) => e.tipo_evento)
    );
    assert(
      typeof detalle.json.comprobante?.xmlFirmado === "string" &&
        detalle.json.comprobante.xmlFirmado.includes("ds:Signature"),
      "el detalle sí trae el XML firmado, con su firma"
    );
    assert(
      typeof detalle.json.comprobante?.respuestaXml === "string",
      "y la respuesta de Hacienda"
    );
    const filtradoDetalle = contieneSecreto(detalle.json, secretos);
    assert(filtradoDetalle === null, "el detalle no filtra ningún secreto", filtradoDetalle);

    const inexistente = await pedir(`/facturacion/comprobantes/00000000-0000-0000-0000-000000000000`, {
      token: tokenMedico,
    });
    assert(inexistente.status === 404, "un id que no existe → 404", inexistente.status);

    // -----------------------------------------------------------------
    console.log("\n=== 7. Descargas: PDF y XML ===");
    const resPdf = await fetch(`${BASE}/facturacion/comprobantes/${comprobanteId}/pdf`, {
      headers: { Authorization: `Bearer ${tokenMedico}` },
    });
    const bytesPdf = Buffer.from(await resPdf.arrayBuffer());
    assert(resPdf.status === 200, "GET /:id/pdf → 200", resPdf.status);
    assert(
      resPdf.headers.get("content-type")?.includes("application/pdf") === true,
      "con Content-Type application/pdf",
      resPdf.headers.get("content-type")
    );
    assert(
      resPdf.headers.get("content-disposition")?.includes(`${emitido.json.clave}.pdf`) === true,
      "y el nombre de archivo de la Nota 3 (clave.pdf)",
      resPdf.headers.get("content-disposition")
    );
    assert(bytesPdf.subarray(0, 5).toString("latin1") === "%PDF-", "y es un PDF de verdad");

    const resXml = await fetch(`${BASE}/facturacion/comprobantes/${comprobanteId}/xml`, {
      headers: { Authorization: `Bearer ${tokenMedico}` },
    });
    const textoXml = await resXml.text();
    assert(resXml.status === 200, "GET /:id/xml → 200", resXml.status);
    assert(
      resXml.headers.get("content-type")?.includes("application/xml") === true,
      "con Content-Type application/xml"
    );
    assert(
      resXml.headers.get("content-disposition")?.includes(`${emitido.json.clave}.xml`) === true,
      "y el nombre clave.xml"
    );
    assert(textoXml.includes("<FacturaElectronica"), "y es el XML de la factura");
    assert(textoXml.includes("ds:Signature"), "FIRMADO");

    // -----------------------------------------------------------------
    console.log("\n=== 8. Nota de crédito por HTTP ===");
    const sinCodigo = await pedir(`/facturacion/comprobantes/${comprobanteId}/nota-credito`, {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ razon: "Anulación" }),
    });
    assert(sinCodigo.status === 400, "una nota sin código de referencia → 400", sinCodigo.status);
    assert(
      sinCodigo.json.error?.includes("Nota 9"),
      "y el mensaje explica por qué no tiene default",
      sinCodigo.json.error
    );

    const nota = await pedir(`/facturacion/comprobantes/${comprobanteId}/nota-credito`, {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ codigoReferencia: "01", razon: "Anulación por error en el monto" }),
    });
    assert(nota.status === 201, "POST /:id/nota-credito → 201", { status: nota.status, json: nota.json });
    assert(
      nota.json.consecutivo?.startsWith("0010000103"),
      "con su consecutivo de la serie 03",
      nota.json.consecutivo
    );

    // Desde el original se ve la nota que lo corrige.
    const conNota = await pedir(`/facturacion/comprobantes/${comprobanteId}`, { token: tokenMedico });
    assert(
      conNota.json.notas?.length === 1 && conNota.json.notas[0].id === nota.json.comprobanteId,
      "y el detalle del original muestra la nota que lo corrige",
      conNota.json.notas
    );

    // -----------------------------------------------------------------
    console.log("\n=== 9. Reenviar: a Hacienda o al correo ===");
    const reHacienda = await pedir(`/facturacion/comprobantes/${comprobanteId}/reenviar`, {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ destino: "hacienda" }),
    });
    assert(reHacienda.status === 200, "POST /:id/reenviar destino=hacienda → 200", reHacienda.status);
    assert(reHacienda.json.estado === "aceptado", "y sigue aceptado (no se reenvía lo que ya salió)");

    const destinoRaro = await pedir(`/facturacion/comprobantes/${comprobanteId}/reenviar`, {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ destino: "paloma" }),
    });
    assert(destinoRaro.status === 400, "un destino inventado → 400", destinoRaro.status);

    // -----------------------------------------------------------------
    console.log("\n=== 10. Comprobantes recibidos de proveedores ===");
    const vacios = await pedir("/facturacion/recibidos", { token: tokenMedico });
    assert(vacios.status === 200 && vacios.json.recibidos.length === 0, "GET /recibidos vacío");

    // Se reusa el XML firmado del propio comprobante como si fuera el de
    // un proveedor: es un comprobante v4.4 real y válido, que es
    // exactamente lo que hay que poder cargar.
    const cargado = await pedir("/facturacion/recibidos", {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ xml: textoXml }),
    });
    assert(cargado.status === 201, "POST /recibidos con un XML válido → 201", {
      status: cargado.status,
      json: cargado.json,
    });
    assert(cargado.json.validacionOk === true, "y valida contra el XSD oficial", cargado.json);
    assert(cargado.json.clave === emitido.json.clave, "con su clave leída del XML");
    const recibidoId = cargado.json.id;

    const basura = await pedir("/facturacion/recibidos", {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ xml: "<esto>no es un comprobante</esto>" }),
    });
    assert(basura.status === 400, "un XML que no es un comprobante → 400", basura.status);
    assert(
      basura.json.error?.includes("clave de 50"),
      "con un mensaje que dice qué falta",
      basura.json.error
    );

    const mensajeMalo = await pedir(`/facturacion/recibidos/${recibidoId}/mensaje`, {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ mensaje: "01" }),
    });
    assert(
      mensajeMalo.status === 400 && mensajeMalo.json.error?.includes("un dígito"),
      "el mensaje '01' se rechaza: el XSD usa UN dígito (1, 2 o 3)",
      mensajeMalo.json?.error
    );

    const mensaje = await pedir(`/facturacion/recibidos/${recibidoId}/mensaje`, {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ mensaje: "1", condicionImpuesto: "01", detalle: "Aceptado" }),
    });
    assert(mensaje.status === 201, "POST /recibidos/:id/mensaje → 201", {
      status: mensaje.status,
      json: mensaje.json,
    });
    assert(
      mensaje.json.consecutivo?.startsWith("0010000105"),
      "con el consecutivo de la serie 05 (confirmación de aceptación)",
      mensaje.json.consecutivo
    );
    assert(mensaje.json.estado === "enviado", "y queda enviado", mensaje.json.estado);

    const repetir = await pedir(`/facturacion/recibidos/${recibidoId}/mensaje`, {
      method: "POST",
      token: tokenMedico,
      body: JSON.stringify({ mensaje: "3", detalle: "Cambié de opinión" }),
    });
    assert(
      repetir.status === 400 && repetir.json.error?.includes("no se reemplaza"),
      "y un segundo mensaje receptor se rechaza: no se reemplaza",
      repetir.json?.error
    );

    // -----------------------------------------------------------------
    console.log("\n=== 11. Aislamiento: otra clínica no ve estos comprobantes ===");
    const t2 = await pool.query(
      `INSERT INTO tenants (nombre, estado_suscripcion) VALUES ($1, 'activa') RETURNING id`,
      [`Clínica Verif FE OTRA ${SUFIJO}`]
    );
    const tenantOtro = t2.rows[0].id;
    const emailOtro = `verif.fe.otro.${SUFIJO}@example.com`;
    const kcOtro = await crearUsuarioKeycloak({
      email: emailOtro,
      nombreCompleto: `Admin Otro ${SUFIJO}`,
      password: PASSWORD,
      tenantId: tenantOtro,
      rol: "ADMIN",
    });
    await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id)
       VALUES ($1, 'Admin Otro', $2, 'x', false, true, $3)`,
      [tenantOtro, emailOtro, kcOtro]
    );
    await fijarEstadoModulo(pool, tenantOtro, "facturacion", "habilitado");
    const tokenOtro = (await obtenerTokenParaUsuario(emailOtro, PASSWORD)).access_token;

    const listadoOtro = await pedir("/facturacion/comprobantes", { token: tokenOtro });
    assert(listadoOtro.json.total === 0, "la otra clínica ve 0 comprobantes", listadoOtro.json.total);
    const detalleOtro = await pedir(`/facturacion/comprobantes/${comprobanteId}`, { token: tokenOtro });
    assert(detalleOtro.status === 404, "y el detalle del comprobante ajeno → 404", detalleOtro.status);
    const pdfOtro = await pedir(`/facturacion/comprobantes/${comprobanteId}/pdf`, { token: tokenOtro });
    assert(pdfOtro.status === 404, "y su PDF tampoco", pdfOtro.status);
    const emisorOtro = await pedir("/facturacion/emisor", { token: tokenOtro });
    assert(emisorOtro.json.emisor === null, "ni el emisor ajeno");

    await eliminarUsuarioKeycloak(kcOtro).catch(() => undefined);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantOtro]);

    // -----------------------------------------------------------------
    console.log("\n=== 12. Sin token, nada ===");
    const sinToken = await pedir("/facturacion/comprobantes");
    assert(sinToken.status === 401, "GET /comprobantes sin token → 401", sinToken.status);
  } finally {
    if (kcMedico) await eliminarUsuarioKeycloak(kcMedico).catch(() => undefined);
    if (kcAdmin) await eliminarUsuarioKeycloak(kcAdmin).catch(() => undefined);
    if (tenantId) await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    reiniciarSimulado();
  }

  console.log(`\n${ok} OK, ${fail} FAIL`);
  await pool.end();
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
