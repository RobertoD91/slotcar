/* i18n.js — lingua selezionabile (IT/EN/ES/FR/DE), autodetect dal browser + disclaimer condiviso.
 *
 * USO nella pagina (PRIMA di caricare questo file):
 *   <script>window.I18N_STRINGS = { chiave:{it:"…",en:"…",es:"…",fr:"…",de:"…"}, … };</script>
 *   <script src="i18n.js"></script>        (dalla root)  oppure  "../i18n.js" (dalle sotto-app)
 *
 * Elementi statici:
 *   data-i18n="chiave"        -> textContent
 *   data-i18n-html="chiave"   -> innerHTML (per testo con <b>, <code>, ecc.)
 *   data-i18n-attr="attr:chiave;attr2:chiave2"  -> attributi (placeholder/title/aria-label…)
 *   <title data-i18n="chiave"> -> testo della chiave + " — Slot Car Web Tools"
 *                               (si usa la chiave dell'h1: il titolo è l'h1 più il sito)
 * Stringhe dinamiche da JS:  I18N.t("chiave")   (usa la lingua corrente)
 * Cambio lingua -> evento "i18n:changed" sul document (le pagine ri-renderizzano il dinamico).
 *
 * i18n.js crea da solo: il SELETTORE lingua (in alto a sinistra) e il DISCLAIMER (in fondo,
 * dentro il <footer> della pagina se c'è, prima della versione).
 */
