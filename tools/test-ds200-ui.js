/* Test end-to-end del contagiri DS200/DS300: simula la centralina su una porta
 * seriale finta e verifica che la pagina mostri SOLO quello che la centralina
 * ha detto. Nessun hardware.
 *
 *   cd web && python3 -m http.server 8099 &
 *   NODE_PATH=/opt/node22/lib/node_modules node tools/test-ds200-ui.js
 *
 * Il controllo che conta è l'ultimo: **il numero grande non deve avanzare da
 * solo**. Prima era un cronometro libero, agganciato ogni tanto ai dati — così
 * a centralina spenta continuava a contare una gara che non stava correndo, e
 * un debugger che inventa dati è peggio di un debugger che non ne mostra.
 * È un difetto che nessun test di parser può vedere: serve il tempo che passa.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };

/* Costruisce un frame da 21 byte come lo manda la centralina.
   checksum (idx 18) = (somma idx 1..17 + idx 19) & 0xFF — vedi docs/ds200-ds300/. */
function frame({ device = 0x02, dataType = 0x00, fn = 0x00, id = 0x00, lane = 0x00,
                 laps = [0x00, 0x00], time = [0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA] }) {
  const b = new Array(21).fill(0x00);
  b[0] = 0xE0; b[20] = 0xEB;
  b[1] = 0x01; b[2] = 0x15;
  b[3] = device;
  b[7] = dataType;
  b[8] = fn;
  b[9] = id; b[10] = lane;
  b[11] = laps[0]; b[12] = laps[1];
  for (let i = 0; i < 6; i++) b[13 + i > 17 ? 17 : 13 + i] = time[i];
  b[13] = time[0]; b[14] = time[1]; b[15] = time[2]; b[16] = time[3]; b[17] = time[4];
  b[19] = time[5] === undefined ? 0x00 : 0x00;
  let s = 0; for (let i = 1; i <= 17; i++) s += b[i];
  b[18] = (s + b[19]) & 0xFF;
  return b;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.addInitScript(() => {
    let ctrl = null;
    const stream = new ReadableStream({ start(c) { ctrl = c; } });
    const port = {
      opened: null,
      open: async (o) => { port.opened = o; },
      close: async () => {},
      setSignals: async () => {},
      writable: { getWriter: () => ({ write: async () => {}, releaseLock: () => {} }) },
    };
    Object.defineProperty(port, 'readable', { get: () => stream });
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => port, getPorts: async () => [port] }
    });
    window.__port = port;
    window.__feed = (arr) => ctrl.enqueue(new Uint8Array(arr));
  });

  await page.goto(BASE + '/ds200-ds300/', { waitUntil: 'networkidle' });

  console.log('\n== A RIPOSO ==');
  ok((await page.locator('#clock').innerText()).trim() === '—',
     'il numero grande è vuoto finché la centralina non parla: ' + await page.locator('#clock').innerText());
  ok((await page.locator('#link').innerText()).length > 0,
     'lo stato del collegamento è scritto: ' + await page.locator('#link').innerText());

  console.log('\n== CONNESSIONE ==');
  await page.click('#connect');
  await page.waitForTimeout(150);
  const opened = await page.evaluate(() => window.__port.opened);
  ok(opened && opened.baudRate === 4800, 'apre a 4800 baud (DS200): ' + JSON.stringify(opened && opened.baudRate));

  console.log('\n== LA CENTRALINA ANNUNCIA LA PARTENZA ==');
  // fase 1 = 0x3C (giri individuali) + funzione 0xA1, come nella cattura vera
  await page.evaluate((f) => window.__feed(f), frame({ dataType: 0x3C, fn: 0xA1, id: 0x00, lane: 0x25 }));
  await page.evaluate((f) => window.__feed(f), frame({ dataType: 0x00, fn: 0xA2 }));
  await page.evaluate((f) => window.__feed(f), frame({ dataType: 0x00, fn: 0xA3 }));
  await page.waitForTimeout(200);
  ok((await page.locator('#race-state').innerText()).length > 1,
     'stato gara annunciato: ' + await page.locator('#race-state').innerText());
  ok((await page.locator('#clock').innerText()).trim() === '—',
     'la partenza da sola non inventa un tempo: ' + await page.locator('#clock').innerText());

  console.log('\n== PASSAGGI CON TEMPO ==');
  // corsia 1 (maschera DS200 LSB-first), giro 1, 12,3456 s
  await page.evaluate((f) => window.__feed(f),
    frame({ dataType: 0x1B, id: 0x01, lane: 0x01, laps: [0x00, 0x01], time: [0x00, 0x00, 0x12, 0x34, 0x56] }));
  await page.waitForTimeout(250);
  const dopoUnGiro = (await page.locator('#clock').innerText()).trim();
  ok(dopoUnGiro !== '—', 'ora il numero mostra il tempo trasmesso: ' + dopoUnGiro);
  ok(/^00:00:12\./.test(dopoUnGiro), 'ed è proprio quello del frame (12 s): ' + dopoUnGiro);

  console.log('\n== ⭐ IL NUMERO NON AVANZA DA SOLO ==');
  // Nessun frame per tre secondi: un cronometro libero sarebbe salito di tre.
  await page.waitForTimeout(3000);
  const dopoAttesa = (await page.locator('#clock').innerText()).trim();
  ok(dopoAttesa === dopoUnGiro,
     'dopo 3 s di silenzio è ancora ' + dopoAttesa + ' (era ' + dopoUnGiro + ')');
  const link = await page.locator('#link').innerText();
  ok(/\d/.test(link), 'ma il collegamento dice da quanto tace: ' + link);
  ok(!(await page.getAttribute('#link', 'class')).includes('on'),
     'e non si spaccia più per vivo (classe: ' + await page.getAttribute('#link', 'class') + ')');

  console.log('\n== SECONDO GIRO: SI MUOVE SOLO SUI DATI ==');
  await page.evaluate((f) => window.__feed(f),
    frame({ dataType: 0x1B, id: 0x01, lane: 0x01, laps: [0x00, 0x02], time: [0x00, 0x00, 0x10, 0x00, 0x00] }));
  await page.waitForTimeout(250);
  const dopoDue = (await page.locator('#clock').innerText()).trim();
  ok(dopoDue !== dopoUnGiro, 'con un nuovo frame il numero cambia: ' + dopoDue);
  ok(/^00:00:22\./.test(dopoDue), 'ed è la somma dei due giri (12 + 10 = 22 s): ' + dopoDue);
  ok((await page.getAttribute('#link', 'class')).includes('on'), 'collegamento di nuovo vivo');

  console.log('\n== AZZERAMENTO ==');
  await page.click('#reset');
  await page.waitForTimeout(150);
  ok((await page.locator('#clock').innerText()).trim() === '—', 'azzerato: torna vuoto, non a zero');

  console.log('\n== ⭐ MOSTRA TUTTO QUELLO CHE È ARRIVATO ==');
  // un debugger che riassume costringe a leggere l'esadecimale a mano
  await page.evaluate((f) => window.__feed(f),
    frame({ dataType: 0x3C, fn: 0xA1, id: 0x00, lane: 0x25 }));
  await page.waitForTimeout(200);
  const prog = await page.locator('#prog').innerText();
  ok(/\b25\b/.test(prog), 'il numero di giri programmato si vede: ' + prog);
  ok(/giri|lap|vuelta|tour|Runden/i.test(prog), 'e dice anche di che gara si tratta: ' + prog);

  const campi = await page.evaluate(() =>
    [...document.querySelectorAll('#fields tbody tr')].map(tr => tr.children[0].textContent));
  for (const atteso of ['txCounter', 'password', 'identifier', 'flags', 'programme',
                        'control', 'checksum', 'laneMask', 'raw']) {
    ok(campi.includes(atteso), 'il pannello mostra il campo ' + atteso);
  }
  const rigaProg = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#fields tbody tr')]
      .find(r => r.children[0].textContent === 'programme');
    return tr ? tr.children[1].textContent : '';
  });
  ok(/^25\b/.test(rigaProg), 'e il programma decodificato, coi byte grezzi accanto: ' + rigaProg);

  const riga = await page.locator('#log').innerText();
  ok(riga.includes('prog=25'), 'anche il registro grezzo lo riporta');
  ok(/tx=|pw=|ctl=/.test(riga), 'insieme a contatore, password e controllo');

  console.log('\n== CORNICE COMUNE ==');
  const comune = await page.evaluate(() => ({
    app: document.body.classList.contains('app'),
    ui: [...document.styleSheets].some(s => (s.href || '').includes('ui.css')),
    // il tema chiaro esiste solo se i colori arrivano dai token condivisi
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  }));
  ok(comune.app, 'body.app: la pagina indossa la cornice comune');
  ok(comune.ui, 'ui.css è caricato');
  ok(comune.bg.length > 0, 'i colori vengono dai token condivisi: --bg = ' + comune.bg);

  console.log('\n== ERRORI JS ==');
  const veri = errors.filter(e => !/favicon|manifest|sw\.js/i.test(e));
  ok(veri.length === 0, veri.length ? veri.join(' | ') : 'nessun errore JS');

  await browser.close();
  console.log(fail ? `\n❌ ${fail} PROBLEMI` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
