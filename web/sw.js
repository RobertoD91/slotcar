/* Service worker: NETWORK-FIRST.
   Scarica sempre l'ultima versione dalla rete (ignora la cache HTTP di GitHub Pages);
   la cache serve SOLO da fallback offline. Risolve il "carico sempre la versione vecchia". */
const CACHE = "oxigen-web-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;   // solo same-origin

  e.respondWith(
    fetch(url.pathname + url.search, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))                 // offline -> ultima copia
  );
});