(function () {
  /* Le stesse cinque lingue del cronometro e del DS200, nello stesso ordine:
     la lingua scelta è una sola per tutto il sito (chiave `lang`), e una pagina
     che non la conosce ricadrebbe sull'inglese. */
  var LANGS = ["it", "en", "es", "fr", "de"];
  var NAMES = { it: "Italiano", en: "English", es: "Español", fr: "Français", de: "Deutsch" };
  /* ⚠️ Le bandierine sono coppie di "indicatori regionali": su Windows non
     esistono nel font di sistema e si vedono le due lettere (IT, EN, ES, FR, DE). Non è
     un difetto da correggere — sono comunque leggibili, ed è il motivo per cui
     accanto resta scritto il NOME della lingua. */
  var FLAGS = { it: "🇮🇹", en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪" };

  // Stringhe CONDIVISE da tutte le app (tradotte una volta sola).
  var SHARED = {
    disclaimer: {
      it: "<b>Progetto indipendente e non ufficiale.</b> Questa applicazione <b>non è realizzata, approvata, " +
        "sponsorizzata né supportata da Slot.it / Galileo Engineering, DS Electronic o Ninco</b>. «Slot.it», «oXigen», " +
        "«DS Electronic», «DS200», «DS300» e «Ninco» sono marchi dei " +
        "rispettivi proprietari, citati solo a scopo di interoperabilità e descrizione. Il software è fornito " +
        "«così com'è», <b>senza alcuna garanzia</b> di alcun tipo, esplicita o implicita. L'autore <b>non si assume " +
        "alcuna responsabilità</b> per eventuali danni a dispositivi, dati o cose derivanti dall'uso. Usala " +
        "esclusivamente su hardware di tua proprietà e <b>a tuo rischio</b>.",
      en: "<b>Independent, unofficial project.</b> This application is <b>not made, endorsed, sponsored, or " +
        "supported by Slot.it / Galileo Engineering, DS Electronic or Ninco</b>. \"Slot.it\", \"oXigen\", \"DS Electronic\", " +
        "\"DS200\", \"DS300\" and \"Ninco\" are trademarks of their " +
        "respective owners, mentioned only for interoperability and descriptive purposes. The software is provided " +
        "\"as is\", <b>without warranty</b> of any kind, express or implied. The author <b>accepts no liability</b> " +
        "for any damage to devices, data, or property arising from its use. Use it only on hardware you own, " +
        "<b>at your own risk</b>.",
      es: "<b>Proyecto independiente y no oficial.</b> Esta aplicación <b>no está desarrollada, avalada, " +
        "patrocinada ni respaldada por Slot.it / Galileo Engineering, DS Electronic o Ninco</b>. «Slot.it», «oXigen», " +
        "«DS Electronic», «DS200», «DS300» y «Ninco» son marcas de sus " +
        "respectivos propietarios, citadas únicamente con fines de interoperabilidad y descripción. El software se " +
        "proporciona «tal cual», <b>sin garantía</b> de ningún tipo, expresa o implícita. El autor <b>no asume " +
        "ninguna responsabilidad</b> por daños a dispositivos, datos o bienes derivados de su uso. Úsala únicamente " +
        "en hardware de tu propiedad y <b>bajo tu propia responsabilidad</b>.",
      fr: "<b>Projet indépendant et non officiel.</b> Cette application <b>n'est ni réalisée, ni approuvée, " +
        "ni sponsorisée, ni soutenue par Slot.it / Galileo Engineering, DS Electronic ou Ninco</b>. « Slot.it », " +
        "« oXigen », « DS Electronic », « DS200 », « DS300 » et « Ninco » sont des marques de leurs propriétaires " +
        "respectifs, citées uniquement à des fins d'interopérabilité et de description. Le logiciel est fourni " +
        "« tel quel », <b>sans aucune garantie</b> d'aucune sorte, expresse ou implicite. L'auteur <b>décline toute " +
        "responsabilité</b> pour les dommages aux appareils, aux données ou aux biens découlant de son utilisation. " +
        "Utilise-la uniquement sur du matériel qui t'appartient et <b>à tes propres risques</b>.",
      de: "<b>Unabhängiges, inoffizielles Projekt.</b> Diese Anwendung wird <b>weder von Slot.it / Galileo " +
        "Engineering noch von DS Electronic oder Ninco erstellt, gebilligt, gesponsert oder unterstützt</b>. " +
        "„Slot.it“, „oXigen“, „DS Electronic“, „DS200“, „DS300“ und „Ninco“ sind Marken ihrer jeweiligen Inhaber " +
        "und werden nur zur Beschreibung und für die Interoperabilität genannt. Die Software wird „wie besehen“ " +
        "bereitgestellt, <b>ohne jede Gewährleistung</b>, weder ausdrücklich noch stillschweigend. Der Autor " +
        "<b>übernimmt keine Haftung</b> für Schäden an Geräten, Daten oder Sachen, die aus der Nutzung entstehen. " +
        "Nutze sie nur mit eigener Hardware und <b>auf eigenes Risiko</b>."
    },
    langLabel: { it: "Lingua", en: "Language", es: "Idioma", fr: "Langue", de: "Sprache" },
    // Le app oXigen al momento non funzionano sull'hardware: meglio dirlo in cima
    // invece di lasciare che l'utente lo scopra provando.
    oxigenPartial: {
      it: "🔬 <b>Questa app funziona solo in parte.</b> Lettura e cambio ID sono confermati su " +
        "hardware vero; la <b>scrittura del MAC</b> è stata corretta e va riprovata. " +
        "Trattala come <b>strumento di diagnostica</b>, non come cosa da usare in pista.",
      en: "🔬 <b>This app only partly works.</b> Reading and changing the ID are confirmed on real " +
        "hardware; <b>writing the MAC</b> has been fixed and needs retesting. " +
        "Treat it as a <b>diagnostic tool</b>, not as something to use at the track.",
      es: "🔬 <b>Esta app funciona solo en parte.</b> La lectura y el cambio de ID están confirmados en " +
        "hardware real; la <b>escritura del MAC</b> se ha corregido y hay que volver a probarla. " +
        "Trátala como <b>herramienta de diagnóstico</b>, no como algo para usar en pista.",
      fr: "🔬 <b>Cette app ne fonctionne qu'en partie.</b> La lecture et le changement d'ID sont confirmés sur " +
        "du vrai matériel ; l'<b>écriture du MAC</b> a été corrigée et doit être réessayée. " +
        "Considère-la comme un <b>outil de diagnostic</b>, pas comme quelque chose à utiliser sur la piste.",
      de: "🔬 <b>Diese App funktioniert nur teilweise.</b> Lesen und Ändern der ID sind auf echter Hardware " +
        "bestätigt; das <b>Schreiben der MAC</b> wurde korrigiert und muss erneut getestet werden. " +
        "Betrachte sie als <b>Diagnosewerkzeug</b>, nicht als etwas für den Einsatz an der Bahn."
    },
    // Per le app oXigen rifatte sulla specifica del protocollo ma non ancora
    // provate su un dispositivo vero: è la targhetta gialla "mai provata".
    oxigenUntested: {
      it: "🧪 <b>Rifatta sulla specifica del protocollo, mai provata su hardware vero.</b> " +
        "I frame sono quelli giusti sulla carta: se qualcosa non va, il registro in fondo alla " +
        "pagina mostra cosa è partito e cosa è tornato.",
      en: "🧪 <b>Rebuilt on the protocol specification, never tried on real hardware.</b> " +
        "The frames are right on paper: if something goes wrong, the log at the bottom of the " +
        "page shows what was sent and what came back.",
      es: "🧪 <b>Rehecha según la especificación del protocolo, nunca probada en hardware real.</b> " +
        "Las tramas son correctas sobre el papel: si algo falla, el registro al final de la " +
        "página muestra qué se envió y qué volvió.",
      fr: "🧪 <b>Refaite d'après la spécification du protocole, jamais essayée sur du vrai matériel.</b> " +
        "Les trames sont correctes sur le papier : si quelque chose ne va pas, le journal en bas de la " +
        "page montre ce qui est parti et ce qui est revenu.",
      de: "🧪 <b>Nach der Protokollspezifikation neu geschrieben, nie auf echter Hardware getestet.</b> " +
        "Auf dem Papier stimmen die Frames: Wenn etwas nicht klappt, zeigt das Protokoll unten auf der " +
        "Seite, was gesendet wurde und was zurückkam."
    },

    updateAvail: {
      it: "🔄 Nuova versione disponibile.",
      en: "🔄 A new version is available.",
      es: "🔄 Hay una nueva versión disponible.",
      fr: "🔄 Une nouvelle version est disponible.",
      de: "🔄 Eine neue Version ist verfügbar."
    },
    updateBtn: { it: "Aggiorna", en: "Update", es: "Actualizar", fr: "Mettre à jour", de: "Aktualisieren" },
    /* Fasce di compatibilità. Cosa funziona davvero (ottobre 2026):
       - Web Bluetooth: Chrome/Edge su computer e Chrome su Android. Mai su iOS
         (Safari non ce l'ha) né su Firefox.
       - Web Serial: Chrome/Edge/Opera su computer. Su Android c'è solo da
         Chrome 148 con Android 17, e le porte USB compaiono soltanto sui
         telefoni configurati per esporle: sulla maggior parte resta vuota.
       - WebUSB: Chrome su computer e su Android. È la strada per il dongle
         oXigen su Android (seriale.js): il dongle è una seriale USB standard
         (CDC) e la pagina la apre da sé. Un cavo con un adattatore seriale
         (FTDI, Prolific, CH340…) invece no: ogni chip ha un protocollo suo. */
    noBt: {
      it: "⚠️ Questo browser <b>non supporta il Web Bluetooth</b>. Usa <b>Chrome</b> o <b>Edge</b> su computer, " +
        "oppure <b>Chrome su Android</b>. Safari/iOS e Firefox non sono supportati.",
      en: "⚠️ This browser <b>does not support Web Bluetooth</b>. Use <b>Chrome</b> or <b>Edge</b> on a computer, " +
        "or <b>Chrome on Android</b>. Safari/iOS and Firefox are not supported.",
      es: "⚠️ Este navegador <b>no admite Web Bluetooth</b>. Usa <b>Chrome</b> o <b>Edge</b> en un ordenador, " +
        "o <b>Chrome en Android</b>. Safari/iOS y Firefox no son compatibles.",
      fr: "⚠️ Ce navigateur <b>ne prend pas en charge le Web Bluetooth</b>. Utilise <b>Chrome</b> ou <b>Edge</b> " +
        "sur ordinateur, ou <b>Chrome sur Android</b>. Safari/iOS et Firefox ne sont pas pris en charge.",
      de: "⚠️ Dieser Browser <b>unterstützt kein Web Bluetooth</b>. Nutze <b>Chrome</b> oder <b>Edge</b> am " +
        "Computer oder <b>Chrome auf Android</b>. Safari/iOS und Firefox werden nicht unterstützt."
    },
    // Il dongle oXigen: Web Serial su computer, WebUSB su Android (seriale.js).
    noDongle: {
      it: "⚠️ Questo browser <b>non può collegarsi al dongle USB</b>. Usa <b>Chrome</b> o <b>Edge</b> su computer, " +
        "oppure <b>Chrome su Android</b> con un cavo USB OTG. Safari/iOS e Firefox non sono supportati.",
      en: "⚠️ This browser <b>cannot connect to the USB dongle</b>. Use <b>Chrome</b> or <b>Edge</b> on a computer, " +
        "or <b>Chrome on Android</b> with a USB OTG cable. Safari/iOS and Firefox are not supported.",
      es: "⚠️ Este navegador <b>no puede conectarse al dongle USB</b>. Usa <b>Chrome</b> o <b>Edge</b> en un " +
        "ordenador, o <b>Chrome en Android</b> con un cable USB OTG. Safari/iOS y Firefox no son compatibles.",
      fr: "⚠️ Ce navigateur <b>ne peut pas se connecter au dongle USB</b>. Utilise <b>Chrome</b> ou <b>Edge</b> " +
        "sur ordinateur, ou <b>Chrome sur Android</b> avec un câble USB OTG. Safari/iOS et Firefox ne sont pas " +
        "pris en charge.",
      de: "⚠️ Dieser Browser <b>kann sich nicht mit dem USB-Dongle verbinden</b>. Nutze <b>Chrome</b> oder " +
        "<b>Edge</b> am Computer oder <b>Chrome auf Android</b> mit einem USB-OTG-Kabel. Safari/iOS und Firefox " +
        "werden nicht unterstützt."
    },
    // Un cavo seriale (adattatore USB-seriale): solo Web Serial.
    noSerial: {
      it: "⚠️ Questo browser <b>non supporta il Web Serial</b>. Usa <b>Chrome</b> o <b>Edge</b> su computer. " +
        "Su <b>Android</b> serve Chrome 148 o successivo con Android 17, e il cavo compare solo sui telefoni " +
        "che espongono le porte seriali. Safari/iOS e Firefox non sono supportati.",
      en: "⚠️ This browser <b>does not support Web Serial</b>. Use <b>Chrome</b> or <b>Edge</b> on a computer. " +
        "On <b>Android</b> you need Chrome 148 or later with Android 17, and the cable only shows up on phones " +
        "that expose serial ports. Safari/iOS and Firefox are not supported.",
      es: "⚠️ Este navegador <b>no admite Web Serial</b>. Usa <b>Chrome</b> o <b>Edge</b> en un ordenador. " +
        "En <b>Android</b> hace falta Chrome 148 o posterior con Android 17, y el cable solo aparece en los " +
        "teléfonos que exponen los puertos serie. Safari/iOS y Firefox no son compatibles.",
      fr: "⚠️ Ce navigateur <b>ne prend pas en charge le Web Serial</b>. Utilise <b>Chrome</b> ou <b>Edge</b> sur " +
        "ordinateur. Sur <b>Android</b>, il faut Chrome 148 ou plus récent avec Android 17, et le câble " +
        "n'apparaît que sur les téléphones qui exposent les ports série. Safari/iOS et Firefox ne sont pas " +
        "pris en charge.",
      de: "⚠️ Dieser Browser <b>unterstützt kein Web Serial</b>. Nutze <b>Chrome</b> oder <b>Edge</b> am Computer. " +
        "Auf <b>Android</b> braucht es Chrome 148 oder neuer mit Android 17, und das Kabel erscheint nur auf " +
        "Telefonen, die serielle Ports freigeben. Safari/iOS und Firefox werden nicht unterstützt."
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

  /* t("chiave") oppure t("chiave", {id: "…"}), che sostituisce i {segnaposto}.
     Senza sostituzione l'unica alternativa era spezzare la frase in pezzi e
     concatenarli in JS — e una frase spezzata non si traduce, perché l'ordine
     delle parole cambia da lingua a lingua. */
  function t(key, params) {
    var e = DICT[key];
    if (!e) return key;
    var s = e[lang] || e.en || e.it || key;
    if (params) s = s.replace(/\{(\w+)\}/g, function (m, k) {
      return params[k] != null ? params[k] : m;
    });
    return s;
  }

  /* Il <title> di ogni pagina è il suo h1 più il nome del sito. Con
     <title data-i18n="chiave"> si scrive una volta sola la chiave dell'h1 e il
     suffisso lo aggiunge questo file: prima la guida aveva una chiave `title`
     a parte, e traducendo perdeva « — Slot Car Web Tools». */
  var SITO = " — Slot Car Web Tools";

  function apply() {
    var i, els;
    els = document.querySelectorAll("[data-i18n]");
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n"));
    var titolo = document.querySelector("title[data-i18n]");
    if (titolo) titolo.textContent = t(titolo.getAttribute("data-i18n")) + SITO;
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
    /* Selettore lingua: NEL FLUSSO della pagina, in alto a sinistra.
       Prima era un riquadro `position:fixed` in un angolo, e un riquadro
       flottante deve schivare qualunque cosa gli capiti vicino: sull'indice
       c'era il nastro "Fork me on GitHub", per cui serviva un'eccezione che
       lo spostava di lato — ed era proprio l'eccezione a farlo cambiare
       posizione fra una pagina e l'altra. Nel flusso non deve schivare
       niente, scorre col contenuto e non ci va sopra.
       Dove: subito dopo il link di ritorno se c'è (le app), in cima al corpo
       se non c'è (l'indice, che è già la pagina di partenza). */
    var bar = document.createElement("div");
    var sel = document.createElement("select");
    sel.id = "__langsel";
    /* L'aspetto sta in ui.css (`.langsel`), uguale a quello del cronometro e del
       DS200 che il selettore ce l'hanno nel markup. Prima era scritto qui, con
       un fondo trasparente: la tendina delle opzioni la disegna il browser su
       fondo bianco, quindi in tema scuro il testo chiaro non si leggeva e ogni
       opzione si portava dietro un `color:#111` a mano. Con un fondo pieno dal
       tema (e `color-scheme` in ui.css) le opzioni seguono il tema da sole. */
    sel.className = "langsel";
    sel.title = t("langLabel");
    sel.setAttribute("aria-label", t("langLabel"));
    for (var i = 0; i < LANGS.length; i++) {
      var o = document.createElement("option");
      o.value = LANGS[i];
      o.textContent = FLAGS[LANGS[i]] + " " + NAMES[LANGS[i]];
      sel.appendChild(o);
    }
    sel.value = lang;
    sel.onchange = function () { setLang(sel.value); };
    bar.appendChild(sel);

    var ritorno = document.querySelector("a.back");
    if (ritorno && ritorno.parentElement) {
      bar.style.cssText = "display:inline-block;margin-left:10px;vertical-align:middle";
      ritorno.insertAdjacentElement("afterend", bar);
    } else {
      bar.style.cssText = "margin:0 0 12px";
      document.body.insertBefore(bar, document.body.firstChild);
    }

    /* Disclaimer (in fondo alla pagina). Stile in ui.css (`.discbox`): largo
       quanto la colonna della pagina, con i colori del tema. Prima aveva un
       grigio scritto a mano e un max-width suo, più stretto della colonna. */
    var wrap = document.createElement("div");
    wrap.id = "__discwrap";
    wrap.className = "discbox";
    var p = document.createElement("div");
    p.id = "__disc";
    p.innerHTML = t("disclaimer");
    wrap.appendChild(p);
    /* Dentro il piè di pagina, se la pagina ce l'ha, e PRIMA della versione:
       così su tutte le pagine il fondo è lo stesso — disclaimer, poi versione —
       come nel cronometro e nel DS200, che il piè lo scrivono da sé. */
    var piede = document.querySelector("body > footer");
    if (piede) piede.insertBefore(wrap, piede.querySelector(".ver"));
    else document.body.appendChild(wrap);
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
