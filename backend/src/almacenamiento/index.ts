import { config } from "../config";
import { almacenamientoPrivadoLocal, almacenamientoPublicoLocal } from "./local";
import { crearAlmacenamientoS3Privado, crearAlmacenamientoS3Publico, crearClienteS3 } from "./s3";
import { AlmacenamientoObjetos, AlmacenamientoPublico } from "./tipos";

export type { AlmacenamientoObjetos, AlmacenamientoPublico } from "./tipos";

function construir(): { privado: AlmacenamientoObjetos; publico: AlmacenamientoPublico } {
  if (config.almacenamientoProveedor === "local") {
    return { privado: almacenamientoPrivadoLocal, publico: almacenamientoPublicoLocal };
  }

  const faltantes = [
    ["S3_REGION", config.s3Region],
    ["S3_ACCESS_KEY_ID", config.s3AccessKeyId],
    ["S3_SECRET_ACCESS_KEY", config.s3SecretAccessKey],
    ["S3_BUCKET_PRIVADO", config.s3BucketPrivado],
    ["S3_BUCKET_PUBLICO", config.s3BucketPublico],
    ["S3_URL_PUBLICA_BASE", config.s3UrlPublicaBase],
  ].filter(([, valor]) => !valor);

  if (faltantes.length > 0) {
    throw new Error(
      `ALMACENAMIENTO_PROVEEDOR=s3 pero faltan variables de entorno: ${faltantes
        .map(([nombre]) => nombre)
        .join(", ")}.`
    );
  }

  const cliente = crearClienteS3({
    endpoint: config.s3Endpoint,
    region: config.s3Region!,
    accessKeyId: config.s3AccessKeyId!,
    secretAccessKey: config.s3SecretAccessKey!,
  });

  return {
    privado: crearAlmacenamientoS3Privado(cliente, config.s3BucketPrivado!),
    publico: crearAlmacenamientoS3Publico(cliente, config.s3BucketPublico!, config.s3UrlPublicaBase!),
  };
}

// Construcción perezosa: si nada importa este módulo (ej. corriendo un
// script suelto), no valida credenciales de S3 que no hacen falta para esa
// ejecución puntual.
let instancia: { privado: AlmacenamientoObjetos; publico: AlmacenamientoPublico } | undefined;

function obtener(): { privado: AlmacenamientoObjetos; publico: AlmacenamientoPublico } {
  if (!instancia) instancia = construir();
  return instancia;
}

// Los dos ámbitos, importables directamente por cualquier ruta — ver
// tipos.ts sobre por qué son dos objetos separados y no una excepción
// dentro de uno solo.
export const almacenamientoPrivado: AlmacenamientoObjetos = {
  guardar: (clave, datos, contentType) => obtener().privado.guardar(clave, datos, contentType),
  leer: (clave) => obtener().privado.leer(clave),
  eliminar: (clave) => obtener().privado.eliminar(clave),
};

export const almacenamientoPublico: AlmacenamientoPublico = {
  guardar: (clave, datos, contentType) => obtener().publico.guardar(clave, datos, contentType),
  leer: (clave) => obtener().publico.leer(clave),
  eliminar: (clave) => obtener().publico.eliminar(clave),
  url: (clave) => obtener().publico.url(clave),
};

// Compatibilidad hacia atrás: los logos subidos antes de esta migración
// (almacenamiento local, express.static) quedaron en la base como
// "/uploads/logos/x.png" — una URL relativa, no una clave. Las filas
// nuevas guardan solo la clave ("logos/x.png"). Este helper acepta
// cualquiera de las dos formas para no requerir una migración de datos
// solo para esto.
export function claveLogoDesdeValorGuardado(valor: string): string {
  return valor.replace(/^\/uploads\//, "");
}
