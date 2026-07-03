import React, { useEffect, useRef, useState } from 'react'
import SectionCard from './components/SectionCard.jsx'
import VoiceButton from './components/VoiceButton.jsx'
import { newReport } from './lib/schema.js'
import { fileToPhoto } from './lib/db.js'
import { segmentNarrative, mergeSections, analyzeNarrative, tallyConditions, lastMentionedKey, effectiveRemovedKeys } from './lib/segment.js'
import { downloadPdf } from './lib/exportPdf.js'
import { downloadDocx } from './lib/exportDocx.js'
import { saveReport, loadReport, clearReport } from './lib/db.js'
import { registerPWA } from './pwa/registerUpdate.js'
import { parseDetails, parseDetailsSmart } from './lib/details.js'
import { track } from './lib/track.js'

// LOCAL calendar date — not toISOString(), which is UTC and rolls to tomorrow
// during evening inspections in any timezone west of Greenwich.
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const sectionId = (key) => `sec_${key}`

// Re-segment the narrative and merge with existing sections so live edits and
// photos survive. Runs deterministically on every keystroke/dictation — no network.
// AI-proposed labels (report.aiAreas) extend the LIVE vocabulary so multi-word
// areas surfaced by a prior Draft (e.g. "loading dock") keep splitting as you talk.
// Sections the user removed stay removed (report.removedKeys) until the area is
// mentioned anew AFTER the removal point — so a deleted section doesn't
// resurrect on the next keystroke, but talking about the area again revives it.
function resegment(report, narrative) {
  const labels = report.aiAreas || []
  const removed = effectiveRemovedKeys(report.removedKeys || [], narrative, labels)
  const fresh = segmentNarrative(narrative, labels).filter((s) => !removed.some((r) => r.key === s.key))
  return mergeSections(report.sections || [], fresh, sectionId)
}

