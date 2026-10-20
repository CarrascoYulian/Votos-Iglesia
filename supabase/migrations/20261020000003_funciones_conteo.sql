-- =============================================================================
-- Funciones del conteo: clasificación, registro de votos, correcciones,
-- desempates, inicio/cierre/reapertura y gestión de usuarios.
-- Todas validan permisos en el servidor (security definer + comprobaciones explícitas).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clasificación (provisional en vivo; definitiva desde la instantánea del cierre)
-- -----------------------------------------------------------------------------
create or replace function public.election_standings(p_election_id uuid)
returns table (
  candidate_id    uuid,
  full_name       text,
  photo_path      text,
  votes           integer,
  posicion        integer,
  cargo           text,
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
begin
  if not public.can_view_election(p_election_id) then
    raise exception 'No tienes permiso para ver esta elección' using errcode = '42501';
  end if;
  select * into v_election from public.elections e where e.id = p_election_id;
  if not found then
    raise exception 'Elección no encontrada';
  end if;

  if v_election.status = 'cerrada' then
    return query
      select r.candidate_id, r.full_name, r.photo_path, r.votes, r.posicion, r.cargo,
             (count(*) over (partition by r.votes) > 1) as tied, false as tie_unresolved,
             r.tiebreak_rank, coalesce(ec.ballot_order, 0)
      from public.election_results r
      left join public.election_candidates ec
        on ec.election_id = r.election_id and ec.candidate_id = r.candidate_id
      where r.election_id = p_election_id and r.closing_number = v_election.closing_count
      order by r.posicion, r.full_name;
    return;
  end if;

  return query
  with base as (
    select ec.candidate_id, c.full_name, c.photo_path, ec.tiebreak_rank, ec.ballot_order,
           (select count(*)::int from public.votes v
             where v.election_id = ec.election_id and v.candidate_id = ec.candidate_id
               and v.voided_at is null) as votes
    from public.election_candidates ec
    join public.candidates c on c.id = ec.candidate_id
    where ec.election_id = p_election_id
  ),
  grp as (
    select b.votes as gv, count(*)::int as gsize,
           count(distinct b.tiebreak_rank)::int as gdistinct, count(b.tiebreak_rank)::int as gset
    from base b group by b.votes
  ),
  ranked as (
    select b.*, g.gsize,
           (rank() over (order by b.votes desc))::int as vrank,
           (row_number() over (order by b.votes desc, b.tiebreak_rank asc nulls last, b.full_name))::int as rn,
           (g.gsize > 1 and (g.gset < g.gsize or g.gdistinct < g.gsize)) as tb_missing
    from base b join grp g on g.gv = b.votes
  ),
  flagged as (
    select r.*,
           -- El empate afecta si las posiciones que ocupa el grupo corresponden a cargos distintos.
           (r.tb_missing and (
              select count(distinct coalesce(v_election.cargos[s], '∅'))
              from generate_series(r.vrank, r.vrank + r.gsize - 1) s) > 1) as unresolved
    from ranked r
  )
  select f.candidate_id, f.full_name, f.photo_path, f.votes,
         case when f.tb_missing then f.vrank else f.rn end as posicion,
         case when f.unresolved then null
              when f.tb_missing then v_election.cargos[f.vrank]
              else v_election.cargos[f.rn] end as cargo,
         f.gsize > 1 as tied, f.unresolved as tie_unresolved, f.tiebreak_rank, f.ballot_order
  from flagged f
  order by f.rn;
end;
$$;

-- -----------------------------------------------------------------------------
-- Registro de un voto (idempotente por operation_id)
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

  -- Reintento de una operación ya guardada: devolver el mismo voto sin duplicar.
  select * into v_vote from public.votes where operation_id = p_operation_id;
  if found then
    if v_vote.election_id <> p_election_id or v_vote.candidate_id <> p_candidate_id then
      raise exception 'El identificador de operación ya se usó para otro voto';
    end if;
    return jsonb_build_object('vote_id', v_vote.id, 'duplicate', true, 'created_at', v_vote.created_at,
      'candidate_votes', (select count(*) from public.votes where election_id = p_election_id and candidate_id = p_candidate_id and voided_at is null),
      'total_votes', (select count(*) from public.votes where election_id = p_election_id and voided_at is null));
  end if;

  if not public.can_count(p_election_id) then
    raise exception 'No tienes permiso para registrar votos en esta elección' using errcode = '42501';
  end if;

  -- Bloqueo compartido: impide que la elección se cierre a mitad de este registro.
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

  insert into public.votes (election_id, candidate_id, operation_id, created_by)
  values (p_election_id, p_candidate_id, p_operation_id, auth.uid())
  on conflict (operation_id) do nothing
  returning * into v_vote;

  if v_vote.id is null then
    select * into v_vote from public.votes where operation_id = p_operation_id;
    return jsonb_build_object('vote_id', v_vote.id, 'duplicate', true, 'created_at', v_vote.created_at,
      'candidate_votes', (select count(*) from public.votes where election_id = p_election_id and candidate_id = p_candidate_id and voided_at is null),
      'total_votes', (select count(*) from public.votes where election_id = p_election_id and voided_at is null));
  end if;

  -- Cualquier cambio en los votos invalida los desempates definidos.
  update public.election_candidates set tiebreak_rank = null
  where election_id = p_election_id and tiebreak_rank is not null;

  return jsonb_build_object('vote_id', v_vote.id, 'duplicate', false, 'created_at', v_vote.created_at,
    'candidate_votes', (select count(*) from public.votes where election_id = p_election_id and candidate_id = p_candidate_id and voided_at is null),
    'total_votes', (select count(*) from public.votes where election_id = p_election_id and voided_at is null));
end;
$$;

-- -----------------------------------------------------------------------------
-- Correcciones: anular o reasignar un voto (con motivo, permisos y auditoría)
-- -----------------------------------------------------------------------------
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
    return jsonb_build_object('adjustment_id', v_adj.id, 'duplicate', true);
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica un motivo de al menos 5 caracteres';
  end if;

  select * into v_vote from public.votes where id = p_vote_id for update;
  if not found then
    raise exception 'Voto no encontrado';
  end if;
  if not public.can_correct(v_vote.election_id) then
    raise exception 'No tienes permiso para corregir votos en esta elección' using errcode = '42501';
  end if;
  select status into v_status from public.elections where id = v_vote.election_id for share;
  if v_status <> 'en_curso' then
    raise exception 'Solo se pueden corregir votos con el conteo abierto. Reabre la elección primero.';
  end if;
  if v_vote.voided_at is not null then
    raise exception 'Este voto ya fue anulado';
  end if;

  update public.votes set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = p_vote_id;

  insert into public.vote_adjustments (election_id, kind, vote_id, reason, operation_id, created_by)
  values (v_vote.election_id, 'anulacion', p_vote_id, trim(p_reason), p_operation_id, auth.uid())
  returning * into v_adj;

  update public.election_candidates set tiebreak_rank = null
  where election_id = v_vote.election_id and tiebreak_rank is not null;

  perform public.write_audit('votes.anular', 'votes', p_vote_id::text, v_vote.election_id,
    (select department_id from public.elections where id = v_vote.election_id),
    jsonb_build_object('candidato', v_vote.candidate_id, 'motivo', trim(p_reason)));

  return jsonb_build_object('adjustment_id', v_adj.id, 'duplicate', false);
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
    raise exception 'No tienes permiso para corregir votos en esta elección' using errcode = '42501';
  end if;
  select status into v_status from public.elections where id = v_vote.election_id for share;
  if v_status <> 'en_curso' then
    raise exception 'Solo se pueden corregir votos con el conteo abierto. Reabre la elección primero.';
  end if;
  if v_vote.voided_at is not null then
    raise exception 'Este voto ya fue anulado';
  end if;
  if p_new_candidate_id = v_vote.candidate_id then
    raise exception 'Elige un candidato distinto al original';
  end if;
  if not exists (select 1 from public.election_candidates
                 where election_id = v_vote.election_id and candidate_id = p_new_candidate_id) then
    raise exception 'El candidato no pertenece a esta elección';
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

  update public.election_candidates set tiebreak_rank = null
  where election_id = v_vote.election_id and tiebreak_rank is not null;

  perform public.write_audit('votes.reasignar', 'votes', p_vote_id::text, v_vote.election_id,
    (select department_id from public.elections where id = v_vote.election_id),
    jsonb_build_object('de', v_vote.candidate_id, 'a', p_new_candidate_id, 'nuevo_voto', v_new.id, 'motivo', trim(p_reason)));

  return jsonb_build_object('adjustment_id', v_adj.id, 'new_vote_id', v_new.id, 'duplicate', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Desempate manual (orden decidido por el responsable, con motivo)
-- -----------------------------------------------------------------------------
create or replace function public.resolve_tie(p_election_id uuid, p_ordered_candidate_ids uuid[], p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status public.election_status;
  v_distinct_votes integer;
  v_found integer;
  i integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede resolver empates' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica cómo se resolvió el empate (al menos 5 caracteres)';
  end if;
  select status into v_status from public.elections where id = p_election_id for update;
  if v_status is distinct from 'en_curso' then
    raise exception 'Los empates se resuelven con el conteo abierto, antes del cierre';
  end if;
  if coalesce(array_length(p_ordered_candidate_ids, 1), 0) < 2
     or (select count(distinct x) from unnest(p_ordered_candidate_ids) x) <> array_length(p_ordered_candidate_ids, 1) then
    raise exception 'Indica al menos dos candidatos distintos';
  end if;

  select count(*), count(distinct cnt) into v_found, v_distinct_votes
  from (
    select ec.candidate_id,
           (select count(*) from public.votes v where v.election_id = ec.election_id
              and v.candidate_id = ec.candidate_id and v.voided_at is null) as cnt
    from public.election_candidates ec
    where ec.election_id = p_election_id and ec.candidate_id = any (p_ordered_candidate_ids)
  ) t;
  if v_found <> array_length(p_ordered_candidate_ids, 1) then
    raise exception 'Algún candidato no pertenece a esta elección';
  end if;
  if v_distinct_votes <> 1 then
    raise exception 'Los candidatos indicados no están empatados';
  end if;

  for i in 1 .. array_length(p_ordered_candidate_ids, 1) loop
    update public.election_candidates set tiebreak_rank = i
    where election_id = p_election_id and candidate_id = p_ordered_candidate_ids[i];
  end loop;

  perform public.write_audit('elections.resolver_empate', 'elections', p_election_id::text, p_election_id,
    (select department_id from public.elections where id = p_election_id),
    jsonb_build_object('orden', to_jsonb(p_ordered_candidate_ids), 'motivo', trim(p_reason)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Ciclo de vida de la elección
-- -----------------------------------------------------------------------------
create or replace function public.start_election(p_election_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_election public.elections;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede iniciar el conteo' using errcode = '42501';
  end if;
  select * into v_election from public.elections where id = p_election_id for update;
  if not found then raise exception 'Elección no encontrada'; end if;
  if v_election.status <> 'preparacion' then
    raise exception 'Solo se puede iniciar una elección en preparación';
  end if;
  if not exists (select 1 from public.election_candidates where election_id = p_election_id) then
    raise exception 'Agrega al menos un candidato antes de iniciar';
  end if;
  if coalesce(array_length(v_election.cargos, 1), 0) = 0 then
    raise exception 'Define al menos un cargo antes de iniciar';
  end if;

  perform set_config('app.election_transition', 'on', true);
  update public.elections set status = 'en_curso', started_at = now(), started_by = auth.uid()
  where id = p_election_id;
  perform set_config('app.election_transition', 'off', true);

  perform public.write_audit('elections.iniciar', 'elections', p_election_id::text, p_election_id,
    v_election.department_id, '{}'::jsonb);
end;
$$;

create or replace function public.close_election(p_election_id uuid, p_notes text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_election public.elections;
  v_closing integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cerrar la elección' using errcode = '42501';
  end if;
  -- Bloqueo exclusivo: espera a que terminen los registros de votos en curso.
  select * into v_election from public.elections where id = p_election_id for update;
  if not found then raise exception 'Elección no encontrada'; end if;
  if v_election.status <> 'en_curso' then
    raise exception 'Solo se puede cerrar una elección con el conteo en curso';
  end if;
  if exists (select 1 from public.election_standings(p_election_id) s where s.tie_unresolved) then
    raise exception 'Hay empates sin resolver que afectan la asignación de cargos. Resuélvelos antes de cerrar.';
  end if;

  v_closing := v_election.closing_count + 1;

  insert into public.election_results
    (election_id, closing_number, candidate_id, full_name, photo_path, votes, posicion, cargo, tiebreak_rank, closed_by)
  select p_election_id, v_closing, s.candidate_id, s.full_name, s.photo_path, s.votes, s.posicion, s.cargo,
         s.tiebreak_rank, auth.uid()
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

create or replace function public.reopen_election(p_election_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_election public.elections;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede reabrir una elección' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Explica el motivo de la reapertura (al menos 10 caracteres)';
  end if;
  select * into v_election from public.elections where id = p_election_id for update;
  if not found then raise exception 'Elección no encontrada'; end if;
  if v_election.status <> 'cerrada' then
    raise exception 'Solo se puede reabrir una elección cerrada';
  end if;
  if exists (select 1 from public.elections
             where department_id = v_election.department_id and status <> 'cerrada' and id <> p_election_id) then
    raise exception 'El departamento ya tiene otra elección activa';
  end if;

  perform set_config('app.election_transition', 'on', true);
  update public.elections
     set status = 'en_curso', reopened_at = now(), reopened_by = auth.uid()
   where id = p_election_id;
  perform set_config('app.election_transition', 'off', true);

  perform public.write_audit('elections.reabrir', 'elections', p_election_id::text, p_election_id,
    v_election.department_id,
    jsonb_build_object('motivo', trim(p_reason), 'cierre_anterior', v_election.closing_count,
                       'cerrada_el', v_election.closed_at));
end;
$$;

-- -----------------------------------------------------------------------------
-- Resultados de todas las elecciones visibles (tabla general del panel)
-- -----------------------------------------------------------------------------
create or replace function public.all_results()
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
-- Gestión de usuarios
-- -----------------------------------------------------------------------------
create or replace function public.set_user_role(p_user_id uuid, p_role public.app_role, p_can_correct boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_old public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar permisos' using errcode = '42501';
  end if;
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Usuario no encontrado'; end if;
  if v_old.role = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Debe quedar al menos un administrador';
  end if;

  update public.profiles
     set role = p_role, can_correct = coalesce(p_can_correct, false)
   where id = p_user_id;

  -- Un usuario que deja de ser operador pierde sus asignaciones.
  if p_role <> 'operador' then
    delete from public.election_operators where user_id = p_user_id;
  end if;

  perform public.write_audit('profiles.permisos', 'profiles', p_user_id::text, null, null,
    jsonb_build_object('email', v_old.email,
      'rol', jsonb_build_object('antes', v_old.role, 'despues', p_role),
      'puede_corregir', jsonb_build_object('antes', v_old.can_correct, 'despues', coalesce(p_can_correct, false))));
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos de ejecución: nada para anon; solo usuarios autenticados.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.my_role(), public.is_admin(), public.is_approved(),
  public.can_count(uuid), public.can_correct(uuid), public.can_view_election(uuid),
  public.election_standings(uuid), public.register_vote(uuid, uuid, uuid),
  public.annul_vote(uuid, text, uuid), public.reassign_vote(uuid, uuid, text, uuid),
  public.resolve_tie(uuid, uuid[], text), public.start_election(uuid),
  public.close_election(uuid, text), public.reopen_election(uuid, text),
  public.all_results(), public.set_user_role(uuid, public.app_role, boolean)
to authenticated;

-- Las funciones internas no se exponen.
revoke execute on function public.write_audit(text, text, text, uuid, uuid, jsonb) from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
