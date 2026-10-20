import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { requireRole } from "@/lib/auth";
import type { Department, Election } from "@/lib/types";
import { createDepartment } from "../actions";

export const metadata = { title: "Departamentos · Votaciones Arca de Salvación" };

type Row = Department & { candidates: { count: number }[]; elections: Pick<Election, "id" | "status" | "created_at">[] };

export default async function DepartamentosPage() {
  const { supabase, profile } = await requireRole(["admin", "consulta", "operador"], "/admin/departamentos");
  const isAdmin = profile.role === "admin";
  const { data } = await supabase
    .from("departments")
    .select("*, candidates(count), elections(id, status, created_at)")
    .order("name")
    .returns<Row[]>();

  return (
    <>
      <PageHeader title="Departamentos" description="Departamentos de la iglesia, sus candidatos y elecciones." />
      <div className={`grid gap-6 ${isAdmin ? "lg:grid-cols-[1fr_360px]" : ""}`}>
        <section>
          {!data?.length ? (
            <EmptyState title="Sin departamentos">Agrega el primer departamento para preparar sus elecciones.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {data.map((d) => {
                const active = d.elections.find((e) => e.status !== "cerrada");
                const closed = d.elections.filter((e) => e.status === "cerrada").length;
                return (
                  <li key={d.id}>
                    <Link href={`/admin/departamentos/${d.id}`} className="card flex flex-col gap-2 p-4 transition hover:border-navy-600 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-display font-bold text-navy-900">
                          {d.name} {!d.active && <span className="ml-1 text-xs font-semibold text-red-700">(inactivo)</span>}
                        </p>
                        <p className="truncate text-sm text-muted">{d.description || "Sin descripción"}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="badge bg-navy-50 text-navy-800">{d.candidates[0]?.count ?? 0} candidatos</span>
                        <span className="badge bg-slate-100 text-slate-700">{closed} finalizadas</span>
                        {active && <StatusBadge status={active.status} />}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {isAdmin && (
          <aside className="card h-fit p-5">
            <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Nuevo departamento</h2>
            <ActionForm action={createDepartment} submitLabel="Crear departamento" resetOnSuccess>
              <div>
                <label className="label" htmlFor="name">
                  Nombre
                </label>
                <input id="name" name="name" className="input" placeholder="Ej.: Jóvenes, Damas, Caballeros" required />
              </div>
              <div>
                <label className="label" htmlFor="description">
                  Descripción (opcional)
                </label>
                <textarea id="description" name="description" className="input min-h-20" />
              </div>
            </ActionForm>
          </aside>
        )}
      </div>
    </>
  );
}
