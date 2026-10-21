"use client";

import { useMemo, useState } from "react";
import { Avatar, NumberBadge } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cargoProblems } from "@/lib/cargos";
import { errorMessage, votesLabel } from "@/lib/format";
import type { Standing } from "@/lib/types";

/**
 * Asignación de cargos por quien realiza el conteo.
 * El 1er lugar (sin empate) recibe automáticamente el primer cargo; el resto se elige aquí.
 */
export function CargoAssigner({
  electionId,
  cargos,
  standings,
  photos,
  onChanged,
}: {
  electionId: string;
  cargos: string[];
  standings: Standing[];
  photos: Record<string, string | null>;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = cargos[0];
  const ranking = [...standings].sort((a, b) => a.posicion - b.posicion || a.ballot_order - b.ballot_order);
  const leaders = ranking.filter((s) => s.posicion === 1).length;
  const problems = cargoProblems(cargos, standings);
  const uniqueCargos = [...new Set(cargos)];
  const occurrences = (c: string) => cargos.filter((x) => x === c).length;
  const takenBy = (c: string, exclude: string) => standings.filter((s) => s.cargo === c && s.candidate_id !== exclude).length;
  const assigned = standings.filter((s) => s.cargo).length;

  async function assign(candidateId: string, cargo: string) {
    setSaving(candidateId);
    setError(null);
    const { error } = await supabase.rpc("assign_cargo", {
      p_election_id: electionId,
      p_candidate_id: candidateId,
      p_cargo: cargo || null,
    });
    setSaving(null);
    if (error) setError(errorMessage(error));
    onChanged();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        El 1er lugar recibe automáticamente <strong className="text-ink">{first ?? "el primer cargo"}</strong>. Al terminar el conteo, elige el cargo de
        cada una de las demás personas. Cargos asignados: {assigned} de {cargos.length}.
      </p>
      {leaders > 1 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Hay empate en el 1er lugar: asigna <strong>{first}</strong> a uno de los empatados.
        </p>
      )}
      {problems.length > 0 && (
        <ul className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {problems.map((p) => (
            <li key={p}>⚠ {p}</li>
          ))}
        </ul>
      )}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <ul className="divide-y divide-line">
        {ranking.map((s) => {
          const canTakeFirst = s.posicion === 1 && leaders > 1;
          return (
            <li key={s.candidate_id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="font-display w-7 text-center font-bold text-gold-700">{s.posicion}º</span>
                <NumberBadge n={s.numero} size="sm" />
                <Avatar name={s.full_name} url={photos[s.candidate_id]} size={36} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{s.full_name}</span>
                  <span className="text-xs text-muted">{votesLabel(s.votes)}</span>
                </span>
              </div>
              {s.cargo_auto ? (
                <span className="badge self-start bg-gold-100 text-gold-700 sm:self-auto">{s.cargo} · automático</span>
              ) : (
                <select
                  className="input sm:w-56"
                  value={s.cargo ?? ""}
                  disabled={saving !== null}
                  onChange={(e) => assign(s.candidate_id, e.target.value)}
                  aria-label={`Cargo de ${s.full_name}`}
                >
                  <option value="">{saving === s.candidate_id ? "Guardando…" : "Sin cargo"}</option>
                  {uniqueCargos.map((c) => {
                    const free = occurrences(c) - takenBy(c, s.candidate_id);
                    const isFirst = c === first;
                    const disabled = (isFirst && !canTakeFirst) || free <= 0;
                    if (isFirst && !canTakeFirst && s.cargo !== c) return null;
                    return (
                      <option key={c} value={c} disabled={disabled && s.cargo !== c}>
                        {c}
                        {occurrences(c) > 1 ? ` (${Math.max(free, 0)} libre${free === 1 ? "" : "s"})` : free <= 0 && s.cargo !== c ? " (ocupado)" : ""}
                      </option>
                    );
                  })}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
