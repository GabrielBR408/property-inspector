import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Build-time version stamp shown in the app footer, so anyone can tell at a
// glance which build they're looking at. On Vercel the git SHA rides along;
// local builds show just the package version.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
const appVersion = `v${pkg.version}${sha ? ` · ${sha}` : ''}`

// Base public path. '/' for standalone Vercel deploy (property-inspector.vercel.app).
// If this app is ever proxied onto the an internal hub under a sub-path,
// set VITE_BASE (e.g. '/inspector/') so built asset URLs resolve there.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __PKG_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__: JSON.stringify(sha || 'dev')
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // Take control of the very first visit once the SW activates. Without
      // this, the first-loaded page is uncontrolled, so the lazily-imported
      // export chunks (jspdf/docx) can't be served from the precache — "works
      // offline" only held after a reload. skipWaiting stays off (prompt flow).
      workbox: { clientsClaim: true },
      includeAssets: ['favicon.svg', 'icons/icon-180.png'],
      manifest: {
        name: 'Property Inspector',
        short_name: 'Inspector',
        description: 'Talk-and-photo AI property inspection reports.',
        theme_color: '#1f2937',
        background_color: '#f5f6f7',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ]
})
