#!/usr/bin/env node
/* Controlla che la tavolozza resti UNA SOLA.
 *
 * Perché serve. Prima di `web/ui.css` gli stessi colori stavano scritti a mano
 * dentro il <style> di sette pagine, e avevano già iniziato a divergere: due
 * rossi e QUATTRO gialli, a seconda di chi aveva copiato per ultimo. Il file
 * comune ha rimesso le cose a posto una volta — ma niente impediva di
 * rifarlo domani, perché un `#e0a800` scritto a mano non rompe nessun test,
 * non stampa niente in console e in una pagina sola è perfino invisibile: si
 * nota solo mettendo due pagine vicine, ed è esattamente quello che non fa
 * nessuno. Questo controllo lo trasforma in un errore di CI.
 *
 * Cosa NON è: un divieto di avere uno stile proprio. Ogni app tiene il suo
 * layout; il Cronometro, che è l'app curata, riscrive quasi tutto. Qui si
 * guarda una cosa sola — da dove vengono i COLORI.
 *
 * Uso:  node tools/check-style.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const UI = 'ui.css';
let errori = 0, visti = 0;

/* Un colore letterale: #abc, #aabbcc, rgb(...), hsl(...).
   `rgba(...)` con un colore trasparente sopra uno sfondo è un caso a parte:
   non esiste un token per "giallo al 12%", e scriverlo è legittimo. */
const COLORE = /#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\(/g;

/* Eccezioni generali: se ne aggiungi una, scrivi PERCHÉ. */
const AMMESSI = [
  /^#0b0f17$/i,   // <meta name="theme-color">: la barra del browser non legge le variabili CSS
  /^#fff$/i, /^#ffffff$/i, /^#000$/i, /^#000000$/i,  // bianco e nero puri: non sono scelte di tavolozza
];

/* Due deroghe, e in tutti e due i casi bisogna scrivere il motivo — una lista di
 * eccezioni senza il perché invecchia in silenzio e finisce per coprire proprio
 * i casi che questo controllo doveva prendere.
 *
 *   `colore-esterno: <motivo>`  su una riga → quella riga è esente. Serve per i
 *       colori che non sono NOSTRI: il nastro di GitHub deve restare del colore
 *       di GitHub, in tema chiaro come in tema scuro.
 *   `stile-autonomo: <motivo>`  nelle prime righe di un file → file intero
 *       esente. Serve a chi non PUÒ dipendere da ui.css.
 */
const RIGA_ESENTE = /colore-esterno\s*:\s*\S/;
const FILE_ESENTE = /stile-autonomo\s*:\s*\S/;

function estraiCss(testo, file) {
  /* Il CSS di una pagina sta nei <style>; per un .css è tutto il file. */
  if (file.endsWith('.css')) return [testo];
  const blocchi = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(testo))) blocchi.push(m[1]);
  return blocchi;
}

/* Toglie i commenti: dentro ci sono spiegazioni che CITANO i colori vecchi
   ("il giallo era scritto a mano come #e0a800"), e vietarle sarebbe assurdo. */
const senzaCommenti = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function controlla(rel) {
  const file = path.join(WEB, rel);
  const testo = fs.readFileSync(file, 'utf8');
  if (FILE_ESENTE.test(testo.slice(0, 1200))) {
    console.log(`ℹ️  ${rel}: stile autonomo dichiarato, saltato`);
    return;
  }
  visti++;

  for (const css of estraiCss(testo, rel)) {
    const pulito = senzaCommenti(css);

    /* 1. Nessuno ridefinisce i token fuori da ui.css. Un secondo :root con
          --bg/--fg/--acc dentro è una tavolozza parallela: è così che
          l'installer ESP32 e il DS200 si erano ritrovati col rosso al posto
          del blu e senza tema chiaro. */
    /* Sul testo GREZZO, non su quello ripulito: il motivo della deroga sta in un
       commento, e toglierlo prima significherebbe non vederlo mai. */
    const root = (css.match(/:root\s*\{[^}]*\}[^\n]*/g) || []).filter((b) => !RIGA_ESENTE.test(b));
    for (const blocco of root) {
      const token = (senzaCommenti(blocco).match(/--[a-z0-9-]+\s*:/gi) || [])
        .map((t) => t.replace(/\s*:$/, ''))
        /* `--wrap` è per progetto una scelta di ogni pagina: la larghezza utile
           cambia col contenuto. Non è un colore. */
        .filter((t) => t !== '--wrap');
      if (token.length) {
        console.log(`❌ ${rel}: ridefinisce ${token.join(', ')} in :root — i token stanno in ${UI}`);
        errori++;
      }
    }

    /* 2. Nessun colore scritto a mano: si usano le variabili. Riga per riga,
          così una deroga vale SOLO dove è stata motivata. */
    const righeCss = css.split('\n');
    for (let i = 0; i < righeCss.length; i++) {
      if (RIGA_ESENTE.test(righeCss[i])) continue;
      for (const trovato of senzaCommenti(righeCss[i]).match(COLORE) || []) {
        if (AMMESSI.some((r) => r.test(trovato))) continue;
        console.log(`❌ ${rel}:${i + 1}: colore scritto a mano \`${trovato}\` — usa una var(--…) di ${UI}`);
        errori++;
      }
    }
  }

  /* 3. Chi ha un colore negli attributi style="" sfugge a tutto il resto. */
  for (const m of testo.matchAll(/style="([^"]*)"/g)) {
    for (const trovato of senzaCommenti(m[1]).match(COLORE) || []) {
      if (AMMESSI.some((r) => r.test(trovato))) continue;
      console.log(`❌ ${rel}: colore \`${trovato}\` dentro un attributo style=""`);
      errori++;
    }
  }
}

