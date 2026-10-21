-- Tabla general de resultados con el número del candidato.
drop function if exists public.all_results();

create function public.all_results()
returns table (
  election_id     uuid,
  election_title  text,
  election_status public.election_status,
  department_id   uuid,
  department_name text,
  candidate_id    uuid,
  numero          integer,
  full_name       text,
  photo_path      text,
  votes           integer,
  posicion        integer,
  cargo           text,
  tie_unresolved  boolean,
  closed_at       timestamptz,
  started_at      timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  e record;
begin
  if not public.is_approved() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  for e in
    select el.id, el.title, el.status, el.department_id, d.name as dname, el.closed_at, el.started_at
    from public.elections el join public.departments d on d.id = el.department_id
    where public.can_view_election(el.id)
    order by d.name, el.created_at desc
  loop
    return query
      select e.id, e.title, e.status, e.department_id, e.dname,
             s.candidate_id, s.numero, s.full_name, s.photo_path, s.votes, s.posicion, s.cargo, s.tie_unresolved,
             e.closed_at, e.started_at
      from public.election_standings(e.id) s;
  end loop;
end;
$$;

revoke execute on function public.all_results() from public, anon;
grant execute on function public.all_results() to authenticated;
