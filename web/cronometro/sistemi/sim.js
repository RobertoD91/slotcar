/* sistemi/sim.js — pista finta.
 *
 * Serve a due cose, e vale la pena tenerle a mente perche' guidano il progetto:
 *   1. si prova l'applicazione (gara, classifica, voce, traduzioni) senza avere
 *      una pista sul tavolo;
 *   2. si prova il MOTORE in automatico: `plan()` e' una funzione pura con un
 *      generatore di numeri casuali a seme fisso, quindi la stessa gara esce
 *      identica tutte le volte e si puo' verificare da riga di comando.
 *
 * La riproduzione (`play`) e' l'unica parte che usa i timer del browser.
 */
(function (global) {
  "use strict";

  var SISTEMI = global.SISTEMI || (typeof require === "function" ? require("./registry.js") : null);
  if (!SISTEMI) throw new Error("sim.js: serve registry.js caricato prima");

  /* Generatore a seme fisso (mulberry32): due righe, nessuna dipendenza, e la
     stessa sequenza in Node e nel browser. Non serve che sia crittografico. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var DEFAULTS = {
    seed: 20260728,
    cars: 4,
    baseLapMs: 7200,      // giro tipico di una pista casalinga
    skillSpread: 0.14,    // quanto sono diversi fra loro i guidatori
    lapJitter: 0.05,      // variabilita' giro per giro dello stesso guidatore
    spinChance: 0.035,    // probabilita' di testacoda a giro
    spinMs: 3500,
    fuel: true,
    fuelStart: 99,
    fuelPerLap: 6,
    pitMs: 4000,
    maxLaps: 200,
    maxMs: 30 * 60 * 1000
  };

  /* Costruisce la lista dei guidatori finti: ognuno con il suo passo. */
  function makeCars(cfg, rnd) {
    var out = [], i;
    for (i = 1; i <= cfg.cars; i++) {
      // passo distribuito attorno al giro base: il primo e' il piu' veloce solo
      // per caso, non per costruzione
      var k = 1 + (rnd() - 0.5) * 2 * cfg.skillSpread;
      out.push({ slot: i, lapMs: Math.round(cfg.baseLapMs * k) });
    }
    return out;
  }

  /* Genera l'intera gara come lista di eventi ordinati per istante (ms dal via).
     Pura: stesso seme, stessa gara. */
  function plan(opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var rnd = mulberry32(cfg.seed);
    var cars = cfg.carList || makeCars(cfg, rnd);
    var events = [];

    cars.forEach(function (car) {
      var at = 0, laps = 0, fuel = cfg.fuelStart;
      while (laps < cfg.maxLaps && at < cfg.maxMs) {
        var lap = car.lapMs * (1 + (rnd() - 0.5) * 2 * cfg.lapJitter);
        var spin = rnd() < cfg.spinChance;
        if (spin) lap += cfg.spinMs * (0.5 + rnd());
        var pit = false;
        if (cfg.fuel) {
          fuel -= cfg.fuelPerLap;
          if (fuel <= 0) { pit = true; lap += cfg.pitMs; fuel = cfg.fuelStart; }
        }
        lap = Math.round(lap);
        at += lap;
        if (at > cfg.maxMs) break;
        laps++;
        events.push({
          at: at,
          ev: { type: "lap", slot: car.slot, laps: laps, lapMs: lap }
        });
        if (cfg.fuel) {
          events.push({
            at: at,
            ev: {
              type: "telemetry", slot: car.slot,
              fuel: fuel, reserve: fuel <= 12, pit: pit
            }
          });
        }
      }
    });

    events.sort(function (a, b) { return a.at - b.at || a.ev.slot - b.ev.slot; });
    return { cfg: cfg, cars: cars, events: events };
  }

  /* ---- il sistema vero e proprio ------------------------------------------- */

  function SimSistema(def, opts) {
    SISTEMI.Sistema.call(this, def, opts);
    opts = opts || {};
    var v = opts.values || {};
    this.speed = Number(v.speed) || 1;
    this.settings = Object.assign({}, DEFAULTS, opts.settings, {
      seed: Number(v.seed) || DEFAULTS.seed,
      cars: Math.max(1, Number(opts.cars) || (opts.settings && opts.settings.cars) || DEFAULTS.cars)
    });
    this._plan = null;
    this._i = 0;
    this._t0 = null;
    this._pausedAt = null;
    this._timer = null;
    this.caps = Object.assign({}, this.caps, { slots: this.settings.cars });
  }
  SimSistema.prototype = Object.create(SISTEMI.Sistema.prototype);
  SimSistema.prototype.constructor = SimSistema;

  SimSistema.prototype.connect = function () {
    var self = this;
    this.setStatus(SISTEMI.STATUS.ON, "seed " + this.settings.seed);
    // i posti esistono da subito, cosi' la tabella non e' vuota prima del via
    for (var i = 1; i <= this.settings.cars; i++) self.send({ type: "presence", slot: i, present: true });
    this.raw("simulazione pronta — " + this.settings.cars + " guidatori, seme " + this.settings.seed);
    return Promise.resolve();
  };

  SimSistema.prototype.disconnect = function () {
    this._stopTimer();
    this._plan = null;
    this.setStatus(SISTEMI.STATUS.OFF);
    return Promise.resolve();
  };

  SimSistema.prototype._stopTimer = function () {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  };

  SimSistema.prototype.command = function (cmd) {
    switch (cmd) {
      case "start":
        this._plan = plan(this.settings);
        this._i = 0;
        this._t0 = Date.now();
        this._pausedAt = null;
        this.send({ type: "state", state: "running" });
        this._schedule();
        return true;
      case "pause":
        if (!this._plan || this._pausedAt != null) return false;
        this._stopTimer();
        this._pausedAt = Date.now();
        this.send({ type: "state", state: "paused" });
        return true;
      case "resume":
        if (!this._plan || this._pausedAt == null) return false;
        this._t0 += Date.now() - this._pausedAt;
        this._pausedAt = null;
        this.send({ type: "state", state: "running" });
        this._schedule();
        return true;
      case "stop":
        this._stopTimer();
        this._plan = null;
        this._pausedAt = null;
        return true;
      default:
        return false;
    }
  };

  SimSistema.prototype._schedule = function () {
    var self = this;
    if (!this._plan || this._i >= this._plan.events.length) return;
    var next = this._plan.events[this._i];
    var due = this._t0 + next.at / this.speed;
    var delay = Math.max(0, due - Date.now());
    this._timer = setTimeout(function () {
      self._timer = null;
      if (!self._plan) return;
      /* Con velocita' alte piu' eventi cadono nello stesso istante: li sparo
         tutti quelli scaduti, altrimenti il ritmo si allunga da solo.
         `self._plan` va ricontrollato ad ogni giro e non solo all'ingresso:
         un evento puo' far finire la gara, e chi ascolta reagisce fermando il
         simulatore — cioe' azzerando il piano — mentre siamo ancora qui dentro. */
      var ora = Date.now();
      while (self._plan && self._i < self._plan.events.length &&
             self._t0 + self._plan.events[self._i].at / self.speed <= ora) {
        self.send(self._plan.events[self._i].ev);
        self._i++;
      }
      self._schedule();
    }, delay);
  };

  var def = {
    id: "sim",
    labelKey: "sys.sim",
    descKey: "sys.sim.desc",
    bus: "none",
    optionsHintKey: "sys.sim.seedHint",
    options: [
      { id: "seed", labelKey: "sys.sim.seed", type: "number", dflt: DEFAULTS.seed, min: 1 },
      { id: "speed", labelKey: "sys.sim.speed", type: "select", dflt: 5,
        values: [{ v: 1, label: "1×" }, { v: 2, label: "2×" }, { v: 5, label: "5×" },
                 { v: 10, label: "10×" }, { v: 30, label: "30×" }] }
    ],
    caps: {
      slotLabel: "car",
      slots: DEFAULTS.cars,
      lapTime: true,
      position: false,
      fuel: true,
      pit: true,
      battery: false,
      raceState: true,
      control: true,
      needsUserGesture: false
    },
    create: function (opts) { return new SimSistema(def, opts); }
  };

  SISTEMI.register(def);

  var SIM = { plan: plan, mulberry32: mulberry32, DEFAULTS: DEFAULTS, def: def };
  global.SIM = SIM;
  if (typeof module !== "undefined" && module.exports) module.exports = SIM;
})(typeof window !== "undefined" ? window : globalThis);
