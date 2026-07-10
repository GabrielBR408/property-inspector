import React, { useRef } from 'react'
import { CONDITIONS } from '../lib/schema.js'
import { fileToPhoto } from '../lib/db.js'
import { track } from '../lib/track.js'

// One narrative-derived section: an auto-detected area with its verbatim
// narrative slice (editable), a derived-but-editable condition, and photos.
export default function SectionCard({ section, onChange, onRemove }) {
  const fileRef = useRef(null)
  const cameraRef = useRef(null)

  // Editing marks the field so re-segmentation stops overwriting it.
  const set = (patch, flags = {}) => onChange({ ...section, ...patch, ...flags })

  const addPhotos = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const photos = []
    for (const f of files) {
      try { photos.push(await fileToPhoto(f)) } catch (_e) { /* skip */ }
    }
    if (photos.length) set({ photos: [...(section.photos || []), ...photos] })
  }
  const removePhoto = (id) => set({ photos: (section.photos || []).filter((p) => p.id !== id) })

  const condClass = `cond cond--${(section.condition || 'N/A').toLowerCase().replace('/', '')}`

  return (
    <section className="area">
      <div className="area-head">
        <input
          className="area-name"
          aria-label="Area name"
          value={section.name}
          onChange={(e) => set({ name: e.target.value }, { nameEdited: true })}
          placeholder="Area name"
        />
        <select
          className={condClass}
          value={section.condition}
          onChange={(e) => set({ condition: e.target.value }, { conditionEdited: true })}
          aria-label="Condition"
        >
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          type="button"
          className={`flag-btn${section.followUp ? ' flag-btn--on' : ''}`}
          onClick={() => { const on = !section.followUp; set({ followUp: on }); track('followup_toggled', { on }) }}
          aria-pressed={!!section.followUp}
          title={section.followUp ? 'On the punch list — tap to unflag' : 'Flag for follow-up (adds to the punch list in exports)'}
        >
          <span aria-hidden="true">⚑</span> Follow-up
        </button>
        <button type="button" className="icon-btn" onClick={onRemove} title="Remove section" aria-label={`Remove ${section.name || 'section'}`}>✕</button>
      </div>

      <textarea
        className="item-notes"
        value={section.text}
        onChange={(e) => set({ text: e.target.value }, { textEdited: true })}
        placeholder="What was said about this area…"
        rows={3}
      />

      <div className="item-actions">
        <button type="button" className="mini-btn" onClick={() => cameraRef.current?.click()}><span aria-hidden="true">📷</span> Camera</button>
        <button type="button" className="mini-btn" onClick={() => fileRef.current?.click()}><span aria-hidden="true">🖼</span> Add photo</button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
      </div>

      {(section.photos || []).length > 0 && (
        <div className="thumbs">
          {section.photos.map((p) => (
            <div key={p.id} className="thumb">
              <img src={p.dataUrl} alt={p.name} />
              <button type="button" className="thumb-x" onClick={() => removePhoto(p.id)} title="Remove photo" aria-label="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
