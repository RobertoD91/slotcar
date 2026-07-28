# CLAUDE.md — memoria di progetto (slotcar)

Repo **pubblica** con le web app per slot car digitali, pubblicate su GitHub Pages.
**Questa repo è la sorgente**: le app si modificano qui. L'unica cosa ancora copiata da
fuori è il contagiri DS200/DS300 con il suo firmware ESP32 (vedi *Sincronizzazione*).
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

### Da fare nel codice
- [ ] **Migrare anche il contagiri DS200** (`web/ds200/` + `esp32/`): è l'ultima cosa
      copiata da fuori. Non è immediato — la repo di sviluppo ha un suo sito Pages che
      pubblica `webapp/`, una sua CI, il CLI Python e la regola dei tre parser da tenere
      allineati. Da decidere insieme all'utente.
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
- **Quasi tutto è sorgente: si modifica qui.** App oXigen (`car-config`, `remote-config`,
  `modes`, `chron02`, `o2-bootloader`), contagiri Ninco, indice, `i18n.js`, `sw.js`, tool
  e documentazione: file di questa repo, si toccano direttamente.
- **Le uniche copie sono `web/ds200/` ed `esp32/`**, che arrivano dalla repo del progetto
  DS200: lì ogni modifica va messa come patch in `tools/apply-local-patches.py`, altrimenti
  il prossimo sync la cancella. Se una patch entra a monte (o il file smette di essere una
  copia) va **tolta**, o verrebbe applicata due volte.
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
python3 tools/apply-local-patches.py --check  # le patch locali sono tutte applicate?
python3 tools/scan-secrets.py                 # segreti nei file
python3 tools/scan-secrets.py --history       # segreti in tutta la storia
python3 tools/test-scan-secrets.py            # le regole dello scanner
node web/ds200/ds200.test.js                  # parser DS200
node web/ninco/ninco.test.js                  # parser Ninco
g++ -std=c++17 -I esp32/test_host -I esp32/src esp32/test_host/test_ds200.cpp -o /tmp/t && /tmp/t
cd esp32 && pio run                           # firmware

# col sito servito in locale (servono Playwright e NODE_PATH=/opt/node22/lib/node_modules)
cd web && python3 -m http.server 8099 &
node tools/smoke-test.js                      # tutte le app: link, i18n, errori JS
node tools/test-ninco-ui.js                   # contagiri Ninco con seriale simulata
```

## Sincronizzazione (solo DS200)

```bash
cp tools/sync.local.conf.example tools/sync.local.conf   # prima volta: indica il percorso
./tools/sync-from-upstream.sh                            # --dry-run per vedere cosa farebbe
```
Riallinea **solo** `web/ds200/` ed `esp32/` alla repo del progetto DS200. Il percorso
**non sta nel codice** (repo pubblica): è in `tools/sync.local.conf`, git-ignored. Lo
script ricopia, riapplica le 7 patch e rilancia i controlli; il round-trip deve lasciare
l'albero **identico byte-per-byte**.

> Le app oXigen non sono più copie: sono state tolte dalla repo privata, che ora tiene
> solo lo studio dei protocolli, i firmware e i tool. Con loro sono sparite 9 patch.

## Protocolli — dove sono documentati

- **Ninco N-Digital** → `docs/ninco/PROTOCOLLO.md`. 1200 baud **7 bit** N1, ASCII, pacchetti
  chiusi da CR. Tipi: `M` modalità, `P` tasto Menu, `L` passaggio (giri capofila +
  posizione/velocità per 8 auto), `F` benzina (`I5` = riserva), `D` risultato.
  ⚠️ Fonte `slotbaer.de`: risponde **solo su `www.` e solo in HTTP** (senza `www.` il DNS
  non risolve, e WebFetch forza HTTPS → usa `curl`). Copia locale nella stessa cartella.
  I **tempi sul giro** si ricavano per differenza fra due totali `D` consecutivi.
  La base **non accetta comandi**: si può solo leggere.
- **DS200/DS300** → `docs/ds200-ds300/`. 21 byte, start `0xE0`, end `0xEB`, BCD.
  **DS200 = 4800 baud, DS300 = 57600.** Parser JS (`web/ds200/ds200.js`) e C++
  (`esp32/src/ds200.h`) devono restare **equivalenti**: se cambia il protocollo si
  aggiornano entrambi con i test.
- **Slot.it / oXigen** → `docs/slot.it/`. Lo studio del protocollo sta nella repo privata.

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
