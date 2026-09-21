/* PWA offline shell — network-first for the static app files (so a phone
   with signal always gets the latest version pushed to GitHub Pages,
   updating the cache as it goes), falling back to the last cached copy
   when there's no connection at all. Apps Script requests are never
   touched here — api.js handles their own offline queue/cache.

   VERSION must match index.html's APP_VERSION comment on every deploy that
   changes api.js/core.js/styles.css. Bumping it does two things: every
   asset URL below changes, so no cache layer (this one, or the browser's
   own HTTP cache) can have a stale entry under the new URL to serve; and
   CACHE gets a new name, so activate() below drops the previous version's
   cache entirely rather than leaving it to slowly go stale. */
const VERSION = "5";
const CACHE = "lbb-shell-v" + VERSION;
const SHELL_FILES = ["./", "index.html", `api.js?v=${VERSION}`, `core.js?v=${VERSION}`, `styles.css?v=${VERSION}`];

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
    // cache: "reload" forces this past the browser's own HTTP cache too —
    // otherwise a same-URL asset with no version bump yet (or a host that
    // sends a longer max-age than expected) could get served stale by that
    // layer even though this handler is "network-first".
    fetch(e.request, { cache: "reload" })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
