#!/usr/bin/env node
/* Controlla che le versioni dichiarate NEL CODICE combacino con web/version.json.
 *
 * Perché serve un controllo apposta: ogni app scarica `version.json` e, se la
 * versione pubblicata non è quella che sta eseguendo, mostra il banner
 * «Nuova versione disponibile». Basta alzare il numero in un posto solo e il
 * banner resta appeso per sempre — l'utente clicca, ricarica, e lo rivede.
 * È un errore che non si vede leggendo il diff, non rompe nessun test e non fa
 * nemmeno comparire un errore in console: si vede solo aprendo la pagina.
 *
 * Controlla anche il nome della chiave (`const APP="..."`): se punta a una voce
 * che in version.json non c'è, il confronto non avviene proprio e il banner non
 * comparirà mai — il difetto opposto, ancora più silenzioso.
 *
 * Uso:  node tools/check-versions.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const versioni = JSON.parse(fs.readFileSync(path.join(WEB, 'version.json'), 'utf8'));
let errori = 0;
let visti = 0;

/* Ogni file che dichiara una versione, e dove la dichiara. */
const sorgenti = [
  ['car-config/index.html', /const APP="([^"]+)",APP_VERSION="([^"]+)"/],
  ['remote-config/index.html', /const APP="([^"]+)",APP_VERSION="([^"]+)"/],
  ['chron02/index.html', /const APP="([^"]+)",APP_VERSION="([^"]+)"/],
  ['o2-bootloader/index.html', /const APP="([^"]+)",APP_VERSION="([^"]+)"/],
  ['guida-oxigen/index.html', /const APP="([^"]+)",APP_VERSION="([^"]+)"/],
  ['ds200-ds300/app.js', /const APP_VERSION = '([^']+)'/, 'ds200-ds300'],
  ['cronometro/app.js', /var APP_VERSION = "([^"]+)"/, 'cronometro'],
];

for (const [rel, re, chiaveFissa] of sorgenti) {
  const file = path.join(WEB, rel);
  if (!fs.existsSync(file)) { console.log(`❌ ${rel}: non esiste`); errori++; continue; }
  const m = fs.readFileSync(file, 'utf8').match(re);
  if (!m) { console.log(`❌ ${rel}: non trovo la versione dichiarata`); errori++; continue; }

  const chiave = chiaveFissa || m[1];
  const dichiarata = chiaveFissa ? m[1] : m[2];
  visti++;

  if (!(chiave in versioni.apps)) {
    console.log(`❌ ${rel}: dichiara APP="${chiave}", che in version.json non esiste ` +
                `(→ il banner "aggiorna" non comparirà MAI)`);
    errori++;
    continue;
  }
  const pubblicata = versioni.apps[chiave];
  if (pubblicata !== dichiarata) {
    console.log(`❌ ${rel}: nel codice ${dichiarata}, in version.json ${pubblicata} ` +
                `(→ banner "aggiorna" appeso ad ogni caricamento)`);
    errori++;
  }
}

/* E il contrario: voci pubblicate che nessuno dichiara. Non è un errore — una
   pagina statica può non avere versione — ma vale la pena vederle. */
const dichiarate = new Set(sorgenti.map(([rel, re, k]) => {
  const f = path.join(WEB, rel);
  if (!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, 'utf8').match(re);
  return m ? (k || m[1]) : null;
}).filter(Boolean));
const orfane = Object.keys(versioni.apps).filter((k) => !dichiarate.has(k));

/* Il sito: version.json contro la costante dell'indice. */
const indice = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const ms = indice.match(/const SITE_VERSION="([^"]+)"/);
if (!ms) { console.log('❌ index.html: non trovo SITE_VERSION'); errori++; }
else if (ms[1] !== versioni.site) {
  console.log(`❌ index.html: SITE_VERSION ${ms[1]}, version.json ${versioni.site}`);
  errori++;
} else visti++;

if (orfane.length) console.log(`ℹ️  senza versione nel codice (ok se statiche): ${orfane.join(', ')}`);
if (errori) { console.log(`\n❌ ${errori} versioni sfasate`); process.exit(1); }
console.log(`✅ versioni allineate: ${visti} controllate`);
