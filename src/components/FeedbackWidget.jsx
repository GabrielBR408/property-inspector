import React, { useEffect, useRef, useState } from 'react'
import { track, APP_TAG } from '../lib/track.js'
import { isDictating } from '../lib/useVoice.js'
import { PKG_VERSION, COMMIT_SHA } from '../lib/buildInfo.js'

// Floating "Feedback" pill (bottom-right) that opens a bottom sheet. Sends ONE
// row to the shared analytics table via track() — no new endpoint or table.
// The message is the only free text; everything shown in the dashed receipt
// (app tag, version, commit, screen) is attached automatically so a report can
// be tied to the exact deployed build. Internal-traffic tagging rides along
// automatically — track() appends internal:true for flagged browsers. Esc
// closes; focus starts in the textarea and returns to the pill on close.
const TYPES = [
  { value: 'bug', label: 'Something’s broken' },
  { value: 'idea', label: 'Idea / request' },
  { value: 'other', label: 'Other' }
]

export default function FeedbackWidget({ screen = 'main', drafting = false }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('bug')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent
  const textRef = useRef(null)
  const pillRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => { if (open) textRef.current?.focus() }, [open])
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const close = () => {
    setOpen(false)
    clearTimeout(timerRef.current)
    // Keep an unsent draft so an accidental dismiss loses nothing; clear only
    // after a successful send.
    if (status === 'sent') { setMessage(''); setType('bug') }
    setStatus('idle')
    pillRef.current?.focus()
  }

  const send = () => {
    const text = message.trim()
    if (!text || status === 'sending') return
    setStatus('sending')
    track('feedback', {
      feedback_type: type,
      message: text,
      version: PKG_VERSION,
      commit: COMMIT_SHA,
      screen,
      ai_drafting: drafting,
      dictating: isDictating()
    })
    // track() is fire-and-forget by design (a keepalive fetch that never
    // throws or blocks) — hold the sending state a beat so the transition
    // reads, then confirm. The row is already on its way.
    timerRef.current = setTimeout(() => setStatus('sent'), 600)
  }

  return (
    <>
      <button ref={pillRef} type="button" className="fb-pill" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Feedback
      </button>
      {open && (
        <div className="fb-backdrop" onClick={close} onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
          <div className="fb-sheet" role="dialog" aria-modal="true" aria-label="Send feedback" onClick={(e) => e.stopPropagation()}>
            {status === 'sent' ? (
              <div className="fb-done" role="status">
                <p className="fb-done-title">Feedback sent — thank you!</p>
                <p className="fb-done-note">Your report was tagged to v{PKG_VERSION} · {COMMIT_SHA}.</p>
                <button type="button" className="fb-send" onClick={close}>Done</button>
              </div>
            ) : (
              <>
                <div className="fb-head">
                  <h2 className="fb-title">Send feedback</h2>
                  <button type="button" className="fb-close" onClick={close} aria-label="Close feedback">×</button>
                </div>
                <div className="fb-chips" role="group" aria-label="Feedback type">
                  {TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`fb-chip${type === t.value ? ' fb-chip--on' : ''}`}
                      aria-pressed={type === t.value}
                      onClick={() => setType(t.value)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={textRef}
                  className="fb-text"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What happened, or what would make this better?"
                  aria-label="Feedback message"
                />
                <div className="fb-receipt">
                  <span className="fb-receipt-title">Attached automatically</span>
                  <span>{APP_TAG} · v{PKG_VERSION} · {COMMIT_SHA} · screen: {screen}</span>
                </div>
                <button type="button" className="fb-send" onClick={send} disabled={!message.trim() || status === 'sending'}>
                  {status === 'sending' ? 'Sending…' : 'Send feedback'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
