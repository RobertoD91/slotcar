/* race.js — motore di gara del "Cronometro web".
 *
 * Non tocca il DOM, non apre porte, non usa timer di sistema: prende eventi
 * gia' normalizzati (li produce un "sistema", vedi sistemi/registry.js) oppure
 * comandi dall'interfaccia, e tiene lo stato della gara. Cosi' si prova da riga
 * di comando (race.test.js) senza browser e senza pista.
 *
 * Vocabolario del progetto — vale in tutto il codice:
 *   guidatore  chi guida. Ha un nome modificabile ed e' legato a un posto.
 *   posto      la corsia (DS200/DS300) o il numero dell'auto (Ninco, oXigen).
 *              Nel codice si chiama `slot` perche' e' l'unico termine neutro
 *              fra i due; a video diventa "Corsia N" o "Auto N" a seconda del
 *              sistema collegato (lo dichiara lui, in caps.slotLabel).
 *   sistema    il pezzo che parla con la pista e produce gli eventi.
 *
 * Modalita' (per ora due):
 *   pratica    nessun traguardo, non finisce mai da sola, parte al primo
 *              passaggio. Serve per girare e guardare i tempi.
 *   gp         gara a numero di giri: vince chi arriva per primo a targetLaps.
 *
 * Il motore accetta lo stato gara da DUE parti, e le tratta allo stesso modo:
 *   - dall'interfaccia (command), per i sistemi che non dicono niente (Ninco)
 *     o che si comandano davvero (oXigen);
 *   - dal sistema (feed di un evento 'state'), per chi lo annuncia (DS200).
 */
