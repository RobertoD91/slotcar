/* i18n.js — lingua selezionabile (IT/EN/ES), autodetect dal browser + disclaimer condiviso.
 *
 * USO nella pagina (PRIMA di caricare questo file):
 *   <script>window.I18N_STRINGS = { chiave:{it:"…",en:"…",es:"…"}, … };</script>
 *   <script src="i18n.js"></script>        (dalla root)  oppure  "../i18n.js" (dalle sotto-app)
 *
 * Elementi statici:
 *   data-i18n="chiave"        -> textContent
 *   data-i18n-html="chiave"   -> innerHTML (per testo con <b>, <code>, ecc.)
 *   data-i18n-attr="attr:chiave;attr2:chiave2"  -> attributi (placeholder/title/aria-label…)
 * Stringhe dinamiche da JS:  I18N.t("chiave")   (usa la lingua corrente)
 * Cambio lingua -> evento "i18n:changed" sul document (le pagine ri-renderizzano il dinamico).
 *
 * i18n.js crea da solo: il SELETTORE lingua (in alto a destra) e il DISCLAIMER (in fondo).
 */
(function () {
  var LANGS = ["it", "en", "es"];
  var NAMES = { it: "Italiano", en: "English", es: "Español" };

  // Stringhe CONDIVISE da tutte le app (tradotte una volta sola).
  var SHARED = {
    disclaimer: {
      it: "<b>Progetto indipendente e non ufficiale.</b> Questa applicazione <b>non è realizzata, approvata, " +
        "sponsorizzata né supportata da Slot.it / Galileo Engineering né da DS Electronic</b>. «Slot.it», «oXigen», " +
        "«DS Electronic», «DS200» e «DS300» sono marchi dei " +
        "rispettivi proprietari, citati solo a scopo di interoperabilità e descrizione. Il software è fornito " +
        "«così com'è», <b>senza alcuna garanzia</b> di alcun tipo, esplicita o implicita. L'autore <b>non si assume " +
        "alcuna responsabilità</b> per eventuali danni a dispositivi, dati o cose derivanti dall'uso. Usala " +
        "esclusivamente su hardware di tua proprietà e <b>a tuo rischio</b>.",
      en: "<b>Independent, unofficial project.</b> This application is <b>not made, endorsed, sponsored, or " +
        "supported by Slot.it / Galileo Engineering or DS Electronic</b>. \"Slot.it\", \"oXigen\", \"DS Electronic\", " +
        "\"DS200\" and \"DS300\" are trademarks of their " +
        "respective owners, mentioned only for interoperability and descriptive purposes. The software is provided " +
        "\"as is\", <b>without warranty</b> of any kind, express or implied. The author <b>accepts no liability</b> " +
        "for any damage to devices, data, or property arising from its use. Use it only on hardware you own, " +
        "<b>at your own risk</b>.",
      es: "<b>Proyecto independiente y no oficial.</b> Esta aplicación <b>no está desarrollada, avalada, " +
        "patrocinada ni respaldada por Slot.it / Galileo Engineering ni por DS Electronic</b>. «Slot.it», «oXigen», " +
        "«DS Electronic», «DS200» y «DS300» son marcas de sus " +
        "respectivos propietarios, citadas únicamente con fines de interoperabilidad y descripción. El software se " +
        "proporciona «tal cual», <b>sin garantía</b> de ningún tipo, expresa o implícita. El autor <b>no asume " +
        "ninguna responsabilidad</b> por daños a dispositivos, datos o bienes derivados de su uso. Úsala únicamente " +
        "en hardware de tu propiedad y <b>bajo tu propia responsabilidad</b>."
    },
    langLabel: { it: "Lingua", en: "Language", es: "Idioma" },
    updateAvail: {
      it: "🔄 Nuova versione disponibile.",
      en: "🔄 A new version is available.",
      es: "🔄 Hay una nueva versión disponible."
    },
    updateBtn: { it: "Aggiorna", en: "Update", es: "Actualizar" },
    // Banner compatibilità (Web Bluetooth): usato dalle app BLE.
    noBt: {
      it: "⚠️ Questo browser <b>non supporta il Web Bluetooth</b>. Usa <b>Chrome</b> o <b>Edge</b> su computer, " +
        "oppure <b>Chrome su Android</b>. Safari/iOS e Firefox non sono supportati.",
      en: "⚠️ This browser <b>does not support Web Bluetooth</b>. Use <b>Chrome</b> or <b>Edge</b> on a computer, " +
        "or <b>Chrome on Android</b>. Safari/iOS and Firefox are not supported.",
      es: "⚠️ Este navegador <b>no admite Web Bluetooth</b>. Usa <b>Chrome</b> o <b>Edge</b> en un ordenador, " +
        "o <b>Chrome en Android</b>. Safari/iOS y Firefox no son compatibles."
    },
    // Banner compatibilità (Web Serial): usato dall'app dongle.
    noSerial: {
      it: "⚠️ Questo browser <b>non supporta il Web Serial</b>. Usa <b>Chrome</b> o <b>Edge</b> su computer " +
        "(desktop). Android, Safari/iOS e Firefox non sono supportati.",
      en: "⚠️ This browser <b>does not support Web Serial</b>. Use <b>Chrome</b> or <b>Edge</b> on a desktop " +
        "computer. Android, Safari/iOS and Firefox are not supported.",
      es: "⚠️ Este navegador <b>no admite Web Serial</b>. Usa <b>Chrome</b> o <b>Edge</b> en un ordenador " +
        "(escritorio). Android, Safari/iOS y Firefox no son compatibles."
    }
  };

  function detect() {
    try {
      var s = localStorage.getItem("lang");
      if (s && LANGS.indexOf(s) >= 0) return s;
    } catch (e) {}
    var list = navigator.languages || [navigator.language || "en"];
    for (var i = 0; i < list.length; i++) {
      var c = (list[i] || "").slice(0, 2).toLowerCase();
      if (LANGS.indexOf(c) >= 0) return c;
    }
    return "en";
  }

  var lang = detect();
  var DICT = {};

  function merge() {
    DICT = {};
    var k;
    for (k in SHARED) DICT[k] = SHARED[k];
    var p = window.I18N_STRINGS || {};
    for (k in p) DICT[k] = p[k]; // la pagina può sovrascrivere le condivise
  }

  function t(key) {
    var e = DICT[key];
    if (!e) return key;
    return e[lang] || e.en || e.it || key;
  }

  function apply() {
    var i, els;
    els = document.querySelectorAll("[data-i18n]");
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n"));
    els = document.querySelectorAll("[data-i18n-html]");
    for (i = 0; i < els.length; i++) els[i].innerHTML = t(els[i].getAttribute("data-i18n-html"));
    els = document.querySelectorAll("[data-i18n-attr]");
    for (i = 0; i < els.length; i++) {
      var spec = els[i].getAttribute("data-i18n-attr").split(";");
      for (var j = 0; j < spec.length; j++) {
        var pair = spec[j].split(":");
        if (pair.length === 2) els[i].setAttribute(pair[0].trim(), t(pair[1].trim()));
      }
    }
    document.documentElement.lang = lang;
    var sel = document.getElementById("__langsel");
    if (sel) sel.value = lang;
    var disc = document.getElementById("__disc");
    if (disc) disc.innerHTML = t("disclaimer");
  }

  function setLang(l) {
    if (LANGS.indexOf(l) < 0) return;
    lang = l;
    try { localStorage.setItem("lang", l); } catch (e) {}
    apply();
    document.dispatchEvent(new Event("i18n:changed"));
  }

  function buildUI() {
    // Selettore lingua (fisso, in alto a destra).
    var bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:8px;right:8px;z-index:9999;font:13px -apple-system,Segoe UI,Roboto,sans-serif";
    var sel = document.createElement("select");
    sel.id = "__langsel";
    sel.title = t("langLabel");
    sel.setAttribute("aria-label", t("langLabel"));
    sel.style.cssText =
      "background:rgba(127,127,127,.14);color:inherit;border:1px solid rgba(127,127,127,.4);" +
      "border-radius:8px;padding:4px 8px;cursor:pointer;-webkit-appearance:menulist";
    for (var i = 0; i < LANGS.length; i++) {
      var o = document.createElement("option");
      o.value = LANGS[i];
      o.textContent = NAMES[LANGS[i]];
      o.style.color = "#111";
      sel.appendChild(o);
    }
    sel.value = lang;
    sel.onchange = function () { setLang(sel.value); };
    bar.appendChild(sel);
    document.body.appendChild(bar);

    // Disclaimer (in fondo alla pagina).
    var wrap = document.createElement("div");
    wrap.id = "__discwrap";
    wrap.style.cssText =
      "max-width:820px;margin:26px auto 8px;padding:12px 14px;border:1px solid rgba(127,127,127,.30);" +
      "border-radius:10px;font:12px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;" +
      "color:#8a94a6;background:rgba(127,127,127,.06)";
    var p = document.createElement("div");
    p.id = "__disc";
    p.innerHTML = t("disclaimer");
    wrap.appendChild(p);
    document.body.appendChild(wrap);
  }

  function init() { merge(); buildUI(); apply(); }

  window.I18N = {
    t: t,
    setLang: setLang,
    apply: apply,
    LANGS: LANGS,
    get lang() { return lang; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
