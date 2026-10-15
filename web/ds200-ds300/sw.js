/* Service worker — offline cache for the DS200 PWA. */
/* Bump CACHE on every release so clients drop the old assets (check-versions.js
   pretende che CACHE e le query ?v= portino APP_VERSION).

   ⚠️ All'attivazione si cancellano SOLO le cache col prefisso `ds200-`, che sono
   quelle di questa app: le sue versioni vecchie e quelle della vecchia app che
   stava in ../ds200/. Prima si cancellava «tutto quello che non si chiama come
   me», e sullo stesso dominio c'e' la cache del Cronometro web, che faceva lo
   stesso: si cancellavano a vicenda, e il cronometro offline non si apriva piu'.

   Il nome e' `ds200-ds300-…` e non piu' `ds200-v…`: cosi' lo stub in ../ds200/,
   che deve buttare via le cache della VECCHIA app, le riconosce senza toccare
   queste.

   `version.json` non passa di qui: una copia in cache direbbe sempre che non
   c'e' niente di nuovo. */
const PREFISSO = 'ds200-';
const CACHE = 'ds200-ds300-v1.7.3';
const ASSETS = [
  './',
  './index.html',
  '../ui.css?v=1.7.3',
  '../tema.js?v=1.7.3',
  './i18n.js?v=1.7.3',
  './app.js?v=1.7.3',
  './ds200.js?v=1.7.3',
  './styles.css?v=1.7.3',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.indexOf(PREFISSO) === 0 && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for same-origin GET; falls back to network and caches new assets.
// Si cerca solo nella propria cache: le altre app dello stesso dominio hanno le loro.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) return;   // sempre dalla rete
  e.respondWith(
    caches.open(CACHE).then((cache) => cache.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => cached)
    ))
  );
});
