-- =============================================================================
-- Seguridad: funciones de permisos, disparadores de integridad/auditoría y RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones auxiliares de permisos
-- -----------------------------------------------------------------------------
create or replace function public.my_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'pendiente'::public.app_role);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.my_role() = 'admin'; $$;

create or replace function public.is_approved()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.my_role() in ('consulta', 'operador', 'admin'); $$;

-- Puede registrar votos: administrador u operador asignado a la elección.
create or replace function public.can_count(p_election_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or (public.my_role() = 'operador' and exists (
            select 1 from public.election_operators eo
            where eo.election_id = p_election_id and eo.user_id = auth.uid()));
$$;

-- Puede corregir votos: administrador, u operador asignado con permiso de corrección.
create or replace function public.can_correct(p_election_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or (public.can_count(p_election_id)
          and coalesce((select can_correct from public.profiles where id = auth.uid()), false));
$$;

-- Puede ver resultados: administrador, consulta, u operador asignado.
create or replace function public.can_view_election(p_election_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.my_role() in ('admin', 'consulta') or public.can_count(p_election_id);
$$;

-- -----------------------------------------------------------------------------
-- Auditoría
-- -----------------------------------------------------------------------------
create or replace function public.write_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_election_id uuid, p_department_id uuid, p_details jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, election_id, department_id, details)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          p_action, p_entity_type, p_entity_id, p_election_id, p_department_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Registro genérico de cambios en tablas administrativas.
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
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at') and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('antes', v_old -> v_key, 'despues', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
    -- Los cambios de estado de una elección se auditan en sus funciones (con motivo).
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

-- -----------------------------------------------------------------------------
-- Disparadores de integridad
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at := now(); return new; end; $$;

create trigger departments_touch before update on public.departments for each row execute function public.touch_updated_at();
create trigger candidates_touch  before update on public.candidates  for each row execute function public.touch_updated_at();
create trigger elections_touch   before update on public.elections   for each row execute function public.touch_updated_at();
create trigger profiles_touch    before update on public.profiles    for each row execute function public.touch_updated_at();

-- Un candidato no cambia de departamento si ya participó en alguna elección.
create or replace function public.guard_candidate_department()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.department_id <> old.department_id
     and exists (select 1 from public.election_candidates where candidate_id = old.id) then
    raise exception 'No se puede cambiar el departamento de un candidato que ya participó en una elección';
  end if;
  return new;
end;
$$;
create trigger candidates_guard_department before update of department_id on public.candidates
  for each row execute function public.guard_candidate_department();

-- Candidatos de una elección: mismo departamento y solo durante la preparación.
create or replace function public.guard_election_candidates()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_row public.election_candidates := coalesce(new, old);
  v_election public.elections;
begin
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
create trigger election_candidates_guard before insert or delete on public.election_candidates
  for each row execute function public.guard_election_candidates();

-- La configuración de una elección solo se edita en preparación; el estado solo cambia por funciones.
create or replace function public.guard_election_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  if current_setting('app.election_transition', true) = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.started_at is distinct from old.started_at or new.started_by is distinct from old.started_by
     or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by
     or new.closing_count is distinct from old.closing_count
     or new.reopened_at is distinct from old.reopened_at or new.reopened_by is distinct from old.reopened_by
     or new.department_id is distinct from old.department_id then
    raise exception 'El estado de la elección solo puede cambiarse con las acciones Iniciar, Cerrar o Reabrir';
  end if;
  if old.status <> 'preparacion'
     and (new.cargos is distinct from old.cargos or new.title is distinct from old.title) then
    raise exception 'Los cargos y el título solo se pueden editar mientras la elección está en preparación';
  end if;
  return new;
end;
$$;
create trigger elections_guard_update before update on public.elections
  for each row execute function public.guard_election_update();

create or replace function public.guard_election_insert()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.status := 'preparacion';
  new.started_at := null; new.started_by := null;
  new.closed_at := null;  new.closed_by := null;
  new.closing_count := 0;
  new.reopened_at := null; new.reopened_by := null;
  new.created_by := auth.uid();
  return new;
end;
$$;
create trigger elections_guard_insert before insert on public.elections
  for each row execute function public.guard_election_insert();

create or replace function public.set_created_by()
returns trigger language plpgsql set search_path = public
as $$ begin new.created_by := auth.uid(); return new; end; $$;
create trigger departments_created_by before insert on public.departments for each row execute function public.set_created_by();
create trigger candidates_created_by  before insert on public.candidates  for each row execute function public.set_created_by();

create or replace function public.set_assigned_by()
returns trigger language plpgsql set search_path = public
as $$ begin new.assigned_by := auth.uid(); return new; end; $$;
create trigger election_operators_assigned_by before insert on public.election_operators
  for each row execute function public.set_assigned_by();

-- Auditoría automática
create trigger departments_audit after insert or update on public.departments
  for each row execute function public.audit_row_change();
create trigger candidates_audit after insert or update on public.candidates
  for each row execute function public.audit_row_change();
create trigger elections_audit after insert or update on public.elections
  for each row execute function public.audit_row_change();
create trigger election_candidates_audit after insert or delete on public.election_candidates
  for each row execute function public.audit_row_change();
create trigger election_operators_audit after insert or delete on public.election_operators
  for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- Alta de usuarios: perfil 'pendiente'; el correo de arranque pasa a admin al confirmarse.
-- -----------------------------------------------------------------------------
create or replace function public.handle_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do update set email = excluded.email;

  if new.email_confirmed_at is not null
     and exists (select 1 from public.bootstrap_admins b where b.email = lower(new.email)) then
    update public.profiles set role = 'admin' where id = new.id;
    delete from public.bootstrap_admins where email = lower(new.email);
    insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, details)
    values (new.id, lower(new.email), 'profiles.bootstrap_admin', 'profiles', new.id::text,
            jsonb_build_object('rol', 'admin'));
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_auth_user();
create trigger on_auth_user_confirmed after update of email_confirmed_at, email on auth.users
  for each row execute function public.handle_auth_user();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.bootstrap_admins    enable row level security;
alter table public.departments         enable row level security;
alter table public.candidates          enable row level security;
alter table public.elections           enable row level security;
alter table public.election_candidates enable row level security;
alter table public.election_operators  enable row level security;
alter table public.votes               enable row level security;
alter table public.vote_adjustments    enable row level security;
alter table public.election_results    enable row level security;
alter table public.audit_logs          enable row level security;

-- Ningún acceso anónimo a los datos.
revoke all on all tables in schema public from anon;

-- profiles: cada usuario ve el suyo; el administrador ve todos. Los cambios de rol van por set_user_role().
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own_name on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- bootstrap_admins: sin políticas => inaccesible por API.

-- departments / candidates: lectura para usuarios aprobados; escritura solo administradores. Sin borrado.
create policy departments_select on public.departments for select to authenticated using (public.is_approved());
create policy departments_insert on public.departments for insert to authenticated with check (public.is_admin());
create policy departments_update on public.departments for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy candidates_select on public.candidates for select to authenticated using (public.is_approved());
create policy candidates_insert on public.candidates for insert to authenticated with check (public.is_admin());
create policy candidates_update on public.candidates for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- elections
create policy elections_select on public.elections for select to authenticated using (public.is_approved());
create policy elections_insert on public.elections for insert to authenticated with check (public.is_admin());
create policy elections_update on public.elections for update to authenticated
  using (public.is_admin() and status = 'preparacion') with check (public.is_admin());

-- election_candidates (el desempate solo se fija con resolve_tie())
create policy election_candidates_select on public.election_candidates for select to authenticated using (public.is_approved());
create policy election_candidates_insert on public.election_candidates for insert to authenticated with check (public.is_admin());
create policy election_candidates_delete on public.election_candidates for delete to authenticated using (public.is_admin());

-- election_operators
create policy election_operators_select on public.election_operators for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
create policy election_operators_insert on public.election_operators for insert to authenticated
  with check (public.is_admin() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'operador'));
create policy election_operators_delete on public.election_operators for delete to authenticated using (public.is_admin());

-- votes / vote_adjustments: solo lectura. Toda escritura pasa por register_vote(), annul_vote() y reassign_vote().
create policy votes_select on public.votes for select to authenticated using (public.can_view_election(election_id));
create policy vote_adjustments_select on public.vote_adjustments for select to authenticated using (public.can_view_election(election_id));
revoke insert, update, delete, truncate on public.votes, public.vote_adjustments, public.election_results, public.audit_logs from authenticated;

create policy election_results_select on public.election_results for select to authenticated using (public.can_view_election(election_id));

-- audit_logs: administradores ven todo; consulta y operadores ven el historial de sus elecciones.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_admin() or (election_id is not null and public.can_view_election(election_id)));

-- -----------------------------------------------------------------------------
-- Storage: fotografías de candidatos (bucket privado)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidate-photos', 'candidate-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy candidate_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'candidate-photos' and public.is_approved());
create policy candidate_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'candidate-photos' and public.is_admin());
-- Sin políticas de update/delete: las fotos anteriores se conservan para los resultados históricos.

-- Tiempo real para que varias pantallas vean el conteo al instante.
alter publication supabase_realtime add table public.votes;
