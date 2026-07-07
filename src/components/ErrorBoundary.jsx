import React from 'react'
import { track } from '../lib/track.js'

// Top-level error boundary. Without it, any uncaught render error white-screens
// the whole PWA mid-inspection with no explanation. The report itself is safe —
// it is persisted to IndexedDB on every change — so the recovery story is
// simple: say so, and offer a reload. Copy is deliberately brand-free so this
// file stays byte-identical between the branded and white-label repos.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    // Bounded diagnostic only — never report content or user text.
    track('error', { reason: 'render_crash', code: String(error && error.name ? error.name : 'Error').slice(0, 32) })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="page">
        <section className="step" role="alert">
          <h1 className="step-title">Something went wrong</h1>
          <p className="step-note">
            The app hit an unexpected error. Your report is saved on this device
            — reloading will bring it right back.
          </p>
          <button
            type="button"
            className="generate-btn"
            style={{ marginTop: '0.9rem' }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </section>
      </main>
    )
  }
}
