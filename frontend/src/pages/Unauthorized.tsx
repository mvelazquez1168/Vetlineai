import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";

export function Unauthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <h1 className="text-3xl font-bold text-primary">No autorizado</h1>
      <p className="max-w-md text-text-muted">
        Tu usuario no tiene permisos para acceder a esta sección de Vetline Ai.
      </p>
      <Link to="/login">
        <Button variant="secondary">Volver al login</Button>
      </Link>
    </div>
  );
}
