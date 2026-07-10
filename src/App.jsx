import React, { useEffect, useRef, useState } from 'react'
import SectionCard from './components/SectionCard.jsx'
import VoiceButton from './components/VoiceButton.jsx'
import FeedbackWidget from './components/FeedbackWidget.jsx'
import { newReport } from './lib/schema.js'
import { fileToPhoto } from './lib/db.js'
import { segmentNarrative, mergeSections, analyzeNarrative, tallyConditions, lastMentionedKey, effectiveRemovedKeys, proposeAreaLabels, prefixHash } from './lib/segment.js'
import { downloadPdf } from './lib/exportPdf.js'
import { downloadDocx } from './lib/exportDocx.js'
import { saveReport, loadReport, clearReport, saveInspection, listSavedInspections, loadInspection, deleteInspection } from './lib/db.js'
import { registerPWA } from './pwa/registerUpdate.js'
import { parseDetails, parseDetailsSmart } from './lib/details.js'
import { track } from './lib/track.js'

// BRAND: absolute link back to the tools hub, shown at the top of the page. Set
// only in the branded build; this white-label mirror sets it to null so the
// button never renders here (keeps App.jsx otherwise identical between the two
// repos). The branded build points it at its hub's absolute URL.
const HUB_URL = null

// Build stamp injected by Vite (vite.config.js define). The typeof guard keeps
// this file importable anywhere the define isn't applied.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

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
      // Only restore if the user hasn't already started working — IndexedDB
      // resolves async, and a fast typist's first keystrokes must never be
      // clobbered by a late-arriving restore of the previous report.
      const cur = reportRef.current
      const untouched = !cur.walkthrough && cur.sections.length === 0 && !cur.property && !cur.address && !cur.inspector
      if (saved && saved.sections && untouched) setReport(saved)
      loaded.current = true
    })
    const dispose = registerPWA((apply) => setUpdate(() => apply))
    // Flush the debounced save when the tab hides/closes so the last ~400ms of
    // typing or dictation is never lost to a sudden app switch (common in the
    // field: dictate, then jump straight to the camera app).
    const flush = () => { if (loaded.current) saveReport(reportRef.current) }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      dispose()
    }
  }, [])

  // Fire once per change in detected-section count (not on every keystroke).
  useEffect(() => {
    if (report.sections.length !== lastSectionCount.current) {
      lastSectionCount.current = report.sections.length
      track('sections_detected', { count: report.sections.length })
    }
  }, [report.sections.length])

  const [saveFailed, setSaveFailed] = useState(false)
  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(async () => {
      const ok = await saveReport(report)
      setSaveFailed((prev) => {
        if (!ok && !prev) track('error', { reason: 'save_failed' })
        return !ok
      })
    }, 400)
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

  // --- Background area scan ---------------------------------------------------
  // The built-in directory splits instantly; this fills its gaps. A few seconds
  // after the walkthrough settles (and on every push-to-talk release), the FULL
  // narrative is scanned by the AI for area labels the directory doesn't know
  // ("coffee shop", "loading dock", tenant names). Learned labels extend live
  // segmentation exactly like the Draft pass — a label only becomes a section
  // if the narrative actually says it, and the summary is never touched.
  const lastScan = useRef({ len: 0, at: 0 })
  const scanForAreas = async () => {
    const text = (reportRef.current.walkthrough || '').trim()
    if (text.length < 30) return
    const now = Date.now()
    // Budget: skip if barely anything changed, and never more than ~3/min.
    if (Math.abs(text.length - lastScan.current.len) < 15) return
    if (now - lastScan.current.at < 20000) return
    lastScan.current = { len: text.length, at: now }
    const labels = await proposeAreaLabels(text)
    if (!labels.length) return
    setReport((r) => {
      const merged = [...new Set([...(r.aiAreas || []), ...labels])]
      if (merged.length === (r.aiAreas || []).length) return r
      track('area_labels_learned', { count: merged.length - (r.aiAreas || []).length })
      const next = { ...r, aiAreas: merged }
      return { ...next, sections: resegment(next, next.walkthrough) }
    })
  }
  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(scanForAreas, 3000)
    return () => clearTimeout(t)
  }, [report.walkthrough])

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
    const hasWork = (target.photos || []).length > 0 || target.textEdited || target.nameEdited || target.followUp
    if (hasWork && !window.confirm(`Remove "${target.name}"? Its photos, edits, and follow-up flag will be discarded.`)) return
    setReport((r) => ({
      ...r,
      sections: r.sections.filter((s) => s.id !== id),
      // Record the removal so re-segmentation doesn't resurrect the section.
      // `h` fingerprints the narrative at removal time — if the user later
      // clears/rewrites the walkthrough, the position rule no longer applies
      // and mentioning the area again revives it (see effectiveRemovedKeys).
      removedKeys: [...(r.removedKeys || []), { key: target.key, at: (r.walkthrough || '').length, h: prefixHash(r.walkthrough || '') }]
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
          sections.push({ id: sectionId('general'), key: 'general', area: 'General Observations', name: 'General Observations', text: '', condition: 'N/A', photos: [], textEdited: false, conditionEdited: false, nameEdited: false, followUp: false })
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
    // A truly empty report exports as a blank page — confusing, not useful.
    // Point back to the walkthrough instead. Any content at all still exports.
    if (!report.sections.length && !(report.walkthrough || '').trim() && !(report.summary || '').trim()) {
      setExportMsg('Nothing to export yet — dictate or type your walkthrough above and sections will appear.')
      return
    }
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

  // --- Saved inspections library ----------------------------------------------
  const [saved, setSaved] = useState([])
  const [showSaved, setShowSaved] = useState(false)
  const [libMsg, setLibMsg] = useState('')
  useEffect(() => { listSavedInspections().then(setSaved) }, [])

  const onSaveInspection = async () => {
    let property = (report.property || '').trim()
    if (!property) {
      property = (window.prompt('Which property is this inspection for?') || '').trim()
      if (!property) return
      setHeader({ property })
    }
    const id = await saveInspection({ ...report, property })
    if (id) {
      if (!report.savedId) setReport((r) => ({ ...r, savedId: id }))
      setSaved(await listSavedInspections())
      setLibMsg(`Saved under “${property}”.`)
      track('inspection_saved')
    } else {
      setLibMsg('Could not save — storage may be full. Export a copy to be safe.')
      track('error', { reason: 'inspection_save_failed' })
    }
  }

  const onOpenInspection = async (id) => {
    const hasWork = (report.walkthrough || '').trim() || report.sections.length > 0
    if (hasWork && !window.confirm('Open this saved inspection? It will replace what is on screen. (Save the current one first if you want to keep it.)')) return
    const r = await loadInspection(id)
    if (!r) { setLibMsg('Could not open that inspection.'); return }
    setReport(r)
    setShowSaved(false)
    setLibMsg('')
    setDraftMsg('')
    setExportMsg('') // message referred to the report this one just replaced
    track('inspection_opened')
  }

  const onDeleteInspection = async (id) => {
    if (!window.confirm('Delete this saved inspection? This cannot be undone.')) return
    await deleteInspection(id)
    setSaved(await listSavedInspections())
    // If the open report was this saved entry, detach it so re-saving creates a fresh one.
    setReport((r) => (r.savedId === id ? { ...r, savedId: undefined } : r))
    track('inspection_deleted')
  }

  const savedByProperty = saved.reduce((acc, m) => {
    const key = m.property || m.address || 'Untitled property'
    ;(acc[key] = acc[key] || []).push(m)
    return acc
  }, {})

  const onReset = async () => {
    if (!window.confirm('Start a new inspection? This clears the current one.')) return
    await clearReport()
    loaded.current = false
    setReport(newReport({ date: todayISO() }))
    // Clear every transient message — a stale "Saved under …" / "Nothing to
    // export yet" from the PREVIOUS inspection is misinformation on a fresh one.
    setDraftMsg('')
    setExportMsg('')
    setLibMsg('')
    loaded.current = true
  }

  const unfiledRef = useRef(null)
  const named = report.sections.filter((s) => s.key !== 'general')
  // Tally the same set the "areas detected" count describes.
  const t = tallyConditions(named)
  const flaggedCount = report.sections.filter((s) => s.followUp).length
  // The "screen" attached to feedback: this is a single-page app, so the
  // closest analog is the area currently under discussion (the last one
  // mentioned in the walkthrough), falling back to 'main'.
  const fbKey = lastMentionedKey(report.walkthrough || '', report.aiAreas || [])
  const fbScreen = (fbKey && (report.sections.find((s) => s.key === fbKey) || {}).name) || 'main'

  return (
    <main className="page">
      {HUB_URL && <a className="back-to-hub" href={HUB_URL}>← All Tools</a>}
      {update && (
        <div className="update-banner">
          <span className="update-banner-text">A new version is available.</span>
          <button className="update-banner-btn" onClick={() => update()}>Reload</button>
          <button className="update-banner-dismiss" onClick={() => setUpdate(null)} aria-label="Dismiss update notice">×</button>
        </div>
      )}
      {saveFailed && (
        <div className="save-warning" role="alert">
          Couldn't save your report to this device — storage may be full. Export a PDF or Word copy now so nothing is lost.
        </div>
      )}

      <header className="masthead">
        <div className="masthead-brand">
          <h1 className="wordmark">Property Inspector</h1>
        </div>
        <div className="masthead-actions">
          <button type="button" className="new-inspection-btn" onClick={onReset}>
            <span aria-hidden="true">+</span> New inspection
          </button>
          <button type="button" className="new-inspection-btn" onClick={onSaveInspection}>
            Save inspection
          </button>
        </div>
      </header>

      {libMsg && <p className="masthead-msg" role="status">{libMsg}</p>}

      {saved.length > 0 && (
        <section className="saved-panel">
          <button type="button" className="saved-toggle" onClick={() => setShowSaved((v) => !v)} aria-expanded={showSaved}>
            Saved inspections ({saved.length}) <span aria-hidden="true">{showSaved ? '▴' : '▾'}</span>
          </button>
          {showSaved && Object.keys(savedByProperty).sort((a, b) => a.localeCompare(b)).map((prop) => (
            <div key={prop} className="saved-group">
              <p className="saved-prop">{prop}</p>
              {savedByProperty[prop].map((m) => (
                <div key={m.id} className="saved-row">
                  <span className="saved-meta">
                    {m.date || '—'} · {m.sections} area{m.sections === 1 ? '' : 's'} · {m.photos} photo{m.photos === 1 ? '' : 's'}
                    {report.savedId === m.id ? ' · open now' : ''}
                  </span>
                  <span className="saved-actions">
                    <button type="button" className="mini-btn" onClick={() => onOpenInspection(m.id)}>Open</button>
                    <button type="button" className="icon-btn" onClick={() => onDeleteInspection(m.id)} title="Delete saved inspection" aria-label={`Delete saved inspection for ${prop}`}>✕</button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <p className="hero-line">Just talk. Sections appear as you go.</p>

      <section className="step step--source">
        <div className="step-head">
          <span className="step-eyebrow">Report details</span>
          <h2 className="step-title">Property &amp; inspector</h2>
          <p className="step-note">Type below, or hold the mic and dictate — e.g. “Property is Maple Court Apartments, 123 Main St Unit 4, inspector Jane Doe, today.” Only what you say fills in.</p>
        </div>
        <div className="walkthrough-tools">
          <VoiceButton onText={onDetailsChunk} onStop={onDetailsStop} label="Hold to dictate details" source="details" />
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
          <p className="step-note">Name an area as you go (“in the kitchen…”, “the roof…”). A section pops up for each area you mention, with what you said attached — uncommon area names are picked up automatically a few seconds after you pause. Nothing you didn’t say is added.</p>
        </div>
        <div className="walkthrough-tools">
          <VoiceButton onText={appendWalkthrough} onStop={scanForAreas} label="Hold to dictate walkthrough" source="walkthrough" />
        </div>
        <textarea
          className="walkthrough-text"
          aria-label="Walkthrough narrative"
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
            {named.length} area{named.length === 1 ? '' : 's'} detected · {t.Good} Good / {t.Fair} Fair / {t.Poor} Poor / {t['N/A']} N/A{flaggedCount > 0 ? ` · ${flaggedCount} flagged for follow-up` : ''}
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
          <button type="button" className="mini-btn" onClick={() => unfiledRef.current?.click()}><span aria-hidden="true">🖼</span> Add photo (to current area)</button>
          <input ref={unfiledRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => { addUnfiledPhoto(e.target.files); e.target.value = '' }} />
        </div>
      </section>

      {/* Draft */}
      <section className="step step--generate">
        <button className="generate-btn" onClick={onDraft} disabled={drafting}>
          {drafting ? 'Drafting…' : <><span aria-hidden="true">✨</span> Draft report</>}
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
          aria-label="Overall summary"
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
            {exporting === 'pdf' ? 'Preparing PDF…' : <><span aria-hidden="true">⬇</span> PDF</>}
          </button>
          <button className="export-btn export-btn--secondary" onClick={() => onExport('docx')} disabled={!!exporting}>
            {exporting === 'docx' ? 'Preparing DOCX…' : <><span aria-hidden="true">⬇</span> Editable Word (.docx)</>}
          </button>
        </div>
        {exportMsg && <p className="generate-msg generate-msg--info">{exportMsg}</p>}
        <button type="button" className="reset-link" onClick={onReset}>Start new inspection</button>
      </section>

      <footer className="site-footer">
        <p className="site-footer-line">Property Inspector · works offline · your notes and photos stay on this device.</p>
        <p className="site-footer-line site-footer-line--muted">Sections are built only from what you said — the AI proposes area labels and the summary, but never invents observations, areas, or ratings.</p>
        <p className="site-footer-line site-footer-line--muted">{APP_VERSION}</p>
      </footer>

      <FeedbackWidget screen={fbScreen} drafting={drafting} />
    </main>
  )
}
