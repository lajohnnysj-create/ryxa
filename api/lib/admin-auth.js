// /api/lib/admin-auth.js
//
// One implementation of "is this request from the admin", shared by the
// read endpoint and the write endpoint. Two copies of an authorization check
// is one copy too many: they drift, and the drift is silent.
//
// The check has two parts, and both matter:
//
//   1. The email must match, verified server-side against Supabase's user
//      record rather than trusted from the client.
//   2. The account must carry a GOOGLE identity.
//
// Part 2 is what closes the obvious hole. Supabase cannot verify that someone
// signing up with email+password owns that address; Google can. Without it,
// anyone could register the admin email and walk in.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const ADMIN_EMAIL = 'johnnyla@mrla-media.com';

function getServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

async function getVerifiedUser(req) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: auth, apikey: getServiceKey() },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function isAdmin(user) {
  if (!user) return false;

  const identities = Array.isArray(user.identities) ? user.identities : [];
  const google = identities.find(function (i) { return i.provider === 'google'; });
  if (!google) return false;

  // Check the email GOOGLE asserts, not the one on the Supabase user record.
  //
  // user.email is mutable: any authenticated user can call updateUser({email}).
  // Supabase normally requires confirming a link sent to the new address, but
  // if "Confirm email" is ever disabled the change lands immediately. An
  // attacker could then sign in with their own Google account, rename their
  // email to the admin's, and pass a check that looked at user.email while
  // merely requiring that *some* Google identity exists.
  //
  // identity_data.email comes from Google's ID token. A user cannot set it.
  const googleEmail = google.identity_data && google.identity_data.email;
  if (!googleEmail) return false;
  if (googleEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return false;

  // And the Supabase record must still agree. Both must point at the admin, so
  // a stale or renamed account cannot slip through either direction.
  if (!user.email || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return false;

  return true;
}

// Every admin endpoint starts the same way. Returns the user on success, or
// null after having already written the response.
async function requireAdmin(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server not configured' });
    return null;
  }
  const user = await getVerifiedUser(req);
  if (!isAdmin(user)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return user;
}

module.exports = { SUPABASE_URL, ADMIN_EMAIL, getServiceKey, getVerifiedUser, isAdmin, requireAdmin };
