#!/usr/bin/env node
// verify-sri.mjs
// Scans the repo for <script src="https://cdn.jsdelivr.net/..."> tags that
// carry a Subresource Integrity (integrity="sha384-...") attribute, fetches the
// real file from the CDN, recomputes the hash, and confirms it matches.
//
// Why this exists: the version in the URL and the hash in the integrity
// attribute are two separate strings kept in sync by hand. If one changes and
// the other does not, the browser BLOCKS the script and the page silently
// breaks (it only shows up when someone loads that page). This check turns that
// silent break into a loud red X on the commit, before anyone hits it live.
//
// Exit codes:
//   0  all hashes valid (or only unreachable URLs, which warn but do not fail)
//   1  at least one hash MISMATCH (a real, will-break-in-browser problem)
//
// No dependencies. Requires Node 18+ (global fetch, built-in crypto).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_EXTS = new Set(['.html', '.js']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', '.vercel', 'dist']);
const FETCH_ATTEMPTS = 3;

// ------------------------------------------------------------------
// Walk the repo collecting candidate files.
// ------------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (SCAN_EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------
// Pull jsDelivr <script> tags that have both src and integrity.
// Handles attribute order (src before or after integrity).
// ------------------------------------------------------------------
function findTags(file) {
  let txt;
  try { txt = readFileSync(file, 'utf8'); } catch { return []; }
  const tags = [];
  const tagRe = /<script\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(txt)) !== null) {
    const tag = m[0];
    if (!/cdn\.jsdelivr\.net/i.test(tag)) continue;
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    const integrity = (tag.match(/\bintegrity\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (src && integrity) tags.push({ file: relative(ROOT, file), src, integrity });
  }
  return tags;
}

// ------------------------------------------------------------------
// Fetch bytes with a few retries (so a transient CDN blip does not
// produce a false failure).
// ------------------------------------------------------------------
async function fetchBytes(url) {
  let lastErr;
  for (let i = 0; i < FETCH_ATTEMPTS; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

// integrity attr can list several hashes (space separated) and algorithms.
// SRI passes if ANY listed hash matches. Returns array of {algo, value}.
function parseIntegrity(integrity) {
  return integrity.trim().split(/\s+/).map(tok => {
    const dash = tok.indexOf('-');
    if (dash === -1) return null;
    return { algo: tok.slice(0, dash).toLowerCase(), value: tok.slice(dash + 1) };
  }).filter(Boolean);
}

const NODE_ALGO = { sha256: 'sha256', sha384: 'sha384', sha512: 'sha512' };

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
const files = walk(ROOT);
const allTags = files.flatMap(findTags);

if (allTags.length === 0) {
  console.log('verify-sri: no jsDelivr <script> tags with integrity found. Nothing to check.');
  process.exit(0);
}

// Group by unique URL+integrity so we fetch each resource once.
const cache = new Map(); // key: src + '|' + integrity -> { status, detail }
const results = [];

for (const tag of allTags) {
  const key = tag.src + '|' + tag.integrity;
  let verdict = cache.get(key);
  if (!verdict) {
    verdict = await verifyOne(tag.src, tag.integrity);
    cache.set(key, verdict);
  }
  results.push({ ...tag, ...verdict });
}

async function verifyOne(src, integrity) {
  const expected = parseIntegrity(integrity);
  if (expected.length === 0) {
    return { status: 'MISMATCH', detail: 'integrity attribute could not be parsed' };
  }
  let buf;
  try {
    buf = await fetchBytes(src);
  } catch (e) {
    return { status: 'UNREACHABLE', detail: String(e && e.message || e) };
  }
  const computed = {};
  for (const { algo } of expected) {
    if (!NODE_ALGO[algo]) continue;
    if (!computed[algo]) computed[algo] = createHash(NODE_ALGO[algo]).update(buf).digest('base64');
  }
  const matched = expected.some(e => computed[e.algo] && computed[e.algo] === e.value);
  if (matched) return { status: 'OK', detail: '' };
  // Build a helpful remediation line with the correct hash(es).
  const correct = Object.entries(computed).map(([a, v]) => `${a}-${v}`).join(' ');
  return {
    status: 'MISMATCH',
    detail: `expected ${expected.map(e => e.algo + '-' + e.value).join(' ')} but file hashes to ${correct || '(no supported algo in integrity)'}`,
  };
}

// ------------------------------------------------------------------
// Report
// ------------------------------------------------------------------
let mismatches = 0, unreachable = 0, ok = 0;
console.log('verify-sri: checking ' + results.length + ' pinned jsDelivr script reference(s)\n');
for (const r of results) {
  if (r.status === 'OK') { ok++; console.log(`  OK         ${r.file}\n             ${r.src}`); }
  else if (r.status === 'UNREACHABLE') { unreachable++; console.log(`  WARN       ${r.file}\n             ${r.src}\n             could not fetch: ${r.detail}`); }
  else { mismatches++; console.log(`  MISMATCH   ${r.file}\n             ${r.src}\n             ${r.detail}`); }
  console.log('');
}

console.log(`Summary: ${ok} ok, ${mismatches} mismatch, ${unreachable} unreachable.`);
if (mismatches > 0) {
  console.log('\nA MISMATCH means the browser will BLOCK that script (blank/stuck page).');
  console.log('Fix: update the integrity="" to the correct hash shown above, or repin the version, then re-run.');
  process.exit(1);
}
if (unreachable > 0) {
  console.log('\nNote: unreachable URLs were not verified (likely a transient network issue). They do not fail the build.');
}
process.exit(0);
