// Property Inspector — domain schema.
// Pure data + constants. No DOM, no browser APIs — safe to import in Node
// (the headless self-check imports this directly).
//
// The report structure is NARRATIVE-DRIVEN: sections emerge from the walkthrough
// text (see segment.js). There are no pre-defined areas/items anymore.

// Condition ratings, Happy Inspector-style. These are the ONLY legal ratings.
// A section's rating is DERIVED from its narrative slice (segment.js
// deriveCondition), or edited by the user — never fabricated by the AI.
export const CONDITIONS = ['Good', 'Fair', 'Poor', 'N/A']
export const DEFAULT_CONDITION = 'N/A'

export function isValidCondition(c) {
  return CONDITIONS.includes(c)
}

// Monotonic id helper for photos and any UI-created ids that need uniqueness.
let _seq = 0
export function makeId(prefix = 'i') {
  _seq += 1
  return `${prefix}_${_seq}_${(_seq * 2654435761 % 100000).toString(36)}`
}

// A fresh, empty report. Sections start empty and appear as the walkthrough is
// dictated/typed.
export function newReport(header = {}) {
  return {
    property: header.property || '',
    address: header.address || '',
    inspector: header.inspector || '',
    date: header.date || '',
    walkthrough: '', // the narrative; sections are derived from this
    summary: '',
    sections: [], // [{ id, key, area, name, text, condition, photos, *Edited flags }]
    aiAreas: [], // AI-proposed area labels; extend LIVE segmentation vocabulary
    removedKeys: [] // [{ key, at }] sections the user removed; suppresses re-detection (segment.js effectiveRemovedKeys)
  }
}
