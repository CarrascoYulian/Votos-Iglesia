import { AuditList } from "@/components/audit-list";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import type { AuditLog } from "@/lib/types";

export const metadata = { title: "Historial · Votaciones Arca de Salvación" };

export default async function HistorialPage() {
  const { supabase } = await requireRole(["admin"], "/admin/historial");
  const [{ data: logs }, { data: candidates }] = await Promise.all([
    supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(300).returns<AuditLog[]>(),
    supabase.from("candidates").select("id, full_name"),
  ]);
  const names = Object.fromEntries((candidates ?? []).map((c) => [c.id as string, c.full_name as string]));

  return (
    <>
      <PageHeader
        title="Historial de operaciones"
        description="Registro de auditoría de todas las acciones administrativas y correcciones (últimas 300). No se puede editar ni borrar."
      />
      <div className="card p-5">
        <AuditList logs={logs ?? []} names={names} />
      </div>
    </>
  );
}
