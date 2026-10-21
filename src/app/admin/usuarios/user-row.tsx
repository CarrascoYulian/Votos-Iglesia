"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime, ROLE_LABEL } from "@/lib/format";
import type { ActionResult, AppRole, Profile } from "@/lib/types";
import { setUserRole } from "../actions";

export default function UserRow({ user, isSelf }: { user: Profile; isSelf: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState<AppRole>(user.role);
  const [canCorrect, setCanCorrect] = useState(user.can_correct);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const dirty = role !== user.role || canCorrect !== user.can_correct;

  function save() {
    if (isSelf && role !== "admin" && !confirm("Vas a quitarte el rol de administrador. ¿Continuar?")) return;
    start(async () => {
      const r = await setUserRole(user.id, role, role === "operador" ? canCorrect : role === "admin");
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink">
          {user.full_name || "Sin nombre"} {isSelf && <span className="text-xs text-muted">(tú)</span>}
        </p>
        <p className="truncate text-sm text-muted">{user.email}</p>
        <p className="text-xs text-muted">Registrado: {formatDateTime(user.created_at)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value as AppRole)} aria-label={`Rol de ${user.email}`}>
          {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        {role === "operador" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={canCorrect} onChange={(e) => setCanCorrect(e.target.checked)} />
            Puede reasignar votos
          </label>
        )}
        <button className="btn-primary px-3 py-2" disabled={!dirty || pending} onClick={save}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
        {result && (
          <span className={`text-xs ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.ok ? result.message : result.error}</span>
        )}
      </div>
    </div>
  );
}
