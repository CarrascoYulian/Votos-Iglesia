"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";
import type { ActionResult, ElectionStatus, Standing } from "@/lib/types";
import { assignOperator, closeElection, reopenElection, resolveTie, setElectionCandidates, startElection } from "../../actions";

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
      {result.ok ? result.message : result.error}
    </p>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        onOk?.();
        router.refresh();
      }
    });
  }
  return { pending, result, run };
}

// ----------------------------------------------------------------------------- Inicio / cierre / reapertura
export function LifecycleControls({
  electionId,
  status,
  hasUnresolvedTie,
  totalVotes,
}: {
  electionId: string;
  status: ElectionStatus;
  hasUnresolvedTie: boolean;
  totalVotes: number;
}) {
  const { pending, result, run } = useAction();
  const [dialog, setDialog] = useState<null | "iniciar" | "cerrar" | "reabrir">(null);
  const [text, setText] = useState("");
  const [confirmWord, setConfirmWord] = useState("");

  const close = () => {
    setDialog(null);
    setText("");
    setConfirmWord("");
  };

  return (
    <div className="space-y-3">
      {status === "preparacion" && (
        <button className="btn-gold w-full py-3" onClick={() => setDialog("iniciar")}>
          Iniciar conteo
        </button>
      )}
      {status === "en_curso" && (
        <>
          <a href={`/conteo/${electionId}`} className="btn-primary w-full py-3">
            Abrir pantalla de conteo
          </a>
          <button className="btn-outline w-full" onClick={() => setDialog("cerrar")} disabled={hasUnresolvedTie}>
            Finalizar y cerrar elección
          </button>
          {hasUnresolvedTie && (
            <p className="text-xs font-medium text-amber-700">Resuelve los empates que afectan cargos antes de cerrar.</p>
          )}
        </>
      )}
      {status === "cerrada" && (
        <button className="btn-outline w-full" onClick={() => setDialog("reabrir")}>
          Reabrir elección…
        </button>
      )}
      <Result result={result} />

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="card w-full max-w-md space-y-4 p-6">
            {dialog === "iniciar" && (
              <>
                <h2 className="font-display text-lg font-bold text-navy-900">¿Iniciar el conteo?</h2>
                <p className="text-sm text-muted">
                  Los operadores asignados podrán registrar votos. Después de iniciar ya no se pueden cambiar los candidatos ni los cargos.
                </p>
                <div className="flex justify-end gap-2">
                  <button className="btn-outline" onClick={close}>
                    Cancelar
                  </button>
                  <button className="btn-gold" disabled={pending} onClick={() => run(() => startElection(electionId), close)}>
                    {pending ? "Iniciando…" : "Sí, iniciar"}
                  </button>
                </div>
              </>
            )}
            {dialog === "cerrar" && (
              <>
                <h2 className="font-display text-lg font-bold text-navy-900">Cerrar la elección</h2>
                <p className="text-sm text-muted">
                  Se guardarán los resultados definitivos ({totalVotes} votos válidos), se registrará quién cerró y cuándo, y no se aceptarán más votos.
                  Revisa la clasificación antes de confirmar.
                </p>
                <textarea className="input min-h-20" placeholder="Notas del cierre (opcional)" value={text} onChange={(e) => setText(e.target.value)} />
                <div>
                  <label className="label" htmlFor="confirm-close">
                    Escribe CERRAR para confirmar
                  </label>
                  <input id="confirm-close" className="input" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn-outline" onClick={close}>
                    Cancelar
                  </button>
                  <button
                    className="btn-primary"
                    disabled={pending || confirmWord.trim().toUpperCase() !== "CERRAR"}
                    onClick={() => run(() => closeElection(electionId, text), close)}
                  >
                    {pending ? "Cerrando…" : "Cerrar elección"}
                  </button>
                </div>
              </>
            )}
            {dialog === "reabrir" && (
              <>
                <h2 className="font-display text-lg font-bold text-navy-900">Reabrir la elección</h2>
                <p className="text-sm text-muted">
                  Los resultados del cierre anterior se conservan en el historial. La reapertura queda registrada con tu nombre y el motivo.
                </p>
                <textarea className="input min-h-24" placeholder="Motivo de la reapertura (obligatorio)" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <button className="btn-outline" onClick={close}>
                    Cancelar
                  </button>
                  <button className="btn-danger" disabled={pending || text.trim().length < 10} onClick={() => run(() => reopenElection(electionId, text), close)}>
                    {pending ? "Reabriendo…" : "Reabrir"}
                  </button>
                </div>
              </>
            )}
            <Result result={result?.ok ? null : result} />
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- Candidatos de la elección (preparación)
export function CandidateSelector({
  electionId,
  candidates,
  selected,
}: {
  electionId: string;
  candidates: { id: string; full_name: string; photo_url: string | null; active: boolean }[];
  selected: string[];
}) {
  const { pending, result, run } = useAction();
  const [chosen, setChosen] = useState<string[]>(selected);

  function toggle(id: string) {
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  return (
    <div className="space-y-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${chosen.includes(c.id) ? "border-navy-600 bg-navy-50" : "border-line"}`}>
              <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} />
              <Avatar name={c.full_name} url={c.photo_url} size={36} />
              <span className="min-w-0 truncate text-sm font-medium">
                {c.full_name}
                {!c.active && <span className="ml-1 text-xs text-red-700">(inactivo)</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">El orden de la papeleta sigue el orden en que los marques.</p>
      <button className="btn-primary" disabled={pending} onClick={() => run(() => setElectionCandidates(electionId, chosen))}>
        {pending ? "Guardando…" : `Guardar candidatos (${chosen.length})`}
      </button>
      <Result result={result} />
    </div>
  );
}

// ----------------------------------------------------------------------------- Operadores asignados
export function OperatorAssign({
  electionId,
  operators,
  assigned,
}: {
  electionId: string;
  operators: { id: string; label: string; can_correct: boolean }[];
  assigned: string[];
}) {
  const { pending, result, run } = useAction();
  if (!operators.length) {
    return <p className="text-sm text-muted">No hay usuarios con rol de operador. Asígnalo en la sección Usuarios.</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {operators.map((o) => {
          const on = assigned.includes(o.id);
          return (
            <li key={o.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0 text-sm">
                <span className="block truncate font-medium">{o.label}</span>
                <span className="text-xs text-muted">{o.can_correct ? "Puede corregir votos" : "Sin permiso de corrección"}</span>
              </span>
              <button
                className={on ? "btn-outline px-3 py-1.5 text-xs" : "btn-primary px-3 py-1.5 text-xs"}
                disabled={pending}
                onClick={() => run(() => assignOperator(electionId, o.id, !on))}
              >
                {on ? "Retirar" : "Asignar"}
              </button>
            </li>
          );
        })}
      </ul>
      <Result result={result} />
    </div>
  );
}

// ----------------------------------------------------------------------------- Desempate
export function TieResolver({ electionId, groups, photos }: { electionId: string; groups: Standing[][]; photos: Record<string, string> }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <TieGroup key={g.map((s) => s.candidate_id).join()} electionId={electionId} group={g} photos={photos} />
      ))}
    </div>
  );
}

