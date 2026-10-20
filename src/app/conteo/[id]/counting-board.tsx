"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, ResultKindBadge } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cargoLabel, errorMessage, formatTime } from "@/lib/format";
import { newOperationId } from "@/lib/uuid";
import type { ElectionStatus, Standing, Vote } from "@/lib/types";

interface Props {
  election: { id: string; title: string; status: ElectionStatus; department: string; cargos: string[] };
  initialStandings: Standing[];
  initialVotes: Vote[];
  photos: Record<string, string | null>;
  canCorrect: boolean;
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

interface Correction {
  vote: Vote;
  mode: "anular" | "reasignar";
  operationId: string;
  newCandidateId: string;
  reason: string;
  busy: boolean;
  error: string | null;
}

export default function CountingBoard({ election, initialStandings, initialVotes, photos, canCorrect, isAdmin }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<ElectionStatus>(election.status);
  const [standings, setStandings] = useState<Standing[]>(initialStandings);
  const [votes, setVotes] = useState<Vote[]>(initialVotes);
  const [pending, setPending] = useState<PendingOp[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [voteLimit, setVoteLimit] = useState(25);
  const toastSeq = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = status === "en_curso";
  const names = useMemo(
    () => Object.fromEntries(standings.map((s) => [s.candidate_id, s.full_name])),
    [standings],
  );
  // Las tarjetas mantienen el orden de la papeleta para que el operador no tenga que buscarlas.
  const ballot = useMemo(
    () => [...standings].sort((a, b) => a.ballot_order - b.ballot_order || a.full_name.localeCompare(b.full_name)),
    [standings],
  );
  const ranking = useMemo(() => [...standings].sort((a, b) => a.posicion - b.posicion || b.votes - a.votes), [standings]);
  const total = standings.reduce((sum, s) => sum + s.votes, 0);
  const unresolvedTie = standings.some((s) => s.tie_unresolved);

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "ok" ? 2500 : 6000);
  }, []);

  // ---------------------------------------------------------------------------
  // Sincronización con Supabase (fuente oficial de los totales)
  // ---------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    const [st, vt, el] = await Promise.all([
      supabase.rpc("election_standings", { p_election_id: election.id }),
      supabase
        .from("votes")
        .select("id, candidate_id, created_at, created_by, voided_at, void_reason")
        .eq("election_id", election.id)
        .order("created_at", { ascending: false })
        .limit(voteLimit),
      supabase.from("elections").select("status").eq("id", election.id).single(),
    ]);
    if (st.error || vt.error || el.error) {
      setOnline(false);
      return;
    }
    setOnline(true);
    setStandings(st.data as Standing[]);
    setVotes(vt.data as Vote[]);
    setStatus(el.data.status as ElectionStatus);
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
        if (/no está abierta/i.test(msg)) refresh();
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
  // Correcciones
  // ---------------------------------------------------------------------------
  function startCorrection(vote: Vote, mode: Correction["mode"]) {
    setCorrection({
      vote,
      mode,
      operationId: newOperationId(),
      newCandidateId: "",
      reason: "",
      busy: false,
      error: null,
    });
  }

  async function submitCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!correction) return;
    if (correction.reason.trim().length < 5) {
      setCorrection({ ...correction, error: "Escribe un motivo de al menos 5 caracteres." });
      return;
    }
    if (correction.mode === "reasignar" && !correction.newCandidateId) {
      setCorrection({ ...correction, error: "Elige el candidato correcto." });
      return;
    }
    setCorrection({ ...correction, busy: true, error: null });
    const { error } =
      correction.mode === "anular"
        ? await supabase.rpc("annul_vote", {
            p_vote_id: correction.vote.id,
            p_reason: correction.reason,
            p_operation_id: correction.operationId,
          })
        : await supabase.rpc("reassign_vote", {
            p_vote_id: correction.vote.id,
            p_new_candidate_id: correction.newCandidateId,
            p_reason: correction.reason,
            p_operation_id: correction.operationId,
          });
    if (error) {
      // Se conserva el mismo operation_id: reintentar no duplica la corrección.
      setCorrection((c) => (c ? { ...c, busy: false, error: errorMessage(error) } : c));
      return;
    }
    pushToast("ok", correction.mode === "anular" ? "Voto anulado y registrado en el historial." : "Voto reasignado y registrado en el historial.");
    setCorrection(null);
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

      {unresolvedTie && open && (
        <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Hay un empate que afecta la asignación de cargos. Se resolverá al finalizar el conteo desde el panel administrativo.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
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
                        {s.posicion}º · {cargoLabel(s)}
                        {open && " (provisional)"}
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
                </article>
              );
            })}
          </div>
        </section>

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
                      {cargoLabel(s)}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-navy-900">{s.votes}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Últimos votos y correcciones */}
          <section className="card p-4" aria-label="Últimos votos registrados">
            <h2 className="font-display mb-1 text-base font-bold text-navy-900">Últimos votos registrados</h2>
            <p className="mb-3 text-xs text-muted">
              {canCorrect ? "Puedes anular o reasignar un voto mal registrado (queda en el historial)." : "Solo personal con permiso de corrección puede modificar votos."}
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
                      <p className="text-xs text-red-700">Anulado: {v.void_reason}</p>
                    ) : (
                      canCorrect &&
                      open && (
                        <div className="mt-1 flex gap-3 text-xs">
                          <button className="font-semibold text-red-700 hover:underline" onClick={() => startCorrection(v, "anular")}>
                            Anular
                          </button>
                          <button className="font-semibold text-navy-700 hover:underline" onClick={() => startCorrection(v, "reasignar")}>
                            Reasignar
                          </button>
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

      {/* Diálogo de corrección */}
      {correction && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center" role="dialog" aria-modal="true">
          <form onSubmit={submitCorrection} className="card w-full max-w-md space-y-4 p-6">
            <h2 className="font-display text-lg font-bold text-navy-900">
              {correction.mode === "anular" ? "Anular voto" : "Reasignar voto"}
            </h2>
            <p className="text-sm text-muted">
              Voto para <strong className="text-ink">{names[correction.vote.candidate_id]}</strong> registrado a las{" "}
              {formatTime(correction.vote.created_at)}. El voto original no se borra: queda marcado y la corrección se guarda en el historial.
            </p>
            {correction.mode === "reasignar" && (
              <div>
                <label className="label" htmlFor="nuevo">
                  Candidato correcto
                </label>
                <select
                  id="nuevo"
                  className="input"
                  value={correction.newCandidateId}
                  onChange={(e) => setCorrection({ ...correction, newCandidateId: e.target.value })}
                >
                  <option value="">Selecciona…</option>
                  {ballot
                    .filter((s) => s.candidate_id !== correction.vote.candidate_id)
                    .map((s) => (
                      <option key={s.candidate_id} value={s.candidate_id}>
                        {s.full_name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="motivo">
                Motivo de la corrección
              </label>
              <textarea
                id="motivo"
                className="input min-h-24"
                value={correction.reason}
                onChange={(e) => setCorrection({ ...correction, reason: e.target.value })}
                placeholder="Ej.: se pulsó el candidato equivocado al leer el papel"
                required
              />
            </div>
            {correction.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{correction.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setCorrection(null)} disabled={correction.busy}>
                Cancelar
              </button>
              <button className={correction.mode === "anular" ? "btn-danger" : "btn-primary"} disabled={correction.busy}>
                {correction.busy ? "Guardando…" : correction.mode === "anular" ? "Confirmar anulación" : "Confirmar reasignación"}
              </button>
            </div>
          </form>
        </div>
      )}

    </main>
  );
}
