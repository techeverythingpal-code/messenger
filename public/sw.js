self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // If you are looking at the app right now, the in-app alert is enough
      if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return

      await self.registration.showNotification(data.title || 'Millennials Messenger', {
        body: data.body || 'New message',
        icon: '/logo.png', // optional: ignored if you have no logo.png in /public
        tag: data.tag || 'messenger',
        renotify: true,
        vibrate: [200, 100, 200],
        data: { senderId: data.senderId || null },
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const senderId = event.notification.data?.senderId || null

  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (wins.length) {
        await wins[0].focus()
        if (senderId) wins[0].postMessage({ type: 'open-chat', senderId })
        return
      }
      await self.clients.openWindow(senderId ? `/?chat=${encodeURIComponent(senderId)}` : '/')
    })()
  )
})