#!/usr/bin/env node
/* Controlla le traduzioni senza aprire un browser.
 *
 * Perché serve. Lo smoke test vede le chiavi grezze A VIDEO, ma solo nella
 * lingua del browser dei test e solo per quello che è visibile in quel momento:
 * una chiave senza lo spagnolo, un'opzione di un menu scritta in italiano nel
 * markup, un <summary> dimenticato non li vede nessuno finché un utente non
 * cambia lingua. Ed è successo: le modalità del configuratore auto, il «Log»
 * del configuratore controller e l'intestazione «reg» delle tabelle restavano
 * in italiano in tutte e tre le lingue.
 *
 * I motori di traduzione sono tre, con due numeri di lingue diversi:
 *   - web/i18n.js (it/en/es): le stringhe condivise (SHARED) più quelle di ogni
 *     pagina che lo carica (window.I18N_STRINGS);
 *   - web/cronometro/i18n.js e web/ds200-ds300/i18n.js (it/en/es/fr/de): un
 *     dizionario per lingua.
 *
 * Cosa controlla:
 *   1. ogni chiave ha TUTTE le lingue del suo motore, e nessuna in più;
 *   2. ogni chiave usata nel markup (data-i18n, data-i18n-html,
 *      data-i18n-title, data-i18n-attr) esiste;
 *   3. nelle pagine che traducono, nessun <option>, <summary> o <th> con del
 *      testo (lettere, non solo numeri o simboli) senza data-i18n: resterebbe
 *      in italiano in ogni lingua.
 *
 * Eccezioni MOTIVATE, come in check-style.js: `data-i18n-no="<perché>"` su
 * quell'elemento o su un suo antenato (per esempio i nomi delle lingue nel
 * selettore, che si scrivono ciascuno nella sua lingua). Senza il perché
 * l'eccezione non vale.
 *
 * Uso:  node tools/check-i18n.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
let errori = 0, chiavi = 0, pagine = 0;
const err = (m) => { console.log('❌ ' + m); errori++; };
const leggi = (rel) => fs.readFileSync(path.join(WEB, rel), 'utf8');

/* Un oggetto letterale JS dentro un sorgente: lo valuta in una sandbox vuota.
   Sono dizionari di stringhe (anche template literal), niente codice. */
function valuta(sorgente, re, dove) {
  const m = sorgente.match(re);
  if (!m) { err(`${dove}: non trovo il dizionario`); return null; }
  try { return vm.runInNewContext('(' + m[1] + ')', {}); }
  catch (e) { err(`${dove}: dizionario non valutabile (${e.message})`); return null; }
}

/* 1. Le lingue di ogni chiave. */
function controllaLingue(dict, lingue, dove) {
  for (const [k, voce] of Object.entries(dict)) {
    chiavi++;
    if (!voce || typeof voce !== 'object') { err(`${dove}: «${k}» non è una voce {it,en,…}`); continue; }
    const manca = lingue.filter((l) => typeof voce[l] !== 'string' || !voce[l].trim());
    const extra = Object.keys(voce).filter((l) => !lingue.includes(l));
    if (manca.length) err(`${dove}: «${k}» senza ${manca.join(', ')}`);
    if (extra.length) err(`${dove}: «${k}» ha lingue che questo motore non conosce: ${extra.join(', ')}`);
  }
}

/* 2. Le chiavi usate nel markup. */
function chiaviDelMarkup(html) {
  const usate = new Set();
  /* Anche dentro gli <script>, dove l'HTML si costruisce a stringhe: lì però
     una chiave calcolata (`${d.k}`) non si può controllare, e si lascia stare. */
  for (const m of html.matchAll(/data-i18n(?:-html|-title)?="([^"]+)"/g)) usate.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const coppia of m[1].split(';')) {
      const k = (coppia.split(':')[1] || '').trim();
      if (k) usate.add(k);
    }
  }
  return new Set([...usate].filter((k) => /^[\w.-]+$/.test(k)));
}

/* 3. Testo nel markup che nessuno traduce. Un parser minimo: segue l'albero dei
   tag quanto basta per sapere se un antenato ha data-i18n-no, salta <script> e
   <style>, ignora i commenti. */
