# CLAUDE.md — memoria di progetto (slotcar)

Repo **pubblica** con le web app per slot car digitali, pubblicate su GitHub Pages.
**Questa repo è la sorgente di tutto**: niente è più una copia, non c'è nessuna
sincronizzazione da fare e nessuna patch da riapplicare. Si modifica direttamente qui.
L'utente è italiano: **rispondere in italiano**.

---

## ⭐ TODO

### In carico all'utente
- [ ] **Cronometro col DS200: resta da confermare il numero di giri programmato.** Il frame
      di partenza dice «gara a giri individuali, 0x25». Lo leggiamo come **25 in BCD** e
      torna con la cattura, ma va verificato su un'altra programmazione (metti 12 giri sulla
      centralina e guarda se l'app scrive 12).
- [ ] **Cronometro col DS200, secondo giro di prove** — la pausa è sistemata e verificata
      sulla cattura. Restano da provare in pista: gara annullata (A7), fine gara vera (A4),
      e il record finale.
- [ ] **Auto 8, cifre della benzina invertite** — nel contagiri Ninco l'ottava auto viene
      letta con le due cifre scambiate (`42` → `24`). È documentato, ma la fonte non sa
      dire se valga per tutte le power base. L'utente verifica sul campo e riferisce: se
      i valori sono giusti *senza* lo scambio, va cambiato il default della casella
      «auto 8: cifre benzina invertite» in `web/ninco/index.html` (ora è **attiva**).
- [ ] **Cattura reale Ninco** — esportare una cattura vera dalla power base e usarla per
      verificare che la decodifica regga sui casi che la documentazione non copre
      (modalità GP, gara in pausa, fine gara, rifornimenti).
- [ ] **Prova sul campo del contagiri Ninco** (il cavo ce l'ha già).

### Cronometro web — le prossime tappe
Motore, simulatore, modalità *pratica* e *GP a giri*, guidatori modificabili, voce, 5 lingue
e PWA ci sono già (`web/cronometro/`, v0.3.0). I sistemi veri arrivano uno alla volta:
- ✅ **sistema DS200/DS300** (`sistemi/ds200.js`) — riusa il decoder di
      `web/ds200-ds300/ds200.js` (caricato dalla pagina, non duplicato). **Provato su
      centralina vera** e sistemato con la cattura dell'utente (vedi sotto). Il record
      finale porta il tempo TOTALE, non un giro: resta a registro e non entra in classifica.
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
  in `web/index.html`, altrimenti compare il banner «Aggiorna» a vuoto. Le PWA
  (`ds200-ds300/`, `cronometro/`) hanno una cache propria **cache-first**: lì vanno alzati
  anche `CACHE` in `sw.js`, le query `?v=` e `APP_VERSION` — se te ne dimentichi, chi ha
  già aperto la pagina resta sulla copia vecchia per sempre.
- ⭐ **I colori stanno in `web/ui.css`, uno solo.** Se aggiungi una pagina, linka quello e
  non ricopiare `:root{--bg:…}`: prima era copiato in sette file e aveva già prodotto due
  rossi e quattro gialli diversi. `ui.css` va caricato **prima** dello stile della pagina,
  così il layout locale vince.
- **Commit trailer**: mantieni `Co-Authored-By` / `Claude-Session`. **Mai** l'id del modello
  in file committati.
- **Linguaggio (richiesta utente)**: non usare la parola «reverse» (né «reverse engineering»
  o «ingegneria inversa») né nei testi delle app né nelle risposte. Si parla di *analisi del
  protocollo*, *studio*, *ipotesi da confermare*. Vale anche per il metodo JS `.reverse()`,
  che ovviamente resta: è codice, non prosa.

## Controlli (nessun hardware)

```bash
node tools/check-links.js                     # link interni + nessun percorso assoluto
node tools/check-versions.js                  # versioni nel codice == version.json
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
| comandi | no | no | **sì** | sì |

⇒ "Avvia gara" non può essere un bottone uguale per tutti: `comando()` in `app.js` manda
sempre al motore, e al sistema **solo** se `caps.control`.

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
- **Un'auto in riserva ha `fuel === null`**: se il filtro della tabella guarda solo il
  livello numerico, sparisce proprio quando serve vederla.
- **`git reset --hard` in un test** butta via anche le modifiche ai file tracciati che
  stavi preparando.
- **Un tag che si mangia il precedente**: inserire `<script>…</script>` cercando
  `</script>\n</body>` sostituisce **anche** la chiusura del blocco che c'era prima, e il
  nuovo tag finisce dentro quello vecchio → `SyntaxError: Unexpected token '<'`. L'ha beccato
  lo smoke test, non la lettura del diff.
- **`maxlength` tronca prima che il JS ripulisca**: su un campo MAC con `maxlength="4"`,
  incollare `52 5d` dà `52 5` e poi `525` — una cifra persa. Se il valore va normalizzato,
  il limite lo deve fare il filtro (prima togli, poi taglia), non l'attributo.
- **Nomi di classe che si scontrano fra `ui.css` e l'app**: `.note` è un riquadro giallo nel
  foglio condiviso e una riga smorzata nella guida oXigen. Riusare un nome per un'altra cosa
  richiede di azzerarlo per intero (sfondo, bordo, padding), o te lo porti dietro.
- **Rientranza nel simulatore**: nel ciclo che spara gli eventi scaduti, un evento può far
  finire la gara → chi ascolta ferma il simulatore → il piano diventa `null` **mentre siamo
  ancora dentro il ciclo**. Il controllo all'ingresso non basta: va rifatto ad ogni giro.
  (Trovato dal test E2E, non dai test del motore: succede solo con i timer veri.)
