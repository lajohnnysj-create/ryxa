-- =============================================================================
-- content_reports
-- =============================================================================
-- Stores user reports of objectionable AI output (Apple Guideline 1.2 moderation
-- path). Rows are written by the /api/report-content route using the service
-- role (after verifying the reporter's Bearer token) and reviewed by an admin.
--
-- This is an admin/moderation table, so it is intentionally NOT readable or
-- writable by anon or authenticated roles. RLS is enabled and no anon/auth
-- policies are granted; only service_role (which bypasses RLS) touches it. This
-- is the "specific reason" exception to the usual anon-readable policy default.
--
-- A durable copy of every report is also emailed to hello@ryxa.io at report
-- time, so the moderation trail survives even if the reporter later deletes
-- their account (delete_my_account removes their rows here).
-- =============================================================================

create table if not exists public.content_reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null,
  source           text not null default 'chatbox',
  conversation_id  uuid,
  reported_content text,
  reason           text,
  status           text not null default 'pending',
  created_at       timestamptz not null default now()
);

create index if not exists content_reports_reporter_idx on public.content_reports (reporter_id);
create index if not exists content_reports_status_idx   on public.content_reports (status, created_at desc);

alter table public.content_reports enable row level security;

-- No anon/authenticated policies on purpose: this is admin-only. service_role
-- bypasses RLS for the API route and admin review.

-- Grants (auto-grants are being removed Oct 30 2026, so set them explicitly).
grant select, insert, update, delete on public.content_reports to service_role;
-- Deliberately NOT granting to anon or authenticated.
