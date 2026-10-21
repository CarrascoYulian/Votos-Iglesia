-- =============================================================================
-- Número de candidato (casilla).
--
-- Los votantes escriben en el papel el NÚMERO del candidato. Cada candidato recibe
-- un número fijo dentro de su departamento, en orden ascendente según se agrega
-- (1, 2, 3...). No cambia aunque se edite el nombre o se desactive el candidato.
-- La papeleta de cada elección sigue ese mismo orden.
-- =============================================================================

alter table public.candidates add column numero integer;

-- Números para los candidatos existentes, en orden de alta (sin generar entradas de auditoría).
set local session_replication_role = replica;
update public.candidates c set numero = x.n
from (select id, row_number() over (partition by department_id order by created_at, id) as n
      from public.candidates) x
where x.id = c.id;
set local session_replication_role = origin;

alter table public.candidates alter column numero set not null;
alter table public.candidates add constraint candidates_numero_positive check (numero > 0);
alter table public.candidates add constraint candidates_department_numero_key unique (department_id, numero);
comment on column public.candidates.numero is 'Número del candidato (lo que escribe el votante en el papel). Ascendente por departamento, no se reutiliza ni cambia.';

-- Asignación automática al crear; el número no se puede modificar.
create or replace function public.assign_candidate_number()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Serializa las altas del mismo departamento para que no se repitan números.
    perform pg_advisory_xact_lock(hashtext('candidates:' || new.department_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero
    from public.candidates where department_id = new.department_id;
  elsif new.numero is distinct from old.numero then
    raise exception 'El número de un candidato no se puede cambiar';
  end if;
  return new;
end;
$$;
revoke execute on function public.assign_candidate_number() from public, anon, authenticated;

create trigger candidates_numero before insert or update of numero on public.candidates
  for each row execute function public.assign_candidate_number();

-- La papeleta sigue el número del candidato.
set local session_replication_role = replica;
update public.election_candidates ec set ballot_order = c.numero
from public.candidates c where c.id = ec.candidate_id;
set local session_replication_role = origin;

create or replace function public.set_ballot_order()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  select numero into new.ballot_order from public.candidates where id = new.candidate_id;
  return new;
end;
$$;
revoke execute on function public.set_ballot_order() from public, anon, authenticated;

create trigger election_candidates_ballot_order before insert on public.election_candidates
  for each row execute function public.set_ballot_order();

-- -----------------------------------------------------------------------------
-- Clasificación con el número del candidato
-- -----------------------------------------------------------------------------
drop function if exists public.election_standings(uuid);

create function public.election_standings(p_election_id uuid)
returns table (
  candidate_id    uuid,
  numero          integer,
  full_name       text,
  photo_path      text,
  votes           integer,
  posicion        integer,
  cargo           text,
  cargo_auto      boolean,
  tied            boolean,
  tie_unresolved  boolean,
  tiebreak_rank   integer,
  ballot_order    integer
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_election public.elections;
  v_first text;
begin
  if not public.can_view_election(p_election_id) then
    raise exception 'No tienes permiso para ver esta elección' using errcode = '42501';
  end if;
  select * into v_election from public.elections e where e.id = p_election_id;
  if not found then
    raise exception 'Elección no encontrada';
  end if;
  v_first := v_election.cargos[1];

  if v_election.status = 'cerrada' then
    return query
      select r.candidate_id, c.numero, r.full_name, r.photo_path, r.votes, r.posicion, r.cargo,
             (r.posicion = 1 and r.cargo is not distinct from v_first) as cargo_auto,
             (count(*) over (partition by r.votes) > 1) as tied, false as tie_unresolved,
             null::int, c.numero
      from public.election_results r
      join public.candidates c on c.id = r.candidate_id
      where r.election_id = p_election_id and r.closing_number = v_election.closing_count
      order by r.posicion, c.numero;
    return;
  end if;

  return query
  with base as (
    select ec.candidate_id, c.numero, c.full_name, c.photo_path, ec.cargo as assigned,
           (select count(*)::int from public.votes v
             where v.election_id = ec.election_id and v.candidate_id = ec.candidate_id
               and v.voided_at is null) as votes
    from public.election_candidates ec
    join public.candidates c on c.id = ec.candidate_id
    where ec.election_id = p_election_id and ec.withdrawn_at is null
  ),
  ranked as (
    select b.*,
           (rank() over (order by b.votes desc))::int as pos,
           (count(*) over (partition by b.votes))::int as same
    from base b
  ),
  leaders as (
    select count(*)::int as n,
           coalesce(bool_or(r.assigned is not distinct from v_first), false) as first_assigned
    from ranked r where r.pos = 1
  )
  select r.candidate_id, r.numero, r.full_name, r.photo_path, r.votes, r.pos,
         case when r.pos = 1 and l.n = 1 then v_first else r.assigned end as cargo,
         (r.pos = 1 and l.n = 1) as cargo_auto,
         r.same > 1 as tied,
         (r.pos = 1 and l.n > 1 and not l.first_assigned) as tie_unresolved,
         null::int as tiebreak_rank,
         r.numero as ballot_order
  from ranked r cross join leaders l
  order by r.pos, r.numero;
end;
$$;

revoke execute on function public.election_standings(uuid) from public, anon;
grant execute on function public.election_standings(uuid) to authenticated;
