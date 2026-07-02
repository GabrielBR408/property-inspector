// PWA service-worker registration with an "update available" callback.
// Uses vite-plugin-pwa's virtual module. Safe no-op if unavailable (e.g. dev).

export function registerPWA(onNeedRefresh) {
  if (typeof window === 'undefined') return () => {}
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() { onNeedRefresh && onNeedRefresh(() => updateSW(true)) }
      })
    })
    .catch(() => { /* PWA not built in dev — ignore */ })
  // Disposer is a no-op: applying the update belongs ONLY to the callback the
  // banner exposes. (Previously this returned updateSW(true) — an effect
  // CLEANUP that force-reloaded the page.)
  return () => {}
}
