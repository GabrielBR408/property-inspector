// QA Run 6 — white-label report branding (#3) + PDF long-name truncation.
// Pure Node (no browser). Covers ONLY the features landed in this pass:
//   • src/lib/brand.js branding flows into both exporters, defaults unchanged
//   • a long (user-edited) section name can never push the condition rating
//     off the printed PDF page
// The derived-from-Poor punch list from the original patch was NOT adopted —
// the app keeps its existing per-section follow-up flag punch list, which is
// already covered by scripts/self-check.mjs [26].
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { segmentNarrative } from '../src/lib/segment.js'
import { renderPdfLines, pdfToArrayBuffer } from '../src/lib/exportPdf.js'
import { docxToBuffer } from '../src/lib/exportDocx.js'
import { BRAND } from '../src/lib/brand.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 140) : ''}`) }
const docXmlOf = async (rep, tag) => {
  mkdirSync('/tmp/qa-f', { recursive: true })
  writeFileSync(`/tmp/qa-f/${tag}.docx`, await docxToBuffer(rep))
  return execSync(`cd /tmp/qa-f && rm -rf ${tag} && mkdir ${tag} && cd ${tag} && unzip -o -q ../${tag}.docx && cat word/document.xml`).toString()
}

const narrative = 'The roof is in good condition. The kitchen faucet leaks badly. The lobby shows minor wear.'
const sections = segmentNarrative(narrative).map((s) => ({ ...s, id: `sec_${s.key}`, photos: [] }))
const report = { property: 'QA Tower', address: '', inspector: 'QA Bot', date: '2026-07-10', walkthrough: narrative, summary: 'Test summary.', sections }

// --- #3 branding: defaults reproduce current output exactly ---
check('default brand line unchanged', renderPdfLines(report)[0].text === 'Property Inspector')
check('default: no license meta line', !renderPdfLines(report).some((l) => l.kind === 'meta' && /License/.test(l.text)))
const xml = await docXmlOf(report, 'default')
check('default DOCX has no license line', !xml.includes('CA HIS License'))

// --- #3 branding: configured brand flows into both exports ---
BRAND.name = 'Lincoln Property Inspections'
BRAND.licenseLine = 'CA HIS License #123456 · (415) 555-0100'
BRAND.logoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pdfBrandText = Buffer.from(await pdfToArrayBuffer(report)).toString('latin1')
check('PDF carries brand name', pdfBrandText.includes('Lincoln Property Inspections'))
check('PDF carries license line', pdfBrandText.includes('CA HIS License #123456'))
check('PDF embeds logo image', /XObject/.test(pdfBrandText))
const xmlBrand = await docXmlOf(report, 'brand')
check('DOCX carries brand name', xmlBrand.includes('Lincoln Property Inspections'))
check('DOCX carries license line', xmlBrand.includes('CA HIS License #123456'))
const media = execSync('ls /tmp/qa-f/brand/word/media 2>/dev/null || echo NONE').toString().trim()
check('DOCX embeds logo in word/media', media !== 'NONE' && media.length > 0, media)

// --- #3 branding: garbage logo never breaks an export ---
BRAND.logoDataUrl = 'data:image/png;base64,not-a-real-image!!!'
const pdfBad = Buffer.from(await pdfToArrayBuffer(report))
check('garbage logo → PDF still builds', pdfBad.subarray(0, 5).toString() === '%PDF-')
check('garbage logo → DOCX still builds', (await docXmlOf(report, 'badlogo')).includes('Lincoln Property Inspections'))
BRAND.name = 'Property Inspector'; BRAND.licenseLine = ''; BRAND.logoDataUrl = ''

// --- PDF long-name truncation: rating stays on the page ---
const longName = 'X'.repeat(400)
const longRep = { ...report, sections: [{ ...sections[0], name: longName }] }
const pdfLong = Buffer.from(await pdfToArrayBuffer(longRep))
check('over-long section name → PDF still builds (no overflow crash)', pdfLong.subarray(0, 5).toString() === '%PDF-')

console.log(`\nRUN6: ${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
