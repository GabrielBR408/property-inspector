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
  ['Suite', ['suite', 'tenant suite', 'tenant space']],
  ['Engineer\'s Office', ['engineer\'s office', 'engineers office', 'engineering office', 'engineering room']],
  ['Office', ['office', 'reception', 'reception area', 'front desk', 'cubicle', 'workstation']],
  ['Conference Room', ['conference room', 'meeting room', 'boardroom', 'board room']],
  ['Break Room', ['break room', 'breakroom', 'kitchenette', 'lunch room', 'lunchroom']],
  ['Coffee Shop', ['coffee shop', 'coffee bar', 'cafe']],
  ['Restaurant', ['restaurant', 'food court', 'diner']],
  ['Gift Shop', ['gift shop']],
  ['Retail', ['retail space', 'retail suite', 'retail']],
  ['Terminal', ['terminal']],
  ['Men\'s Restroom', ['men\'s restroom', 'mens restroom', 'men\'s room', 'mens room', 'men\'s bathroom', 'mens bathroom']],
  ['Women\'s Restroom', ['women\'s restroom', 'womens restroom', 'women\'s room', 'womens room', 'ladies room', 'ladies\' room', 'women\'s bathroom', 'womens bathroom', 'ladies bathroom']],
  ['Restroom', ['restroom', 'rest room', 'washroom']],
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
// Memoized: re-segmentation runs on every keystroke, so rebuilding + re-sorting
// the table (and re-compiling ~150 alias regexes in findAllAreas) each time was
// a per-keystroke cost that grew with narrative length. The table for a given
// extra-label set is immutable, so cache it (with a precompiled regex per alias).
const _aliasCache = new Map()
function buildAliases(extraLabels = []) {
  const cacheKey = JSON.stringify(extraLabels)
  const hit = _aliasCache.get(cacheKey)
  if (hit) return hit
  const flat = []
  for (const [area, aliases] of AREA_DEFS) {
    const key = slugify(area)
    for (const a of aliases) flat.push({ alias: a, area, key })
  }
  for (const label of extraLabels) {
    const clean = String(label || '').trim()
    if (!clean) continue
    const alias = clean.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\u00e9/g, 'e')
    if (flat.some((f) => f.alias === alias)) continue
    // Title-case the label for display.
    const area = clean.replace(/\b\w/g, (c) => c.toUpperCase())
    flat.push({ alias, area, key: slugify(clean) })
  }
  // Longest alias first so specific phrases win ties at the same index.
  flat.sort((a, b) => b.alias.length - a.alias.length)
  for (const entry of flat) entry.re = new RegExp(`\\b${escapeRegExp(entry.alias)}\\b`, 'g')
  if (_aliasCache.size > 32) _aliasCache.clear()
  _aliasCache.set(cacheKey, flat)
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

// Location-REFERENCE prepositions. An area word directly preceded by one of
// these ("three potholes near the entrance", "a leak above the break room") is
// a spatial reference inside the current observation, NOT a move to a new area
// — it must neither split the clause nor spawn a section. Deliberately excludes
// transition prepositions ("in", "on", "at", "to"): "in the kitchen" still
// anchors. Checked AFTER modifier folding so "near the east window" is caught.
const REF_PREP_RE = /\b(?:near|by|beside|behind|above|below|under|underneath|over|toward|towards|next\s+to|close\s+to|across\s+from|adjacent\s+to)\s+(?:the\s+|a\s+|an\s+)?$/i

