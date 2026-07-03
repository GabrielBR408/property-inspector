import React from 'react'
import { useVoice } from '../lib/useVoice.js'

// A mic toggle that streams finalized speech chunks to onText(chunk). Optional
// onStop() fires when recognition ends. Renders a disabled hint when speech
// recognition is unsupported — the parent always keeps a textarea so manual
// entry still works.
// `source` tags this button's analytics events ('details' | 'walkthrough') so
// the dashboard can tell which dictation flow a failure came from.
export default function VoiceButton({ onText, onStop, label = 'Dictate', compact = false, source = 'unknown' }) {
  const { listening, interim, notice, start, stop, supported } = useVoice(onText, onStop, source)

  if (!supported) {
    return <span className="voice-unsupported" title="Voice not supported in this browser — type instead">🎤 n/a</span>
  }
  return (
    <span className="voice">
      <button
        type="button"
        className={`voice-btn${listening ? ' voice-btn--on' : ''}${compact ? ' voice-btn--sm' : ''}`}
        onClick={listening ? stop : start}
        aria-pressed={listening}
      >
        <span className="voice-dot" />
        {listening ? 'Listening…' : label}
      </button>
      {listening && interim ? <span className="voice-interim">{interim}</span> : null}
      {!listening && notice ? <span className="voice-interim" role="status">{notice}</span> : null}
    </span>
  )
}
