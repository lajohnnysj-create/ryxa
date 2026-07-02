-- Push token storage for the Ryxa mobile app.
-- Run in the Supabase SQL editor. Safe to paste output: returns no secrets.
-- Grants, RLS, and policies ship together as one unit.

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Grants. Writes happen through the Vercel API route with the service role.
-- Authenticated users may read and remove their own rows.
grant all on table public.push_tokens to service_role;
grant select, delete on table public.push_tokens to authenticated;
-- No grants to anon on purpose. This table has no public surface.

alter table public.push_tokens enable row level security;

-- Owner-scoped policies only. No anon policies.
create policy "push_tokens_owner_select"
  on public.push_tokens for select
  to authenticated
  using (auth.uid() = user_id);

create policy "push_tokens_owner_delete"
  on public.push_tokens for delete
  to authenticated
  using (auth.uid() = user_id);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

-- REQUIRED FOLLOW-UP, do not skip:
-- push_tokens has a user_id column, so delete_my_account() must be updated
-- to include this line alongside the other per-user deletes, then re-tested:
--
--   delete from public.push_tokens where user_id = v_user;
--
-- (Match the variable name your existing function uses for the caller's id.)
-- The on delete cascade above covers hard auth.users deletion, but the
-- function must stay complete so no path orphans PII.
