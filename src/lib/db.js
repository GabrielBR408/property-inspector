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

// Returns true when the report persisted, false when it could not (no
// IndexedDB, storage quota exceeded, private-mode restrictions). Persistence is
// still best-effort — it never throws — but the caller can now WARN the user
// instead of silently losing an inspection when the device runs out of space.
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
    return true
  } catch (_e) { return false }
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

// --- Saved inspections library ------------------------------------------------
// Save the whole report under `saved_<id>` and keep a lightweight metadata
// index under `saved_index`, so listing the library never loads photo payloads.
// Re-saving a report that carries a savedId UPDATES its entry (no duplicates).

const SAVED_INDEX = 'saved_index'

function txGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}
function txPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
function txDel(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// Returns the saved id on success, null on failure (quota, no IndexedDB).
export async function saveInspection(report) {
  try {
    const id = report.savedId || `insp_${Date.now()}_${Math.round(Math.random() * 1e6)}`
    const meta = {
      id,
      property: report.property || '',
      address: report.address || '',
      date: report.date || '',
      savedAt: Date.now(),
      sections: (report.sections || []).length,
      photos: (report.sections || []).reduce((n, s) => n + ((s.photos || []).length), 0)
    }
    const db = await open()
    await txPut(db, `saved_${id}`, { ...report, savedId: id })
    const index = (await txGet(db, SAVED_INDEX)) || []
    await txPut(db, SAVED_INDEX, [meta, ...index.filter((m) => m && m.id !== id)])
    db.close()
    return id
  } catch (_e) { return null }
}

export async function listSavedInspections() {
  try {
    const db = await open()
    const index = (await txGet(db, SAVED_INDEX)) || []
    db.close()
    return Array.isArray(index) ? index : []
  } catch (_e) { return [] }
}

export async function loadInspection(id) {
  try {
    const db = await open()
    const report = await txGet(db, `saved_${id}`)
    db.close()
    return report || null
  } catch (_e) { return null }
}

export async function deleteInspection(id) {
  try {
    const db = await open()
    await txDel(db, `saved_${id}`)
    const index = (await txGet(db, SAVED_INDEX)) || []
    await txPut(db, SAVED_INDEX, index.filter((m) => m && m.id !== id))
    db.close()
    return true
  } catch (_e) { return false }
}
