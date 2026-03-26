-- ─── X-Launchpad Kanban: Supabase schema ─────────────────────
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- x-launchpad/supabase/schema.sql 과 동일한 구조입니다.

-- ─── Users ────────────────────────────────────────────────────
create table if not exists public.users (
  id            bigserial       primary key,
  email         text            unique not null,
  password_hash text            not null,
  name          text            not null default '',
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now()
);

-- updated_at 자동 갱신 함수
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

alter table public.users disable row level security;

-- ─── Plans (Kanban Cards) ─────────────────────────────────────
create table if not exists public.plans (
  id            text            primary key,
  user_id       bigint          not null references public.users(id) on delete cascade,
  title         text            not null default '',
  content       text            not null default '',
  category      text            not null default 'other',
  status        text            not null default 'todo',
  ticket_id     text            unique,
  ai_done       boolean         not null default false,
  use_worktree  boolean         not null default false,
  use_headless  boolean         not null default false,
  ai_sessions   jsonb           not null default '[]'::jsonb,
  project       text,
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now()
);

create index if not exists idx_plans_user_id on public.plans(user_id);

drop trigger if exists plans_updated_at on public.plans;
create trigger plans_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

alter table public.plans disable row level security;

-- ─── Plan Logs (Activity Trail) ──────────────────────────────
create table if not exists public.plan_logs (
  id          bigserial       primary key,
  plan_id     text            not null references public.plans(id) on delete cascade,
  type        text            not null,
  content     text            not null default '',
  commit_hash text,
  created_at  timestamptz     not null default now()
);

create index if not exists idx_plan_logs_plan_id on public.plan_logs(plan_id);

alter table public.plan_logs disable row level security;
