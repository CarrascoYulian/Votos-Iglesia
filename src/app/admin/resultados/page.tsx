import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { signPhotos } from "@/lib/photos";
import type { ResultRow } from "@/lib/types";
import ResultsTable from "./results-table";

export const metadata = { title: "Resultados · Votaciones Arca de Salvación" };

export default async function ResultadosPage() {
  const { supabase } = await requireRole(["admin", "consulta", "operador"], "/admin/resultados");
  const { data, error } = await supabase.rpc("all_results");
  const rows = (data ?? []) as ResultRow[];
  const photos = await signPhotos(supabase, rows.map((r) => r.photo_path));

  return (
    <>
      <PageHeader
        title="Resultados generales"
        description="Todos los candidatos por elección. Las elecciones en curso muestran resultados provisionales."
      />
      {error ? (
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">No se pudieron cargar los resultados: {error.message}</p>
      ) : (
        <ResultsTable rows={rows.map((r) => ({ ...r, photo_url: r.photo_path ? (photos[r.photo_path] ?? null) : null }))} />
      )}
    </>
  );
}
