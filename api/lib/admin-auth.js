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
// Admin allowlist. Every entry must be a GOOGLE account: the check below
// compares against the email Google asserts in its ID token, not the mutable
// email on the Supabase user record.
//
// Each address here is a full perimeter. Adding one doubles the number of
// accounts whose compromise grants admin access, so add deliberately.
const ADMIN_EMAILS = [
  'johnnyla@mrla-media.com',
  'johnny@johnnyla.com'
].map(function (e) { return e.toLowerCase(); });

function getServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

// How did THIS session authenticate?
//
// Not app_metadata.provider: Supabase copies that from the user record into the
// JWT, and the record freezes it at signup. An account created with a password
// and later linked to Google reports "email" forever, even in a token minted by
// a Google sign-in. Verified against a live token before writing this.
//
// The claim that answers the question is `amr` (Authentication Methods
// Reference), which GoTrue writes per session:
//
//   Google   -> [{ method: "oauth",    timestamp: ... }]
//   Password -> [{ method: "password", timestamp: ... }]
//   Magic    -> [{ method: "otp",      timestamp: ... }]
//   Google+MFA -> [{ method: "oauth" }, { method: "mfa/totp" }]
//
// This only READS the claim to decide which door was used. Authenticity is
// established separately, by exchanging the token with Supabase in
// getVerifiedUser(). A forged claim in an unsigned token gets a 401 there
// before this value is ever consulted.
function sessionAuthMethods(req) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return [];
    const parts = auth.slice(7).split('.');
    if (parts.length !== 3) return [];
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const amr = Array.isArray(payload.amr) ? payload.amr : [];
    if (amr.length === 0) return [];

    // Return every method this session used, not just the latest.
    //
    // amr accumulates: a Google sign-in followed by an MFA step-up yields
    // [oauth, mfa/totp]. Taking the last entry would reject exactly the
    // strongest session in the system. The question is whether Google was used
    // at all, not whether it was used most recently.
    return amr.map(function (e) { return e && e.method; }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function getVerifiedUser(req) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return [];
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

  const asserted = googleEmail.toLowerCase();
  if (ADMIN_EMAILS.indexOf(asserted) === -1) return false;

  // The Supabase record must agree with what Google asserted. user.email is
  // mutable; identity_data.email is not. Requiring both to name the SAME
  // allowlisted address means a renamed account cannot slip through either
  // direction, and one admin cannot be impersonated by renaming into another's
  // address while holding their own Google identity.
  if (!user.email || user.email.toLowerCase() !== asserted) return false;

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

  // Google only. A password or magic-link session on an admin account is
  // rejected even though the account itself qualifies: the panel was designed
  // to have exactly one door.
  if (sessionAuthMethods(req).indexOf('oauth') === -1) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return user;
}

module.exports = { SUPABASE_URL, ADMIN_EMAILS, getServiceKey, getVerifiedUser, isAdmin, sessionAuthMethods, requireAdmin };
