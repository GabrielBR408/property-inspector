// Property Inspector — PDF export via jsPDF (narrative-driven).
// Renders the shared export model. `renderPdfLines` returns the ordered content
// fragments the PDF is built from (pure, no jsPDF) so the self-check can assert
// the PDF's content includes every section without parsing a binary PDF. The
// jsPDF renderer iterates the SAME fragments, so parity is guaranteed.

import { buildExportModel } from './exportModel.js'

const NAVY = [31, 41, 55]
const ACCENT = [71, 85, 105]
const MUTED = [107, 114, 128]

function condColor(condition) {
  if (condition === 'Poor') return [180, 69, 47]
  if (condition === 'Fair') return [154, 108, 16]
  if (condition === 'Good') return [31, 111, 68]
  return MUTED
}

// The ordered content fragments that make up the report body. Each section
// contributes exactly one 'section' fragment (carrying its name + condition),
// so the self-check can assert one-per-section with no extras/misses.
export function renderPdfLines(reportOrModel) {
  const model = reportOrModel.sections && reportOrModel.header ? reportOrModel : buildExportModel(reportOrModel)
  const lines = []
  lines.push({ text: 'Property Inspector', kind: 'brand' })
  lines.push({ text: model.header.title, kind: 'title' })
  lines.push({ text: `Property: ${model.header.property || '—'}`, kind: 'meta' })
  lines.push({ text: `Address: ${model.header.address || '—'}`, kind: 'meta' })
  lines.push({ text: `Inspector: ${model.header.inspector || '—'}`, kind: 'meta' })
  lines.push({ text: `Date: ${model.header.date || '—'}`, kind: 'meta' })
  if (model.summary) {
    lines.push({ text: 'Summary', kind: 'h2' })
    lines.push({ text: model.summary, kind: 'body' })
  }
  for (const section of model.sections) {
    lines.push({ text: `${section.name} — ${section.condition}`, kind: 'section', condition: section.condition, sectionName: section.name, key: section.key })
    if (section.text) lines.push({ text: section.text, kind: 'note' })
    if (section.photoCount > 0) lines.push({ text: `${section.photoCount} photo(s) attached`, kind: 'photo', photos: section.photos })
  }
  return lines
}

// Browser: build and download the PDF. Photos (dataUrls) are embedded when present.
export async function downloadPdf(report, filename = 'inspection-report.pdf') {
  const { jsPDF } = await import('jspdf')
  const model = buildExportModel(report)
  const lines = renderPdfLines(model)
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginX = 48
  const maxW = doc.internal.pageSize.getWidth() - marginX * 2
  const pageH = doc.internal.pageSize.getHeight()
  let y = 56

  const ensure = (h) => { if (y + h > pageH - 48) { doc.addPage(); y = 56 } }

  for (const ln of lines) {
    if (ln.kind === 'brand') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...ACCENT)
      ensure(16); doc.text(ln.text, marginX, y); y += 20
    } else if (ln.kind === 'title') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...NAVY)
      ensure(26); doc.text(ln.text, marginX, y); y += 28
    } else if (ln.kind === 'meta') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...NAVY)
      ensure(15); doc.text(ln.text, marginX, y); y += 15
    } else if (ln.kind === 'h2') {
      y += 10
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NAVY)
      ensure(20); doc.text(ln.text, marginX, y); y += 18
      doc.setDrawColor(227, 231, 236); doc.line(marginX, y - 6, marginX + maxW, y - 6)
    } else if (ln.kind === 'body') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...NAVY)
      const wrapped = doc.splitTextToSize(ln.text, maxW)
      for (const w of wrapped) { ensure(14); doc.text(w, marginX, y); y += 14 }
    } else if (ln.kind === 'section') {
      y += 10
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
      ensure(18)
      doc.setTextColor(...NAVY); doc.text(ln.sectionName, marginX, y)
      const [r, g, b] = condColor(ln.condition)
      doc.setTextColor(r, g, b); doc.text(`  ${ln.condition}`, marginX + doc.getTextWidth(ln.sectionName) + 8, y)
      y += 8
      doc.setDrawColor(227, 231, 236); doc.line(marginX, y, marginX + maxW, y); y += 12
    } else if (ln.kind === 'note') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED)
      const wrapped = doc.splitTextToSize(ln.text, maxW)
      for (const w of wrapped) { ensure(13); doc.text(w, marginX, y); y += 13 }
    } else if (ln.kind === 'photo') {
      const photos = ln.photos || []
      let px = marginX
      const thumb = 84
      const renderable = photos.filter((p) => p && p.dataUrl)
      if (renderable.length === 0) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...MUTED)
        ensure(12); doc.text(ln.text, marginX, y); y += 14
      } else {
        ensure(thumb + 8)
        for (const p of renderable) {
          if (px + thumb > marginX + maxW) { px = marginX; y += thumb + 8; ensure(thumb + 8) }
          try {
            const fmt = p.dataUrl.includes('image/png') ? 'PNG' : 'JPEG'
            doc.addImage(p.dataUrl, fmt, px, y, thumb, thumb)
          } catch (_e) { /* skip unrenderable */ }
          px += thumb + 8
        }
        y += thumb + 10
      }
    }
  }
  doc.save(filename)
}
