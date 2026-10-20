import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import type { Profile } from "@/lib/types";
import UserRow from "./user-row";

export const metadata = { title: "Usuarios · Votaciones Arca de Salvación" };

export default async function UsuariosPage() {
  const { supabase, profile } = await requireRole(["admin"], "/admin/usuarios");
  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, can_correct, created_at")
    .order("created_at")
    .returns<Profile[]>();
  const pending = (users ?? []).filter((u) => u.role === "pendiente");

  return (
    <>
      <PageHeader
        title="Usuarios autorizados"
        description="Las personas solicitan acceso desde la pantalla de inicio de sesión; aquí se les asigna un rol. Los votantes no necesitan cuenta."
      />
      {pending.length > 0 && (
        <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {pending.length} {pending.length === 1 ? "cuenta espera" : "cuentas esperan"} aprobación.
        </p>
      )}
      <div className="card divide-y divide-line">
        {(users ?? []).map((u) => (
          <UserRow key={u.id} user={u} isSelf={u.id === profile.id} />
        ))}
      </div>
      <div className="mt-6 grid gap-3 text-sm text-muted sm:grid-cols-3">
        <p className="card p-4">
          <strong className="text-ink">Administrador:</strong> gestiona departamentos, candidatos, usuarios, inicia y cierra elecciones, resuelve
          empates y autoriza reaperturas.
        </p>
        <p className="card p-4">
          <strong className="text-ink">Operador de conteo:</strong> registra votos en las elecciones que se le asignen. Con “puede corregir”
          también anula o reasigna votos.
        </p>
        <p className="card p-4">
          <strong className="text-ink">Consulta:</strong> ve resultados e historial, sin registrar ni modificar votos.
        </p>
      </div>
    </>
  );
}
