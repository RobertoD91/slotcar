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
  // Sistema DS200/DS300 con una seriale finta: gli stessi frame che manda la
  // centralina vera, costruiti qui secondo la specifica.
  // -------------------------------------------------------------------------
  console.log('\n== SISTEMA DS200 (seriale simulata) ==');

  const bcd2 = n => ((Math.floor(n / 10) % 10) << 4) | (n % 10);
  const bcd4 = n => { const s = String(n).padStart(4, '0'); return [(+s[0] << 4) | +s[1], (+s[2] << 4) | +s[3]]; };
  /* 21 byte, start E0, end EB, numeri in BCD; il checksum (idx 18) è
     (somma idx 1..17 + idx 19) & 0xFF. Corsie DS200: LSB-first. */
  function frame(o) {
    const f = new Array(21).fill(0);
    f[0] = 0xe0; f[1] = o.tx || 1; f[2] = 21; f[3] = 0x02;
    f[7] = o.type; f[8] = o.func || 0; f[9] = o.ident || 0;
    f[10] = o.lane ? (1 << (o.lane - 1)) : 0;
    const [lh, ll] = bcd4(o.laps || 0); f[11] = lh; f[12] = ll;
    if (o.noTime) { f[13] = 0; f[14] = f[15] = f[16] = f[17] = 0xaa; }
    else {
      f[13] = bcd2(o.h || 0); f[14] = bcd2(o.m || 0); f[15] = bcd2(o.s || 0);
      const [fh, fl] = bcd4(o.frac || 0); f[16] = fh; f[17] = fl;
    }
    f[19] = 0; f[20] = 0xeb;
    let sum = 0; for (let i = 1; i <= 17; i++) sum += f[i];
    f[18] = (sum + f[19]) & 0xff;
    return f;
  }

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

  // partenza annunciata dalla centralina (fasi 1, 2, 3)
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x00, func: 0xa1, laps: 0 }));
  await ds.waitForTimeout(60);
  const statoFase1 = await ds.locator('#stateVal').innerText();
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x00, func: 0xa3, laps: 0 }));
  await ds.waitForTimeout(80);
  ok(statoFase1 !== (await ds.locator('#stateVal').innerText()),
     'le fasi di partenza muovono lo stato: ' + statoFase1 + ' → ' + await ds.locator('#stateVal').innerText());

  // primo passaggio senza tempo (riempimento 0xAA) + giri veri
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x1b, lane: 1, laps: 1, noTime: true }));
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x1b, lane: 2, laps: 1, noTime: true }));
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x1b, lane: 1, laps: 2, s: 8, frac: 1200 }));
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x1b, lane: 2, laps: 2, s: 9, frac: 3400 }));
  // la centralina ripete lo stesso frame: non deve contare due volte
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x1b, lane: 1, laps: 2, s: 8, frac: 1200 }));
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x1b, lane: 1, laps: 3, s: 7, frac: 5000 }));
  await ds.waitForTimeout(250);

  const board = await ds.evaluate(() =>
    [...document.querySelectorAll('#board tr')].map(tr => [...tr.children].map(td => td.innerText.trim())));
  ok(board.length >= 2, 'due corsie in classifica');
  ok(board[0][2] === '3', 'corsia 1 a 3 giri (la ripetizione non conta): ' + board[0][2]);
  ok(board[0][3] === '0:07.50', 'ultimo giro 7,50 s dalla centralina: ' + board[0][3]);
  ok(board[0][4] === '0:07.50', 'giro veloce 7,50 s: ' + board[0][4]);
  ok(board[1][2] === '2', 'corsia 2 a 2 giri: ' + board[1][2]);
  ok(board[1][3] === '0:09.34', 'ultimo giro corsia 2 = 9,34 s: ' + board[1][3]);

  // un frame con checksum sbagliato non deve entrare in classifica
  const rotto = frame({ type: 0x1b, lane: 1, laps: 9, s: 5 }); rotto[18] ^= 0xff;
  await ds.evaluate(f => window.__feed(f), rotto);
  await ds.waitForTimeout(150);
  const dopo = await ds.evaluate(() => document.querySelectorAll('#board tr')[0].children[2].innerText.trim());
  ok(dopo === '3', 'frame con checksum sbagliato scartato: giri ancora ' + dopo);

  // fine gara annunciata dalla centralina
  await ds.evaluate(f => window.__feed(f), frame({ type: 0x00, func: 0xa4, laps: 0 }));
  await ds.waitForTimeout(150);
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
