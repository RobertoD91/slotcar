# slotcar — web tools per slot car digitali

> ## ⚠️ Versioni di sviluppo
>
> Questi strumenti nascono **per chi programma e sperimenta**: **non sono (ancora)
> pensati per l'utente finale**. Aspettati interfacce grezze, funzioni incomplete e
> qualche errore. Alcune app **scrivono** sui dispositivi (configurazione, indirizzo
> MAC, reset, DFU) e possono renderli temporaneamente inutilizzabili.
>
> Usale **solo su hardware tuo** e solo se sai cosa stai facendo. Nessuna garanzia,
> nessuna assistenza: vedi [Licenza e avvertenze](#licenza-e-avvertenze).
>
> *Development builds — made for developers and tinkerers, not (yet) for end users.
> Some tools write to the devices and can leave them unusable. Use at your own risk,
> on your own hardware only.*

Raccolta di **web app che girano nel browser**, senza installare niente, per tre
famiglie di prodotti da slot car:

- **oXigen / Slot.it** — configurazione via **Web Bluetooth** di chip auto e controller
  SCP-3, e debug del dongle via **Web Serial**.
- **DS Electronic** — monitor/contagiri per i cronometri **DS200 e DS300** via **Web Serial**
  (RS-232), con il flasher del ponte ESP32.
- **Ninco Digital** — analizzatore seriale della **power base**, per ricavarne il
  protocollo (non ancora noto) e poi costruirci il contagiri.

Tutte le app sono **statiche**: nessun backend, nessun account, **nessun dato lascia il
dispositivo**. Sono pubblicate su GitHub Pages da una GitHub Action.

> **English** — Browser-based tools for digital slot cars: Slot.it/oXigen car-chip and
> SCP-3 controller configuration over Web Bluetooth, oXigen dongle debugging over Web
> Serial, and a DS200/DS300 lap-timer monitor (RS-232) with an ESP32 flasher. Everything
> is static and runs client-side; the UI is available in Italian, English and Spanish
> (the DS200 app adds French and German).

## Le app

La pagina iniziale (`web/index.html`) è un **indice** che porta a tutte le app.

| App | Cosa fa | Serve |
|---|---|---|
| [`car-config/`](web/car-config/) | Configuratore del **chip auto** oXigen: nome, ID, modalità, velocità, freno, limiti, clone MAC, test motore/luci/sensore hall | Web Bluetooth |
| [`remote-config/`](web/remote-config/) | Configuratore del **controller SCP-3**: nome, brake setting, ID, clone MAC; legge firmware e data di attivazione | Web Bluetooth |
| [`dongle-debug/`](web/dongle-debug/) | Console di **debug del dongle** oXigen: letture info/licenza, comandi gara `race_status[10]`, telemetria `rf_data_x[13]` | Web Serial |
| [`modes/`](web/modes/) | Riferimento (dai manuali) di **sequenze tasti, LED, pairing e DFU** di controller e chip | niente, è statica |
| [`ds200/`](web/ds200/) | **Contagiri DS200 / DS300**: giri, tempi, classifica live, giro veloce, annunci vocali, export CSV. Installabile come PWA, funziona offline | Web Serial |
| [`ds200/flash.html`](web/ds200/flash.html) | **Flasher ESP32** del ponte DS200 → WiFi/MQTT, con configurazione della rete dal browser | Web Serial |
| [`ninco/`](web/ninco/) | **Analizzatore seriale Ninco Digital**: legge la power base, mostra i pacchetti in esadecimale, ne analizza lunghezza e byte iniziali/finali, esporta la cattura | Web Serial |

In arrivo (card "prossimamente" nell'indice): **chron02** (contagiri/gestione gara oXigen
via dongle), **O2 Bootloader** (aggiornatore firmware dei pezzi oXigen via dongle) e il
**contagiri Ninco**.

### ⚠️ Il protocollo Ninco non è ancora decodificato

In [`docs/ninco/`](docs/ninco/) c'è **solo lo schema del cavo** (Mini-DIN 6 → DB-9:
pin 1→2 e pin 5→5), non il formato dei dati: né il baud rate né il layout dei pacchetti.
Per questo l'app Ninco **ascolta e basta**, non pilota niente.

Il percorso per sbloccare il contagiri è: collegare la power base, usare *«prova tutte le
velocità»* per trovare il baud, far girare qualche macchina, **esportare la cattura** e
farla decodificare. Quando si conosce il formato, il contagiri si scrive riusando la
struttura già collaudata del DS200 (framer + parser + test).

### Compatibilità browser

Le API usate esistono solo su browser basati su Chromium:

- **Web Bluetooth** (`car-config`, `remote-config`): Chrome/Edge su desktop, Chrome su
  Android. **Non** su Safari/iOS né Firefox.
- **Web Serial** (`dongle-debug`, `ds200`, `flash.html`): Chrome/Edge/Opera **solo su
  desktop**. Non su Android né iOS.

