"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";
import { CargoAssigner } from "@/components/cargo-assigner";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatDateTime } from "@/lib/format";
import type { ActionResult, ElectionStatus, Standing, WithdrawnCandidate } from "@/lib/types";
import { assignOperator, closeElection, deleteElection, reopenElection, setElectionCandidates, startElection } from "../../actions";

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
  problems,
  vacant,
  totalVotes,
  showCountLink = true,
  onDone,
}: {
  electionId: string;
  status: ElectionStatus;
  problems: string[];
  vacant: string[];
  totalVotes: number;
  showCountLink?: boolean;
  onDone?: () => void;
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
  const done = () => {
    close();
    onDone?.();
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
          {showCountLink && (
            <a href={`/conteo/${electionId}`} className="btn-primary w-full py-3">
              Abrir pantalla de conteo
            </a>
          )}
          <button className="btn-gold w-full py-3" onClick={() => setDialog("cerrar")} disabled={problems.length > 0}>
            Finalizar y cerrar elección
          </button>
          {problems.length > 0 && (
            <p className="text-xs font-medium text-amber-700">Corrige la asignación de cargos antes de cerrar.</p>
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
                  <button className="btn-gold" disabled={pending} onClick={() => run(() => startElection(electionId), done)}>
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
                  Revisa la clasificación y los cargos antes de confirmar.
                </p>
                {vacant.length > 0 && (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Cargos sin asignar: <strong>{vacant.join(", ")}</strong>. Si cierras así, quedarán vacantes.
                  </p>
                )}
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
                    onClick={() => run(() => closeElection(electionId, text), done)}
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
                  <button className="btn-danger" disabled={pending || text.trim().length < 10} onClick={() => run(() => reopenElection(electionId, text), done)}>
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
                <span className="text-xs text-muted">{o.can_correct ? "Puede reasignar votos" : "Puede quitar votos"}</span>
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

// ----------------------------------------------------------------------------- Cargos
export function AdminCargoAssigner(props: {
  electionId: string;
  cargos: string[];
  standings: Standing[];
  photos: Record<string, string | null>;
}) {
  const router = useRouter();
  return <CargoAssigner {...props} onChanged={() => router.refresh()} />;
}

// ----------------------------------------------------------------------------- Retirar / restaurar candidatos (conteo abierto)
export function CandidatesManager({
  electionId,
  active,
  withdrawn,
}: {
  electionId: string;
  active: { candidate_id: string; full_name: string }[];
  withdrawn: WithdrawnCandidate[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setTarget(null);
    setReason("");
    router.refresh();
  }

  const supabase = createClient();
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {active.map((c) => (
          <li key={c.candidate_id} className="py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{c.full_name}</span>
              {target !== c.candidate_id && (
                <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => setTarget(c.candidate_id)}>
                  Retirar
                </button>
              )}
            </div>
            {target === c.candidate_id && (
              <div className="mt-2 space-y-2">
                <input className="input" placeholder="Motivo del retiro" value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex gap-2">
                  <button
                    className="btn-danger px-3 py-1.5 text-xs"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      call(() => supabase.rpc("withdraw_candidate", { p_election_id: electionId, p_candidate_id: c.candidate_id, p_reason: reason }))
                    }
                  >
                    {busy ? "Guardando…" : "Confirmar retiro"}
                  </button>
                  <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => setTarget(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {withdrawn.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Retirados</p>
          <ul className="divide-y divide-line">
            {withdrawn.map((w) => (
              <li key={w.candidate_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-muted line-through">{w.full_name}</span>
                  <span className="block text-xs text-muted">
                    {formatDateTime(w.withdrawn_at)} · {w.withdraw_reason}
                  </span>
                </span>
                <button
                  className="btn-outline px-3 py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => call(() => supabase.rpc("restore_candidate", { p_election_id: electionId, p_candidate_id: w.candidate_id }))}
                >
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </div>
  );
}

// ----------------------------------------------------------------------------- Eliminar elección
export function DeleteElection({ electionId, title, totalVotes }: { electionId: string; title: string; totalVotes: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setConfirmWord("");
    setPassword("");
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await deleteElection(electionId, password, confirmWord);
      setPassword("");
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.replace(r.departmentId ? `/admin/departamentos/${r.departmentId}` : "/admin");
      router.refresh();
    });
  }

  return (
    <>
      <button className="btn-danger w-full" onClick={() => setOpen(true)}>
        Eliminar elección completa…
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center" role="dialog" aria-modal="true">
          <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6">
            <h2 className="font-display text-lg font-bold text-red-800">Eliminar “{title}”</h2>
            <p className="text-sm text-muted">
              Se borrarán <strong className="text-ink">todos sus votos ({totalVotes} válidos)</strong>, correcciones, cargos y resultados. Los
              candidatos siguen en el departamento. <strong className="text-ink">No se puede deshacer.</strong> Quedará un registro en el
              historial con el resumen de lo eliminado.
            </p>
            <div>
              <label className="label" htmlFor="del-confirm">
                Escribe BORRAR para confirmar
              </label>
              <input id="del-confirm" className="input" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="del-pw">
                Tu contraseña de administrador
              </label>
              <input
                id="del-pw"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={close} disabled={pending}>
                Cancelar
              </button>
              <button className="btn-danger" disabled={pending || confirmWord.trim().toUpperCase() !== "BORRAR" || !password}>
                {pending ? "Eliminando…" : "Eliminar definitivamente"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
