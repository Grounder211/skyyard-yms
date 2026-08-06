const CACHE_NAME = "skyyard-quantum-v7";
const STATIC_ASSETS = [
  "/",
  "/driver",
  "/manifest.json",
  "/index.html"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    // Network-first for API
    e.respondWith(
      fetch(request).catch(async () => {
        // Fallback for key API routes if offline
        const cache = await caches.open(CACHE_NAME);
        return cache.match(request) || new Response(JSON.stringify({ error: "Offline - Neural Link severed" }), {
          headers: { "Content-Type": "application/json" }
        });
      })
    );
  } else {
    // Cache-first for static assets
    e.respondWith(
      caches.match(request).then(response => {
        return response || fetch(request).then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
  }
});
