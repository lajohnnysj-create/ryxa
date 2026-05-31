-- =============================================================================
-- delete_my_account(p_uid uuid)
-- =============================================================================
-- Deletes ALL data belonging to a single account, scoped to p_uid.
--
-- SAFETY PROPERTIES (read before changing anything):
--   1. Every statement filters on p_uid (user_id / creator_id / buyer_user_id).
--      There is no unscoped DELETE. It is structurally impossible for this
--      function to match another account's rows.
--   2. Runs as one transaction (function body). It either completes fully or
--      rolls back; there is no half-deleted state.
--   3. Only ROOT tables are deleted. Every child table in the schema has an
--      ON DELETE CASCADE foreign key, so deleting the root clears its subtree.
--      Cascade children are intentionally NOT named here.
--   4. Views are never targeted (public_*, subscribers_view,
--      creator_bunny_stream_usage, google_calendar_status). Deleting from a
--      view would error the whole transaction.
--   5. EXECUTE is granted to service_role only. The /api/delete-account route
--      derives p_uid from the caller's verified Bearer token and passes it in;
--      it never accepts a uid from the request body. A user can only delete
--      themselves.
--
-- Call from the API route via PostgREST RPC:
--   POST {SUPABASE_URL}/rest/v1/rpc/delete_my_account   body: { "p_uid": "<uuid>" }
--
-- IMPORTANT ORDERING NOTE: external resources (R2 objects, Bunny videos) must
-- be gathered/queued by the API route BEFORE this function runs, because this
-- function deletes the rows that hold storage_path and bunny_video_id.
-- =============================================================================

create or replace function public.delete_my_account(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_uid is null then
    raise exception 'delete_my_account: p_uid is required';
  end if;

  -- ---------------------------------------------------------------------------
  -- 1. CROSS-ACCOUNT CASE (the only one): this account bought ANOTHER, surviving
  --    creator's digital product. That purchase row belongs to the other
  --    creator's sales record and does NOT cascade from anything p_uid owns.
  --    Anonymize it: scrub this user's PII, keep the seller's sale record.
  --    (Purchases of p_uid's OWN products are removed by the cascade in step 2,
  --    so they are excluded here via user_id <> p_uid.)
  -- ---------------------------------------------------------------------------
  update digital_product_purchases p
     set buyer_user_id     = null,
         buyer_email       = null,
         buyer_first_name  = null,
         buyer_last_name   = null,
         marketing_consent = false
   where p.buyer_user_id = p_uid
     and p.product_id in (select id from digital_products where user_id <> p_uid);

  -- ---------------------------------------------------------------------------
  -- 2. OWNER ROOTS WITH CASCADING SUBTREES.
  --    courses           -> modules, lessons, lesson_files, quizzes,
  --                         quiz_passes, enrollments, progress
  --    digital_products  -> files, purchases, download_log
  --    brand_deals       -> deal_messages, deal_deliverables
  --    coaching_services -> coaching_bookings, coaching_slot_reservations
  --    ai_chat_conversations -> ai_chat_messages
  -- ---------------------------------------------------------------------------
  delete from courses               where user_id = p_uid;
  delete from digital_products      where user_id = p_uid;
  delete from brand_deals           where user_id = p_uid;
  delete from coaching_services     where user_id = p_uid;
  delete from ai_chat_conversations where user_id = p_uid;

  -- ---------------------------------------------------------------------------
  -- 3. THIS ACCOUNT'S participation rows in OTHER creators' content. Rows tied
  --    to p_uid's OWN courses/services were already cascaded in step 2; these
  --    catch anything where p_uid is the user_id on someone else's content.
  --    Scoped to p_uid, so other accounts' rows are untouched.
  -- ---------------------------------------------------------------------------
  delete from course_enrollments where user_id = p_uid;
  delete from coaching_bookings  where user_id = p_uid;

  -- ---------------------------------------------------------------------------
  -- 4. FLAT OWNER TABLES keyed by user_id.
  -- ---------------------------------------------------------------------------
  delete from account_notes                     where user_id = p_uid;
  delete from ai_usage                          where user_id = p_uid;
  delete from audits                            where user_id = p_uid;
  delete from calendar_event_deletions          where user_id = p_uid;
  delete from course_users                      where user_id = p_uid;
  delete from design_projects                   where user_id = p_uid;
  delete from google_calendar_connections       where user_id = p_uid;
  delete from grid_plan                         where user_id = p_uid;
  delete from instagram_connections             where user_id = p_uid;
  delete from link_in_bio                       where user_id = p_uid;
  delete from manual_subscriber_imports         where user_id = p_uid;
  delete from manual_subscriber_threshold_events where user_id = p_uid;
  delete from media_kit                         where user_id = p_uid;
  delete from page_view_counts                  where user_id = p_uid;
  delete from page_view_dedup                   where user_id = p_uid;
  delete from scripts                           where user_id = p_uid;
  delete from snake_list                        where user_id = p_uid;
  delete from subscriber_exports                where user_id = p_uid;
  delete from whitelist                         where user_id = p_uid;

  -- Moderation reports filed by this account (keyed by reporter_id). The email
  -- copy sent to hello@ryxa.io at report time is the durable moderation record,
  -- so removing the row here does not lose the report trail.
  delete from content_reports where reporter_id = p_uid;

  -- ---------------------------------------------------------------------------
  -- 5. FLAT OWNER TABLES keyed by creator_id.
  -- ---------------------------------------------------------------------------
  delete from bio_email_signups       where creator_id = p_uid;
  delete from calendar_events         where creator_id = p_uid;
  delete from manual_subscribers      where creator_id = p_uid;
  delete from subscribe_rate_limits   where creator_id = p_uid;
  delete from subscriber_names        where creator_id = p_uid;
  delete from subscriber_notes        where creator_id = p_uid;
  delete from subscriber_suppressions where creator_id = p_uid;

  -- ---------------------------------------------------------------------------
  -- 6. ACCOUNT STATE.
  --    subscriptions = access-control state, always removed.
  -- ---------------------------------------------------------------------------
  delete from subscriptions where user_id = p_uid;

  -- ---------------------------------------------------------------------------
  -- 7. FINANCIAL LEDGER -- RETAINED (anonymized).
  --    Decision: revenue_events is kept for tax and accounting purposes. It
  --    holds transaction amounts/dates keyed by a uuid. Once profiles and the
  --    auth user are deleted (steps 8 + the API route), that uuid no longer
  --    resolves to a natural person, so the retained ledger is anonymized.
  --    This is disclosed in section 11 of privacy.html.
  --    To switch back to full deletion, UNCOMMENT the line below AND remove the
  --    retention sentence from privacy.html section 11.
  -- ---------------------------------------------------------------------------
  -- delete from revenue_events where user_id = p_uid;

  -- ---------------------------------------------------------------------------
  -- 8. PROFILE last.
  -- ---------------------------------------------------------------------------
  delete from profiles where user_id = p_uid;
end;
$$;

-- Lock the function down: nobody but service_role may execute it.
revoke all on function public.delete_my_account(uuid) from public;
revoke all on function public.delete_my_account(uuid) from anon;
revoke all on function public.delete_my_account(uuid) from authenticated;
grant execute on function public.delete_my_account(uuid) to service_role;
