// A minimal service worker. Its job is just to cache the app's own
// files so the page still loads (with your saved tasks) even with no
// signal — that's what makes an "installed" web app feel like a real app.
//
// Bump CACHE_NAME (e.g. to "organiser-v2") any time you change the
// files below and want visitors to pick up the new version.
const CACHE_NAME = "organiser-v7";
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// "Cache first, fall back to network" — fast, and works offline for
// anything already cached.
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
