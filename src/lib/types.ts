export type AppRole = "pendiente" | "consulta" | "operador" | "admin";
export type ElectionStatus = "preparacion" | "en_curso" | "cerrada";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  can_correct: boolean;
  created_at: string;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Candidate {
  id: string;
  department_id: string;
  full_name: string;
  notes: string | null;
  photo_path: string | null;
  active: boolean;
}

export interface Election {
  id: string;
  department_id: string;
  title: string;
  cargos: string[];
  notes: string | null;
  status: ElectionStatus;
  started_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  closing_count: number;
  reopened_at: string | null;
  created_at: string;
}

export interface Standing {
  candidate_id: string;
  full_name: string;
  photo_path: string | null;
  votes: number;
  posicion: number;
  cargo: string | null;
  /** El 1er lugar sin empate recibe el primer cargo automáticamente. */
  cargo_auto: boolean;
  tied: boolean;
  /** Empate en el 1er lugar sin decidir quién recibe el primer cargo. */
  tie_unresolved: boolean;
  tiebreak_rank: number | null;
  ballot_order: number;
}

export interface WithdrawnCandidate {
  candidate_id: string;
  full_name: string;
  withdrawn_at: string;
  withdraw_reason: string | null;
}

export interface Vote {
  id: string;
  candidate_id: string;
  created_at: string;
  created_by: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface VoteAdjustment {
  id: string;
  kind: "anulacion" | "reasignacion";
  vote_id: string;
  new_vote_id: string | null;
  reason: string;
  created_by: string;
  created_at: string;
}

export interface AuditLog {
  id: number;
  created_at: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  election_id: string | null;
  department_id: string | null;
  details: Record<string, unknown>;
}

export interface ResultRow {
  election_id: string;
  election_title: string;
  election_status: ElectionStatus;
  department_id: string;
  department_name: string;
  candidate_id: string;
  full_name: string;
  photo_path: string | null;
  votes: number;
  posicion: number;
  cargo: string | null;
  tie_unresolved: boolean;
  closed_at: string | null;
  started_at: string | null;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
