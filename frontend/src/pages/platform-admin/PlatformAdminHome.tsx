import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

export function PlatformAdminHome() {
  const { logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-background p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary">Platform Admin</h1>
        <Button variant="secondary" onClick={logout}>
          Cerrar sesión
        </Button>
      </div>
      <Card>
        <p className="text-text-muted">
          Zona protegida para staff de plataforma. Solicitudes de activación, Clínicas y Agentes
          se construyen en la próxima fase.
        </p>
      </Card>
    </div>
  );
}
