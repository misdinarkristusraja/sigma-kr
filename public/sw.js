// SIGMA Service Worker v1.3
// Strategi: Network-first untuk JS/CSS (hindari blank screen dari stale chunks),
// Cache-first hanya untuk aset statis yang jarang berubah (icons, fonts).

const CACHE_NAME = 'sigma-static-v1';
const STATIC_ASSETS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/manifest.json',
];

// ── Install: cache aset statis saja ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(() => {}) // silent fail jika icon belum ada
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: bersihkan cache lama ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network-first untuk semua request ────────────────
// JS/CSS chunks pakai network-first agar deploy baru langsung kena.
// Hanya fallback ke cache jika benar-benar offline.
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET dan cross-origin (Supabase API, fonts CDN)
  if (request.method !== 'GET') return;
  if (!url.origin.includes(self.location.origin) &&
      !url.hostname.includes('fonts.googleapis.com') &&
      !url.hostname.includes('fonts.gstatic.com')) return;

  // Icons & manifest: cache-first (berubah sangat jarang)
  if (STATIC_ASSETS.some(a => url.pathname === a)) {
    event.respondWith(
      caches.match(request).then(cached =>
        cached || fetch(request).then(res => {
          if (res.ok) {
            caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
          }
          return res;
        })
      )
    );
    return;
  }

  // JS/CSS chunks (misal /assets/xxx.js): network-first, cache fallback
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // HTML (SPA navigation) — always network, fallback index.html untuk offline
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match('/index.html') || new Response('Offline', { status: 503 }))
    );
    return;
  }
});

// ── Message: SKIP_WAITING (dari main.jsx saat ada update) ────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Push Notification ────────────────────────────────────────
// FIX BUG-001: komentar dan addEventListener dipisah ke baris berbeda.
// Sebelumnya keduanya ada di satu baris sehingga addEventListener ikut
// menjadi komentar dan service worker crash saat di-parse.
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'SIGMA', body: event.data.text() }; }

  const { title, body, type = 'pengumuman', data = {} } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag:   `sigma-${type}`,
      renotify: true,
      data: { url: data.url || '/dashboard' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) { client.navigate(targetUrl); return client.focus(); }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