/* ---- 4. I colori scritti DENTRO il JavaScript ------------------------------
 *
 * `el.style.color = "#111"`, `cssText = "…;color:#8a94a6"`, una stringa HTML con
 * `style="…"` dentro: sfuggivano a tutti i controlli sopra, che guardano solo
 * <style>, i .css e gli attributi style="" scritti nel markup. Ed è proprio lì
 * che erano rimasti gli ultimi due colori a mano del sito, in i18n.js — il
 * grigio del disclaimer e il nero delle opzioni della lingua.
 *
 * Si guardano le STRINGHE del codice (nei .js e negli <script> delle pagine),
 * non i commenti. Una stringa conta se il colore vi compare come valore di una
 * proprietà CSS (`color:#…`) oppure se viene assegnata a uno stile
 * (`.style.x = "#…"`, `cssText = …`, `setProperty(…, "#…")`). Le deroghe sono
 * le stesse, motivate: `colore-esterno:` sulla riga, `stile-autonomo:` in testa
 * al file. */
const IN_CSS = new RegExp('[a-z-]+\\s*:\\s*[^;"\']*?(' + COLORE.source + ')', 'i');
const VERSO_STILE = /(\.style(\.[\w-]+)?|cssText)\s*\+?=\s*$|setProperty\([^()]*,\s*$/;

/* Le stringhe di un sorgente JS, con la riga e il codice che le precede sulla
   stessa riga. Salta commenti ed espressioni regolari (che possono contenere
   apici e farebbero partire una stringa che non c'è). Non è un parser: basta
   che non si perda per strada sul codice di questo sito. */
function stringheJs(src) {
  const out = [];
  let i = 0, riga = 1, inizioRiga = 0, ultimo = '';
  const contaRighe = (a, b) => { for (let k = a; k < b; k++) if (src[k] === '\n') riga++; };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { riga++; i++; inizioRiga = i; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2), fine = j < 0 ? src.length : j + 2;
      contaRighe(i, fine);
      inizioRiga = src.lastIndexOf('\n', fine - 1) + 1;
      i = fine; continue;
    }
    if (c === '/' && (ultimo === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(ultimo) ||
                      /\b(return|typeof|case)\s*$/.test(src.slice(inizioRiga, i)))) {
      let j = i + 1, classe = false;              // espressione regolare
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') classe = true;
        else if (src[j] === ']') classe = false;
        else if (src[j] === '/' && !classe) break;
        j++;
      }
      i = j + 1; ultimo = 'r'; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const r0 = riga, prima = src.slice(inizioRiga, i);
      let j = i + 1, testo = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { testo += src[j + 1] || ''; j += 2; continue; }
        if (src[j] === '\n') { riga++; inizioRiga = j + 1; }
        testo += src[j]; j++;
      }
      out.push({ testo, riga: r0, prima });
      i = j + 1; ultimo = 's'; continue;
    }
    ultimo = c; i++;
  }
  return out;
}

function controllaJs(rel, sorgente, rigaBase) {
  const righe = sorgente.split('\n');
  for (const s of stringheJs(sorgente)) {
    if (RIGA_ESENTE.test(righe[s.riga - 1] || '')) continue;
    const colori = (s.testo.match(COLORE) || []).filter((x) => !AMMESSI.some((r) => r.test(x)));
    if (!colori.length) continue;
    if (!IN_CSS.test(s.testo) && !VERSO_STILE.test(s.prima)) continue;
    console.log(`❌ ${rel}:${rigaBase + s.riga - 1}: colore scritto a mano \`${colori.join(', ')}\` ` +
                `in una stringa CSS del codice — usa una var(--…) di ${UI} o una classe`);
    errori++;
  }
}

function controllaScript(rel) {
  const testo = fs.readFileSync(path.join(WEB, rel), 'utf8');
  if (FILE_ESENTE.test(testo.slice(0, 1200))) return;
  if (rel.endsWith('.js')) { visti++; controllaJs(rel, testo, 1); return; }
  /* Gli <script> dentro le pagine: la riga riportata è quella del file. */
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(testo))) {
    const rigaBase = testo.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length;
    controllaJs(rel, m[1], rigaBase);
  }
}

/* Tutte le pagine e i fogli del sito, tranne ui.css che È la tavolozza. */
const file = [];
for (const voce of fs.readdirSync(WEB, { withFileTypes: true })) {
  if (voce.isFile() && /\.(html|css)$/.test(voce.name) && voce.name !== UI) file.push(voce.name);
  if (!voce.isDirectory()) continue;
  for (const dentro of fs.readdirSync(path.join(WEB, voce.name))) {
    if (/\.(html|css)$/.test(dentro)) file.push(path.join(voce.name, dentro));
  }
}
file.sort().forEach(controlla);

/* Il codice: ogni .js del sito (tranne i test, che girano in Node) e gli
   <script> delle pagine. */
const script = [];
(function cerca(dir) {
  for (const voce of fs.readdirSync(path.join(WEB, dir), { withFileTypes: true })) {
    const rel = dir ? path.join(dir, voce.name) : voce.name;
    if (voce.isDirectory()) { if (voce.name !== 'firmware') cerca(rel); continue; }
    if (/\.js$/.test(voce.name) && !/\.test\.js$/.test(voce.name)) script.push(rel);
    if (/\.html$/.test(voce.name)) script.push(rel);
  }
})('');
script.sort().forEach(controllaScript);

if (errori) {
  console.log(`\n❌ ${errori} colori fuori posto in ${visti} file`);
  process.exit(1);
}
console.log(`✅ una sola tavolozza: ${visti} file controllati, tutti i colori vengono da ${UI}`);
