// Property Inspector — PDF export via jsPDF (narrative-driven).
// Renders the shared export model. `renderPdfLines` returns the ordered content
// fragments the PDF is built from (pure, no jsPDF) so the self-check can assert
// the PDF's content includes every section without parsing a binary PDF. The
// jsPDF renderer iterates the SAME fragments, so parity is guaranteed.

import { buildExportModel } from './exportModel.js'
import { dataUrlParts, dataUrlToBytes, imageSize, fitBox } from './imageMeta.js'

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
    lines.push({ text: `${section.name} — ${section.condition}`, kind: 'section', condition: section.condition, sectionName: section.name, key: section.key, followUp: !!section.followUp })
    if (section.text) lines.push({ text: section.text, kind: 'note' })
    if (section.photoCount > 0) lines.push({ text: `${section.photoCount} photo(s) attached`, kind: 'photo', photos: section.photos })
  }
  // Punch list: one numbered line per flagged section, at the end where a
  // contractor/vendor list normally lives. Exactly one 'followup' fragment per
  // flagged section, so the self-check can assert none are dropped or invented.
  const flagged = model.sections.filter((s) => s.followUp)
  if (flagged.length) {
    lines.push({ text: 'Follow-up / Punch list', kind: 'h2' })
    flagged.forEach((s, i) => {
      lines.push({
        text: `${i + 1}. ${s.name} (${s.condition})${s.text ? ` — ${s.text}` : ''}${s.photoCount ? ` [${s.photoCount} photo(s)]` : ''}`,
        kind: 'followup', key: s.key
      })
    })
  }
  return lines
}

// Build the actual jsPDF document from the shared model. Works in Node too, so
// the self-check can verify the REAL PDF bytes (not just the content model).
async function buildPdfDoc(reportOrModel) {
  const { jsPDF } = await import('jspdf')
  const model = reportOrModel.sections && reportOrModel.header ? reportOrModel : buildExportModel(reportOrModel)
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
      // A long (user-edited) section name would push the condition rating past
      // the right margin — printed invisible. Truncate the NAME with an
      // ellipsis so the rating always stays on the page; the full name is
      // still in the DOCX and on screen.
      const condW = doc.getTextWidth(`  ${ln.condition}`)
      let name = ln.sectionName
      if (doc.getTextWidth(name) + 8 + condW > maxW) {
        while (name.length > 1 && doc.getTextWidth(`${name}…`) + 8 + condW > maxW) name = name.slice(0, -1)
        name = `${name}…`
      }
      doc.setTextColor(...NAVY); doc.text(name, marginX, y)
      const nameW = doc.getTextWidth(name)
      const [r, g, b] = condColor(ln.condition)
      doc.setTextColor(r, g, b); doc.text(`  ${ln.condition}`, marginX + nameW + 8, y)
      if (ln.followUp) {
        // Inline marker so a flagged item is visible in place, not only on the
        // punch list. Width computed at the 13pt bold metrics used above.
        doc.setFontSize(9); doc.setTextColor(...ACCENT)
        doc.text('FOLLOW-UP', marginX + nameW + 8 + condW + 10, y)
      }
      y += 8
      doc.setDrawColor(227, 231, 236); doc.line(marginX, y, marginX + maxW, y); y += 12
    } else if (ln.kind === 'followup') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...NAVY)
      const wrapped = doc.splitTextToSize(ln.text, maxW)
      for (const w of wrapped) { ensure(14); doc.text(w, marginX, y); y += 14 }
      y += 4
    } else if (ln.kind === 'note') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED)
      const wrapped = doc.splitTextToSize(ln.text, maxW)
      for (const w of wrapped) { ensure(13); doc.text(w, marginX, y); y += 13 }
    } else if (ln.kind === 'photo') {
      const photos = ln.photos || []
      let px = marginX
      const thumb = 84
      const capH = 12 // caption line under each photo
      const renderable = photos.filter((p) => p && p.dataUrl)
      if (renderable.length === 0) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...MUTED)
        ensure(12); doc.text(ln.text, marginX, y); y += 14
      } else {
        ensure(thumb + capH + 8)
        // Track failures so a photo jsPDF can't decode is REPORTED, not silently
        // dropped (parity with the DOCX exporter's fallback note).
        let failed = photos.length - renderable.length
        for (const p of renderable) {
          // Validate BEFORE addImage: jsPDF does not throw on undecodable bytes,
          // it silently embeds garbage. Only PNG/JPEG with parseable dimensions
          // (i.e. a real header) are embeddable.
          const parts = dataUrlParts(p.dataUrl)
          const size = imageSize(dataUrlToBytes(p.dataUrl))
          if (!parts || !size || !/image\/(png|jpe?g)/.test(parts.mime)) { failed += 1; continue }
          if (px + thumb > marginX + maxW) { px = marginX; y += thumb + capH + 8; ensure(thumb + capH + 8) }
          try {
            const fmt = parts.mime.includes('png') ? 'PNG' : 'JPEG'
            // Preserve the photo's aspect ratio inside the thumb box.
            const { width, height } = fitBox(size, thumb, thumb)
            doc.addImage(p.dataUrl, fmt, px, y, width, height)
            doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...MUTED)
            doc.text(String(p.name || 'photo').slice(0, 22), px, y + thumb + 9)
            px += thumb + 8 // advance only on success — no blank gap for a failed embed
          } catch (_e) { failed += 1 }
        }
        y += thumb + capH + 10
        if (failed > 0) {
          doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...MUTED)
          ensure(12); doc.text(`${failed} photo(s) attached (could not be embedded)`, marginX, y); y += 14
        }
      }
    }
  }
  return doc
}

// Node/self-check: real PDF bytes for verification.
export async function pdfToArrayBuffer(reportOrModel) {
  const doc = await buildPdfDoc(reportOrModel)
  return doc.output('arraybuffer')
}

// Browser: build and download the PDF. Photos (dataUrls) are embedded when present.
export async function downloadPdf(report, filename = 'inspection-report.pdf') {
  const doc = await buildPdfDoc(report)
  doc.save(filename)
}
