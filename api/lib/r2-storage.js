// =============================================================================
// api/lib/r2-storage.js
// =============================================================================
// Cloudflare R2 helper module. Generates presigned URLs (download + upload)
// and deletes objects. Uses AWS Signature V4 because R2 is S3-compatible.
//
// Pure Node.js crypto + fetch. No AWS SDK dependency, matches the rest of
// the Ryxa codebase style (raw fetch everywhere).
//
// Required env vars:
//   R2_ACCOUNT_ID         32-char hex string from Cloudflare R2 dashboard
//   R2_ACCESS_KEY_ID      from "Create API Token" -> Object Read & Write
//   R2_SECRET_ACCESS_KEY  shown ONCE during token creation
//   R2_BUCKET_NAME        e.g. "ryxa-digital-products"
//
// Region is always "auto" for R2 (R2 ignores region, but Sig V4 requires one).
// =============================================================================

const crypto = require('crypto');

const R2_REGION = 'auto';
const R2_SERVICE = 's3';

function getConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('R2 env vars not configured. Need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.');
  }
  return {
    accountId: accountId,
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
    bucketName: bucketName,
    host: accountId + '.r2.cloudflarestorage.com',
    endpoint: 'https://' + accountId + '.r2.cloudflarestorage.com'
  };
}

// =============================================================================
// AWS Signature V4 primitives
// =============================================================================

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

// Encodes path segments per AWS rules: NOT the slashes, but everything else
// that isn't unreserved. Critically, slashes between segments are preserved.
function uriEncodePath(path) {
  return path.split('/').map(function (seg) { return encodeURIComponent(seg); }).join('/');
}

// AWS Sig V4 query-string encoding (used in canonical query string).
// Per AWS: must escape per RFC 3986, with space as %20 (not +).
function uriEncodeStrict(str) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
}

function getAmzDate(now) {
  // Returns 20060102T150405Z and 20060102 (the credential scope date)
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  // iso is now "20060102T150405Z"
  return { amzDate: iso, dateStamp: iso.substring(0, 8) };
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  return kSigning;
}

// =============================================================================
// Presigned URL builder
// =============================================================================
// Builds a presigned URL for a given HTTP method + key + extra query params.
// Used for both GET (downloads) and PUT (uploads).
//
// expiresInSeconds: max 7 days (604800) per AWS Sig V4 spec
// extraQueryParams: object of additional query params to bake into the signature
//                   (e.g. response-content-disposition for forced downloads)
function buildPresignedUrl(method, key, expiresInSeconds, extraQueryParams) {
  const cfg = getConfig();
  const now = new Date();
  const dates = getAmzDate(now);
  const amzDate = dates.amzDate;
  const dateStamp = dates.dateStamp;

  const credentialScope = dateStamp + '/' + R2_REGION + '/' + R2_SERVICE + '/aws4_request';
  const credential = cfg.accessKeyId + '/' + credentialScope;

  // Canonical URI: /<bucket>/<encoded-key>
  // Per S3 path-style addressing; R2 supports both path-style and virtual-host
  // style, but path-style is more reliable and simpler.
  const canonicalUri = '/' + cfg.bucketName + '/' + uriEncodePath(key);

  // Build query params (these all get signed)
  const params = {};
  params['X-Amz-Algorithm'] = 'AWS4-HMAC-SHA256';
  params['X-Amz-Credential'] = credential;
  params['X-Amz-Date'] = amzDate;
  params['X-Amz-Expires'] = String(expiresInSeconds);
  params['X-Amz-SignedHeaders'] = 'host';
  if (extraQueryParams) {
    Object.keys(extraQueryParams).forEach(function (k) { params[k] = extraQueryParams[k]; });
  }

  // Canonical query string: sorted by key, URI-encoded
  const sortedKeys = Object.keys(params).sort();
  const canonicalQueryString = sortedKeys.map(function (k) {
    return uriEncodeStrict(k) + '=' + uriEncodeStrict(params[k]);
  }).join('&');

  // Canonical headers (just host for presigned URLs)
  const canonicalHeaders = 'host:' + cfg.host + '\n';
  const signedHeaders = 'host';

  // Payload hash: for presigned URLs we use "UNSIGNED-PAYLOAD" (the body
  // contents are not signed; only the URL is).
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');

  const signingKey = getSigningKey(cfg.secretAccessKey, dateStamp, R2_REGION, R2_SERVICE);
  const signature = hmacHex(signingKey, stringToSign);

  return cfg.endpoint + canonicalUri + '?' + canonicalQueryString + '&X-Amz-Signature=' + signature;
}

