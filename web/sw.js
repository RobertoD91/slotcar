/* Service worker di radice: NETWORK-FIRST.
   Scarica sempre l'ultima versione dalla rete (ignora la cache HTTP di GitHub Pages);
   la cache serve SOLO da fallback offline. Risolve il "carico sempre la versione vecchia".

   ⚠️ Tre regole, tutte pagate:
   - `version.json` NON passa di qui. Le pagine lo chiedono con `?_=<ora>` per
     scavalcare ogni cache: salvato col suo indirizzo intero, ne restava una copia
     nuova per ogni pagina aperta, e la cache cresceva senza limite. E una copia
     vecchia di version.json, servita offline, non dice niente di vero.
   - Le altre risposte si salvano per PERCORSO, senza la query: `ui.css?v=2`,
     `index.html?v=<ora>` (il pulsante «Aggiorna») sono lo stesso file, e ne
     basta l'ultima copia.
   - All'attivazione si cancellano solo le cache con il NOSTRO prefisso. Sullo
     stesso dominio vivono anche le cache del Cronometro e del contagiri DS200 (e
     di altri siti): cancellare «tutto quello che non è mio» le butta via. */
const PREFISSO = "oxigen-web-";
const CACHE = PREFISSO + "v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys
      .filter((k) => k.indexOf(PREFISSO) === 0 && k !== CACHE)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;   // solo same-origin
  if (url.pathname.endsWith("/version.json")) return; // sempre e solo dalla rete

  const chiave = url.origin + url.pathname;          // senza query
  e.respondWith(
    fetch(url.pathname + url.search, { cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(chiave, copy)).catch(() => {});
        }
        return res;
      })
      // offline -> ultima copia, cercata SOLO nella nostra cache
      .catch(() => caches.open(CACHE)
        .then((c) => c.match(chiave))
        .then((r) => r || Response.error()))
  );
});
