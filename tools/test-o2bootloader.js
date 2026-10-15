/* Test end-to-end del configuratore dongle (web/o2-bootloader/) con un dongle
 * simulato. Verifica le cose che a leggere il diff non si vedono:
 *  - che i frame costruiti siano *esattamente* quelli delle catture USB del
 *    programma ufficiale (cambio ID, MAC e velocità pit lane, fatte su un SCP-3:
 *    prefisso 09);
 *  - che una scrittura sia confermata SOLO dal DO ai dati (un AB sui dati è un errore);
 *  - che BOOT parta solo dopo un riavvio con STOPBOOT come primo messaggio;
 *  - l'attivazione: READACTIV, MAC mostrato nell'ordine di READMACVL, chiave inoltrata;
 *  - i blocchi: registro 0x80 in scrittura, lunghezze, 32 byte, comandi 0c del dongle.
 * Nessun hardware.
 *
 *   cd web && python3 -m http.server 8099 &
 *   node tools/test-o2bootloader.js
 *
 * Il simulatore segue la specifica del protocollo, ed è volutamente più severo
 * del dongle vero dove conviene: BOOT e STOPBOOT valgono SOLO come primo messaggio
 * dopo l'apertura (o dopo BOOT 05), e la porta di partenza è «sporca», come se
 * fosse appena stata chiusa dal contagiri: lì il primo messaggio verrebbe letto
 * anche come frame di gara, e il simulatore lo annota in `dangerous`.
 *
 * L'app dichiara `aria-busy` sul body mentre lavora: il test aspetta che torni a
 * "false" invece di indovinare quanto dura un'operazione (un riavvio del dongle
 * con riapertura della porta dura molto più di una lettura).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };

/* ---------- il dongle simulato (gira dentro la pagina) ---------- */
function dongleStub(opts) {
  const sim = window.__sim = Object.assign({
    activated: true,        // false = dongle non attivato
    silentOpen: false,      // true = non manda ACTIVENOT all'apertura
    mac: [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc],   // come lo manda READMACVL
    key: [0x0a, 0x1b, 0x2c, 0x3d, 0x4e, 0x5f],   // la chiave "giusta" del test
    bootOk: { 9: true, 10: true, 12: true },
    reads: {}, headerReply: 'DO', dataReply: 'DO', reappearMs: 300,
  }, opts || {});
  Object.assign(sim, {
    state: 'wait', target: null, pendingData: false, last: [], actWait: false,
    clean: false, onlyBoot05: true,
    sent: [], events: [], dangerous: [], late: [], radioTooLong: [], dfu: [],
    dongleUnknown: [], resets: 0, ports: [],
  });
  const listeners = {};
  const ascii = s => [...s].map(c => c.charCodeAt(0));
  const h2 = x => x.toString(16).padStart(2, '0');
  const hex = b => b.map(h2).join(' ');
  let current = null;

  function makePort() {
    let ctrl = null, stream = null, lost = false, opened = false;
    const p = {
      async open() {
        if (lost) throw new DOMException('device lost', 'NetworkError');
        if (opened) throw new DOMException('already open', 'InvalidStateError');
        opened = true; current = p; sim.onlyBoot05 = true;
        stream = new ReadableStream({ start(c) { ctrl = c; } });
        sim.events.push('open');
        if (!sim.activated && !sim.silentOpen) setTimeout(() => p._push(ascii('ACTIVENOT')), 30);
      },
      async close() {
        if (!opened) return;
        opened = false; sim.clean = false; sim.events.push('close');
        try { ctrl.close(); } catch (e) {}
        stream = null;
      },
      async setSignals(s) { if (s && s.dataTerminalReady) sim.events.push('dtr'); },
      getInfo() { return { usbVendorId: 0x1fee, usbProductId: 0x0002 }; },
      get connected() { return !lost; },
      get readable() { return (opened && !lost) ? stream : null; },
      get writable() { return { getWriter: () => ({ write: async b => handle([...b]), releaseLock() {} }) }; },
      _push(arr) { if (opened && !lost && ctrl) { try { ctrl.enqueue(new Uint8Array(arr)); } catch (e) {} } },
      _lose() {
        lost = true; opened = false;
        try { ctrl.error(new DOMException('The device has been lost.', 'NetworkError')); } catch (e) {}
      },
    };
    return p;
  }
  const reply = (arr, ms = 15) => { const p = current; setTimeout(() => p && p._push(arr), ms); };
  const label = b => {
    const s = String.fromCharCode(...b);
    if (s.startsWith('BOOT') && b.length === 5) return 'BOOT ' + h2(b[4]);
    return /^[\x20-\x7e]+$/.test(s) ? s : hex(b);
  };
  /* Riavvio: la porta cade, il dongle ricompare come porta nuova (stesso VID/PID). */
  function reset() {
    sim.resets++; sim.events.push('reset');
    const old = current;
    Object.assign(sim, { state: 'wait', target: null, pendingData: false, actWait: false });
    setTimeout(() => {
      old._lose();
      sim.ports = sim.ports.filter(x => x !== old);
      (listeners.disconnect || []).forEach(f => f({ target: old }));
      setTimeout(() => {
        const np = makePort();
        sim.ports.push(np); sim.clean = true;
        (listeners.connect || []).forEach(f => f({ target: np }));
      }, sim.reappearMs);
    }, 40);
  }
  function handle(b) {
    const s = String.fromCharCode(...b);
    sim.sent.push(hex(b)); sim.events.push('w:' + label(b));
    const first = sim.onlyBoot05;
    sim.onlyBoot05 = sim.onlyBoot05 && s === 'BOOT\x05';

    if (!sim.activated) {                         // accetta solo l'attivazione
      if (s === 'READACTIV') {
        sim.actWait = true;
        reply([...ascii('ACT'), ...sim.mac.slice().reverse().map(x => (~x) & 0xff)]);
      } else if (sim.actWait) {                   // qualunque altro messaggio è la chiave
        if (b.length === 6 && b.every((x, i) => x === sim.key[i])) {
          sim.activated = true; sim.actWait = false; reply(ascii('ACTIVDONE'));
        } else reply(ascii('ACTIVFAKE'));
      } else reply(ascii('ACTIVENOT'));
      return;
    }
    if (sim.state === 'wait') {
      /* porta riaperta senza staccare il dongle: il primo messaggio vale anche come
         frame di gara. "BOOT" = 0x42 → stato 2, cioè partenza. */
      if (first && !sim.clean && [1, 2, 3, 4, 5, 0x0f, 0x15].includes(b[0] & 0x1f)) sim.dangerous.push(label(b));
      if (s.startsWith('STOPBOOT')) { if (first) reset(); else sim.late.push('STOPBOOT'); return; }
      if (s.startsWith('BOOT') && b.length === 5) {
        if (!first) { sim.late.push(label(b)); return; }
        const t = b[4];
        if (t === 5) return;
        if (sim.bootOk[t]) { sim.state = 'boot'; sim.target = t; reply(ascii('BOOTOK'), 20); }
        else setTimeout(reset, 200);               // il dongle chiama ~1 s, poi si riavvia
      }
      return;                                      // il resto viene ignorato
    }
    // ---- BOOT ----
    if (s.startsWith('STOPBOOT')) { reset(); return; }
    if (sim.target === 0x0c) {
      const k = hex(b);
      if (k === '0c 11 00 00 02') sim.last = [0x04, 0x0f];
      else if (k === '0c 12 00 40 01') sim.last = [0xff];
      else if (s === 'READMACVL') sim.last = sim.mac.slice();
      else sim.dongleUnknown.push(k);              // il dongle vero ripeterebbe la risposta precedente
      reply(sim.last);
      return;
    }
    if (sim.pendingData) {                         // il secondo messaggio di una scrittura
      sim.pendingData = false;
      if (sim.dataReply) reply(ascii(sim.dataReply), 30);
      return;
    }
    if (b.length > 6) sim.radioTooLong.push(hex(b)); // un comando così lungo blocca il dispositivo
    if (b[0] !== sim.target) return;
    if (b.length === 6 && b[1] === 0x02) {
      if (b[3] === 0x80) sim.dfu.push(hex(b));
      if (sim.headerReply) reply(ascii(sim.headerReply), 5);
      sim.pendingData = sim.headerReply === 'DO';
      return;
    }
    if (b.length === 5) reply(sim.reads[hex(b)] || Array(b[4]).fill(0xff), 20);
  }

  const first = makePort();
  sim.ports = [first];
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      async requestPort() { return sim.ports[0]; },
      async getPorts() { return sim.ports.slice(); },
      addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
      removeEventListener() {},
    },
  });
}

