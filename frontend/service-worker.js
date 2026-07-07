const CACHE_NAME = 'disasterlink-v3';
const ASSETS_TO_CACHE = [
  './index.html',
  './admin.html',
  './dashboard.html',
  './report.html',
  './volunteer.html',
  './volunteer_register.html',
  './style.css?v=2',
  './script.js?v=2',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
  // Immediately take over, don't wait for existing tabs to close
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' && event.request.method !== 'POST') return;

  const url = event.request.url;

  // Always go network-first for API requests, caching GET responses for offline read fallback
  if (url.includes('127.0.0.1:8000') || url.includes('disasterlink.onrender.com') || url.includes('/api/')) {
    if (event.request.method === 'GET') {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const resClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
            }
            return response;
          })
          .catch(() => caches.match(event.request))
      );
    } else {
      event.respondWith(fetch(event.request));
    }
    return;
  }

  // For local app files (HTML, CSS, JS) use NETWORK-FIRST so updates are always applied immediately
  if (url.includes('localhost') || url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For external CDN resources (Leaflet etc.), use cache-first for speed
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return response;
      });
    })
  );
});
