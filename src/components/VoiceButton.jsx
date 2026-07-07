import React, { useRef, useState } from 'react'
import { useVoice } from '../lib/useVoice.js'

// Push-to-talk mic: hold to dictate, release to stop. PTT fits field use better
// than a toggle — no "did I leave the mic running?" and no stray narration
// captured between observations. Pointer capture keeps the press alive even if
// the finger slides off the button; Space/Enter give the same hold-to-talk on a
// keyboard. Optional onStop() fires when recognition ends. The parent always
// keeps a textarea so manual entry still works.
// `source` tags this button's analytics events ('details' | 'walkthrough') so
// the dashboard can tell which dictation flow a failure came from.
export default function VoiceButton({ onText, onStop, label = 'Hold to dictate', compact = false, source = 'unknown' }) {
  const { listening, interim, notice, start, stop, supported } = useVoice(onText, onStop, source)
  const [hint, setHint] = useState('')
  const downAt = useRef(0)

  const press = () => {
    if (listening) return
    setHint('')
    downAt.current = Date.now()
    start()
  }
  const release = () => {
    if (!listening) return
    // Speech engines need a beat to spin up — a sub-400ms tap almost always
    // captures nothing, so teach the gesture instead of failing silently.
    if (Date.now() - downAt.current < 400) setHint('Hold the button while you speak — release when done.')
    stop()
  }

  const onPointerDown = (e) => {
    if (e.button > 0) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_e) { /* ignore */ }
    press()
  }
  const onKeyDown = (e) => {
    if (e.repeat) return
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); press() }
  }
  const onKeyUp = (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); release() }
  }

  if (!supported) {
    return <span className="voice-unsupported" title="Voice not supported in this browser — type instead">🎤 n/a</span>
  }
  return (
    <span className="voice">
      <button
        type="button"
        className={`voice-btn${listening ? ' voice-btn--on' : ''}${compact ? ' voice-btn--sm' : ''}`}
        onPointerDown={onPointerDown}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
        aria-pressed={listening}
      >
        <span className="voice-dot" />
        {listening ? 'Listening… release when done' : label}
      </button>
      {listening && interim ? <span className="voice-interim">{interim}</span> : null}
      {!listening && (hint || notice) ? <span className="voice-interim" role="status">{hint || notice}</span> : null}
    </span>
  )
}
