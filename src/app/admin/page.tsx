import Link from "next/link";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { Department, Election } from "@/lib/types";

export default async function AdminDashboard() {
  const { supabase, profile } = await requireRole(["admin", "consulta", "operador"], "/admin");

  const [departments, candidates, votes, elections] = await Promise.all([
    supabase.from("departments").select("*").order("name").returns<Department[]>(),
    supabase.from("candidates").select("id", { count: "exact", head: true }),
    supabase.from("votes").select("id", { count: "exact", head: true }).is("voided_at", null),
    supabase.from("elections").select("*").order("created_at", { ascending: false }).returns<Election[]>(),
  ]);

  const list = elections.data ?? [];
  const byStatus = (s: Election["status"]) => list.filter((e) => e.status === s).length;
  const latestByDept = new Map<string, Election>();
  for (const e of list) {
    const prev = latestByDept.get(e.department_id);
    // Prioriza la elección activa; si no hay, la más reciente.
    if (!prev || (prev.status === "cerrada" && e.status !== "cerrada")) latestByDept.set(e.department_id, e);
  }

  return (
    <>
      <PageHeader
        title="Resumen electoral"
        description="Estado general de los departamentos y del conteo de votos."
        actions={
          profile.role === "admin" ? (
            <Link href="/admin/departamentos" className="btn-primary">
              Gestionar departamentos
            </Link>
          ) : undefined
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Indicadores">
        <StatCard label="Departamentos" value={departments.data?.length ?? 0} />
        <StatCard label="Candidatos" value={candidates.count ?? 0} />
        <StatCard label="Votos registrados" value={votes.count ?? 0} hint="Válidos, sin anulados" />
        <StatCard label="Pendientes" value={byStatus("preparacion")} hint="En preparación" />
        <StatCard label="En curso" value={byStatus("en_curso")} hint="Conteo abierto" />
        <StatCard label="Finalizadas" value={byStatus("cerrada")} hint="Resultados definitivos" />
      </section>

      <section className="mt-8">
        <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Departamentos y estado electoral</h2>
        {!departments.data?.length ? (
          <EmptyState title="Todavía no hay departamentos">
            {profile.role === "admin" ? (
              <Link href="/admin/departamentos" className="font-semibold text-navy-700 underline">
                Crea el primer departamento
              </Link>
            ) : (
              "Un administrador debe registrarlos."
            )}
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {departments.data.map((d) => {
              const e = latestByDept.get(d.id);
              return (
                <li key={d.id}>
                  <Link
                    href={`/admin/departamentos/${d.id}`}
                    className="card block h-full p-5 transition hover:border-navy-600 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-display text-base font-bold text-navy-900">{d.name}</p>
                      {e ? <StatusBadge status={e.status} /> : <span className="badge bg-slate-100 text-slate-500">Sin elección</span>}
                    </div>
                    {e ? (
                      <>
                        <p className="mt-1 text-sm text-ink">{e.title}</p>
                        <p className="mt-1 text-xs text-muted">
                          {e.status === "cerrada"
                            ? `Cerrada: ${formatDateTime(e.closed_at)}`
                            : e.status === "en_curso"
                              ? `Iniciada: ${formatDateTime(e.started_at)}`
                              : "En preparación"}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-muted">{d.description || "Sin elecciones registradas."}</p>
                    )}
                    {!d.active && <p className="mt-2 text-xs font-semibold text-red-700">Departamento inactivo</p>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
