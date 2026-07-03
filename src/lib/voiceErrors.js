// Property Inspector — dictation (SpeechRecognition) error classification.
// Pure, no DOM — the self-check asserts this mapping in Node.
//
// SpeechRecognitionErrorEvent.error codes (Web Speech spec) fall into two very
// different buckets:
//   BENIGN — normal operation, not a defect: 'no-speech' (user tapped the mic
//   and said nothing before the engine's silence timeout) and 'aborted' (the
//   app or browser deliberately stopped the session — including when the OTHER
//   voice button starts and we stop this one). These must NOT be logged as
//   errors or the dashboard fills with phantom failures.
//   REAL — something actually prevented dictation: mic permission blocked, no
//   mic device, or no network (Chrome/Safari recognition is server-backed, so
//   dictation cannot work offline even though the rest of the PWA does).
//
// Every non-silent classification carries a plain-English message the voice
// button shows, so a failed dictation never just snaps back to idle unexplained.
export function classifyDictationError(code) {
  const c = String(code || 'unknown')
  switch (c) {
    case 'no-speech':
      return { code: c, benign: true, message: 'Didn’t catch anything — tap the mic and speak.' }
    case 'aborted':
      return { code: c, benign: true, message: '' } // deliberate stop; stay silent
    case 'not-allowed':
    case 'service-not-allowed':
      return { code: c, benign: false, message: 'Microphone access is blocked — allow the mic for this site, or type instead.' }
    case 'audio-capture':
      return { code: c, benign: false, message: 'No microphone was found — check your mic, or type instead.' }
    case 'network':
      return { code: c, benign: false, message: 'Dictation needs an internet connection — type instead while offline.' }
    default:
      return { code: c, benign: false, message: 'Dictation stopped unexpectedly — tap the mic to retry, or type instead.' }
  }
}
