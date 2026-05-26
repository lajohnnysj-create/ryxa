// =============================================================================
// api/lib/token-crypto.js
// =============================================================================
// Application-layer AES-256-GCM encryption for OAuth tokens at rest in
// Supabase. Tokens stay in Supabase tables; the encryption key lives in
// Vercel env vars + Supabase Edge Function secrets, so a Supabase compromise
// alone yields only ciphertext.
//
// Format: base64url(version_byte || iv_12_bytes || auth_tag_16_bytes || ciphertext)
// - version_byte = 0x01 (room to rotate to a new format/key later)
// - iv = 12 random bytes (96-bit IV recommended for GCM)
// - auth_tag = 16 bytes (GCM MAC)
//
// Why versioned: if you ever rotate the master key, you'll want to detect
// "this ciphertext is from before the rotation" vs "after." Bump the version
// byte and the decryptor can pick the right key.
//
// Required env var: OAUTH_TOKEN_ENC_KEY = base64-encoded 32 random bytes
// Generate locally with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// =============================================================================

const crypto = require('crypto');

const VERSION_V1 = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey() {
  const b64 = process.env.OAUTH_TOKEN_ENC_KEY;
  if (!b64) {
    throw new Error('OAUTH_TOKEN_ENC_KEY env var is not set. Generate one and add it to Vercel + Supabase Edge Function secrets.');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('OAUTH_TOKEN_ENC_KEY must decode to exactly 32 bytes (256 bits). Got ' + key.length + ' bytes.');
  }
  return key;
}

// Encrypt a plaintext string. Returns base64url-encoded ciphertext blob.
// Pass null/undefined/empty in, get null out (so callers can use this on
// optional fields like refresh_token without special-casing).
function encryptToken(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([Buffer.from([VERSION_V1]), iv, tag, ciphertext]);
  return blob.toString('base64url');
}

// Decrypt a ciphertext blob produced by encryptToken. Returns the original
// plaintext string. Pass null/undefined in, get null out (so callers can
// decrypt optional fields safely). Throws on tamper, wrong key, or corruption.
function decryptToken(encoded) {
  if (encoded === null || encoded === undefined || encoded === '') return null;
  const blob = Buffer.from(String(encoded), 'base64url');
  if (blob.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error('Ciphertext too short to be valid');
  }
  const version = blob[0];
  if (version !== VERSION_V1) {
    throw new Error('Unknown ciphertext version: ' + version);
  }
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(1 + IV_LEN + TAG_LEN);
  const key = loadKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

// Heuristic check: does a value look like an encrypted blob this module
// produced? Used during the migration period to skip re-encrypting already-
// encrypted values, or to detect legacy plaintext at read time.
//
// Real OAuth tokens (Google, Instagram, etc.) are typically long base64url-
// safe strings too, so this is NOT a perfect oracle - just a quick filter.
// We check the decoded version byte; legacy plaintext tokens won't have a
// 0x01 byte in the right position with the right total length structure.
function looksEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const blob = Buffer.from(value, 'base64url');
    if (blob.length < 1 + IV_LEN + TAG_LEN + 1) return false;
    return blob[0] === VERSION_V1;
  } catch (_) {
    return false;
  }
}

module.exports = { encryptToken, decryptToken, looksEncrypted };
