-- Las funciones de disparadores y auditoría no deben poder llamarse por la API.
revoke execute on function
  public.audit_row_change(), public.guard_election_candidates(), public.handle_auth_user(),
  public.guard_election_update(), public.guard_election_insert(), public.guard_candidate_department(),
  public.touch_updated_at(), public.set_created_by(), public.set_assigned_by(),
  public.write_audit(text, text, text, uuid, uuid, jsonb)
from public, anon, authenticated;
