const CACHE_NAME = 'gb-maintenance-shell-v2'
const APP_SHELL = ['/', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  // Precache best-effort: cache.addAll() rejects (and aborts the whole install,
  // leaving the SW never activated — breaking push notifications entirely) if even
  // one resource doesn't return a plain 200. Cache each entry independently instead.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {}))))
      .catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = data.title || 'GB Maintenance'
  const options = {
    body: data.body || '',
    // Custom branding logo when configured (Settings > General), else the default app icon.
    icon: data.icon || '/icons/icon-192.png',
    // Android renders this as a monochrome silhouette (alpha channel only), so it must be a
    // white-on-transparent image — the full-color app icon shows as a solid white square instead.
    badge: '/icons/badge-96.png',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})

