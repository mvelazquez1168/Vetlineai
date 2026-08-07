import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

export function AdminHome() {
  const { logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-background p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary">Admin de clínica</h1>
        <Button variant="secondary" onClick={logout}>
          Cerrar sesión
        </Button>
      </div>
      <Card>
        <p className="text-text-muted">
          Zona protegida para admins de clínica. Médicos, Agentes IA, Clínica y Facturación se
          construyen en la próxima fase.
        </p>
      </Card>
    </div>
  );
}
