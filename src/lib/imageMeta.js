// Property Inspector — image metadata helpers for exports.
// Pure (no DOM, no deps): parses PNG/JPEG headers out of a photo dataUrl so both
// exporters can embed photos at their true aspect ratio, in Node and browser.

export function dataUrlParts(dataUrl) {
  const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(String(dataUrl || ''))
  if (!m) return null
  return { mime: m[1].toLowerCase(), b64: m[2] }
}

export function dataUrlToBytes(dataUrl) {
  const parts = dataUrlParts(dataUrl)
  if (!parts) return null
  try {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(parts.b64, 'base64'))
    const bin = atob(parts.b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch (_e) { return null }
}

function readU32BE(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 }

// Pixel dimensions from raw image bytes. PNG: IHDR at fixed offset. JPEG: scan
// for the first SOFn marker. Returns { width, height } or null when unknown.
export function imageSize(bytes) {
  if (!bytes || bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes.length >= 24) {
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) }
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue }
      const marker = bytes[i + 1]
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
      }
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue }
      const len = (bytes[i + 2] << 8) | bytes[i + 3]
      if (len < 2) break
      i += 2 + len
    }
  }
  return null
}

// Fit `size` inside a maxW x maxH box preserving aspect ratio. Unknown size
// falls back to a square of the smaller box side (never upscales beyond box).
export function fitBox(size, maxW, maxH) {
  if (!size || !size.width || !size.height) {
    const s = Math.min(maxW, maxH)
    return { width: s, height: s }
  }
  const scale = Math.min(maxW / size.width, maxH / size.height)
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}
