// /api/google-calendar-disconnect.js
//
// Removes the user's Google Calendar connection from Ryxa.
// Best-effort revokes the token on Google's side too.
//
// Note: this does NOT delete the "Ryxa" calendar from the user's
// Google account. The user can do that in Google Calendar themselves.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  // Best-effort: read refresh token, revoke on Google's side
  try {
    const lookupUrl =
      SUPABASE_URL +
      '/rest/v1/google_calendar_connections?user_id=eq.' +
      encodeURIComponent(userId) +
      '&select=refresh_token&limit=1';

    const lookupRes = await fetch(lookupUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
      }
    });

    if (lookupRes.ok) {
      const rows = await lookupRes.json();
      if (rows && rows.length && rows[0].refresh_token) {
        try {
          await fetch(
            'https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rows[0].refresh_token),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
          );
        } catch (e) {
          console.error('Google token revoke failed (non-fatal):', e);
        }
      }
    }
  } catch (e) {
    console.error('Token lookup before revoke failed (non-fatal):', e);
  }

  // Update instead of delete: wipe tokens but preserve ryxa_calendar_id
  // so reconnect doesn't create a duplicate calendar
  try {
    const updateUrl =
      SUPABASE_URL +
      '/rest/v1/google_calendar_connections?user_id=eq.' +
      encodeURIComponent(userId);

    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        access_token: '',
        refresh_token: '',
        expires_at: new Date(0).toISOString(),
        disconnected_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error('Disconnect update failed:', updateRes.status, errText);
      return res.status(500).json({ error: 'disconnect_failed' });
    }
  } catch (e) {
    console.error('Update error:', e);
    return res.status(500).json({ error: 'disconnect_failed' });
  }

  return res.status(200).json({ ok: true });
};
