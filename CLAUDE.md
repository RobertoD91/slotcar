# CLAUDE.md — memoria di progetto (slotcar)

Repo **pubblica** con le web app per slot car digitali, pubblicate su GitHub Pages.
**Questa repo è la sorgente di tutto**: niente è più una copia, non c'è nessuna
sincronizzazione da fare e nessuna patch da riapplicare. Si modifica direttamente qui.
L'utente è italiano: **rispondere in italiano**.

---

## ⭐ TODO

### In carico all'utente

> ⭐ **Questa è LA lista, e va stampata in fondo a OGNI risposta.** Richiesta esplicita
> dell'utente. Sta qui e non in un file a parte perché `CLAUDE.md` si carica da solo ad ogni
> sessione: una lista che vive solo nella conversazione si perde alla prima compressione del
> contesto — ed è già successo, con due voci sulle app oXigen sparite per strada.
> Regole: quando l'utente conferma una prova, la voce si **sposta** in «Fatto» (non si
> cancella); quando ne nasce una nuova, si **aggiunge qui subito**, nello stesso commit del
> codice che l'ha resa necessaria.

**oXigen — hardware Slot.it** (le targhette dell'indice dicono di quali ci si può fidare)
- [ ] **Configuratore auto** (`car-config/`, BLE sul chip) — targhetta **mai provata**: non
      sappiamo se funziona. Da provare su un chip vero.
- [ ] **Configuratore controller** (`remote-config/`, BLE sull'SCP-3) — targhetta
      **parziale**: il cambio ID funziona, il MAC no. Da riprovare.
- [ ] **Configuratore dongle** (`o2-bootloader/`, USB) — connette e i pulsanti rispondono,
      ma i campi **ID / MAC / velocità box su chip e controller** non sono mai stati provati
      su hardware.
- [ ] **Contagiri oXigen** (`chron02/`, USB) — da riprovare dopo la correzione del filtro
      porte (`requestPort` non filtra più: mostrava una finestra vuota).

**DS200 / DS300**
- [ ] **Prova la voce nuova del DS200** — ora DS200 e DS300 sono due sistemi distinti: il
      baud parte da solo e la modalità la mostra la centralina. Verificare che si colleghi
      senza toccare le avanzate.
- [ ] **Confermare il numero di giri programmato** — metti **12 giri** sulla centralina e
      guarda se scrive 12. Lo leggiamo come BCD e torna con la cattura a 25, ma va
      confermato. Si legge in due posti: la card «Programma» del contagiri e il campo
      «Modalità» del cronometro (che ora dice «12 giri (individuali)»).
- [ ] **Gara a tempo o F1**, se la centralina lo permette — ora l'app le **riporta** invece
      di ignorarle. Quel percorso è provato solo con frame costruiti a tavolino.
- [ ] **Secondo giro di prove in pista**: gara annullata (A7), fine gara vera (A4) e record
      finale. La fine gara ora si annuncia **una volta sola** (la centralina manda il frame
      tre volte): da confermare dal vivo.
- [ ] **Nomi dei guidatori** — riprovare a scriverli di seguito, senza ricliccare dopo ogni
      lettera.

**Ponte ESP32 (nuovo, mai provato — e ora c'è anche il TLS e il Bluetooth)**
- [ ] **Carica firmware E pagine**: dalla cartella `esp32/`, `pio run -t upload` **e poi**
      `pio run -t uploadfs`. Sono due comandi: il primo mette il firmware, il secondo le
      pagine in LittleFS. Se salti il secondo il ponte funziona lo stesso (i frame escono su
      `/ws`, via Bluetooth e su MQTT) ma la radice te lo dice invece di dare un 404 muto.
      ⚠️ Chi installa dal browser non ha questo problema: da ora l'immagine unita
      dell'installer **contiene anche LittleFS**.
- [ ] **Apri `http://ds200.local/`** — deve rimandare al Cronometro web vero, con il sistema
      «DS200/DS300 senza fili (ponte ESP32)» che si collega da solo, senza chiedere niente.
- [ ] **Verifica che le API rispondano ancora**: `/state`, `/info`, `/config`. ⚠️ Il server è
      **cambiato del tutto** (`esp_https_server` al posto di ESPAsyncWebServer): sono le
      rotte più a rischio, perché la regola «la rotta jolly va registrata per ultima» è stata
      riscritta da zero. Se `/state` restituisse una pagina HTML invece del JSON, è quello.
- [ ] **Prova il sistema Bluetooth** (`sistemi/ble.js` ↔ `esp32/src/nus.cpp`): nel Cronometro
      scegli «DS200/DS300 via Bluetooth», il dispositivo deve comparire col suo nome `ds200`.
      È l'unica strada che funziona **dal sito pubblicato** senza configurare niente.
- [ ] **Prova l'https con un certificato tuo**: hai un sottodominio che punta all'indirizzo
      privato → prendi un certificato Let's Encrypt in **DNS-01** e incolla i due PEM su
      `http://ds200.local/cert`. Dopo il riavvio deve rispondere anche su `https://…/`, e dal
      sito pubblicato deve funzionare `wss://<il tuo nome>/ws` nelle opzioni avanzate del
      sistema «senza fili». Se l'https non parte, il motivo è sulla seriale.
- [ ] **Decidi sulle partizioni** — `/update` ora dice la verità guardando il dispositivo:
      con `huge_app.csv` c'è una sola area applicativa, quindi **nessun** aggiornamento via
      rete può funzionare (né web né ArduinoOTA). O si passa a due slot (togliendo spazio a
      BLE+WiFi+TLS), o resta l'aggiornamento via USB. È una scelta tua.

**Ninco**
- [ ] **Prova sul campo del contagiri** (il cavo ce l'ha già). Targhetta **mai provata**.
- [ ] **Auto 8, cifre della benzina invertite** — l'ottava auto viene letta con le due cifre
      scambiate (`42` → `24`). È documentato, ma la fonte non sa dire se valga per tutte le
      power base. Se i valori sono giusti *senza* lo scambio, va cambiato il default della
      casella «auto 8: cifre benzina invertite» in `web/ninco/index.html` (ora è **attiva**).
- [ ] **Cattura reale** — esportarla dalla power base e usarla per verificare la decodifica
      sui casi che la documentazione non copre (modalità GP, gara in pausa, fine gara,
      rifornimenti).

### Cronometro web — le prossime tappe
Motore, simulatore, modalità *pratica* e *GP a giri*, guidatori modificabili, voce, 5 lingue
e PWA ci sono già (`web/cronometro/`, v0.3.0). I sistemi veri arrivano uno alla volta:
- ✅ **sistemi DS200 e DS300** (`sistemi/ds200.js`, due voci distinte) — riusano il decoder di
      `web/ds200-ds300/ds200.js` (caricato dalla pagina, non duplicato). **Provato su
      centralina vera** e sistemato con la cattura dell'utente (vedi sotto). Il record
      finale porta il tempo TOTALE, non un giro: resta a registro e non entra in classifica.
- [ ] **sistema Ninco** — parser in `web/ninco/ninco.js`. `caps`: `position` (la manda la
      base), `fuel`, `slotLabel:'car'`. Il tempo sul giro è per differenza fra due totali.
- ✅ **sistema ponte ESP32** (`sistemi/esp32.js`) — la stessa centralina senza cavo al
      computer. ⭐ **NON è un protocollo nuovo**: il firmware mette il frame GREZZO dentro
      il JSON che manda su `/ws`, e il sistema lo dà allo **stesso decoder** del cavo,
      ereditando da `Ds200Sistema`. Perciò il file è corto e non c'è un secondo formato da
      tenere allineato. Il test E2E rigioca la **stessa cattura** per questa strada e
      pretende la stessa identica classifica. **Mai provato su hardware.**
- ✅ **sistema BLE** (`sistemi/ble.js`) — lo **stesso ponte**, per Bluetooth invece che per
      rete. Eredita anch'esso da `Ds200Sistema`: cambia solo il trasporto. ⭐ Esiste per una
      ragione sola ma pesante — **il contenuto misto**: una pagina `https://` non può aprire
      un `ws://` verso un indirizzo di LAN, e nessuna autorità firma un certificato per un IP
      privato. Web Bluetooth invece parla al dispositivo direttamente, senza rete e senza
      certificati: è **l'unico trasporto che funziona dal sito pubblicato** senza configurare
      niente. In cambio niente iOS, un client per volta, una decina di metri — cioè
      esattamente i tre casi che copre il WebSocket. Non sono alternative: il ponte le espone
      **tutte e due insieme**. Il test E2E rigioca la stessa cattura anche per questa strada,
      spezzando i frame **20+1 byte** come fa il NUS. **Mai provato su hardware.**
- [ ] **sistema oXigen** — l'unico con `control:true`: la gara la comanda l'app
      (`race_status[10]`). Serve il dongle.
- [ ] **GP a tempo** e **qualifiche** — dopo il GP a giri. La regola vive tutta in
      `MODES` dentro `race.js`.
- [ ] **guidatori con database, punti e classifica di campionato** — richiesta dell'utente,
      rinviata a un'evolutiva. Oggi i nomi stanno in `localStorage`.

### Da fare nel codice
- [ ] **OTA e partizioni** — *verificato*: `huge_app.csv` ha una sola area applicativa, e
      `/update` ora lo **dice guardando il dispositivo** (`esp_ota_get_next_update_partition()`
      torna NULL) invece di offrire un modulo che fallisce. Resta la scelta: partizioni a
      doppio slot (meno spazio per BLE+WiFi+TLS, e con il TLS il firmware è a 1,4 MB su 1,75
      che ne avanzerebbero) oppure tenersi l'aggiornamento via USB. **Decisione dell'utente.**
- [ ] **L'installer ESP32 è solo in italiano** — non è passato per `i18n.js` come il resto.
      (Era indicato come `flash.html`, un file che non esiste più: oggi è
      `web/esp32-installer/index.html`.)
- [ ] **Dipendenza esterna da unpkg** in `web/esp32-installer/index.html` (esp-web-tools).
      Per un sito 100% autonomo va incorporata: serve un bundler, è un modulo ES con
      dipendenze sue. Finché resta, quella pagina **non funziona offline** — ed è l'unica.
- [ ] **Il timer di `chron02` scorre da solo** — come quello che abbiamo tolto dal DS200, ma
      il caso NON è lo stesso e per questo è rimasto: lì la gara la comanda **l'app** (manda
      `race_status`), quindi il tempo misura una cosa che ha causato lei, non un dato che si
      inventa su un dispositivo muto. Da decidere quando il cronometro avrà il sistema
      oXigen: allora `chron02` diventa un debugger puro e il timer se ne va con lui.

### Fatto (per non riaprirlo)
- ✅ Pages attivo, con dominio personalizzato → `https://robertodisanto.it/slotcar/`
- ✅ **Enforce HTTPS** attivato dall'utente (senza, Web Serial/Bluetooth non esistono)
- ✅ GitHub Secret `SECRET_SCAN_EXTRA` caricato dall'utente
- ✅ Firmware della power base Ninco dell'utente = **l'ultima** ⇒ ≥ 1.08 ⇒ **i tempi sul
  giro arrivano** (pacchetto `D` ad ogni passaggio)
- ✅ `chron02` e `o2-bootloader` pubblicate; **`dongle-debug` rimossa** perché ridondante
  (gara e telemetria stanno in `chron02`, le info in `o2-bootloader`, e la sua «zona
  pericolosa» con i comandi distruttivi non serviva)

---

## Regole d'oro

- ⭐ **A OGNI risposta, in fondo, stampa l'elenco «cosa tocca a te»** — richiesta esplicita
  dell'utente. La fonte è la sezione **«In carico all'utente»** qui sopra, non la memoria
  della conversazione: da lì si legge e lì si aggiorna. Quando l'utente conferma una prova
  la voce si sposta in «Fatto»; quando una modifica ne crea una nuova, si aggiunge **nello
  stesso commit**. Motivo: le voci tenute solo a mente sono già sparite due volte (le prove
  sulle app oXigen), e un elenco che perde pezzi è peggio di nessun elenco — l'utente crede
  di aver finito.
- **Branch: `master`.** Richiesta esplicita dell'utente, niente branch inutili.
- **`web/` è il sito.** Il workflow `pages.yml` la pubblica tal quale ad ogni push su
  `master`. Percorsi **sempre relativi**: il sito sta in un sottopercorso.
- **Tutto è sorgente: si modifica qui, e basta.** Non c'è più niente di copiato da altre
  repo, quindi niente sync e niente patch: si aprono i file e si cambiano.
- ⭐ **Il firmware NON contiene una copia del sito.** Le pagine stanno in LittleFS e ce le
  mette `esp32/scripts/copy_webapp.py` ad ogni `pio run`. C'era un `src/web_index.h`
  incollato a mano ed è invecchiato per mesi in silenzio: quando l'abbiamo tolto aveva
  ancora la tavolozza rossa, un suo dizionario a 5 lingue e il cronometro che scorreva da
  solo — cioè proprio l'antipattern appena eliminato dall'app vera. Conseguenza pratica:
  **il filesystem fa parte del prodotto**. `pio run -t upload` da solo installa un ponte
  senza interfaccia; serve anche `uploadfs`, e l'immagine unita dell'installer include
  `littlefs.bin`.
- ⭐ **Il server dell'ESP32 è `esp_https_server`, non ESPAsyncWebServer.** Quello non sa
  fare TLS e il ponte deve terminare lui l'https (niente proxy davanti: richiesta esplicita
  dell'utente). L'alternativa era tenere l'async su :80 e affiancargli un secondo server
  per :443 — cioè **due elenchi di rotte**, la stessa copia-che-invecchia di `web_index.h`
  spostata di un metro. `esp_https_server` sta già nell'SDK (nessuna libreria in più,
  WebSocket compreso) e ha il trasporto come **campo di configurazione**: `registraRotte()`
  gira su entrambi gli ascoltatori e l'elenco esiste una volta sola. Il perché disteso è in
  cima a `esp32/src/web.cpp`.
- ⚠️ **I TRE PARSER DEL DS200 devono restare equivalenti**: `web/ds200-ds300/ds200.js` (JS),
  `cli/ds_slot_serial.py` (Python) ed `esp32/src/ds200.h` (C++). Se cambia il protocollo si
  aggiornano tutti e tre insieme ai test. Ora stanno nella stessa repo e li verifica un
  solo workflow — prima erano divisi fra due repo e nessuno controllava che non
  divergessero.
- **Segreti**: hook `pre-commit`/`pre-push` + Action. Attivali con
  `./tools/install-hooks.sh` (una volta per clone). I valori personali **non** vanno nel
  codice: `tools/secrets-denylist.local.txt` (git-ignored) e il secret `SECRET_SCAN_EXTRA`.
- **Versioni**: se pubblichi un aggiornamento alza `web/version.json` **e** `SITE_VERSION`
  in `web/index.html`, altrimenti compare il banner «Aggiorna» a vuoto. Le PWA
  (`ds200-ds300/`, `cronometro/`) hanno una cache propria **cache-first**: lì vanno alzati
  anche `CACHE` in `sw.js`, le query `?v=` e `APP_VERSION` — se te ne dimentichi, chi ha
  già aperto la pagina resta sulla copia vecchia per sempre.
- ⭐ **I colori stanno in `web/ui.css`, uno solo — e lo verifica `check-style.js`.** Se
  aggiungi una pagina, linka quello e non ricopiare `:root{--bg:…}`: prima era copiato in
  sette file e aveva già prodotto due rossi e quattro gialli diversi. `ui.css` va caricato
  **prima** dello stile della pagina, così il layout locale vince. Due deroghe, entrambe da
  motivare per iscritto: `colore-esterno: <perché>` su una riga (il nastro di GitHub deve
  restare del colore di GitHub) e `stile-autonomo: <perché>` in cima a un file (lo stub
  `ds200/` disinstalla un service worker: non può dipendere da un foglio che arriva proprio
  da quel service worker).
- ⭐ **La cornice dei debugger sta in `ui.css` sotto `body.app`**: intestazione, riquadri,
  pulsanti, campi, `.pill`, tabelle, `#log`, `.banner`. Una pagina la indossa scrivendo
  `<body class="app">` e sceglie la sua larghezza con `:root{--wrap:NNNpx}`. È **opt-in**
  apposta: dentro ci sono selettori di elemento (`button`, `input`, `table`), e liberi
  arrivavano anche all'indice e al cronometro — che non l'hanno chiesta. Tutto è avvolto in
  `:where()`, che pesa zero: la cornice è ambientata ma resta scavalcabile dal foglio
  dell'app, come promette questo elenco.
- **Le fasce (`.banner`) partono nascoste con l'attributo `hidden`, non con un `display:none`
  nel CSS**: c'è chi le accende con `style.display` (che scavalca tutto) e chi togliendo
  `hidden` (che NON scavalca una classe). Con la regola nella classe, il secondo gruppo non
  si vedrebbe mai più.
- **Commit trailer**: mantieni `Co-Authored-By` / `Claude-Session`. **Mai** l'id del modello
  in file committati.
- **Linguaggio (richiesta utente)**: non usare la parola «reverse» (né «reverse engineering»
  o «ingegneria inversa») né nei testi delle app né nelle risposte. Si parla di *analisi del
  protocollo*, *studio*, *ipotesi da confermare*. Vale anche per il metodo JS `.reverse()`,
  che ovviamente resta: è codice, non prosa.

## Dove investire sulla grafica (decisione presa)

**Il Cronometro web è l'unica app che merita disegno su misura.** Tutto il resto sono
**debugger**: strumenti da leggere, non da guardare. Devono essere *uniformi e leggibili*,
e usare `ui.css` senza personalità propria — una diagnostica bella ma diversa dalle altre
costa manutenzione e non serve a nessuno.

⚠️ Uniformare **non vuol dire buttare via**: se un debugger ha una soluzione migliore
(tipografia, un numero grande leggibile a distanza, una testata più chiara), quella sale
in `ui.css` o nel cronometro, e *poi* si appiattisce il resto.

**Fatto.** Il DS200/DS300 era il caso tipico — nasceva come progetto a sé, con una
tavolozza propria (`--panel`, `--line`, `--accent` rosso) e nessun tema chiaro. Il suo
numero grande è **salito nel cronometro**, dove un orologio ha senso perché il modello di
gara ne possiede uno; poi il DS200 è diventato un debugger come gli altri.

⭐ **E il suo cronometro è stato tolto, non ridotto.** Scorreva da solo, agganciandosi ogni
tanto ai dati: a centralina spenta continuava a contare una gara che non stava correndo.
**Un debugger non inventa dati.** Ora il numero è *l'ultimo tempo che la centralina ha
trasmesso* — sta fermo finché non ne arriva un altro, e a riposo mostra «—», non
«00:00:00.00» (che sarebbe una bugia con l'aria di un dato). L'unica cosa che scorre da
sola è «da quanto non arriva niente», che è un fatto sul **collegamento** e si legge anche
a centralina spenta. Lo tiene fermo `tools/test-ds200-ui.js`: aspetta tre secondi in
silenzio e pretende che il numero non si sia mosso.

## Cornice della pagina: dove stanno le cose

- **Selettore lingua: in alto a SINISTRA, su tutte le pagine.** A destra c'è il nastro
  «Fork me on GitHub» dell'indice: stando a destra il selettore doveva schivarlo con
  un'eccezione, e il risultato era che cambiava lato fra l'indice e le app. A sinistra il
  margine è libero ovunque, perché il link di ritorno sta nella colonna centrata.
- **Link di ritorno: in alto a sinistra**, `<a class="back" href="../">`.
- ⭐ **Interruttore chiaro/scuro accanto al selettore lingua, su tutte le pagine**
  (`web/tema.js`, caricato da ogni `index.html`). **Tre** stati, non due: *auto* (segue il
  sistema, ed è il predefinito), *chiaro*, *scuro* — un interruttore a due posizioni
  costringerebbe a scegliere, buttando via `prefers-color-scheme`, che per la maggior parte
  della gente è già la risposta giusta. In «auto» l'attributo `data-theme` si **toglie**, non
  si mette a "auto": così tornano a valere la media query e i valori di `:root`.
  ⚠️ È un file a sé perché i motori di traduzione sono **due** (`web/i18n.js` a 3 lingue che
  si disegna il selettore, e quelli di cronometro e DS200 a 5 lingue col selettore nel
  markup): un pezzo che deve stare ovunque non può vivere dentro uno dei due.
- **Bandierine nel selettore lingua.** ⚠️ Sono coppie di indicatori regionali: su Windows non
  esistono nel font di sistema e si vedono le due lettere (IT, EN…). Non è un difetto da
  correggere — per questo accanto resta scritto il **nome** della lingua.
- **Il selettore è NEL FLUSSO, non un riquadro flottante.** `i18n.js` lo inserisce subito
  dopo `a.back` se c'è, altrimenti in cima al corpo (l'indice, che non ha ritorno). Era
  `position:fixed` in un angolo, e un riquadro flottante deve schivare qualunque cosa gli
  capiti vicino — sull'indice il nastro, altrove niente: da lì l'eccezione, e dall'eccezione
  il cambio di lato. Nel flusso non schiva niente e scorre col contenuto.

## Targhette di stato — la convenzione

Il colore risponde a **una domanda sola: quanto ci si può fidare?** Le classi
stanno in `web/ui.css`, non ricopiarle.

| classe | colore | significa |
|---|---|---|
| `ok` | verde | provata su hardware vero, **funziona** |
| `partial` | giallo | provata: qualcosa va, qualcosa no |
| `untested` | giallo | **mai** provata su hardware: non lo sappiamo |
| `broken` | rosso | provata, e **non** funziona |
| `wip` | blu | in costruzione, ci stiamo lavorando adesso |
| `rough` | grigio | esiste ma è appena abbozzata |
| *(nessuna)* | — | pagina statica: non ha uno stato da dichiarare |

⚠️ **Il rosso è riservato a «provato e non va».** «Non lo sappiamo» è giallo:
sono due informazioni diverse, e dipingerle uguali toglie a chi legge l'unica
cosa che gli serve — se vale la pena provarci.

## Controlli (nessun hardware)

```bash
node tools/check-links.js                     # link interni + nessun percorso assoluto
node tools/check-versions.js                  # versioni nel codice == version.json (+ FW_VERSION == manifest)
node tools/check-style.js                     # i colori vengono TUTTI da ui.css
python3 tools/scan-secrets.py                 # segreti nei file
python3 tools/scan-secrets.py --history       # segreti in tutta la storia
python3 tools/test-scan-secrets.py            # le regole dello scanner
node web/ds200-ds300/ds200.test.js            # parser DS200 — JS
cd cli && python3 -m pytest tests/ -q         # parser DS200 — Python
g++ -std=c++17 -I esp32/test_host -I esp32/src esp32/test_host/test_ds200.cpp -o /tmp/t && /tmp/t
node web/ninco/ninco.test.js                  # parser Ninco
cd esp32 && pio run && pio run -t buildfs      # firmware + immagine LittleFS

# col sito servito in locale (servono Playwright e NODE_PATH=/opt/node22/lib/node_modules)
cd web && python3 -m http.server 8099 &
node tools/smoke-test.js                      # tutte le app: link, i18n, errori JS
node tools/test-cronometro.js                 # una gara simulata dentro il cronometro
node tools/test-ninco-ui.js                   # contagiri Ninco con seriale simulata
node tools/test-o2bootloader.js               # configuratore dongle: frame e blocchi di sicurezza
node tools/test-ds200-ui.js                   # contagiri DS200: il numero NON avanza da solo
```

## Da dove viene questa roba (storia, per capire il presente)

Le app nascevano in due repo private e qui arrivavano **copiate**, con 16 patch locali che
rimettevano a posto link, disclaimer e percorsi ad ogni allineamento. Ora è tutto finito:

- le app **oXigen** sono state tolte dalla repo privata (che tiene solo lo studio dei
  protocolli, i firmware e i tool) → **−9 patch**;
- il **DS200** è stato migrato per intero da `ds200rs232`, che è stata **congelata**: il suo
  README dice che è superata e il suo GitHub Pages **rimanda qui** → **−7 patch**.

⇒ **zero patch, zero sync, zero copie.** Se trovi in giro riferimenti a
`sync-from-upstream.sh` o `apply-local-patches.py`, sono resti da cancellare: quegli
strumenti non esistono più.

## Protocolli — dove sono documentati

- **Ninco N-Digital** → `docs/ninco/PROTOCOLLO.md`. 1200 baud **7 bit** N1, ASCII, pacchetti
  chiusi da CR. Tipi: `M` modalità, `P` tasto Menu, `L` passaggio (giri capofila +
  posizione/velocità per 8 auto), `F` benzina (`I5` = riserva), `D` risultato.
  ⚠️ Fonte `slotbaer.de`: risponde **solo su `www.` e solo in HTTP** (senza `www.` il DNS
  non risolve, e WebFetch forza HTTPS → usa `curl`). Copia locale nella stessa cartella.
  I **tempi sul giro** si ricavano per differenza fra due totali `D` consecutivi.
  La base **non accetta comandi**: si può solo leggere.
- **DS200/DS300** → `docs/ds200-ds300/`. 21 byte, start `0xE0`, end `0xEB`, BCD.
  **DS200 = 4800 baud, DS300 = 57600.** App in `web/ds200-ds300/`, installer del firmware
  in `web/esp32-installer/` (separati apposta: il secondo è molto più acerbo).
  I **tre** parser (JS, Python, C++) devono restare
  equivalenti — vedi le regole d'oro.
- **Ponte ESP32** → `esp32/README.md`. Non è un protocollo: il firmware decodifica con lo
  stesso parser e riespone **gli stessi byte** su tre trasporti (WebSocket con il frame
  grezzo dentro il JSON, Bluetooth NUS con i 21 byte nudi, MQTT). Per questo i sistemi
  `esp32.js` e `ble.js` ereditano da `Ds200Sistema` e sono corti: cambia solo come
  arrivano i byte, non cosa sono.
- **Slot.it / oXigen** → `docs/slot.it/`. Lo studio del protocollo sta nella repo privata.
  La **guida rapida** (tasti, LED, pairing, DFU) è la web app `web/guida-oxigen/`, che si
  chiamava `modes/`: il vecchio percorso resta come stub che rimanda.

## Cronometro web — com'è fatto (`web/cronometro/`)

Tre pezzi, e la separazione è il punto:

- **`race.js` = il motore.** Modalità, giri, tempi, classifica. Niente DOM, niente porte,
  niente timer: l'orologio si passa da fuori (`opts.now`). Per questo `race.test.js` fa
  correre gare intere da riga di comando, al millisecondo, senza browser.
- **`sistemi/` = gli adattatori**, uno per pista. Traducono l'hardware in eventi
  normalizzati: `lap`, `state`, `presence`, `telemetry`. Contratto e classe base in
  `sistemi/registry.js`; `sistemi/sim.js` è la pista finta.
- **`app.js` = solo interfaccia.** Una regola di gara scritta lì è nel posto sbagliato.

**Vocabolario** (vale in tutto il codice, richiesta dell'utente):
- **guidatore** = la persona. Nome modificabile, salvato in `localStorage`.
- **posto** (`slot` nel codice) = la corsia o il numero dell'auto. A video diventa
  "Corsia N" o "Auto N" a seconda di `caps.slotLabel`.
- **sistema** = l'adattatore verso una pista. Non "driver": si confonderebbe con chi guida.

**I tre sistemi non sono simmetrici** — è il motivo per cui esistono le `caps`:

| | DS200/300 | Ninco | oXigen | sim |
|---|---|---|---|---|
| tempo giro | lo manda | per differenza | telemetria | lo manda |
| posizione | calcolata | **la manda la base** | calcolata | calcolata |
| benzina | — | **sì** | — | sì (finta) |
| stato gara | **lo annuncia la centralina** | dedotto | **lo decide l'app** | l'app |
| modalità e traguardo | **suoi** | dell'app | dell'app | dell'app |
| comandi | no | no | **sì** | sì |

⇒ "Avvia gara" non può essere un bottone uguale per tutti: `comando()` in `app.js` manda
sempre al motore, e al sistema **solo** se `caps.control`.

⭐ **Chi possiede una cosa decide chi la scrive.** È la regola che tiene insieme il
cronometro, e vale campo per campo:
- il **traguardo** e la **modalità**, col DS200/DS300, sono della centralina: li programmi
  sulla scatola e lei li annuncia nel frame di partenza. L'app **non li chiede** — niente
  menu, niente casella — e prima che lei parli scrive «—», non un valore avanzato da prima.
- La centralina sa correre in **quattro** modi (giri individuali, giri totali, a tempo, F1);
  il motore ne sa arbitrare **due**. Gli altri due si **riportano**: giri, tempi e classifica
  si registrano lo stesso, il traguardo non lo mettiamo noi e la bandiera la sventola lei.
  Fingere una modalità che non sappiamo applicare sarebbe peggio che ammetterlo.
- **Un dato, un posto**: il numero di giri sta scritto nel programma («25 giri
  individuali») e la casella «Giri» sparisce. Ripeterlo in un campo grigio vuol dire dire
  due volte la stessa cosa e invitare comunque a cambiarla.

⚠️ **Passivo non vuol dire debugger.** La differenza fra il cronometro e il contagiri non è
chi decide le regole — è *cosa mostrano e a chi*. Il contagiri mostra **frame**: byte,
checksum, campi; serve a studiare il protocollo. Il cronometro mostra **la gara**: nomi dei
guidatori, distacco, giro veloce, voce, CSV, il numero grande da leggere a due metri. Un
tabellone a bordo pista è completamente passivo — non fa partire niente — e nessuno lo
chiama debugger.

**Chi comanda la gara** (`SISTEMI.authority`, da `caps`): se il sistema accetta comandi
comanda l'app (simulazione, oXigen); se annuncia soltanto comanda lui (DS200/DS300); se non
fa né l'uno né l'altro comanda l'app perché non c'è nessun altro (Ninco). Da quel valore
discendono **tre** cose che prima erano incoerenti fra loro: i pulsanti di gara spenti col
DS, il motore che non chiude la gara al traguardo, e il fatto che i comandi vadano al
sistema solo se li accetta.

**Il DS200, quello che dice davvero** (cattura dell'utente, fatta a fixture del test E2E):
- sequenza di **partenza**: `A1` → `A2` → `A3` → passaggi;
- sequenza di **ripresa dalla pausa**: `A5` → `A6` → **`A2` → `A3`** → passaggi. La
  centralina RIFA' il semaforo. ⚠️ La fase 1 compare **solo** alla partenza vera: è quello
  il criterio per distinguere «gara nuova» da «si riparte», e ci ha risparmiato l'euristica.
- il frame di **fase 1 porta il programma di gara**: tipo-dato `0x3C` (giri individuali) e
  funzione `A1` **insieme** — guardare solo il tipo-dato faceva sparire la partenza. I due
  byte del «programme» danno il numero di giri (`0x25` → 25, letto in BCD: **da confermare**
  su un'altra programmazione).
- `DS200 = 2 corsie, DS300 = 8`, e **quale dei due sia lo dice il byte 4 di ogni frame**:
  il limite di posti si aggiusta da solo, non serve chiederlo.
- ⭐ **DS200 e DS300 sono DUE SISTEMI distinti** nel menu, non un'opzione dello stesso:
  cambiano corsie (2 / 8) e baud (4800 / 57600). Una voce sola obbligava a scegliere il
  **baud** — cioè a ricordare un numero — per dire una cosa che sai benissimo, cioè quale
  scatola hai sul tavolo. Il baud è sceso fra le **avanzate**, si tocca solo per provare, e
  se il byte 4 dice l'altro modello l'app lo **scrive nel registro** invece di correggere
  in silenzio.

⭐ **La precisione è una proprietà del SISTEMA, non della grafica** (`caps.timeDecimals`):
il DS200/DS300 trasmette `HH:MM:SS.dddd`, cioè **diecimillesimi**; il Ninco manda `MMSSCC`,
cioè centesimi; oXigen centesimi via telemetria. Mostrarne quattro dove ne arrivano due
vuol dire inventarne due, e mostrarne due dove ne arrivano quattro vuol dire buttarne via.
Tre regole:
- **il contagiri** (debugger) mostra sempre quello che è arrivato, tutte le cifre;
- **il cronometro** mostra `caps.timeDecimals` del sistema collegato;
- **la voce dice sempre i centesimi**, in tutti i sistemi: è come si citano i tempi, e
  quattro cifre lette ad alta voce sono incomprensibili (scelta dell'utente).

⚠️ Le cifre in più servono soprattutto all'**ordine**, non alla vetrina: il tempo sul giro
arriva al motore **senza arrotondamento**, così due giri pari ai centesimi restano
distinguibili e il giro veloce non è una lotteria. Il grande orologio resta a due decimali:
è un tempo di gara, non un tempo sul giro, e a distanza le cifre in più sono rumore.

**Scelte già prese, per non ridiscuterle:**
- **GP a giri**: alla bandiera la gara si chiude, gli altri restano ai giri fatti. Chi passa
  dopo non incrementa più (`_lap` conta solo con stato `running`).
- **Prima del via i giri non contano**: le auto girano per scaldare e la pista trasmette lo
  stesso. Il passaggio serve solo a dire "questo posto è occupato".
- **Doppioni**: se il sistema manda il numero di giri, comanda quello; se non lo manda, si
  scartano i passaggi a meno di `minLapMs` (500 ms) l'uno dall'altro.
- **Il primo giro non è un record**: `best` è vero solo quando si migliora davvero.
- **Il simulatore ha il seme fisso** (`SIM.plan()` è puro): stessa gara tutte le volte, ed è
  ciò che rende il motore verificabile in CI.
- **Azzerare è un'azione esplicita** (`command('newrace')`), mai un effetto collaterale di
  uno stato. Era il difetto che cancellava la classifica ad ogni ripresa dalla pausa.
- **Rete di sicurezza**: il numero di giri non torna mai indietro. Se torna indietro, la
  pista ha ricominciato a contare → gara nuova. Vale anche se l'annuncio di partenza si
  perde o se ci si collega a gara iniziata.

## Trappole già pagate

- **i18n**: `i18n.js` costruisce il dizionario su `DOMContentLoaded`. Chi disegna prima
  vede la **chiave** al posto del testo, e agganciarsi solo a `i18n:changed` non basta
  (nessuno cambia lingua per leggere lo stato). Ri-disegna anche su `DOMContentLoaded`.
  Lo smoke test controlla le chiavi grezze su tutte le pagine.
- **Web Serial/Bluetooth solo in contesto sicuro**: su `http` non esistono, e il messaggio
  «browser non supportato» è fuorviante. L'indice passa da sé a `https`.
- **La power base Ninco ripete i pacchetti**: un totale non crescente va ignorato, o si
  contano giri da 0 ms e il giro veloce diventa 0.
- ⭐ **Anche il DS200 ripete OGNI frame tre volte**, e non basta che chi cambia stato si
  difenda: `_setState` usciva subito se lo stato non cambiava, ma l'evento `end` lo emetteva
  `_finish`, *prima* di quella guardia — e la voce annunciava il vincitore tre volte. Ogni
  transizione che produce un evento va resa **idempotente dove l'evento nasce**, non dove lo
  stato cambia.
- ⭐ **Ridisegnare una lista mentre ci si scrive dentro.** Rinominare un guidatore emetteva
  `roster`, chi ascolta ricostruiva l'elenco, e la casella sotto le dita spariva col fuoco
  dentro: dopo ogni lettera bisognava ricliccare. Due lezioni: un evento deve dire *cosa* è
  cambiato (`roster` = chi c'è, non come si chiama), e chi ricostruisce un pezzo di pagina
  che può contenere il fuoco deve **ricordarsi dov'era il cursore**. Il test lo prende solo
  se scrive **lettera per lettera** (`pressSequentially`): con `fill()` non si vede nulla.
- **Un'auto in riserva ha `fuel === null`**: se il filtro della tabella guarda solo il
  livello numerico, sparisce proprio quando serve vederla.
- ⭐ **`git reset --hard` — e anche `git checkout <file>` — in una prova** buttano via le
  modifiche non ancora committate. È successo davvero: durante una prova di `check-style.js`
  un `git checkout web/ninco/index.html` ha riportato indietro l'attributo `hidden` che
  avevo aggiunto pochi minuti prima, e siccome `.banner` non nasconde più da sé il contagiri
  Ninco ha detto «browser non supportato» su un Chrome che la Web Serial ce l'ha. Nessun
  test lo vedeva: nel browser dei test la Web Serial non c'è, quindi la fascia si accendeva
  per un motivo legittimo. Ora lo smoke test controlla la cosa **strutturale** — ogni
  `.banner` deve avere `hidden` nel markup — che è l'invariante vera.
- ⭐ **Un `<select>` è largo quanto la sua opzione più lunga**, e in un contenitore flex
  senza `min-width:0` quella larghezza diventa la larghezza della PAGINA. Aggiungere il
  sistema BLE — un nome lungo in un menu a tendina — bastava a far scorrere di lato tutto
  il cronometro a 320 px. La cosa notevole è che il difetto non sta dove sta la modifica:
  il file toccato era `sistemi/ble.js`, il sintomo in `styles.css`. Lo prende lo smoke test,
  che misura `scrollWidth` su ogni pagina; nessuna lettura del diff l'avrebbe visto.
- ⭐ **Grid e flex non si restringono sotto il proprio contenuto** finché non gli dici
  `min-width:0`. Con una tabella dentro, la colonna si allarga fino a contenerla e a
  scorrere in orizzontale diventa **tutta la pagina**: si sposta tutto — titoli, testo,
  pulsanti — per colpa di una colonna sola. Avvolgere la tabella in un `overflow-x:auto`
  **non serve a niente** senza quel `min-width:0`. Stessa storia per `<pre>`: conserva le
  righe com'erano scritte, e senza `overflow-x:auto` sfonda la pagina.
  Lo controlla lo smoke test a 320 px, su tutte le pagine.
- **Un predefinito può nascondere la funzione principale.** Nel configuratore dongle la card
  dei campi (ID, MAC, velocità box) parte vuota, perché quei campi stanno sul chip e sul
  controller e il selettore predefinito è «dongle». Era corretto e spiegato, ma chi apriva
  l'app vedeva solo un paragrafo e concludeva che la funzione non c'era. Spiegare non basta:
  se lo stato predefinito è vuoto, mettici l'azione che lo riempie (lì, due pulsanti).
- **Un pulsante attivo promette che funzionerà.** Nel configuratore dongle i comandi a
  registri erano abilitati appena connessi, ma hanno senso solo dentro una sessione di
  boot: fuori, il frame parte e non torna niente. Chi li premeva vedeva una risposta vuota
  e nessun indizio sul passaggio mancante. Se un'azione ha una precondizione, il pulsante
  resta spento e **dice quale**: vale qui come per i comandi di gara col DS200.
- ⭐ **`requestPort({filters:[…]})` non suggerisce: IMPONE.** Il browser mostra soltanto le
  porte che combaciano, e se il dispositivo si presenta con un VID/PID diverso — un
  adattatore seriale in mezzo, un bootloader diverso, un'altra generazione di dongle — la
  finestra esce **vuota** senza spiegare niente. È il difetto per cui il dongle si vedeva
  su altri siti (che non filtrano) e non nelle nostre app. Regola: **mostra tutte le
  porte**, e dopo l'apertura confronta `port.getInfo()` con il VID/PID atteso e **avvisa**.
  Un avviso, non un divieto. Lo stesso vale per Web Bluetooth (`acceptAllDevices` contro
  `filters`), con l'aggravante che lì i filtri servono anche a limitare i permessi.
- ⭐ **Un cronometro che scorre da solo dentro un debugger.** Il DS200 aveva un orologio
  libero, agganciato ogni tanto ai dati: sembrava corretto perché *ogni tanto* combaciava,
  ma fra un aggancio e l'altro raccontava un tempo che nessuno gli aveva detto — e a
  centralina spenta continuava. Nessun test di parser può vederlo: serve il **tempo che
  passa**, cioè un test che aspetta in silenzio e pretende che il numero non si muova.
- **Una lista di eccezioni senza il perché invecchia in silenzio.** In `check-style.js` le
  deroghe si scrivono con un motivo (`colore-esterno:`, `stile-autonomo:`) proprio per
  questo: una whitelist muta finisce per coprire i casi che il controllo doveva prendere.
- **Un tag che si mangia il precedente**: inserire `<script>…</script>` cercando
  `</script>\n</body>` sostituisce **anche** la chiusura del blocco che c'era prima, e il
  nuovo tag finisce dentro quello vecchio → `SyntaxError: Unexpected token '<'`. L'ha beccato
  lo smoke test, non la lettura del diff.
- **`maxlength` tronca prima che il JS ripulisca**: su un campo MAC con `maxlength="4"`,
  incollare `52 5d` dà `52 5` e poi `525` — una cifra persa. Se il valore va normalizzato,
  il limite lo deve fare il filtro (prima togli, poi taglia), non l'attributo.
- ⭐ **`hidden` è un attributo, e qualunque classe con `display:` lo scavalca.** Con
  `.fld{display:flex}`, mettere `hidden` su un campo **non lo nascondeva** — e non lo diceva
  nessuno: restava a video mentre il codice era convinto di averlo tolto. È la stessa
  trappola delle fasce in `ui.css` vista dall'altro lato; nel cronometro la chiude
  `[hidden]{display:none !important}` in cima al foglio.
- **Una riga di suggerimento sotto un campo sfalsa tutta la fila**: i campi si allineano in
  fondo (`align-items:flex-end`), quindi quello più alto alza la propria etichetta e le
  altre restano indietro. Se la nota è corta, sta **nell'etichetta**, non sotto il campo.
- **Nomi di classe che si scontrano fra `ui.css` e l'app**: `.note` è un riquadro giallo nel
  foglio condiviso e una riga smorzata nella guida oXigen. Riusare un nome per un'altra cosa
  richiede di azzerarlo per intero (sfondo, bordo, padding), o te lo porti dietro.
- ⭐ **`caps` dichiarate ≠ `caps` vive.** Il limite di posti si applica **appena scegli il
  sistema**, non solo quando ti colleghi: il DS200 ne gestisce 2 e l'app lo sa dal menu.
  Ma allora quello che il sistema dichiara diventa un **divieto vero a video**, e il
  simulatore dichiarava `slots: DEFAULTS.cars` — cioè quanti guidatori si trova in tavola
  all'inizio, non quanti ne regge: «aggiungi guidatore» nasceva spento su una pista finta
  che ti avrebbe seguito volentieri. Nella definizione ci va **quanti ne accetta**; il
  numero si stringe sul reale alla connessione.
- **Rientranza nel simulatore**: nel ciclo che spara gli eventi scaduti, un evento può far
  finire la gara → chi ascolta ferma il simulatore → il piano diventa `null` **mentre siamo
  ancora dentro il ciclo**. Il controllo all'ingresso non basta: va rifatto ad ogni giro.
  (Trovato dal test E2E, non dai test del motore: succede solo con i timer veri.)
