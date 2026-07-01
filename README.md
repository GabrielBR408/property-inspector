# Property Inspector

A neutral, white-label property-inspection **PWA**. It does what Happy Inspector
does — but you **talk into it** and **snap photos**, and it **drafts an editable
report** you can tweak and export to **PDF** or an **editable Word (.docx)**
document.

Works offline. Your notes and photos stay on the device (IndexedDB). AI drafting
is optional and only writes prose — it never changes your ratings, items, or photos.

## Stack

React 18 + Vite 6 + `vite-plugin-pwa`, with a clean, neutral slate palette and a
simple card UI. AI drafting is a Vercel serverless function (`api/draft.js`)
calling the Anthropic API, with a deterministic fallback so the app works with no
key.

## Features

- **Narrative-driven sections**: there are no pre-set areas/items. As you dictate
  or type the walkthrough, a section **pops up automatically** for each area you
  name ("kitchen", "roof", "primary bath", "garage", …), with the part of the
  narrative you said about it attached. A section exists only if the narrative
  referenced its area — no empty pre-set sections.
- **Voice**: live client-side transcription via the Web Speech API drives the
  walkthrough. Manual typing always works as a fallback.
- **Faithful by construction**: each section's text is a **verbatim slice** of the
  narrative (the sentences assigned to that area), and its condition rating is
  **derived** from that slice (keyword, severity Poor > Fair > Good, else N/A) —
  never invented. Everything stays editable.
- **Photos**: camera capture or file upload, downscaled and stored offline in
  IndexedDB; attach to a section, or use "Add photo" to file it under the latest /
  a General section.
- **AI pass (optional)**: when `ANTHROPIC_API_KEY` is set, the serverless
  `api/draft.js` only proposes extra *area labels* (better synonym handling, e.g.
  "mudroom") and writes the overall summary. The client feeds those labels in as
  extra vocabulary, so a label only yields a section if it actually appears in the
  narrative — the AI can never inject an invented area, observation, or rating.
  Without a key it segments + summarizes deterministically.
- **Export**: client-side **PDF** (jsPDF) and **editable .docx** (`docx`), both
  built from one shared export model.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the built app
```

## Verify (headless self-check)

```bash
npm run self-check
```

Constructs a synthetic inspection and asserts the invariants below, then exits
non-zero on any failure (unzips the generated DOCX and inspects the PDF content
model for real):

| # | Invariant |
|---|-----------|
| 1 | Sections match the narrated areas exactly, in first-mention order — no section for an un-mentioned area |
| 2 | Each section's text is a faithful, verbatim slice of the narrative (no fabricated observations) |
| 3 | Ratings are derived from each section's own text, never invented |
| 4 | The AI pass cannot invent an area, observation, or rating (a label only counts if the narrative names it) |
| 5 | An AI-proposed label that *is* in the narrative can add a faithful section |
| 6 | Deterministic fallback (no AI) still segments + summarizes |
| 7 | Export model + DOCX (unzipped) + PDF content model contain every derived section |

## Deploy (Vercel)

Standalone target: `property-inspector.vercel.app`. Import the repo in Vercel
(framework preset **Vite**), then set **`ANTHROPIC_API_KEY`** in the project's
Environment Variables to enable AI drafting. Without it, the app still runs and
produces a deterministic summary.
