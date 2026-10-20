import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { requireRole } from "@/lib/auth";
import { signPhotos } from "@/lib/photos";
import type { Election, Standing, Vote } from "@/lib/types";
import CountingBoard from "./counting-board";

export const metadata = { title: "Pantalla de conteo · Votaciones Arca de Salvación" };

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

  const [{ data: standingsData }, { data: votes }] = await Promise.all([
    supabase.rpc("election_standings", { p_election_id: id }),
    supabase
      .from("votes")
      .select("id, candidate_id, created_at, created_by, voided_at, void_reason")
      .eq("election_id", id)
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<Vote[]>(),
  ]);
  const standings = (standingsData ?? []) as Standing[];

  const photos = await signPhotos(supabase, (standings ?? []).map((s) => s.photo_path));
  const photoByCandidate = Object.fromEntries(
    (standings ?? []).map((s) => [s.candidate_id, s.photo_path ? (photos[s.photo_path] ?? null) : null]),
  );

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
        initialStandings={standings ?? []}
        initialVotes={votes ?? []}
        photos={photoByCandidate}
        canCorrect={!!canCorrect}
        isAdmin={profile.role === "admin"}
      />
    </>
  );
}
