"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CargoAssigner } from "@/components/cargo-assigner";
import { Avatar, ResultKindBadge } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cargoLabel, errorMessage, formatTime } from "@/lib/format";
import { newOperationId } from "@/lib/uuid";
import type { ElectionStatus, Standing, Vote, WithdrawnCandidate } from "@/lib/types";

interface Props {
  election: { id: string; title: string; status: ElectionStatus; department: string; cargos: string[] };
  initialStandings: Standing[];
  initialVotes: Vote[];
  initialWithdrawn: WithdrawnCandidate[];
  photos: Record<string, string | null>;
  names: Record<string, string>;
  canReassign: boolean;
  isAdmin: boolean;
}

interface PendingOp {
  id: string;
  candidateId: string;
  state: "enviando" | "fallido";
  error?: string;
}

interface Toast {
  id: number;
  kind: "ok" | "error";
  text: string;
}

/** Diálogos: quitar un voto, reasignar un voto concreto o retirar un candidato. */
type Dialog =
  | { kind: "quitar"; candidateId: string; vote?: Vote }
  | { kind: "reasignar"; vote: Vote }
  | { kind: "retirar"; candidateId: string };

interface DialogState {
  dialog: Dialog;
  operationId: string;
  reason: string;
  newCandidateId: string;
  busy: boolean;
  error: string | null;
}

const QUICK_REASONS = ["Se marcó por error", "Voto nulo"];

