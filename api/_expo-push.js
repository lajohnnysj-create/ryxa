// Helper for sending push notifications through Expo's push service.
// Copy into the Ryxa repo at api/_expo-push.js and call it from server
// events (Stripe webhook on a sale, new booking, new subscriber).
//
// Usage:
//   const { sendPushToUser } = require('./_expo-push');
//   await sendPushToUser(userId, { title: 'New sale', body: 'Someone bought your course.' });

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getTokensForUser(userId) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/push_tokens?user_id=eq.' + userId + '&select=token',
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
      }
    }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r) => r.token);
}

async function deleteToken(token) {
  await fetch(
    SUPABASE_URL + '/rest/v1/push_tokens?token=eq.' + encodeURIComponent(token),
    {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
      }
    }
  );
}

// Sends to every registered device for a user. Prunes tokens that Expo
// reports as no longer registered (user deleted the app).
async function sendPushToUser(userId, { title, body, data }) {
  const tokens = await getTokensForUser(userId);
  if (tokens.length === 0) return { sent: 0 };

  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    data: data || {},
    sound: 'default'
  }));

  let sent = 0;
  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk)
      });
      const result = await res.json();
      const tickets = Array.isArray(result.data) ? result.data : [];
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j];
        if (ticket.status === 'ok') {
          sent++;
        } else if (
          ticket.details &&
          ticket.details.error === 'DeviceNotRegistered'
        ) {
          await deleteToken(chunk[j].to);
        }
      }
    } catch (e) {
      // Network failure to Expo. Skip this chunk, do not crash the webhook.
    }
  }
  return { sent };
}

module.exports = { sendPushToUser };
