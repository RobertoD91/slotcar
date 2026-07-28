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
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  // ---------- landing ----------
  console.log('\n== LANDING ==');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok((await page.title()) === 'Slot Car Web Tools', 'titolo: ' + (await page.title()));
  ok((await page.locator('h1').innerText()) === 'Slot Car Web Tools', 'h1 corretto');

  const cards = await page.locator('.card').count();
  ok(cards === 10, `card totali = ${cards} (attese 10)`);
  const links = await page.locator('a.card').count();
  ok(links === 7, `card cliccabili = ${links} (attese 7)`);

  // i18n: nessuna chiave grezza rimasta a video
  const body = await page.locator('body').innerText();
  const rawKeys = ['carDesc', 'dsDesc', 'secOxigen', 'badgeActive', 'dsFlashDesc', 'techPwa'];
  ok(!rawKeys.some(k => body.includes(k)), 'i18n applicata (nessuna chiave grezza)');

  // sezioni + card nuove
  ok(body.includes('oXigen') && body.includes('DS Electronic') && body.includes('Ninco'),
    'tutte e tre le sezioni presenti (oXigen, DS Electronic, Ninco)');
  ok(body.includes('DS200'), 'card DS200 presente');

  // disclaimer iniettato da i18n.js, e ora nomina anche DS Electronic
  const disc = await page.locator('#__disc').innerText();
  ok(disc.length > 100, 'disclaimer iniettato');
  ok(disc.includes('DS Electronic'), 'disclaimer nomina DS Electronic');
  ok(disc.includes('Slot.it'), 'disclaimer nomina Slot.it');
  ok(disc.includes('Ninco'), 'disclaimer nomina Ninco');

  // selettore lingua
  ok(await page.locator('#__langsel').count() === 1, 'selettore lingua presente');

  // banner compatibilità: devono seguire la presenza REALE dell'API nel browser
  // (headless Chromium ha navigator.serial ma non navigator.bluetooth)
  const hasBt = await page.evaluate(() => !!navigator.bluetooth);
  const hasSer = await page.evaluate(() => !!navigator.serial);
  ok((await page.locator('#nobt').isVisible()) === !hasBt,
    `banner Web Bluetooth coerente (API presente=${hasBt})`);
  ok((await page.locator('#noser').isVisible()) === !hasSer,
    `banner Web Serial coerente (API presente=${hasSer})`);

  // Footer: la versione arriva da version.json. Non la scrivo a mano nel test (si
  // sfasa ad ogni release): controllo l'invariante vero, cioè che version.json e la
  // costante SITE_VERSION nella pagina coincidano — se divergono, l'utente si becca
  // il banner "Aggiorna" a vuoto ad ogni caricamento.
  await page.waitForFunction(() => document.getElementById('ver').textContent !== '…', null, { timeout: 5000 });
  const ver = await page.locator('#ver').innerText();
  const site = await page.evaluate(() => fetch('version.json').then(r => r.json()).then(j => j.site));
  ok(ver.includes(site), `footer mostra la versione di version.json (${site}): ${ver}`);
  ok(!(await page.locator('#upd').isVisible()),
    'SITE_VERSION == version.json (nessun banner "aggiorna" spurio)');

  // Avviso "versioni di sviluppo" e nastro fork-me
  ok(await page.locator('#dev').isVisible(), 'avviso "versioni di sviluppo" visibile');
  const devTxt = await page.locator('#dev').innerText();
  ok(/end users|utente finale|usuario final/i.test(devTxt), 'avviso dice che non è per utenti finali');
  const rib = page.locator('.ghribbon a');
  ok(await rib.isVisible(), 'nastro "Fork me on GitHub" visibile');
  ok((await rib.getAttribute('href')).includes('github.com/RobertoD91/slotcar'), 'nastro punta al repo');
  // il nastro non deve coprire il selettore lingua
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('.ghribbon a'), s = document.getElementById('__langsel');
    if (!a || !s) return 'manca un elemento';
    const r = a.getBoundingClientRect(), q = s.getBoundingClientRect();
    return !(r.right < q.left || r.left > q.right || r.bottom < q.top || r.top > q.bottom);
  });
  ok(overlap === false, 'nastro e selettore lingua non si sovrappongono');

  // ---------- cambio lingua ----------
  console.log('\n== LINGUA EN ==');
  await page.selectOption('#__langsel', 'en');
  await page.waitForTimeout(150);
  const bodyEn = await page.locator('body').innerText();
  ok(bodyEn.includes('Car configurator'), 'testo tradotto in EN');
  ok(bodyEn.includes('DS200 / DS300 lap counter'), 'card DS200 tradotta in EN');
  ok((await page.locator('#__disc').innerText()).includes('Independent, unofficial'), 'disclaimer EN');
  ok((await page.locator('#ver').innerText()).includes('site v'), 'footer ri-renderizzato in EN');
  await page.selectOption('#__langsel', 'it');

  // ---------- ogni app: carica + link di ritorno ----------
  console.log('\n== APP ==');
  const apps = [
    ['car-config/', 'Slot Car Web Tools'],
    ['remote-config/', 'Slot Car Web Tools'],
    ['dongle-debug/', 'Slot Car Web Tools'],
    ['modes/', 'Slot Car Web Tools'],
    ['ds200/', 'Slot Car Web Tools'],
    ['ds200/flash.html', 'Slot Car Web Tools'],
    ['ninco/', 'Slot Car Web Tools'],
  ];
  for (const [path, back] of apps) {
    const before = errors.length;
    const resp = await page.goto(BASE + '/' + path, { waitUntil: 'networkidle' });
    const txt = await page.locator('body').innerText();
    const okStatus = resp.status() === 200;
    const okBack = txt.includes(back);
    // scarta i fallimenti di rete verso il CDN esterno (bloccato in sandbox)
    const nuovi = errors.slice(before).filter(e => !/Failed to load resource/.test(e));
    ok(okStatus && okBack && nuovi.length === 0,
      `${path.padEnd(18)} status=${resp.status()} back-link=${okBack ? 'sì' : 'NO'} erroriJS=${nuovi.length}`);
  }

  // ---------- nessuna chiave i18n grezza a video, su NESSUNA pagina ----------
  // (l'indice lo controlla gia' sopra; qui becco le app che renderizzano da JS
  // prima che i18n.js abbia costruito il dizionario)
  console.log('\n== I18N NELLE APP ==');
  for (const [path] of apps) {
    await page.goto(BASE + '/' + path, { waitUntil: 'networkidle' });
    const txt = await page.locator('body').innerText();
    // una chiave grezza e' una parola camelCase isolata, senza spazi, tipo "stDisc"
    const raw = (txt.match(/(^|\s)(st[A-Z]\w+|no[A-Z]\w+|hdr[A-Z]\w+|col[A-Z]\w+|btn[A-Z]\w+|title[A-Z]\w+|v[A-Z]\w+)(\s|$)/g) || [])
                  .map(x => x.trim());
    ok(raw.length === 0, `${path.padEnd(18)} nessuna chiave i18n grezza${raw.length ? ' → ' + raw.join(', ') : ''}`);
  }

  // ---------- navigazione: indice -> app -> indietro ----------
  console.log('\n== NAVIGAZIONE ==');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.locator('a.card[href="ds200/"]').click();
  await page.waitForLoadState('networkidle');
  ok(page.url().endsWith('/ds200/'), 'indice -> DS200: ' + page.url());
  await page.locator('a[href="../"]').first().click();
  await page.waitForLoadState('networkidle');
  ok(page.url().replace(/\?.*/, '').endsWith('8099/'), 'DS200 -> indice: ' + page.url());

  // ---------- il parser DS200 è caricato e funziona nel browser ----------
  console.log('\n== PARSER DS200 (nel browser) ==');
  await page.goto(BASE + '/ds200/', { waitUntil: 'networkidle' });
  const parser = await page.evaluate(() => (typeof DS200 === 'object' ? Object.keys(DS200).join(',') : 'ASSENTE'));
  ok(parser !== 'ASSENTE', 'oggetto DS200 esposto: ' + parser);

  // Il baud deve partire a 4800 (DS200) e non farsi ripristinare dal browser.
  const baud = await page.evaluate(() => {
    const s = document.getElementById('baud');
    return { val: s.value, auto: s.getAttribute('autocomplete'),
             opts: [...s.options].map(o => o.value).join(',') };
  });
  ok(baud.val === '4800', 'baud predefinito = 4800 (DS200), letto: ' + baud.val);
  ok(baud.auto === 'off', 'autocomplete=off (il browser non ripristina il valore vecchio)');
  ok(baud.opts.includes('57600'), 'in elenco c\'è anche 57600 (DS300)');

  console.log('\n== ERRORI CONSOLE ==');
  // L'unica risorsa esterna del sito è esp-web-tools (unpkg) su flash.html: in questa
  // sandbox l'egress è bloccato, quindi quel fallimento è atteso e non conta come bug.
  const cdn = errors.filter(e => /Failed to load resource/.test(e));
  const real = errors.filter(e => !/Failed to load resource/.test(e));
  if (cdn.length) console.log(`  ℹ️  ${cdn.length} risorsa esterna non caricata (unpkg/esp-web-tools, egress bloccato qui)`);
  if (real.length) { real.slice(0, 10).forEach(e => console.log('  ⚠️  ' + e)); fail += real.length; }
  else console.log('  ✅ nessun errore JS su tutte le pagine');

  await browser.close();
  console.log(fail ? `\n❌ ${fail} PROBLEMI` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
