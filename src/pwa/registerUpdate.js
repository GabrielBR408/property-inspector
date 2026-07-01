// PWA service-worker registration with an "update available" callback.
// Uses vite-plugin-pwa's virtual module. Safe no-op if unavailable (e.g. dev).

export function registerPWA(onNeedRefresh) {
  if (typeof window === 'undefined') return () => {}
  let updateSW = () => {}
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      updateSW = registerSW({
        immediate: true,
        onNeedRefresh() { onNeedRefresh && onNeedRefresh(() => updateSW(true)) }
      })
    })
    .catch(() => { /* PWA not built in dev — ignore */ })
  return () => updateSW(true)
}
