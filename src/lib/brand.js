// Property Inspector — export branding (white-label config, no UI).
// Same pattern as HUB_URL in App.jsx: one file edited per deployment, consumed
// ONLY by the two exporters. The white-label defaults below reproduce today's
// output exactly — empty fields render nothing, so an unconfigured build's
// reports are byte-for-byte unchanged.
//
//   name        — brand line at the top of the PDF/DOCX (and nothing else).
//   licenseLine — one optional muted line under the report meta, e.g.
//                 "CA HIS License #123456 · (415) 555-0100 · you@company.com".
//   logoDataUrl — optional PNG/JPEG dataUrl drawn beside the brand line.
//                 Invalid or non-PNG/JPEG data is skipped (never breaks export).
export const BRAND = {
  name: 'Property Inspector',
  licenseLine: '',
  logoDataUrl: ''
}
