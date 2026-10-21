-- =============================================================================
-- Cargos asignados por el operador, quitar votos y retirar candidatos.
--
-- * El 1er lugar (sin empate) recibe automáticamente el primer cargo de la lista.
--   El resto de cargos los asigna quien realiza el conteo (assign_cargo).
--   Si hay empate en el 1er lugar, el operador asigna el primer cargo a uno de ellos.
-- * Cualquier persona que pueda contar puede quitar un voto (con motivo); queda auditado.
-- * Un candidato puede retirarse de la elección durante el conteo (y restaurarse).
--   Sus votos se conservan pero no cuentan mientras esté retirado.
-- * Se elimina el desempate por orden (resolve_tie): ya no hace falta.
-- =============================================================================

alter table public.election_candidates
  add column cargo text,
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid references public.profiles (id),
  add column withdraw_reason text;

comment on column public.election_candidates.cargo is 'Cargo asignado manualmente por el operador. El 1er lugar sin empate recibe cargos[1] automáticamente.';
comment on column public.election_candidates.withdrawn_at is 'Si no es nulo, el candidato está retirado: no recibe votos ni aparece en la clasificación.';

drop function if exists public.resolve_tie(uuid, uuid[], text);
drop function if exists public.all_results();
drop function if exists public.election_standings(uuid);

