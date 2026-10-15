/* Test end-to-end dei due configuratori Bluetooth (web/car-config/ e
 * web/remote-config/) con un Web Bluetooth finto. Nessun hardware.
 *
 *   cd web && python3 -m http.server 8099 &
 *   node tools/test-ble-config.js
 *
 * Lo stub registra ogni frame scritto sulla caratteristica NUS e risponde con
 * una notifica, come fa il dispositivo: i byte del registro per una lettura,
 * "DO" per una scrittura con checksum giusto, "AB" se il checksum è sbagliato.
 * Imita anche i comportamenti che il client deve evitare, così il test fallisce
 * se l'app ci ricasca:
 *   - la versione (0x00) risponde solo al frame da 5 byte; con 3 byte tace;
 *   - la lettura di 0x9a sull'auto la "blocca" (lo stub se lo segna);
 *   - sull'auto la scrittura di 0x8e risponde sempre "AB";
 *   - il telecomando trasforma in "." gli spazi in posizione pari del nome.
 *
 * Cosa conta qui, e che a leggere il diff non si vede: i frame che partono
 * davvero. I due esempi della specifica (09 02 84 32 bd e 0a 02 8f 01 86) sono
 * scritti a mano apposta: confrontare l'app con se stessa non proverebbe niente.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };

/* Lo stub vive nella pagina: va passato come funzione ad addInitScript. I valori
   dei registri sono di fantasia (niente MAC veri: la repo è pubblica). */
