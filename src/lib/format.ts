import type { AppRole, ElectionStatus, Standing } from "@/lib/types";

const TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE || "America/Santo_Domingo";

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(new Date(value));
}

export function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-DO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: TIME_ZONE,
  }).format(new Date(value));
}

export const STATUS_LABEL: Record<ElectionStatus, string> = {
  preparacion: "Pendiente",
  en_curso: "En curso",
  cerrada: "Finalizada",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  pendiente: "Pendiente de aprobación",
  consulta: "Consulta de resultados",
  operador: "Operador de conteo",
  admin: "Administrador",
};

export function cargoLabel(s: Pick<Standing, "cargo" | "tie_unresolved">) {
  if (s.tie_unresolved) return "Empate por resolver";
  return s.cargo ?? "Sin cargo";
}

export function votesLabel(n: number) {
  return `${n} ${n === 1 ? "voto" : "votos"}`;
}

/** Mensaje legible a partir de un error de Supabase/Postgres o de red. */
export function errorMessage(error: unknown): string {
  if (!error) return "Error desconocido";
  const msg =
    typeof error === "string"
      ? error
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  if (/failed to fetch|network|load failed|fetch failed/i.test(msg)) {
    return "Sin conexión con el servidor. Verifica la red e inténtalo de nuevo.";
  }
  if (/JWT|not authenticated|session/i.test(msg)) {
    return "Tu sesión expiró. Vuelve a iniciar sesión.";
  }
  return msg;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