// All non-overlapping area anchors in `text`, in order, with position modifiers
// captured. Each anchor: { start, end, area, key, name }.
function findAllAreas(text, aliases) {
  // iOS dictation emits curly apostrophes ("men\u2019s bathroom") and users type
  // "caf\u00e9" — normalize to the straight/ASCII forms the alias table uses. Every
  // replacement is 1 char -> 1 char, so anchor indexes stay aligned with `text`.
  const lc = text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\u00e9/g, 'e')
  const found = []
  for (const entry of aliases) {
    const re = entry.re // precompiled in buildAliases; shared, so reset state
    re.lastIndex = 0
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
    // Fold a trailing unit designator into a Suite anchor, so "suite 210" and
    // "suite 200" become DISTINCT sections named "Suite 210" / "Suite 200".
    if (a.key === 'suite') {
      // Letter designators: any case (dictation lowercases), but NOT lowercase
      // "a"/"i" — those are almost always the article/pronoun ("in the suite a
      // leak was found"), not a suite letter.
      const after = text.slice(a.end).match(/^\s+(\d{1,5}[A-Za-z]?|[A-Z]|[b-hj-z])\b/)
      if (after) {
        a.end += after[0].length
        a.area = `Suite ${after[1].toUpperCase()}`
        a.key = slugify(a.area)
      }
    }
    const before = text.slice(0, a.start)
    const mm = before.match(/([A-Za-z0-9]+)(\s+)$/)
    if (mm && MODIFIERS.has(mm[1].toLowerCase())) {
      a.start -= mm[0].length
      a.area = `${cap(mm[1].toLowerCase())} ${a.area}`
      a.key = slugify(`${mm[1]} ${a.key}`)
    }
    a.name = a.area
  }
  // Drop anchors that are location references, not area transitions.
  return anchors.filter((a) => !REF_PREP_RE.test(text.slice(0, a.start)))
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
// EXPLICIT self-rating phrases: when the inspector states the condition directly
// ("is fair", "in good condition", "excellent"), that wins over an incidental
// defect noun elsewhere in the sentence ("...but there's some cracking"). Ordered
// worst-first so a stated bad rating still dominates a stated good one.
const EXPLICIT_RE = [
  ['Poor', /\b(in poor condition|poor condition|is (?:in )?poor|in bad condition|bad condition|is bad|is damaged|is broken|non[- ]?functional|not functional)\b/g],
  ['Fair', /\b(in fair condition|fair condition|is (?:in )?fair|adequate|serviceable|passable)\b/g],
  ['Good', /\b(in (?:good|great|excellent) condition|(?:good|great|excellent) condition|is (?:in )?(?:good|great|excellent)|in good shape|good shape|excellent|pristine|like new|well[- ]maintained|no issues|works well|fully functional)\b/g]
]

// Incidental keyword scan (fallback), matched with WORD BOUNDARIES so "dated"
// does not fire inside "updated"/"outdated". Scanned worst-severity first.
const COND_KEYWORDS = {
  Poor: ['poor', 'damaged', 'broken', 'leak', 'leaking', 'leaked', 'leaks', 'crack', 'cracked', 'cracking', 'cracks',
    'worn', 'deteriorated', 'deteriorating', 'deterioration', 'needs repair', 'needs replacement', 'needs replacing',
    'failing', 'failed', 'rot', 'rotted', 'rotting', 'rotten', 'mold', 'mildew', 'soft spot', 'curling', 'missing',
    'hazard', 'hazardous', 'unsafe', 'water damage', 'rust', 'rusted', 'rusting', 'corroded', 'corrosion', 'clogged',
    'inoperable', 'not working', 'does not work', "doesn't work", 'sagging', 'termite', 'loose', 'jammed', 'seized',
    'stuck', 'warped', 'warping', 'bent', 'torn', 'frayed', 'hole', 'holes', 'spalling', 'efflorescence',
    'blistered', 'blistering', 'settling', 'pothole', 'potholes'],
  Fair: ['fair', 'aging', 'aged', 'minor', 'wear', 'dated', 'outdated', 'moderate', 'scuff', 'scuffed', 'cosmetic',
    'older', 'weathered', 'peeling', 'faded', 'discolored', 'discoloration', 'stained', 'staining', 'stain',
    'loud', 'noisy', 'dented', 'dent', 'dents', 'chipped', 'chip', 'chips', 'chipping', 'scratched', 'scratches',
    'scratch', 'dingy', 'dirty', 'grimy', 'dull', 'sticking', 'sticks', 'fading', 'ponding'],
  Good: ['good', 'excellent', 'brand new', 'recently replaced', 'recently updated', 'recently renovated', 'updated',
    'renovated', 'great', 'well maintained', 'well-maintained', 'no issues', 'no visible', 'clean', 'functional',
    'works well', 'like new', 'pristine', 'solid', 'new']
}

