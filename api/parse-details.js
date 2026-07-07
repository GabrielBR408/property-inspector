// Vercel serverless function — POST /api/parse-details.
// Parses a dictated "Report Details" utterance into { property, address,
// inspector, date } using Anthropic. Used only as a FALLBACK/ENHANCER: the
// client parses deterministically first and calls this to fill any remaining
// blanks. When ANTHROPIC_API_KEY is unset (or on any error) it returns empty
// fields and the client keeps its deterministic result.
//
// The model is instructed to NEVER invent a value that was not spoken — an
// unmentioned field must come back as "".

import { allowRequest, clientIp, tooMany } from './_ratelimit.js'

export const config = { api: { bodyParser: true } }

const SYSTEM_PROMPT =
  'You extract report header fields from an inspector\'s spoken sentence. ' +
  'Return STRICT JSON: {"property":"","address":"","inspector":"","date":""}. ' +
  'property = building/property name; address = street address; inspector = person\'s name; ' +
  'date = ISO YYYY-MM-DD. Resolve "today"/"tomorrow"/"yesterday" relative to the provided ' +
  'todayIso. If a field was not spoken, return an empty string for it — NEVER invent or guess ' +
  'a value that is not clearly present in the transcript.'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Allow', 'POST')
    return res.end(JSON.stringify({ error: 'Method not allowed' }))
  }
  if (!allowRequest(clientIp(req))) return tooMany(res)
  const body = req.body || {}
  // Cap inputs — publicly reachable endpoint; a dictated details utterance is
  // a sentence or two, never kilobytes.
  const transcript = typeof body.transcript === 'string' ? body.transcript.slice(0, 2000) : ''
  const todayIso = typeof body.today === 'string' ? body.today.slice(0, 40) : ''
  const apiKey = process.env.ANTHROPIC_API_KEY
  const empty = { property: '', address: '', inspector: '', date: '', source: 'deterministic' }

  if (!apiKey || !transcript.trim()) return json(res, 200, empty)

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `todayIso=${todayIso}\ntranscript=${JSON.stringify(transcript)}\n\nReturn ONLY the JSON object.` }]
    })
    const text = (response.content && response.content[0] && response.content[0].text) || ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    let parsed
    try { parsed = JSON.parse(jsonText) } catch (_e) { parsed = null }
    if (!parsed || typeof parsed !== 'object') return json(res, 200, empty)
    const s = (v) => (typeof v === 'string' ? v.trim() : '')
    return json(res, 200, {
      property: s(parsed.property), address: s(parsed.address),
      inspector: s(parsed.inspector), date: s(parsed.date), source: 'ai'
    })
  } catch (err) {
    console.log('[parse-details] API call failed:', String(err && err.message ? err.message : err))
    return json(res, 200, empty)
  }
}

function json(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}
