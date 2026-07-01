import React from 'react'
import { useVoice } from '../lib/useVoice.js'

// A mic toggle that streams finalized speech chunks to onText(chunk). Renders
// nothing (returns a disabled hint) when speech recognition is unsupported —
// the parent always keeps a textarea so manual entry still works.
export default function VoiceButton({ onText, label = 'Dictate', compact = false }) {
  const { listening, interim, start, stop, supported } = useVoice(onText)

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
    </span>
  )
}
