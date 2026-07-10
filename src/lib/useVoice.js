// Property Inspector — Web Speech API voice hook.
// Live client-side transcription. Browser-only; degrades gracefully to manual
// text entry when SpeechRecognition is unavailable (the UI always keeps a
// textarea fallback).

import { useCallback, useEffect, useRef, useState } from 'react'
import { track } from './track.js'
import { classifyDictationError, dictationEventProps } from './voiceErrors.js'

function getRecognition() {
  if (typeof window === 'undefined') return null
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

export function isVoiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

// Mic permission state for diagnostics: granted | denied | prompt | unknown.
// Safari has no 'microphone' permission name and throws — that's 'unknown'.
async function micPermission() {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return 'unknown'
    const st = await navigator.permissions.query({ name: 'microphone' })
    return (st && st.state) || 'unknown'
  } catch (_e) { return 'unknown' }
}

// Fire a dictation analytics event enriched with privacy-safe diagnostics
// (bounded enums/flags only — see voiceErrors.dictationEventProps). Async only
// because of the permission query; fire-and-forget like track itself.
function trackDictation(event, code, source, extra = {}) {
  micPermission().then((mic) => {
    track(event, {
      ...extra,
      ...dictationEventProps({
        code,
        source,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
        mic,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : ''
      })
    })
  })
}

// onFinal(text) is called with each finalized chunk of transcript. Optional
// onEnd() fires once when recognition stops (user toggle or natural end) — used
// to trigger a one-shot AI enhancement pass. The hook exposes
// { listening, interim, notice, start, stop, supported } — `notice` is a
// plain-English hint when dictation ends abnormally (mic blocked, offline,
// silence timeout), cleared on the next start.
// Browsers run at most one SpeechRecognition at a time; when a second voice
// button starts, cleanly stop whichever instance is live (its own onend still
// fires, so its UI resets and its onEnd pass runs).
let stopActive = null

// True while any dictation session is live. Module-level (not hook state) so
// non-React code — e.g. the feedback widget's context snapshot — can read it
// at the moment of sending.
export function isDictating() { return !!stopActive }

export function useVoice(onFinal, onEnd, source = 'unknown') {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [notice, setNotice] = useState('')
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
    setNotice('')
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
    rec.onerror = (e) => {
      // Classify by the spec error code: benign ends (silence timeout, our own
      // deliberate stop when the other mic button starts) are NOT errors and
      // must not pollute analytics; real failures carry the code so the
      // dashboard can distinguish mic-blocked / offline / no-device.
      const info = classifyDictationError(e && e.error)
      setListening(false); setInterim('')
      if (info.message) setNotice(info.message)
      if (!info.benign) trackDictation('error', info.code, source, { reason: 'dictation_error' })
      else if (info.code === 'no-speech') trackDictation('dictation_no_speech', info.code, source)
    }
    rec.onend = () => {
      if (stopActive === stopThis) stopActive = null
      setListening(false); setInterim('')
      if (onEndRef.current) onEndRef.current()
    }
    recRef.current = rec
    const stopThis = () => { try { rec.stop() } catch (_e) { /* ignore */ } }
    try {
      rec.start(); setListening(true); stopActive = stopThis; track('dictation_started')
    } catch (_e) {
      setListening(false)
      setNotice('Couldn’t start dictation — tap the mic to try again, or type instead.')
      trackDictation('error', 'start-failed', source, { reason: 'dictation_start_failed' })
    }
  }, [stop, source])

  useEffect(() => () => stop(), [stop])

  return { listening, interim, notice, start, stop, supported: isVoiceSupported() }
}
