// Property Inspector — neutral PWA icon generator (dependency-free).
// Draws a slate app icon (a light "document" panel with checklist bars) directly
// into an RGBA pixel buffer and encodes a PNG using Node's built-in zlib. No SVG
// rasterizer, no image deps. Regenerate with:  node scripts/generate-icons.mjs
//
// Full-bleed slate background = safe as a maskable icon; the OS applies its own mask.

import zlib from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

// Palette (neutral slate).
const SLATE_BG = [31, 41, 55, 255]     // #1f2937
const PANEL = [241, 245, 249, 255]     // #f1f5f9
const BAR = [71, 85, 105, 255]         // #475569
const BAR2 = [148, 163, 184, 255]      // #94a3b8

function makeIcon(N) {
  const buf = new Uint8Array(N * N * 4)
  const put = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return
    const i = (y * N + x) * 4
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a
  }
  // Background.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(x, y, SLATE_BG)

  // Rounded-rect fill helper (skips pixels outside the corner radius).
  const roundRect = (x0, y0, w, h, rad, color) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const dx = Math.min(x - x0, x0 + w - 1 - x)
        const dy = Math.min(y - y0, y0 + h - 1 - y)
        if (dx < rad && dy < rad) {
          const cx = x0 + rad - 0.5, cy = y0 + rad - 0.5
          const rx = (x < x0 + rad ? cx : x0 + w - rad - 0.5)
          const ry = (y < y0 + rad ? cy : y0 + h - rad - 0.5)
          if ((x - rx) ** 2 + (y - ry) ** 2 > rad * rad) continue
        }
        put(x, y, color)
      }
    }
  }

  // Document panel (proportions match favicon.svg: 20/14/24/36 over 64).
  const s = N / 64
  roundRect(Math.round(20 * s), Math.round(14 * s), Math.round(24 * s), Math.round(36 * s), Math.round(4 * s), PANEL)
  // Checklist bars.
  const bar = (bx, by, bw, color) =>
    roundRect(Math.round(bx * s), Math.round(by * s), Math.round(bw * s), Math.round(3.4 * s), Math.round(1.7 * s), color)
  bar(25, 22, 14, BAR)
  bar(25, 30, 14, BAR)
  bar(25, 38, 9, BAR2)

  return encodePNG(buf, N, N)
}

// --- Minimal PNG encoder (RGBA, 8-bit, single IDAT) -------------------------
function encodePNG(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  // Filtered raw scanlines (filter byte 0 per row).
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.subarray(y * w * 4, (y + 1) * w * 4).forEach((v, i) => { raw[y * (w * 4 + 1) + 1 + i] = v })
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0)
  return Buffer.concat([len, t, data, crc])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

for (const [name, size] of [['icon-180.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(join(OUT, name), makeIcon(size))
  console.log(`wrote public/icons/${name} (${size}x${size})`)
}
