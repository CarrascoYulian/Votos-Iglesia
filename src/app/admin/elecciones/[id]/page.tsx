import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AuditList } from "@/components/audit-list";
import { StandingsList } from "@/components/standings";
import { PageHeader, ResultKindBadge, StatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { signPhotos } from "@/lib/photos";
import type { AuditLog, Candidate, Election, Profile, Standing, VoteAdjustment } from "@/lib/types";
import { updateElection } from "../../actions";
import { CandidateSelector, LifecycleControls, OperatorAssign, TieResolver } from "./controls";

type ElectionRow = Election & { departments: { id: string; name: string } | null };
type ResultSnapshot = { closing_number: number; full_name: string; votes: number; posicion: number; cargo: string | null; created_at: string };

export default async function EleccionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireRole(["admin", "consulta", "operador"], `/admin/elecciones/${id}`);
  const isAdmin = profile.role === "admin";

  const { data: election } = await supabase.from("elections").select("*, departments(id, name)").eq("id", id).maybeSingle<ElectionRow>();
  if (!election) notFound();

  const [standingsRes, candidatesRes, ecRes, votesValid, votesVoided, adjRes, logsRes, snapshotsRes, operatorsRes, assignedRes, profilesRes] =
    await Promise.all([
      supabase.rpc("election_standings", { p_election_id: id }),
      supabase.from("candidates").select("*").eq("department_id", election.department_id).order("full_name").returns<Candidate[]>(),
      supabase.from("election_candidates").select("candidate_id, ballot_order").eq("election_id", id).order("ballot_order"),
      supabase.from("votes").select("id", { count: "exact", head: true }).eq("election_id", id).is("voided_at", null),
      supabase.from("votes").select("id", { count: "exact", head: true }).eq("election_id", id).not("voided_at", "is", null),
      supabase.from("vote_adjustments").select("*").eq("election_id", id).order("created_at", { ascending: false }).returns<VoteAdjustment[]>(),
      supabase.from("audit_logs").select("*").eq("election_id", id).order("created_at", { ascending: false }).limit(100).returns<AuditLog[]>(),
      supabase.from("election_results").select("closing_number, full_name, votes, posicion, cargo, created_at").eq("election_id", id).order("closing_number", { ascending: false }).order("posicion").returns<ResultSnapshot[]>(),
      isAdmin
        ? supabase.from("profiles").select("id, email, full_name, role, can_correct").eq("role", "operador").order("email").returns<Profile[]>()
        : Promise.resolve({ data: [] as Profile[] }),
      supabase.from("election_operators").select("user_id").eq("election_id", id),
      isAdmin ? supabase.from("profiles").select("id, email, full_name").returns<Profile[]>() : Promise.resolve({ data: [] as Profile[] }),
    ]);

  if (standingsRes.error) {
    return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">No tienes acceso a esta elección.</p>;
  }

  const standings = (standingsRes.data ?? []) as Standing[];
  const candidates = candidatesRes.data ?? [];
  const photos = await signPhotos(supabase, [...standings.map((s) => s.photo_path), ...candidates.map((c) => c.photo_path)]);
  const names = Object.fromEntries(candidates.map((c) => [c.id, c.full_name]));
  const people = Object.fromEntries((profilesRes.data ?? []).map((p) => [p.id, p.full_name || p.email]));

  const unresolved = standings.filter((s) => s.tie_unresolved);
  const tieGroups = Object.values(
    unresolved.reduce<Record<number, Standing[]>>((acc, s) => {
      (acc[s.votes] ??= []).push(s);
      return acc;
    }, {}),
  );

  const snapshots = Object.entries(
    (snapshotsRes.data ?? []).reduce<Record<number, ResultSnapshot[]>>((acc, r) => {
      (acc[r.closing_number] ??= []).push(r);
      return acc;
    }, {}),
  ).sort((a, b) => Number(b[0]) - Number(a[0]));

  return (
    <>
      <PageHeader
        back={{ href: `/admin/departamentos/${election.department_id}`, label: election.departments?.name ?? "Departamento" }}
        title={election.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={election.status} />
            <ResultKindBadge status={election.status} />
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="card p-5">
            <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Votos válidos</p>
                <p className="font-display text-2xl font-bold text-navy-900">{votesValid.count ?? 0}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Anulados</p>
                <p className="font-display text-2xl font-bold text-navy-900">{votesVoided.count ?? 0}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Inicio</p>
                <p className="font-medium">{formatDateTime(election.started_at)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Finalización</p>
                <p className="font-medium">{formatDateTime(election.closed_at)}</p>
                {election.closed_by && people[election.closed_by] && <p className="text-xs text-muted">por {people[election.closed_by]}</p>}
              </div>
            </div>
            <h2 className="font-display mb-3 text-lg font-bold text-navy-900">
              Clasificación {election.status === "cerrada" ? "definitiva" : election.status === "en_curso" ? "provisional" : ""}
            </h2>
            <StandingsList standings={standings} photos={photos} status={election.status} />
            <div className="mt-4 rounded-xl bg-paper p-3 text-xs text-muted">
              <strong className="text-ink">Cargos en orden:</strong>{" "}
              {election.cargos.length ? election.cargos.map((c, i) => `${i + 1}. ${c}`).join(" · ") : "Sin definir"}
            </div>
          </section>

          {isAdmin && election.status === "en_curso" && tieGroups.length > 0 && (
            <section className="card p-5">
              <h2 className="font-display mb-1 text-lg font-bold text-navy-900">Empates por resolver</h2>
              <p className="mb-4 text-sm text-muted">
                Estos empates impiden asignar cargos. Resuélvelos (por ejemplo con una segunda votación) antes de cerrar. Si después cambian los
                votos, el desempate se borra automáticamente.
              </p>
              <TieResolver electionId={id} groups={tieGroups} photos={photos} />
            </section>
          )}

          {isAdmin && election.status === "preparacion" && (
            <section className="card p-5">
              <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Candidatos en la papeleta</h2>
              <CandidateSelector
                electionId={id}
                candidates={candidates.map((c) => ({ id: c.id, full_name: c.full_name, active: c.active, photo_url: c.photo_path ? (photos[c.photo_path] ?? null) : null }))}
                selected={(ecRes.data ?? []).map((r) => r.candidate_id as string)}
              />
            </section>
          )}

          <section className="card p-5">
            <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Correcciones de votos</h2>
            {!adjRes.data?.length ? (
              <p className="text-sm text-muted">No se han corregido votos.</p>
            ) : (
              <ul className="divide-y divide-line">
                {adjRes.data.map((a) => (
                  <li key={a.id} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{a.kind === "anulacion" ? "Anulación" : "Reasignación"}</span>
                      <span className="text-xs text-muted">{formatDateTime(a.created_at)}</span>
                    </div>
                    <p className="text-xs text-muted">
                      {a.reason}
                      {people[a.created_by] && ` · por ${people[a.created_by]}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {snapshots.length > 0 && (
            <section className="card p-5">
              <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Resultados guardados en cada cierre</h2>
              <div className="space-y-4">
                {snapshots.map(([n, rows]) => (
                  <div key={n}>
                    <p className="mb-1 text-sm font-semibold text-ink">
                      Cierre nº {n} · {formatDateTime(rows[0].created_at)}
                      {Number(n) === election.closing_count && election.status === "cerrada" && (
                        <span className="badge ml-2 bg-emerald-100 text-emerald-800">vigente</span>
                      )}
                    </p>
                    <ol className="text-sm text-muted">
                      {rows.map((r) => (
                        <li key={r.full_name}>
                          {r.posicion}. {r.full_name} — {r.votes} votos — {r.cargo ?? "sin cargo"}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          {isAdmin && (
            <section className="card p-5">
              <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Acciones</h2>
              <LifecycleControls
                electionId={id}
                status={election.status}
                hasUnresolvedTie={unresolved.length > 0}
                totalVotes={votesValid.count ?? 0}
              />
            </section>
          )}

          {isAdmin && election.status !== "cerrada" && (
            <section className="card p-5">
              <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Operadores de conteo</h2>
              <OperatorAssign
                electionId={id}
                operators={(operatorsRes.data ?? []).map((o) => ({ id: o.id, label: o.full_name || o.email, can_correct: o.can_correct }))}
                assigned={(assignedRes.data ?? []).map((a) => a.user_id as string)}
              />
            </section>
          )}

          {isAdmin && election.status === "preparacion" && (
            <section className="card p-5">
              <h2 className="font-display mb-3 text-lg font-bold text-navy-900">Configuración</h2>
              <ActionForm action={updateElection.bind(null, id)} submitLabel="Guardar configuración" className="space-y-3">
                <div>
                  <label className="label" htmlFor="title">
                    Título
                  </label>
                  <input id="title" name="title" defaultValue={election.title} className="input" required />
                </div>
                <div>
                  <label className="label" htmlFor="cargos">
                    Cargos en orden (uno por línea)
                  </label>
                  <textarea id="cargos" name="cargos" defaultValue={election.cargos.join("\n")} className="input min-h-28" />
                </div>
                <div>
                  <label className="label" htmlFor="notes">
                    Notas
                  </label>
                  <textarea id="notes" name="notes" defaultValue={election.notes ?? ""} className="input min-h-16" />
                </div>
              </ActionForm>
            </section>
          )}

          <section className="card p-5">
            <h2 className="font-display mb-2 text-lg font-bold text-navy-900">Historial de operaciones</h2>
            <AuditList logs={logsRes.data ?? []} names={names} />
          </section>
        </aside>
      </div>
    </>
  );
}
