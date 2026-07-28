# Slotcar - web tools ed esperimenti vari

> ## **🇬🇧English** — Mixed tools for slot cars
> SCP-3 controller configuration over Web Bluetooth, oXigen dongle debugging over Web
> Serial, and a DS200/DS300 lap-timer monitor (RS-232) with an ESP32 flasher. Everything
> is static and runs client-side; the UI is available in Italian, English and Spanish
> (the DS200 app adds French and German).
> 
> *Development builds — made for developers and tinkerers, not (yet) for end users.
> Some tools write to the devices and can leave them unusable. Use at your own risk,
> on your own hardware only.*

 ## ⚠️🤖 AI slop 🤖⚠️!
 Questi strumenti sono dei rapidi test realizzati con IA!
 Sono solo MVP/prototipi! Non utilizzare se non si sa dove mettere le mani!

> ## ✋ Versioni di sviluppo! 
> Sono solo MVP/prototipi
> nascono **per chi programma e sperimenta**: **non sono (ancora)
> pensati per l'utente finale**. Aspettati interfacce grezze, funzioni incomplete e
> qualche errore. Alcune app **scrivono** sui dispositivi (configurazione, indirizzo
> MAC, reset, DFU) e possono renderli temporaneamente inutilizzabili.
>
> Usale **solo su hardware tuo** e solo se sai cosa stai facendo. Nessuna garanzia,
> nessuna assistenza: vedi [Licenza e avvertenze](#licenza-e-avvertenze).


Raccolta di **web app che girano nel browser**, senza installare niente, per tre
famiglie di prodotti da slot car:

- **oXigen / Slot.it** — configurazione via **Web Bluetooth** di chip auto e controller
  SCP-3, e debug del dongle via **Web Serial**.
- **DS Electronic** — monitor/contagiri per i cronometri **DS200 e DS300** via **Web Serial**
  (RS-232), con il flasher del ponte ESP32.
- **Ninco Digital** — contagiri per la **power base N-Digital** via **RS-232**:
  posizioni, giri, benzina e tempi.

Tutte le app sono **statiche**: nessun backend, nessun account, **nessun dato lascia il
dispositivo**. Sono pubblicate su GitHub Pages da una GitHub Action.

## Le app

La pagina iniziale (`web/index.html`) è un **indice** che porta a tutte le app.

| App | Cosa fa | Serve |
|---|---|---|
| [`cronometro/`](web/cronometro/) | **Cronometro web**: gestione gara su qualsiasi sistema — modalità *pratica* e *GP a giri*, guidatori con nome, classifica live, giro veloce, distacchi, annunci vocali, 5 lingue. Sistemi: **pista simulata** (niente hardware) e **DS200/DS300**. PWA, funziona offline | Web Serial (o niente) |
| [`car-config/`](web/car-config/) | Configuratore del **chip auto** oXigen: nome, ID, modalità, velocità, freno, limiti, clone MAC, test motore/luci/sensore hall | Web Bluetooth |
| [`remote-config/`](web/remote-config/) | Configuratore del **controller SCP-3**: nome, brake setting, ID, clone MAC; legge firmware e data di attivazione | Web Bluetooth |
| [`chron02/`](web/chron02/) | **Contagiri e gestione gara** oXigen via dongle: classifica live, giri, tempi e pit dalla telemetria `rf_data_x[13]`; start/pausa/stop e comandi per singola auto con `race_status[10]` | Web Serial |
| [`o2-bootloader/`](web/o2-bootloader/) | **Configuratore oXigen** via dongle: modalità boot su dongle/chip/controller, lettura info (versione firmware, MAC) e console a registri sperimentale | Web Serial |
| [`modes/`](web/modes/) | Riferimento (dai manuali) di **sequenze tasti, LED, pairing e DFU** di controller e chip | niente, è statica |
| [`ds200-ds300/`](web/ds200-ds300/) | **Contagiri DS200 / DS300**: giri, tempi, classifica live, giro veloce, annunci vocali, export CSV. Installabile come PWA, funziona offline | Web Serial |
| [`esp32-installer/`](web/esp32-installer/) | **Installer ESP32** del ponte DS200/DS300 → WiFi/MQTT, con configurazione della rete dal browser. **La cosa più acerba del sito** | Web Serial |
| [`ninco/`](web/ninco/) | **Contagiri Ninco N-Digital**: posizioni, giri, benzina e riserva, modalità amatore/professionale, tempi sul giro (firmware ≥ 1.08), dati grezzi esportabili | Web Serial |

### Il Cronometro web

In cima all'indice, in evidenza, c'è il **Cronometro web**: l'app che gestisce una gara su
*qualsiasi* sistema con la stessa interfaccia. Sta lì apposta, perché tutto il resto sono
strumenti di servizio e diagnostica: i contagiri per singolo sistema restano, ma come
**debugger** di quel sistema.

È fatto di tre pezzi separati, ed è una separazione voluta:

- `race.js` — **il motore**: modalità, giri, tempi, classifica. Non tocca il DOM, non apre
  porte, non usa timer: l'orologio glielo passi tu. Per questo si prova da riga di comando
  (`race.test.js`) senza browser e senza pista.
- `sistemi/` — **gli adattatori**, uno per pista. Traducono quello che dice l'hardware in
  eventi normalizzati, gli stessi per tutti. Ognuno **dichiara cosa sa fare** (`caps`) e
  l'interfaccia si adatta: la colonna della benzina compare solo se qualcuno la manda, i
  comandi di gara solo se qualcuno li accetta.
- `app.js` — **solo interfaccia**. Se ti trovi a scrivere lì una regola di gara, è nel
  posto sbagliato.

I tre sistemi veri **non sono simmetrici**, e le `caps` esistono per questo:

| | DS200/DS300 | Ninco | oXigen | simulazione |
|---|---|---|---|---|
| tempo sul giro | lo manda | per differenza | telemetria | lo manda |
| posizione | la calcoliamo | **la manda la base** | la calcoliamo | la calcoliamo |
| benzina / riserva | — | **sì** | — | sì (finta) |
| stato della gara | **lo annuncia la centralina** | va dedotto | **lo decide l'app** | lo decide l'app |
| comandare la gara | no | no | **sì** | sì |

Quindi "Avvia gara" non può essere un bottone uguale per tutti: con il DS200 il via lo dà la
centralina, con la Ninco lo dà il dito dell'utente, con oXigen lo dà davvero l'app.

**Cosa funziona oggi**: motore, modalità *pratica* e *GP a giri*, guidatori modificabili,
voce e traduzioni, PWA. Due sistemi: la **pista simulata** (che non serve solo a giocare —
è ciò che rende il motore verificabile in CI) e il **DS200/DS300**, che riusa il decoder già
collaudato di `web/ds200-ds300/ds200.js` invece di duplicarlo. ⚠️ Il DS200 è provato con una
seriale simulata che manda i frame della specifica, **non ancora su una centralina vera**.
Ninco e oXigen arrivano dopo.

### Ninco N-Digital: cosa si può fare e cosa no

Il protocollo è documentato in [`docs/ninco/PROTOCOLLO.md`](docs/ninco/PROTOCOLLO.md)
(fonte: slotbaer.de, con copia locale della pagina). In breve: **1200 baud, 7 bit, senza
parità, 1 stop**, testo ASCII, pacchetti terminati da CR, cinque tipi — modalità,
programmazione, passaggio sul traguardo, benzina, risultato.

Tre limiti che vengono dall'apparecchio, non dall'app:

- **La power base trasmette e basta.** Non accetta comandi, quindi la gara **non si
  pilota dal PC**: il filo PC→base è cablato ma inutilizzato.
- **I tempi sul giro esistono solo dal firmware 1.08.** Da lì in poi la base manda il
  tempo *totale* ad ogni passaggio, e il giro si ricava per differenza fra due totali
  consecutivi. Con firmware precedenti restano solo posizioni, giri e benzina.
- **Il conteggio dei giri è ambiguo**: a seconda della modalità di gara `RRRR` sono i giri
  già fatti *oppure* quelli che restano, e il protocollo non dice quale dei due.

⚠️ I segnali sono **RS-232 veri (±12 V)**: un adattatore USB-seriale TTL a 3,3/5 V si
danneggia se collegato direttamente. Serve un convertitore tipo MAX3232.

### Compatibilità browser

Le API usate esistono solo su browser basati su Chromium:

- **Web Bluetooth** (`car-config`, `remote-config`): Chrome/Edge su desktop, Chrome su
  Android. **Non** su Safari/iOS né Firefox.
- **Web Serial** (`chron02`, `o2-bootloader`, `ds200`, `ninco`, `flash.html`): Chrome/Edge/Opera **solo su
  desktop**. Non su Android né iOS. (Android potrebbe esser supportato in futuro, per iOS serve un esp32 "ponte")

Ogni pagina mostra un avviso se il browser non ha l'API che le serve.
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
  cronometro/           il cronometro: motore (race.js) + sistemi (sistemi/) + interfaccia
  car-config/ remote-config/ modes/                  app oXigen (Web Bluetooth + riferimento)
  chron02/ o2-bootloader/                            app oXigen via dongle (Web Serial)
  ds200-ds300/          contagiri DS200/DS300 (PWA autonoma, i18n e sw propri)
  esp32-installer/      installer del firmware ESP32 (app a sé, molto acerba)
  ds200/                stub: rimanda a ds200-ds300/ e disinstalla il vecchio SW
  ninco/                contagiri Ninco N-Digital (parser + test propri)
docs/                 documentazione dei protocolli (non pubblicata su Pages)
esp32/                firmware del ponte DS200 → WiFi/MQTT (PlatformIO)
cli/                  decoder DS200 da riga di comando (Python) + i suoi test
homeassistant/        automazione per annunciare i giri con Piper
tools/
  scan-secrets.py          cerca segreti nei file e nella storia
  install-hooks.sh         attiva gli hook git che bloccano i segreti
  check-links.js           verifica i link interni del sito
  smoke-test.js            apre tutte le app in un browser headless
  test-cronometro.js       fa correre una gara simulata nel cronometro
  test-ninco-ui.js         contagiri Ninco con una seriale simulata
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
python3 tools/scan-secrets.py                                   # segreti nei file
python3 tools/scan-secrets.py --history                         # segreti nella storia
node web/ds200-ds300/ds200.test.js                              # parser DS200 — JS
cd cli && python3 -m pytest tests/ -q                           # parser DS200 — Python
g++ -std=c++17 -I esp32/test_host -I esp32/src \
    esp32/test_host/test_ds200.cpp -o /tmp/t && /tmp/t          # parser DS200 — C++
node web/ninco/ninco.test.js                                    # parser Ninco
node web/cronometro/race.test.js                                # motore di gara + simulatore
cd esp32 && pio run                                             # firmware
```

Con il sito servito in locale c'è anche uno **smoke test nel browser** (serve Playwright)
che apre ogni app, controlla i link di ritorno, il multilingua e gli errori JS:

```bash
cd web && python3 -m http.server 8099 &
node tools/smoke-test.js         # tutte le app: link, i18n, errori JS
node tools/test-cronometro.js    # una gara simulata dentro il cronometro
node tools/test-ninco-ui.js      # contagiri Ninco con seriale simulata
```

### Questa repo è la sorgente di tutto

Niente qui dentro è una copia di qualcos'altro: **si aprono i file e si modificano**.
Non c'è nessuno script di allineamento e nessuna patch da riapplicare.

Non è sempre stato così: le app arrivavano da due repo private e c'erano 16 patch locali
che rimettevano a posto link, disclaimer e percorsi ad ogni copia. Le app oXigen sono state
tolte da lì, e il progetto DS200 è stato migrato per intero — la sua repo
(`ds200rs232`) è **congelata** e il suo sito rimanda qui.

⚠️ **I tre parser del DS200 devono restare equivalenti**: `web/ds200-ds300/ds200.js` (JS),
`cli/ds_slot_serial.py` (Python) ed `esp32/src/ds200.h` (C++). Se cambi il protocollo,
aggiornali tutti e tre insieme ai test — [`ci.yml`](.github/workflows/ci.yml) li verifica
in un colpo solo, cosa che prima non poteva fare nessuno perché stavano in due repo diverse.

### Versioni e cache

- `web/sw.js` è **network-first**: ogni ricarica prende l'ultima versione dalla rete e
  la cache serve solo da fallback offline.
- Quando pubblichi un aggiornamento, alza la versione in `web/version.json` **e** la
  costante `SITE_VERSION` in `web/index.html`: le pagine mostrano il banner "Aggiorna".
- La PWA `ds200/` ha una cache **propria** (`web/ds200/sw.js`, cache-first per funzionare
  offline): lì va alzato `CACHE` e le query `?v=` insieme a `APP_VERSION` in `app.js`.

## Segreti: come si evita di pubblicarli

Ci sono tre reti di protezione, tutte sullo stesso motore
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
- in CI: il **GitHub Secret** `SECRET_SCAN_EXTRA`, **stesso identico formato** (righe
  vuote e commenti `#` vengono ignorati in entrambi i casi, così lo stesso file si carica
  tale e quale).

```
# esempio di contenuto (una riga per valore)
XX:XX:XX:XX:XX:XX          # il MAC del TUO dongle, in esadecimale
laMiaPasswordWiFi
mia\.mail@example\.com
```

Il modo più comodo è tenere il file locale come unica fonte e caricarlo nel secret
con la CLI [`gh`](https://cli.github.com/):

```bash
gh auth login                                    # solo la prima volta

cp tools/secrets-denylist.local.txt.example tools/secrets-denylist.local.txt   # se non c'è
$EDITOR tools/secrets-denylist.local.txt         # metti qui i tuoi valori

# carica il file nel secret della repo (legge da stdin)
gh secret set SECRET_SCAN_EXTRA --repo RobertoD91/slotcar < tools/secrets-denylist.local.txt

gh secret list --repo username/slotcar         # verifica: deve comparire in elenco
```

Per aggiornarlo basta rilanciare lo stesso `gh secret set`: sovrascrive. Il valore non è
più rileggibile da GitHub — la copia buona resta quella locale, che è git-ignored.

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
