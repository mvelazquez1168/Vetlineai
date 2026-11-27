import { Button } from "../ui";
import { ClienteParecido } from "../../lib/propietariosApi";

// ---------------------------------------------------------------------
// «ESTE CLIENTE YA EXISTE» — anexo 07-03, A5.
//
// El duplicado más barato de resolver es el que no se crea. Cuando el
// alta encuentra a alguien con la misma identificación o el mismo
// teléfono, no guarda: muestra esto.
//
// NO BLOQUEA, Y ES DELIBERADO. Dos personas de la misma casa comparten
// el teléfono, y un hijo puede traer la mascota de la madre. Lo que no
// puede pasar es que nadie se entere. Por eso hay dos salidas y las dos
// son explícitas: usar el que existe, o crear igual.
//
// Lo usan el alta de cliente y el alta de paciente con dueño nuevo, que
// es el mismo problema en dos pantallas.
// ---------------------------------------------------------------------

export function AvisoDuplicado({
  mensaje,
  candidatos,
  onUsarExistente,
  onCrearIgual,
  onCancelar,
  ocupado = false,
}: {
  mensaje: string;
  candidatos: ClienteParecido[];
  onUsarExistente: (c: ClienteParecido) => void;
  onCrearIgual: () => void;
  onCancelar?: () => void;
  ocupado?: boolean;
}) {
  const porQue: Record<string, string> = {
    identificacion: "misma identificación",
    telefono: "mismo teléfono",
    correo: "mismo correo",
    nombre: "nombre parecido",
  };

  return (
    <div className="rounded-lg border-2 border-warning/50 bg-warning/10 p-4">
      <p className="text-sm font-semibold text-text-primary">{mensaje}</p>
      <p className="mt-1 text-xs text-text-muted">
        Si es el mismo cliente, usalo en vez de crear otro: dos fichas del mismo cliente parten su
        historial en dos.
      </p>

      <ul className="mt-3 space-y-2">
        {candidatos.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 bg-surface p-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">{c.nombre}</p>
              <p className="text-xs text-text-muted">
                {[
                  c.telefono,
                  c.email,
                  c.numeroIdentificacion,
                  `${c.pacientes} ${c.pacientes === 1 ? "paciente" : "pacientes"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-xs text-text-muted">
                Coincide por: {c.criterios.map((x) => porQue[x] ?? x).join(", ")}
              </p>
            </div>
            <Button variant="secondary" disabled={ocupado} onClick={() => onUsarExistente(c)}>
              Usar este
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {onCancelar && (
          <Button variant="secondary" disabled={ocupado} onClick={onCancelar}>
            Cancelar
          </Button>
        )}
        <Button variant="secondary" disabled={ocupado} onClick={onCrearIgual}>
          No es el mismo: crear igual
        </Button>
      </div>
    </div>
  );
}
