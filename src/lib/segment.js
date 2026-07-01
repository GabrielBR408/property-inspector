// Property Inspector — narrative-driven segmentation.
// Pure, no DOM — safe to import in Node (the self-check imports this directly).
//
// The report's structure EMERGES from the walkthrough narrative. This module
// turns free text (typed or dictated) into ordered sections, one per area the
// narrative actually names. Each section's text is a VERBATIM slice of the
// narrative (the sentences assigned to that area), and its condition rating is
// DERIVED from that slice — never invented.
//
// Dictation usually has NO periods, so a whole utterance can be one run-on
// "sentence". iOS speech recognition still capitalizes each new spoken sentence
// ("…fix that There is a leak…"), so we split a run-on unit at area-keyword
// TRANSITIONS whenever a real clause cue (a capitalized word or a strong starter
// like "there/then/next/and") sits between the two areas. If two area words share
// one clause with no cue between them ("a crack in the foundation wall"), we do
// NOT split — that avoids false sections for component words used as modifiers.
//
// GUARANTEES (asserted by scripts/self-check.mjs):
//   1. Every area the narrative mentions yields exactly one section (in order
//      of first mention); no section exists for an area the narrative never named.
//   2. Each section's text is faithful: every unit in it appears verbatim in the
//      narrative — no fabricated observations.
//   3. Ratings are derived from the section's own text, not invented.
//   4. Run-on, unpunctuated multi-area dictation splits into one section per area.

import { CONDITIONS } from './schema.js'

// --- Area vocabulary --------------------------------------------------------
// canonical display name -> list of aliases (lowercase, matched on word-ish
// boundaries). Order within the flat alias list is resolved by earliest match
// position, then longest alias, so "primary bath" beats "bath".
// Broad commercial + residential vocabulary. Multi-word aliases are fine — the
// anchor resolver prefers the earliest match and, at the same position, the
// longer alias, so "loading dock" beats "dock" and "engineers office" beats
// "office". The AI label pass can extend this at runtime (buildAliases extras).
const AREA_DEFS = [
  // Exterior / structure
  ['Roof', ['roof', 'roofing']],
  ['Rooftop', ['rooftop', 'roof deck', 'roof top']],
  ['Exterior', ['exterior', 'siding', 'facade', 'stucco', 'building envelope']],
  ['Foundation', ['foundation', 'crawl space', 'crawlspace']],
  ['Basement', ['basement', 'cellar', 'sub-basement', 'sublevel']],
  ['Attic', ['attic']],
  ['Mezzanine', ['mezzanine']],
  ['Garage', ['garage', 'carport']],
  ['Driveway', ['driveway']],
  ['Loading Dock', ['loading dock', 'loading bay', 'dock']],
  ['Deck / Patio', ['deck', 'patio', 'porch', 'balcony', 'terrace', 'veranda']],
  ['Yard', ['yard', 'lawn', 'landscaping', 'backyard', 'back yard', 'front yard', 'courtyard', 'grounds']],
  ['Parking', ['parking garage', 'parking structure', 'parking lot', 'parking']],
  // Circulation / entry
  ['Entry / Foyer', ['foyer', 'entryway', 'entrance', 'entry', 'front door', 'vestibule']],
  ['Lobby', ['elevator lobby', 'lobby']],
  ['Atrium', ['atrium']],
  ['Concourse', ['concourse']],
  ['Elevator', ['elevator', 'lift', 'escalator']],
  ['Hallway', ['hallway', 'corridor', 'stairwell', 'staircase', 'stairway', 'stairs', 'hall']],
  // Rooms — commercial
  ['Engineer\'s Office', ['engineer\'s office', 'engineers office', 'engineering office', 'engineering room']],
  ['Office', ['office', 'reception', 'reception area', 'front desk', 'cubicle', 'workstation']],
  ['Conference Room', ['conference room', 'meeting room', 'boardroom', 'board room']],
  ['Break Room', ['break room', 'breakroom', 'kitchenette', 'lunch room', 'lunchroom']],
  ['Restroom', ['restroom', 'rest room', 'washroom', 'men\'s room', 'mens room', 'women\'s room', 'womens room']],
  ['Server Room', ['server room', 'it room', 'data room', 'telecom room', 'idf', 'mdf']],
  ['Janitor Closet', ['janitor closet', 'janitorial', 'custodial closet', 'custodial']],
  ['Storage', ['storage room', 'storeroom', 'storage', 'supply room']],
  ['Common Area', ['common area', 'common room', 'amenity room', 'amenity']],
  ['Fitness Room', ['fitness center', 'fitness room', 'fitness', 'gym']],
  ['Pool', ['swimming pool', 'pool']],
  // Rooms — residential
  ['Living Room', ['living room', 'family room', 'great room']],
  ['Dining Room', ['dining room', 'dining area']],
  ['Kitchen', ['kitchen']],
  ['Primary Bathroom', ['primary bath', 'primary bathroom', 'master bath', 'master bathroom', 'ensuite', 'en-suite']],
  ['Bathroom', ['bathroom', 'bath', 'powder room', 'half bath']],
  ['Primary Bedroom', ['primary bedroom', 'master bedroom', 'primary suite', 'master suite']],
  ['Bedroom', ['bedroom']],
  ['Laundry', ['laundry', 'utility room']],
  ['Pantry / Closet', ['pantry', 'closet']],
  // Building systems
  ['Mechanical Room', ['mechanical room', 'mechanical', 'boiler room', 'boiler', 'utility closet']],
  ['Electrical Room', ['electrical room', 'electrical panel', 'electrical', 'breaker', 'wiring']],
  ['HVAC', ['hvac', 'furnace', 'air conditioner', 'air conditioning', 'ac unit', 'thermostat', 'rooftop unit', 'rtu']],
  ['Water Heater', ['water heater', 'hot water']],
  ['Plumbing', ['plumbing']],
  ['Windows', ['windows', 'window']],
  ['Fireplace', ['fireplace', 'chimney']]
]

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'area'
}

