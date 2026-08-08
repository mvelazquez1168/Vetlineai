// ---------------------------------------------------------------------
// Abstracción de almacenamiento de objetos — dos ámbitos separados, no
// una excepción dentro de uno solo (decisión explícita del prompt de
// despliegue: "si es una excepción, alguien la va a ampliar sin darse
// cuenta").
//
// PRIVADO: adjuntos de casos, documentos de la Base de Conocimiento,
// exportaciones — pasan siempre por un endpoint autenticado que verifica
// tenant antes de leer. La implementación cambia (disco local en dev, un
// bucket privado en producción) pero ese control de acceso NUNCA cambia.
//
// PÚBLICO: solo los logos de clínica — alcanzables por URL directa a
// propósito (se embeben en correos leídos sin sesión).
// ---------------------------------------------------------------------
export interface AlmacenamientoObjetos {
  guardar(clave: string, datos: Buffer, contentType?: string): Promise<void>;
  leer(clave: string): Promise<Buffer>;
  eliminar(clave: string): Promise<void>;
}

export interface AlmacenamientoPublico extends AlmacenamientoObjetos {
  // URL alcanzable directamente, sin pasar por la aplicación.
  url(clave: string): string;
}
