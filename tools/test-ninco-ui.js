/* Test end-to-end del contagiri Ninco: simula una porta seriale che manda i pacchetti
 * della specifica e verifica che la pagina li mostri giusti. Nessun hardware.
 *
 *   cd web && python3 -m http.server 8099 &
 *   node tools/test-ninco-ui.js
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // Finta porta seriale: navigator.serial è in sola lettura in headless, va ridefinito.
  await page.addInitScript(() => {
    let ctrl = null;
    const port = {
      opened: null,
      open: async (opts) => { port.opened = opts; },
      close: async () => {},
      get readable() {
        return new ReadableStream({ start(c) { ctrl = c; } });
      }
    };
    // una sola istanza di stream, altrimenti ogni getter ne crea uno nuovo
    const stream = new ReadableStream({ start(c) { ctrl = c; } });
    Object.defineProperty(port, 'readable', { get: () => stream });
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => port, getPorts: async () => [port] }
    });
    window.__port = port;
    window.__feed = (s) => ctrl.enqueue(new TextEncoder().encode(s));
  });

  await page.goto(BASE + '/ninco/', { waitUntil: 'networkidle' });
  console.log('\n== CONNESSIONE ==');
  await page.click('#btnConn');
  await page.waitForTimeout(120);

  const opened = await page.evaluate(() => window.__port.opened);
  ok(opened && opened.baudRate === 1200, 'apre a 1200 baud (da specifica): ' + JSON.stringify(opened));
  ok(opened && opened.dataBits === 7, '7 bit di dati');
  ok(opened && opened.parity === 'none' && opened.stopBits === 1, 'nessuna parità, 1 stop');
  ok((await page.locator('#st').innerText()).match(/conness|connect|conect/i) !== null,
    'stato: ' + (await page.locator('#st').innerText()));

  // ---- pacchetti della specifica, spezzati come farebbe la seriale vera ----
  console.log('\n== DECODIFICA ==');
  await page.evaluate(() => window.__feed('M2\r'));
  await page.evaluate(() => window.__feed('L0025,0C,0C,2C,4C,0C,3C,0C'));  // pacchetto a metà
  await page.evaluate(() => window.__feed(',1C\r'));                        // …e la sua coda
  await page.evaluate(() => window.__feed('F99,I5,66,43,05,28,47,42\r'));
  await page.waitForTimeout(150);

  const mode = await page.locator('#mode').innerText();
  ok(/profession/i.test(mode), 'M2 → modalità professionale: "' + mode + '"');

  const leader = await page.locator('#leader').innerText();
  ok(leader.includes('25'), 'giri del capofila = 25: "' + leader + '"');

  // riga = [pos, auto, giri, benzina, ultimo, migliore, stato]
  const rows = () => page.evaluate(() =>
    [...document.querySelectorAll('#tb tr')].map(tr =>
      [...tr.children].map(td => td.innerText.trim())));

  let r = await rows();
  const byCar = (n) => r.find(x => x[1] === '#' + n);
  ok(byCar('8') && byCar('8')[0] === '1', 'auto 8 è prima (campo "1C")');
  ok(byCar('3') && byCar('3')[0] === '2', 'auto 3 è seconda (campo "2C")');
  ok(byCar('1') && /non in gara|not racing|fuera/i.test(byCar('1')[6]),
    'auto 1 con posizione 0 = non in gara');
  ok(byCar('1') && byCar('1')[3].includes('99'), 'auto 1: benzina 99');
  ok(byCar('2') && /riserv|reserv/i.test(byCar('2')[3]), 'auto 2: I5 = riserva');
  ok(byCar('8') && byCar('8')[3].includes('24'), 'auto 8: "42" con cifre invertite = 24');

  // ---- tempi sul giro: differenza fra due totali (firmware >= 1.08) ----
  console.log('\n== TEMPI SUL GIRO ==');
  const noTimesBefore = await page.locator('#notimes').isVisible();
  ok(noTimesBefore === true, 'finché non arriva un pacchetto D avvisa che i tempi mancano');

  await page.evaluate(() => window.__feed('D0001,0001,001000,001000\r'));
  await page.waitForTimeout(120);
  r = await rows();
  ok(byCar('1')[4] === '0:10.00', 'primo passaggio: il totale è il primo giro → ' + byCar('1')[4]);

  await page.evaluate(() => window.__feed('D0001,0002,001950,000950\r'));
  await page.waitForTimeout(120);
  r = await rows();
  ok(byCar('1')[4] === '0:09.50', 'secondo giro = 19.50 − 10.00 → ' + byCar('1')[4]);
  ok(byCar('1')[5] === '0:09.50', 'migliore aggiornato → ' + byCar('1')[5]);
  ok(byCar('1')[2] === '2', 'giri = 2');

  // la base ripete i pacchetti: la ripetizione non deve creare un giro da 0
  await page.evaluate(() => window.__feed('D0001,0002,001950,000950\r'));
  await page.waitForTimeout(120);
  r = await rows();
  ok(byCar('1')[4] === '0:09.50', 'pacchetto ripetuto ignorato (niente giro da 0:00.00)');
  ok(byCar('1')[5] === '0:09.50', 'il giro migliore non si azzera');

  ok(!(await page.locator('#notimes').isVisible()), 'arrivati i D, l\'avviso sparisce');

  // ---- opzione: cifre invertite auto 8 ----
  console.log('\n== OPZIONE AUTO 8 ==');
  // la casella sta dentro <details>: va aperto, altrimenti non è cliccabile
  await page.evaluate(() => document.querySelector('details').open = true);
  await page.uncheck('#swap8');
  await page.evaluate(() => window.__feed('F99,I5,66,43,05,28,47,42\r'));
  await page.waitForTimeout(120);
  r = await rows();
  ok(byCar('8')[3].includes('42'), 'togliendo la spunta l\'auto 8 legge 42');

  console.log('\n== ERRORI ==');
  if (errors.length) { errors.slice(0, 6).forEach(e => console.log('  ⚠️  ' + e)); fail += errors.length; }
  else console.log('  ✅ nessun errore JS');

  await browser.close();
  console.log(fail ? `\n❌ ${fail} PROBLEMI` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
