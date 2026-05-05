// /api/google-calendar-disconnect.js
//
// Removes the user's Google Calendar connection from Ryxa.
// Phase 1: just deletes the row. Phase 3+ should also call Google's
// token revoke endpoint so the user's grant in their Google account
// is cleaned up.
//
// Note: this does NOT delete the "Ryxa" calendar from the user's
// Google account. The user can do that themselves in Google Calendar
// if they want a fully clean disconnect.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const supabaseAccessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!supabaseAccessToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: userErr } = await sb.auth.getUser(supabaseAccessToken);
  if (userErr || !user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  // Optional Phase 1.5: revoke the token with Google so they don't keep a
  // dangling grant. We have to read the token first.
  try {
    const { data: conn } = await sb
      .from('google_calendar_connections')
      .select('refresh_token')
      .eq('user_id', user.id)
      .maybeSingle();

    if (conn && conn.refresh_token) {
      // Best-effort revoke — non-fatal if it fails
      try {
        await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(conn.refresh_token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch (e) {
        console.error('Token revoke failed (non-fatal):', e);
      }
    }
  } catch (e) {
    console.error('Token lookup before revoke failed (non-fatal):', e);
  }

  // Delete the row
  const { error: delErr } = await sb
    .from('google_calendar_connections')
    .delete()
    .eq('user_id', user.id);

  if (delErr) {
    console.error('Disconnect delete failed:', delErr);
    return res.status(500).json({ error: 'disconnect_failed' });
  }

  return res.status(200).json({ ok: true });
}
