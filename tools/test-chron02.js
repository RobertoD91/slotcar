/* Test end-to-end del contagiri oXigen (web/chron02/) con una porta seriale finta.
 * Verifica le regole che il dongle impone a chi gli parla e che a leggere il diff
 * non si vedono: l'ordine dell'avvio (DTR, poi 0x06, poi l'aggancio), la forma dei
 * frame di gara, i destinatari validi, i giri da scartare, lo Stop prima di
 * chiudere. Nessun hardware.
 *
 *   cd web && python3 -m http.server 8099 &
 *   node tools/test-chron02.js
 *
 * ⚠️ L'app manda al massimo un frame ogni 50 ms e ridisegna la classifica ogni
 * 250 ms: dopo ogni azione si aspetta, altrimenti si legge lo stato di prima.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };
const hex = a => a.map(x => x.toString(16).padStart(2, '0')).join(' ');
const ascii = s => [...new TextEncoder().encode(s)];

/* Dati di un'auto, 13 byte, come li manda il dongle. */
function rec({ id, laps = 0, cnt = 0, trig = 0x80 | 40, ver = 0x12, b0 = 0x80, b4 = 0, b9 = 0 }) {
  return [b0 | 0x80, id, (cnt >> 8) & 255, cnt & 255, b4, laps & 255, (laps >> 8) & 255, trig, ver, b9, 0, 0, 0];
}
const VERSION = [0x04, 0x0f, 0x00, 0x00, 0x00];   // dongle 4.15
const st = b => b[0] & 0x1f;                       // stato gara: bit 0..4 del byte 0
/* Il pattern di aggancio: un byte con bit 0..4 = 0x0F seguito da FFh, oppure 0x61. */
function syncAt(b) {
  const pos = [];
  for (let i = 0; i < b.length - 1; i++)
    if (((b[i] & 0x1f) === 0x0f && b[i + 1] === 0xff) || b[i] === 0x61) pos.push(i);
  return pos;
}

