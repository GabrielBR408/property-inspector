// Best-effort per-IP rate limit for the public AI endpoints. Both /api/draft
// and /api/parse-details are reachable by anyone and spend Anthropic credits,
// so a runaway client (or a hostile loop) shouldn't be able to hammer them.
//
// This is IN-MEMORY, per serverless instance — Vercel may run several
// instances, each with its own window, so this is a soft deterrent, not a hard
// guarantee. That's the right trade for this app: no extra infra, and the
// client already degrades gracefully on a 429 (falls back to deterministic
// output), so a limited user loses nothing but the AI polish.

const WINDOW_MS = 10 * 60 * 1000 // 10-minute sliding window
const MAX_PER_WINDOW = 60 // covers background area scans during heavy dictation; hostile loops still hit it fast

const hits = new Map() // ip -> [timestamps]

export function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  return (req.socket && req.socket.remoteAddress) || 'unknown'
}

// Returns true when the request is allowed; false when the caller should 429.
export function allowRequest(ip, now = Date.now()) {
  const cutoff = now - WINDOW_MS
  const list = (hits.get(ip) || []).filter((t) => t > cutoff)
  if (list.length >= MAX_PER_WINDOW) { hits.set(ip, list); return false }
  list.push(now)
  hits.set(ip, list)
  // Cap the map so a scan across many IPs can't grow memory unbounded.
  if (hits.size > 5000) hits.clear()
  return true
}

export function tooMany(res) {
  res.statusCode = 429
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Retry-After', '600')
  res.end(JSON.stringify({ error: 'Too many requests — try again in a few minutes.' }))
}
