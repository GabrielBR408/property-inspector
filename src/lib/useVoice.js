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

// onFinal(text) is called with each finalized chunk of transcript. The hook
// exposes { listening, interim, start, stop, supported }.
export function useVoice(onFinal) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef(null)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  const stop = useCallback(() => {
    const rec = recRef.current
    if (rec) { try { rec.stop() } catch (_e) { /* ignore */ } }
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    if (recRef.current) stop()
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
    rec.onerror = () => { setListening(false); setInterim(''); track('inspector', 'error', { reason: 'dictation_error' }) }
    rec.onend = () => { setListening(false); setInterim('') }
    recRef.current = rec
    try { rec.start(); setListening(true); track('inspector', 'dictation_started') } catch (_e) { setListening(false); track('inspector', 'error', { reason: 'dictation_start_failed' }) }
  }, [stop])

  useEffect(() => () => stop(), [stop])

  return { listening, interim, start, stop, supported: isVoiceSupported() }
}