// Build the flat alias table, optionally augmented with extra area labels the
// LLM proposed. An extra label only ever produces a section if it actually
// appears in the narrative, so invented areas are impossible.
function buildAliases(extraLabels = []) {
  const flat = []
  for (const [area, aliases] of AREA_DEFS) {
    const key = slugify(area)
    for (const a of aliases) flat.push({ alias: a, area, key })
  }
  for (const label of extraLabels) {
    const clean = String(label || '').trim()
    if (!clean) continue
    const alias = clean.toLowerCase()
    if (flat.some((f) => f.alias === alias)) continue
    // Title-case the label for display.
    const area = clean.replace(/\b\w/g, (c) => c.toUpperCase())
    flat.push({ alias, area, key: slugify(clean) })
  }
  // Longest alias first so specific phrases win ties at the same index.
  flat.sort((a, b) => b.alias.length - a.alias.length)
  return flat
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// Position modifiers folded into an area name/key when they immediately precede
// an alias, so "south lobby" and "north lobby" become distinct sections named
// "South Lobby" / "North Lobby".
const MODIFIERS = new Set([
  'north', 'south', 'east', 'west', 'upstairs', 'downstairs', 'front', 'back', 'rear',
  'main', 'lower', 'upper', 'primary', 'master', 'guest', 'first', 'second', 'third',
  '1st', '2nd', '3rd', 'left', 'right'
])

// Strong clause-starter words that, like a capitalized word, mark a new clause
// mid-run-on. Used only to decide WHERE to split between two different areas.
const STRONG_STARTERS = new Set([
  'there', 'then', 'next', 'also', 'additionally', 'moving', 'move', 'heading', 'head',
  'over', 'now', 'finally', 'plus', 'and'
])

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }

// All non-overlapping area anchors in `text`, in order, with position modifiers
// captured. Each anchor: { start, end, area, key, name }.
function findAllAreas(text, aliases) {
  const lc = text.toLowerCase()
  const found = []
  for (const entry of aliases) {
    const re = new RegExp(`\\b${escapeRegExp(entry.alias)}\\b`, 'g')
    let m
    while ((m = re.exec(lc)) !== null) {
      found.push({ start: m.index, end: m.index + entry.alias.length, area: entry.area, key: entry.key, aliasLen: entry.alias.length })
    }
  }
  found.sort((a, b) => a.start - b.start || b.aliasLen - a.aliasLen)
  const anchors = []
  let lastEnd = -1
  for (const f of found) {
    if (f.start >= lastEnd) { anchors.push(f); lastEnd = f.end }
  }
  for (const a of anchors) {
    const before = text.slice(0, a.start)
    const mm = before.match(/([A-Za-z0-9]+)(\s+)$/)
    if (mm && MODIFIERS.has(mm[1].toLowerCase())) {
      a.start -= mm[0].length
      a.area = `${cap(mm[1].toLowerCase())} ${a.area}`
      a.key = slugify(`${mm[1]} ${a.key}`)
    }
    a.name = a.area
  }
  return anchors
}

// The first area anchor in a piece of text, or null.
function findArea(text, aliases) {
  const anchors = findAllAreas(text, aliases)
  return anchors.length ? anchors[0] : null
}

