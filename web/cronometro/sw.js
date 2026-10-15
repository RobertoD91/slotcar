/* Service worker del Cronometro web — cache-first, perche' in pista il wifi
 * spesso non c'e' e l'applicazione deve aprirsi lo stesso.
 *
 * ⚠️ Ad ogni pubblicazione va alzato CACHE **e** le query ?v= qui sotto e in
 * index.html: con la cache-first, se non cambia il nome, chi ha gia' aperto la
 * pagina resta sulla copia vecchia per sempre. Lo controlla check-versions.js.
 *
 * ⚠️ All'attivazione si cancellano SOLO le cache col prefisso `cronometro-`.
 * Prima si cancellava «tutto quello che non si chiama come me»: sullo stesso
 * dominio c'e' anche la cache del contagiri DS200, che faceva lo stesso, e i due
 * si cancellavano a vicenda — aperto il DS200, il cronometro offline non si
 * apriva piu'. Per lo stesso motivo si cerca solo nella propria cache.
 *
 * `version.json` non passa di qui: serve a sapere se c'e' una versione nuova, e
 * una copia in cache risponderebbe sempre «no». */
const PREFISSO = 'cronometro-';
const CACHE = PREFISSO + 'v0.5.6';
const ASSETS = [
  './',
  './index.html',
  '../ui.css?v=0.5.6',
  '../tema.js?v=0.5.6',
  './styles.css?v=0.5.6',
  './i18n.js?v=0.5.6',
  './race.js?v=0.5.6',
  './sistemi/registry.js?v=0.5.6',
  './sistemi/sim.js?v=0.5.6',
  '../ds200-ds300/ds200.js?v=0.5.6',
  './sistemi/ds200.js?v=0.5.6',
  './sistemi/esp32.js?v=0.5.6',
  './sistemi/ble.js?v=0.5.6',
  './app.js?v=0.5.6',
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
