// Vercel serverless function — POST /api/draft.
// Narrative-driven: given the inspector's walkthrough narrative, returns
//   { areas: ["kitchen", "primary bath", ...], summary: "..." }
// where `areas` are VERBATIM area/place phrases the narrative names (the client
// uses these only to detect sections — it always builds each section's text as a
// real slice of the narrative and derives ratings itself), and `summary` is a
// short prose overview.
//
// The client (src/lib/segment.js) treats `areas` as extra vocabulary: a label
// only yields a section if it actually appears in the narrative, so the AI can
// never invent an area, observation, or rating. When ANTHROPIC_API_KEY is unset
// or the call fails, we return no areas + a deterministic summary and the client
// segments deterministically.
//
// Set ANTHROPIC_API_KEY in the Vercel project env to enable the AI pass.

export const config = { api: { bodyParser: true } }

const SYSTEM_PROMPT =
  'You extract structure from a property inspector\'s spoken walkthrough. ' +
  'Given the narrative, do TWO things and return STRICT JSON: ' +
  '{"areas": [..], "summary": ".."}. ' +
  '"areas": the list of distinct rooms/areas/places the narrative EXPLICITLY names ' +
  '(e.g. "kitchen", "roof", "primary bath", "garage", "mudroom"), as short lowercase ' +
  'phrases copied verbatim from the narrative, in order of first mention. ' +
  'Do NOT include an area the narrative does not name. Do NOT invent areas. ' +
  '"summary": one short paragraph overview of the property\'s condition based ONLY on ' +
  'what the narrative says — do not add findings, figures, or areas that are not in the narrative.'

function deterministicSummary(body) {
  const where = body.address || body.property || 'the property'
  const parts = []
  parts.push(`${body.inspector ? `${body.inspector} inspected` : 'Inspection of'} ${where}${body.date ? ` on ${body.date}` : ''}.`)
  parts.push('Summary generated from the walkthrough narrative.')
  return parts.join(' ')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Allow', 'POST')
    return res.end(JSON.stringify({ error: 'Method not allowed' }))
  }
  const body = req.body || {}
  // Cap inputs: this endpoint is publicly reachable, so unbounded text would be
  // an open invitation to burn API credits. A real walkthrough fits well inside
  // 16k chars; header fields inside 200.
  const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
  const narrative = clip(body.narrative, 16000)
  body.property = clip(body.property, 200)
  body.address = clip(body.address, 200)
  body.inspector = clip(body.inspector, 200)
  body.date = clip(body.date, 40)
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey || !narrative.trim()) {
    return json(res, 200, { areas: [], summary: deterministicSummary(body), source: 'deterministic' })
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const userContent =
      JSON.stringify({ property: body.property, address: body.address, inspector: body.inspector, date: body.date, narrative }) +
      '\n\nReturn ONLY the JSON object described in the system prompt.'

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }]
    })

    const text = (response.content && response.content[0] && response.content[0].text) || ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    let parsed
    try { parsed = JSON.parse(jsonText) } catch (_e) { parsed = null }
    if (!parsed || typeof parsed !== 'object') {
      return json(res, 200, { areas: [], summary: deterministicSummary(body), source: 'deterministic' })
    }
    return json(res, 200, {
      areas: Array.isArray(parsed.areas) ? parsed.areas.filter((a) => typeof a === 'string').slice(0, 40) : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : deterministicSummary(body),
      source: 'ai'
    })
  } catch (err) {
    console.log('[draft] API call failed — deterministic fallback:', String(err && err.message ? err.message : err))
    return json(res, 200, { areas: [], summary: deterministicSummary(body), source: 'deterministic' })
  }
}

function json(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}
