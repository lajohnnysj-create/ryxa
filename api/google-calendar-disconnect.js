// /api/google-calendar-disconnect.js
//
// Fully disconnect Google Calendar:
//   1. Refresh access token if expired (so we can call Google's delete API)
//   2. Delete the "Ryxa" calendar from the user's Google account (along with
//      all events on it). This requires the calendar.app.created scope, which
//      we have.
//   3. Revoke the OAuth token (best-effort)
//   4. Reset google_event_id and synced_to_google_at on all the user's events
//      so a future reconnect treats them as needing fresh sync.
//   5. Delete the google_calendar_connections row entirely.
//
// On reconnect, the OAuth callback creates a fresh "Ryxa" calendar.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

async function verifySupabaseUser(accessToken) {
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: SUPABASE_SERVICE_KEY
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data.id : null;
  } catch (e) {
    console.error('verifySupabaseUser failed:', e.message);
    return null;
  }
}

// Returns a fresh access token, refreshing if needed. Updates the DB if refreshed.
async function getFreshGoogleToken(userId, conn) {
  const expiresAt = new Date(conn.expires_at).getTime();
  const now = Date.now();
  const buffer = 60 * 1000;

  if (expiresAt - buffer > now && conn.access_token) {
    return conn.access_token;
  }

  if (!conn.refresh_token) return null;

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!refreshRes.ok) {
    const errText = await refreshRes.text();
    console.error('Token refresh failed during disconnect:', refreshRes.status, errText);
    return null;
  }

  const tokens = await refreshRes.json();
  if (!tokens.access_token) return null;

  const newExpiresAt = new Date(now + (tokens.expires_in || 3600) * 1000).toISOString();

  await fetch(
    SUPABASE_URL + '/rest/v1/google_calendar_connections?user_id=eq.' + encodeURIComponent(userId),
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        access_token: tokens.access_token,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  return tokens.access_token;
}

module.exports = async function handler(req, res) {
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

  const userId = await verifySupabaseUser(supabaseAccessToken);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  // 1. Read the connection row
  let conn = null;
  try {
    const lookupRes = await fetch(
      SUPABASE_URL +
        '/rest/v1/google_calendar_connections?user_id=eq.' +
        encodeURIComponent(userId) +
        '&select=*&limit=1',
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
        }
      }
    );
    if (lookupRes.ok) {
      const rows = await lookupRes.json();
      if (rows && rows.length) conn = rows[0];
    }
  } catch (e) {
    console.error('Connection lookup failed:', e);
  }

  if (!conn) {
    return res.status(200).json({ ok: true, note: 'no_connection' });
  }

  // 2. Delete the Ryxa calendar from Google (best-effort)
  try {
    if (conn.ryxa_calendar_id) {
      const accessToken = await getFreshGoogleToken(userId, conn);
      if (accessToken) {
        const deleteRes = await fetch(
          'https://www.googleapis.com/calendar/v3/calendars/' +
            encodeURIComponent(conn.ryxa_calendar_id),
          {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + accessToken }
          }
        );
        if (!deleteRes.ok && deleteRes.status !== 404 && deleteRes.status !== 410) {
          const errText = await deleteRes.text();
          console.error('Calendar delete failed (non-fatal):', deleteRes.status, errText);
        }
      } else {
        console.error('No valid access token for calendar delete');
      }
    }
  } catch (e) {
    console.error('Calendar delete error (non-fatal):', e);
  }

  // 3. Revoke OAuth grant on Google's side (best-effort)
  try {
    if (conn.refresh_token) {
      await fetch(
        'https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(conn.refresh_token),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
    }
  } catch (e) {
    console.error('Token revoke failed (non-fatal):', e);
  }

  // 4. Reset event sync state
  try {
    await fetch(
      SUPABASE_URL +
        '/rest/v1/calendar_events?creator_id=eq.' +
        encodeURIComponent(userId),
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          google_event_id: null,
          synced_to_google_at: null,
        }),
      }
    );
  } catch (e) {
    console.error('Event reset failed (non-fatal):', e);
  }

  // 5. Clear deletion queue
  try {
    await fetch(
      SUPABASE_URL +
        '/rest/v1/calendar_event_deletions?user_id=eq.' +
        encodeURIComponent(userId),
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        }
      }
    );
  } catch (e) {
    console.error('Deletion queue cleanup failed (non-fatal):', e);
  }

  // 6. Delete the connection row
  try {
    const delRes = await fetch(
      SUPABASE_URL +
        '/rest/v1/google_calendar_connections?user_id=eq.' +
        encodeURIComponent(userId),
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
        }
      }
    );

    if (!delRes.ok) {
      const errText = await delRes.text();
      console.error('Connection row delete failed:', delRes.status, errText);
      return res.status(500).json({ error: 'disconnect_failed' });
    }
  } catch (e) {
    console.error('Connection row delete error:', e);
    return res.status(500).json({ error: 'disconnect_failed' });
  }

  return res.status(200).json({ ok: true });
};
