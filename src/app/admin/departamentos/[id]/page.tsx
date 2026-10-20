import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AuditList } from "@/components/audit-list";
import { StandingsList } from "@/components/standings";
import { Avatar, PageHeader, ResultKindBadge, StatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { signPhotos } from "@/lib/photos";
import type { AuditLog, Candidate, Department, Election, Standing } from "@/lib/types";
import { createCandidate, createElection, updateCandidate, updateDepartment } from "../../actions";
import PhotoUpload from "./photo-upload";

export default async function DepartamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireRole(["admin", "consulta", "operador"], `/admin/departamentos/${id}`);
  const isAdmin = profile.role === "admin";

  const { data: department } = await supabase.from("departments").select("*").eq("id", id).maybeSingle<Department>();
  if (!department) notFound();

  const [{ data: candidates }, { data: elections }, { data: logs }] = await Promise.all([
    supabase.from("candidates").select("*").eq("department_id", id).order("full_name").returns<Candidate[]>(),
    supabase.from("elections").select("*").eq("department_id", id).order("created_at", { ascending: false }).returns<Election[]>(),
    supabase.from("audit_logs").select("*").eq("department_id", id).order("created_at", { ascending: false }).limit(30).returns<AuditLog[]>(),
  ]);

  const current = elections?.find((e) => e.status !== "cerrada") ?? elections?.[0];
  let standings: Standing[] = [];
  if (current) {
    const { data } = await supabase.rpc("election_standings", { p_election_id: current.id });
    standings = (data ?? []) as Standing[];
  }
  const photos = await signPhotos(supabase, [...(candidates ?? []).map((c) => c.photo_path), ...standings.map((s) => s.photo_path)]);
  const names = Object.fromEntries((candidates ?? []).map((c) => [c.id, c.full_name]));
  const hasActive = elections?.some((e) => e.status !== "cerrada");
  const totalVotes = standings.reduce((s, x) => s + x.votes, 0);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/departamentos", label: "Departamentos" }}
        title={department.name}
        description={department.description || "Sin descripción"}
        actions={!department.active ? <span className="badge bg-red-100 text-red-800">Inactivo</span> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {/* Elección actual o más reciente */}
          <section className="card p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-navy-900">{current ? current.title : "Sin elecciones"}</h2>
                {current && (
                  <p className="text-xs text-muted">
                    Inicio: {formatDateTime(current.started_at)} · Fin: {formatDateTime(current.closed_at)} · Total: {totalVotes} votos
                  </p>
                )}
              </div>
              {current && (
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={current.status} />
                  <ResultKindBadge status={current.status} />
                </div>
              )}
            </div>
            {current ? (
              <>
                <StandingsList standings={standings} photos={photos} status={current.status} />
                <Link href={`/admin/elecciones/${current.id}`} className="btn-outline mt-4">
                  Ver detalle de la elección
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted">Crea una elección para este departamento.</p>
            )}
          </section>

          {/* Candidatos */}
          <section className="card p-5">
            <h2 className="font-display mb-4 text-lg font-bold text-navy-900">Candidatos ({candidates?.length ?? 0})</h2>
            {!candidates?.length ? (
              <p className="text-sm text-muted">Aún no hay candidatos.</p>
            ) : (
              <ul className="divide-y divide-line">
                {candidates.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.full_name} url={c.photo_path ? photos[c.photo_path] : null} size={56} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">
                          {c.full_name}
                          {!c.active && <span className="ml-2 text-xs font-semibold text-red-700">(inactivo)</span>}
                        </p>
                        {c.notes && <p className="text-xs text-muted">{c.notes}</p>}
                      </div>
                      {isAdmin && <PhotoUpload candidateId={c.id} departmentId={id} hasPhoto={!!c.photo_path} />}
                    </div>
                    {isAdmin && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-navy-700">Editar datos</summary>
                        <ActionForm action={updateCandidate.bind(null, c.id, id)} submitLabel="Guardar" className="mt-2 space-y-3">
                          <input name="full_name" defaultValue={c.full_name} className="input" required aria-label="Nombre completo" />
                          <textarea name="notes" defaultValue={c.notes ?? ""} className="input min-h-16" placeholder="Notas (opcional)" aria-label="Notas" />
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="active" defaultChecked={c.active} /> Activo (se incluye por defecto en nuevas elecciones)
                          </label>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isAdmin && (
              <div className="mt-4 rounded-xl bg-paper p-4">
                <h3 className="mb-3 text-sm font-bold text-navy-900">Agregar candidato</h3>
                <ActionForm action={createCandidate.bind(null, id)} submitLabel="Agregar candidato" resetOnSuccess className="space-y-3">
                  <input name="full_name" className="input" placeholder="Nombre completo" required aria-label="Nombre completo" />
                  <input name="notes" className="input" placeholder="Notas (opcional)" aria-label="Notas" />
                </ActionForm>
                <p className="mt-2 text-xs text-muted">Después de agregarlo puedes subir su fotografía.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card p-5">
            <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Elecciones</h2>
            {!elections?.length ? (
              <p className="text-sm text-muted">Sin elecciones registradas.</p>
            ) : (
              <ul className="space-y-2">
                {elections.map((e) => (
                  <li key={e.id}>
                    <Link href={`/admin/elecciones/${e.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 hover:bg-paper">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{e.title}</span>
                        <span className="block text-xs text-muted">
                          {e.closed_at ? `Cerrada ${formatDateTime(e.closed_at)}` : `Creada ${formatDateTime(e.created_at)}`}
                        </span>
                      </span>
                      <StatusBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {isAdmin && !hasActive && (
              <div className="mt-4 rounded-xl bg-paper p-4">
                <h3 className="mb-3 text-sm font-bold text-navy-900">Preparar nueva elección</h3>
                <ActionForm action={createElection.bind(null, id)} submitLabel="Crear elección" resetOnSuccess className="space-y-3">
                  <div>
                    <label className="label" htmlFor="title">
                      Título
                    </label>
                    <input id="title" name="title" className="input" placeholder={`Directiva ${department.name} ${new Date().getFullYear() + 1}`} required />
                  </div>
                  <div>
                    <label className="label" htmlFor="cargos">
                      Cargos en orden (uno por línea)
                    </label>
                    <textarea id="cargos" name="cargos" className="input min-h-28" defaultValue={"Presidente\nVicepresidente\nSecretario\nTesorero"} />
                    <p className="mt-1 text-xs text-muted">El 1º lugar recibe el primer cargo, el 2º el segundo, etc.</p>
                  </div>
                </ActionForm>
                <p className="mt-2 text-xs text-muted">Se incluyen todos los candidatos activos; podrás ajustarlos antes de iniciar.</p>
              </div>
            )}
            {isAdmin && hasActive && (
              <p className="mt-3 text-xs text-muted">Para preparar otra elección, primero cierra la elección activa.</p>
            )}
          </section>

          {isAdmin && (
            <section className="card p-5">
              <details>
                <summary className="font-display cursor-pointer text-lg font-bold text-navy-900">Editar departamento</summary>
                <ActionForm action={updateDepartment.bind(null, id)} submitLabel="Guardar cambios" className="mt-3 space-y-3">
                  <input name="name" defaultValue={department.name} className="input" required aria-label="Nombre" />
                  <textarea name="description" defaultValue={department.description ?? ""} className="input min-h-20" aria-label="Descripción" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={department.active} /> Departamento activo
                  </label>
                </ActionForm>
              </details>
            </section>
          )}

          <section className="card p-5">
            <h2 className="font-display mb-2 text-lg font-bold text-navy-900">Historial</h2>
            <AuditList logs={logs ?? []} names={names} />
          </section>
        </aside>
      </div>
    </>
  );
}
