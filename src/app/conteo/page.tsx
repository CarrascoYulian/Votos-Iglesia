import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { Election } from "@/lib/types";

export const metadata = { title: "Conteo · Votaciones Arca de Salvación" };

type Row = Election & { departments: { name: string } | null };

export default async function ConteoPage() {
  const { supabase, profile } = await requireRole(["admin", "operador"], "/conteo");

  let query = supabase
    .from("elections")
    .select("*, departments(name)")
    .eq("status", "en_curso")
    .order("started_at", { ascending: false });

  if (profile.role === "operador") {
    const { data: assigned } = await supabase.from("election_operators").select("election_id").eq("user_id", profile.id);
    const ids = (assigned ?? []).map((a) => a.election_id as string);
    query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data: elections } = await query.returns<Row[]>();

  return (
    <>
      <AppHeader profile={profile} subtitle="Conteo de votos" />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <PageHeader
          title="Elecciones en conteo"
          description="Elige la elección cuyos papeles se están leyendo en público."
        />
        {!elections?.length ? (
          <EmptyState title="No hay conteos abiertos para ti">
            {profile.role === "admin"
              ? "Inicia el conteo de una elección desde el panel administrativo."
              : "Un administrador debe iniciar el conteo y asignarte como operador."}
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {elections.map((e) => (
              <li key={e.id}>
                <Link href={`/conteo/${e.id}`} className="card block p-5 transition hover:border-navy-600 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">{e.departments?.name}</p>
                    <StatusBadge status={e.status} />
                  </div>
                  <p className="font-display mt-1 text-lg font-bold text-navy-900">{e.title}</p>
                  <p className="mt-1 text-xs text-muted">Iniciado: {formatDateTime(e.started_at)}</p>
                  <p className="mt-3 text-sm font-semibold text-navy-700">Abrir pantalla de conteo →</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
