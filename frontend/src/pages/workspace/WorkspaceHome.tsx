import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

export function WorkspaceHome() {
  const { logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-background p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary">Workspace del médico</h1>
        <Button variant="secondary" onClick={logout}>
          Cerrar sesión
        </Button>
      </div>
      <Card>
        <p className="text-text-muted">
          Zona protegida para médicos. La pantalla completa (selector de agente, chat clínico,
          dashboard) se construye en la próxima fase.
        </p>
      </Card>
    </div>
  );
}
