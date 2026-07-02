// Property Inspector — spoken "Report Details" parsing.
// Turns a dictated utterance ("Property is Maple Court, 123 Main St Unit 4,
// inspector Gabe Roberts, today") into { property, address, inspector, date }.
// Pure + deterministic (no DOM) so the self-check can exercise it in Node; an
// optional Anthropic pass fills any blanks when the key is set.
//
// GUARANTEE: never fabricates a value that was not spoken — an unmentioned field
// stays ''. Every field remains editable in the UI after auto-fill.

import { apiUrl } from './segment.js'

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december']

// Field cues. Each captures the cue phrase (+ optional "is/name/:") so the value
// starts right after it. Global + case-insensitive so we can find all anchors.
const CUES = [
  { field: 'inspector', re: /\b(?:inspected\s+by|inspector(?:'s)?(?:\s+name)?)\b\s*(?:is\b|:|-)?\s*/gi },
  { field: 'property', re: /\b(?:property(?:\s+name)?|building|site)\b\s*(?:is\b|:|-)?\s*/gi },
  { field: 'address', re: /\b(?:address|located\s+at|location)\b\s*(?:is\b|:|-)?\s*/gi }
]

const trimVal = (s) => String(s || '').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim()

// A clause looks like a street address if it starts with a street number.
function looksLikeAddress(s) {
  return /^\s*\d{1,6}\s+\S/.test(s)
}

// --- Date parsing -----------------------------------------------------------
function pad(n) { return String(n).padStart(2, '0') }
function isoFrom(y, m, d) { return `${y}-${pad(m)}-${pad(d)}` }

function shiftDay(todayIso, delta) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayIso || '')
  if (!m) return ''
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta)
  return isoFrom(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

// Find the first date expression in `text`. Returns { iso, index, length } or null.
export function extractDate(text, todayIso) {
  const lc = text.toLowerCase()
  const candidates = []
  const push = (re, toIso) => {
    const m = re.exec(lc)
    if (m) { const iso = toIso(m); if (iso) candidates.push({ iso, index: m.index, length: m[0].length }) }
  }
  const thisYear = /^(\d{4})-/.test(todayIso || '') ? Number(todayIso.slice(0, 4)) : new Date().getFullYear()

  push(/\btoday\b/, () => todayIso || '')
  push(/\btomorrow\b/, () => shiftDay(todayIso, 1))
  push(/\byesterday\b/, () => shiftDay(todayIso, -1))
  push(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => isoFrom(m[1], Number(m[2]), Number(m[3])))
  push(/\b(\d{1,2})[/](\d{1,2})[/](\d{2,4})\b/, (m) => {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return isoFrom(y, Number(m[1]), Number(m[2]))
  })
  push(new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`), (m) => {
    const mo = MONTHS.indexOf(m[1]) + 1
    return isoFrom(m[3] ? Number(m[3]) : thisYear, mo, Number(m[2]))
  })
  push(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})(?:,?\\s+(\\d{4}))?\\b`), (m) => {
    const mo = MONTHS.indexOf(m[2]) + 1
    return isoFrom(m[3] ? Number(m[3]) : thisYear, mo, Number(m[1]))
  })

  if (!candidates.length) return null
  candidates.sort((a, b) => a.index - b.index)
  return candidates[0]
}

// --- Deterministic parse ----------------------------------------------------
export function parseDetails(text, { today } = {}) {
  const out = { property: '', address: '', inspector: '', date: '' }
  if (!text || !text.trim()) return out

  // 1. Pull out a date expression and remove its span so it can't bleed into
  //    another field's value.
  let work = text
  const dm = extractDate(text, today)
  if (dm) {
    out.date = dm.iso
    // Also swallow a "date"/"dated"/"on" label immediately preceding the date so
    // it can't dangle onto the previous field's value.
    let start = dm.index
    const lab = /\b(?:date\s+is|date|dated|on)\s+$/i.exec(text.slice(0, start))
    if (lab) start = lab.index
    work = `${text.slice(0, start)} ${text.slice(dm.index + dm.length)}`
  }

  // 2. Collect cue anchors across the (date-removed) text.
  const anchors = []
  for (const cue of CUES) {
    cue.re.lastIndex = 0
    let m
    while ((m = cue.re.exec(work)) !== null) {
      anchors.push({ field: cue.field, start: m.index, valueStart: m.index + m[0].length })
      if (m.index === cue.re.lastIndex) cue.re.lastIndex++ // guard zero-width
    }
  }
  anchors.sort((a, b) => a.start - b.start)
  // Drop anchors that fall inside an earlier anchor's cue span (overlap).
  const kept = []
  let lastValueStart = -1
  for (const a of anchors) {
    if (a.start >= lastValueStart) { kept.push(a); lastValueStart = a.valueStart }
  }

  // 3. Preamble (before the first cue) → property, if it isn't an address.
  if (kept.length) {
    const pre = trimVal(work.slice(0, kept[0].start))
    if (pre && !looksLikeAddress(pre) && !out.property) out.property = pre
  } else {
    const pre = trimVal(work)
    if (pre) { looksLikeAddress(pre) ? (out.address = pre) : (out.property = pre) }
  }

  // 4. Each anchor's value runs to the next anchor.
  for (let i = 0; i < kept.length; i++) {
    const end = i + 1 < kept.length ? kept[i + 1].start : work.length
    const val = trimVal(work.slice(kept[i].valueStart, end))
    if (val && !out[kept[i].field]) out[kept[i].field] = val
  }

  // 5. If no address was cued, split any address-looking comma clause out of the
  //    property value (e.g. "Maple Court Apartments, 123 Main St Unit 4").
  if (!out.address && out.property.includes(',')) {
    const parts = out.property.split(',').map(trimVal).filter(Boolean)
    const addrParts = parts.filter(looksLikeAddress)
    if (addrParts.length && addrParts.length < parts.length) {
      out.address = addrParts.join(', ')
      out.property = parts.filter((p) => !looksLikeAddress(p)).join(', ')
    }
  }

  return out
}

// --- AI-enhanced parse (fills blanks only) ----------------------------------
// Runs the deterministic parse, then — if any field is still blank and the
// endpoint is reachable — asks the serverless parser to fill the gaps. AI values
// only ever fill BLANK fields; deterministic results always win. Falls back to
// deterministic on no key / error.
export async function parseDetailsSmart(text, { today, fetchImpl } = {}) {
  const base = parseDetails(text, { today })
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  const complete = base.property && base.address && base.inspector && base.date
  if (!doFetch || !text.trim() || complete) return { ...base, source: 'deterministic' }

  try {
    const res = await doFetch(apiUrl('api/parse-details'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: text, today })
    })
    if (res && res.ok) {
      const ai = await res.json()
      const pick = (b, a) => (b ? b : (typeof a === 'string' ? a.trim() : ''))
      return {
        property: pick(base.property, ai.property),
        address: pick(base.address, ai.address),
        inspector: pick(base.inspector, ai.inspector),
        date: pick(base.date, ai.date),
        source: 'ai'
      }
    }
  } catch (_e) { /* fall through */ }
  return { ...base, source: 'deterministic' }
}
