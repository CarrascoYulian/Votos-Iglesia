import { formatDateTime } from "@/lib/format";
import type { AuditLog } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  "departments.insert": "Departamento creado",
  "departments.update": "Departamento editado",
  "candidates.insert": "Candidato agregado",
  "candidates.update": "Candidato editado",
  "elections.insert": "Elección creada",
  "elections.update": "Configuración de elección editada",
  "elections.iniciar": "Conteo iniciado",
  "elections.cerrar": "Elección cerrada",
  "elections.reabrir": "Elección reabierta",
  "elections.resolver_empate": "Empate resuelto",
  "elections.asignar_cargo": "Cargo asignado",
  "elections.retirar_candidato": "Candidato retirado de la elección",
  "elections.restaurar_candidato": "Candidato restaurado en la elección",
  "election_candidates.insert": "Candidato incluido en la elección",
  "election_candidates.delete": "Candidato retirado de la elección",
  "election_operators.insert": "Operador asignado",
  "election_operators.delete": "Operador retirado",
  "votes.anular": "Voto quitado",
  "votes.reasignar": "Voto reasignado",
  "profiles.permisos": "Permisos de usuario cambiados",
  "profiles.bootstrap_admin": "Administrador inicial activado",
};

function summary(log: AuditLog, names: Record<string, string>) {
  const d = log.details as Record<string, unknown>;
  const name = (id: unknown) => (typeof id === "string" ? (names[id] ?? "candidato") : "");
  switch (log.action) {
    case "votes.anular":
      return `${name(d.candidato)} — motivo: ${d.motivo}`;
    case "votes.reasignar":
      return `De ${name(d.de)} a ${name(d.a)} — motivo: ${d.motivo}`;
    case "elections.reabrir":
      return `Motivo: ${d.motivo}`;
    case "elections.asignar_cargo":
      return `${name(d.candidato)}: ${d.cargo ?? "sin cargo"}`;
    case "elections.retirar_candidato":
      return `${name(d.candidato)} — motivo: ${d.motivo}`;
    case "elections.restaurar_candidato":
      return name(d.candidato);
    case "elections.resolver_empate":
      return `Orden: ${(d.orden as string[]).map(name).join(" › ")} — ${d.motivo}`;
    case "elections.cerrar":
      return d.notas ? `Notas: ${d.notas}` : `Cierre nº ${d.cierre}`;
    case "profiles.permisos": {
      const rol = d.rol as { antes: string; despues: string };
      return `${d.email}: ${rol.antes} → ${rol.despues}`;
    }
    case "election_candidates.insert":
    case "election_candidates.delete": {
      const row = (d.nuevo ?? d.eliminado) as { candidate_id?: string } | undefined;
      return name(row?.candidate_id);
    }
    default: {
      if (d.cambios) {
        return Object.entries(d.cambios as Record<string, { antes: unknown; despues: unknown }>)
          .map(([k, v]) => `${k}: ${JSON.stringify(v.antes)} → ${JSON.stringify(v.despues)}`)
          .join("; ");
      }
      const row = d.nuevo as { name?: string; full_name?: string; title?: string } | undefined;
      return row?.name ?? row?.full_name ?? row?.title ?? "";
    }
  }
}

export function AuditList({ logs, names = {} }: { logs: AuditLog[]; names?: Record<string, string> }) {
  if (!logs.length) return <p className="text-sm text-muted">Sin operaciones registradas.</p>;
  return (
    <ol className="divide-y divide-line">
      {logs.map((log) => (
        <li key={log.id} className="py-2.5 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-semibold text-ink">{ACTION_LABEL[log.action] ?? log.action}</span>
            <span className="text-xs text-muted">{formatDateTime(log.created_at)}</span>
          </div>
          <p className="break-words text-xs text-muted">
            {log.actor_email ?? "Sistema"}
            {summary(log, names) && <> · {summary(log, names)}</>}
          </p>
        </li>
      ))}
    </ol>
  );
}
