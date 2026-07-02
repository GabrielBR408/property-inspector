// Property Inspector — Web Speech API voice hook.
// Live client-side transcription. Browser-only; degrades gracefully to manual
// text entry when SpeechRecognition is unavailable (the UI always keeps a
// textarea fallback).

import { useCallback, useEffect, useRef, useState } from 'react'
import { track } from './track.js'

function getRecognition() {
  if (typeof window === 'undefined') return null
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

export function isVoiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

// onFinal(text) is called with each finalized chunk of transcript. Optional
// onEnd() fires once when recognition stops (user toggle or natural end) — used
// to trigger a one-shot AI enhancement pass. The hook exposes
// { listening, interim, start, stop, supported }.
// Browsers run at most one SpeechRecognition at a time; when a second voice
// button starts, cleanly stop whichever instance is live (its own onend still
// fires, so its UI resets and its onEnd pass runs).
let stopActive = null

export function useVoice(onFinal, onEnd) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef(null)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  const stop = useCallback(() => {
    const rec = recRef.current
    if (rec) { try { rec.stop() } catch (_e) { /* ignore */ } }
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const old = recRef.current
    if (old) {
      // Detach before replacing: the old instance's late async onend must not
      // flip the NEW session's button back to idle (or re-fire onEnd).
      old.onresult = null; old.onerror = null; old.onend = null
      try { old.stop() } catch (_e) { /* ignore */ }
      recRef.current = null
    }
    if (stopActive) { try { stopActive() } catch (_e) { /* ignore */ } }
    const rec = getRecognition()
    if (!rec) return
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const t = r[0].transcript.trim()
          if (t) onFinalRef.current && onFinalRef.current(t)
        } else {
          interimText += r[0].transcript
        }
      }
      setInterim(interimText)
    }
    rec.onerror = () => { setListening(false); setInterim(''); track('error', { reason: 'dictation_error' }) }
    rec.onend = () => {
      if (stopActive === stopThis) stopActive = null
      setListening(false); setInterim('')
      if (onEndRef.current) onEndRef.current()
    }
    recRef.current = rec
    const stopThis = () => { try { rec.stop() } catch (_e) { /* ignore */ } }
    try {
      rec.start(); setListening(true); stopActive = stopThis; track('dictation_started')
    } catch (_e) { setListening(false); track('error', { reason: 'dictation_start_failed' }) }
  }, [stop])

  useEffect(() => () => stop(), [stop])

  return { listening, interim, start, stop, supported: isVoiceSupported() }
}
