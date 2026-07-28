# CLAUDE.md — memoria di progetto (slotcar)

Repo **pubblica** con le web app per slot car digitali, pubblicate su GitHub Pages.
**Questa repo è la sorgente di tutto**: niente è più una copia, non c'è nessuna
sincronizzazione da fare e nessuna patch da riapplicare. Si modifica direttamente qui.
L'utente è italiano: **rispondere in italiano**.

---

## ⭐ TODO

### In carico all'utente
- [ ] **Auto 8, cifre della benzina invertite** — nel contagiri Ninco l'ottava auto viene
      letta con le due cifre scambiate (`42` → `24`). È documentato, ma la fonte non sa
      dire se valga per tutte le power base. L'utente verifica sul campo e riferisce: se
      i valori sono giusti *senza* lo scambio, va cambiato il default della casella
      «auto 8: cifre benzina invertite» in `web/ninco/index.html` (ora è **attiva**).
- [ ] **Cattura reale Ninco** — esportare una cattura vera dalla power base e usarla per
      verificare che la decodifica regga sui casi che la documentazione non copre
      (modalità GP, gara in pausa, fine gara, rifornimenti).
- [ ] **Prova sul campo del contagiri Ninco** — serve il cavo Mini-DIN 6 → DB-9 con Rx/Tx
      incrociati (1→2, 6→3, 5→5). ⚠️ RS-232 vero a ±12 V: un adattatore TTL 3,3/5 V si
      danneggia, ci vuole un MAX3232.

### Cronometro web — le prossime tappe
Il motore, il simulatore, le modalità *pratica* e *GP a giri*, i guidatori modificabili, la
voce, le 5 lingue e la PWA ci sono già (`web/cronometro/`, v0.1.0). Mancano i sistemi veri,
uno alla volta:
- [ ] **sistema DS200/DS300** — è il primo perché l'utente ce l'ha sul tavolo. Il parser
      esiste già (`web/ds200-ds300/ds200.js`): l'adattatore deve solo tradurre i frame in
      eventi `lap` / `state`. `caps`: `lapTime`, `raceState`, `slotLabel:'lane'`.
- [ ] **sistema Ninco** — parser in `web/ninco/ninco.js`. `caps`: `position` (la manda la
      base), `fuel`, `slotLabel:'car'`. Il tempo sul giro è per differenza fra due totali.
- [ ] **sistema oXigen** — l'unico con `control:true`: la gara la comanda l'app
      (`race_status[10]`). Serve il dongle.
- [ ] **GP a tempo** e **qualifiche** — dopo il GP a giri. La regola vive tutta in
      `MODES` dentro `race.js`.
- [ ] **guidatori con database, punti e classifica di campionato** — richiesta dell'utente,
      rinviata a un'evolutiva. Oggi i nomi stanno in `localStorage`.

### Da fare nel codice
- [ ] **`flash.html` è solo in italiano** — non è passato per `i18n.js` come il resto.
- [ ] **Dipendenza esterna da unpkg** in `ds200/flash.html` (esp-web-tools). Per un sito
      100% autonomo va incorporata: serve un bundler, è un modulo ES con dipendenze sue.
- [ ] **`flash.html` mostra `v1.2.0` nel footer**, non agganciato a nessuna versione reale.

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

- **Branch: `master`.** Richiesta esplicita dell'utente, niente branch inutili.
- **`web/` è il sito.** Il workflow `pages.yml` la pubblica tal quale ad ogni push su
  `master`. Percorsi **sempre relativi**: il sito sta in un sottopercorso.
- **Tutto è sorgente: si modifica qui, e basta.** Non c'è più niente di copiato da altre
  repo, quindi niente sync e niente patch: si aprono i file e si cambiano.
- ⚠️ **I TRE PARSER DEL DS200 devono restare equivalenti**: `web/ds200-ds300/ds200.js` (JS),
  `cli/ds_slot_serial.py` (Python) ed `esp32/src/ds200.h` (C++). Se cambia il protocollo si
  aggiornano tutti e tre insieme ai test. Ora stanno nella stessa repo e li verifica un
  solo workflow — prima erano divisi fra due repo e nessuno controllava che non
  divergessero.
