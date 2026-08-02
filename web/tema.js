/* tema.js — l'interruttore chiaro/scuro, uguale su tutte le pagine.
 *
 * Perché un file a sé e non dentro i18n.js: le app non usano tutte lo stesso
 * motore di traduzione. L'indice e i debugger caricano `web/i18n.js` (3 lingue,
 * che si disegna da sé il selettore); il cronometro e il contagiri DS200 hanno
 * il proprio (5 lingue, con il selettore già scritto nel markup). Un pezzo che
 * deve stare su TUTTE le pagine non può vivere dentro uno dei due.
 *
 * Tre stati, non due: **auto** (segue il sistema operativo, ed è il
 * predefinito), **chiaro**, **scuro**. Un interruttore a due posizioni avrebbe
 * costretto a scegliere per forza, buttando via `prefers-color-scheme` — che
 * per la maggior parte della gente è già la risposta giusta e non va toccata.
 *
 * I colori li applica `ui.css`, che ha già le regole per `:root[data-theme=…]`:
 * qui si scrive solo l'attributo. La scelta resta su questo dispositivo.
 */
(function () {
  "use strict";

  var CHIAVE = "slotcar.tema";
  var GIRO = ["auto", "light", "dark"];
  var ICONA = { auto: "🌗", light: "☀️", dark: "🌙" };
  var NOME = {
    it: { auto: "Tema: automatico", light: "Tema: chiaro", dark: "Tema: scuro" },
    en: { auto: "Theme: automatic", light: "Theme: light", dark: "Theme: dark" },
    es: { auto: "Tema: automático", light: "Tema: claro", dark: "Tema: oscuro" },
    fr: { auto: "Thème : automatique", light: "Thème : clair", dark: "Thème : sombre" },
    de: { auto: "Thema: automatisch", light: "Thema: hell", dark: "Thema: dunkel" }
  };

  function lingua() {
    var l = (document.documentElement.lang || "it").slice(0, 2).toLowerCase();
    return NOME[l] ? l : "en";
  }
  function leggi() {
    try { var v = localStorage.getItem(CHIAVE); return GIRO.indexOf(v) >= 0 ? v : "auto"; }
    catch (e) { return "auto"; }
  }
  function scrivi(v) { try { localStorage.setItem(CHIAVE, v); } catch (e) {} }

  /* In «auto» l'attributo si TOGLIE, non si mette a "auto": così tornano a
     valere `@media (prefers-color-scheme)` e il valore predefinito di :root. */
  function applica(v) {
    if (v === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", v);
  }

  var tema = leggi();
  applica(tema);                       // subito, prima di disegnare: niente lampo

  function bottone() {
    var b = document.createElement("button");
    b.type = "button";
    b.id = "__temabtn";
    b.className = "themebtn";
    function mostra() {
      b.textContent = ICONA[tema];
      var etichetta = NOME[lingua()][tema];
      b.title = etichetta;
      b.setAttribute("aria-label", etichetta);
    }
    b.addEventListener("click", function () {
      tema = GIRO[(GIRO.indexOf(tema) + 1) % GIRO.length];
      scrivi(tema); applica(tema); mostra();
    });
    mostra();
    /* Cambiando lingua cambia anche la descrizione del pulsante: i due motori
       di traduzione avvisano in modi diversi, quindi si ascoltano entrambi. */
    document.addEventListener("i18n:changed", mostra);
    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "lang") setTimeout(mostra, 0);
    });
    return b;
  }

  function piazza() {
    if (document.getElementById("__temabtn")) return;
    /* Accanto al selettore della lingua, che sta in alto a sinistra su tutte le
       pagine: `#__langsel` se lo ha disegnato i18n.js, `#lang` se è nel markup
       (cronometro, contagiri DS200). Se una pagina non ha nessuno dei due —
       oggi nessuna — il pulsante va comunque in cima, non sparisce. */
    var b = bottone();
    var sel = document.getElementById("__langsel") || document.getElementById("lang");
    if (sel) {
      /* Il selettore del DS200 sta dentro una <label>: attaccarsi al selettore
         lo infilerebbe dentro l'etichetta, e cliccare il pulsante aprirebbe la
         tendina della lingua. Ci si aggancia al contenitore. */
      var ancora = sel.closest("label") || sel;
      ancora.insertAdjacentElement("afterend", b);
      return;
    }
    /* Nessun selettore: e' il caso dell'installer ESP32, che e' solo in italiano
       (punto aperto). Il pulsante va comunque dove va la cornice — dopo il link
       di ritorno — e non in cima alla pagina come un corpo estraneo. */
    var ritorno = document.querySelector("a.back");
    if (ritorno) ritorno.insertAdjacentElement("afterend", b);
    else document.body.insertBefore(b, document.body.firstChild);
  }

  /* i18n.js disegna il suo selettore su DOMContentLoaded: se ci mettessimo lì
     anche noi, l'ordine dipenderebbe da chi è stato caricato prima. Un giro di
     coda in più e il selettore c'è di sicuro. */
  function avvia() { setTimeout(piazza, 0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
  else avvia();

  /* Esposto per i test (e per chi volesse un interruttore suo altrove). */
  window.TEMA = {
    get: function () { return tema; },
    set: function (v) {
      if (GIRO.indexOf(v) < 0) return;
      tema = v; scrivi(v); applica(v);
      var b = document.getElementById("__temabtn");
      if (b) { b.textContent = ICONA[tema]; b.title = NOME[lingua()][tema]; }
    }
  };
})();
