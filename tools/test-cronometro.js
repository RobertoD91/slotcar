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
  await page.locator('.slotrow input').first().fill('Roberto');
  await page.waitForTimeout(120);
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
    try { localStorage.clear(); } catch (e) {}
  });

  await ds.goto(BASE + '/cronometro/', { waitUntil: 'networkidle' });
  await ds.selectOption('#sys', 'ds200');
  await ds.waitForTimeout(100);
  ok(await ds.locator('#opt-ds200-baud').count() === 1, 'le opzioni del DS200 compaiono da sole');
  ok((await ds.locator('#opt-ds200-baud').inputValue()) === '4800', 'baud predefinito 4800 (DS 200)');
  const bauds = await ds.evaluate(() => [...document.querySelectorAll('#opt-ds200-baud option')].map(o => o.textContent));
  ok(bauds[0].includes('57600') && bauds[1].includes('4800'), 'elenco baud leggibile: ' + bauds.slice(0, 2).join(' / '));

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
  ok((await ds.locator('#mode').inputValue()) === 'gp', 'la centralina dice "a giri" → modalità GP');
  ok((await ds.locator('#laps').inputValue()) === '25', 'e dice quanti: ' + await ds.locator('#laps').inputValue());
  ok(await ds.locator('#raceNote').isVisible(), 'ed è scritto a video: ' + await ds.locator('#raceNote').innerText());

  await feed(frames[1]); await feed(frames[2]);   // fasi 2 e 3
  const statoVia = await ds.locator('#stateVal').innerText();
  ok(/gara|racing|carrera|course|rennen/i.test(statoVia), 'dopo la fase 3 si corre: ' + statoVia);

  console.log('\n-- giri --');
  for (const i of [3, 4, 5, 6]) await feed(frames[i]);
  let board = await ds.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map(tr => [...tr.children].map(td => td.innerText.trim())));
  ok(board[0][2] === '2' && board[1][2] === '2', 'due corsie a 2 giri');
  ok(board[0][3] === '0:05.03', 'ultimo giro corsia 1 = 5,03 s: ' + board[0][3]);
  ok(board[1][3] === '0:05.05', 'ultimo giro corsia 2 = 5,05 s: ' + board[1][3]);

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
  ok(board[0][4] === '0:05.03', 'e il giro veloce è sopravvissuto: ' + board[0][4]);

  await feed(frames[11]); await feed(frames[12]);
  board = await ds.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map(tr => [...tr.children].map(td => td.innerText.trim())));
  ok(board[0][2] === '3' && board[1][2] === '3', 'i giri riprendono da 3: ' + board.map(r => r[2]).join(','));
  ok(board[0][4] === '0:05.03', 'il giro veloce resta quello vero, non il giro lungo della pausa');

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


  console.log('\n== ERRORI JS ==');
  const real = errors.filter(e => !/Failed to load resource/.test(e));
  if (real.length) { real.slice(0, 8).forEach(e => console.log('  ⚠️  ' + e)); fail += real.length; }
  else console.log('  ✅ nessun errore JS');

  await browser.close();
  console.log(fail ? `\n❌ ${fail} PROBLEMI` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