- **Segreti**: hook `pre-commit`/`pre-push` + Action. Attivali con
  `./tools/install-hooks.sh` (una volta per clone). I valori personali **non** vanno nel
  codice: `tools/secrets-denylist.local.txt` (git-ignored) e il secret `SECRET_SCAN_EXTRA`.
- **Versioni**: se pubblichi un aggiornamento alza `web/version.json` **e** `SITE_VERSION`
  in `web/index.html`, altrimenti compare il banner «Aggiorna» a vuoto. La PWA `ds200/` ha
  una cache propria (cache-first): lì vanno alzati anche `CACHE` in `sw.js`, le query `?v=`
  e `APP_VERSION` in `app.js`.
- **Commit trailer**: mantieni `Co-Authored-By` / `Claude-Session`. **Mai** l'id del modello
  in file committati.
- **Linguaggio (richiesta utente)**: non usare la parola «reverse» (né «reverse engineering»
  o «ingegneria inversa») né nei testi delle app né nelle risposte. Si parla di *analisi del
  protocollo*, *studio*, *ipotesi da confermare*. Vale anche per il metodo JS `.reverse()`,
  che ovviamente resta: è codice, non prosa.

## Controlli (nessun hardware)

```bash
node tools/check-links.js                     # link interni + nessun percorso assoluto
python3 tools/scan-secrets.py                 # segreti nei file
python3 tools/scan-secrets.py --history       # segreti in tutta la storia
python3 tools/test-scan-secrets.py            # le regole dello scanner
node web/ds200-ds300/ds200.test.js            # parser DS200 — JS
cd cli && python3 -m pytest tests/ -q         # parser DS200 — Python
g++ -std=c++17 -I esp32/test_host -I esp32/src esp32/test_host/test_ds200.cpp -o /tmp/t && /tmp/t
node web/ninco/ninco.test.js                  # parser Ninco
cd esp32 && pio run                           # firmware

# col sito servito in locale (servono Playwright e NODE_PATH=/opt/node22/lib/node_modules)
cd web && python3 -m http.server 8099 &
node tools/smoke-test.js                      # tutte le app: link, i18n, errori JS
node tools/test-cronometro.js                 # una gara simulata dentro il cronometro
node tools/test-ninco-ui.js                   # contagiri Ninco con seriale simulata
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
- **Slot.it / oXigen** → `docs/slot.it/`. Lo studio del protocollo sta nella repo privata.

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
| comandi | no | no | **sì** | sì |

⇒ "Avvia gara" non può essere un bottone uguale per tutti: `comando()` in `app.js` manda
sempre al motore, e al sistema **solo** se `caps.control`.

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

## Trappole già pagate

- **i18n**: `i18n.js` costruisce il dizionario su `DOMContentLoaded`. Chi disegna prima
  vede la **chiave** al posto del testo, e agganciarsi solo a `i18n:changed` non basta
  (nessuno cambia lingua per leggere lo stato). Ri-disegna anche su `DOMContentLoaded`.
  Lo smoke test controlla le chiavi grezze su tutte le pagine.
- **Web Serial/Bluetooth solo in contesto sicuro**: su `http` non esistono, e il messaggio
  «browser non supportato» è fuorviante. L'indice passa da sé a `https`.
- **La power base Ninco ripete i pacchetti**: un totale non crescente va ignorato, o si
  contano giri da 0 ms e il giro veloce diventa 0.
- **Un'auto in riserva ha `fuel === null`**: se il filtro della tabella guarda solo il
  livello numerico, sparisce proprio quando serve vederla.
- **`git reset --hard` in un test** butta via anche le modifiche ai file tracciati che
  stavi preparando.
- **Rientranza nel simulatore**: nel ciclo che spara gli eventi scaduti, un evento può far
  finire la gara → chi ascolta ferma il simulatore → il piano diventa `null` **mentre siamo
  ancora dentro il ciclo**. Il controllo all'ingresso non basta: va rifatto ad ogni giro.
  (Trovato dal test E2E, non dai test del motore: succede solo con i timer veri.)
