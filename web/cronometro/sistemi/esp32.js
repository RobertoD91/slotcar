/* sistemi/esp32.js — la centralina DS200/DS300 senza fili, tramite il ponte ESP32.
 *
 * ⭐ Non è un protocollo nuovo. Il firmware in `esp32/` legge la seriale, decodifica
 * il frame con LO STESSO parser (`esp32/src/ds200.h`, gemello di quello JS) e lo
 * pubblica su WebSocket in JSON — ma dentro quel JSON c'è anche il frame GREZZO,
 * `raw`. Quindi qui si prende quello e lo si dà in pasto a `DS200.parseFrame`,
 * esattamente come fa il sistema via cavo.
 *
 * È il motivo per cui questo file è corto: eredita da `Ds200Sistema` e sostituisce
 * SOLO il trasporto. Se avessimo consumato il JSON campo per campo avremmo creato
 * un secondo formato da tenere allineato al parser — cioè il problema che questa
 * repo passa il tempo a togliersi di torno.
 *
 * L'indirizzo predefinito è la STESSA ORIGINE della pagina: quando è l'ESP32 a
 * servire il cronometro (`http://ds200.local/cronometro/`) non c'è niente da
 * configurare, e non c'è nemmeno il problema del contenuto misto — una pagina
 * `https://` non può aprire un `ws://`, ma una pagina servita dall'ESP32 sì.
 * Chi mette un proxy con un certificato vero davanti può scrivere l'indirizzo
 * `wss://…` nelle opzioni avanzate.
 */
(function (global) {
  "use strict";

  var SISTEMI = global.SISTEMI;
  if (!SISTEMI) throw new Error("esp32.js: serve registry.js caricato prima");
  var BASE = global.SIS_DS200;
  if (!BASE) throw new Error("esp32.js: serve sistemi/ds200.js caricato prima");

  function urlPredefinita() {
    if (typeof location === "undefined" || !location.host) return "ws://ds200.local/ws";
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  }

  function Esp32Sistema(def, opts) {
    BASE.Sistema.call(this, def, opts);
    var v = (opts && opts.values) || {};
    this.url = (v.url && String(v.url).trim()) || urlPredefinita();
    this.ws = null;
    this.voluto = false;
    /* Via cavo scegli DS200 o DS300; qui no: quale centralina c'è dall'altra
       parte lo dirà il primo frame. `null` = «non lo so ancora». */
    this.attesa = null;          // false = disconnessione chiesta da noi, non un guasto
  }
  Esp32Sistema.prototype = Object.create(BASE.Sistema.prototype);
  Esp32Sistema.prototype.constructor = Esp32Sistema;

  Esp32Sistema.prototype.connect = function () {
    var self = this;
    if (!global.DS200) throw new Error("decoder DS200 non caricato");
    this.setStatus(SISTEMI.STATUS.CONNECTING, this.url);
    this.ok = 0; this.tot = 0;
    this.voluto = true;

    return new Promise(function (risolvi, rifiuta) {
      var ws;
      try { ws = new WebSocket(self.url); }
      catch (e) { rifiuta(e); return; }
      self.ws = ws;

      ws.onopen = function () {
        self.setStatus(SISTEMI.STATUS.ON, self.url);
        risolvi();
      };
      ws.onmessage = function (ev) { self._messaggio(ev.data); };
      ws.onerror = function () {
        /* `onerror` non dice mai perché (il browser lo nasconde apposta): l'unica
           cosa onesta da scrivere è l'indirizzo che non ha risposto. */
        if (self.status === SISTEMI.STATUS.CONNECTING) rifiuta(new Error(self.url));
      };
      ws.onclose = function () {
        self.ws = null;
        if (self.voluto) self.setStatus(SISTEMI.STATUS.ERROR, "collegamento caduto");
      };
    });
  };

  /* Il firmware manda due cose sulla stessa presa: lo STATO (quando ti colleghi,
     per non partire dal vuoto) e un oggetto per ogni FRAME. Solo il secondo ha
     `raw`, ed è l'unico che ci interessa: tutto il resto lo ricaviamo da lì. */
  Esp32Sistema.prototype._messaggio = function (testo) {
    var j;
    try { j = JSON.parse(testo); } catch (e) { this.raw("JSON non valido dal ponte"); return; }
    if (!j || typeof j.raw !== "string") return;

    var bytes = global.DS200.parseHexString(j.raw);
    if (bytes.length !== global.DS200.TOTAL_BYTES) {
      this.raw("frame di lunghezza inattesa dal ponte: " + bytes.length + " byte");
      return;
    }
    this._frame(bytes);          // da qui in poi è identico al cavo
  };

  Esp32Sistema.prototype.disconnect = function () {
    this.voluto = false;
    try { if (this.ws) this.ws.close(); } catch (e) {}
    this.ws = null;
    this.setStatus(SISTEMI.STATUS.OFF, this.ok + "/" + this.tot + " frame validi");
    return Promise.resolve();
  };

  var def = {
    id: "esp32",
    labelKey: "sys.esp32",
    descKey: "sys.esp32.desc",
    bus: "net",                  // niente cavo e niente permessi: basta la rete
    optionsHintKey: "sys.esp32.urlHint",
    options: [
      { id: "url", labelKey: "sys.esp32.url", type: "text", dflt: "", advanced: true }
    ],
    /* Le stesse del DS200 — perché è un DS200. Le corsie (2 o 8) le corregge il
       primo frame valido, che porta il modello nel byte 4, esattamente come via
       cavo. `needsUserGesture` è false: non c'è nessuna finestra da aprire. */
    caps: Object.assign({}, BASE.CAPS, { slots: 8, needsUserGesture: false }),
    create: function (opts) { return new Esp32Sistema(def, opts); }
  };

  SISTEMI.register(def);
  global.SIS_ESP32 = { def: def, Sistema: Esp32Sistema, urlPredefinita: urlPredefinita };
})(typeof window !== "undefined" ? window : globalThis);