-- -----------------------------------------------------------------------------
-- Clasificación
-- -----------------------------------------------------------------------------
create function public.election_standings(p_election_id uuid)
returns table (
  candidate_id    uuid,
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
      select r.candidate_id, r.full_name, r.photo_path, r.votes, r.posicion, r.cargo,
             (r.posicion = 1 and r.cargo is not distinct from v_first) as cargo_auto,
             (count(*) over (partition by r.votes) > 1) as tied, false as tie_unresolved,
             null::int, coalesce(ec.ballot_order, 0)
      from public.election_results r
      left join public.election_candidates ec
        on ec.election_id = r.election_id and ec.candidate_id = r.candidate_id
      where r.election_id = p_election_id and r.closing_number = v_election.closing_count
      order by r.posicion, r.full_name;
    return;
  end if;

  return query
  with base as (
    select ec.candidate_id, c.full_name, c.photo_path, ec.ballot_order, ec.cargo as assigned,
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
  select r.candidate_id, r.full_name, r.photo_path, r.votes, r.pos,
         case when r.pos = 1 and l.n = 1 then v_first else r.assigned end as cargo,
         (r.pos = 1 and l.n = 1) as cargo_auto,
         r.same > 1 as tied,
         (r.pos = 1 and l.n > 1 and not l.first_assigned) as tie_unresolved,
         null::int as tiebreak_rank,
         r.ballot_order
  from ranked r cross join leaders l
  order by r.pos, r.ballot_order, r.full_name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Asignación manual de cargos (operador del conteo o administrador)
-- -----------------------------------------------------------------------------
create function public.assign_cargo(p_election_id uuid, p_candidate_id uuid, p_cargo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_election public.elections;
  v_cargo text := nullif(trim(coalesce(p_cargo, '')), '');
  v_pos integer;
  v_auto boolean;
  v_occ integer;
  v_taken integer;
  v_name text;
begin
  if not public.can_count(p_election_id) then
    raise exception 'No tienes permiso para asignar cargos en esta elección' using errcode = '42501';
  end if;
  -- Bloqueo exclusivo: evita que dos personas asignen el mismo cargo a la vez.
  select * into v_election from public.elections where id = p_election_id for update;
  if not found then raise exception 'Elección no encontrada'; end if;
  if v_election.status <> 'en_curso' then
    raise exception 'Los cargos se asignan con el conteo abierto, antes de cerrar la elección';
  end if;

  select s.posicion, s.cargo_auto, s.full_name into v_pos, v_auto, v_name
  from public.election_standings(p_election_id) s where s.candidate_id = p_candidate_id;
  if not found then
    raise exception 'El candidato no participa en esta elección o fue retirado';
  end if;
  if v_auto then
    raise exception 'El primer lugar recibe automáticamente el cargo de %', v_election.cargos[1];
  end if;

  if v_cargo is not null then
    if not (v_cargo = any (v_election.cargos)) then
      raise exception 'El cargo "%" no está en la lista de cargos de esta elección', v_cargo;
    end if;
    if v_cargo = v_election.cargos[1] and v_pos <> 1 then
      raise exception 'El cargo de % corresponde al primer lugar', v_cargo;
    end if;
    select count(*) into v_occ from unnest(v_election.cargos) x where x = v_cargo;
    select count(*) into v_taken from public.election_standings(p_election_id) s
    where s.cargo = v_cargo and s.candidate_id <> p_candidate_id;
    if v_taken >= v_occ then
      raise exception 'El cargo de % ya está asignado', v_cargo;
    end if;
  end if;

  update public.election_candidates set cargo = v_cargo
  where election_id = p_election_id and candidate_id = p_candidate_id;

  perform public.write_audit('elections.asignar_cargo', 'election_candidates', p_candidate_id::text,
    p_election_id, v_election.department_id,
    jsonb_build_object('candidato', p_candidate_id, 'cargo', v_cargo));
end;
$$;

-- -----------------------------------------------------------------------------
-- Retirar / restaurar un candidato de la elección
-- -----------------------------------------------------------------------------
create function public.withdraw_candidate(p_election_id uuid, p_candidate_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_election public.elections;
begin
  if not public.can_count(p_election_id) then
    raise exception 'No tienes permiso para modificar los candidatos de esta elección' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica el motivo del retiro (al menos 5 caracteres)';
  end if;
  select * into v_election from public.elections where id = p_election_id for update;
  if not found then raise exception 'Elección no encontrada'; end if;
  if v_election.status = 'cerrada' then
    raise exception 'La elección está cerrada. Reábrela para modificar los candidatos.';
  end if;
  if not exists (select 1 from public.election_candidates
                 where election_id = p_election_id and candidate_id = p_candidate_id and withdrawn_at is null) then
    raise exception 'El candidato no está en la lista de esta elección';
  end if;

  if v_election.status = 'preparacion' then
    -- Sin votos todavía: se quita de la lista.
    delete from public.election_candidates where election_id = p_election_id and candidate_id = p_candidate_id;
  else
    update public.election_candidates
       set withdrawn_at = now(), withdrawn_by = auth.uid(), withdraw_reason = trim(p_reason), cargo = null
     where election_id = p_election_id and candidate_id = p_candidate_id;
  end if;

  perform public.write_audit('elections.retirar_candidato', 'election_candidates', p_candidate_id::text,
    p_election_id, v_election.department_id,
    jsonb_build_object('candidato', p_candidate_id, 'motivo', trim(p_reason),
      'votos_conservados', (select count(*) from public.votes where election_id = p_election_id
                              and candidate_id = p_candidate_id and voided_at is null)));
end;
$$;

create function public.restore_candidate(p_election_id uuid, p_candidate_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_election public.elections;
begin
  if not public.can_count(p_election_id) then
    raise exception 'No tienes permiso para modificar los candidatos de esta elección' using errcode = '42501';
  end if;
  select * into v_election from public.elections where id = p_election_id for update;
  if v_election.status is distinct from 'en_curso' then
    raise exception 'Solo se puede restaurar un candidato con el conteo abierto';
  end if;
  update public.election_candidates
     set withdrawn_at = null, withdrawn_by = null, withdraw_reason = null
   where election_id = p_election_id and candidate_id = p_candidate_id and withdrawn_at is not null;
  if not found then raise exception 'El candidato no está retirado'; end if;

  perform public.write_audit('elections.restaurar_candidato', 'election_candidates', p_candidate_id::text,
    p_election_id, v_election.department_id, jsonb_build_object('candidato', p_candidate_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Votos: rechazar candidatos retirados; quitar votos sin permiso especial
-- -----------------------------------------------------------------------------
create or replace function public.register_vote(p_election_id uuid, p_candidate_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_status public.election_status;
  v_vote public.votes;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión' using errcode = '42501';
  end if;
  if p_operation_id is null then
    raise exception 'Falta el identificador de la operación';
  end if;

  select * into v_vote from public.votes where operation_id = p_operation_id;
  if not found then
    if not public.can_count(p_election_id) then
      raise exception 'No tienes permiso para registrar votos en esta elección' using errcode = '42501';
    end if;
    select status into v_status from public.elections where id = p_election_id for share;
    if not found then
      raise exception 'Elección no encontrada';
    end if;
    if v_status <> 'en_curso' then
      raise exception 'La elección no está abierta para el conteo';
    end if;
    if not exists (select 1 from public.election_candidates
                   where election_id = p_election_id and candidate_id = p_candidate_id) then
      raise exception 'El candidato no pertenece a esta elección';
    end if;
    if exists (select 1 from public.election_candidates
               where election_id = p_election_id and candidate_id = p_candidate_id and withdrawn_at is not null) then
      raise exception 'El candidato fue retirado de esta elección';
    end if;

    insert into public.votes (election_id, candidate_id, operation_id, created_by)
    values (p_election_id, p_candidate_id, p_operation_id, auth.uid())
    on conflict (operation_id) do nothing
    returning * into v_vote;

    if v_vote.id is not null then
      return jsonb_build_object('vote_id', v_vote.id, 'duplicate', false, 'created_at', v_vote.created_at,
        'candidate_votes', (select count(*) from public.votes where election_id = p_election_id and candidate_id = p_candidate_id and voided_at is null),
        'total_votes', (select count(*) from public.votes where election_id = p_election_id and voided_at is null));
    end if;
    select * into v_vote from public.votes where operation_id = p_operation_id;
  end if;

  -- Reintento de una operación ya guardada: devolver el mismo voto sin duplicar.
  if v_vote.election_id <> p_election_id or v_vote.candidate_id <> p_candidate_id then
    raise exception 'El identificador de operación ya se usó para otro voto';
  end if;
  return jsonb_build_object('vote_id', v_vote.id, 'duplicate', true, 'created_at', v_vote.created_at,
    'candidate_votes', (select count(*) from public.votes where election_id = p_election_id and candidate_id = p_candidate_id and voided_at is null),
    'total_votes', (select count(*) from public.votes where election_id = p_election_id and voided_at is null));
end;
$$;

create or replace function public.annul_vote(p_vote_id uuid, p_reason text, p_operation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_vote public.votes;
  v_adj public.vote_adjustments;
  v_status public.election_status;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión' using errcode = '42501';
  end if;
  select * into v_adj from public.vote_adjustments where operation_id = p_operation_id;
  if found then
    return jsonb_build_object('adjustment_id', v_adj.id, 'vote_id', v_adj.vote_id, 'duplicate', true);
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica un motivo de al menos 5 caracteres';
  end if;

  select * into v_vote from public.votes where id = p_vote_id for update;
  if not found then
    raise exception 'Voto no encontrado';
  end if;
  -- Quitar un voto mal registrado o nulo: cualquier persona que pueda contar esa elección.
  if not public.can_count(v_vote.election_id) then
    raise exception 'No tienes permiso para quitar votos en esta elección' using errcode = '42501';
  end if;
  select status into v_status from public.elections where id = v_vote.election_id for share;
  if v_status <> 'en_curso' then
    raise exception 'Solo se pueden quitar votos con el conteo abierto. Reabre la elección primero.';
  end if;
  if v_vote.voided_at is not null then
    raise exception 'Este voto ya fue quitado';
  end if;

  update public.votes set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = p_vote_id;

  insert into public.vote_adjustments (election_id, kind, vote_id, reason, operation_id, created_by)
  values (v_vote.election_id, 'anulacion', p_vote_id, trim(p_reason), p_operation_id, auth.uid())
  returning * into v_adj;

  perform public.write_audit('votes.anular', 'votes', p_vote_id::text, v_vote.election_id,
    (select department_id from public.elections where id = v_vote.election_id),
    jsonb_build_object('candidato', v_vote.candidate_id, 'motivo', trim(p_reason)));

  return jsonb_build_object('adjustment_id', v_adj.id, 'vote_id', p_vote_id, 'duplicate', false);
end;
$$;

-- Quita el último voto válido de un candidato (botón "−1").
create function public.annul_last_vote(p_election_id uuid, p_candidate_id uuid, p_reason text, p_operation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_adj public.vote_adjustments;
  v_vote_id uuid;
begin
  select * into v_adj from public.vote_adjustments where operation_id = p_operation_id;
  if found then
    return jsonb_build_object('adjustment_id', v_adj.id, 'vote_id', v_adj.vote_id, 'duplicate', true);
  end if;
  if not public.can_count(p_election_id) then
    raise exception 'No tienes permiso para quitar votos en esta elección' using errcode = '42501';
  end if;
  select v.id into v_vote_id from public.votes v
  where v.election_id = p_election_id and v.candidate_id = p_candidate_id and v.voided_at is null
  order by v.created_at desc
  limit 1
  for update skip locked;
  if v_vote_id is null then
    raise exception 'Este candidato no tiene votos para quitar';
  end if;
  return public.annul_vote(v_vote_id, p_reason, p_operation_id);
end;
$$;

create or replace function public.reassign_vote(p_vote_id uuid, p_new_candidate_id uuid, p_reason text, p_operation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_vote public.votes;
  v_new public.votes;
  v_adj public.vote_adjustments;
  v_status public.election_status;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión' using errcode = '42501';
  end if;
  select * into v_adj from public.vote_adjustments where operation_id = p_operation_id;
  if found then
    return jsonb_build_object('adjustment_id', v_adj.id, 'new_vote_id', v_adj.new_vote_id, 'duplicate', true);
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica un motivo de al menos 5 caracteres';
  end if;

  select * into v_vote from public.votes where id = p_vote_id for update;
  if not found then
    raise exception 'Voto no encontrado';
  end if;
  if not public.can_correct(v_vote.election_id) then
    raise exception 'No tienes permiso para reasignar votos en esta elección' using errcode = '42501';
  end if;
  select status into v_status from public.elections where id = v_vote.election_id for share;
  if v_status <> 'en_curso' then
    raise exception 'Solo se pueden corregir votos con el conteo abierto. Reabre la elección primero.';
  end if;
  if v_vote.voided_at is not null then
    raise exception 'Este voto ya fue quitado';
  end if;
  if p_new_candidate_id = v_vote.candidate_id then
    raise exception 'Elige un candidato distinto al original';
  end if;
  if not exists (select 1 from public.election_candidates
                 where election_id = v_vote.election_id and candidate_id = p_new_candidate_id and withdrawn_at is null) then
    raise exception 'El candidato no participa en esta elección o fue retirado';
  end if;

  update public.votes set voided_at = now(), voided_by = auth.uid(),
         void_reason = 'Reasignado: ' || trim(p_reason)
  where id = p_vote_id;

  insert into public.votes (election_id, candidate_id, operation_id, created_by)
  values (v_vote.election_id, p_new_candidate_id, p_operation_id, auth.uid())
  returning * into v_new;

  insert into public.vote_adjustments (election_id, kind, vote_id, new_vote_id, reason, operation_id, created_by)
  values (v_vote.election_id, 'reasignacion', p_vote_id, v_new.id, trim(p_reason), p_operation_id, auth.uid())
  returning * into v_adj;

  perform public.write_audit('votes.reasignar', 'votes', p_vote_id::text, v_vote.election_id,
    (select department_id from public.elections where id = v_vote.election_id),
    jsonb_build_object('de', v_vote.candidate_id, 'a', p_new_candidate_id, 'nuevo_voto', v_new.id, 'motivo', trim(p_reason)));

  return jsonb_build_object('adjustment_id', v_adj.id, 'new_vote_id', v_new.id, 'duplicate', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cierre: exige el primer cargo definido y que no haya cargos repetidos de más
-- -----------------------------------------------------------------------------
create or replace function public.close_election(p_election_id uuid, p_notes text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_election public.elections;
  v_closing integer;
  v_bad text;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cerrar la elección' using errcode = '42501';
  end if;
  select * into v_election from public.elections where id = p_election_id for update;
  if not found then raise exception 'Elección no encontrada'; end if;
  if v_election.status <> 'en_curso' then
    raise exception 'Solo se puede cerrar una elección con el conteo en curso';
  end if;
  if exists (select 1 from public.election_standings(p_election_id) s where s.tie_unresolved) then
    raise exception 'Hay empate en el primer lugar: asigna el cargo de % a uno de los empatados antes de cerrar.',
      v_election.cargos[1];
  end if;
  if exists (select 1 from public.election_standings(p_election_id) s
             where s.cargo = v_election.cargos[1] and s.posicion <> 1) then
    raise exception 'El cargo de % solo puede tenerlo el primer lugar. Revisa la asignación de cargos.', v_election.cargos[1];
  end if;
  select s.cargo into v_bad
  from public.election_standings(p_election_id) s
  where s.cargo is not null
  group by s.cargo
  having count(*) > (select count(*) from unnest(v_election.cargos) x where x = s.cargo)
  limit 1;
  if v_bad is not null then
    raise exception 'El cargo de % está asignado a más personas de las permitidas. Revisa la asignación.', v_bad;
  end if;

  v_closing := v_election.closing_count + 1;

  insert into public.election_results
    (election_id, closing_number, candidate_id, full_name, photo_path, votes, posicion, cargo, tiebreak_rank, closed_by)
  select p_election_id, v_closing, s.candidate_id, s.full_name, s.photo_path, s.votes, s.posicion, s.cargo,
         null, auth.uid()
  from public.election_standings(p_election_id) s;

  perform set_config('app.election_transition', 'on', true);
  update public.elections
     set status = 'cerrada', closed_at = now(), closed_by = auth.uid(), closing_count = v_closing
   where id = p_election_id;
  perform set_config('app.election_transition', 'off', true);

  perform public.write_audit('elections.cerrar', 'elections', p_election_id::text, p_election_id,
    v_election.department_id,
    jsonb_build_object('cierre', v_closing, 'notas', nullif(trim(coalesce(p_notes, '')), ''),
      'resultados', (select jsonb_agg(jsonb_build_object('candidato', r.full_name, 'votos', r.votes,
                        'posicion', r.posicion, 'cargo', r.cargo) order by r.posicion)
                     from public.election_results r
                     where r.election_id = p_election_id and r.closing_number = v_closing)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Tabla general (misma forma que antes)
-- -----------------------------------------------------------------------------
create function public.all_results()
returns table (
  election_id     uuid,
  election_title  text,
  election_status public.election_status,
  department_id   uuid,
  department_name text,
  candidate_id    uuid,
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
             s.candidate_id, s.full_name, s.photo_path, s.votes, s.posicion, s.cargo, s.tie_unresolved,
             e.closed_at, e.started_at
      from public.election_standings(e.id) s;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
revoke execute on function
  public.election_standings(uuid), public.assign_cargo(uuid, uuid, text),
  public.withdraw_candidate(uuid, uuid, text), public.restore_candidate(uuid, uuid),
  public.annul_last_vote(uuid, uuid, text, uuid), public.all_results()
from public, anon;
grant execute on function
  public.election_standings(uuid), public.assign_cargo(uuid, uuid, text),
  public.withdraw_candidate(uuid, uuid, text), public.restore_candidate(uuid, uuid),
  public.annul_last_vote(uuid, uuid, text, uuid), public.all_results()
to authenticated;
