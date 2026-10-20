import { Avatar } from "@/components/ui";
import { cargoLabel, votesLabel } from "@/lib/format";
import type { ElectionStatus, Standing } from "@/lib/types";

/** Clasificación con fotografía, votos, porcentaje y cargo. */
export function StandingsList({
  standings,
  photos,
  status,
}: {
  standings: Standing[];
  photos: Record<string, string>;
  status: ElectionStatus;
}) {
  const total = standings.reduce((s, x) => s + x.votes, 0);
  const sorted = [...standings].sort((a, b) => a.posicion - b.posicion || b.votes - a.votes);
  if (!sorted.length) return <p className="text-sm text-muted">Esta elección no tiene candidatos.</p>;

  return (
    <ol className="space-y-3">
      {sorted.map((s) => {
        const pct = total ? Math.round((s.votes / total) * 1000) / 10 : 0;
        return (
          <li key={s.candidate_id} className="flex items-center gap-3">
            <span className="font-display w-7 shrink-0 text-center text-lg font-bold text-gold-700">{s.posicion}</span>
            <Avatar name={s.full_name} url={s.photo_path ? photos[s.photo_path] : null} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold text-ink">{s.full_name}</p>
                <p className="shrink-0 text-sm font-bold text-navy-900">
                  {votesLabel(s.votes)} <span className="font-normal text-muted">({pct}%)</span>
                </p>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-navy-50">
                <div className="h-full rounded-full bg-navy-700" style={{ width: `${pct}%` }} />
              </div>
              <p className={`mt-1 text-xs ${s.tie_unresolved ? "font-semibold text-amber-700" : "text-muted"}`}>
                {status === "preparacion" ? "Cargo pendiente" : cargoLabel(s)}
                {status === "en_curso" && !s.tie_unresolved && s.cargo && " · provisional"}
                {s.tiebreak_rank && " · definido por desempate"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