// Index of the LAST clause cue (capitalized word or strong starter) whose start
// lies in [from, to); -1 if none. Picking the last cue keeps follow-up text with
// the earlier area.
function lastCue(text, from, to) {
  const re = /\S+/g
  re.lastIndex = Math.max(0, from)
  let last = -1
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index >= to) break
    if (m.index < from) continue
    const w = m[0]
    const lw = w.toLowerCase().replace(/[^a-z]/g, '')
    if (/^[A-Z]/.test(w) || STRONG_STARTERS.has(lw)) last = m.index
  }
  return last
}

// Split one unit at area-keyword transitions that have a clause cue between them.
// No cue between two areas => no split (conservative; avoids "foundation wall").
function splitUnitAtAreaTransitions(unitText, aliases) {
  const anchors = findAllAreas(unitText, aliases)
  if (anchors.length < 2) return [unitText]
  const cuts = new Set([0, unitText.length])
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].key === anchors[i - 1].key) continue
    const cue = lastCue(unitText, anchors[i - 1].end, anchors[i].start)
    if (cue > 0) cuts.add(cue)
  }
  const bounds = [...cuts].sort((a, b) => a - b)
  const parts = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const p = unitText.slice(bounds[i], bounds[i + 1]).trim()
    if (p) parts.push(p)
  }
  return parts.length ? parts : [unitText]
}

// Split narrative into trimmed, non-empty sentences (verbatim substrings).
export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// --- Condition derivation ---------------------------------------------------
const COND_KEYWORDS = {
  Poor: ['poor', 'damaged', 'broken', 'leak', 'leaking', 'leaked', 'crack', 'cracked', 'cracking',
    'worn', 'deteriorat', 'needs repair', 'needs replacement', 'needs replacing', 'failing', 'failed',
    'rot', 'rotted', 'rotting', 'mold', 'mildew', 'soft spot', 'curling', 'missing', 'hazard', 'unsafe',
    'water damage', 'rust', 'rusted', 'rusting', 'clogged', 'inoperable', 'not working', 'does not work',
    "doesn't work", 'sagging', 'termite', 'corroded'],
  Fair: ['fair', 'aging', 'aged', 'minor', 'wear', 'dated', 'outdated', 'moderate', 'scuff', 'scuffed',
    'cosmetic', 'older', 'weathered', 'peeling', 'faded'],
  Good: ['good', 'excellent', 'brand new', 'recently replaced', 'recently updated', 'recently renovated',
    'updated', 'renovated', 'great', 'well maintained', 'well-maintained', 'no issues', 'no visible',
    'clean', 'functional', 'works well', 'like new', 'pristine', 'solid', 'new ']
}

export function deriveCondition(text) {
  const lc = ` ${String(text || '').toLowerCase()} `
  for (const level of ['Poor', 'Fair', 'Good']) {
    if (COND_KEYWORDS[level].some((k) => lc.includes(k))) return level
  }
  return 'N/A'
}

// --- Core segmentation ------------------------------------------------------
// Returns ordered sections: [{ key, area, name, text, condition }]. A leading
// 'general' section holds any text before the first named area (only if present).
export function segmentNarrative(text, extraLabels = []) {
  const aliases = buildAliases(extraLabels)

  // 1. Punctuation splits into sentences; 2. each is split at area-keyword
  //    transitions that carry a clause cue (handles unpunctuated dictation).
  const units = []
  for (const sentence of splitSentences(text)) {
    units.push(...splitUnitAtAreaTransitions(sentence, aliases))
  }

  const order = []          // section keys in first-mention order
  const byKey = new Map()   // key -> { key, area, name, parts: [] }
  let current = null        // current section key

  const ensure = (key, area, name) => {
    if (!byKey.has(key)) {
      byKey.set(key, { key, area, name: name || area, parts: [] })
      order.push(key)
    }
    return byKey.get(key)
  }

  for (const unit of units) {
    const hit = findArea(unit, aliases)
    if (hit) {
      current = hit.key
      ensure(hit.key, hit.area, hit.name).parts.push(unit)
    } else if (current) {
      byKey.get(current).parts.push(unit)
    } else {
      ensure('general', 'General Observations').parts.push(unit)
    }
  }

  return order.map((key) => {
    const s = byKey.get(key)
    const body = s.parts.join(' ')
    return { key: s.key, area: s.area, name: s.name, text: body, condition: deriveCondition(body) }
  })
}