Ogni pagina mostra da sola un avviso rosso se il browser non ha l'API che le serve.
Il sito va servito in `https://` (o `http://localhost`): entrambe le API lo richiedono.

### Una sola dipendenza esterna

Tutte le pagine sono **autonome** (niente CDN, niente tracker, niente font remoti) con
**un'eccezione**: `ds200/flash.html` carica la libreria del flasher
[esp-web-tools](https://github.com/esphome/esp-web-tools) da **unpkg.com**. Quindi quella
pagina — e solo quella — fa una richiesta a terzi e non funziona offline. Se un giorno
serve un sito 100% self-contained, va incorporata quella libreria (richiede un bundler,
perché è un modulo ES con dipendenze proprie).

## Pubblicazione (GitHub Pages)

Il workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) pubblica la
cartella **`web/`** ad ogni push su `master`.

**Setup una tantum:** *Settings → Pages → Build and deployment → Source =* **GitHub Actions**.

Poi il sito è su `https://robertod91.github.io/slotcar/`.

> ⚠️ **Finché la repo è privata**, GitHub Pages richiede un piano a pagamento (Pro/Team).
> Quando la repo diventa pubblica, Pages è gratuito e non serve toccare il workflow.

### ⚠️ Serve HTTPS, sempre

Web Bluetooth e Web Serial esistono **solo in contesto sicuro**: su `http://` il browser
non le espone proprio, e le app non riescono a collegarsi a niente. Peggio, senza le API
il messaggio che compare è «browser non supportato», che è fuorviante: il browser va
benissimo, è la connessione a non andare.

Quindi in *Settings → Pages* va tenuto attivo **Enforce HTTPS**. Se il sito usa un dominio
personalizzato, la casella sta sulle impostazioni del dominio: finché è spenta, `http://`
resta raggiungibile e chi ci arriva trova tutti gli strumenti inutilizzabili.

L'indice si difende da solo — se viene aperto in `http` passa da sé a `https`, e se
proprio resta in chiaro lo dice esplicitamente invece di incolpare il browser — ma è un
cerotto: la casella nelle impostazioni copre anche i link diretti alle singole app.

Lo stesso workflow compila anche il **firmware ESP32** del contagiri DS200 e lo mette
accanto al flasher. Quello step è **volutamente non bloccante**: se il firmware non
compila, il sito viene pubblicato lo stesso e solo `flash.html` resta indietro (lo
riporta il riepilogo della Action).

## Struttura

```
web/                  → è QUESTA cartella che finisce su GitHub Pages
  index.html            landing: l'indice che punta a tutte le app
  i18n.js               motore multilingua condiviso (IT/EN/ES) + disclaimer
  sw.js                 service worker network-first (evita le versioni vecchie in cache)
  version.json          versione del sito e delle singole app
  car-config/ remote-config/ dongle-debug/ modes/    app oXigen
  ds200/                contagiri DS200/DS300 (PWA autonoma, i18n e sw propri)
  ninco/                analizzatore seriale Ninco Digital
docs/                 documentazione dei protocolli (non pubblicata su Pages)
esp32/                firmware del ponte DS200 → WiFi/MQTT (PlatformIO)
tools/
  sync-from-upstream.sh    riallinea le app dalle repo di sviluppo
  apply-local-patches.py   riapplica le modifiche locali dopo il sync
  scan-secrets.py          cerca segreti nei file e nella storia
  install-hooks.sh         attiva gli hook git che bloccano i segreti
  check-links.js           verifica i link interni del sito
  smoke-test.js            apre tutte le app in un browser headless
```

## Sviluppo locale