function stub() {
  const dev = location.pathname.includes('remote-config') ? 0x0a : 0x09;
  const pad = (s) => [...s.padEnd(14, ' ')].map((c) => c.charCodeAt(0));
  const regs = dev === 0x09 ? {
    0x00: [4, 14, 0x63], 0x01: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 0x81: [1, 2, 24, 10, 30],
    0x82: [0xff, 0xff, 0xff, 0xff], 0x83: pad('Auto prova'), 0x84: [200], 0x85: [0], 0x86: [255],
    0x87: [1], 0x8d: [255], 0x8e: [0], 0x8f: [4], 0x90: [0x12, 0x34], 0x91: [2], 0x94: [200],
    0x95: [4], 0xa1: [0, 0, 0, 0, 0, 0, 0, 0],
  } : {
    0x00: [4, 20, 0x61], 0x01: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 0x81: [1, 2, 24, 10, 30],
    0x82: [0xff, 0xff, 0xff, 0xff], 0x83: pad('Roberto'), 0x88: [0], 0x89: [255], 0x8b: [128],
    0x8c: [2], 0x8e: [0], 0x8f: [3], 0x90: [0x12, 0x34], 0x92: [0], 0x93: [200, 150, 100, 50, 5], 0x94: [0],
  };
  /* Il telecomando trasforma gli spazi in posizione pari del nome in "." (al
     riavvio, ma qui lo si fa ad ogni lettura: è quello che vedrà chi rilegge). */
  const nomeTelecomando = (b) => b.map((x, i) => (x === 0x20 && i % 2 === 0 ? 0x2e : x));
  let notify = null;
  window.__sent = [];
  window.__frozen = false;
  function risposta(f) {
    if (f[0] !== dev) return null;
    const reg = f[2];
    if (f[1] === 0x12) {                       // lettura
      if (reg === 0x9a && dev === 0x09) { window.__frozen = true; return null; }
      if (reg === 0x00 && !(f.length === 5 && f[3] === 0x00 && f[4] === 0x02)) return null;
      const v = regs[reg];
      if (!v) return null;
      return reg === 0x83 && dev === 0x0a ? nomeTelecomando(v) : v;
    }
    if (f[1] === 0x02) {                       // scrittura
      const x = f.slice(0, -1).reduce((a, b) => a ^ b, 0);
      if (x !== f[f.length - 1]) return [0x41, 0x42];
      if (dev === 0x09 && (reg === 0x9a || reg === 0x9b)) return [reg];
      if (dev === 0x09 && reg === 0x8e) return [0x41, 0x42];
      if (reg !== 0x9f) regs[reg] = f.slice(3, -1);
      return [0x44, 0x4f];
    }
    return null;
  }
  const rx = {
    async writeValueWithoutResponse(buf) {
      const f = [...new Uint8Array(buf.buffer || buf)];
      window.__sent.push(f);
      const r = risposta(f);
      if (r && notify) setTimeout(() => notify({ target: { value: new DataView(new Uint8Array(r).buffer) } }), 20);
    },
  };
  const tx = {
    async startNotifications() {},
    addEventListener(t, cb) { if (t === 'characteristicvaluechanged') notify = cb; },
  };
  const service = { async getCharacteristic(u) { return u.startsWith('6e400002') ? rx : tx; } };
  const device = {
    name: dev === 0x09 ? 'CarC -prova' : 'SCP3H-prova', id: 'stub',
    addEventListener() {},
    gatt: { connected: true, async connect() { return { async getPrimaryService() { return service; } }; }, disconnect() {} },
  };
  Object.defineProperty(navigator, 'bluetooth', {
    configurable: true,
    value: { async requestDevice() { return device; } },
  });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const errors = [];
  const dialogs = [];
  ctx.on('weberror', (e) => errors.push(String(e.error())));

  async function apri(path) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.addInitScript(stub);
    await page.goto(BASE + '/' + path, { waitUntil: 'networkidle' });
    await page.click('#btnConn');
    await page.waitForTimeout(150);
    return page;
  }
  const hexs = (a) => a.map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const sent = (p) => p.evaluate(() => window.__sent.map((a) => a.map((x) => x.toString(16).padStart(2, '0')).join(' ')));
  const sentRaw = (p) => p.evaluate(() => window.__sent);
  const clear = (p) => p.evaluate(() => { window.__sent = []; });
  const xorOk = (f) => f.slice(0, -1).reduce((a, b) => a ^ b, 0) === f[f.length - 1];
  /* Un frame del nome: <dev> 02 83 + 14 byte ASCII stampabili + XOR. */
  function frameNome(f, devByte) {
    return f.length === 18 && f[0] === devByte && f[1] === 0x02 && f[2] === 0x83 &&
      f.slice(3, 17).every((x) => x >= 0x20 && x <= 0x7e) && xorOk(f);
  }
  const testoNome = (f) => String.fromCharCode(...f.slice(3, 17));
  async function clic(p, sel, ms = 300) { await clear(p); await p.click(sel); await p.waitForTimeout(ms); }
  /* «Leggi configurazione» fa una ventina di letture, una dopo l'altra: invece di
     un'attesa fissa (fragile su una macchina carica) si aspetta che parta la
     lettura dell'ultimo registro, e poi un margine per la sua risposta.
     ⭐ Che ci arrivi è già un controllo: il timer di un'attesa scaduta azzerava
     il gestore della richiesta successiva, che restava appesa per sempre, e la
     lettura si fermava a metà senza un errore. Con lo stub succedeva quasi
     sempre sul telecomando, dopo una decina di registri. */
  async function leggiTutto(p, ultimo) {
    await clear(p);
    await p.click('#btnReadAll');
    let arrivata = true;
    await p.waitForFunction((u) => window.__sent.some((f) =>
      f.map((x) => x.toString(16).padStart(2, '0')).join(' ') === u), ultimo, { timeout: 20000 })
      .catch(() => { arrivata = false; });
    ok(arrivata, 'la lettura completa arriva fino all\'ultimo registro (' + ultimo + ')' +
       (arrivata ? '' : ': si è fermata dopo ' + (await sent(p)).slice(-1)[0]));
    await p.waitForTimeout(600);
  }
  async function scrivi(p, reg, val, ms = 300) {
    await p.fill('#wReg', reg); await p.fill('#wVal', val);
    await clic(p, '[data-fn=rawwrite]', ms);
  }
  async function leggi(p, reg, ms = 300) {
    await p.fill('#rReg', reg);
    await clic(p, '[data-fn=rawread]', ms);
  }
  const msg = (p) => p.locator('#rawMsg').innerText();

  /* =============================== AUTO =============================== */
  console.log('\n== AUTO: LEGGI CONFIGURAZIONE ==');
  let p = await apri('car-config/');
  ok(await p.locator('#btnReadAll').isEnabled(), 'connesso: «Leggi configurazione» acceso');
  await leggiTutto(p, '09 12 a1');
  let s = await sent(p);
  ok(s[0] === '09 12 00 00 02', 'versione letta con il frame da 5 byte: ' + s[0]);
  ok(!s.some((f) => f.startsWith('09 12 9a')), 'nessuna lettura di 0x9a');
  ok(!(await p.evaluate(() => window.__frozen)), 'l\'auto finta non si è bloccata');
  ok(!s.some((f) => /^09 12 (9b|9f|80)\b/.test(f)), 'nessuna lettura dei comandi (0x9b, 0x9f) né di 0x80');
  ok(s.every((f) => f.length === 8 || f === '09 12 00 00 02'), 'tutte le altre letture sono da 3 byte');
  ok((await p.inputValue('#cName')) === 'Auto prova', 'nome riletto senza il riempimento: «' + await p.inputValue('#cName') + '»');
  ok((await p.inputValue('#cId')) === '4', 'ID riletto: ' + await p.inputValue('#cId'));
  ok((await p.locator('#v0').textContent()).includes('4.14c'), 'versione decodificata: ' + await p.locator('#v0').textContent());
  ok(await p.locator('tr:has(code:text-is("0x9a")) button').count() === 0, 'in tabella 0x9a non ha il pulsante «leggi»');

  console.log('\n== AUTO: NOME ==');
  await p.fill('#cName', 'Città è bella!!');
  ok((await p.inputValue('#cName')) === 'Citta e bella!', 'accenti tolti e taglio a 14 nel campo: «' + await p.inputValue('#cName') + '»');
  await clic(p, '[data-fn=name]');
  let f = (await sentRaw(p))[0] || [];
  ok(frameNome(f, 0x09), 'nome: 18 byte, 14 ASCII + XOR giusto → ' + hexs(f));
  ok(testoNome(f) === 'Citta e bella!', 'nome inviato: «' + testoNome(f) + '»');
  await p.fill('#cName', 'Abc');
  await clic(p, '[data-fn=name]');
  f = (await sentRaw(p))[0] || [];
  ok(frameNome(f, 0x09) && testoNome(f) === 'Abc' + ' '.repeat(11), 'nome corto completato con spazi: «' + testoNome(f) + '»');
  await p.fill('#cName', '€€€');
  ok((await p.inputValue('#cName')) === '', 'i simboli non ASCII si scartano');
  await clic(p, '[data-fn=name]');
  ok((await sent(p)).length === 0, 'nome vuoto: nessun frame');

  console.log('\n== AUTO: CONSOLE GREZZA ==');
  await p.locator('details summary').first().click();
  await leggi(p, '9a');
  ok((await sent(p)).length === 0, 'lettura di 0x9a: nessun frame');
  ok(/0x9a/.test(await msg(p)) && (await msg(p)).length > 30, 'e lo dice: ' + (await msg(p)).slice(0, 70) + '…');
  ok(!(await p.evaluate(() => window.__frozen)), 'l\'auto finta non si è bloccata');
  await leggi(p, '9f');
  ok((await sent(p)).length === 0, 'lettura di 0x9f (comando): nessun frame');
  await leggi(p, '88');
  ok((await sent(p)).length === 0, 'lettura di un registro fuori tabella: nessun frame');
  await leggi(p, '00');
  ok((await sent(p))[0] === '09 12 00 00 02', 'lettura grezza della versione, 5 byte: ' + (await sent(p))[0]);

  await scrivi(p, '80', '00');
  ok((await sent(p)).length === 0, 'scrittura di 0x80 (DFU): nessun frame');
  ok(/0x80/.test(await msg(p)), 'e lo dice: ' + (await msg(p)).slice(0, 70) + '…');
  await scrivi(p, '8e', '01');
  ok((await sent(p)).length === 0, 'scrittura di 0x8e (sola lettura sull\'auto): nessun frame');
  ok(/0x8e/.test(await msg(p)), 'e lo dice: ' + (await msg(p)).slice(0, 70) + '…');
  await scrivi(p, '81', '01 02 18 0a 1e');
  ok((await sent(p)).length === 0, 'scrittura di 0x81 (attivazione): nessun frame');
  await scrivi(p, '88', '01');
  ok((await sent(p)).length === 0, 'scrittura di un registro fuori tabella: nessun frame');
  await scrivi(p, '84', '1a2b');
  ok((await sent(p)).length === 0, 'lunghezza sbagliata (2 byte su 0x84): nessun frame');
  ok(/1/.test(await msg(p)) && /2/.test(await msg(p)), 'e lo dice: ' + (await msg(p)).slice(0, 70) + '…');
  await scrivi(p, '84', '32');
  ok((await sent(p))[0] === '09 02 84 32 bd', 'esempio della specifica: 09 02 84 32 bd → ' + (await sent(p))[0]);
  ok((await msg(p)) === '', 'scrittura lecita: nessun messaggio di blocco');
  await scrivi(p, '83', 'Nome da qui');
  f = (await sentRaw(p))[0] || [];
  ok(frameNome(f, 0x09) && testoNome(f) === 'Nome da qui   ', 'nome dalla console: testo completato a 14 → «' + testoNome(f) + '»');

  console.log('\n== AUTO: ABBINAMENTO E TEST ==');
  dialogs.length = 0;
  await p.fill('#cMac', '1a2b');
  await clic(p, '[data-fn=mac]');
  s = await sent(p);
  ok(s.length === 1 && s[0].startsWith('09 02 90 1a 2b') && xorOk((await sentRaw(p))[0]), 'abbina: solo 0x90 → ' + s.join(' | '));
  ok(dialogs.some((d) => /0x90/.test(d) && /1A2B/.test(d)), 'la conferma dice registro e valore: ' + (dialogs[0] || '').slice(0, 80));
  await clic(p, '[data-fn=motor]');
  ok((await sent(p))[0] === '09 02 9a 00 91', 'test motore: ' + (await sent(p))[0]);
  const logAuto = await p.locator('#log').textContent();
  ok(!/DO=ok/.test(logAuto), 'nel registro niente più «DO=ok»');
  ok(/\(DO: /.test(logAuto), 'il «DO» è annotato come frame accettato');
  await p.close();

  /* ============================ TELECOMANDO ============================ */
  console.log('\n== TELECOMANDO: LEGGI CONFIGURAZIONE ==');
  p = await apri('remote-config/');
  const opzioni = await p.$$eval('#cBrake option', (o) => o.map((x) => x.value));
  ok(JSON.stringify(opzioni) === JSON.stringify(['', '0', '1']), 'modo freno: solo 0 e 1, niente 2 (Sweep) → ' + JSON.stringify(opzioni));
  await leggiTutto(p, '0a 12 94');
  s = await sent(p);
  ok(s[0] === '0a 12 00 00 02', 'versione letta con il frame da 5 byte: ' + s[0]);
  ok(!s.some((f) => f.startsWith('0a 12 8a')), 'nessuna lettura di 0x8a (non gestito)');
  ok(!s.some((f) => /^0a 12 (9f|80)\b/.test(f)), 'nessuna lettura di 0x9f né di 0x80');
  ok((await p.locator('#fFw').innerText()) === '4.20A', 'firmware: ' + await p.locator('#fFw').innerText());
  ok((await p.inputValue('#cName')) === 'Roberto', 'nome riletto, via i "." del riempimento: «' + await p.inputValue('#cName') + '»');
  ok((await p.inputValue('#cBrake')) === '', 'modo freno letto = 2: il menu resta vuoto');
  ok(/= 2/.test(await p.locator('#log').textContent()), 'e il registro lo dice');

  console.log('\n== TELECOMANDO: SCRITTURE ==');
  await p.fill('#cId', '1');
  await clic(p, '[data-fn=id]');
  ok((await sent(p))[0] === '0a 02 8f 01 86', 'esempio della specifica: 0a 02 8f 01 86 → ' + (await sent(p))[0]);
  await p.fill('#cName', 'Roberto Scp3 A');
  await p.selectOption('#cBrake', '1');
  await clic(p, '[data-fn=write]', 600);
  const fr = await sentRaw(p);
  ok(fr.length === 2 && frameNome(fr[0], 0x0a) && testoNome(fr[0]) === 'Roberto Scp3 A', 'Scrivi: nome da 14 byte ASCII + XOR → ' + hexs(fr[0] || []));
  ok(hexs(fr[1] || []) === '0a 02 8c 01 85', 'Scrivi: poi il modo freno 1 → ' + hexs(fr[1] || []));
  await leggiTutto(p, '0a 12 94');
  ok((await p.inputValue('#cName')) === 'Roberto Scp3.A', 'in rilettura lo spazio in posizione pari è diventato «.»: «' + await p.inputValue('#cName') + '»');

  dialogs.length = 0;
  await p.fill('#cMac', '1a2b');
  await clic(p, '[data-fn=clone]');
  s = await sent(p);
  ok(s.length === 1 && s[0].startsWith('0a 02 90 1a 2b'), 'MAC O2: solo 0x90, niente 0x9f dopo → ' + s.join(' | '));
  ok(dialogs.length === 1 && !/commit/i.test(dialogs[0]) && /0x90/.test(dialogs[0]), 'conferma senza «commit»: ' + (dialogs[0] || '').slice(0, 80));

  console.log('\n== TELECOMANDO: CONSOLE GREZZA ==');
  await p.locator('details summary').first().click();
  await scrivi(p, '8c', '02');
  ok((await sent(p)).length === 0, 'modo freno 2 dalla console: nessun frame');
  ok(/Sweep/.test(await msg(p)), 'e lo dice: ' + (await msg(p)).slice(0, 70) + '…');
  await scrivi(p, '8a', '10');
  ok((await sent(p)).length === 0, 'scrittura di 0x8a (non gestito): nessun frame');
  await scrivi(p, '8d', '10');
  ok((await sent(p)).length === 0, 'scrittura di un registro fuori tabella: nessun frame');
  await scrivi(p, '80', '00');
  ok((await sent(p)).length === 0, 'scrittura di 0x80 (DFU): nessun frame');
  await scrivi(p, '00', '04 14 61');
  ok((await sent(p)).length === 0, 'scrittura di 0x00 (sola lettura): nessun frame');
  await scrivi(p, '93', '01 02');
  ok((await sent(p)).length === 0, 'curva con 2 byte invece di 5: nessun frame');
  await scrivi(p, '8b', '40');
  s = await sentRaw(p);
  ok(s.length === 1 && hexs(s[0]).startsWith('0a 02 8b 40') && xorOk(s[0]), 'valore del freno 0x8b: ' + hexs(s[0] || []));
  await leggi(p, '8a');
  ok((await sent(p)).length === 0, 'lettura di 0x8a: nessun frame');

  // cambio lingua: il messaggio della console si ridisegna
  await scrivi(p, '80', '00');
  await p.selectOption('#__langsel', 'en');
  await p.waitForTimeout(150);
  ok(/firmware update/.test(await msg(p)), 'messaggio della console tradotto: ' + (await msg(p)).slice(0, 60) + '…');
  await p.selectOption('#__langsel', 'it');
  const logTel = await p.locator('#log').textContent();
  ok(!/DO=ok/.test(logTel), 'nel registro niente più «DO=ok»');
  await p.close();

  console.log('\n== ERRORI JS ==');
  const veri = errors.filter((e) => !/Failed to load resource/.test(e));
  ok(veri.length === 0, 'nessun errore JS' + (veri.length ? ': ' + veri.join(' / ') : ''));

  await browser.close();
  console.log(fail ? `\n❌ ${fail} controlli falliti` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