export default function CountingBoard({
  election,
  initialStandings,
  initialVotes,
  initialWithdrawn,
  photos,
  names: allNames,
  canReassign,
  isAdmin,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<ElectionStatus>(election.status);
  const [standings, setStandings] = useState<Standing[]>(initialStandings);
  const [votes, setVotes] = useState<Vote[]>(initialVotes);
  const [withdrawn, setWithdrawn] = useState<WithdrawnCandidate[]>(initialWithdrawn);
  const [pending, setPending] = useState<PendingOp[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [voteLimit, setVoteLimit] = useState(25);
  const toastSeq = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = status === "en_curso";
  const names = useMemo(
    () => ({ ...allNames, ...Object.fromEntries(standings.map((s) => [s.candidate_id, s.full_name])) }),
    [allNames, standings],
  );
  // Las tarjetas mantienen el orden de la papeleta para que el operador no tenga que buscarlas.
  const ballot = useMemo(
    () => [...standings].sort((a, b) => a.ballot_order - b.ballot_order || a.full_name.localeCompare(b.full_name)),
    [standings],
  );
  const ranking = useMemo(() => [...standings].sort((a, b) => a.posicion - b.posicion || b.votes - a.votes), [standings]);
  const total = standings.reduce((sum, s) => sum + s.votes, 0);
  const removedCount = votes.filter((v) => v.voided_at).length;

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "ok" ? 2500 : 6000);
  }, []);

  // ---------------------------------------------------------------------------
  // Sincronización con Supabase (fuente oficial de los totales)
  // ---------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    const [st, vt, el, wd] = await Promise.all([
      supabase.rpc("election_standings", { p_election_id: election.id }),
      supabase
        .from("votes")
        .select("id, candidate_id, created_at, created_by, voided_at, void_reason")
        .eq("election_id", election.id)
        .order("created_at", { ascending: false })
        .limit(voteLimit),
      supabase.from("elections").select("status").eq("id", election.id).single(),
      supabase
        .from("election_candidates")
        .select("candidate_id, withdrawn_at, withdraw_reason, candidates(full_name)")
        .eq("election_id", election.id)
        .not("withdrawn_at", "is", null),
    ]);
    if (st.error || vt.error || el.error || wd.error) {
      setOnline(false);
      return;
    }
    setOnline(true);
    setStandings(st.data as Standing[]);
    setVotes(vt.data as Vote[]);
    setStatus(el.data.status as ElectionStatus);
    setWithdrawn(
      (wd.data as unknown as { candidate_id: string; withdrawn_at: string; withdraw_reason: string | null; candidates: { full_name: string } | null }[]).map(
        (w) => ({ candidate_id: w.candidate_id, withdrawn_at: w.withdrawn_at, withdraw_reason: w.withdraw_reason, full_name: w.candidates?.full_name ?? "" }),
      ),
    );
    setLastSync(new Date());
  }, [supabase, election.id, voteLimit]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 350);
  }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`votos-${election.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `election_id=eq.${election.id}` },
        () => scheduleRefresh(),
      )
      .subscribe();
    const poll = setInterval(refresh, 15000);
    const onOnline = () => {
      setOnline(true);
      refresh();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [supabase, election.id, refresh, scheduleRefresh]);

  useEffect(() => {
    refresh();
  }, [voteLimit, refresh]);

  // Aviso al salir con operaciones sin confirmar.
  useEffect(() => {
    if (!pending.length) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pending.length]);

  // ---------------------------------------------------------------------------
  // Registro de votos (idempotente: un operation_id por pulsación)
  // ---------------------------------------------------------------------------
  const send = useCallback(
    async (op: PendingOp) => {
      setPending((p) => p.map((x) => (x.id === op.id ? { ...x, state: "enviando", error: undefined } : x)));
      let result: { data: unknown; error: { message: string } | null };
      try {
        result = await supabase.rpc("register_vote", {
          p_election_id: election.id,
          p_candidate_id: op.candidateId,
          p_operation_id: op.id,
        });
      } catch (err) {
        result = { data: null, error: { message: errorMessage(err) } };
      }

      if (result.error) {
        const msg = errorMessage(result.error);
        setPending((p) => p.map((x) => (x.id === op.id ? { ...x, state: "fallido", error: msg } : x)));
        pushToast("error", `No se guardó el voto para ${names[op.candidateId] ?? "el candidato"}: ${msg}`);
        if (/no está abierta|retirado/i.test(msg)) refresh();
        else if (/conexión/i.test(msg)) setOnline(false);
        return;
      }

      const data = result.data as { candidate_votes: number; total_votes: number; duplicate: boolean };
      setOnline(true);
      setPending((p) => p.filter((x) => x.id !== op.id));
      setStandings((list) =>
        list.map((s) => (s.candidate_id === op.candidateId ? { ...s, votes: Number(data.candidate_votes) } : s)),
      );
      pushToast("ok", `Voto registrado: ${names[op.candidateId]} (${Number(data.candidate_votes)})`);
      scheduleRefresh();
    },
    [supabase, election.id, names, pushToast, refresh, scheduleRefresh],
  );

  function addVote(candidateId: string) {
    if (!open) return;
    const op: PendingOp = { id: newOperationId(), candidateId, state: "enviando" };
    setPending((p) => [...p, op]);
    send(op);
  }

  function retryAll() {
    pending.filter((p) => p.state === "fallido").forEach((op) => send(op));
  }

  function discard(opId: string) {
    setPending((p) => p.filter((x) => x.id !== opId));
  }

  // ---------------------------------------------------------------------------
  // Quitar votos, reasignar y retirar candidatos (con motivo, quedan en el historial)
  // ---------------------------------------------------------------------------
  function openDialog(d: Dialog) {
    setDialog({ dialog: d, operationId: newOperationId(), reason: "", newCandidateId: "", busy: false, error: null });
  }

  async function submitDialog(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog) return;
    const { dialog: d, reason, operationId, newCandidateId } = dialog;
    if (reason.trim().length < 5) {
      setDialog({ ...dialog, error: "Escribe o elige un motivo (al menos 5 caracteres)." });
      return;
    }
    if (d.kind === "reasignar" && !newCandidateId) {
      setDialog({ ...dialog, error: "Elige el candidato correcto." });
      return;
    }
    setDialog({ ...dialog, busy: true, error: null });

    let error: { message: string } | null = null;
    let okText = "";
    // Se conserva el mismo operation_id en los reintentos: no se duplica la corrección.
    if (d.kind === "quitar") {
      ({ error } = d.vote
        ? await supabase.rpc("annul_vote", { p_vote_id: d.vote.id, p_reason: reason, p_operation_id: operationId })
        : await supabase.rpc("annul_last_vote", {
            p_election_id: election.id,
            p_candidate_id: d.candidateId,
            p_reason: reason,
            p_operation_id: operationId,
          }));
      okText = `Se quitó un voto a ${names[d.candidateId]}.`;
    } else if (d.kind === "reasignar") {
      ({ error } = await supabase.rpc("reassign_vote", {
        p_vote_id: d.vote.id,
        p_new_candidate_id: newCandidateId,
        p_reason: reason,
        p_operation_id: operationId,
      }));
      okText = "Voto reasignado.";
    } else {
      ({ error } = await supabase.rpc("withdraw_candidate", {
        p_election_id: election.id,
        p_candidate_id: d.candidateId,
        p_reason: reason,
      }));
      okText = `${names[d.candidateId]} fue retirado de la elección.`;
    }

    if (error) {
      setDialog((c) => (c ? { ...c, busy: false, error: errorMessage(error) } : c));
      return;
    }
    pushToast("ok", okText);
    setDialog(null);
    refresh();
  }

  async function restore(candidateId: string) {
    const { error } = await supabase.rpc("restore_candidate", { p_election_id: election.id, p_candidate_id: candidateId });
    if (error) pushToast("error", errorMessage(error));
    else pushToast("ok", `${names[candidateId]} vuelve a la elección.`);
    refresh();
  }

  const pendingByCandidate = pending.reduce<Record<string, number>>((acc, p) => {
    acc[p.candidateId] = (acc[p.candidateId] ?? 0) + 1;
    return acc;
  }, {});
  const failed = pending.filter((p) => p.state === "fallido");

  return (
    <main className="mx-auto max-w-7xl px-4 pb-28 pt-6">
      {/* Encabezado de la elección */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link href="/conteo" className="text-sm font-medium text-navy-700 hover:underline">
            ← Elecciones en conteo
          </Link>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gold-700">{election.department}</p>
          <h1 className="font-display text-2xl font-bold text-navy-900 sm:text-3xl">{election.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ResultKindBadge status={status} />
            <span className={`badge ${online ? "bg-emerald-50 text-emerald-700" : "bg-red-100 text-red-800"}`}>
              <span className={`size-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-red-600"}`} />
              {online ? "Conectado a Supabase" : "Sin conexión"}
            </span>
            {lastSync && <span className="text-xs text-muted">Sincronizado {formatTime(lastSync.toISOString())}</span>}
          </div>
        </div>
        <div className="card flex items-center gap-6 px-5 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Total confirmado</p>
            <p className="font-display text-3xl font-extrabold text-navy-900">{total}</p>
          </div>
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Sin confirmar</p>
              <p className="font-display text-3xl font-extrabold text-amber-600">{pending.length}</p>
            </div>
          )}
          {removedCount > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Quitados</p>
              <p className="font-display text-3xl font-extrabold text-slate-500">{removedCount}</p>
            </div>
          )}
        </div>
      </div>

      {!open && (
        <div role="alert" className="mb-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          {status === "cerrada"
            ? "Esta elección está cerrada. Los resultados mostrados son definitivos y no se aceptan más votos."
            : "El conteo de esta elección todavía no ha comenzado."}
          {isAdmin && (
            <Link href={`/admin/elecciones/${election.id}`} className="ml-2 font-semibold underline">
              Ver en el panel
            </Link>
          )}
        </div>
      )}

      {failed.length > 0 && (
        <div role="alert" className="mb-5 rounded-2xl border border-red-300 bg-red-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-900">
              <strong>{failed.length}</strong> {failed.length === 1 ? "voto no se pudo guardar" : "votos no se pudieron guardar"}.
              No se han contado. Reintentar no los duplica.
            </p>
            <button onClick={retryAll} className="btn-danger">
              Reintentar {failed.length === 1 ? "voto" : "todos"}
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-red-900">
            {failed.map((op) => (
              <li key={op.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-1.5">
                <span>
                  {names[op.candidateId]} — <span className="text-red-700">{op.error}</span>
                </span>
                <span className="flex gap-2">
                  <button className="font-semibold underline" onClick={() => send(op)}>
                    Reintentar
                  </button>
                  <button className="text-red-700 underline" onClick={() => discard(op.id)}>
                    Descartar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {/* Tarjetas con botón por candidato */}
          <section aria-label="Registrar votos">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {ballot.map((s) => {
                const waiting = pendingByCandidate[s.candidate_id] ?? 0;
                return (
                  <article key={s.candidate_id} className="card flex flex-col p-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={s.full_name} url={photos[s.candidate_id]} size={64} />
                      <div className="min-w-0 flex-1">
                        <h2 className="font-display truncate text-base font-bold text-navy-900">{s.full_name}</h2>
                        <p className={`text-xs font-medium ${s.tie_unresolved ? "text-amber-700" : "text-muted"}`}>
                          {s.posicion}º · {cargoLabel(s, status)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-3xl font-extrabold leading-none text-navy-900">{s.votes}</p>
                        <p className="text-[11px] text-muted">{s.votes === 1 ? "voto" : "votos"}</p>
                      </div>
                    </div>
                    {waiting > 0 && (
                      <p className="mt-2 text-xs font-semibold text-amber-700">+{waiting} enviando / sin confirmar…</p>
                    )}
                    <button
                      onClick={() => addVote(s.candidate_id)}
                      disabled={!open}
                      className="btn-gold mt-4 w-full touch-manipulation py-4 text-base active:scale-[0.98]"
                      aria-label={`Registrar un voto para ${s.full_name}`}
                    >
                      +1 voto — {s.full_name}
                    </button>
                    {open && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <button
                          onClick={() => openDialog({ kind: "quitar", candidateId: s.candidate_id })}
                          disabled={s.votes === 0}
                          className="btn-outline px-3 py-2 text-sm"
                          aria-label={`Quitar un voto a ${s.full_name}`}
                        >
                          −1 Quitar voto
                        </button>
                        <button
                          onClick={() => openDialog({ kind: "retirar", candidateId: s.candidate_id })}
                          className="text-xs font-semibold text-red-700 hover:underline"
                        >
                          Retirar de la elección
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {withdrawn.length > 0 && (
            <section className="card p-4" aria-label="Candidatos retirados">
              <h2 className="font-display mb-2 text-base font-bold text-navy-900">Retirados de esta elección</h2>
              <p className="mb-3 text-xs text-muted">Sus votos se conservan pero no cuentan mientras estén retirados.</p>
              <ul className="divide-y divide-line">
                {withdrawn.map((w) => (
                  <li key={w.candidate_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="font-semibold text-ink">{w.full_name}</span>
                      <span className="block text-xs text-muted">
                        {formatTime(w.withdrawn_at)} · {w.withdraw_reason}
                      </span>
                    </span>
                    {open && (
                      <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => restore(w.candidate_id)}>
                        Restaurar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {open && election.cargos.length > 0 && (
            <section className="card p-4 sm:p-5" aria-label="Asignación de cargos">
              <h2 className="font-display mb-2 text-lg font-bold text-navy-900">Asignación de cargos</h2>
              <CargoAssigner
                electionId={election.id}
                cargos={election.cargos}
                standings={standings}
                photos={photos}
                onChanged={refresh}
              />
            </section>
          )}
        </div>

        <aside className="space-y-6">
          {/* Clasificación */}
          <section className="card p-4" aria-label="Clasificación">
            <h2 className="font-display mb-3 text-base font-bold text-navy-900">
              Clasificación {open ? "provisional" : status === "cerrada" ? "definitiva" : ""}
            </h2>
            <ol className="space-y-2">
              {ranking.map((s) => (
                <li key={s.candidate_id} className="flex items-center gap-3">
                  <span className="font-display w-6 text-center text-sm font-bold text-gold-700">{s.posicion}</span>
                  <Avatar name={s.full_name} url={photos[s.candidate_id]} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{s.full_name}</p>
                    <p className={`truncate text-xs ${s.tie_unresolved ? "font-semibold text-amber-700" : "text-muted"}`}>
                      {cargoLabel(s, status)}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-navy-900">{s.votes}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Últimos votos */}
          <section className="card p-4" aria-label="Últimos votos registrados">
            <h2 className="font-display mb-1 text-base font-bold text-navy-900">Últimos votos registrados</h2>
            <p className="mb-3 text-xs text-muted">
              Puedes quitar un voto mal registrado o nulo{canReassign ? " o pasarlo al candidato correcto" : ""}. Queda en el historial.
            </p>
            {votes.length === 0 ? (
              <p className="text-sm text-muted">Aún no hay votos.</p>
            ) : (
              <ul className="divide-y divide-line">
                {votes.map((v) => (
                  <li key={v.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className={v.voided_at ? "text-muted line-through" : "font-medium text-ink"}>
                        {names[v.candidate_id] ?? "Candidato"}
                      </span>
                      <span className="text-xs text-muted">{formatTime(v.created_at)}</span>
                    </div>
                    {v.voided_at ? (
                      <p className="text-xs text-red-700">Quitado: {v.void_reason}</p>
                    ) : (
                      open && (
                        <div className="mt-1 flex gap-3 text-xs">
                          <button
                            className="font-semibold text-red-700 hover:underline"
                            onClick={() => openDialog({ kind: "quitar", candidateId: v.candidate_id, vote: v })}
                          >
                            Quitar
                          </button>
                          {canReassign && (
                            <button className="font-semibold text-navy-700 hover:underline" onClick={() => openDialog({ kind: "reasignar", vote: v })}>
                              Reasignar
                            </button>
                          )}
                        </div>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
            {votes.length >= voteLimit && (
              <button className="btn-ghost mt-2 w-full" onClick={() => setVoteLimit((n) => n + 50)}>
                Ver más votos
              </button>
            )}
          </section>
        </aside>
      </div>

      {/* Confirmaciones */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
              t.kind === "ok" ? "bg-emerald-700 text-white" : "bg-red-700 text-white"
            }`}
          >
            {t.kind === "ok" ? "✓ " : "⚠ "}
            {t.text}
          </div>
        ))}
      </div>

      {/* Diálogo */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center" role="dialog" aria-modal="true">
          <form onSubmit={submitDialog} className="card w-full max-w-md space-y-4 p-6">
            {dialog.dialog.kind === "quitar" && (
              <>
                <h2 className="font-display text-lg font-bold text-navy-900">Quitar un voto a {names[dialog.dialog.candidateId]}</h2>
                <p className="text-sm text-muted">
                  {dialog.dialog.vote
                    ? `Se quitará el voto registrado a las ${formatTime(dialog.dialog.vote.created_at)}.`
                    : "Se quitará su último voto registrado."}{" "}
                  El voto no se borra: queda marcado como quitado y con su motivo en el historial.
                </p>
              </>
            )}
            {dialog.dialog.kind === "reasignar" && (
              <>
                <h2 className="font-display text-lg font-bold text-navy-900">Reasignar voto</h2>
                <p className="text-sm text-muted">
                  Voto para <strong className="text-ink">{names[dialog.dialog.vote.candidate_id]}</strong> registrado a las{" "}
                  {formatTime(dialog.dialog.vote.created_at)}.
                </p>
                <div>
                  <label className="label" htmlFor="nuevo">
                    Candidato correcto
                  </label>
                  <select
                    id="nuevo"
                    className="input"
                    value={dialog.newCandidateId}
                    onChange={(e) => setDialog({ ...dialog, newCandidateId: e.target.value })}
                  >
                    <option value="">Selecciona…</option>
                    {ballot
                      .filter((s) => dialog.dialog.kind === "reasignar" && s.candidate_id !== dialog.dialog.vote.candidate_id)
                      .map((s) => (
                        <option key={s.candidate_id} value={s.candidate_id}>
                          {s.full_name}
                        </option>
                      ))}
                  </select>
                </div>
              </>
            )}
            {dialog.dialog.kind === "retirar" && (
              <>
                <h2 className="font-display text-lg font-bold text-navy-900">Retirar a {names[dialog.dialog.candidateId]}</h2>
                <p className="text-sm text-muted">
                  Deja de aparecer en la papeleta y en la clasificación, y no recibe más votos. Sus votos se conservan y vuelven a contar
                  si lo restauras.
                </p>
              </>
            )}

            <div>
              <p className="label">Motivo</p>
              {dialog.dialog.kind === "quitar" && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {QUICK_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setDialog({ ...dialog, reason: r })}
                      className={`badge px-3 py-1.5 text-sm ${dialog.reason === r ? "bg-navy-800 text-white" : "bg-navy-50 text-navy-800"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                className="input min-h-20"
                value={dialog.reason}
                onChange={(e) => setDialog({ ...dialog, reason: e.target.value })}
                placeholder={dialog.dialog.kind === "retirar" ? "Ej.: renunció a la candidatura" : "Escribe el motivo"}
                aria-label="Motivo"
              />
            </div>
            {dialog.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{dialog.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setDialog(null)} disabled={dialog.busy}>
                Cancelar
              </button>
              <button className={dialog.dialog.kind === "reasignar" ? "btn-primary" : "btn-danger"} disabled={dialog.busy}>
                {dialog.busy
                  ? "Guardando…"
                  : dialog.dialog.kind === "quitar"
                    ? "Quitar voto"
                    : dialog.dialog.kind === "reasignar"
                      ? "Reasignar"
                      : "Retirar candidato"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
