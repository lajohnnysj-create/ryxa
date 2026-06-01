-- =============================================================================
-- Creator verification (blue check)
-- =============================================================================
-- Adds an authenticity badge that signals a Link in Bio page genuinely belongs
-- to the real creator. Verification is granted MANUALLY after review.
--
-- Security model: the `verified` flag is the public truth, and it must NOT be
-- settable by the account owner. RLS controls row access, not column access, so
-- the owner's normal profile-update policy would otherwise let them flip
-- verified = true themselves through the standard profile-save API. A guard
-- trigger closes that hole: any attempt to change `verified` from the
-- `authenticated` or `anon` role is rejected. Only service_role (admin API) and
-- privileged DB roles (the SQL editor, run as postgres) can change it, which is
-- exactly how you grant it for now: manual SQL or a future admin API route.
-- =============================================================================

-- 1) The public flag lives on profiles (next to display_name).
alter table public.profiles
  add column if not exists verified boolean not null default false;

-- 2) Guard: block self-setting of `verified` by untrusted roles.
--    SECURITY INVOKER (the default) so current_user reflects the real caller
--    (authenticated / anon / service_role / postgres), not the function owner.
create or replace function public.guard_profile_verified()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- Never let a fresh profile be born verified via the client.
      new.verified := false;
    elsif tg_op = 'UPDATE' and new.verified is distinct from old.verified then
      raise exception 'The verified flag can only be changed by Ryxa administrators.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_verified on public.profiles;
create trigger trg_guard_profile_verified
  before insert or update on public.profiles
  for each row execute function public.guard_profile_verified();

-- 3) Verification applications submitted from Link in Bio > Settings.
create table if not exists public.verification_requests (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null,
  social_handle        text,
  first_name           text,
  last_name            text,
  verification_method  text,   -- 'profile_link' or 'connected_account'
  profile_url          text,   -- public profile URL linking back to Ryxa (if profile_link)
  agreed               boolean not null default false,
  status               text not null default 'pending'
                         check (status in ('pending', 'approved', 'rejected')),
  review_notes         text,
  created_at           timestamptz not null default now(),
  reviewed_at          timestamptz
);

create index if not exists verification_requests_status_idx
  on public.verification_requests (status, created_at desc);

-- At most one active (pending or approved) request per user. Blocks re-submission
-- at the database level, independent of the editor's own check.
create unique index if not exists verification_requests_one_active
  on public.verification_requests (user_id)
  where status in ('pending', 'approved');

-- Grants (explicit; auto-grants are being removed Oct 30 2026). No anon access.
-- Inserts happen ONLY through the /api/submit-verification route (service role),
-- which enforces the Pro/Max requirement, so authenticated gets SELECT only.
grant select on public.verification_requests to authenticated;
grant select, insert, update, delete on public.verification_requests to service_role;

alter table public.verification_requests enable row level security;

-- Owner may read their own request (to show status and block re-apply).
create policy "vr_select_own" on public.verification_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policies for authenticated on purpose. Submission goes
-- through the service-role API route (server-side validation + Pro/Max check);
-- review (approve/reject) happens via service_role or the SQL editor.
