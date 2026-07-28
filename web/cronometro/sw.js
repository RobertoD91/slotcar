/* Service worker del Cronometro web — cache-first, perche' in pista il wifi
 * spesso non c'e' e l'applicazione deve aprirsi lo stesso.
 *
 * ⚠️ Ad ogni pubblicazione va alzato CACHE **e** le query ?v= qui sotto e in
 * index.html: con la cache-first, se non cambia il nome, chi ha gia' aperto la
 * pagina resta sulla copia vecchia per sempre. */
const CACHE = 'cronometro-v0.3.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=0.3.0',
  './i18n.js?v=0.3.0',
  './race.js?v=0.3.0',
  './sistemi/registry.js?v=0.3.0',
  './sistemi/sim.js?v=0.3.0',
  '../ds200-ds300/ds200.js?v=0.3.0',
  './sistemi/ds200.js?v=0.3.0',
  './app.js?v=0.3.0',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
