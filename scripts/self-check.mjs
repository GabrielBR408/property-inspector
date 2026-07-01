// Property Inspector — headless self-check (narrative-driven model).
// Drives segmentation, the AI-sanitizing analysis path, and both export
// renderers, asserting hard invariants. Executes for real (unzips the generated
// DOCX, inspects the PDF content model) and exits non-zero on ANY failure.
//
//   node scripts/self-check.mjs

import zlib from 'node:zlib'
import { CONDITIONS } from '../src/lib/schema.js'
import {
  segmentNarrative, splitSentences, deriveCondition, analyzeNarrative,
  tallyConditions, deterministicSummary
} from '../src/lib/segment.js'
import { buildExportModel, exportSectionKeys } from '../src/lib/exportModel.js'
import { renderPdfLines } from '../src/lib/exportPdf.js'
import { docxToBuffer } from '../src/lib/exportDocx.js'

let passed = 0
const failures = []
function assert(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim()
function faithful(narrative, sectionText) {
  const N = norm(narrative)
  return splitSentences(sectionText).every((sent) => N.includes(norm(sent)))
}

// --- Synthetic walkthrough narrative ----------------------------------------
// Names five areas in order; each carries a distinct, verbatim observation with
// a condition cue. It deliberately does NOT mention a garage/pool/attic.
const NARRATIVE =
  'Starting outside, the roof was recently replaced and is in good shape. ' +
  'The kitchen countertops are worn and the faucet is leaking. ' +
  'In the primary bath the vanity is dated with minor wear. ' +
  'The basement shows a crack in the foundation wall and some water damage. ' +
  'Finally, the living room paint is dated but clean.'

const EXPECTED_KEYS = ['roof', 'kitchen', 'primarybathroom', 'basement', 'livingroom']
const EXPECTED_COND = { roof: 'Good', kitchen: 'Poor', primarybathroom: 'Fair', basement: 'Poor', livingroom: 'Fair' }
const NOT_MENTIONED = ['garage', 'attic', 'pool', 'swimming pool', 'bedroom']

const baseReport = {
  property: 'Maple Court #4', address: '123 Main St, Unit 4',
  inspector: 'Jordan Vega', date: '2026-07-01',
  walkthrough: NARRATIVE, summary: '', sections: []
}

// ---------------------------------------------------------------------------
console.log('\n[1] Sections match narrated areas exactly, in first-mention order')
{
  const secs = segmentNarrative(NARRATIVE)
  const keys = secs.map((s) => s.key)
  assert('exactly the mentioned areas, in order', JSON.stringify(keys) === JSON.stringify(EXPECTED_KEYS), keys.join(','))
  assert('one section per mentioned area (no duplicates)', new Set(keys).size === keys.length)
  for (const nm of NOT_MENTIONED) assert(`no section for un-mentioned "${nm}"`, !keys.includes(nm.replace(/\s+/g, '')))
  assert('every section has a display name', secs.every((s) => s.name && s.name.length > 0))
}

console.log('\n[2] Each section\'s text is a faithful, verbatim slice of the narrative')
{
  const secs = segmentNarrative(NARRATIVE)
  for (const s of secs) assert(`"${s.name}" text is verbatim from narrative`, faithful(NARRATIVE, s.text), s.text)
  // And the specific observation lands in the right section (no cross-attribution).
  const byKey = Object.fromEntries(secs.map((s) => [s.key, s]))
  assert('kitchen slice mentions the faucet, not the roof', /faucet/.test(byKey.kitchen.text) && !/roof/.test(byKey.kitchen.text))
  assert('basement slice mentions the foundation crack', /crack in the foundation/.test(byKey.basement.text))
}

console.log('\n[3] Ratings are DERIVED from each section\'s own text (not invented)')
{
  const secs = segmentNarrative(NARRATIVE)
  for (const s of secs) {
    assert(`${s.key} rating is legal`, CONDITIONS.includes(s.condition))
    assert(`${s.key} rating matches its narrated cue (${EXPECTED_COND[s.key]})`, s.condition === EXPECTED_COND[s.key], s.condition)
  }
  // deriveCondition is text-driven: no cue => N/A.
  assert('no condition cue yields N/A', deriveCondition('The hallway leads to the bedrooms.') === 'N/A')
  assert('a damage cue yields Poor', deriveCondition('there is a leak here') === 'Poor')
}

console.log('\n[4] AI pass cannot invent an area, observation, or rating')
{
  // A misbehaving model: proposes a real extra area ("garage" — NOT in narrative),
  // an invented area ("wine cellar"), and a bogus summary. The client must ignore
  // any label the narrative doesn\'t actually contain.
  const evilFetch = async () => ({
    ok: true,
    json: async () => ({ areas: ['garage', 'wine cellar', 'swimming pool'], summary: 'Everything is pristine.' })
  })
  const { sections, summary, source } = await analyzeNarrative(baseReport, { fetchImpl: evilFetch, makeId: (k) => `sec_${k}` })
  assert('used the AI path', source === 'ai')
  const keys = sections.map((s) => s.key)
  assert('no invented area entered the report', !keys.some((k) => ['garage', 'winecellar', 'swimmingpool', 'pool'].includes(k)), keys.join(','))
  assert('sections still equal the narrated areas', JSON.stringify(keys) === JSON.stringify(EXPECTED_KEYS), keys.join(','))
  for (const s of sections) assert(`${s.key} text still faithful after AI pass`, faithful(NARRATIVE, s.text))
  for (const s of sections) assert(`${s.key} rating still derived (${EXPECTED_COND[s.key]})`, s.condition === EXPECTED_COND[s.key], s.condition)
  assert('AI summary is accepted (prose only)', summary === 'Everything is pristine.')
}

console.log('\n[5] AI-proposed label that IS in the narrative can add a section')
{
  // "mudroom" is not in the base vocabulary; if the narrative names it and the
  // model surfaces it, it should become a faithful section.
  const rep = { ...baseReport, walkthrough: NARRATIVE + ' The mudroom floor is cracked.', sections: [] }
  const okFetch = async () => ({ ok: true, json: async () => ({ areas: ['mudroom'], summary: 'ok' }) })
  const { sections } = await analyzeNarrative(rep, { fetchImpl: okFetch, makeId: (k) => `sec_${k}` })
  const mud = sections.find((s) => s.key === 'mudroom')
  assert('narrated + AI-surfaced "mudroom" becomes a section', !!mud)
  assert('mudroom text is faithful', mud && faithful(rep.walkthrough, mud.text))
  assert('mudroom rating derived from its text (Poor)', mud && mud.condition === 'Poor', mud && mud.condition)
}

console.log('\n[6] Deterministic fallback (no AI) segments + summarizes')
{
  const { sections, summary, source } = await analyzeNarrative(baseReport, { fetchImpl: async () => ({ ok: false }), makeId: (k) => `sec_${k}` })
  assert('fell back to deterministic', source === 'deterministic')
  assert('sections equal narrated areas', JSON.stringify(sections.map((s) => s.key)) === JSON.stringify(EXPECTED_KEYS))
  assert('summary is non-empty', typeof summary === 'string' && summary.length > 20)
  assert('summary lists a detected area', summary.includes('Kitchen'))
}

console.log('\n[7] Export model + DOCX + PDF contain every derived section')
let model
{
  const secs = segmentNarrative(NARRATIVE).map((s) => ({ ...s, id: `sec_${s.key}`, photos: s.key === 'kitchen' ? [{ id: 'p1', name: 'k.jpg', dataUrl: 'data:image/jpeg;base64,/9j/AA' }] : [] }))
  const report = { ...baseReport, sections: secs, summary: deterministicSummary(baseReport, secs) }
  model = buildExportModel(report)

  assert('export keys equal narrated areas, in order', JSON.stringify(exportSectionKeys(model)) === JSON.stringify(EXPECTED_KEYS))
  assert('export sectionCount matches', model.sectionCount === EXPECTED_KEYS.length, String(model.sectionCount))
  assert('export photoCount matches', model.photoCount === 1, String(model.photoCount))

  const buf = await docxToBuffer(model)
  assert('docx is a real non-trivial buffer', Buffer.isBuffer(buf) && buf.length > 1000, String(buf.length))
  const xml = unzipEntry(buf, 'word/document.xml')
  for (const s of model.sections) assert(`docx contains section "${s.name}"`, xml.includes(s.name))
  for (const s of model.sections) assert(`docx shows ${s.key} rating (${s.condition})`, xml.includes(s.condition))
  assert('docx contains a narrated observation (faucet)', xml.includes('faucet'))
  assert('docx does NOT contain an un-mentioned area (garage)', !xml.toLowerCase().includes('garage'))

  const lines = renderPdfLines(model)
  const secLines = lines.filter((l) => l.kind === 'section')
  assert('one PDF section fragment per section', secLines.length === EXPECTED_KEYS.length, String(secLines.length))
  for (const s of model.sections) assert(`PDF renders section "${s.name}"`, secLines.some((l) => l.sectionName === s.name))
  assert('PDF section fragments carry a legal rating', secLines.every((l) => CONDITIONS.includes(l.condition)))
  const photoLines = lines.filter((l) => l.kind === 'photo')
  assert('PDF emits a photo block for the section with a photo', photoLines.length === 1, String(photoLines.length))
}

console.log('\n[8] Run-on, UNPUNCTUATED multi-area dictation splits into one section per area')
{
  // The real iPhone repro: no periods; iOS capitalizes the new spoken sentence.
  const REPRO = 'The south lobby has trees growing in it so have Billy fix that There is a leak in the basement'
  const secs = segmentNarrative(REPRO)
  const keys = secs.map((s) => s.key)
  assert('splits into exactly two sections', secs.length === 2, keys.join(','))
  assert('sections are South Lobby then Basement', JSON.stringify(keys) === JSON.stringify(['southlobby', 'basement']), keys.join(','))
  const byKey = Object.fromEntries(secs.map((s) => [s.key, s]))
  assert('South Lobby text is the lobby clause (with follow-up), verbatim',
    byKey.southlobby && byKey.southlobby.text === 'The south lobby has trees growing in it so have Billy fix that',
    byKey.southlobby && byKey.southlobby.text)
  assert('Basement text is the basement clause, verbatim',
    byKey.basement && byKey.basement.text === 'There is a leak in the basement',
    byKey.basement && byKey.basement.text)
  assert('both slices are faithful to the narrative', secs.every((s) => faithful(REPRO, s.text)))
  assert('Basement observation did NOT leak into South Lobby', !/leak in the basement/.test(byKey.southlobby.text))
  assert('South Lobby display name carries the modifier', byKey.southlobby.name === 'South Lobby', byKey.southlobby.name)
  assert('basement rating derived (Poor from "leak")', byKey.basement.condition === 'Poor', byKey.basement.condition)

  // Regression guard: a component word inside one clause must NOT split (no cue).
  const oneClause = segmentNarrative('The basement shows a crack in the foundation wall and some water damage.')
  assert('component word "foundation" does not spawn a false section', oneClause.length === 1 && oneClause[0].key === 'basement', oneClause.map((s) => s.key).join(','))
}

// --- Minimal ZIP entry reader ----------------------------------------------
function unzipEntry(buf, name) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break } }
  if (eocd < 0) throw new Error('EOCD not found')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdCount = buf.readUInt16LE(eocd + 10)
  let p = cdOffset
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const fname = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (fname === name) {
      const lhNameLen = buf.readUInt16LE(localOffset + 26)
      const lhExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
      const comp = buf.subarray(dataStart, dataStart + compSize)
      return method === 0 ? comp.toString('utf8') : zlib.inflateRawSync(comp).toString('utf8')
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${name} not found in zip`)
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(64))
if (failures.length) {
  console.log(`FAIL — ${passed} passed, ${failures.length} failed:`)
  for (const f of failures) console.log(`   ✗ ${f}`)
  console.log('='.repeat(64))
  process.exit(1)
}
console.log(`PASS — all ${passed} assertions held. Sections come only from the narrative; nothing is invented.`)
console.log('='.repeat(64))
process.exit(0)
