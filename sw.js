/* Minimal PWA offline shell — caches only the static app files, never
   Apps Script requests, so bill/note data is always fetched fresh. */
const CACHE = "lbb-shell-v1";
const SHELL_FILES = ["./", "index.html", "api.js", "core.js", "styles.css"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // never intercept Apps Script calls
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
