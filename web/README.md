# `web/` — il sito pubblicato su GitHub Pages

Questa cartella **è** il sito: il workflow [`../.github/workflows/pages.yml`](../.github/workflows/pages.yml)
la carica tal quale su GitHub Pages ad ogni push su `master`. Non c'è build step per le
pagine (solo il firmware ESP32 viene compilato e depositato in `ds200/firmware/`).

```
index.html        landing: l'indice con le card di tutte le app
i18n.js           motore multilingua condiviso (IT/EN/ES) + disclaimer legale
sw.js             service worker network-first (root)
version.json      versione del sito e delle singole app
car-config/       chip auto oXigen — Web Bluetooth
remote-config/    controller SCP-3 oXigen — Web Bluetooth
chron02/          contagiri e gestione gara oXigen — Web Serial
o2-bootloader/    configuratore oXigen (boot, info, registri) — Web Serial
modes/            riferimento tasti/LED/pairing — pagina statica
ds200/            contagiri DS200/DS300 — Web Serial, PWA autonoma
```

## Percorsi relativi (importante)

Il sito è servito da un sottopercorso (`https://<user>.github.io/slotcar/`), quindi ogni
pagina usa **percorsi relativi**: `../version.json`, `../` per tornare all'indice,
`i18n.js` / `../i18n.js` a seconda del livello. **Mai** percorsi assoluti (`/qualcosa`):
si romperebbero fuori dalla root del dominio.

## Multilingua (IT/EN/ES) e disclaimer — app oXigen

`i18n.js` dà a ogni pagina che lo carica:

- rilevamento automatico della lingua dal browser (`navigator.languages`, fallback inglese);
- un **selettore lingua** in alto a destra, con la scelta salvata in `localStorage`;
- il **disclaimer legale** in fondo alla pagina, tradotto una volta sola qui dentro.

Come si aggiunge testo traducibile:

```html
<span data-i18n="chiave"></span>            <!-- textContent -->
<p data-i18n-html="chiave"></p>             <!-- innerHTML, per <b>/<code> -->
<input data-i18n-attr="placeholder:chiave"> <!-- attributi -->

<script>window.I18N_STRINGS = { chiave:{it:"…",en:"…",es:"…"} };</script>
<script src="../i18n.js"></script>          <!-- DOPO le stringhe -->
```

Le stringhe generate da JS usano `I18N.t("chiave")` e vanno ri-renderizzate sull'evento
`i18n:changed` del `document` (viene emesso ad ogni cambio lingua).

Chiavi **condivise** già pronte: `disclaimer`, `updateAvail` / `updateBtn` (banner di
aggiornamento), `noBt` (browser senza Web Bluetooth), `noSerial` (browser senza Web Serial).

> `ds200/` **non** usa questo motore: ha un `i18n.js` proprio con cinque lingue
> (it/en/es/fr/de) perché arriva da un progetto separato ed è autonoma — è anche l'unica
> cartella qui dentro che sia una **copia**. Se aggiungi una stringa lì, aggiornala nel suo
> dizionario, e ricorda che il prossimo allineamento sovrascrive quei file: le modifiche
> vanno messe come patch in `tools/apply-local-patches.py`.

## Cache e versioni

`sw.js` (root) è **network-first**: intercetta le GET same-origin e va sempre in rete con
`cache: "no-store"`, ignorando la cache HTTP di GitHub Pages; la copia locale serve solo
da fallback offline. Quindi ogni ricarica prende l'ultima versione. *Al primo caricamento
dopo un deploy serve un refresh per installare/aggiornare il service worker, poi è
automatico.*

Ogni pagina scarica anche `version.json` (`no-store`) e, se la versione pubblicata è più
recente di quella in esecuzione, mostra il banner **"Aggiorna"**.

**Quando pubblichi un aggiornamento**: alza la versione in `version.json` **e** la
costante `SITE_VERSION` (o `APP_VERSION`) nell'HTML della pagina interessata. Se le due
non combaciano, il banner resta appeso.

`ds200/sw.js` è invece **cache-first** (deve funzionare offline in pista): lì va alzata la
costante `CACHE` e le query `?v=` degli asset, insieme a `APP_VERSION` in `ds200/app.js`.
I due service worker convivono: quello di `ds200/` ha lo scope più specifico e vince sulle
sue pagine.

## Aggiungere una nuova app

1. Crea la cartella `web/nuova-app/` con dentro `index.html`.
2. Metti in cima il link di ritorno: `<a class="back" href="../">← Slot Car Web Tools</a>`.
3. Carica `../i18n.js` dopo aver definito `window.I18N_STRINGS`.
4. Aggiungi la card in `index.html` (sezione giusta) con le sue stringhe tradotte.
5. Aggiungi la voce in `version.json` e alza `site` + `SITE_VERSION`.

## Requisiti d'uso

Web Bluetooth: **Chrome/Edge desktop** o **Chrome Android** (non Safari/iOS, non Firefox).
Web Serial: **Chrome/Edge/Opera desktop** soltanto. Entrambe richiedono `https://` o
`http://localhost`.

**Solo su hardware di tua proprietà.** Alcune funzioni scrivono sui dispositivi
(configurazione, clone del MAC, reset, DFU): vedi il disclaimer in fondo a ogni pagina.

## Prova in locale

```bash
cd web && python3 -m http.server 8080   # poi http://localhost:8080/
```
