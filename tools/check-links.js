#!/usr/bin/env node
/* Controllo statico dei link interni del sito: nessuna dipendenza, gira in un secondo.
 *
 * Verifica che ogni href/src/link relativo dentro web/ punti a un file che esiste
 * davvero, e che nessuno usi un percorso ASSOLUTO (il sito sta in un sottopercorso,
 * /qualcosa si romperebbe su GitHub Pages).
 *
 * Uso:  node tools/check-links.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
let errors = 0;
let checked = 0;

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

for (const file of htmlFiles(WEB)) {
  const rel = path.relative(WEB, file);
  const src = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);

  // href="..." / src="..." — solo attributi veri, non testo dentro le stringhe i18n
  const re = /(?:href|src)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const url = m[1].trim();

    // esterni / non-navigazionali: fuori scope
    if (/^(https?:|mailto:|tel:|data:|blob:|javascript:|#)/i.test(url)) continue;

    if (url.startsWith('/')) {
      console.log(`❌ ${rel}: percorso ASSOLUTO "${url}" (il sito sta in un sottopercorso)`);
      errors++;
      continue;
    }

    const clean = url.split('#')[0].split('?')[0];
    if (!clean) continue;

    // le directory devono avere il loro index.html
    const target = path.resolve(dir, clean);
    const okFile = fs.existsSync(target) && fs.statSync(target).isFile();
    const okDir = fs.existsSync(target) && fs.statSync(target).isDirectory() &&
                  fs.existsSync(path.join(target, 'index.html'));

    checked++;
    if (!okFile && !okDir) {
      // il firmware .bin lo produce la CI: assente in locale, non è un errore
      if (/firmware\/.*\.bin$/.test(clean)) continue;
      console.log(`❌ ${rel}: link rotto "${url}"`);
      errors++;
    }
  }
}

// Le card dell'indice devono puntare ad app che esistono.
const index = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const cards = [...index.matchAll(/<a class="card" href="([^"]+)"/g)].map(m => m[1]);
if (cards.length === 0) {
  console.log('❌ index.html: nessuna card cliccabile trovata');
  errors++;
}
for (const c of cards) {
  const t = path.resolve(WEB, c);
  const okay = fs.existsSync(t) &&
    (fs.statSync(t).isFile() || fs.existsSync(path.join(t, 'index.html')));
  if (!okay) { console.log(`❌ index.html: card verso "${c}" che non esiste`); errors++; }
}

console.log(errors
  ? `\n❌ ${errors} problemi (${checked} link controllati, ${cards.length} card)`
  : `✅ link interni a posto: ${checked} controllati, ${cards.length} card dell'indice`);
process.exit(errors ? 1 : 0);
