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
  await page.selectOption('#speed', '30');
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
  await page.selectOption('#speed', '30');
  await page.locator('#connect').click();
  await page.waitForTimeout(150);
  const stateBefore = await page.locator('#stateVal').innerText();
  await page.locator('#start').click();
  await page.waitForTimeout(600);
  const anyLap = await page.evaluate(() =>
    [...document.querySelectorAll('#board tr')].some(tr => +tr.children[2].textContent > 0));
  ok(anyLap, 'in pratica i giri si accumulano');
  ok(stateBefore.length > 0, 'stato iniziale: ' + stateBefore);

  console.log('\n== ERRORI JS ==');
  const real = errors.filter(e => !/Failed to load resource/.test(e));
  if (real.length) { real.slice(0, 8).forEach(e => console.log('  ⚠️  ' + e)); fail += real.length; }
  else console.log('  ✅ nessun errore JS');

  await browser.close();
  console.log(fail ? `\n❌ ${fail} PROBLEMI` : '\n✅ TUTTO OK');
  process.exit(fail ? 1 : 0);
})();
