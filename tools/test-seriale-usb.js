/* Test end-to-end del collegamento al dongle via WebUSB (web/seriale.js), cioè
 * la strada che le app oXigen usano su Android, con un dongle USB finto.
 *
 * Perché un test a sé. Su computer le app passano dal Web Serial, e i loro test
 * (test-chron02.js, test-o2bootloader.js) fingono una SerialPort. Su Android
 * invece la pagina fa da sé il lavoro del driver: prende le interfacce CDC,
 * imposta la linea, alza il DTR, legge e scrive sugli endpoint bulk. Sono
 * proprio le cose che il diff non mostra e che un telefono vero proverebbe solo
 * a mano: qui le prova un USBDevice finto che risponde come il dongle.
 *
 *   cd web && python3 -m http.server 8099 &
 *   node tools/test-seriale-usb.js
 *
 * Cosa verifica:
 *  - senza Web Serial (Android) la pagina usa il WebUSB e non mostra la fascia
 *    «browser non supportato»; con lo user agent di Android sceglie il WebUSB
 *    anche se il Web Serial esiste (lì elenca il dongle solo su pochi telefoni);
 *  - l'apertura: interfacce CDC prese, SET_LINE_CODING, DTR alzato PRIMA del
 *    primo messaggio, e il primo messaggio con lo 0x06;
 *  - le risposte del dongle arrivano alla pagina (versione → frame di aggancio);
 *  - Disconnetti abbassa il DTR, come il driver di un computer;
 *  - il dongle staccato: la pagina se ne accorge e non resta appesa;
 *  - nel configuratore, il riavvio con STOPBOOT: il dongle ricompare come
 *    dispositivo NUOVO e la pagina lo ritrova fra quelli già concessi.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };
const hex = a => a.map(x => x.toString(16).padStart(2, '0')).join(' ');
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

/* ---------- il dongle USB finto (gira dentro la pagina) ---------- */
function usbStub(opts) {
  const sim = window.__usb = {
    ev: [], sent: [], resets: 0, devices: [], serialUsed: false,
    reappearMs: 300, keepSerial: !!(opts && opts.keepSerial),
  };
  const listeners = {};
  const fire = (t, device) => (listeners[t] || []).forEach(f => f({ type: t, device }));
  const ascii = s => [...s].map(c => c.charCodeAt(0));
  const h2 = x => x.toString(16).padStart(2, '0');
  const hex = b => b.map(h2).join(' ');      // gira nella pagina: quello di Node qui non c'è
  /* Il descrittore del dongle: interfaccia 0 di controllo CDC (con il suo
     endpoint interrupt), interfaccia 1 dati con due endpoint bulk. */
  const CONF = {
    configurationValue: 1,
    interfaces: [
      { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0x02,
        endpoints: [{ endpointNumber: 2, direction: 'in', type: 'interrupt', packetSize: 8 }] }] },
      { interfaceNumber: 1, alternates: [{ alternateSetting: 0, interfaceClass: 0x0a,
        endpoints: [{ endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 64 },
                    { endpointNumber: 1, direction: 'out', type: 'bulk', packetSize: 64 }] }] },
    ],
  };

  function makeDevice() {
    const inq = [];
    let waiter = null, lost = false, claimed = new Set(), first = true, boot = false;
    const d = {
      vendorId: 0x1fee, productId: 0x0002, opened: false, configuration: null,
      async open() {
        if (lost) throw new DOMException('The device was disconnected.', 'NotFoundError');
        d.opened = true; first = true; boot = false; sim.ev.push('open');
      },
      async close() {
        d.opened = false; claimed.clear(); sim.ev.push('close');
        if (waiter) { const w = waiter; waiter = null; w.rej(new DOMException('The device was closed.', 'AbortError')); }
      },
      async selectConfiguration() { d.configuration = CONF; },
      async claimInterface(n) {
        if (!d.opened) throw new DOMException('closed', 'InvalidStateError');
        claimed.add(n); sim.ev.push('claim:' + n);
      },
      async releaseInterface(n) { claimed.delete(n); sim.ev.push('release:' + n); },
      async selectAlternateInterface() {},
      async clearHalt() {},
      async controlTransferOut(setup, data) {
        if (lost) throw new DOMException('The device was disconnected.', 'NotFoundError');
        if (!claimed.has(setup.index)) throw new DOMException('interface not claimed', 'InvalidStateError');
        const b = data ? [...new Uint8Array(data)] : [];
        sim.ev.push('ctrl:' + h2(setup.request) + ':' + setup.value + (b.length ? ':' + hex(b) : ''));
        return { status: 'ok', bytesWritten: b.length };
      },
      async transferIn(ep, len) {
        if (lost) throw new DOMException('The device was disconnected.', 'NotFoundError');
        if (!claimed.has(1)) throw new DOMException('interface not claimed', 'InvalidStateError');
        if (inq.length) return { status: 'ok', data: new DataView(inq.shift().buffer) };
        return new Promise((res, rej) => { waiter = { res, rej }; });
      },
      async transferOut(ep, data) {
        if (lost) throw new DOMException('The device was disconnected.', 'NotFoundError');
        const u = data instanceof ArrayBuffer ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const b = [...u];
        sim.sent.push(b); sim.ev.push('out:' + label(b));
        handle(d, b);
        return { status: 'ok', bytesWritten: b.length };
      },
      _push(arr) {
        if (lost || !d.opened) return;
        const u = new Uint8Array(arr);
        if (waiter) { const w = waiter; waiter = null; w.res({ status: 'ok', data: new DataView(u.buffer) }); }
        else inq.push(u);
      },
      _lose() {
        lost = true; d.opened = false;
        if (waiter) { const w = waiter; waiter = null; w.rej(new DOMException('The device was disconnected.', 'NetworkError')); }
      },
      get _first() { return first; }, set _first(v) { first = v; },
      get _boot() { return boot; }, set _boot(v) { boot = v; },
    };
    return d;
  }
  function label(b) {
    const s = String.fromCharCode(...b);
    if (s.startsWith('BOOT') && b.length === 5) return 'BOOT ' + h2(b[4]);
    return /^[\x20-\x7e]+$/.test(s) ? s : hex(b);
  }
  const reply = (d, arr, ms = 15) => setTimeout(() => d._push(arr), ms);
  /* Riavvio del dongle: il dispositivo sparisce e ne ricompare uno NUOVO. */
  function reset(d) {
    sim.resets++; sim.ev.push('reset');
    setTimeout(() => {
      d._lose();
      sim.devices = sim.devices.filter(x => x !== d);
      fire('disconnect', d);
      setTimeout(() => {
        const nd = makeDevice();
        sim.devices.push(nd);
        fire('connect', nd);
      }, sim.reappearMs);
    }, 40);
  }
  /* Quel tanto del dongle che serve: versione allo 0x06, STOPBOOT e BOOT solo
     come primo messaggio, e due letture del dongle stesso in BOOT 0c. */
  function handle(d, b) {
    const s = String.fromCharCode(...b);
    const first = d._first;
    /* BOOT 05 (ferma la radio di gara) lascia valido il «primo messaggio»: i
       programmi lo mandano subito prima di BOOT 0c. */
    d._first = first && s === 'BOOT\x05';
    if (d._boot) {
      if (s.startsWith('STOPBOOT')) return reset(d);
      if (hex(b) === '0c 11 00 00 02') return reply(d, [0x04, 0x0f]);
      return;
    }
    if (first && s.startsWith('STOPBOOT')) return reset(d);
    if (first && s.startsWith('BOOT') && b.length === 5 && b[4] === 0x0c) { d._boot = true; return reply(d, ascii('BOOTOK'), 20); }
    if (b.includes(0x06)) return reply(d, [0x04, 0x0f, 0x00, 0x00, 0x00]);
  }

  sim.devices.push(makeDevice());
  Object.defineProperty(navigator, 'usb', {
    configurable: true,
    value: {
      async requestDevice(o) { sim.ev.push('request:' + JSON.stringify(o)); return sim.devices[0]; },
      async getDevices() { return sim.devices.slice(); },
      addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
      removeEventListener() {},
    },
  });
  /* Senza Web Serial, come su Android. Con keepSerial resta un Web Serial che
     non va toccato: su Android deve vincere comunque il WebUSB. */
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: sim.keepSerial ? {
      async requestPort() { sim.serialUsed = true; throw new Error('Web Serial usato al posto del WebUSB'); },
      async getPorts() { sim.serialUsed = true; return []; },
      addEventListener() {},
    } : undefined,
  });
  window.__lose = () => { const d = sim.devices[0]; d._lose(); sim.devices = []; fire('disconnect', d); };
  window.__push = arr => sim.devices[0] && sim.devices[0]._push(arr);
}