const VUOTI = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'source', 'track', 'wbr']);
const DA_TRADURRE = new Set(['option', 'summary', 'th']);
function testoNonTradotto(html, dove) {
  const pulito = html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
                     .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (c) => c.replace(/[^\n]/g, ' '));
  const pila = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(pulito))) {
    const chiude = m[1] === '/', tag = m[2].toLowerCase(), attr = m[3];
    if (!chiude) {
      if (VUOTI.has(tag) || /\/\s*$/.test(attr)) continue;
      const motivo = (attr.match(/data-i18n-no="([^"]*)"/) || [])[1];
      if (motivo !== undefined && !motivo.trim()) err(`${dove}: data-i18n-no senza il perché`);
      const esente = (motivo && motivo.trim()) || (pila.length && pila[pila.length - 1].esente);
      pila.push({ tag, attr, inizio: re.lastIndex, esente: !!esente });
      continue;
    }
    /* Chiude fino al tag corrispondente (l'HTML perdona i tag non chiusi). */
    let i = pila.length - 1;
    while (i >= 0 && pila[i].tag !== tag) i--;
    if (i < 0) continue;
    const el = pila[i];
    pila.length = i;
    if (!DA_TRADURRE.has(tag) || el.esente || /data-i18n(-html)?="/.test(el.attr)) continue;
    const testo = pulito.slice(el.inizio, m.index).replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    /* Numeri, simboli e valori esadecimali (0x91): niente da tradurre. */
    if (!/[A-Za-zÀ-ÿ]/.test(testo.replace(/\b0x[0-9a-f]+\b/gi, ''))) continue;
    const riga = pulito.slice(0, el.inizio).split('\n').length;
    err(`${dove}:${riga}: <${tag}>${testo}</${tag}> senza data-i18n (resta così in ogni lingua; ` +
        `se è voluto, data-i18n-no="<perché>")`);
  }
}

/* ---- motore web/i18n.js (it/en/es) --------------------------------------- */
const L3 = ['it', 'en', 'es'];
const SHARED = valuta(leggi('i18n.js'), /var SHARED = (\{[\s\S]*?\n {2}\});/, 'i18n.js');
if (SHARED) controllaLingue(SHARED, L3, 'i18n.js (condivise)');

/* ---- motori a 5 lingue ---------------------------------------------------- */
const MOTORI5 = {};
for (const app of ['cronometro', 'ds200-ds300']) {
  const src = leggi(app + '/i18n.js');
  const lingue = valuta(src, /(?:var|const) LANGS = (\[[^\]]*\]);/, app + '/i18n.js');
  const dict = valuta(src, /(?:var|const) DICT = (\{[\s\S]*?\n {2}\});/, app + '/i18n.js');
  if (!lingue || !dict) continue;
  /* Da «una tabella per lingua» a «una voce per chiave», per controllarle
     allo stesso modo delle altre. */
  const perChiave = {};
  for (const l of Object.keys(dict)) {
    if (!lingue.includes(l)) err(`${app}/i18n.js: dizionario per «${l}», che non è in LANGS`);
    for (const [k, v] of Object.entries(dict[l])) (perChiave[k] = perChiave[k] || {})[l] = v;
  }
  controllaLingue(perChiave, lingue, app + '/i18n.js');
  MOTORI5[app] = perChiave;
}

/* ---- le pagine ------------------------------------------------------------ */
const html = [];
(function cerca(dir) {
  for (const voce of fs.readdirSync(path.join(WEB, dir), { withFileTypes: true })) {
    const rel = dir ? path.join(dir, voce.name) : voce.name;
    if (voce.isDirectory()) { if (voce.name !== 'firmware') cerca(rel); continue; }
    if (voce.name.endsWith('.html')) html.push(rel);
  }
})('');

for (const rel of html.sort()) {
  const testo = leggi(rel);
  const app = rel.split(path.sep)[0];
  let definite;
  if (/<script[^>]+src="(?:\.\.\/)?i18n\.js"/.test(testo) && !MOTORI5[app]) {
    /* Pagina del motore a 3 lingue. */
    const proprie = /window\.I18N_STRINGS\s*=/.test(testo)
      ? valuta(testo, /window\.I18N_STRINGS\s*=\s*(\{[\s\S]*?\n\});/, rel) : {};
    if (!proprie) continue;
    controllaLingue(proprie, L3, rel);
    definite = new Set([...Object.keys(SHARED || {}), ...Object.keys(proprie)]);
  } else if (MOTORI5[app] && /i18n\.js/.test(testo)) {
    definite = new Set(Object.keys(MOTORI5[app]));
  } else {
    continue;                                   // pagina che non traduce (installer, stub)
  }
  pagine++;
  for (const k of chiaviDelMarkup(testo)) {
    if (!definite.has(k)) err(`${rel}: usa la chiave «${k}», che non esiste`);
  }
  testoNonTradotto(testo, rel);
}

if (errori) {
  console.log(`\n❌ ${errori} problemi di traduzione (${chiavi} chiavi, ${pagine} pagine)`);
  process.exit(1);
}
console.log(`✅ traduzioni complete: ${chiavi} chiavi in tutte le lingue del loro motore, ` +
            `${pagine} pagine senza testo non tradotto`);
