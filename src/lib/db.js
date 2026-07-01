// Property Inspector — offline persistence via IndexedDB.
// Browser-only (guarded by typeof indexedDB). Stores the whole report object —
// including photo dataUrls — so the PWA works fully offline. Kept out of the
// pure core so the Node self-check never touches it.

const DB_NAME = 'property-inspector'
const STORE = 'reports'
const KEY = 'current'

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveReport(report) {
  try {
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(report, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (_e) { /* offline persistence is best-effort */ }
}

export async function loadReport() {
  try {
    const db = await open()
    const report = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return report
  } catch (_e) { return null }
}

export async function clearReport() {
  try {
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (_e) { /* ignore */ }
}

// Downscale a captured/selected image file to a JPEG dataUrl so IndexedDB and
// the PDF stay small. Returns { id, name, dataUrl }.
export async function fileToPhoto(file, maxDim = 1280, quality = 0.72) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  const scaled = await downscale(dataUrl, maxDim, quality).catch(() => dataUrl)
  return { id: `p_${Date.now()}_${Math.round(Math.random() * 1e6)}`, name: file.name || 'photo', dataUrl: scaled }
}

function downscale(dataUrl, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      const scale = Math.min(1, maxDim / Math.max(width, height))
      width = Math.round(width * scale); height = Math.round(height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}
