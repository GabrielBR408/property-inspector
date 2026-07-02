// Lightweight, privacy-friendly analytics — fire-and-forget, never blocks the UI,
// never throws. `properties` must only ever be counts/booleans/reason strings —
// never dictated narrative text, photos, or any drafted report content.
const SUPABASE_URL = 'https://dsmbppzvembacitwdrsj.supabase.co'
const SUPABASE_KEY = 'sb_publishable_jqiREpSEu8ItzSEcjTypsQ_41EivRsM'

function getSessionId() {
  try {
    let id = localStorage.getItem('chiefeo_session_id')
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('chiefeo_session_id', id)
    }
    return id
  } catch {
    return 'unknown'
  }
}

export function track(app, event, properties = {}) {
  try {
    const body = JSON.stringify({
      app,
      event,
      session_id: getSessionId(),
      properties,
      path: window.location.pathname,
      user_agent: navigator.userAgent
    })
    fetch(`${SUPABASE_URL}/rest/v1/app_events`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body,
      keepalive: true
    }).catch(() => {})
  } catch {
    // never throw — analytics must never break the app
  }
}