async function apri(ctx, app, opts, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(app + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(app + ': ' + m.text()); });
  await page.addInitScript(usbStub, opts || {});
  await page.goto(BASE + '/' + app + '/', { waitUntil: 'networkidle' });
  await page.selectOption('#__langsel', 'it');
  await page.waitForTimeout(100);
  return page;
}
const usb = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__usb)));
const logTxt = page => page.evaluate(() => document.getElementById('log').textContent);
const prima = (arr, a, b) => arr.indexOf(a) >= 0 && arr.indexOf(a) < arr.indexOf(b);
const primoCon = (arr, pre) => arr.findIndex(e => e.startsWith(pre));

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ===================================================================
  console.log('\n== CONTAGIRI (chron02) SENZA WEB SERIAL ==');
  let ctx = await browser.newContext();
  let page = await apri(ctx, 'chron02', {}, errors);
  ok(await page.evaluate(() => window.Seriale && window.Seriale.via) === 'usb', 'la pagina sceglie il WebUSB');
  ok(await page.locator('#noser').isHidden(), 'nessuna fascia «browser non supportato»');
  ok(!(await page.locator('#btnConn').isDisabled()), 'il pulsante Connetti è acceso');

  await page.click('#btnConn');
  await page.waitForTimeout(300);
  let u = await usb(page);
  ok(u.ev.some(e => e.startsWith('request:{"filters":[]}')), 'selettore senza filtri: ' + u.ev[0]);
  ok(prima(u.ev, 'open', 'claim:1') && u.ev.includes('claim:0'), 'interfacce CDC prese (0 controllo, 1 dati)');
  ok(u.ev.includes('ctrl:20:0:80 25 00 00 00 00 08'), 'SET_LINE_CODING 9600 8N1');
  const iDtr = u.ev.indexOf('ctrl:22:1');
  const iOut = primoCon(u.ev, 'out:');
  ok(iDtr >= 0 && iDtr < iOut, 'DTR alzato prima del primo messaggio: ' + u.ev.join(' | '));
  ok(u.sent.length >= 1 && u.sent[0].includes(0x06), 'primo messaggio con 0x06: ' + (u.sent[0] ? hex(u.sent[0]) : '—'));

  await page.waitForTimeout(400);
  u = await usb(page);
  const sync = u.sent[1] || [];
  ok(u.sent.length >= 2 && (sync[0] & 0x1f) === 0x0f && sync[1] === 0xff,
     'la versione è arrivata alla pagina e parte il frame di aggancio: ' + hex(sync));
  ok((await page.locator('#hs').innerText()).includes('4.15'), 'versione mostrata: ' + await page.locator('#hs').innerText());

  await page.click('#btnDisc');
  await page.waitForTimeout(300);
  u = await usb(page);
  ok(u.ev.includes('ctrl:22:0'), 'Disconnetti abbassa il DTR');
  ok(prima(u.ev, 'ctrl:22:0', 'close') && u.ev.includes('release:1'), 'poi rilascia le interfacce e chiude');

  /* Il dongle staccato a porta aperta: la lettura finisce e la pagina lo dice. */
  await page.click('#btnConn');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__lose());
  await page.waitForTimeout(400);
  ok(/staccato/.test(await logTxt(page)), 'dongle staccato: la pagina se ne accorge');
  ok(!(await page.locator('#btnConn').isDisabled()) && await page.locator('#btnDisc').isDisabled(),
     'e torna a «non connesso» (Connetti acceso, Disconnetti spento)');
  await ctx.close();

  // ===================================================================
  console.log('\n== ANDROID CON IL WEB SERIAL PRESENTE ==');
  ctx = await browser.newContext({ userAgent: ANDROID_UA });
  page = await apri(ctx, 'chron02', { keepSerial: true }, errors);
  ok(await page.evaluate(() => window.Seriale.via) === 'usb', 'su Android vince il WebUSB');
  await page.click('#btnConn');
  await page.waitForTimeout(400);
  u = await usb(page);
  ok(!u.serialUsed, 'il Web Serial non viene toccato');
  ok(u.sent.length >= 1 && u.sent[0].includes(0x06), 'e il dongle riceve lo 0x06 via USB');
  await ctx.close();

  // ===================================================================
  console.log('\n== CONFIGURATORE (o2-bootloader): RIAVVIO E RIAPERTURA ==');
  ctx = await browser.newContext();
  page = await apri(ctx, 'o2-bootloader', {}, errors);
  const idle = () => page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false', null, { timeout: 20000 });
  ok(await page.locator('#noser').isHidden(), 'nessuna fascia «browser non supportato»');
  await page.click('#btnConn');
  await page.waitForTimeout(40);
  await idle();
  u = await usb(page);
  ok(prima(u.ev, 'open', 'ctrl:22:1'), 'porta aperta con DTR');
  ok(/connesso/.test(await page.locator('#st').innerText()), 'stato: ' + await page.locator('#st').innerText());

  await page.selectOption('#tgt', 'dongle');
  await page.evaluate(() => { window.__usb.ev = []; window.__usb.sent = []; });
  await page.click('#btnBoot');
  await page.waitForTimeout(40);
  await idle();
  u = await usb(page);
  ok(u.resets === 1, 'STOPBOOT ha riavviato il dongle');
  ok(prima(u.ev, 'reset', 'open') && prima(u.ev, 'open', 'ctrl:22:1') && prima(u.ev, 'ctrl:22:1', 'out:BOOT 0c'),
     'il dongle ricompare come dispositivo nuovo, la pagina lo riapre con il DTR e manda BOOT 0c: ' + u.ev.join(' | '));
  const bootSt = await page.locator('#bootSt').innerText();
  ok(/boot/i.test(bootSt) && !/non in boot/i.test(bootSt), 'in boot: ' + bootSt);

  await page.evaluate(() => { window.__usb.sent = []; });
  await page.click('#btnFw');
  await page.waitForTimeout(40);
  await idle();
  u = await usb(page);
  ok(u.sent.some(b => hex(b) === '0c 11 00 00 02'), 'lettura della versione inviata via USB');
  ok(/4\.15/.test(await logTxt(page)) || /04 0f/.test(await logTxt(page)), 'e la risposta torna alla pagina');
  await ctx.close();

  // ===================================================================
  console.log('\n== ERRORI JS ==');
  ok(errors.length === 0, 'nessun errore JS' + (errors.length ? ': ' + errors.join(' / ') : ''));

  await browser.close();
  console.log(fail ? `\n❌ ${fail} controlli falliti` : '\n✅ WebUSB: tutto ok');
  process.exit(fail ? 1 : 0);
})();
