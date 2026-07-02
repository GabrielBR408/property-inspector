// Property Inspector — editable DOCX export (narrative-driven).
// Builds a Word document from the shared export model. `buildDocxDocument` is
// pure (no DOM) so the self-check can pack it to a Buffer in Node and unzip to
// verify every section is present. The browser download helper is separate.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun
} from 'docx'
import { buildExportModel } from './exportModel.js'
import { dataUrlParts, dataUrlToBytes, imageSize, fitBox } from './imageMeta.js'

const NAVY = '1F2937'
const ACCENT = '475569'
const MUTED = '6B7280'

function headerLine(label, value) {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: NAVY }),
      new TextRun({ text: value || '—', color: NAVY })
    ]
  })
}

function condColor(condition) {
  if (condition === 'Poor') return 'B4452F'
  if (condition === 'Fair') return '9A6C10'
  if (condition === 'Good') return '1F6F44'
  return MUTED
}

export function buildDocxDocument(reportOrModel) {
  const model = reportOrModel.sections && reportOrModel.header ? reportOrModel : buildExportModel(reportOrModel)
  const children = []

  children.push(new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: 'Property Inspector', bold: true, color: ACCENT, size: 20 })]
  }))
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: model.header.title, color: NAVY })]
  }))

  children.push(headerLine('Property', model.header.property))
  children.push(headerLine('Address', model.header.address))
  children.push(headerLine('Inspector', model.header.inspector))
  children.push(headerLine('Date', model.header.date))

  if (model.summary) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 200 },
      children: [new TextRun({ text: 'Summary', color: NAVY })]
    }))
    children.push(new Paragraph({ children: [new TextRun({ text: model.summary })] }))
  }

  if (model.sections.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'No areas identified from the walkthrough.', italics: true, color: MUTED })] }))
  }

  for (const section of model.sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 40 },
      children: [
        new TextRun({ text: section.name, color: NAVY }),
        new TextRun({ text: `   ${section.condition}`, bold: true, color: condColor(section.condition), size: 20 })
      ]
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: section.text || '—' })]
    }))
    if (section.photoCount > 0) {
      // Embed each photo (with a caption) so the owner-facing document carries
      // the images themselves, not just a count. Unembeddable photos fall back
      // to the count line so nothing is silently lost.
      let embedded = 0
      for (const p of section.photos || []) {
        try {
          const parts = dataUrlParts(p && p.dataUrl)
          const bytes = dataUrlToBytes(p && p.dataUrl)
          // Only PNG/JPEG with a parseable header embed reliably; anything else
          // (e.g. webp that failed downscale) falls through to the count note
          // instead of risking a corrupt document.
          const size = imageSize(bytes)
          if (!parts || !bytes || !size || !/image\/(png|jpe?g)/.test(parts.mime)) continue
          const type = parts.mime.includes('png') ? 'png' : 'jpg'
          const { width, height } = fitBox(size, 280, 210)
          children.push(new Paragraph({
            spacing: { before: 80 },
            children: [new ImageRun({ type, data: bytes, transformation: { width, height } })]
          }))
          children.push(new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: `${section.name} — ${p.name || 'photo'}`, italics: true, color: MUTED, size: 16 })]
          }))
          embedded += 1
        } catch (_e) { /* skip unrenderable photo; counted below */ }
      }
      if (embedded < section.photoCount) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${section.photoCount - embedded} photo(s) attached (could not be embedded)`, italics: true, color: MUTED, size: 18 })]
        }))
      }
    }
  }

  return new Document({ sections: [{ children }] })
}

// Node: return a Buffer. Used by the self-check.
export async function docxToBuffer(reportOrModel) {
  return Packer.toBuffer(buildDocxDocument(reportOrModel))
}

// Browser: trigger a download.
export async function downloadDocx(report, filename = 'inspection-report.docx') {
  const blob = await Packer.toBlob(buildDocxDocument(report))
  triggerDownload(blob, filename)
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
