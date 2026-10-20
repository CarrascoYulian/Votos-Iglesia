-- =============================================================================
-- Votaciones Arca de Salvación — Esquema base
-- Tablas, tipos, índices y restricciones de integridad.
-- Los votos NUNCA se eliminan: las correcciones se registran como anulaciones.
-- =============================================================================

create extension if not exists pgcrypto;

create type public.app_role as enum ('pendiente', 'consulta', 'operador', 'admin');
create type public.election_status as enum ('preparacion', 'en_curso', 'cerrada');
create type public.adjustment_kind as enum ('anulacion', 'reasignacion');

-- -----------------------------------------------------------------------------
-- Perfiles y roles (1:1 con auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.app_role not null default 'pendiente',
  can_correct boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'Usuarios autorizados y sus permisos. El rol solo se cambia mediante set_user_role().';
comment on column public.profiles.can_correct is 'Permite a un operador anular o reasignar votos durante un conteo abierto.';

-- Correos que se convierten en administrador al confirmar su cuenta (uso único).
create table public.bootstrap_admins (
  email text primary key
);
comment on table public.bootstrap_admins is 'Arranque: el primer administrador. Se elimina la fila al usarse. Sin acceso por API.';

-- -----------------------------------------------------------------------------
-- Departamentos y candidatos
-- -----------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 120),
  description text,
  active      boolean not null default true,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index departments_name_key on public.departments (lower(trim(name)));

create table public.candidates (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id),
  full_name     text not null check (length(trim(full_name)) between 2 and 160),
  notes         text,
  photo_path    text,
  active        boolean not null default true,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index candidates_department_idx on public.candidates (department_id);

-- -----------------------------------------------------------------------------
-- Elecciones
-- -----------------------------------------------------------------------------
create table public.elections (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id),
  title         text not null check (length(trim(title)) between 3 and 160),
  -- Cargos en orden: la posición 1 recibe cargos[1], la 2 recibe cargos[2], etc.
  cargos        text[] not null default '{}',
  notes         text,
  status        public.election_status not null default 'preparacion',
  started_at    timestamptz,
  started_by    uuid references public.profiles (id),
  closed_at     timestamptz,
  closed_by     uuid references public.profiles (id),
  closing_count integer not null default 0,
  reopened_at   timestamptz,
  reopened_by   uuid references public.profiles (id),
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index elections_department_idx on public.elections (department_id);
-- Solo una elección no cerrada por departamento.
create unique index elections_one_active_per_department
  on public.elections (department_id) where status <> 'cerrada';

-- Candidatos que participan en cada elección (deben ser del mismo departamento).
create table public.election_candidates (
  election_id   uuid not null references public.elections (id),
  candidate_id  uuid not null references public.candidates (id),
  ballot_order  integer not null default 0,
  -- Orden de desempate definido por un administrador (1 = mejor). Se borra si cambian los votos.
  tiebreak_rank integer check (tiebreak_rank > 0),
  created_at    timestamptz not null default now(),
  primary key (election_id, candidate_id)
);
create index election_candidates_candidate_idx on public.election_candidates (candidate_id);

-- Operadores de conteo asignados a cada elección.
create table public.election_operators (
  election_id uuid not null references public.elections (id),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  primary key (election_id, user_id)
);
create index election_operators_user_idx on public.election_operators (user_id);

-- -----------------------------------------------------------------------------
-- Votos (uno por papel leído) y correcciones
-- -----------------------------------------------------------------------------
create table public.votes (
  id           uuid primary key default gen_random_uuid(),
  election_id  uuid not null,
  candidate_id uuid not null,
  -- Identificador generado por el cliente para cada pulsación: garantiza idempotencia.
  operation_id uuid not null unique,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references public.profiles (id),
  void_reason  text,
  -- La FK compuesta impide votar por un candidato que no pertenece a la elección.
  foreign key (election_id, candidate_id)
    references public.election_candidates (election_id, candidate_id)
);
create index votes_election_candidate_valid_idx
  on public.votes (election_id, candidate_id) where voided_at is null;
create index votes_election_created_idx on public.votes (election_id, created_at desc);

create table public.vote_adjustments (
  id           uuid primary key default gen_random_uuid(),
  election_id  uuid not null references public.elections (id),
  kind         public.adjustment_kind not null,
  vote_id      uuid not null references public.votes (id),
  new_vote_id  uuid references public.votes (id),
  reason       text not null check (length(trim(reason)) >= 5),
  operation_id uuid not null unique,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index vote_adjustments_election_idx on public.vote_adjustments (election_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Resultados definitivos (instantánea en cada cierre; nunca se sobrescriben)
-- -----------------------------------------------------------------------------
create table public.election_results (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null references public.elections (id),
  closing_number integer not null,
  candidate_id   uuid not null references public.candidates (id),
  full_name      text not null,
  photo_path     text,
  votes          integer not null,
  posicion       integer not null,
  cargo          text,
  tiebreak_rank  integer,
  closed_by      uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  unique (election_id, closing_number, candidate_id)
);

-- -----------------------------------------------------------------------------
-- Auditoría
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  actor_id      uuid,
  actor_email   text,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  election_id   uuid,
  department_id uuid,
  details       jsonb not null default '{}'::jsonb
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_election_idx on public.audit_logs (election_id, created_at desc);
create index audit_logs_department_idx on public.audit_logs (department_id, created_at desc);
