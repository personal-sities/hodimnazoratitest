/* AloqaPro Service Worker */
const CACHE_NAME = 'aloqapro-v6';
const BASE = self.registration.scope;

const OFFLINE_ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'images/logo2.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const asset of OFFLINE_ASSETS) {
      try {
        await cache.add(asset);
      } catch (err) {
        console.warn('Cache add failed:', asset, err);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    try {
      const response = await fetch(req);

      if (
        response &&
        response.status === 200 &&
        (req.url.startsWith(self.location.origin) || req.url.startsWith('https://cdn.jsdelivr.net'))
      ) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, response.clone()).catch(() => {});
      }

      return response;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;

      if (req.mode === 'navigate') {
        const fallback = await caches.match(BASE + 'index.html');
        if (fallback) return fallback;
      }

      throw err;
    }
  })());
});

self.addEventListener('push', event => {
  let data = { title: 'AloqaPro', body: 'Yangi xabar' };

  try {
    if (event.data) data = event.data.json();
  } catch {
    data = {
      title: 'AloqaPro',
      body: event.data ? event.data.text() : 'Yangi xabar'
    };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'AloqaPro', {
      body: data.body || 'Yangi xabar',
      icon: BASE + 'images/logo2.png',
      badge: BASE + 'images/logo2.png',
      tag: data.tag || 'aloqapro',
      data: data.data || {}
    })
  );
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SHOW_NOTIFICATION') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'AloqaPro', {
        body: data.body || '',
        icon: BASE + 'images/logo2.png',
        badge: BASE + 'images/logo2.png',
        tag: data.tag || ('local-' + Date.now()),
        data: data.data || {}
      })
    );
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }

    if (clients.openWindow) {
      await clients.openWindow(BASE);
    }
  })());
});
