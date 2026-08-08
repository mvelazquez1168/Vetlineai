import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AlmacenamientoObjetos, AlmacenamientoPublico } from "./tipos";

// Implementación de producción — contra cualquier almacenamiento
// compatible con la API de S3 (AWS S3, DigitalOcean Spaces, Hetzner/Linode/
// Scaleway Object Storage, MinIO autoalojado, Cloudflare R2, Backblaze B2,
// etc.), no atada a un proveedor concreto. Dos buckets, uno por ámbito —
// ver tipos.ts sobre por qué son dos y no una excepción.
class AlmacenamientoS3 implements AlmacenamientoObjetos {
  constructor(
    protected cliente: S3Client,
    protected bucket: string
  ) {}

  async guardar(clave: string, datos: Buffer, contentType?: string): Promise<void> {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: clave,
        Body: datos,
        ContentType: contentType,
      })
    );
  }

  async leer(clave: string): Promise<Buffer> {
    const respuesta = await this.cliente.send(new GetObjectCommand({ Bucket: this.bucket, Key: clave }));
    if (!respuesta.Body) {
      throw new Error(`Objeto sin contenido: ${clave}`);
    }
    const bytes = await respuesta.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async eliminar(clave: string): Promise<void> {
    await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: clave }));
  }
}

class AlmacenamientoS3Publico extends AlmacenamientoS3 implements AlmacenamientoPublico {
  constructor(
    cliente: S3Client,
    bucket: string,
    private urlBase: string
  ) {
    super(cliente, bucket);
  }

  url(clave: string): string {
    return `${this.urlBase.replace(/\/$/, "")}/${clave}`;
  }
}

export function crearClienteS3(opciones: {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    endpoint: opciones.endpoint,
    region: opciones.region,
    credentials: {
      accessKeyId: opciones.accessKeyId,
      secretAccessKey: opciones.secretAccessKey,
    },
    // Los proveedores no-AWS compatibles con S3 (DigitalOcean, MinIO, etc.)
    // casi siempre requieren estilo "path" (bucket en la ruta), no
    // "virtual-hosted" (bucket en el subdominio) — AWS acepta ambos.
    forcePathStyle: !!opciones.endpoint,
  });
}

export function crearAlmacenamientoS3Privado(cliente: S3Client, bucket: string): AlmacenamientoObjetos {
  return new AlmacenamientoS3(cliente, bucket);
}

export function crearAlmacenamientoS3Publico(cliente: S3Client, bucket: string, urlBase: string): AlmacenamientoPublico {
  return new AlmacenamientoS3Publico(cliente, bucket, urlBase);
}