// --- UI reconciliation ------------------------------------------------------
// Merge freshly-segmented sections with the previous UI state so user edits and
// attached photos survive re-segmentation as the narrative grows.
export function mergeSections(prev = [], fresh = [], makeId = (k) => `sec_${k}`) {
  const prevByKey = new Map(prev.map((p) => [p.key, p]))
  const freshByKey = new Map(fresh.map((f) => [f.key, f]))
  const out = []

  for (const f of fresh) {
    const p = prevByKey.get(f.key)
    if (p) {
      out.push({
        ...p,
        area: f.area,
        key: f.key,
        name: p.nameEdited ? p.name : f.area,
        text: p.textEdited ? p.text : f.text,
        condition: p.conditionEdited ? p.condition : f.condition
      })
    } else {
      out.push({
        id: makeId(f.key), key: f.key, area: f.area, name: f.area,
        text: f.text, condition: f.condition, photos: [],
        textEdited: false, conditionEdited: false, nameEdited: false
      })
    }
  }

  // Retain previously-created sections that carry photos but are no longer
  // referenced by the narrative, so a user never loses attached images.
  for (const p of prev) {
    if (!freshByKey.has(p.key) && (p.photos || []).length > 0) out.push(p)
  }
  return out
}

// Base-aware URL for the serverless endpoint. Under a sub-path deploy the app is
// built with a Vite `base` prefix, so import.meta.env.BASE_URL carries that
// prefix and the fetch routes correctly through a hub proxy. In Node (self-check)
// import.meta.env is undefined → falls back to '/'.
function apiUrl(path) {
  let base = '/'
  try {
    const env = import.meta && import.meta.env
    if (env && typeof env.BASE_URL === 'string') base = env.BASE_URL
  } catch (_e) { /* Node / self-check */ }
  return `${base}${path}`
}

// --- LLM analysis (faithfulness-safe) ---------------------------------------
// Calls the serverless /api/draft with the narrative and returns
// { sections, summary, source }. The LLM only proposes extra area labels and a
// summary; sections/text/ratings are always built deterministically here, so
// nothing the LLM returns can fabricate an area, observation, or rating.
export async function analyzeNarrative(report, { fetchImpl, makeId } = {}) {
  const narrative = report.walkthrough || ''
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  let llm = null

  if (doFetch && narrative.trim()) {
    try {
      const res = await doFetch(apiUrl('api/draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property: report.property, address: report.address,
          inspector: report.inspector, date: report.date, narrative
        })
      })
      if (res && res.ok) llm = await res.json()
    } catch (_e) { /* fall back to deterministic */ }
  }

  // Accumulate AI-proposed labels with any already discovered, so they keep
  // expanding LIVE segmentation (see App.jsx resegment) — not just this pass.
  const llmAreas = llm && Array.isArray(llm.areas) ? llm.areas.filter((a) => typeof a === 'string') : []
  const areas = [...new Set([...(report.aiAreas || []), ...llmAreas])]
  const fresh = segmentNarrative(narrative, areas)
  const merged = mergeSections(report.sections || [], fresh, makeId || ((k) => `sec_${k}`))
  const summary = (llm && typeof llm.summary === 'string' && llm.summary.trim())
    ? llm.summary.trim()
    : deterministicSummary(report, merged)

  return { sections: merged, summary, source: llm ? 'ai' : 'deterministic', areas }
}

// --- Summaries & tallies (section-based) ------------------------------------
export function tallyConditions(sections = []) {
  const t = { Good: 0, Fair: 0, Poor: 0, 'N/A': 0, total: 0 }
  for (const s of sections) {
    const c = CONDITIONS.includes(s.condition) ? s.condition : 'N/A'
    t[c] += 1
    t.total += 1
  }
  return t
}

export function deterministicSummary(report, sections = []) {
  const named = sections.filter((s) => s.key !== 'general')
  const t = tallyConditions(sections)
  const where = report.address || report.property || 'the property'
  const parts = []
  parts.push(`${report.inspector ? `${report.inspector} inspected` : 'Inspection of'} ${where}${report.date ? ` on ${report.date}` : ''}.`)
  if (named.length) {
    parts.push(`The walkthrough covered ${named.length} area${named.length === 1 ? '' : 's'}: ${named.map((s) => s.name).join(', ')}.`)
  } else {
    parts.push('No specific areas were identified in the walkthrough yet.')
  }
  const flags = []
  if (t.Poor) flags.push(`${t.Poor} rated Poor`)
  if (t.Fair) flags.push(`${t.Fair} rated Fair`)
  if (t.Good) flags.push(`${t.Good} rated Good`)
  if (flags.length) parts.push(`${flags.join(', ')}.`)
  if (t.Poor) parts.push('Areas rated Poor should be prioritized for follow-up.')
  return parts.join(' ')
}
