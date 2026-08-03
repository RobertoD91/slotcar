/* Test end-to-end del Cronometro web: fa correre una gara vera nel browser,
 * usando il sistema "simulazione" a velocità accelerata. Nessun hardware.
 *
 *   cd web && python3 -m http.server 8099 &
 *   NODE_PATH=/opt/node22/lib/node_modules node tools/test-cronometro.js
 *
 * Il motore ha già i suoi test da riga di comando (web/cronometro/race.test.js):
 * qui si controlla quello che quelli non vedono — interfaccia, traduzioni,
 * cronometro che gira davvero, colonne che compaiono solo se il sistema le ha.
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8099';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const errors = [];
  ctx.on('weberror', e => errors.push(String(e.error())));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE + '/cronometro/', { waitUntil: 'networkidle' });

  console.log('\n== CARICAMENTO ==');
  ok((await page.locator('h1').innerText()).length > 3, 'h1: ' + await page.locator('h1').innerText());
  const body = await page.locator('body').innerText();
  ok(!/\b(app|setup|btn|hdr|state|info|tbl|mode|sys|foot|log|gap|slot|tts|time)\.[a-zA-Z]/.test(body),
     'nessuna chiave i18n grezza a video');
  ok(body.includes('Slot Car Web Tools'), 'link di ritorno presente');
  ok(await page.locator('#sys option').count() >= 1, 'elenco sistemi popolato');
  ok(await page.locator('#mode option').count() === 2, 'due modalità');
  ok(await page.locator('.slotrow').count() === 4, 'roster predefinito: ' + await page.locator('.slotrow').count());

  console.log('\n== GUIDATORI MODIFICABILI ==');
  /* ⭐ Si scrive LETTERA PER LETTERA, come farebbe una persona: `fill()` mette
     tutto in un colpo e non avrebbe visto niente. Il difetto era che rinominare
     emetteva 'roster', chi ascolta ridisegnava l'elenco da capo, e la casella
     sotto le dita spariva col fuoco dentro: dopo ogni lettera bisognava
     ricliccare, e nel campo restava solo l'ultima. */
  const campo = page.locator('.slotrow input').first();
  await campo.click();
  await campo.pressSequentially('Roberto', { delay: 30 });
  await page.waitForTimeout(120);
  ok((await campo.inputValue()) === 'Roberto',
     'scrivendo lettera per lettera resta tutto: ' + await campo.inputValue());
  ok(await page.evaluate(() => document.activeElement === document.querySelector('.slotrow input')),
     'e il fuoco non se ne va dalla casella');
  ok((await page.locator('#board').innerText()).includes('Roberto'), 'il nome compare in classifica');
  await page.locator('#addDriver').click();
  ok(await page.locator('.slotrow').count() === 5, 'guidatore aggiunto');
  await page.locator('.slotrow .del').last().click();
  ok(await page.locator('.slotrow').count() === 4, 'guidatore tolto');

  console.log('\n== GARA GP A GIRI (simulazione 30x) ==');
  await page.selectOption('#mode', 'gp');
  await page.fill('#laps', '5');
  await page.locator('#laps').dispatchEvent('change');
  await page.selectOption('#sys', 'sim');
  await page.selectOption('#opt-sim-speed', '30');
  await page.locator('#connect').click();
  await page.waitForTimeout(200);
  ok((await page.locator('#connect').innerText()).length > 0, 'connesso: ' + await page.locator('#connect').innerText());
  // il registro sta dentro un <details> chiuso: innerText di roba nascosta è ''
  ok((await page.locator('#log').textContent()).length > 0, 'registro popolato');

  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('stateVal').textContent.length > 0);
  await page.waitForTimeout(300);
  const clockRunning = await page.locator('#clock').innerText();
  ok(clockRunning !== '0:00.00', 'il cronometro gira: ' + clockRunning);

  // la gara a 5 giri, a 30x con giri da ~7 s, finisce in circa 1,2 s reali
  await page.waitForFunction(
    () => document.querySelectorAll('#board tr').length > 0 &&
          [...document.querySelectorAll('#board tr td:first-child')].some(td => td.textContent === '🏁'),
    null, { timeout: 15000 });
  const rows = await page.locator('#board tr').count();
  ok(rows === 4, 'quattro righe in classifica');
  const first = await page.locator('#board tr').first().innerText();
  ok(first.includes('🏁'), 'il vincitore ha la bandiera: ' + first.replace(/\n/g, ' | '));

  const laps = await page.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map(tr => +tr.children[2].textContent));
  ok(laps[0] === 5, 'il vincitore ha 5 giri, letto: ' + laps[0]);
  ok(laps.every((l, i) => i === 0 || l <= laps[0]), 'nessuno supera il vincitore: ' + laps.join(','));
  ok((await page.locator('#bestVal').innerText()) !== '—', 'giro veloce calcolato: ' + await page.locator('#bestVal').innerText());
  ok((await page.locator('#stateVal').innerText()).length > 0, 'stato finale: ' + await page.locator('#stateVal').innerText());

  const clockFrozen = await page.locator('#clock').innerText();
  await page.waitForTimeout(400);
  ok((await page.locator('#clock').innerText()) === clockFrozen, 'a gara finita il cronometro è fermo');

  console.log('\n== BENZINA (colonna dichiarata dal sistema) ==');
  ok(await page.evaluate(() => document.body.classList.contains('has-fuel')), 'colonna benzina attiva col simulatore');
  const fuelVisible = await page.locator('th.fuelCol').isVisible();
  ok(fuelVisible, 'intestazione benzina visibile');

  /* Lo smoke test guarda le pagine APPENA APERTE, e a tabella vuota non sborda
     nessuno: la classifica si allarga solo quando ha dentro dei numeri. Il
     controllo va fatto qui, dove la gara è appena finita e le righe ci sono. */
  console.log('\n== SCHERMO STRETTO, CLASSIFICA PIENA ==');
  for (const w of [320, 360]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      cli: document.documentElement.clientWidth,
      colonne: getComputedStyle(document.querySelector('.bar'))
                 .gridTemplateColumns.split(' ').filter(c => parseFloat(c) > 0).length
    }));
    ok(m.doc <= m.cli, w + 'px: la pagina non scorre di lato (documento ' + m.doc + ')');
    ok(m.colonne === 3, w + 'px: i tre riquadri stanno su una riga (' + m.colonne + ')');
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(120);

  console.log('\n== AZZERAMENTO ==');
  await page.locator('#reset').click();
  await page.waitForTimeout(150);
  ok((await page.locator('#clock').innerText()) === '0:00.00', 'cronometro azzerato');
  const lapsAfter = await page.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map(tr => +tr.children[2].textContent));
  ok(lapsAfter.every(l => l === 0), 'giri azzerati: ' + lapsAfter.join(','));
  ok((await page.locator('#board').innerText()).includes('Roberto'), 'i guidatori restano');

  console.log('\n== LINGUA ==');
  await page.selectOption('#lang', 'de');
  await page.waitForTimeout(150);
  const de = await page.locator('body').innerText();
  ok(de.includes('Runden') || de.includes('Rennen'), 'tradotto in tedesco');
  ok(!/\b(app|setup|btn|hdr|state|info|tbl|mode|sys|foot|log|gap|slot)\.[a-zA-Z]/.test(de),
     'nessuna chiave grezza dopo il cambio lingua');
  await page.selectOption('#lang', 'it');
  await page.waitForTimeout(150);
  ok((await page.locator('.slotrow .num').first().innerText()).length > 0,
     'etichetta posto: ' + await page.locator('.slotrow .num').first().innerText());

  console.log('\n== PRATICA: parte al primo passaggio ==');
  await page.reload({ waitUntil: 'networkidle' });
  await page.selectOption('#mode', 'pratica');
  await page.selectOption('#opt-sim-speed', '30');
  await page.locator('#connect').click();
  await page.waitForTimeout(150);
  const stateBefore = await page.locator('#stateVal').innerText();
  await page.locator('#start').click();
  await page.waitForTimeout(600);
  const anyLap = await page.evaluate(() =>
    [...document.querySelectorAll('#board tr')].some(tr => +tr.children[2].textContent > 0));
  ok(anyLap, 'in pratica i giri si accumulano');
  ok(stateBefore.length > 0, 'stato iniziale: ' + stateBefore);

  // -------------------------------------------------------------------------
  // Sistema DS200/DS300, con una seriale finta alimentata da una CATTURA VERA.
  //
  // I byte qui sotto sono esattamente quelli usciti da un DS200 in pista
  // (registro dell'app, gara a 25 giri con una pausa in mezzo). Usare la
  // cattura invece di frame inventati è il motivo per cui questo test becca
  // cose che non avrei saputo simulare: che il frame di partenza porta il
  // programma di gara, e che dopo la pausa la centralina rifà il semaforo.
  // -------------------------------------------------------------------------
  console.log('\n== SISTEMA DS200 (cattura reale) ==');

  const CATTURA = `
E0 20 15 02 00 00 00 3C A1 00 25 00 00 00 00 00 00 00 39 00 EB   fase 1 + programma: 25 giri
E0 21 15 02 00 00 00 00 A2 00 00 00 00 00 00 00 00 00 DA 00 EB   fase 2
E0 22 15 02 00 00 00 00 A3 00 00 00 00 00 00 00 00 00 DC 00 EB   fase 3 = via
E0 23 15 02 00 00 00 1B A9 00 01 00 01 00 AA AA AA AA A8 00 EB   corsia 1, giro 1, senza tempo
E0 24 15 02 00 00 00 1B 00 00 02 00 01 00 AA AA AA AA 01 00 EB   corsia 2, giro 1, senza tempo
E0 25 15 02 00 00 00 1B A9 A8 01 00 02 00 00 05 03 94 47 00 EB   corsia 1, giro 2, 5.0394
E0 26 15 02 00 00 00 1B 00 A8 02 00 02 00 00 05 05 80 8E 00 EB   corsia 2, giro 2, 5.0580
E0 27 15 02 00 00 00 00 A5 00 00 00 00 00 00 00 00 00 E3 00 EB   pausa
E0 28 15 02 00 00 00 00 A6 00 00 00 00 00 00 00 00 00 E5 00 EB   fine pausa
E0 29 15 02 00 00 00 00 A2 00 00 00 00 00 00 00 00 00 E2 00 EB   fase 2  ← semaforo di RIPRESA
E0 2A 15 02 00 00 00 00 A3 00 00 00 00 00 00 00 00 00 E4 00 EB   fase 3
E0 2B 15 02 00 00 00 1B A9 00 01 00 03 00 00 22 19 71 B6 00 EB   corsia 1, giro 3, 22.1971
E0 2C 15 02 00 00 00 1B 00 00 02 00 03 00 00 22 31 08 BE 00 EB   corsia 2, giro 3, 22.3108
`;
  // ogni riga: i primi 21 byte esadecimali, il resto è il commento
  const frames = CATTURA.trim().split('\n').map(r =>
    (r.match(/\b[0-9A-F]{2}\b/g) || []).slice(0, 21).map(h => parseInt(h, 16)));
  // 160 ms: l'app ridisegna la classifica al massimo ogni 80 ms (con la
  // simulazione accelerata arrivano decine di eventi al secondo e ridisegnare
  // ogni volta è sprecato). Aspettare meno leggerebbe la tabella di prima.
  const feed = async (f) => { await ds.evaluate(x => window.__feed(x), f); await ds.waitForTimeout(160); };

  const ds = await ctx.newPage();
  ds.on('pageerror', e => errors.push(String(e)));
  ds.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await ds.addInitScript(() => {
    let ctrl = null;
    const stream = new ReadableStream({ start(c) { ctrl = c; } });
    const port = {
      opened: null,
      open: async (opts) => { port.opened = opts; },
      close: async () => {},
      setSignals: async () => {},
    };
    Object.defineProperty(port, 'readable', { get: () => stream });
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => port, getPorts: async () => [port] }
    });
    window.__port = port;
    window.__feed = (arr) => ctrl.enqueue(new Uint8Array(arr));
    /* Finta sintesi vocale: registra quello che l'app AVREBBE detto. E' l'unico
       modo di verificare il sintomo vero — "annuncia un numero di giri che ha
       chiesto a me" — invece del solo stato dell'interfaccia. */
    window.__detto = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        pending: false, speaking: false,
        getVoices: () => [],
        cancel() {}, speak(u) { window.__detto.push(String(u.text)); }
      }
    });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    try { localStorage.clear(); } catch (e) {}
  });

  await ds.goto(BASE + '/cronometro/', { waitUntil: 'networkidle' });
  await ds.locator('#tts').check();          // la voce va accesa: speak() esce subito se è spenta
  /* ⭐ DS200 e DS300 sono due voci diverse, non un'opzione della stessa: 2
     corsie contro 8, 4800 baud contro 57600. Il baud non si sceglie più — lo
     porta la centralina — e scende fra le avanzate, dove si tocca solo per
     provare. */
  const sistemi = await ds.evaluate(() => [...document.querySelectorAll('#sys option')].map(o => o.value));
  ok(sistemi.includes('ds200') && sistemi.includes('ds300'),
     'DS200 e DS300 sono due sistemi distinti: ' + sistemi.join(', '));

  await ds.selectOption('#sys', 'ds300');
  await ds.waitForTimeout(100);
  ok((await ds.locator('#opt-ds300-baud').inputValue()) === '57600', 'il DS300 porta il suo baud: 57600');
  ok(!(await ds.locator('#addDriver').isDisabled()), 'col DS300 (8 corsie) puoi ancora aggiungere');

  await ds.selectOption('#sys', 'ds200');
  await ds.waitForTimeout(100);
  /* ⭐ Il limite di corsie vale APPENA SCEGLI il sistema, non solo quando ti
     colleghi: il DS200 ne gestisce 2 e l'app lo sa dal menu. Lasciarti
     aggiungere otto guidatori per poi toglierteli al collegamento è un giro a
     vuoto — ed è la regressione arrivata con la separazione DS200/DS300. */
  ok(await ds.locator('#addDriver').isDisabled(),
     'col DS200 «aggiungi» è già spento prima di collegarsi: gestisce 2 corsie');
  ok(await ds.locator('#slotNote').isVisible(), 'e l\'avviso sulle righe in eccesso c\'è già');
  ok((await ds.locator('.slotrow .num').first().innerText()).match(/corsia|lane|carril|couloir|spur/i) !== null,
     'anche l\'etichetta del posto segue subito: ' + await ds.locator('.slotrow .num').first().innerText());
  ok(await ds.locator('#opt-ds200-baud').count() === 1, 'le opzioni del DS200 compaiono da sole');
  ok((await ds.locator('#opt-ds200-baud').inputValue()) === '4800', 'e il DS200 il suo: 4800');
  ok(!(await ds.locator('#opt-ds200-baud').isVisible()),
     'ma sta nelle avanzate, chiuso: non è una scelta da fare ogni volta');

  await ds.locator('#connect').click();
  await ds.waitForTimeout(150);
  const opened = await ds.evaluate(() => window.__port.opened);
  ok(opened && opened.baudRate === 4800 && opened.dataBits === 8 &&
     opened.parity === 'none' && opened.stopBits === 1,
     'porta aperta 4800 8N1: ' + JSON.stringify(opened));
  ok((await ds.locator('.slotrow .num').first().innerText()).match(/corsia|lane|carril|couloir|spur/i) !== null,
     'i posti diventano corsie: ' + await ds.locator('.slotrow .num').first().innerText());
  ok(!(await ds.evaluate(() => document.body.classList.contains('has-fuel'))),
     'niente colonna benzina: il DS non la manda');

  console.log('\n-- ⭐ il traguardo è della centralina, non tuo --');
  /* Il numero di giri lo programmi sulla scatola: l'app non deve chiedertelo, e
     soprattutto non deve ANNUNCIARE un numero che ha chiesto a te — quello non
     è un dato, è un desiderio. Finché la centralina non parla, è sconosciuto. */
  /* Nemmeno la MODALITÀ si sceglie: la centralina sa correre a giri
     individuali, a giri totali, a tempo o in F1, e quale sia lo dice lei. Un
     menu «pratica / GP a giri» mentre la scatola corre una F1 non è una scelta:
     è raccontare una gara diversa da quella che hai davanti. */
  ok(await ds.locator('#mode').isHidden(), 'il menu delle modalità sparisce: la decide lei');
  ok(await ds.locator('#progVal').isVisible(), 'al suo posto c\'è quello che ha detto');
  ok((await ds.locator('#progVal').innerText()).trim() === '—',
     'e prima che parli è «—», non una modalità inventata: ' + await ds.locator('#progVal').innerText());
  ok(await ds.locator('#modeHint').isVisible(), 'con scritto da dove arriva: ' +
     await ds.locator('#modeHint').innerText());
  ok((await ds.locator('#targetVal').innerText()).trim() === '—',
     'anche il traguardo è sconosciuto, non un 20 avanzato da prima: ' +
     await ds.locator('#targetVal').innerText());
  ok(await ds.locator('#lapsFld').isHidden(),
     'e la casella dei giri sparisce: il numero lo dirà il programma, in un posto solo');

  /* ⭐ Il caso che smaschera il difetto: la fase 1 NON arriva. Succede davvero —
     ti colleghi a gara già iniziata, oppure quel frame si perde. Il traguardo
     resta sconosciuto, e la voce deve TACERE sul numero di giri invece di
     annunciare quello che era rimasto nella casella. */
  await ds.evaluate(() => { window.__detto = []; });
  await feed(frames[1]); await feed(frames[2]);        // solo fasi 2 e 3, niente fase 1
  const senzaProgramma = (await ds.evaluate(() => window.__detto)).join(' | ');
  ok(senzaProgramma.length > 0, 'la partenza si annuncia comunque: "' + senzaProgramma + '"');
  ok(!/\d/.test(senzaProgramma),
     'ma senza numeri di giri, perché nessuno li ha detti: "' + senzaProgramma + '"');
  await ds.evaluate(() => { window.__detto = []; });

  console.log('\n-- chi comanda la gara --');
  ok(await ds.locator('#start').isDisabled(), 'Via è spento: comanda la centralina');
  ok(await ds.locator('#pause').isDisabled(), 'Pausa è spenta');
  ok(await ds.locator('#stop').isDisabled(), 'Stop è spento');
  ok(!(await ds.locator('#reset').isDisabled()), 'Azzera resta acceso: è locale');
  ok(await ds.locator('#ctrlNote').isVisible(), 'ed è scritto perché: ' +
     (await ds.locator('#ctrlNote').innerText()).slice(0, 60) + '…');
  ok((await ds.locator('#stop').innerText()).match(/^(stop)$/i) !== null,
     'il pulsante si chiama Stop: ' + await ds.locator('#stop').innerText());

  console.log('\n-- limite di corsie --');
  ok(await ds.locator('#addDriver').isDisabled(), '"aggiungi" spento: il DS200 ha 2 corsie');
  ok(await ds.locator('#slotNote').isVisible(), 'avviso sulle righe in eccesso: ' +
     (await ds.locator('#slotNote').innerText()).slice(0, 70) + '…');
  ok((await ds.locator('.slotrow').count()) === 4, 'ma i guidatori NON vengono cancellati');

  console.log('\n-- partenza e programma di gara --');
  await feed(frames[0]);            // fase 1 + programma
  const race200 = await ds.evaluate(() => document.getElementById('targetVal').textContent.match(/\d+/) ? +document.getElementById('targetVal').textContent.match(/\d+/)[0] : null);
  ok((await ds.locator('#mode').inputValue()) === 'gp', 'internamente diventa GP a giri: quella regola la sappiamo arbitrare');
  ok(race200 === 25, 'e il motore ha preso i suoi 25 giri: ' + race200);
  ok(/\b25\b/.test(await ds.locator('#targetVal').innerText()),
     'e ora il traguardo è il SUO: ' + await ds.locator('#targetVal').innerText());
  ok(/25/.test(await ds.locator('#progVal').innerText()),
     'il programma è scritto per esteso: ' + await ds.locator('#progVal').innerText());
  ok(await ds.locator('#lapsFld').isHidden(),
     'e resta sparita: il numero è scritto una volta sola, nel programma');
  ok(await ds.locator('#raceNote').isVisible(), 'ed è scritto a video: ' + await ds.locator('#raceNote').innerText());

  await feed(frames[1]); await feed(frames[2]);   // fasi 2 e 3
  const statoVia = await ds.locator('#stateVal').innerText();
  ok(/gara|racing|carrera|course|rennen/i.test(statoVia), 'dopo la fase 3 si corre: ' + statoVia);

  /* ⭐ E la voce dice il numero della CENTRALINA, non quello dell'app. Prima
     annunciava "gara a 20 giri" perché 20 era il valore rimasto nella casella:
     un desiderio letto ad alta voce con l'aria di un fatto. */
  const via = (await ds.evaluate(() => window.__detto)).find(x => /25|lap|giri|Runden|tour|vuelta/i.test(x)) || '';
  ok(/\b25\b/.test(via), 'alla partenza la voce dice i giri della centralina: "' + via + '"');
  ok(!/\b20\b/.test(via), 'e non il 20 che era rimasto nella casella');

  console.log('\n-- giri --');
  for (const i of [3, 4, 5, 6]) await feed(frames[i]);
  let board = await ds.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map(tr => [...tr.children].map(td => td.innerText.trim())));
  ok(board[0][2] === '2' && board[1][2] === '2', 'due corsie a 2 giri');
  /* ⭐ QUATTRO decimali, non due: la centralina manda diecimillesimi di secondo
     e li dichiara in `caps.timeDecimals`. Col Ninco (MMSSCC = centesimi) qui ne
     comparirebbero due, ed e' giusto cosi': mostrare quattro cifre dove ne
     arrivano due vuol dire inventarne due. */
  ok(board[0][3] === '0:05.0393', 'ultimo giro corsia 1, ai diecimillesimi: ' + board[0][3]);
  ok(board[1][3] === '0:05.0580', 'ultimo giro corsia 2, ai diecimillesimi: ' + board[1][3]);
  ok(/^\d+:\d\d\.\d{4}$/.test(board[0][3]), 'sono proprio quattro decimali');

  console.log('\n-- LA PAUSA (il bug che hai trovato) --');
  await feed(frames[7]);            // A5 pausa
  const inPausa = await ds.locator('#stateVal').innerText();
  ok(/pausa|paused|pause/i.test(inPausa), 'la centralina mette in pausa: ' + inPausa);
  const orologioInPausa = await ds.locator('#clock').innerText();
  await ds.waitForTimeout(400);
  ok((await ds.locator('#clock').innerText()) === orologioInPausa, 'e il cronometro si ferma');

  await feed(frames[8]);            // A6 fine pausa
  await feed(frames[9]);            // A2 ← il semaforo di ripresa: QUI azzerava tutto
  await feed(frames[10]);           // A3
  board = await ds.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map(tr => [...tr.children].map(td => td.innerText.trim())));
  ok(board[0][2] === '2' && board[1][2] === '2',
     'dopo la ripresa i giri sono ancora 2, non azzerati: ' + board.map(r => r[2]).join(','));
  ok(board[0][4] === '0:05.0393', 'e il giro veloce è sopravvissuto: ' + board[0][4]);

  await feed(frames[11]); await feed(frames[12]);
  board = await ds.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map(tr => [...tr.children].map(td => td.innerText.trim())));
  ok(board[0][2] === '3' && board[1][2] === '3', 'i giri riprendono da 3: ' + board.map(r => r[2]).join(','));
  ok(board[0][4] === '0:05.0393', 'il giro veloce resta quello vero, non il giro lungo della pausa');

  console.log('\n-- frame rotti e fine gara --');
  const rotto = frames[11].slice(); rotto[18] ^= 0xff;
  await feed(rotto);
  const dopo = await ds.evaluate(() => document.querySelectorAll('#board tr')[0].children[2].innerText.trim());
  ok(dopo === '3', 'frame con checksum sbagliato scartato: giri ancora ' + dopo);

  // fine gara: stessa forma dei frame di funzione della cattura, con A4
  const fineGara = frames[1].slice();
  fineGara[1] = 0x2d; fineGara[8] = 0xa4;
  let sum = 0; for (let i = 1; i <= 17; i++) sum += fineGara[i];
  fineGara[18] = (sum + fineGara[19]) & 0xff;
  await feed(fineGara);
  const fine = await ds.locator('#stateVal').innerText();
  ok(/finita|finished|terminada|terminée|beendet/i.test(fine), 'fine gara dalla centralina: ' + fine);
  const orologio = await ds.locator('#clock').innerText();
  await ds.waitForTimeout(300);
  ok((await ds.locator('#clock').innerText()) === orologio, 'cronometro fermo a fine gara');


  /* ⭐ Il ponte ESP32 NON è un protocollo nuovo: il firmware mette il frame
     grezzo dentro il JSON, e il sistema lo dà allo STESSO decoder del cavo. La
     prova che lo dimostra è questa — la stessa cattura, per un'altra strada,
     deve dare la stessa identica classifica. Se un giorno divergessero, qui si
     vede subito. */
  console.log('\n== PONTE ESP32: stessa cattura, altro trasporto ==');
  const wsPage = await ctx.newPage();
  wsPage.on('pageerror', (e) => errors.push(String(e)));
  await wsPage.addInitScript(() => {
    /* WebSocket finto: si apre da solo e accetta quello che gli diamo noi. */
    class FakeWS {
      constructor(url) {
        this.url = url; this.readyState = 0;
        window.__ws = this;
        setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen({}); }, 5);
      }
      close() { this.readyState = 3; if (this.onclose) this.onclose({}); }
    }
    window.WebSocket = FakeWS;
    window.__push = (json) => { if (window.__ws && window.__ws.onmessage) window.__ws.onmessage({ data: json }); };
    try { localStorage.clear(); } catch (e) {}
  });
  await wsPage.goto(BASE + '/cronometro/', { waitUntil: 'networkidle' });

  const sistemiWs = await wsPage.evaluate(() => [...document.querySelectorAll('#sys option')].map((o) => o.value));
  ok(sistemiWs.includes('esp32'), 'il ponte compare fra i sistemi: ' + sistemiWs.join(', '));

  await wsPage.selectOption('#sys', 'esp32');
  await wsPage.waitForTimeout(120);
  ok(await wsPage.locator('#mode').isHidden(),
     'ed è un DS a tutti gli effetti: la modalità la decide la centralina');

  await wsPage.locator('#connect').click();
  await wsPage.waitForTimeout(200);
  const url = await wsPage.evaluate(() => window.__ws && window.__ws.url);
  ok(/^wss?:\/\/[^/]+\/ws$/.test(url || ''),
     'si collega alla stessa origine della pagina, senza chiedere niente: ' + url);

  // stessa cattura del cavo, impacchettata come fa il firmware
  const hex = (f) => f.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  for (const f of frames) {
    await wsPage.evaluate((h) => window.__push(JSON.stringify({ ts: 0, raw: h, device: 'DS200' })), hex(f));
    await wsPage.waitForTimeout(160);
  }
  const boardWs = await wsPage.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim())));
  ok(boardWs.length >= 2, 'la classifica si popola: ' + boardWs.length + ' righe');
  ok(boardWs[0][2] === '3' && boardWs[1][2] === '3',
     'stessi giri del cavo (3 e 3): ' + boardWs.map((r) => r[2]).join(','));
  ok(boardWs[0][4] === '0:05.0393',
     'e lo stesso giro veloce, agli stessi diecimillesimi: ' + boardWs[0][4]);
  ok((await wsPage.locator('.slotrow .num').first().innerText()).match(/corsia|lane/i) !== null,
     'i posti sono corsie: la centralina è stata riconosciuta dal frame');
  await wsPage.close();


  /* ⭐ E il BLE è la TERZA strada per gli STESSI byte. Qui però c'è una cosa in
     più da dimostrare: il NUS spezza i dati in pacchetti da ~20 byte, quindi un
     frame da 21 arriva quasi sempre in DUE notifiche. Questa prova li spezza
     apposta (20 + 1) e pretende la stessa classifica: se il riassemblaggio si
     rompesse, un decoder che riceve mezzo frame non se ne accorgerebbe — si
     limiterebbe a non contare mai un giro. */
  console.log('\n== PONTE BLE: stessi byte, spezzati come li spezza il NUS ==');
  const blePage = await ctx.newPage();
  blePage.on('pageerror', (e) => errors.push(String(e)));
  await blePage.addInitScript(() => {
    class Ch {
      constructor() { this.h = []; }
      addEventListener(_t, f) { this.h.push(f); }
      async startNotifications() { window.__notif = true; return this; }
      async stopNotifications() { window.__notif = false; return this; }
      emit(bytes) {
        const u = Uint8Array.from(bytes);
        const v = new DataView(u.buffer, 0, u.length);
        this.h.forEach((f) => f({ target: { value: v } }));
      }
    }
    const ch = new Ch();
    const dev = {
      name: 'DS200 bridge',
      addEventListener() {},
      gatt: {
        connected: false,
        async connect() {
          this.connected = true;
          return { getPrimaryService: async () => ({ getCharacteristic: async () => ch }) };
        },
        disconnect() { this.connected = false; },
      },
    };
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        async requestDevice(opts) { window.__bleOpts = opts; return dev; },
        async getAvailability() { return true; },
      },
    });
    /* Spezzato come lo spezza il NUS: 20 byte, poi il ventunesimo. */
    window.__ble = (arr) => { ch.emit(arr.slice(0, 20)); ch.emit(arr.slice(20)); };
    try { localStorage.clear(); } catch (e) {}
  });
  await blePage.goto(BASE + '/cronometro/', { waitUntil: 'networkidle' });

  const sistemiBle = await blePage.evaluate(() => [...document.querySelectorAll('#sys option')].map((o) => o.value));
  ok(sistemiBle.includes('ble'), 'il ponte BLE compare fra i sistemi: ' + sistemiBle.join(', '));

  await blePage.selectOption('#sys', 'ble');
  await blePage.waitForTimeout(120);
  ok(await blePage.locator('#mode').isHidden(),
     'ed è un DS a tutti gli effetti: la modalità la decide la centralina');

  await blePage.locator('#connect').click();
  await blePage.waitForTimeout(250);
  const filtri = await blePage.evaluate(() => window.__bleOpts);
  ok(filtri && filtri.filters && filtri.filters[0].services[0] === '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
     'cerca il SERVIZIO, non il nome (il nome lo puoi cambiare, il servizio no)');
  ok(await blePage.evaluate(() => window.__notif === true), 'e si mette in ascolto delle notifiche');

  for (const f of frames) {
    await blePage.evaluate((a) => window.__ble(a), Array.from(f));
    await blePage.waitForTimeout(160);
  }
  const boardBle = await blePage.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim())));
  ok(boardBle.length >= 2, 'la classifica si popola: ' + boardBle.length + ' righe');
  ok(boardBle[0][2] === '3' && boardBle[1][2] === '3',
     'stessi giri delle altre due strade (3 e 3): ' + boardBle.map((r) => r[2]).join(','));
  ok(boardBle[0][4] === '0:05.0393',
     'e lo stesso giro veloce, agli stessi diecimillesimi: ' + boardBle[0][4]);
  await blePage.close();

  console.log('\n== ERRORI JS ==');
  const real = errors.filter(e => !/Failed to load resource/.test(e));
  if (real.length) { real.slice(0, 8).forEach(e => console.log('  ⚠️  ' + e)); fail += real.length; }
  else console.log('  ✅ nessun errore JS');

  await browser.close();
  console.log(fail ? `\n❌ ${fail} PROBLEMI` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