const _wordReCache = new Map()
function wordRe(k) {
  let re = _wordReCache.get(k)
  if (!re) { re = new RegExp(`\\b${escapeRegExp(k)}\\b`, 'g'); _wordReCache.set(k, re) }
  return re
}

// Negation guard: a cue directly preceded (within ~2 words) by a negator is a
// statement of ABSENCE ("no water damage", "not broken") and must not fire.
// Includes the do/did/will/can/has family of contractions — "the roof doesn't
// leak" is the single most common way inspectors dictate a PASSING check, and
// it must not rate Poor. Apostrophe-less variants cover dictation engines that
// drop the apostrophe entirely.
const NEGATOR_WINDOW_RE = /\b(?:no|not|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|doesn't|doesnt|don't|dont|didn't|didnt|won't|wont|can't|cant|cannot|couldn't|couldnt|wouldn't|wouldnt|shouldn't|shouldnt|hasn't|hasnt|haven't|havent|hadn't|hadnt|without|never|free\s+of|free\s+from)\s+(?:\w+\s+){0,2}$/
function isNegated(lc, index) {
  return NEGATOR_WINDOW_RE.test(lc.slice(0, index))
}

// A NEGATED good-rating ("not in good condition", "isn't looking great") is a
// stated downgrade — rate Fair, never let the embedded "good" read as Good.
const NEGATED_GOOD_RE = /\b(?:not|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|doesn't|doesnt|don't|dont|didn't|didnt|no\s+longer)\s+(?:\w+\s+){0,2}?(?:in\s+)?(?:good|great|excellent|pristine|well[- ]maintained|like\s+new)\b/

// First non-negated match of `re` in `lc`, or null.
function unnegatedMatch(lc, re) {
  re.lastIndex = 0
  let m
  const global = re.global
  while ((m = re.exec(lc)) !== null) {
    if (!isNegated(lc, m.index)) return m
    if (!global) return null // non-global regex: only the first match is visible
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return null
}

export function deriveCondition(text) {
  // Normalize curly apostrophes: iOS dictation emits "isn\u2019t broken", and the
  // negation regexes match the straight-quote forms — without this, a dictated
  // negation silently fails and the defect noun rates Poor.
  const lc = ` ${String(text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'")} `
  // 1. Explicit self-rating wins over incidental defect words. A stated Poor
  //    still dominates; a negated Good ("not in good condition") rates Fair.
  const explicitPoor = EXPLICIT_RE[0]
  if (unnegatedMatch(lc, explicitPoor[1])) return 'Poor'
  if (NEGATED_GOOD_RE.test(lc)) return 'Fair'
  for (const [level, re] of EXPLICIT_RE.slice(1)) { if (unnegatedMatch(lc, re)) return level }
  // 2. Fallback: incidental keywords (word-boundary), worst severity first,
  //    skipping negated occurrences ("no water damage" is not damage).
  for (const level of ['Poor', 'Fair', 'Good']) {
    for (const k of COND_KEYWORDS[level]) {
      if (unnegatedMatch(lc, wordRe(k))) return level
    }
  }
  return 'N/A'
}

// Key of the LAST area mentioned in the text (by position), or null. Used to
// attribute an unfiled photo to the area currently being discussed, rather than
// to whichever section happens to be last in first-mention order.
export function lastMentionedKey(text, extraLabels = []) {
  const anchors = findAllAreas(String(text || ''), buildAliases(extraLabels))
  return anchors.length ? anchors[anchors.length - 1].key : null
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
        textEdited: false, conditionEdited: false, nameEdited: false,
        followUp: false
      })
    }
  }

  // Retain previously-created sections that are no longer referenced by the
  // narrative but carry user work — photos OR any user edit (text, name,
  // condition) OR a follow-up flag — so re-segmentation never destroys
  // something the user did.
  for (const p of prev) {
    const hasUserWork = (p.photos || []).length > 0 || p.textEdited || p.nameEdited || p.conditionEdited || p.followUp
    if (!freshByKey.has(p.key) && hasUserWork) out.push(p)
  }
  return out
}

