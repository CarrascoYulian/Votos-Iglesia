-- =============================================================================
-- Eliminar una elección completa.
--
-- Solo un administrador, que acaba de confirmar su contraseña: la función exige que
-- el token de la sesión provenga de un inicio de sesión con contraseña de hace
-- menos de 5 minutos (claim "amr" de Supabase Auth). El servidor obtiene ese token
-- verificando la contraseña con Supabase Auth justo antes de llamar a la función.
--
-- Se borran votos, correcciones, resultados, operadores y candidatos de la elección
-- (los candidatos siguen existiendo en su departamento). Queda en la auditoría un
-- registro con el resumen de lo eliminado.
-- =============================================================================

-- Los disparadores de protección y auditoría se omiten durante un borrado autorizado.
create or replace function public.guard_election_candidates()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_row public.election_candidates := coalesce(new, old);
  v_election public.elections;
begin
  if current_setting('app.election_delete', true) = 'on' then
    return coalesce(new, old);
  end if;
  select * into v_election from public.elections where id = v_row.election_id;
  if tg_op in ('INSERT', 'DELETE') and v_election.status <> 'preparacion' then
    raise exception 'Solo se pueden modificar los candidatos de una elección en preparación';
  end if;
  if tg_op = 'INSERT' and not exists (
       select 1 from public.candidates c
       where c.id = new.candidate_id and c.department_id = v_election.department_id) then
    raise exception 'El candidato no pertenece al departamento de esta elección';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_election uuid;
  v_department uuid;
  v_entity text;
begin
  if current_setting('app.election_delete', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at') and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('antes', v_old -> v_key, 'despues', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
    if tg_table_name = 'elections' and (v_changes ? 'status') then return new; end if;
  end if;

  v_entity := coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'election_id', coalesce(v_row ->> 'candidate_id', v_row ->> 'user_id')));
  v_election := case
    when tg_table_name = 'elections' then (v_row ->> 'id')::uuid
    when v_row ? 'election_id' then (v_row ->> 'election_id')::uuid end;
  v_department := case
    when tg_table_name = 'departments' then (v_row ->> 'id')::uuid
    when v_row ? 'department_id' then (v_row ->> 'department_id')::uuid
    when v_election is not null then (select department_id from public.elections where id = v_election) end;

  perform public.write_audit(
    tg_table_name || '.' || lower(tg_op), tg_table_name, v_entity, v_election, v_department,
    case tg_op when 'UPDATE' then jsonb_build_object('cambios', v_changes)
               when 'INSERT' then jsonb_build_object('nuevo', v_new)
               else jsonb_build_object('eliminado', v_old) end);
  return coalesce(new, old);
end;
$$;

create function public.delete_election(p_election_id uuid, p_confirm text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_election public.elections;
  v_department text;
  v_fresh boolean;
  v_summary jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar elecciones' using errcode = '42501';
  end if;

  -- Reautenticación reciente con contraseña (menos de 5 minutos).
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' = 'password'
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 300
  ) into v_fresh;
  if not v_fresh then
    raise exception 'Confirma tu contraseña para eliminar la elección' using errcode = '42501';
  end if;

  if upper(trim(coalesce(p_confirm, ''))) <> 'BORRAR' then
    raise exception 'Escribe BORRAR para confirmar';
  end if;

  select * into v_election from public.elections where id = p_election_id for update;
  if not found then raise exception 'Elección no encontrada'; end if;
  select name into v_department from public.departments where id = v_election.department_id;

  v_summary := jsonb_build_object(
    'titulo', v_election.title,
    'departamento', v_department,
    'estado', v_election.status,
    'iniciada', v_election.started_at,
    'cerrada', v_election.closed_at,
    'votos_validos', (select count(*) from public.votes where election_id = p_election_id and voided_at is null),
    'votos_quitados', (select count(*) from public.votes where election_id = p_election_id and voided_at is not null),
    'resultados', (
      select jsonb_agg(jsonb_build_object('candidato', c.full_name, 'votos', x.cnt, 'cargo', ec.cargo) order by x.cnt desc)
      from public.election_candidates ec
      join public.candidates c on c.id = ec.candidate_id
      cross join lateral (select count(*) as cnt from public.votes v
                          where v.election_id = ec.election_id and v.candidate_id = ec.candidate_id
                            and v.voided_at is null) x
      where ec.election_id = p_election_id));

  perform set_config('app.election_delete', 'on', true);
  delete from public.vote_adjustments  where election_id = p_election_id;
  delete from public.votes             where election_id = p_election_id;
  delete from public.election_results  where election_id = p_election_id;
  delete from public.election_operators where election_id = p_election_id;
  delete from public.election_candidates where election_id = p_election_id;
  delete from public.elections         where id = p_election_id;
  perform set_config('app.election_delete', 'off', true);

  perform public.write_audit('elections.eliminar', 'elections', p_election_id::text, p_election_id,
    v_election.department_id, v_summary);

  return v_election.department_id;
end;
$$;

revoke execute on function public.delete_election(uuid, text) from public, anon;
grant execute on function public.delete_election(uuid, text) to authenticated;
revoke execute on function public.guard_election_candidates(), public.audit_row_change() from public, anon, authenticated;