export default function App() {
  const [report, setReport] = useState(() => newReport({ date: todayISO() }))
  const [drafting, setDrafting] = useState(false)
  const [draftMsg, setDraftMsg] = useState('')
  const [exporting, setExporting] = useState('')
  const [exportMsg, setExportMsg] = useState('')
  const [update, setUpdate] = useState(null)
  const loaded = useRef(false)
  const lastSectionCount = useRef(0)
  // Always-current report for callbacks that fire from async browser events
  // (e.g. speech-recognition onend), where a render closure could be stale.
  const reportRef = useRef(report)
  useEffect(() => { reportRef.current = report }, [report])

  useEffect(() => {
    track('app_opened')
    loadReport().then((saved) => {
      if (saved && saved.sections) setReport(saved)
      loaded.current = true
    })
    const dispose = registerPWA((apply) => setUpdate(() => apply))
    return dispose
  }, [])

  // Fire once per change in detected-section count (not on every keystroke).
  useEffect(() => {
    if (report.sections.length !== lastSectionCount.current) {
      lastSectionCount.current = report.sections.length
      track('sections_detected', { count: report.sections.length })
    }
  }, [report.sections.length])

  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(() => saveReport(report), 400)
    return () => clearTimeout(t)
  }, [report])

  const setHeader = (patch) => setReport((r) => ({ ...r, ...patch }))

  // --- Dictate the top "Report Details" fields --------------------------------
  // Fill only the fields actually spoken; never clobber an existing value with a
  // blank, and everything stays editable. Deterministic parse runs live on each
  // chunk; an optional AI pass fills any remaining blanks when dictation stops.
  const detailsTranscript = useRef('')
  const applyDetails = (p) => setReport((r) => ({
    ...r,
    property: p.property || r.property,
    address: p.address || r.address,
    inspector: p.inspector || r.inspector,
    date: p.date || r.date
  }))
  const onDetailsChunk = (chunk) => {
    detailsTranscript.current = `${detailsTranscript.current} ${chunk}`.trim()
    applyDetails(parseDetails(detailsTranscript.current, { today: todayISO() }))
  }
  const onDetailsStop = async () => {
    const t = detailsTranscript.current
    detailsTranscript.current = ''
    if (!t) return
    try {
      // Pass the on-screen values so the AI enhancer can only fill fields that
      // are blank everywhere — it can never replace what the user typed. Read
      // via ref: this fires from recognition onend, after the last chunk's
      // state update, which a render closure would not yet see.
      const cur = reportRef.current
      const current = { property: cur.property, address: cur.address, inspector: cur.inspector, date: cur.date }
      const p = await parseDetailsSmart(t, { today: todayISO(), current })
      applyDetails(p)
    } catch (_e) { /* deterministic fill already applied live */ }
  }

  // Walkthrough edits drive the section list.
  const setWalkthrough = (text) =>
    setReport((r) => ({ ...r, walkthrough: text, sections: resegment(r, text) }))

  const appendWalkthrough = (chunk) =>
    setReport((r) => {
      const sep = r.walkthrough && !r.walkthrough.endsWith(' ') ? ' ' : ''
      const text = `${r.walkthrough || ''}${sep}${chunk}`.trim()
      return { ...r, walkthrough: text, sections: resegment(r, text) }
    })

  const setSection = (id, next) =>
    setReport((r) => ({ ...r, sections: r.sections.map((s) => (s.id === id ? next : s)) }))
  const removeSection = (id) => {
    const target = report.sections.find((s) => s.id === id)
    if (!target) return
    const hasWork = (target.photos || []).length > 0 || target.textEdited || target.nameEdited
    if (hasWork && !window.confirm(`Remove "${target.name}"? Its photos and edits will be discarded.`)) return
    setReport((r) => ({
      ...r,
      sections: r.sections.filter((s) => s.id !== id),
      // Record the removal so re-segmentation doesn't resurrect the section.
      removedKeys: [...(r.removedKeys || []), { key: target.key, at: (r.walkthrough || '').length }]
    }))
  }

  // Unfiled photo → most recent section, or a General bucket if none yet.
  const addUnfiledPhoto = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const photos = []
    for (const f of files) { try { photos.push(await fileToPhoto(f)) } catch (_e) { /* skip */ } }
    if (!photos.length) return
    setReport((r) => {
      const sections = [...r.sections]
      // Attribute to the area currently being discussed (last one mentioned in the
      // walkthrough), NOT whichever section is last in first-mention order.
      const key = lastMentionedKey(r.walkthrough || '', r.aiAreas || [])
      let idx = key ? sections.findIndex((s) => s.key === key) : -1
      if (idx < 0) {
        // No current area → a General bucket (reuse if one already exists).
        idx = sections.findIndex((s) => s.key === 'general')
        if (idx < 0) {
          sections.push({ id: sectionId('general'), key: 'general', area: 'General Observations', name: 'General Observations', text: '', condition: 'N/A', photos: [], textEdited: false, conditionEdited: false, nameEdited: false })
          idx = sections.length - 1
        }
      }
      sections[idx] = { ...sections[idx], photos: [...(sections[idx].photos || []), ...photos] }
      return { ...r, sections }
    })
  }

  const onDraft = async () => {
    setDrafting(true); setDraftMsg('')
    try {
      const { sections, summary, source, areas } = await analyzeNarrative(report, { makeId: sectionId })
      // Persist AI-proposed labels so they extend LIVE segmentation going forward.
      setReport((r) => ({ ...r, sections, summary, aiAreas: areas || r.aiAreas }))
      setDraftMsg(source === 'ai'
        ? 'Drafted with AI — sections and summary generated. Everything below is editable.'
        : 'Drafted offline (deterministic) — sections and summary generated. Everything below is editable.')
      track('draft_generated', { source: source === 'ai' ? 'ai' : 'deterministic' })
    } catch (_e) {
      setDraftMsg('Could not draft — please try again.')
      track('error', { reason: 'draft_failed' })
    } finally { setDrafting(false) }
  }

  const onExport = async (kind) => {
    setExporting(kind)
    setExportMsg('')
    try {
      const base = (report.property || report.address || 'inspection').replace(/[^\w.-]+/g, '_').slice(0, 40)
      if (kind === 'pdf') await downloadPdf(report, `${base}.pdf`)
      else await downloadDocx(report, `${base}.docx`)
      track(kind === 'pdf' ? 'export_pdf' : 'export_docx')
    } catch (e) {
      // Shown at the export buttons (not the Draft card) so the user sees it.
      setExportMsg(`Export failed: ${String(e && e.message ? e.message : e)}`)
      track('error', { reason: 'export_failed' })
    } finally { setExporting('') }
  }

  const onReset = async () => {
    if (!window.confirm('Start a new inspection? This clears the current one.')) return
    await clearReport()
    loaded.current = false
    setReport(newReport({ date: todayISO() }))
    setDraftMsg('')
    loaded.current = true
  }

  const unfiledRef = useRef(null)
  const named = report.sections.filter((s) => s.key !== 'general')
  // Tally the same set the "areas detected" count describes.
  const t = tallyConditions(named)

  return (
    <main className="page">
      {update && (
        <div className="update-banner">
          <span className="update-banner-text">A new version is available.</span>
          <button className="update-banner-btn" onClick={() => update()}>Reload</button>
          <button className="update-banner-dismiss" onClick={() => setUpdate(null)}>×</button>
        </div>
      )}

      <header className="masthead">
        <h1 className="wordmark">Property Inspector</h1>
      </header>

      <p className="hero-line">Just talk. Sections appear as you go.</p>

      <section className="step step--source">
        <div className="step-head">
          <span className="step-eyebrow">Report details</span>
          <h2 className="step-title">Property &amp; inspector</h2>
          <p className="step-note">Type below, or dictate — e.g. “Property is Maple Court Apartments, 123 Main St Unit 4, inspector Jane Doe, today.” Only what you say fills in.</p>
        </div>
        <div className="walkthrough-tools">
          <VoiceButton onText={onDetailsChunk} onStop={onDetailsStop} label="Dictate details" source="details" />
        </div>
        <div className="header-grid">
          <label className="hg"><span>Property</span>
            <input value={report.property} onChange={(e) => setHeader({ property: e.target.value })} placeholder="e.g. Maple Court Apartments" /></label>
          <label className="hg"><span>Address</span>
            <input value={report.address} onChange={(e) => setHeader({ address: e.target.value })} placeholder="123 Main St, Unit 4" /></label>
          <label className="hg"><span>Inspector</span>
            <input value={report.inspector} onChange={(e) => setHeader({ inspector: e.target.value })} placeholder="Your name" /></label>
          <label className="hg"><span>Date</span>
            <input type="date" value={report.date} onChange={(e) => setHeader({ date: e.target.value })} /></label>
        </div>
      </section>

      {/* Walkthrough — the primary input; sections emerge from it */}
      <section className="step step--source">
        <div className="step-head">
          <span className="step-eyebrow">Walkthrough</span>
          <h2 className="step-title">Talk through the property</h2>
          <p className="step-note">Name an area as you go (“in the kitchen…”, “the roof…”). A section pops up for each area you mention, with what you said attached. Nothing you didn’t say is added.</p>
        </div>
        <div className="walkthrough-tools">
          <VoiceButton onText={appendWalkthrough} label="Dictate walkthrough" source="walkthrough" />
        </div>
        <textarea
          className="walkthrough-text"
          value={report.walkthrough}
          onChange={(e) => setWalkthrough(e.target.value)}
          placeholder="e.g. Starting at the roof — recently replaced, no issues. In the kitchen, the countertops are worn and the faucet drips. The primary bath fan is loud…"
          rows={4}
        />
      </section>

      {/* Auto-detected sections */}
      <section className="step step--source">
        <div className="step-head">
          <span className="step-eyebrow">Sections</span>
          <h2 className="step-title">Detected from your walkthrough</h2>
          <p className="step-note">
            {named.length} area{named.length === 1 ? '' : 's'} detected · {t.Good} Good / {t.Fair} Fair / {t.Poor} Poor / {t['N/A']} N/A
          </p>
        </div>

        {report.sections.length === 0 ? (
          <p className="result-empty">No sections yet — start dictating or typing your walkthrough above and areas will appear here automatically.</p>
        ) : (
          <div className="areas">
            {report.sections.map((s) => (
              <SectionCard key={s.id} section={s} onChange={(n) => setSection(s.id, n)} onRemove={() => removeSection(s.id)} />
            ))}
          </div>
        )}

        <div className="unfiled-photo">
          <button type="button" className="mini-btn" onClick={() => unfiledRef.current?.click()}>🖼 Add photo (to current area)</button>
          <input ref={unfiledRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => { addUnfiledPhoto(e.target.files); e.target.value = '' }} />
        </div>
      </section>

      {/* Draft */}
      <section className="step step--generate">
        <button className="generate-btn" onClick={onDraft} disabled={drafting}>
          {drafting ? 'Drafting…' : '✨ Draft report'}
        </button>
        {draftMsg && <p className="generate-msg generate-msg--info">{draftMsg}</p>}
      </section>

      {/* Summary */}
      <section className="step step--result">
        <div className="step-head">
          <span className="step-eyebrow">Summary</span>
          <h2 className="step-title">Overall summary</h2>
        </div>
        <textarea
          className="summary-text"
          value={report.summary}
          onChange={(e) => setHeader({ summary: e.target.value })}
          placeholder="Click “Draft report” to generate — or write your own. Fully editable."
          rows={4}
        />
      </section>

      {/* Export */}
      <section className="step step--result">
        <div className="step-head">
          <span className="step-eyebrow">Export</span>
          <h2 className="step-title">Download the report</h2>
        </div>
        <div className="export-actions">
          <button className="export-btn" onClick={() => onExport('pdf')} disabled={!!exporting}>
            {exporting === 'pdf' ? 'Preparing PDF…' : '⬇ PDF'}
          </button>
          <button className="export-btn export-btn--secondary" onClick={() => onExport('docx')} disabled={!!exporting}>
            {exporting === 'docx' ? 'Preparing DOCX…' : '⬇ Editable Word (.docx)'}
          </button>
        </div>
        {exportMsg && <p className="generate-msg generate-msg--info">{exportMsg}</p>}
        <button type="button" className="reset-link" onClick={onReset}>Start new inspection</button>
      </section>

      <footer className="site-footer">
        <p className="site-footer-line">Property Inspector · works offline · your notes and photos stay on this device.</p>
        <p className="site-footer-line site-footer-line--muted">Sections are built only from what you said — the AI proposes area labels and the summary, but never invents observations, areas, or ratings.</p>
      </footer>
    </main>
  )
}