/* ---------- utilità ---------- */
async function apri(ctx, opts, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.__dialogs = [];
  page.on('dialog', d => { page.__dialogs.push(d.message()); d.accept(); });
  await page.addInitScript(dongleStub, opts || {});
  await page.goto(BASE + '/o2-bootloader/', { waitUntil: 'networkidle' });
  await page.selectOption('#__langsel', 'it');
  await page.waitForTimeout(100);
  return page;
}
const idle = page => page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false', null, { timeout: 20000 });
const pulisci = page => page.evaluate(() => { __sim.sent = []; __sim.events = []; });
const sim = page => page.evaluate(() => JSON.parse(JSON.stringify(__sim)));
const setSim = (page, o) => page.evaluate(o => Object.assign(__sim, o), o);
const setRead = (page, k, v) => page.evaluate(([k, v]) => { __sim.reads[k] = v; }, [k, v]);
async function act(page, sel) {
  await pulisci(page);
  await page.click(sel);
  await page.waitForTimeout(40);
  await idle(page);
  return sim(page);
}
const txt = (page, s) => page.locator(s).innerText();
/* il registro sta in un <details> che può essere chiuso: lì innerText è vuoto */
const logTxt = page => page.evaluate(() => document.getElementById('log').textContent);
const prima = (arr, a, b) => arr.indexOf(a) >= 0 && arr.indexOf(a) < arr.indexOf(b);
/* le scritture dopo l'ultima apertura della porta */
const dopoUltimaApertura = ev => ev.slice(ev.lastIndexOf('open') + 1).filter(e => e.startsWith('w:'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const errors = [];

  // ===================================================================
  console.log('\n== CONNESSIONE ==');
  const page = await apri(ctx, {}, errors);
  let s = await act(page, '#btnConn');
  ok(prima(s.events, 'open', 'dtr'), 'porta aperta con DTR attivo: ' + s.events.join(' '));
  ok(s.sent.length === 0, 'alla connessione non parte nessun messaggio');
  ok(/connesso/.test(await txt(page, '#st')), 'stato connessione: ' + await txt(page, '#st'));
  ok(/verificare/.test(await txt(page, '#actSt')), 'attivazione da verificare: ' + await txt(page, '#actSt'));

  /* Fuori dal boot il dongle non risponde ai comandi a registri: i pulsanti
     restano spenti e una riga dice perché. */
  for (const id of ['#btnFw', '#btnMac', '#btnRead', '#btnWrite', '#btnRaw']) {
    ok(await page.locator(id).isDisabled(), `${id} spento finché non si entra in boot`);
  }
  ok(await page.locator('#bootHint').isVisible(), 'ed è scritto perché: ' + (await txt(page, '#bootHint')).slice(0, 50) + '…');

  // ===================================================================
  console.log('\n== RESET PRIMA DEL BOOT (STOPBOOT come primo messaggio) ==');
  await page.selectOption('#tgt', 'controller');
  s = await act(page, '#btnBoot');
  ok(s.events.indexOf('w:STOPBOOT') === s.events.findIndex(e => e.startsWith('w:')),
     'il primo messaggio dopo l\'apertura è STOPBOOT');
  ok(prima(s.events, 'w:STOPBOOT', 'reset') && prima(s.events, 'reset', 'open') &&
     prima(s.events, 'open', 'dtr') && prima(s.events, 'dtr', 'w:BOOT 09'),
     'STOPBOOT → riavvio → riapertura con DTR → BOOT 09: ' + s.events.join(' | '));
  ok(!s.events.slice(0, s.events.indexOf('reset')).some(e => e.startsWith('w:BOOT')),
     'nessun BOOT prima del riavvio');
  ok(s.dangerous.length === 0, 'nessun messaggio letto come comando di gara');
  ok(/boot/.test(await txt(page, '#bootSt')) && /controller/i.test(await txt(page, '#bootSt')),
     'in boot sul controller: ' + await txt(page, '#bootSt'));
  for (const id of ['#btnFw', '#btnRead', '#btnWrite', '#btnRaw']) {
    ok(!(await page.locator(id).isDisabled()), `${id} acceso dopo BOOTOK`);
  }
  ok(await page.locator('#btnMac').isDisabled(), 'READMACVL spento sul controller (esiste solo sul dongle)');
  ok(!(await page.locator('#bootHint').isVisible()), 'e l\'avviso sparisce');

  // ===================================================================
  console.log('\n== VERSIONE FIRMWARE (controller) ==');
  await setRead(page, '09 11 00 80 02', [0x04, 0x14]);
  s = await act(page, '#btnFw');
  ok(s.sent[0] === '09 11 00 80 02', 'versione con la lettura flash di 0x80: ' + s.sent[0]);
  ok((await txt(page, '#infoOut')).includes('v4.20'), 'decodifica: ' + await txt(page, '#infoOut'));

  // ===================================================================
  /* I frame attesi qui sotto NON sono quelli che genera l'app: sono copiati dalle
     catture USB del programma ufficiale, quelle in cui l'azione è scritta nel nome
     del file e si cambia un campo per volta. Sono tutte su un SCP-3 (prefisso 09):
       ID 5         cattura "scp3 cambio id"            09 02 00 02 03 0f + 05 05 05
       pit lane 26  cattura "scp3 cambio velocita pit"  09 02 00 10 01 1a + 1a
       MAC 12:34    cattura "scp3 cambio mac …12-34…"   09 02 00 20 08 d0 + 12 12 12 ff 34 34 34 ff */
  console.log('\n== CAMPI DEL CONTROLLER (frame delle catture) ==');
  const campo = async (page, f, val, lettura, risposta, scrittura, riletto) => {
    await page.selectOption('#tgt', f.tgt);
    await page.fill(f.input, val);
    await page.waitForTimeout(60);
    await setRead(page, lettura, risposta);
    let s = await act(page, f.read);
    ok(s.sent[0] === lettura, `${f.nome}: lettura ${s.sent[0]} (attesa ${lettura})`);
    ok((await txt(page, f.out)).includes(riletto), `${f.nome}: riletto → ${await txt(page, f.out)}`);
    s = await act(page, f.write);
    ok(JSON.stringify(s.sent) === JSON.stringify(scrittura), `${f.nome}: scrittura ${s.sent.join(' | ')}`);
    ok(/✓/.test(await txt(page, f.out)), `${f.nome}: confermata dal DO ai dati`);
  };
  const ID_CTRL = { nome: 'ID controller', tgt: 'controller', input: '#vCtrlId', read: '#bCtrlIdR', write: '#bCtrlIdW', out: '#oCtrlId' };
  const PIT = { nome: 'velocità pit lane', tgt: 'controller', input: '#vPit', read: '#bPitR', write: '#bPitW', out: '#oPit' };
  const MAC_CTRL = { nome: 'MAC O2 controller', tgt: 'controller', input: '#vMacCtrl', read: '#bMacCtrlR', write: '#bMacCtrlW', out: '#oMacCtrl' };
  await campo(page, ID_CTRL, '5', '09 12 00 02 01', [0x05], ['09 02 00 02 03 0f', '05 05 05'], '5');
  await campo(page, PIT, '26', '09 12 00 10 02', [0x1a, 0x1a], ['09 02 00 10 01 1a', '1a'], '26');
  page.__dialogs.length = 0;
  await campo(page, MAC_CTRL, '12 34', '09 12 00 20 05', [0x12, 0x12, 0x12, 0xff, 0x34],
              ['09 02 00 20 08 d0', '12 12 12 ff 34 34 34 ff'], '12:34');
  const dlg = page.__dialogs.join(' ');
  ok(/MAC O2/.test(dlg) && /12:34/.test(dlg), 'la conferma dice cosa cambia e ricorda il valore letto: ' + dlg.slice(0, 90) + '…');
  ok(await page.locator('[data-tgt="controller"].warnbox').isVisible(), 'avviso sul MAC O2 del controller visibile');
  ok(/0x70/.test(await txt(page, '[data-tgt="controller"].warnbox')), 'e spiega che 0x70 non riporta il MAC originale');

  /* Il campo MAC non ha maxlength: il limite lo fa il filtro, altrimenti il browser
     tronca prima che il JS pulisca e incollando due byte se ne perde una cifra. */
  await page.fill('#vMacCtrl', '12:34:56');
  await page.waitForTimeout(60);
  ok((await txt(page, '#pMacCtrl')).includes('12 12 12 ff 34 34 34 ff'),
     'MAC: il testo in eccesso viene scartato, non sposta i byte: ' + await txt(page, '#pMacCtrl'));
  await page.fill('#vCtrlId', '99');
  s = await act(page, '#bCtrlIdW');
  ok(s.sent.length === 0, 'ID fuori intervallo: nessun frame inviato');
  ok((await txt(page, '#oCtrlId')).length > 3, 'e lo dice: ' + await txt(page, '#oCtrlId'));
  await page.fill('#vCtrlId', '5');

  // ===================================================================
  console.log('\n== CONFERMA DI SCRITTURA: CONTA SOLO IL DO AI DATI ==');
  /* Il bug: l'app cercava "DO" nelle due risposte messe insieme, quindi un AB sui
     dati passava per "scritto ✓" grazie al DO dell'intestazione. */
  await setSim(page, { dataReply: 'AB' });
  s = await act(page, '#bPitW');
  ok(s.sent.length === 2, 'intestazione e dati inviati: ' + s.sent.join(' | '));
  let out = await txt(page, '#oPit');
  ok(!/✓/.test(out) && /AB/.test(out), 'AB sui dati → errore, non «scritto»: ' + out);
  await setSim(page, { dataReply: null });
  s = await act(page, '#bPitW');
  out = await txt(page, '#oPit');
  ok(!/✓/.test(out), 'nessuna risposta ai dati → non confermata: ' + out);
  await setSim(page, { dataReply: 'DO', headerReply: 'AB' });
  s = await act(page, '#bPitW');
  ok(s.sent.length === 1, 'AB all\'intestazione → i dati non partono: ' + s.sent.join(' | '));
  ok(!/✓/.test(await txt(page, '#oPit')), 'e niente conferma: ' + await txt(page, '#oPit'));
  await setSim(page, { headerReply: null });
  s = await act(page, '#bPitW');
  ok(s.sent.length === 1, 'nessun DO all\'intestazione → i dati non partono');
  await setSim(page, { headerReply: 'DO' });

  // ===================================================================
  console.log('\n== CONSOLE REGISTRI (controller) ==');
  await page.fill('#regA', '20');
  await page.fill('#regL', '5');
  await page.waitForTimeout(60);
  ok((await txt(page, '#prevR')).includes('09 12 00 20 05'), 'anteprima lettura: ' + await txt(page, '#prevR'));
  await setRead(page, '09 12 00 20 05', [0x12, 0x12, 0x12, 0xff, 0x34]);
  s = await act(page, '#btnRead');
  ok(s.sent[0] === '09 12 00 20 05', 'frame di lettura inviato');
  out = await txt(page, '#regOut');
  ok(/12 12 12 ff 34/.test(out) && /✓/.test(out), 'risposta e lunghezza attesa: ' + out);
  ok(/0x12/.test(out), 'i dati ripetuti si leggono come un valore (niente «marcatori RRR»): ' + out);
  await setRead(page, '09 12 00 20 05', [0xff, 0xff]);
  s = await act(page, '#btnRead');
  out = await txt(page, '#regOut');
  ok(!/✓/.test(out) && /5/.test(out) && /2/.test(out), 'lunghezza diversa segnalata: ' + out);

  const nonParte = async (descr, prep, btn = '#btnRead') => {
    await prep();
    await page.waitForTimeout(60);
    const s = await act(page, btn);
    const o = await txt(page, '#regOut');
    ok(s.sent.length === 0 && o.length > 15, `${descr}: non inviato — ${o.slice(0, 80)}`);
  };
  await nonParte('lettura impostazioni di 0x80', async () => {
    await page.fill('#regA', '80'); await page.fill('#regL', '2'); await page.selectOption('#regOp', '12'); });
  await page.selectOption('#regOp', '11');
  await setRead(page, '09 11 00 80 02', [0x04, 0x14]);
  s = await act(page, '#btnRead');
  ok(s.sent[0] === '09 11 00 80 02', 'lettura flash di 0x80 (la versione) consentita: ' + s.sent[0]);
  await page.selectOption('#regOp', '12');
  await nonParte('0x20 letto con 6 byte (ne ha 5)', async () => { await page.fill('#regA', '20'); await page.fill('#regL', '6'); });
  await nonParte('lettura di 9 byte', async () => { await page.fill('#regA', '33'); await page.fill('#regL', '9'); });
  await nonParte('scrittura di 0x80 (DFU)', async () => { await page.fill('#regA', '80'); await page.fill('#regV', 'b1'); }, '#btnWrite');
  await nonParte('MAC con 7 byte invece di 8', async () => { await page.fill('#regA', '20'); await page.fill('#regV', '12 12 12 ff 34 34 34'); }, '#btnWrite');
  await nonParte('scrittura di 0x00 (sola lettura)', async () => { await page.fill('#regA', '00'); await page.fill('#regV', '04'); }, '#btnWrite');
  await nonParte('scrittura di un registro non gestito', async () => { await page.fill('#regA', '33'); await page.fill('#regV', '01'); }, '#btnWrite');

  /* Scrittura in DUE messaggi: intestazione con lunghezza e checksum, poi i dati. */
  await page.fill('#regA', '10');
  await page.fill('#regV', 'cc');
  await page.waitForTimeout(60);
  ok((await txt(page, '#prevW')).includes('09 02 00 10 01 cc') && (await txt(page, '#prevW')).includes('+ cc'),
     'anteprima scrittura, due messaggi: ' + await txt(page, '#prevW'));
  s = await act(page, '#btnWrite');
  ok(JSON.stringify(s.sent) === JSON.stringify(['09 02 00 10 01 cc', 'cc']), 'scrittura in due messaggi: ' + s.sent.join(' | '));
  ok(/✓/.test(await txt(page, '#regOut')), 'confermata: ' + await txt(page, '#regOut'));
  await setSim(page, { dataReply: 'AB' });
  s = await act(page, '#btnWrite');
  ok(!/✓/.test(await txt(page, '#regOut')) && /AB/.test(await txt(page, '#regOut')),
     'console: AB sui dati → errore: ' + await txt(page, '#regOut'));
  await setSim(page, { dataReply: 'DO' });

  // ===================================================================
  console.log('\n== CONSOLE GREZZA (controller) ==');
  await page.locator('details summary').click();
  const grezzo = async (val, deveUscire, descr) => {
    await page.fill('#rawIn', val);
    const s = await act(page, '#btnRaw');
    ok(deveUscire ? s.sent.length === 1 : s.sent.length === 0,
       `${descr}: ${deveUscire ? 'inviato ' + s.sent[0] : 'non inviato — ' + (await txt(page, '#rawOut')).slice(0, 70)}`);
  };
  await grezzo('09 02 00 80 01 b1', false, 'scrittura di 0x80 scritta in esadecimale');
  await grezzo('0a 02 00 80 01 b1', false, '… anche con l\'altro prefisso');
  await grezzo('09 12 00 80 02', false, 'lettura impostazioni di 0x80');
  await grezzo('09 11 00 80 02', true, 'lettura flash di 0x80');
  await grezzo('09 02 00 10 01 1a', false, 'intestazione di scrittura (va fatta dalla console)');
  await grezzo('0a 12 00 02 01', false, 'prefisso di un altro dispositivo');
  await grezzo('09 12 00 02 01 00 00', false, 'comando più lungo di 6 byte');
  await grezzo(Array(33).fill('09').join(' '), false, '33 byte');
  await grezzo('BOOT', false, 'BOOT a mano');
  await grezzo('DFU', false, 'comando di aggiornamento forzato');
  await grezzo('READLICVL', false, 'lettura della licenza');
  s = await sim(page);
  ok(s.dfu.length === 0, 'nessuna scrittura di 0x80 è arrivata al dispositivo');
  ok(s.radioTooLong.length === 0, 'nessun comando radio più lungo di 6 byte');

  // ===================================================================
  console.log('\n== USCITA DAL BOOT E AUTO (prefisso 0a) ==');
  s = await act(page, '#btnStop');
  ok(prima(s.events, 'w:STOPBOOT', 'reset') && prima(s.events, 'reset', 'open') && prima(s.events, 'open', 'dtr'),
     'Esci: STOPBOOT, riavvio, porta riaperta da sola: ' + s.events.join(' | '));
  ok(/connesso/.test(await txt(page, '#st')) && /non in boot/.test(await txt(page, '#bootSt')),
     'di nuovo connesso, fuori dal boot');
  await page.selectOption('#tgt', 'chip');
  s = await act(page, '#btnBoot');
  ok(JSON.stringify(s.events.filter(e => e.startsWith('w:'))) === JSON.stringify(['w:BOOT 0a']),
     'porta appena riaperta dopo un riavvio: BOOT 0a diretto, senza un altro STOPBOOT: ' + s.events.join(' | '));
  ok(/chip/.test(await txt(page, '#bootSt')), 'in boot sul chip auto: ' + await txt(page, '#bootSt'));

  /* Sull'auto i frame sono gli stessi delle catture SCP-3, col prefisso 0a. */
  const ID_CAR = { nome: 'ID auto', tgt: 'chip', input: '#vCarId', read: '#bCarIdR', write: '#bCarIdW', out: '#oCarId' };
  const PAIR = { nome: 'abbinamento auto', tgt: 'chip', input: '#vPair', read: '#bPairR', write: '#bPairW', out: '#oPair' };
  await campo(page, ID_CAR, '5', '0a 12 00 02 01', [0x05], ['0a 02 00 02 03 0f', '05 05 05'], '5');
  page.__dialogs.length = 0;
  await campo(page, PAIR, '12 34', '0a 12 00 20 05', [0x12, 0x12, 0x12, 0xff, 0x34],
              ['0a 02 00 20 08 d0', '12 12 12 ff 34 34 34 ff'], '12:34');
  ok(/abbinamento/i.test(page.__dialogs.join(' ')) && !/clon/i.test(page.__dialogs.join(' ')),
     'sull\'auto 0x20 è l\'abbinamento, non un clone: ' + page.__dialogs.join(' ').slice(0, 80) + '…');
  ok(/Abbinamento/.test(await txt(page, 'label[for="vPair"]')), 'etichetta: ' + await txt(page, 'label[for="vPair"]'));
  ok(!(await page.locator('#vPit').isVisible()), 'niente velocità pit lane sull\'auto (la ignora)');
  ok(!(await page.locator('#vMacCtrl').isVisible()), 'niente «MAC O2» sull\'auto');
  ok(await page.locator('[data-tgt="chip"].warnbox').isVisible() &&
     !(await page.locator('[data-tgt="controller"].warnbox').isVisible()), 'avviso dell\'abbinamento, non quello del MAC O2');
  await nonParte('pit lane (0x10) scritto sull\'auto', async () => { await page.fill('#regA', '10'); await page.fill('#regV', '1a'); }, '#btnWrite');
  await nonParte('0x70 scritto sull\'auto', async () => { await page.fill('#regA', '70'); await page.fill('#regV', '12 34'); }, '#btnWrite');

  // da boot su un dispositivo a boot su un altro
  await page.selectOption('#tgt', 'controller');
  await page.waitForTimeout(60);
  ok(await page.locator('#bCtrlIdR').isDisabled(), 'in boot sull\'auto i campi del controller restano spenti');
  ok(/controller/i.test(await txt(page, '#bootHint')), 'e la riga dice di rientrare in boot: ' + (await txt(page, '#bootHint')).slice(0, 70));
  s = await act(page, '#btnBoot');
  ok(prima(s.events, 'w:STOPBOOT', 'reset') && prima(s.events, 'dtr', 'w:BOOT 09') && !s.events.includes('close'),
     'in boot STOPBOOT basta, senza riaprire prima: ' + s.events.join(' | '));

  // ===================================================================
  console.log('\n== DONGLE (prefisso 0c) ==');
  await page.selectOption('#tgt', 'dongle');
  s = await act(page, '#btnBoot');
  const scr = dopoUltimaApertura(s.events);
  ok(JSON.stringify(scr) === JSON.stringify(['w:BOOT 05', 'w:BOOT 0c']), 'BOOT 05 poi BOOT 0c dopo il riavvio: ' + s.events.join(' | '));
  s = await act(page, '#btnFw');
  ok(s.sent[0] === '0c 11 00 00 02' && (await txt(page, '#infoOut')).includes('v4.15'), 'versione dongle: ' + await txt(page, '#infoOut'));
  s = await act(page, '#btnMac');
  ok(s.sent[0] === '52 45 41 44 4d 41 43 56 4c', 'READMACVL inviato');
  /* READMACVL manda già il byte più significativo per primo: non si gira. */
  ok((await txt(page, '#infoOut')).includes('12:34:56:78:9A:BC'), 'MAC del dongle non invertito: ' + await txt(page, '#infoOut')); // allow-secret
  ok(await page.locator('#btnWrite').isDisabled(), 'sul dongle «Scrivi» è spento');
  ok(await page.locator('#conHint').isVisible(), 'e la console dice quali sono le due letture del dongle');
  await page.fill('#regA', '11'); await page.selectOption('#regOp', '12'); await page.fill('#regL', '2');
  await nonParte('0c 12 00 11 02 (il dongle ripeterebbe la risposta precedente)', async () => {});
  await page.fill('#regA', '40'); await page.fill('#regL', '1');
  s = await act(page, '#btnRead');
  ok(s.sent[0] === '0c 12 00 40 01' && /ff/.test(await txt(page, '#regOut')), 'stato aggiornamento: ' + await txt(page, '#regOut'));
  await grezzo('0c 11 04 0e 01', false, 'il vecchio «imposta» del dongle');
  await grezzo('0c 11 00 00 02', true, 'versione dongle a mano');
  ok((await sim(page)).dongleUnknown.length === 0, 'al dongle non è arrivato nessun 0c che non esiste');
  ok(await page.locator('#btnActRead').isDisabled(), 'READACTIV spento in boot');

  // ===================================================================
  console.log('\n== READACTIV SU UN DONGLE GIÀ ATTIVATO ==');
  await act(page, '#btnStop');
  s = await act(page, '#btnActRead');
  ok(JSON.stringify(s.events.filter(e => e.startsWith('w:'))) === JSON.stringify(['w:READACTIV']),
     'porta appena riaperta: READACTIV diretto: ' + s.events.join(' | '));
  ok(/già attivato/.test(await txt(page, '#actOut')) && /^attivato$/i.test(await txt(page, '#actSt')),
     'nessuna risposta = attivato: ' + await txt(page, '#actOut'));
  s = await act(page, '#btnActRead');
  ok(prima(s.events, 'close', 'open') && prima(s.events, 'dtr', 'w:STOPBOOT') && prima(s.events, 'reset', 'w:READACTIV'),
     'porta già usata: la riapre, STOPBOOT, riavvio, poi READACTIV: ' + s.events.join(' | '));
  s = await sim(page);
  ok(s.dangerous.length === 0, 'in tutta la sessione nessun messaggio letto come comando di gara: ' + s.dangerous.join(', '));
  ok(s.late.length === 0, 'nessun BOOT/STOPBOOT mandato quando non era il primo messaggio: ' + s.late.join(', '));

  // ===================================================================
  console.log('\n== TESTI ==');
  const corpo = await page.locator('body').innerText();
  ok((await page.locator('#regTbody tr').count()) === 11, 'tabella dei registri: 11 righe');
  ok(/0x70/.test(await txt(page, '#regTbody')) && /ignorato/.test(await txt(page, '#regTbody')),
     'la tabella dice cosa l\'auto ignora');
  /* Repo pubblica: i testi dicono i registri col numero e un nome descrittivo, mai
     con gli identificatori interni del firmware (nomi_con_trattino_basso), e non
     citano i sorgenti. Si controllano tutte le stringhe delle tre lingue, non solo
     quelle a video in questo momento. */
  const stringhe = await page.evaluate(() =>
    Object.values(window.I18N_STRINGS).flatMap(o => Object.values(o)).join(' \n '));
  const ident = stringhe.match(/\b\w+_\w+\b/g) || [];
  ok(ident.length === 0, 'nei testi nessun identificatore interno' + (ident.length ? ': ' + ident.join(', ') : ''));
  const sorgente = fs.readFileSync(path.join(__dirname, '..', 'web', 'o2-bootloader', 'index.html'), 'utf8');
  const vietati = /sorgent|nomi del firmware|firmware names|issue #|reverse(?!\(\))|farsi passare|impersona/i;
  ok(!vietati.test(sorgente), 'nel file nessun riferimento ai sorgenti' +
     (vietati.test(sorgente) ? ': ' + sorgente.match(vietati)[0] : ''));
  ok(!/READLICVL|CLEARLICV/.test(sorgente), 'l\'app non usa READLICVL né CLEARLICV');
  ok(!/spegni i controller|13 byte ogni 10 ms/i.test(corpo), 'niente avviso sulla telemetria in boot (in boot non ne arriva)');

  await page.selectOption('#__langsel', 'en');
  await page.waitForTimeout(150);
  ok(/read/.test(await txt(page, '#prevR')), 'anteprima tradotta dopo il cambio lingua: ' + await txt(page, '#prevR'));
  await page.selectOption('#__langsel', 'es');
  await page.waitForTimeout(150);
  ok(/lectura/.test(await txt(page, '#regTbody')), 'tabella tradotta in spagnolo');
  await page.selectOption('#__langsel', 'it');

  await page.fill('#noteIn', 'cambiato ID del controller da 4 a 5');
  await page.click('#btnNote');
  ok((await logTxt(page)).includes('cambiato ID del controller da 4 a 5'), 'annotazione finita nel registro');
  await page.close();

  // ===================================================================
  console.log('\n== ATTIVAZIONE (dongle non attivato) ==');
  const p2 = await apri(ctx, { activated: false }, errors);
  s = await act(p2, '#btnConn');
  ok(/non attivato/i.test(await txt(p2, '#actSt')), 'ACTIVENOT all\'apertura → «non attivato»: ' + await txt(p2, '#actSt'));
  ok(await p2.locator('#btnBoot').isDisabled(), 'boot spento');
  ok(/ACTIVENOT/.test(await txt(p2, '#bootHint')), 'e la riga dice perché: ' + (await txt(p2, '#bootHint')).slice(0, 60));
  ok(await p2.locator('#btnActSend').isDisabled() && await p2.locator('#actHint').isVisible(),
     'invio chiave spento prima di READACTIV, e lo dice: ' + await txt(p2, '#actHint'));
  s = await act(p2, '#btnActRead');
  ok(JSON.stringify(s.sent) === JSON.stringify(['52 45 41 44 41 43 54 49 56']), 'READACTIV inviato (niente STOPBOOT: già noto non attivato)');
  /* ACT + MAC negato e in ordine inverso rispetto a READMACVL: si mostra nell'ordine di READMACVL. */
  ok((await txt(p2, '#actOut')).includes('12:34:56:78:9A:BC'), 'MAC nell\'ordine di READMACVL: ' + await txt(p2, '#actOut')); // allow-secret
  ok(/chiave/i.test(await txt(p2, '#actSt')), 'stato: ' + await txt(p2, '#actSt'));
  ok(await p2.locator('#btnBoot').isDisabled() && await p2.locator('#btnRaw').isDisabled(),
     'mentre aspetta la chiave gli altri comandi sono spenti');
  ok(!(await p2.locator('#btnActRead').isDisabled()), 'READACTIV resta disponibile');
  await p2.fill('#actKey', 'AA:BB:CC:DD:EE:F'); // allow-secret
  await p2.waitForTimeout(40);
  ok(await p2.locator('#btnActSend').isDisabled(), 'chiave incompleta: invio spento');
  await p2.fill('#actKey', 'AA:BB:CC:DD:EE:FF'); // allow-secret
  await p2.waitForTimeout(40);
  s = await act(p2, '#btnActSend');
  ok(JSON.stringify(s.sent) === JSON.stringify(['aa bb cc dd ee ff']), 'i 6 byte inoltrati così come scritti: ' + s.sent[0]);
  ok(/ACTIVFAKE/.test(await txt(p2, '#actOut')) && /chiave/i.test(await txt(p2, '#actSt')),
     'ACTIVFAKE: chiave sbagliata, il dongle aspetta ancora: ' + (await txt(p2, '#actOut')).slice(0, 60));
  ok((await logTxt(p2)).includes('chiave di attivazione') && !(await logTxt(p2)).includes('aa bb cc dd ee ff'), 'la chiave non finisce nel registro scaricabile');
  await p2.fill('#actKey', '0A:1B:2C:3D:4E:5F'); // allow-secret
  await p2.waitForTimeout(40);
  s = await act(p2, '#btnActSend');
  ok(/ACTIVDONE/.test(await txt(p2, '#actOut')) && /^attivato$/i.test(await txt(p2, '#actSt')),
     'ACTIVDONE → attivato: ' + await txt(p2, '#actSt'));
  ok(!(await p2.locator('#btnBoot').isDisabled()), 'ora il boot si accende');
  await p2.selectOption('#tgt', 'controller');
  s = await act(p2, '#btnBoot');
  ok(prima(s.events, 'close', 'open') && prima(s.events, 'w:STOPBOOT', 'reset') && s.events.includes('w:BOOT 09') &&
     /boot/.test(await txt(p2, '#bootSt')),
     'dopo l\'attivazione: riapre, STOPBOOT, riavvio, BOOT 09: ' + s.events.join(' | '));
  ok((await sim(p2)).dangerous.length === 0, 'nessun messaggio letto come comando di gara');
  await p2.close();

  // ===================================================================
  console.log('\n== ACTIVENOT PERSO ALL\'APERTURA ==');
  const p3 = await apri(ctx, { activated: false, silentOpen: true }, errors);
  await act(p3, '#btnConn');
  await p3.selectOption('#tgt', 'controller');
  s = await act(p3, '#btnBoot');
  ok(JSON.stringify(s.sent) === JSON.stringify(['53 54 4f 50 42 4f 4f 54']),
     'solo STOPBOOT: alla risposta ACTIVENOT niente BOOT: ' + s.sent.join(' | '));
  ok(/non attivato/i.test(await txt(p3, '#actSt')) && /non in boot/.test(await txt(p3, '#bootSt')),
     'riconosciuto come non attivato: ' + await txt(p3, '#actSt'));
  await p3.close();

  // ===================================================================
  console.log('\n== DISPOSITIVO CHE NON RISPONDE A BOOT ==');
  const p4 = await apri(ctx, { bootOk: { 9: true, 10: false, 12: true } }, errors);
  await act(p4, '#btnConn');
  await p4.selectOption('#tgt', 'chip');
  s = await act(p4, '#btnBoot');
  ok(s.events.lastIndexOf('reset') > s.events.indexOf('w:BOOT 0a') && s.events.lastIndexOf('open') > s.events.lastIndexOf('reset'),
     'il dongle si riavvia da solo e l\'app riapre la porta: ' + s.events.join(' | '));
  ok(/connesso/.test(await txt(p4, '#st')) && /non in boot/.test(await txt(p4, '#bootSt')), 'connesso, fuori dal boot');
  ok(/modalità programmazione/.test(await logTxt(p4)), 'il registro suggerisce la modalità programmazione');
  await p4.close();

  // ===================================================================
  console.log('\n== ERRORI JS ==');
  const veri = errors.filter(e => !/Failed to load resource/.test(e));
  ok(veri.length === 0, 'nessun errore JS' + (veri.length ? ': ' + veri.join(' / ') : ''));

  await browser.close();
  console.log(fail ? `\n❌ ${fail} controlli falliti` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
