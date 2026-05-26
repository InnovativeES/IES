// Basic Service Worker to enable PWA installation

const CACHE_NAME = 'ies-admin-cache-v1';
const urlsToCache = [
  '/',
  '/admin.html',
  '/assets/admin/css/admin.css',
  '/assets/admin/css/tailwind.css',
  '/assets/logo.png'
];

self.addEventListener('install', event => {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache).catch(err => {
            // It's okay if some resources fail to cache initially
            console.warn('Service Worker cache.addAll failed for some resources.', err);
        });
      })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