// --- Removed-section suppression ---------------------------------------------
// The user removed a section explicitly; re-segmentation must not resurrect it
// on the next keystroke. Each entry is { key, at, h } where `at` is the
// narrative length at removal time and `h` a cheap hash of the narrative at
// that moment. An entry stays active (still suppresses) until the narrative
// mentions that area again AT OR AFTER `at` — i.e. the user talking about the
// area anew revives it, but the text that existed at removal doesn't.
//
// The position rule only means something while the text it referred to is
// still there. If the narrative was cleared, shortened past the removal point,
// or rewritten (prefix hash no longer matches), positions from the old text
// are meaningless — any mention of the area then counts as a new mention and
// revives it. Without this, removing a section and then clearing/retyping the
// walkthrough suppressed that area FOREVER (typing "kitchen…" produced no
// Kitchen section, which reads as silent data loss).

// djb2 — tiny, deterministic, good enough to detect "this text was rewritten".
export function prefixHash(s) {
  let h = 5381
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0
  return h
}

export function effectiveRemovedKeys(removedKeys = [], narrative = '', extraLabels = []) {
  const list = (removedKeys || []).filter((r) => r && r.key)
  if (!list.length) return []
  const text = String(narrative || '')
  const anchors = findAllAreas(text, buildAliases(extraLabels))
  return list.filter((r) => {
    const at = r.at || 0
    // Legacy entries (no h) can only check length; new entries verify content.
    const prefixIntact = text.length >= at && (r.h === undefined || prefixHash(text.slice(0, at)) === r.h)
    if (prefixIntact) return !anchors.some((a) => a.key === r.key && a.start >= at)
    // Prefix gone/rewritten: the removal referred to text that no longer
    // exists — any current mention of the area revives it.
    return !anchors.some((a) => a.key === r.key)
  })
}

// Base-aware URL for the serverless endpoint. Under a sub-path deploy the app is
// built with a Vite `base` prefix, so import.meta.env.BASE_URL carries that
// prefix and the fetch routes correctly through a hub proxy. In Node (self-check)
// import.meta.env is undefined → falls back to '/'.
export function apiUrl(path) {
  let base = '/'
  try {
    // Reference the single env key directly. Vite inlines just this string
    // literal; referencing `import.meta.env` as a whole object would inline the
    // ENTIRE env (incl. Vercel system vars like VITE_VERCEL_BRANCH_URL) into the
    // bundle. In Node (self-check) import.meta.env is undefined → this throws and
    // we fall back to '/'.
    const b = import.meta.env.BASE_URL
    if (typeof b === 'string') base = b
  } catch (_e) { /* Node / self-check */ }
  return `${base}${path}`
}

// --- Background area scan (faithfulness-safe) --------------------------------
// Asks the serverless endpoint for area LABELS ONLY across the whole narrative.
// Same guarantee as the Draft pass: a returned label is merely vocabulary — it
// yields a section only if it actually appears verbatim in the narrative, so
// the AI can never inject an area. Returns [] on any failure (offline, no key,
// rate-limited) — the deterministic directory keeps working regardless.
export async function proposeAreaLabels(narrative, { fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  const text = String(narrative || '')
  if (!doFetch || !text.trim()) return []
  try {
    const res = await doFetch(apiUrl('api/draft'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narrative: text, labelsOnly: true })
    })
    if (!res || !res.ok) return []
    const data = await res.json()
    return Array.isArray(data.areas) ? data.areas.filter((a) => typeof a === 'string') : []
  } catch (_e) { return [] }
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
  // Respect user-removed sections here too, or Draft would resurrect them.
  const removed = effectiveRemovedKeys(report.removedKeys || [], narrative, areas)
  const fresh = segmentNarrative(narrative, areas).filter((s) => !removed.some((r) => r.key === s.key))
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
  const fu = sections.filter((s) => s.followUp).length
  if (fu) parts.push(`${fu} item${fu === 1 ? '' : 's'} flagged for follow-up (see punch list).`)
  if (t.Poor) parts.push('Areas rated Poor should be prioritized for follow-up.')
  return parts.join(' ')
}
