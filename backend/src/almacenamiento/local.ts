import fs from "fs";
import path from "path";
import { AlmacenamientoObjetos, AlmacenamientoPublico } from "./tipos";

// Implementación de desarrollo: filesystem del contenedor, bajo
// backend/uploads/. Sigue existiendo para dev local (no todo el mundo
// tiene un bucket a mano para levantar el proyecto) — en producción se usa
// la implementación de S3 (ver s3.ts), seleccionada por
// ALMACENAMIENTO_PROVEEDOR en index.ts de este módulo.
const RAIZ = path.join(__dirname, "../../uploads");

function rutaAbsoluta(clave: string): string {
  const ruta = path.join(RAIZ, clave);
  // La clave siempre la arma el propio backend (nunca el usuario
  // directamente) pero esta comprobación es defensa en profundidad barata
  // contra un path traversal si algún día eso cambiara.
  if (!ruta.startsWith(RAIZ)) {
    throw new Error(`Clave de almacenamiento inválida: ${clave}`);
  }
  return ruta;
}

class AlmacenamientoLocalPrivado implements AlmacenamientoObjetos {
  async guardar(clave: string, datos: Buffer): Promise<void> {
    const ruta = rutaAbsoluta(clave);
    await fs.promises.mkdir(path.dirname(ruta), { recursive: true });
    await fs.promises.writeFile(ruta, datos);
  }

  async leer(clave: string): Promise<Buffer> {
    return fs.promises.readFile(rutaAbsoluta(clave));
  }

  async eliminar(clave: string): Promise<void> {
    await fs.promises.unlink(rutaAbsoluta(clave)).catch(() => {});
  }
}

// El ámbito público comparte la misma raíz de disco que el privado en dev
// (no hay dos buckets locales) — lo único que lo distingue es que
// index.ts monta express.static solo sobre uploads/logos/, y que acá
// url() devuelve la ruta relativa servida por ese mount.
class AlmacenamientoLocalPublico extends AlmacenamientoLocalPrivado implements AlmacenamientoPublico {
  url(clave: string): string {
    return `/uploads/${clave}`;
  }
}

export const almacenamientoPrivadoLocal: AlmacenamientoObjetos = new AlmacenamientoLocalPrivado();
export const almacenamientoPublicoLocal: AlmacenamientoPublico = new AlmacenamientoLocalPublico();
