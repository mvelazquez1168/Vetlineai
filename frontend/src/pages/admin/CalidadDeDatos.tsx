import { Link } from "react-router-dom";
import {
  Button,
  Card,
  CardDescription,
  CardTitle,
  PageHeader,
  Tabs,
} from "../../components/ui";
import { Duplicados } from "./Duplicados";
import { SinClasificar } from "../inventario/SinClasificar";

// ---------------------------------------------------------------------
// CALIDAD DE DATOS — punto 6 del 2026-11-27.
//
// Tres listas que son la misma tarea —«esto está incompleto o repetido
// y alguien tiene que arreglarlo»— y que antes vivían en tres lugares
// que no se hablaban: los duplicados en Administración, los productos
// sin clasificar en Inventario, y las fichas por completar en ninguna
// parte (solo como filtro dentro del listado de pacientes).
//
// Juntarlas tiene un efecto práctico: alguien puede dedicarle media
// hora a «la base está sucia» sin tener que saber en qué módulo vive
// cada suciedad.
//
// LAS PANTALLAS NO SE DUPLICAN: son las mismas, dibujadas acá dentro.
// «Productos sin clasificar» sigue estando en Inventario, que es donde
// la busca quien está en farmacia.
// ---------------------------------------------------------------------

export function CalidadDeDatos() {
  return (
    <div>
      <PageHeader
        titulo="Calidad de datos"
        subtitulo="Lo que está repetido o incompleto, en un solo lugar."
        icono="aviso"
        modulo="admin"
      />
      <Tabs
        pestanas={[
          { clave: "duplicados", etiqueta: "Posibles duplicados", icono: "propietario" },
          { clave: "productos", etiqueta: "Productos sin clasificar", icono: "producto" },
          { clave: "fichas", etiqueta: "Fichas por completar", icono: "paciente" },
        ]}
        porDefecto="duplicados"
      >
        {(activa) =>
          activa === "productos" ? (
            <SinClasificar sinEncabezado />
          ) : activa === "fichas" ? (
            <FichasPorCompletar />
          ) : (
            <Duplicados sinEncabezado />
          )
        }
      </Tabs>
    </div>
  );
}

/**
 * Las fichas de paciente a las que les falta lo básico.
 *
 * NO SE REIMPLEMENTA LA LISTA: el listado de pacientes ya tiene el
 * filtro «ficha por completar» y la función
 * `pacientes_datos_basicos_faltantes` que lo decide (anexo 07-03, A5).
 * Una segunda lista con su propio criterio sería un segundo criterio, y
 * un día no coincidirían. Acá va la entrada.
 */
function FichasPorCompletar() {
  return (
    <Card className="mt-4">
      <CardTitle>Pacientes con la ficha incompleta</CardTitle>
      <CardDescription>
        Un paciente dado de alta a las apuradas —desde una cita, con el nombre y la especie— deja
        la ficha a medias: sin raza, sin sexo, sin estado reproductivo o sin edad. Son los datos
        que después hacen falta para la dosis, para el protocolo de vacunas y para los avisos.
      </CardDescription>
      <div className="mt-4">
        <Link to="/pacientes?filtro=ficha-incompleta">
          <Button>Ver los pacientes por completar</Button>
        </Link>
      </div>
      <p className="mt-3 text-xs text-text-muted">
        Es el mismo filtro del listado de pacientes: una sola lista y un solo criterio.
      </p>
    </Card>
  );
}