// =============================================================================
// Public API
// =============================================================================

// Generate a presigned URL for downloading an object.
// Forces Content-Disposition: attachment so the browser saves the file rather
// than rendering it inline (important for PDFs, images that creators sell).
//
// key: the object key in the bucket, e.g. "products/abc/file.pdf"
// expiresInSeconds: how long the URL is valid (default 5 minutes)
// downloadFilename: what filename the browser uses for the saved file
function r2SignedDownloadUrl(key, expiresInSeconds, downloadFilename) {
  const expires = expiresInSeconds || 300;
  const extra = {};
  if (downloadFilename) {
    // RFC 5987 / RFC 6266: filename* with UTF-8 encoding handles non-ASCII names.
    // Simple ASCII case: just use filename="...".
    // R2 honors response-content-disposition the same way S3 does.
    const safe = String(downloadFilename).replace(/"/g, '');
    extra['response-content-disposition'] = 'attachment; filename="' + safe + '"';
  }
  return buildPresignedUrl('GET', key, expires, extra);
}

// Generate a presigned URL for uploading an object via PUT.
// Browser PUTs the file body directly to R2 using this URL — file does NOT
// pass through Vercel (important: Vercel has a 4.5MB request body limit on
// most plans, and would charge bandwidth for the proxy hop anyway).
//
// key: where the object will be stored, e.g. "products/abc/file.pdf"
// expiresInSeconds: how long the URL is valid (default 10 minutes)
function r2SignedUploadUrl(key, expiresInSeconds) {
  const expires = expiresInSeconds || 600;
  return buildPresignedUrl('PUT', key, expires, null);
}

// Delete an object from R2. Server-side call (uses signed REST API, not a
// presigned URL).
async function r2DeleteObject(key) {
  const cfg = getConfig();
  const now = new Date();
  const dates = getAmzDate(now);
  const amzDate = dates.amzDate;
  const dateStamp = dates.dateStamp;

  const credentialScope = dateStamp + '/' + R2_REGION + '/' + R2_SERVICE + '/aws4_request';
  const canonicalUri = '/' + cfg.bucketName + '/' + uriEncodePath(key);
  const payloadHash = sha256Hex(''); // empty body for DELETE

  const canonicalHeaders =
    'host:' + cfg.host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + amzDate + '\n';
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'DELETE',
    canonicalUri,
    '', // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');

  const signingKey = getSigningKey(cfg.secretAccessKey, dateStamp, R2_REGION, R2_SERVICE);
  const signature = hmacHex(signingKey, stringToSign);

  const authHeader =
    'AWS4-HMAC-SHA256 ' +
    'Credential=' + cfg.accessKeyId + '/' + credentialScope + ', ' +
    'SignedHeaders=' + signedHeaders + ', ' +
    'Signature=' + signature;

  const res = await fetch(cfg.endpoint + canonicalUri, {
    method: 'DELETE',
    headers: {
      'Host': cfg.host,
      'Authorization': authHeader,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    }
  });

  // S3/R2 returns 204 No Content on successful delete, 404 if object didn't
  // exist (which we also treat as success — idempotent delete).
  if (res.status === 204 || res.status === 404) {
    return { ok: true, status: res.status };
  }
  const errBody = await res.text();
  return { ok: false, status: res.status, error: errBody };
}

module.exports = {
  r2SignedDownloadUrl: r2SignedDownloadUrl,
  r2SignedUploadUrl: r2SignedUploadUrl,
  r2DeleteObject: r2DeleteObject
};