function TieGroup({ electionId, group, photos }: { electionId: string; group: Standing[]; photos: Record<string, string> }) {
  const { pending, result, run } = useAction();
  const [order, setOrder] = useState(group.map((s) => s.candidate_id));
  const [reason, setReason] = useState("");
  const byId = Object.fromEntries(group.map((s) => [s.candidate_id, s]));

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="mb-3 text-sm font-semibold text-amber-900">
        Empate a {group[0].votes} votos en la posición {group[0].posicion}. Ordena según la decisión tomada (1 = mejor posición):
      </p>
      <ol className="space-y-2">
        {order.map((id, i) => (
          <li key={id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2">
            <span className="font-display w-5 font-bold text-gold-700">{i + 1}</span>
            <Avatar name={byId[id].full_name} url={byId[id].photo_path ? photos[byId[id].photo_path!] : null} size={32} />
            <span className="flex-1 truncate text-sm font-medium">{byId[id].full_name}</span>
            <button className="btn-ghost px-2 py-1" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">
              ↑
            </button>
            <button className="btn-ghost px-2 py-1" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Bajar">
              ↓
            </button>
          </li>
        ))}
      </ol>
      <textarea
        className="input mt-3 min-h-16"
        placeholder="¿Cómo se resolvió? Ej.: segunda votación a mano alzada, sorteo público…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button className="btn-primary mt-3" disabled={pending || reason.trim().length < 5} onClick={() => run(() => resolveTie(electionId, order, reason))}>
        {pending ? "Guardando…" : "Confirmar desempate"}
      </button>
      <div className="mt-2">
        <Result result={result} />
      </div>
    </div>
  );
}
