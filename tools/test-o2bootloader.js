/* Test end-to-end del configuratore dongle (web/o2-bootloader/) con una porta
 * seriale finta. Verifica la cosa che conta e che a leggere il diff non si vede:
 * che i frame costruiti siano *esattamente* quelli osservati nelle catture USB
 * del programma ufficiale, e che i blocchi di sicurezza tengano (niente scrittura
 * sul registro che avvia l'aggiornamento forzato, niente comandi fuori scopo).
 * Nessun hardware.
 *
 *   cd web && python3 -m http.server 8099 &
 *   node tools/test-o2bootloader.js
 *
 * ⚠️ L'app raccoglie la risposta in una finestra di 400-500 ms: ogni comando va
 * atteso. page.click() ritorna subito, il gestore no — se si legge il DOM appena
 * dopo il clic si trova tutto vuoto e i controlli falliscono senza motivo.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());

  await page.addInitScript(() => {
    window.__sent = [];
    let ctrl = null;
    const fake = {
      async open() {},
      async close() {},
      getInfo() { return { usbVendorId: 0x1fee, usbProductId: 0x0002 }; },
      get writable() {
        return { getWriter: () => ({ write: b => { window.__sent.push([...b]); }, releaseLock() {} }) };
      },
      get readable() {
        return new ReadableStream({ start(c) { ctrl = c; } });
      }
    };
    window.__push = (arr) => ctrl && ctrl.enqueue(new Uint8Array(arr));
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { async requestPort() { return fake; }, addEventListener() {} }
    });
  });

  await page.goto(BASE + '/o2-bootloader/', { waitUntil: 'networkidle' });

  const sent = () => page.evaluate(() => window.__sent.map(a => a.map(x => x.toString(16).padStart(2, '0')).join(' ')));
  const clear = () => page.evaluate(() => { window.__sent = []; });
  /* clic + risposta iniettata dentro la finestra di raccolta + attesa della fine */
  async function fire(sel, reply, pushAt = 100, total = 600) {
    await clear();
    await page.click(sel);
    if (reply) { await page.waitForTimeout(pushAt); await page.evaluate(r => window.__push(r), reply); }
    await page.waitForTimeout(total);
  }
  const txt = s => page.locator(s).innerText();
  const ascii = s => [...new TextEncoder().encode(s)];

  await page.click('#btnConn');
  await page.waitForTimeout(200);
  ok((await txt('#st')).length > 0, 'stato connessione mostrato: ' + await txt('#st'));

  // ---- boot: il byte dopo BOOT sceglie il dispositivo ----
  console.log('\n== BOOT ==');
  const bootAnd = async (target, atteso, pushAt, total) => {
    await page.selectOption('#tgt', target);
    await fire('#btnBoot', ascii('BOOTOK'), pushAt, total);
    const s = await sent();
    ok(JSON.stringify(s) === JSON.stringify(atteso), `${target}: ${s.join(' | ')}`);
  };
  await bootAnd('dongle', ['42 4f 4f 54 05', '42 4f 4f 54 0c'], 300, 500);
  ok(/boot/.test(await txt('#bootSt')), 'targhetta boot dopo BOOTOK: ' + await txt('#bootSt'));
  await bootAnd('chip', ['42 4f 4f 54 09'], 100, 600);
  await bootAnd('controller', ['42 4f 4f 54 0a'], 100, 600);

  // ---- versione firmware, per dispositivo ----
  console.log('\n== VERSIONE FIRMWARE ==');
  const fwAnd = async (target, atteso, risposta, attesoTesto) => {
    await page.selectOption('#tgt', target);
    await fire('#btnFw', risposta);
    ok((await sent())[0] === atteso, `${target}: comando ${(await sent())[0]} (atteso ${atteso})`);
    const out = await txt('#infoOut');
    ok(out.includes(attesoTesto), `${target}: decodifica → ${out}`);
  };
  await fwAnd('dongle', '0c 11 00 00 02', [0x04, 0x0e], 'v4.14');
  await fwAnd('chip', '09 11 00 80 02', [0x04, 0x12], 'v4.18');
  await fwAnd('controller', '0a 11 00 80 02', [0x04, 0x0c], 'v4.12');

  // ---- console registri ----
  console.log('\n== CONSOLE REGISTRI ==');
  await page.selectOption('#tgt', 'chip');
  await page.fill('#regA', '20');
  await page.fill('#regL', '5');
  await page.waitForTimeout(60);
  ok((await txt('#prevR')).includes('09 12 00 20 05'), 'anteprima lettura: ' + await txt('#prevR'));

  await fire('#btnRead', [0xff, 0xff, 0xff, 0xff, 0xff]);
  ok((await sent())[0] === '09 12 00 20 05', 'frame di lettura inviato');
  let out = await txt('#regOut');
  ok(/ff ff ff ff ff/.test(out), 'risposta mostrata: ' + out);
  ok(/✓/.test(out), 'lunghezza attesa confermata');

  // lunghezza sbagliata → avviso, non silenzio
  await fire('#btnRead', [0xff, 0xff]);
  out = await txt('#regOut');
  ok(!/✓/.test(out) && /5/.test(out) && /2/.test(out), 'lunghezza diversa segnalata: ' + out);

  // marcatori a blocchi riconosciuti
  await fire('#btnRead', ascii('RRR').concat([0xff, 0x77, 0x77]));
  out = await txt('#regOut');
  ok(/RRR/.test(out), 'marcatori a blocchi segnalati: ' + out);

  // op di lettura 0x11 selezionabile
  await page.selectOption('#regOp', '11');
  await page.waitForTimeout(60);
  ok((await txt('#prevR')).includes('09 11 00 20 05'), 'op 0x11: ' + await txt('#prevR'));
  await page.selectOption('#regOp', '12');

  // scrittura + conferma DO
  await page.fill('#regA', '10');
  await page.fill('#regV', 'cc');
  await page.waitForTimeout(60);
  ok((await txt('#prevW')).includes('09 02 00 10 01 cc'), 'anteprima scrittura: ' + await txt('#prevW'));
  await fire('#btnWrite', ascii('DO'), 150, 600);
  ok((await sent())[0] === '09 02 00 10 01 cc', 'frame di scrittura come nella cattura');
  out = await txt('#regOut');
  ok(/DO/.test(out), 'conferma DO riconosciuta: ' + out);

  // ---- blocchi di sicurezza ----
  console.log('\n== BLOCCHI DI SICUREZZA ==');
  await page.fill('#regA', '80');
  await page.waitForTimeout(60);
  await fire('#btnWrite', null, 0, 300);
  ok((await sent()).length === 0, 'scrittura su 0x80 (chip) non inviata');
  out = await txt('#regOut');
  ok(out.length > 20, 'motivo spiegato: ' + out.slice(0, 90));
  // ...ma la lettura dello stesso registro resta lecita (è la versione firmware)
  await page.fill('#regL', '2');
  await page.waitForTimeout(60);
  await fire('#btnRead', [0x04, 0x12]);
  ok((await sent())[0] === '09 12 00 80 02', 'lettura di 0x80 consentita: ' + (await sent())[0]);

  // frame del dongle: niente lunghezza, valore a 2 byte
  await page.selectOption('#tgt', 'dongle');
  await page.fill('#regA', '11');
  await page.fill('#regV', '04 0e');
  await page.waitForTimeout(60);
  ok(await page.locator('#regL').isDisabled(), 'sul dongle il campo lunghezza è spento');
  ok((await txt('#prevW')).includes('0c 11 04 0e 01'), 'anteprima scrittura dongle: ' + await txt('#prevW'));
  await fire('#btnWrite', [0xff], 100, 600);
  ok((await sent())[0] === '0c 11 04 0e 01', 'frame di scrittura dongle');
  ok(/ff/.test(await txt('#regOut')), 'conferma ff riconosciuta: ' + await txt('#regOut'));

  // invio grezzo: i comandi fuori scopo non partono
  await page.locator('details summary').click();
  await page.fill('#rawIn', 'DFU');   // un comando di aggiornamento forzato: deve restare a terra
  await fire('#btnRaw', null, 0, 200);
  ok((await sent()).length === 0, 'comando grezzo fuori scopo non inviato');
  await page.fill('#rawIn', 'BOOT');
  await fire('#btnRaw', null, 0, 200);
  ok((await sent())[0] === '42 4f 4f 54', 'comando grezzo lecito inviato');

  // annotazione nel registro
  await page.fill('#noteIn', 'cambiato ID auto da 4 a 5');
  await page.click('#btnNote');
  ok((await txt('#log')).includes('cambiato ID auto da 4 a 5'), 'annotazione finita nel registro');

  // cambio lingua: il dinamico si ri-renderizza
  await page.selectOption('#__langsel', 'it');
  await page.waitForTimeout(150);
  ok(/lettura/.test(await txt('#prevR')), 'anteprima tradotta dopo il cambio lingua: ' + await txt('#prevR'));

  console.log('\n== ERRORI JS ==');
  const veri = errors.filter(e => !/Failed to load resource/.test(e));
  ok(veri.length === 0, 'nessun errore JS' + (veri.length ? ': ' + veri.join(' / ') : ''));

  await browser.close();
  console.log(fail ? `\n❌ ${fail} controlli falliti` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