Le app sono file statici: basta un server locale (`file://` non basta, le API vogliono
un'origine sicura).

```bash
cd web && python3 -m http.server 8080
# poi apri http://localhost:8080/
```

Controlli, tutti senza hardware:

```bash
node tools/check-links.js                                       # link interni del sito
python3 tools/apply-local-patches.py --check                    # patch locali a posto?
python3 tools/scan-secrets.py                                   # segreti nei file
python3 tools/scan-secrets.py --history                         # segreti nella storia
node web/ds200/ds200.test.js                                    # parser JS
g++ -std=c++17 -I esp32/test_host -I esp32/src \
    esp32/test_host/test_ds200.cpp -o /tmp/t && /tmp/t          # parser C++
cd esp32 && pio run                                             # firmware
```

Con il sito servito in locale c'è anche uno **smoke test nel browser** (serve Playwright)
che apre ogni app, controlla i link di ritorno, il multilingua e gli errori JS:

```bash
cd web && python3 -m http.server 8099 &
node tools/smoke-test.js
```

I due parser (`web/ds200/ds200.js` e `esp32/src/ds200.h`) devono restare **equivalenti**:
se cambi il protocollo, aggiornali entrambi insieme ai test. Li verifica la CI
([`ci.yml`](.github/workflows/ci.yml)).

### Aggiornare le app dalle repo di sviluppo

Le app nascono in due repo separate e qui vengono **copiate**. La prima volta indica dove
si trovano (il file è git-ignored, quindi i percorsi restano sulla tua macchina):

```bash
cp tools/sync.local.conf.example tools/sync.local.conf
$EDITOR tools/sync.local.conf
```

Poi, ogni volta che vuoi riallineare:

```bash
./tools/sync-from-upstream.sh          # --dry-run per vedere cosa farebbe
```

Lo script ricopia le app, riapplica le modifiche locali e rilancia i controlli. Non tocca
`web/index.html` né `web/version.json`, che sono di questa repo.

Le modifiche locali stanno tutte in
[`tools/apply-local-patches.py`](tools/apply-local-patches.py): sono **idempotenti** e, se
a monte cambia il testo su cui si agganciano, lo script **fallisce** invece di lasciar
passare la cosa in silenzio. Servono perché qui i file stanno in posti diversi rispetto
alle repo di origine (l'app DS200 passa da `webapp/` a `web/ds200/`, e `esp32/` resta
fuori da `web/` perché non va pubblicato su Pages).

### Versioni e cache

- `web/sw.js` è **network-first**: ogni ricarica prende l'ultima versione dalla rete e
  la cache serve solo da fallback offline.
- Quando pubblichi un aggiornamento, alza la versione in `web/version.json` **e** la
  costante `SITE_VERSION` in `web/index.html`: le pagine mostrano il banner "Aggiorna".
- La PWA `ds200/` ha una cache **propria** (`web/ds200/sw.js`, cache-first per funzionare
  offline): lì va alzato `CACHE` e le query `?v=` insieme a `APP_VERSION` in `app.js`.

## Segreti: come si evita di pubblicarli

Questa repo è pubblica, quindi password del WiFi, chiavi, token e indirizzi MAC
personali non ci devono finire — e una volta committati restano leggibili nella storia
anche se li cancelli dopo. Ci sono tre reti di protezione, tutte sullo stesso motore
([`tools/scan-secrets.py`](tools/scan-secrets.py)):

| dove | cosa fa |
|---|---|
| **hook `pre-commit`** | blocca il commit se c'è un segreto in staging |
| **hook `pre-push`** | blocca il push se c'è un segreto nei commit in partenza |
| **[Action `secrets.yml`](.github/workflows/secrets.yml)** | ad ogni push/PR, più un giro settimanale: controlla i file **e tutta la storia**; se trova qualcosa il job fallisce e GitHub ti manda la mail |

Gli hook vanno attivati una volta per clone (git non esegue hook versionati da solo,
per ovvi motivi di sicurezza):

```bash
./tools/install-hooks.sh          # imposta core.hooksPath
```

In emergenza si scavalcano con `git commit --no-verify` / `git push --no-verify`, ma
la Action te lo ridirà comunque.

**I tuoi valori personali non vanno messi nelle regole**, altrimenti pubblicarli è
esattamente ciò che stiamo cercando di evitare. Si aggiungono da fuori:

- in locale: `tools/secrets-denylist.local.txt` (git-ignored), una regex per riga;
- in CI: il **GitHub Secret** `SECRET_SCAN_EXTRA`, stesso formato — *Settings → Secrets
  and variables → Actions → New repository secret*.

```
# esempio di contenuto (una riga per valore)
XX:XX:XX:XX:XX:XX          # il MAC del TUO dongle, in esadecimale
laMiaPasswordWiFi
mia\.mail@example\.com
```

I valori trovati vengono sempre stampati **mascherati** (`Re*******5G`): il log di una
Action è pubblico quanto il codice, stamparci dentro il segreto sarebbe autolesionista.

Le regole generiche coprono chiavi private, token GitHub/Slack/AWS/Google, JWT,
indirizzi MAC, URL con credenziali e assegnazioni tipo `PASSWORD=...` (anche nella
forma `#define`). Falsi allarmi: una regex in
[`tools/secret-scan-allow.txt`](tools/secret-scan-allow.txt) oppure il commento
`allow-secret` sulla riga. Le regole hanno i loro test:
`python3 tools/test-scan-secrets.py`.

> Se un segreto è già stato committato, toglierlo non basta: va **cambiata la
> credenziale**, perché resta nella storia (e ripulire la storia richiede di
> riscriverla con `git filter-repo` e forzare il push).

## Licenza e avvertenze

Codice sotto **GPL-3.0** (vedi [LICENSE](LICENSE)).

**Progetto indipendente e non ufficiale.** Non è realizzato, approvato, sponsorizzato né
supportato da **Slot.it / Galileo Engineering** né da **DS Electronic**. «Slot.it»,
«oXigen», «DS Electronic», «DS200» e «DS300» sono marchi dei rispettivi proprietari,
citati solo a scopo di interoperabilità e descrizione.

Il software è fornito «così com'è», **senza alcuna garanzia**. Alcune funzioni
**scrivono** sui dispositivi (configurazione, clone del MAC, reset, DFU) e possono
renderli temporaneamente inutilizzabili: usale **solo su hardware di tua proprietà** e
**a tuo rischio**. Lo stesso disclaimer compare in fondo a ogni pagina, tradotto.
