/* sistemi/registry.js — il contratto fra il cronometro e le piste.
 *
 * Un "sistema" e' il pezzo che parla con una pista e traduce quello che dice in
 * eventi normalizzati, gli stessi per tutti (vedi race.js). Il motore di gara
 * non sa se dall'altra parte c'e' un DS200, una power base Ninco, un dongle
 * oXigen o il simulatore: vede solo eventi.
 *
 * (Il nome scontato per questo ruolo sarebbe "driver", ma qui "guidatore" e'
 * gia' una persona in carne e ossa e si farebbe confusione. Quindi: sistema.)
 *
 * I tre sistemi veri NON sono simmetrici, ed e' il motivo per cui esistono le
 * caps: ognuno dichiara cosa sa fare e l'interfaccia si adatta.
 *
 *              tempo giro   posizione   benzina   pit/batteria   stato gara   comandi
 *   DS200/300     dato       calcolata     no          no         annunciato     no
 *   Ninco       differenza     data        si       pit indiretto   dedotto      no
 *   oXigen      telemetria   calcolata     no          si         deciso da noi  si
 *   simulatore     dato       calcolata     no          no         deciso da noi si
 *
 * Un sistema espone:
 *   id, caps
 *   connect()      Promise — apre la porta / avvia
 *   disconnect()   Promise
 *   command(cmd)   solo se caps.control: 'start' | 'pause' | 'resume' | 'stop'
 *   on/off/emit    'event'  → evento normalizzato per il motore
 *                  'status' → {state, detail} per la barra di stato
 *                  'raw'    → testo grezzo, per il registro
 */
(function (global) {
  "use strict";

  var Emitter = (global.RACE && global.RACE.Emitter) ||
                (typeof require === "function" ? require("../race.js").Emitter : null);
  if (!Emitter) throw new Error("registry.js: serve race.js caricato prima");

  var STATUS = {
    OFF: "off",             // mai connesso / disconnesso
    CONNECTING: "connecting",
    ON: "on",
    ERROR: "error"
  };

  /* Valori di riferimento: un sistema dichiara solo cio' che si discosta. */
  var CAPS_DEFAULT = {
    slotLabel: "car",   // 'lane' (corsia) | 'car' (auto): come si chiama il posto
    slots: 8,           // quanti posti gestisce la pista
    lapTime: false,     // fornisce il tempo sul giro
    position: false,    // fornisce la posizione in classifica
    fuel: false,
    pit: false,
    battery: false,
    raceState: false,   // annuncia partenza/pausa/fine
    control: false,     // accetta comandi di gara
    needsUserGesture: true  // l'apertura della porta va fatta da un click
  };

  /* ---- classe base --------------------------------------------------------- */
  function Sistema(def, opts) {
    Emitter.call(this);
    this.id = def.id;
    this.def = def;
    this.caps = Object.assign({}, CAPS_DEFAULT, def.caps || {});
    this.opts = opts || {};
    this.status = STATUS.OFF;
  }
  Sistema.prototype = Object.create(Emitter.prototype);
  Sistema.prototype.constructor = Sistema;

  Sistema.prototype.setStatus = function (state, detail) {
    this.status = state;
    this.emit("status", { state: state, detail: detail || null });
  };
  /* Alcune cose si sanno solo dopo esserci collegati: il DS200 e il DS300
     parlano lo stesso protocollo ma gestiscono 2 corsie contro 8, e chi dei due
     sia lo dice ogni frame. Quindi le caps possono cambiare a collegamento
     fatto, e l'interfaccia deve accorgersene. */
  Sistema.prototype.setCaps = function (patch) {
    var cambiato = false, k;
    for (k in patch) if (this.caps[k] !== patch[k]) { this.caps[k] = patch[k]; cambiato = true; }
    if (cambiato) this.emit("caps", this.caps);
    return cambiato;
  };
  /* Scorciatoia usata dalle implementazioni per mandare un evento al motore. */
  Sistema.prototype.send = function (ev) { this.emit("event", ev); };
  Sistema.prototype.raw = function (text) { this.emit("raw", text); };

  Sistema.prototype.connect = function () { return Promise.resolve(); };
  Sistema.prototype.disconnect = function () { return Promise.resolve(); };
  Sistema.prototype.command = function () { return false; };

  /* ---- registro ------------------------------------------------------------ */
  var defs = [];
  var byId = Object.create(null);

  /* def = {id, labelKey, descKey, bus, caps, create(opts)->Sistema} */
  function register(def) {
    if (!def || !def.id || typeof def.create !== "function") {
      throw new Error("registry: definizione di sistema incompleta");
    }
    if (byId[def.id]) throw new Error("registry: sistema gia' registrato: " + def.id);
    def.caps = Object.assign({}, CAPS_DEFAULT, def.caps || {});
    byId[def.id] = def;
    defs.push(def);
    return def;
  }

  function list() { return defs.slice(); }
  function get(id) { return byId[id] || null; }

  /* Un sistema e' utilizzabile solo se il browser ha il bus che gli serve.
     Serve a spiegare all'utente PERCHE' una voce e' grigia, invece di lasciarlo
     davanti a un errore quando clicca. */
  function available(def) {
    if (!def) return false;
    if (def.bus === "serial") return typeof navigator !== "undefined" && "serial" in navigator;
    if (def.bus === "bluetooth") return typeof navigator !== "undefined" && "bluetooth" in navigator;
    return true;
  }

  function create(id, opts) {
    var def = get(id);
    if (!def) throw new Error("registry: sistema sconosciuto: " + id);
    return def.create(opts || {});
  }

  /* Chi comanda la gara. Se il sistema accetta comandi, comanda l'applicazione
     e lui esegue (simulatore, oXigen). Se non li accetta ma annuncia lo stato,
     comanda lui e noi registriamo (DS200/DS300). Se non fa ne' l'uno ne'
     l'altro, comanda l'applicazione perche' non c'e' nessun altro (Ninco). */
  function authority(caps) {
    if (!caps) return "app";
    if (caps.control) return "app";
    return caps.raceState ? "sistema" : "app";
  }

  var SISTEMI = {
    Sistema: Sistema,
    STATUS: STATUS,
    CAPS_DEFAULT: CAPS_DEFAULT,
    register: register, list: list, get: get, create: create,
    available: available, authority: authority
  };

  global.SISTEMI = SISTEMI;
  if (typeof module !== "undefined" && module.exports) module.exports = SISTEMI;
})(typeof window !== "undefined" ? window : globalThis);
