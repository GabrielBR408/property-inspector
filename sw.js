// Killswitch service worker: unregisters itself, clears all caches, and
// forces any installed PWA clients to re-navigate so they land on the
// redirect to https://chiefeotool.com/chiefeoinspector.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
