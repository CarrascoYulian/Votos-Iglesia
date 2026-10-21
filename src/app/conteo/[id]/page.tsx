import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { requireRole } from "@/lib/auth";
import { signPhotos } from "@/lib/photos";
import type { Election, Standing, Vote, WithdrawnCandidate } from "@/lib/types";
import CountingBoard from "./counting-board";

export const metadata = { title: "Pantalla de conteo · Votaciones Arca de Salvación" };

type EcRow = {
  candidate_id: string;
  withdrawn_at: string | null;
  withdraw_reason: string | null;
  candidates: { full_name: string; photo_path: string | null } | null;
};

export default async function ConteoEleccionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireRole(["admin", "operador"], `/conteo/${id}`);

  const { data: election } = await supabase
    .from("elections")
    .select("*, departments(name)")
    .eq("id", id)
    .maybeSingle<Election & { departments: { name: string } | null }>();
  if (!election) notFound();

  const [{ data: canCount }, { data: canCorrect }] = await Promise.all([
    supabase.rpc("can_count", { p_election_id: id }),
    supabase.rpc("can_correct", { p_election_id: id }),
  ]);
  if (!canCount) redirect("/conteo");

  const [{ data: standingsData }, { data: votes }, { data: ecData }] = await Promise.all([
    supabase.rpc("election_standings", { p_election_id: id }),
    supabase
      .from("votes")
      .select("id, candidate_id, created_at, created_by, voided_at, void_reason")
      .eq("election_id", id)
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<Vote[]>(),
    supabase
      .from("election_candidates")
      .select("candidate_id, withdrawn_at, withdraw_reason, candidates(full_name, photo_path)")
      .eq("election_id", id)
      .returns<EcRow[]>(),
  ]);
  const standings = (standingsData ?? []) as Standing[];
  const rows = ecData ?? [];

  const signed = await signPhotos(supabase, rows.map((r) => r.candidates?.photo_path));
  const photos = Object.fromEntries(
    rows.map((r) => [r.candidate_id, r.candidates?.photo_path ? (signed[r.candidates.photo_path] ?? null) : null]),
  );
  const names = Object.fromEntries(rows.map((r) => [r.candidate_id, r.candidates?.full_name ?? ""]));
  const withdrawn: WithdrawnCandidate[] = rows
    .filter((r) => r.withdrawn_at)
    .map((r) => ({
      candidate_id: r.candidate_id,
      full_name: r.candidates?.full_name ?? "",
      withdrawn_at: r.withdrawn_at!,
      withdraw_reason: r.withdraw_reason,
    }));

  return (
    <>
      <AppHeader profile={profile} subtitle="Pantalla de conteo" />
      <CountingBoard
        election={{
          id: election.id,
          title: election.title,
          status: election.status,
          department: election.departments?.name ?? "",
          cargos: election.cargos,
        }}
        initialStandings={standings}
        initialVotes={votes ?? []}
        initialWithdrawn={withdrawn}
        photos={photos}
        names={names}
        canReassign={!!canCorrect}
        isAdmin={profile.role === "admin"}
      />
    </>
  );
}
