// Shared per-IP rate limiter for Vercel API routes.
//
// In-memory, per lambda instance: counters reset on cold starts and are not
// shared across concurrent instances, so treat limits as approximate. That
// is the right tradeoff here: the goal is stopping floods, scripts, and
// abuse loops cheaply, with zero added latency and no database writes.
// Endpoints with strict global quotas (the AI endpoints) use their own
// database-backed system and do not use this.
//
// Usage inside a handler, first line:
//   if (require('./lib/rate-limit').tooMany(req, res, 'endpoint-name', 30, 60000)) return;
// (name, max requests, window in ms). Sends 429 with Retry-After when over.

const buckets = new Map();

function tooMany(req, res, name, limit, windowMs) {
  try {
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      (req.socket && req.socket.remoteAddress) || 'unknown';
    const key = name + '|' + ip;
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter(function (t) { return now - t < windowMs; });
    if (hits.length >= limit) {
      buckets.set(key, hits);
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: 'Too many requests. Please slow down and try again.' });
      return true;
    }
    hits.push(now);
    buckets.set(key, hits);
    // Housekeeping so a long-lived instance cannot grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) {
        if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
      }
    }
    return false;
  } catch (e) {
    // The limiter must never take an endpoint down.
    return false;
  }
}

module.exports = { tooMany };