(function (global) {
  "use strict";

  var STATE = {
    IDLE: "idle",           // niente in corso
    COUNTDOWN: "countdown", // semaforo / fasi di partenza annunciate dal sistema
    RUNNING: "running",
    PAUSED: "paused",
    FINISHED: "finished",   // conclusa regolarmente
    ABORTED: "aborted"      // interrotta
  };

  var MODES = {
    pratica: { autoStart: true, target: null },
    gp: { autoStart: false, target: "laps" }
  };

  /* Due passaggi piu' ravvicinati di questo, per lo stesso posto, sono un
     doppione: nessuna slot car gira in mezzo secondo. Serve solo quando il
     sistema NON ci dice il numero di giri (se ce lo dice, si va di numero). */
  var MIN_LAP_MS = 500;

  /* ---- emettitore di eventi minimo (lo riusa anche il registro dei sistemi) -- */
  function Emitter() { this._h = Object.create(null); }
  Emitter.prototype.on = function (name, fn) {
    (this._h[name] || (this._h[name] = [])).push(fn);
    return this;
  };
  Emitter.prototype.off = function (name, fn) {
    var a = this._h[name];
    if (a) { var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    return this;
  };
  Emitter.prototype.emit = function (name, data) {
    var a = this._h[name], i;
    if (a) for (i = 0; i < a.length; i++) a[i](data);
    var b = this._h["*"];
    if (b) for (i = 0; i < b.length; i++) b[i](name, data);
    return this;
  };

  /* ---- guidatore ----------------------------------------------------------- */
  function makeGuidatore(slot, name) {
    return {
      slot: slot,
      name: name != null ? name : null,   // null = l'interfaccia mostra "Posto N"
      laps: 0,
      lastLapMs: null,
      bestLapMs: null,
      totalMs: null,          // tempo totale dichiarato dal sistema, se ce l'ha
      raceMs: 0,              // somma dei giri completati, calcolata da noi
      lastCrossAt: null,      // istante dell'ultimo passaggio (clock del motore)
      reportedPosition: null, // posizione dichiarata dal sistema (Ninco la da')
      fuel: null,
      reserve: false,
      pit: false,
      battery: false,
      present: false,         // ha dato segno di vita almeno una volta
      finished: false,
      finishedAt: null,
      finishPos: null
    };
  }

  /* ---- gara ---------------------------------------------------------------- */
  function Race(opts) {
    Emitter.call(this);
    opts = opts || {};
    this.now = opts.now || function () { return Date.now(); };
    this.minLapMs = opts.minLapMs != null ? opts.minLapMs : MIN_LAP_MS;
    this.mode = MODES[opts.mode] ? opts.mode : "pratica";
    this.targetLaps = opts.targetLaps != null ? opts.targetLaps : 20;
    /* In GP la gara finisce quando il primo taglia il traguardo. Con finishAll
       resta aperta finche' non arrivano tutti (per ora non usata: la lascio
       perche' e' l'unico punto in cui la regola vive). */
    this.finishAll = !!opts.finishAll;

    /* Chi comanda la gara: 'app' o 'sistema'. Col DS200 comanda la centralina —
       partenza, pausa e bandiera li decide lei — quindi il motore NON deve
       chiudere la gara per conto suo quando vede il traguardo: aspetta che sia
       la centralina a dirlo, altrimenti bastano un giro perso o un conteggio
       sfasato per chiudere una gara che in pista sta ancora andando.
       Lo stesso valore spegne i pulsanti nell'interfaccia. */
    this.authority = opts.authority === "sistema" ? "sistema" : "app";

    this.state = STATE.IDLE;
    this.startedAt = null;
    this.endedAt = null;
    this._pausedAt = null;
    this._pausedMs = 0;
    this._finishCount = 0;
    this._leader = null;

    this.guidatori = [];
    this.bySlot = Object.create(null);
    if (opts.guidatori) this.setGuidatori(opts.guidatori);
  }
  Race.prototype = Object.create(Emitter.prototype);
  Race.prototype.constructor = Race;

  Race.prototype.STATE = STATE;

  /* -- guidatori: creazione, rinomina, rimozione ----------------------------- */

  Race.prototype.guidatore = function (slot, create) {
    var g = this.bySlot[slot];
    if (!g && create !== false) {
      g = makeGuidatore(slot, null);
      this.bySlot[slot] = g;
      this.guidatori.push(g);
      this.guidatori.sort(function (a, b) { return a.slot - b.slot; });
      this.emit("roster", this.guidatori);
    }
    return g || null;
  };

  Race.prototype.setGuidatori = function (list) {
    var self = this;
    this.guidatori = [];
    this.bySlot = Object.create(null);
    (list || []).forEach(function (x) {
      var slot = typeof x === "number" ? x : x.slot;
      if (slot == null) return;
      var g = makeGuidatore(slot, typeof x === "object" ? x.name : null);
      if (typeof x === "object" && x.color) g.color = x.color;
      self.bySlot[slot] = g;
      self.guidatori.push(g);
    });
    this.guidatori.sort(function (a, b) { return a.slot - b.slot; });
    this.emit("roster", this.guidatori);
    this.emit("change", this);
    return this;
  };

  Race.prototype.rename = function (slot, name) {
    var g = this.guidatore(slot);
    g.name = name && String(name).trim() ? String(name).trim() : null;
    this.emit("roster", this.guidatori);
    this.emit("change", this);
    return g;
  };

  Race.prototype.removeGuidatore = function (slot) {
    var g = this.bySlot[slot];
    if (!g) return false;
    delete this.bySlot[slot];
    this.guidatori.splice(this.guidatori.indexOf(g), 1);
    this.emit("roster", this.guidatori);
    this.emit("change", this);
    return true;
  };

  /* -- cronometro ------------------------------------------------------------ */

  Race.prototype.elapsedMs = function () {
    if (this.startedAt == null) return 0;
    /* `_pausedAt` valorizzato vuol dire "orologio in sosta", e non solo nello
       stato di pausa: anche il semaforo di ripresa ferma il cronometro. */
    var end = this.endedAt != null ? this.endedAt
            : (this._pausedAt != null ? this._pausedAt : this.now());
    return Math.max(0, end - this.startedAt - this._pausedMs);
  };

  /* -- stato ----------------------------------------------------------------- */

  /* Una gara e' "aperta" se ha avuto il via e non e' ancora finita. Serve a
     distinguere il semaforo di PARTENZA da quello di RIPRESA: sono lo stesso
     stato, ma il primo apre una gara nuova e il secondo no. */
  Race.prototype.inCorso = function () {
    return this.startedAt != null && this.endedAt == null &&
           this.state !== STATE.FINISHED && this.state !== STATE.ABORTED;
  };

  Race.prototype._setState = function (next, t) {
    if (next === this.state) return;
    var prev = this.state;
    t = t != null ? t : this.now();

    if (next === STATE.RUNNING) {
      /* Si riparte da una sosta: pausa vera, oppure il countdown di ripresa
         (il DS200 dopo la pausa rimanda le fasi 2 e 3, cioe' rifa' il semaforo). */
      if (this._pausedAt != null) {
        this._pausedMs += t - this._pausedAt;
        this._pausedAt = null;
      } else if (prev !== STATE.RUNNING && !this.inCorso()) {
        // vera partenza
        this._resetTiming(t);
      }
    } else if (next === STATE.PAUSED) {
      this._pausedAt = t;
    } else if (next === STATE.COUNTDOWN) {
      /* ⚠️ Il countdown NON azzera niente: azzerare e' un'azione esplicita
         (command('newrace')), non un effetto collaterale di uno stato. Era il
         difetto che cancellava la classifica ad ogni ripresa dalla pausa.
         A gara aperta il semaforo vale come sosta, e il cronometro si ferma. */
      if (this.inCorso()) { if (this._pausedAt == null) this._pausedAt = t; }
      else { this.startedAt = null; this.endedAt = null; this._pausedAt = null; this._pausedMs = 0; }
    } else if (next === STATE.FINISHED || next === STATE.ABORTED) {
      if (this.startedAt != null && this.endedAt == null) {
        if (prev === STATE.PAUSED && this._pausedAt != null) this._pausedMs += t - this._pausedAt;
        this.endedAt = t;
      }
      this._pausedAt = null;
    }

    this.state = next;
    this.emit("state", { state: next, prev: prev, t: t });
    this.emit("change", this);
  };

  Race.prototype._resetTiming = function (t) {
    this.startedAt = t;
    this.endedAt = null;
    this._pausedAt = null;
    this._pausedMs = 0;
  };

  Race.prototype._resetScores = function () {
    this._finishCount = 0;
    this._leader = null;
    this.guidatori.forEach(function (g) {
      g.laps = 0;
      g.lastLapMs = null;
      g.bestLapMs = null;
      g.totalMs = null;
      g.raceMs = 0;
      g.lastCrossAt = null;
      g.reportedPosition = null;
      g.finished = false;
      g.finishedAt = null;
      g.finishPos = null;
    });
  };

  /* Comandi dall'interfaccia. Ritorna true se il comando aveva senso adesso. */
  Race.prototype.command = function (cmd, t) {
    t = t != null ? t : this.now();
    switch (cmd) {
      case "newrace":                   // gara nuova: azzera e aspetta il via
        this._resetScores();
        this.startedAt = null;
        this.endedAt = null;
        this._pausedAt = null;
        this._pausedMs = 0;
        this._setState(STATE.COUNTDOWN, t);
        this.emit("change", this);
        return true;
      case "arm":                       // sinonimo storico
        return this.command("newrace", t);
      case "start":
        if (this.state === STATE.RUNNING) return false;
        if (this.state !== STATE.PAUSED) this._resetScores();
        this._setState(STATE.RUNNING, t);
        return true;
      case "pause":
        if (this.state !== STATE.RUNNING) return false;
        this._setState(STATE.PAUSED, t);
        return true;
      case "resume":
        if (this.state !== STATE.PAUSED) return false;
        this._setState(STATE.RUNNING, t);
        return true;
      case "stop":                      // bandiera a scacchi anticipata
        if (this.state !== STATE.RUNNING && this.state !== STATE.PAUSED) return false;
        this._finish(t, null);
        return true;
      case "abort":
        if (this.state === STATE.IDLE) return false;
        this._setState(STATE.ABORTED, t);
        return true;
      case "reset":
        this._resetScores();
        this.startedAt = null;
        this.endedAt = null;
        this._pausedAt = null;
        this._pausedMs = 0;
        this._setState(STATE.IDLE, t);
        this.emit("change", this);
        return true;
      default:
        return false;
    }
  };

  Race.prototype._finish = function (t, winner) {
    this._setState(STATE.FINISHED, t);
    var st = this.standings();
    this.emit("end", { winner: winner || st[0] || null, standings: st, t: t });
  };

  /* -- eventi dal sistema ---------------------------------------------------- */

  /* Un evento normalizzato. Tipi accettati:
       {type:'lap', slot, laps?, lapMs?, totalMs?, t?}
       {type:'state', state:'countdown|running|paused|finished|aborted', t?}
       {type:'presence', slot, present?}
       {type:'telemetry', slot, fuel?, reserve?, pit?, battery?, position?}
     Tutto il resto viene ignorato dal motore (l'interfaccia puo' comunque
     ascoltarlo dal sistema, per il log grezzo). */
  Race.prototype.feed = function (ev) {
    if (!ev || !ev.type) return null;
    var t = ev.t != null ? ev.t : this.now();
    switch (ev.type) {
      case "lap": return this._lap(ev, t);
      case "state": return this._stateEvent(ev, t);
      case "presence": {
        var gp = this.guidatore(ev.slot);
        gp.present = ev.present !== false;
        this.emit("change", this);
        return gp;
      }
      case "telemetry": {
        var g = this.guidatore(ev.slot);
        g.present = true;
        if ("fuel" in ev) g.fuel = ev.fuel;
        if ("reserve" in ev) g.reserve = !!ev.reserve;
        if ("pit" in ev) g.pit = !!ev.pit;
        if ("battery" in ev) g.battery = !!ev.battery;
        if (ev.position != null) g.reportedPosition = ev.position;
        this.emit("change", this);
        return g;
      }
      default: return null;
    }
  };

  Race.prototype._stateEvent = function (ev, t) {
    /* 'newrace' e 'countdown' finiscono nello stesso stato ma NON sono la
       stessa cosa: il primo apre una gara nuova (azzera), il secondo e' solo
       il semaforo — che il DS200 rimanda anche dopo ogni pausa. */
    if (ev.state === "newrace") { this.command("newrace", t); return this.state; }

    var map = {
      countdown: STATE.COUNTDOWN, start: STATE.COUNTDOWN,
      running: STATE.RUNNING, go: STATE.RUNNING,
      paused: STATE.PAUSED, pause: STATE.PAUSED,
      resumed: STATE.RUNNING,
      finished: STATE.FINISHED, end: STATE.FINISHED,
      aborted: STATE.ABORTED, abort: STATE.ABORTED
    };
    var next = map[ev.state];
    if (!next) return null;
    if (next === STATE.FINISHED) { this._finish(t, null); return this.state; }
    this._setState(next, t);
    return this.state;
  };

  Race.prototype._lap = function (ev, t) {
    var g = this.guidatore(ev.slot);
    g.present = true;

    /* Doppioni. Tutti e tre i sistemi ripetono i pacchetti: il DS200 manda lo
       stesso frame tre volte, la power base Ninco ripete i risultati finche'
       non cambia qualcosa. Se il numero di giri arriva dal sistema quello e' il
       criterio buono; se non arriva, ci si affida alla distanza fra i passaggi. */
    if (ev.laps != null) {
      /* Rete di sicurezza: il numero di giri non torna MAI indietro. Se torna
         indietro, la pista ha ricominciato a contare — ci siamo collegati a
         gara iniziata, oppure e' partita una gara nuova e l'annuncio non ci e'
         arrivato. In ogni caso quello che avevamo in classifica non vale piu'. */
      if (ev.laps < g.laps) {
        this._resetScores();
        this._resetTiming(t);
        this.emit("restart", { slot: ev.slot, laps: ev.laps, t: t });
        g = this.guidatore(ev.slot);
      } else if (ev.laps <= g.laps) {
        return null;
      }
    } else if (g.lastCrossAt != null && (t - g.lastCrossAt) < this.minLapMs) {
      return null;
    }

    /* In pratica il primo passaggio fa partire il cronometro da solo. */
    if (MODES[this.mode].autoStart && this.state !== STATE.RUNNING &&
        this.state !== STATE.PAUSED && this.state !== STATE.FINISHED) {
      this._setState(STATE.RUNNING, t);
    }

    /* Si contano solo i giri fatti a gara in corso. Prima del via le auto
       girano per scaldare le gomme e la power base li trasmette lo stesso; a
       gara ferma o finita passa chi si sta rimettendo in pista. In tutti questi
       casi il passaggio serve solo a dire "questo posto e' occupato". */
    if (this.state !== STATE.RUNNING) {
      this.emit("change", this);
      return null;
    }

    /* Tempo sul giro: prima quello del sistema, poi la differenza fra due
       totali (Ninco fa cosi'), infine la distanza fra due passaggi (l'ultima
       spiaggia: e' il nostro orologio, non quello della pista). */
    var lapMs = null;
    if (ev.lapMs != null && ev.lapMs > 0) {
      lapMs = ev.lapMs;
    } else if (ev.totalMs != null && g.totalMs != null && ev.totalMs > g.totalMs) {
      lapMs = ev.totalMs - g.totalMs;
    } else if (ev.totalMs == null && g.lastCrossAt != null) {
      lapMs = t - g.lastCrossAt;
    }

    var prevLaps = g.laps;
    g.laps = ev.laps != null ? ev.laps : g.laps + 1;
    if (ev.totalMs != null) g.totalMs = ev.totalMs;
    g.lastCrossAt = t;

    var isBest = false;
    if (lapMs != null && lapMs > 0) {
      g.lastLapMs = lapMs;
      g.raceMs += lapMs;
      if (g.bestLapMs == null || lapMs < g.bestLapMs) {
        // il primissimo giro non e' un "record": e' solo il primo dato
        isBest = g.bestLapMs != null;
        g.bestLapMs = lapMs;
      }
    }

    var out = {
      slot: g.slot, guidatore: g, laps: g.laps, prevLaps: prevLaps,
      lapMs: lapMs, best: isBest, t: t
    };
    this.emit("lap", out);

    // cambio di leader
    var st = this.standings();
    var lead = st.length ? st[0].slot : null;
    if (lead !== this._leader) {
      this._leader = lead;
      if (lead != null) this.emit("lead", { slot: lead, guidatore: st[0], t: t });
    }

    /* Traguardo (solo GP a giri, e solo se la regola e' nostra: quando comanda
       la centralina, la bandiera la sventola lei con un evento 'finished'). */
    if (this.authority === "app" &&
        MODES[this.mode].target === "laps" && this.targetLaps > 0 &&
        this.state === STATE.RUNNING && !g.finished && g.laps >= this.targetLaps) {
      g.finished = true;
      g.finishedAt = t;
      g.finishPos = ++this._finishCount;
      this.emit("finish", { slot: g.slot, guidatore: g, position: g.finishPos, t: t });
      var tutti = this.guidatori.length > 0 && this.guidatori.every(function (x) { return x.finished; });
      if (!this.finishAll || tutti) this._finish(t, g);
    }

    this.emit("change", this);
    return out;
  };

  /* -- classifica ------------------------------------------------------------ */

  /* prefer:'reported' usa la posizione dichiarata dal sistema quando c'e'
     (la power base Ninco la calcola lei, ed e' piu' precisa della nostra
     perche' vede anche la posizione dentro il giro). */
  Race.prototype.standings = function (opts) {
    var list = this.guidatori.slice();
    var prefer = opts && opts.prefer;

    if (prefer === "reported") {
      var tuttiNoti = list.length > 0 && list.every(function (g) { return g.reportedPosition != null; });
      if (tuttiNoti) {
        list.sort(function (a, b) { return a.reportedPosition - b.reportedPosition || a.slot - b.slot; });
        return list;
      }
    }

    list.sort(function (a, b) {
      // chi ha tagliato il traguardo sta davanti, nell'ordine d'arrivo
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishPos - b.finishPos;
      // poi conta il numero di giri
      if (a.laps !== b.laps) return b.laps - a.laps;
      // a pari giri e' avanti chi ci e' arrivato prima
      if (a.lastCrossAt != null && b.lastCrossAt != null && a.lastCrossAt !== b.lastCrossAt) {
        return a.lastCrossAt - b.lastCrossAt;
      }
      if ((a.lastCrossAt == null) !== (b.lastCrossAt == null)) return a.lastCrossAt == null ? 1 : -1;
      // ultimo criterio: il giro veloce
      var ba = a.bestLapMs == null ? Infinity : a.bestLapMs;
      var bb = b.bestLapMs == null ? Infinity : b.bestLapMs;
      if (ba !== bb) return ba - bb;
      return a.slot - b.slot;
    });
    return list;
  };

  /* Il giro veloce assoluto della gara. */
  Race.prototype.bestLap = function () {
    var best = null;
    this.guidatori.forEach(function (g) {
      if (g.bestLapMs != null && (best === null || g.bestLapMs < best.bestLapMs)) best = g;
    });
    return best;
  };

  Race.prototype.snapshot = function () {
    return {
      mode: this.mode,
      targetLaps: this.targetLaps,
      state: this.state,
      elapsedMs: this.elapsedMs(),
      standings: this.standings().map(function (g) {
        return {
          slot: g.slot, name: g.name, laps: g.laps,
          lastLapMs: g.lastLapMs, bestLapMs: g.bestLapMs,
          fuel: g.fuel, reserve: g.reserve, pit: g.pit,
          finished: g.finished, finishPos: g.finishPos
        };
      })
    };
  };

  /* -- formattazione (usata da interfaccia, voce e CSV: sta qui una volta sola) */

  function formatMs(ms) {
    if (ms == null || !isFinite(ms)) return "—";
    var neg = ms < 0; ms = Math.abs(ms);
    var m = Math.floor(ms / 60000),
        s = Math.floor(ms % 60000 / 1000),
        c = Math.floor(ms % 1000 / 10);
    return (neg ? "-" : "") + m + ":" + String(s).padStart(2, "0") + "." + String(c).padStart(2, "0");
  }

  function formatClock(ms) {
    if (ms == null || !isFinite(ms)) return "0:00.00";
    var h = Math.floor(ms / 3600000);
    var rest = formatMs(ms % 3600000);
    return h > 0 ? h + ":" + (rest.length < 8 ? "0" : "") + rest : rest;
  }

  var RACE = {
    Race: Race, Emitter: Emitter,
    STATE: STATE, MODES: MODES, MIN_LAP_MS: MIN_LAP_MS,
    formatMs: formatMs, formatClock: formatClock
  };

  global.RACE = RACE;
  if (typeof module !== "undefined" && module.exports) module.exports = RACE;
})(typeof window !== "undefined" ? window : globalThis);
