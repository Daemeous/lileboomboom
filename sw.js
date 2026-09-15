/* PWA offline shell — network-first for the static app files (so a phone
   with signal always gets the latest version pushed to GitHub Pages,
   updating the cache as it goes), falling back to the last cached copy
   when there's no connection at all. Apps Script requests are never
   touched here — api.js handles their own offline queue/cache. */
const CACHE = "lbb-shell-v2";
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
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
