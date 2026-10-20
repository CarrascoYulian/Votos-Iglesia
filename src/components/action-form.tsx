"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/types";

/** Formulario que ejecuta una server action y muestra su resultado. */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitClassName = "btn-primary",
  resetOnSuccess = false,
  className = "space-y-4",
  onSuccess,
}: {
  action: (prev: unknown, form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel: string;
  submitClassName?: string;
  resetOnSuccess?: boolean;
  className?: string;
  onSuccess?: (result: ActionResult) => void;
}) {
  const [state, formAction, pending] = useActionState(action, null as ActionResult | null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`rounded-lg px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}
        >
          {state.ok ? (state.message ?? "Guardado.") : state.error}
        </p>
      )}
      <button className={submitClassName} disabled={pending}>
        {pending ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
