const CACHE_NAME = "illustrated-shell-v1";
const SHELL_URL = "./";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(SHELL_URL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Only the app shell (the page itself) is ever cached here. Everything else —
// TCGdex card data, Supabase auth/sync, pokemontcg.io and Limitless TCG image
// fallbacks — always goes straight to the network, untouched, so collection
// data and card art are never served stale. This cache exists purely so the
// app can still *launch* with no connection (e.g. bad wifi at a card show)
// instead of showing a browser error, not to make the binder usable offline.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const isNavigation =
    req.mode === "navigate" || (req.method === "GET" && req.destination === "document");
  if (!isNavigation) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
        return res;
      })
      .catch(() => caches.match(SHELL_URL))
  );
});
