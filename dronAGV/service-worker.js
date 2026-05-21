/**
 * dronAGV — Service Worker (app + vendor local, 100% offline)
 */
const CACHE_VERSION = 'dronagv-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './network.js',
  './sounds.js',
  './manifest.json',
  './icons/icon.svg',
  './vendor/sweetalert2.all.min.js',
  './vendor/xlsx.bundle.js',
  './vendor/jspdf.umd.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {})))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((res) => {
            if (res.ok && event.request.url.startsWith(self.location.origin)) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(event.request, copy));
            }
            return res;
          })
          .catch(() => cached)
    )
  );
});