async function openPage(ctx, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__ev = [];      // sequenza: open, segnali, scritture
    window.__sent = [];
    let ctrl = null;
    const rs = new ReadableStream({ start(c) { ctrl = c; } });
    const fake = {
      async open(o) { window.__ev.push('open'); },
      async close() { window.__ev.push('close'); },
      async setSignals(s) { window.__ev.push('signals:' + JSON.stringify(s)); },
      getInfo() { return { usbVendorId: 0x1fee, usbProductId: 0x0002 }; },
      writable: { getWriter: () => ({ async write(b) { window.__ev.push('write'); window.__sent.push([...b]); }, releaseLock() {} }) },
      readable: rs,
    };
    window.__push = arr => ctrl && ctrl.enqueue(new Uint8Array(arr));
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { async requestPort() { return fake; }, addEventListener() {} }
    });
  });
  await page.goto(BASE + '/chron02/', { waitUntil: 'networkidle' });
  await page.selectOption('#__langsel', 'it');
  await page.waitForTimeout(100);
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const errors = [];
  const page = await openPage(ctx, errors);

  const sent = () => page.evaluate(() => window.__sent);
  const since = async i => (await sent()).slice(i);
  const count = async () => (await sent()).length;
  const push = arr => page.evaluate(a => window.__push(a), arr);
  const wait = ms => page.waitForTimeout(ms);
  const txt = s => page.locator(s).innerText();
  const raceBtnsOff = () => page.evaluate(() => [...document.querySelectorAll('.rs')].every(b => b.disabled));
  const lapsOf = id => page.locator(`#boardRows tr[data-id="${id}"] td.laps`).innerText();

  console.log('\n== PRIMA DI CONNETTERSI ==');
  ok(await raceBtnsOff(), 'pulsanti di gara spenti');
  ok(await page.locator('#syncHint').isVisible(), 'e c\'è scritto perché: ' + (await txt('#syncHint')).slice(0, 50) + '…');

  console.log('\n== AVVIO: DTR, POI 0x06, POI ATTESA DELLA VERSIONE ==');
  await page.click('#btnConn');
  await wait(300);
  const ev = await page.evaluate(() => window.__ev);
  const iSig = ev.findIndex(e => e.startsWith('signals:') && e.includes('"dataTerminalReady":true'));
  const iW = ev.indexOf('write');
  ok(iSig >= 0 && iSig < iW, 'DTR attivato prima della prima scrittura: ' + ev.slice(0, 4).join(', '));
  let s = await sent();
  ok(s.length === 1 && s[0].includes(0x06), 'primo messaggio con 0x06: ' + (s[0] ? hex(s[0]) : '—'));
  ok(s.length === 1, 'nessun frame di gara prima della versione (scritture: ' + s.length + ')');

  await push(VERSION);
  await wait(200);
  s = await sent();
  const sync = s[1] || [];
  ok(s.length === 2, 'dopo la versione parte UN frame (scritture: ' + s.length + ')');
  ok(syncAt(sync)[0] === 0, 'il frame di aggancio ha il pattern al byte 0: ' + hex(sync));
  ok(syncAt(sync).length === 1, 'e una volta sola (vince l\'ultimo: niente doppioni)');
  ok(sync.length === 11 && sync[8] === 0 && sync[9] === 0 && sync[10] === 0, 'byte 8..10 a zero');
  ok(st(sync) !== 0x01, 'lo stato iniziale non è STOP: 0x' + st(sync).toString(16));
  ok(st(sync) === 0x0f, 'è la gara libera (0x0F)');
  ok([2, 3, 4, 5, 6, 7].every(i => sync[i] === 0), 'nessun comando nel frame di aggancio');
  ok((await txt('#hs')).includes('4.15'), 'versione mostrata: ' + await txt('#hs'));
  ok(!(await raceBtnsOff()), 'pulsanti di gara accesi dopo l\'aggancio');
  ok((await page.getAttribute('.rs[data-st="free"]', 'aria-pressed')) === 'true', 'stato evidenziato: gara libera');

  console.log('\n== UN COMANDO PER AUTO NON FERMA LA GARA ==');
  let m = await count();
  await page.selectOption('#ccTo', 'one');
  await page.fill('#ccId', '3');
  await page.selectOption('#ccCmd', '2');
  await page.fill('#ccArg', '100');
  await page.click('#ccSend');
  await wait(1300);                         // dentro c'è anche una ripetizione di mantenimento
  let nuovi = await since(m);
  const ind = nuovi.find(b => b[5] === 0x82);
  ok(!!ind && ind[2] === 3 && ind[6] === 100, 'comando individuale: ' + (ind ? hex(ind) : 'non partito'));
  ok(nuovi.every(b => st(b) !== 0x01), 'nessun frame di STOP (prima partiva 0x61 ogni 200 ms)');
  ok(nuovi.every(b => st(b) === 0x0f), 'lo stato resta la gara libera');
  ok(nuovi.filter(b => b[5] === 0x82).length === 1, 'il comando parte una volta: è il dongle a ripeterlo');

  console.log('\n== DESTINATARI FUORI DA 1..24 ==');
  for (const bad of ['0', '25', '30', '-1']) {
    m = await count();
    await page.fill('#ccId', bad);
    await page.click('#ccSend');
    await wait(150);
    nuovi = await since(m);
    ok(nuovi.every(b => b[2] === 0 && !(b[5] & 0x80)), `ID ${bad}: nessun comando partito`);
    ok((await txt('#ccMsg')).includes('24'), `ID ${bad}: e lo dice → ` + (await txt('#ccMsg')).slice(0, 60));
  }
  await page.fill('#ccId', '3');

  console.log('\n== COMANDI PER TUTTE ==');
  m = await count();
  await page.selectOption('#ccTo', 'all');
  await page.selectOption('#ccCmd', '3');
  await page.fill('#ccArg', '32');
  ok((await txt('#ccPrev')).includes('128'), 'velocità minima ×4 spiegata: ' + await txt('#ccPrev'));
  await page.fill('#ccArg', '96');
  ok(/corsia forzato: sì/.test(await txt('#ccPrev')), 'oltre 63 c\'è anche il cambio corsia forzato: ' + await txt('#ccPrev'));
  await page.fill('#ccArg', '32');
  await page.click('#ccSend');
  await wait(200);
  nuovi = await since(m);
  const glob = nuovi.find(b => b[3] === 0x03);
  ok(!!glob && glob[4] === 0x20 && glob[2] === 0 && glob[5] === 0, 'comando globale nei byte 3/4: ' + (glob ? hex(glob) : 'non partito'));

  await page.selectOption('#ccCmd', '4');
  ok(await page.locator('#ccTo').isDisabled(), 'potenza radio: destinatario bloccato su «tutte»');
  ok((await txt('#ccHint')).includes('+4 dBm'), 'e 3 vale +4 dBm, non 0: ' + (await txt('#ccHint')).slice(0, 50));
  m = await count();
  await page.fill('#ccArg', '2');
  await page.click('#ccSend');
  await wait(200);
  nuovi = await since(m);
  ok(nuovi.some(b => b[3] === 0x04 && b[4] === 2), 'potenza radio globale inviata');
  ok(await page.locator('#ccCmd option[value="6"]').count() === 0, 'niente «azzera pit-lane» (codice 6)');
  ok(await page.locator('#ccCmd option[value="7"]').count() === 1, 'c\'è il tempo minimo sul giro (codice 7)');
  ok(await page.locator('#limRows tr').count() === 3, 'tre limiti in elenco: ' + await page.locator('#limRows tr').count());

  console.log('\n== GIRI: QUELLI ARRIVATI IN STOP NON CONTANO ==');
  await push(rec({ id: 2, laps: 0 }));
  await wait(100);
  await push(rec({ id: 2, laps: 1, cnt: 4000 }));
  await wait(350);
  ok((await lapsOf(2)).trim() === '1', 'giro in gara libera contato: ' + await lapsOf(2));
  ok((await page.locator('#boardRows tr[data-id="2"] td.best').innerText()) === '40.30', 'tempo 4000 / 99,25 = 40.30');

  m = await count();
  await page.click('.rs[data-st="stop"]');
  await wait(150);
  nuovi = await since(m);
  ok(nuovi.some(b => b[0] === 0x61 && b[1] === 0x00), 'STOP con i giri in pit non contati: 61 00 …');
  await wait(700);
  await push(rec({ id: 2, laps: 2, cnt: 3800 }));
  await wait(350);
  ok(/^1\b/.test((await lapsOf(2)).trim()) && (await lapsOf(2)).includes('(1)'),
     'giro arrivato in STOP scartato: ' + await lapsOf(2));
  ok(await page.locator('#lapRows tr.lapx').count() === 1, 'e nel log giri è segnato come scartato');

  console.log('\n== AVVIA DA STOP: LE CODE SONO VUOTE, I LIMITI SI RIMANDANO ==');
  m = await count();
  await page.click('.rs[data-st="run"]');
  await wait(400);
  nuovi = await since(m);
  const first = nuovi[0] || [];
  ok(st(first) === 0x03 && [2, 3, 4, 5, 6].every(i => first[i] === 0), 'prima il frame di Avvia, da solo: ' + hex(first));
  ok(nuovi.some(b => b[5] === 0x82 && b[2] === 3 && b[6] === 100), 'rimandata la velocità max dell\'auto 3');
  ok(nuovi.some(b => b[3] === 0x03 && b[4] === 0x20), 'rimandata la velocità minima per tutte');
  ok(nuovi.some(b => b[3] === 0x04 && b[4] === 2), 'rimandata la potenza radio');
  ok(nuovi.every(b => b.length <= 32 && st(b) === 0x03), 'tutti in stato GARA');

  await push(rec({ id: 2, laps: 0 }));      // il dongle ha azzerato
  await wait(100);
  await push(rec({ id: 2, laps: 1, cnt: 3900 }));
  await wait(350);
  ok((await lapsOf(2)).trim() === '1', 'nuova gara: si riparte da 1 → ' + await lapsOf(2));

  console.log('\n== PAUSA: I GIRI FATTI IN PAUSA NON RICOMPAIONO ALLA RIPRESA ==');
  await page.click('.rs[data-st="pause"]');
  await wait(700);
  await push(rec({ id: 2, laps: 2, cnt: 9000 }));
  await wait(100);
  m = await count();
  await page.click('.rs[data-st="run"]');
  await wait(60);
  await push(rec({ id: 2, laps: 3, cnt: 9500 }));   // il dongle li consegna alla ripresa
  await wait(1100);
  nuovi = await since(m);
  ok(nuovi.length > 0 && nuovi.every(b => [2, 3, 4, 5, 6].every(i => b[i] === 0)),
     'ripresa dalla pausa: niente limiti rimandati (le code non si sono svuotate)');
  await push(rec({ id: 2, laps: 4, cnt: 4100 }));
  await wait(350);
  ok(/^2\b/.test((await lapsOf(2)).trim()) && (await lapsOf(2)).includes('(2)'),
     'contano solo i giri veri: ' + await lapsOf(2));
  const note = await page.locator('#lapRows').innerText();
  ok(/ripresa/.test(note) && /Pausa/.test(note), 'log: scartati in pausa e alla ripresa');

  console.log('\n== FATTORE DEL TEMPO SUL GIRO ==');
  await page.locator('details summary').click();
  ok((await page.inputValue('#lapK')) === '99.25', 'predefinito 99,25');
  await page.fill('#lapK', '100');
  await page.locator('#lapK').dispatchEvent('change');
  await wait(100);
  ok((await page.locator('#boardRows tr[data-id="2"] td.best').innerText()) === '39.00', 'con 100: 3900 → 39.00');

  console.log('\n== DATI IN ARRIVO ==');
  await push([...rec({ id: 5, ver: 0x12, b4: 0x37, b9: 0x20 }), ...rec({ id: 6, ver: 0x8c, trig: 0x00 })]);
  await push(rec({ id: 7, ver: 0x80 }));
  await push(rec({ id: 25 }));
  await push(rec({ id: 0 }));
  await wait(350);
  const r5 = await page.locator('#boardRows tr[data-id="5"]').innerText().catch(() => '');
  const r6 = await page.locator('#boardRows tr[data-id="6"]').innerText().catch(() => '');
  const r7 = await page.locator('#boardRows tr[data-id="7"]').innerText().catch(() => '');
  ok(r5 && r6, 'messaggio da 26 byte: due auto (5 e 6)');
  ok(r5.includes('4.18'), 'versione telecomando 0x12 → 4.18');
  ok(r6.includes('4.12'), 'versione auto 0x8c → 4.12');
  ok(/non nota/.test(r7), 'versione auto 0x80 → non nota: ' + r7.replace(/\s+/g, ' '));
  ok(!/spd|\b55\b/.test(r5), 'il byte [4] non si mostra come velocità');
  ok(await page.locator('#boardRows tr[data-id="6"] .tbar').count() === 0 && /nessuna auto/.test(r6),
     'grilletto senza bit 7: nessuna auto collegata');
  ok(r5.includes('↑'), 'freccia su dal byte [9]');
  ok(await page.locator('#boardRows tr[data-id="25"], #boardRows tr[data-id="0"]').count() === 0, 'ID 0 e 25 ignorati');

  console.log('\n== GARA LIBERA DA STOP: PRIMA PACE CAR A VELOCITÀ PIENA ==');
  await page.click('.rs[data-st="stop"]');
  await wait(150);
  m = await count();
  await page.click('.rs[data-st="free"]');
  await wait(900);
  nuovi = await since(m);
  const iPace = nuovi.findIndex(b => st(b) === 0x05 && b[1] === 0xff);
  const iFree = nuovi.findIndex(b => st(b) === 0x0f && b[1] === 0xff);
  ok(iPace >= 0 && iFree > iPace, 'pace car a FFh, poi gara libera: ' + nuovi.map(b => hex(b.slice(0, 2))).join(' | '));

  console.log('\n== DISCONNETTI DURANTE UNA GARA ==');
  await page.click('.rs[data-st="run"]');
  await wait(400);
  m = await count();
  await page.click('#btnDisc');
  await wait(300);
  nuovi = await since(m);
  const last = nuovi[nuovi.length - 1] || [];
  ok(st(last) === 0x01, 'ultimo frame prima di chiudere = STOP: ' + hex(last));
  ok((await page.evaluate(() => window.__ev)).includes('close'), 'porta chiusa');

  console.log('\n== NESSUNA SCRITTURA OLTRE 32 BYTE ==');
  s = await sent();
  ok(s.every(b => b.length <= 32), 'scritture: ' + s.length + ', la più lunga ' + Math.max(...s.map(b => b.length)) + ' byte');

  /* ---- dongle non attivato ---- */
  console.log('\n== DONGLE NON ATTIVATO ==');
  const p2 = await openPage(ctx, errors);
  await p2.click('#btnConn');
  await p2.waitForTimeout(150);
  await p2.evaluate(a => window.__push(a), ascii('ACTIVENOT'));
  await p2.waitForTimeout(100);
  await p2.evaluate(a => window.__push(a), [0x04, 0x0f]);   // la risposta allo 0x06 di un dongle non attivato
  await p2.waitForTimeout(1300);
  ok(await p2.locator('#notact').isVisible(), 'fascia «non attivato»: ' + (await p2.locator('#notact').innerText()).slice(0, 50) + '…');
  ok((await p2.locator('#notact a').getAttribute('href')) === '../o2-bootloader/', 'col link al configuratore dongle');
  ok(!(await p2.locator('#nover').isVisible()), 'e non quella «nessuna versione»');
  const s2 = await p2.evaluate(() => window.__sent);
  ok(s2.length === 1, 'nessun frame di gara verso un dongle non attivato (scritture: ' + s2.length + ')');
  ok(await p2.evaluate(() => [...document.querySelectorAll('.rs')].every(b => b.disabled)), 'pulsanti di gara spenti');
  await p2.click('#btnDisc');
  await p2.waitForTimeout(100);
  ok(await p2.locator('#notact').isVisible(), 'la fascia resta dopo Disconnetti (ha il link)');
  await p2.close();

  /* ---- la versione non arriva ---- */
  console.log('\n== LA VERSIONE NON ARRIVA (PORTA RIAPERTA SENZA STACCARE) ==');
  const p3 = await openPage(ctx, errors);
  await p3.click('#btnConn');
  await p3.waitForTimeout(1400);
  ok(await p3.locator('#nover').isVisible(), 'fascia: ' + (await p3.locator('#nover').innerText()).slice(0, 60) + '…');
  ok(/stacca e riattacca/.test(await p3.locator('#nover').innerText()), 'dice di staccare e riattaccare il dongle');
  ok((await p3.evaluate(() => window.__sent)).length === 1, 'nessun frame di gara senza versione');
  await p3.evaluate(a => window.__push(a), VERSION);          // arriva in ritardo: si riparte
  await p3.waitForTimeout(200);
  ok(!(await p3.locator('#nover').isVisible()), 'versione in ritardo: la fascia si spegne');
  const s3 = await p3.evaluate(() => window.__sent);
  ok(s3.length === 2 && syncAt(s3[1])[0] === 0, 'e parte il frame di aggancio: ' + (s3[1] ? hex(s3[1]) : '—'));
  await p3.close();

  console.log('\n== ERRORI JS ==');
  const veri = errors.filter(e => !/Failed to load resource/.test(e));
  ok(veri.length === 0, 'nessun errore JS' + (veri.length ? ': ' + veri.slice(0, 3).join(' / ') : ''));

  await browser.close();
  console.log(fail ? `\n❌ ${fail} controlli falliti` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
