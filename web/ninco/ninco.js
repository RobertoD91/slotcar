/* ninco.js — decodifica del protocollo seriale della power base Ninco N-Digital.
 *
 * Specifica: docs/ninco/PROTOCOLLO.md (fonte: slotbaer.de).
 * Riassunto: seriale 1200 8N1 ma a 7 bit di dati, testo ASCII, ogni pacchetto
 * termina con CR (0x0D). Cinque tipi: M (modalita'), P (programmazione),
 * L (passaggio sul traguardo), F (benzina), D (risultato/tempi).
 *
 * Non fa niente di asincrono e non tocca il DOM: si puo' testare da riga di comando
 * (vedi ninco.test.js) ed e' lo stesso file che usa la pagina.
 */
(function (global) {
  "use strict";

  var CR = 0x0D, LF = 0x0A;
  var CARS = 8;                       // la base ne gestisce 8, sempre tutti nel pacchetto

  /* Significato dei valori della "massima velocita' consentita" (2° carattere di ogni
     auto nel pacchetto L). Sono 4 bit: qui i valori a cui la specifica da' un nome. */
  var SPEED = {
    0x0: "stop",        // pista spenta oppure auto che entra ai box
    0x4: "slow",        // deve andare piano, tipicamente benzina agli sgoccioli
    0xC: "amateur",     // strada libera, modalita' amatore
    0xF: "pro"          // strada libera, modalita' professionale
  };

  function isDigits(s) { return /^[0-9]+$/.test(s); }

  /* "MMSSCC" -> millisecondi. 123456 = 12 min, 34 s, 56 centesimi. */
  function parseTime(s) {
    if (!/^[0-9]{6}$/.test(s)) return null;
    var mm = +s.slice(0, 2), ss = +s.slice(2, 4), cc = +s.slice(4, 6);
    return { mm: mm, ss: ss, cc: cc, ms: mm * 60000 + ss * 1000 + cc * 10, raw: s };
  }

  /* millisecondi -> "M:SS.CC", per la vista */
  function formatMs(ms) {
    if (ms == null || !isFinite(ms)) return "—";
    var neg = ms < 0; ms = Math.abs(ms);
    var m = Math.floor(ms / 60000), s = Math.floor(ms % 60000 / 1000), c = Math.floor(ms % 1000 / 10);
    return (neg ? "-" : "") + m + ":" + String(s).padStart(2, "0") + "." + String(c).padStart(2, "0");
  }

  /* Benzina di UNA auto. car e' 1-based: l'ottava ha le cifre invertite (vedi spec).
     swap8 e' un'opzione perche' la fonte non sa dire se valga per tutte le power base. */
  function parseFuelField(raw, car, swap8) {
    var v = raw;
    if (car === 8 && swap8 && v.length === 2) v = v[1] + v[0];
    // "I5" (o "5I", che e' lo stesso rovesciato) = riserva
    if (/^(I5|5I)$/i.test(v) || /^(I5|5I)$/i.test(raw)) return { reserve: true, level: null, raw: raw };
    if (isDigits(v)) return { reserve: false, level: parseInt(v, 10), raw: raw };
    return { reserve: false, level: null, raw: raw, invalid: true };
  }

  /* Decodifica UNA riga (senza il CR finale). Ritorna un oggetto {type:...},
     con type "unknown" se non la riconosce: meglio mostrarla che buttarla. */
  function parseLine(line, opts) {
    opts = opts || {};
    var swap8 = opts.swapCar8 !== false;         // default: attivo, come da specifica
    if (line == null) return null;
    var s = String(line).replace(/[\r\n]+$/, "");
    if (s === "") return null;

    var kind = s[0], rest = s.slice(1), f;

    // ---- MX : modalita' ----------------------------------------------------
    if (kind === "M" && /^[0-9]$/.test(rest)) {
      var x = +rest;
      return { type: "mode", raw: s, lights: !!(x & 1), professional: !!(x & 2), value: x };
    }

    // ---- P : programmazione (tasto Menu) -----------------------------------
    if (s === "P") return { type: "program", raw: s };

    // ---- LRRRR,A1..A8 : passaggio sul traguardo ----------------------------
    if (kind === "L") {
      f = rest.split(",");
      if (f.length !== CARS + 1 || !isDigits(f[0])) return { type: "unknown", raw: s };
      var cars = [], i, fld, pos, sp;
      for (i = 1; i <= CARS; i++) {
        fld = f[i];
        if (!fld || fld.length !== 2) return { type: "unknown", raw: s };
        pos = /^[0-9]$/.test(fld[0]) ? +fld[0] : null;       // posizione: decimale
        sp = /^[0-9A-Fa-f]$/.test(fld[1]) ? parseInt(fld[1], 16) : null;  // velocita': esadecimale
        if (pos === null || sp === null) return { type: "unknown", raw: s };
        cars.push({
          car: i,
          position: pos,
          racing: pos !== 0,            // posizione 0 = l'auto non partecipa
          maxSpeed: sp,
          maxSpeedHex: fld[1].toUpperCase(),
          meaning: SPEED[sp] || null,
          stopped: sp === 0,            // pista spenta o ingresso box
          lowFuel: sp === 4,
          raw: fld
        });
      }
      return { type: "lap", raw: s, leaderLaps: parseInt(f[0], 10), cars: cars };
    }

    // ---- FB1..B8 : benzina -------------------------------------------------
    if (kind === "F") {
      f = rest.split(",");
      if (f.length !== CARS) return { type: "unknown", raw: s };
      var fuel = [];
      for (var j = 0; j < CARS; j++) {
        var p = parseFuelField(f[j], j + 1, swap8);
        p.car = j + 1;
        fuel.push(p);
      }
      return { type: "fuel", raw: s, cars: fuel };
    }

    // ---- DAAAA,RRRR,GGGGGG,SSSSSS : risultato / tempi ----------------------
    if (kind === "D") {
      f = rest.split(",");
      if (f.length !== 4 || !isDigits(f[0]) || !isDigits(f[1])) return { type: "unknown", raw: s };
      var tot = parseTime(f[2]), best = parseTime(f[3]);
      if (!tot || !best) return { type: "unknown", raw: s };
      return {
        type: "result", raw: s,
        car: parseInt(f[0], 10),
        laps: parseInt(f[1], 10),       // in modalita' GP e' il distacco in giri, non i giri
        total: tot,
        best: best
      };
    }

    return { type: "unknown", raw: s };
  }

  /* Accumula i byte in arrivo dalla seriale e restituisce le righe complete.
     Il CR chiude il pacchetto; l'LF, se c'e', si ignora. */
  function Framer(limit) {
    this.buf = "";
    this.limit = limit || 512;          // paracadute: una riga sana e' ~40 caratteri
  }
  Framer.prototype.push = function (bytes) {
    var out = [], i, b;
    for (i = 0; i < bytes.length; i++) {
      b = bytes[i];
      if (b === CR) { if (this.buf !== "") out.push(this.buf); this.buf = ""; continue; }
      if (b === LF) continue;
      this.buf += String.fromCharCode(b & 0x7f);   // 7 bit di dati
      if (this.buf.length > this.limit) this.buf = "";   // rumore: riparto pulito
    }
    return out;
  };

  /* Stato della gara ricostruito dai pacchetti.
   *
   * I tempi sul giro NON arrivano mai come numero: dalla versione 1.08 la base manda
   * un pacchetto D ad ogni passaggio, col tempo TOTALE trascorso — quindi il giro si
   * ottiene per differenza fra due totali consecutivi della stessa auto (per il primo
   * giro vale il totale stesso). Con firmware precedenti i tempi non ci sono.
   */
  function RaceState() {
    this.cars = {};
    this.leaderLaps = null;
    this.lights = null;
    this.professional = null;
    this.sawResult = false;      // se arrivano D, il firmware e' >= 1.08
  }
  RaceState.prototype.car = function (n) {
    if (!this.cars[n]) this.cars[n] = {
      car: n, position: null, racing: false, maxSpeed: null, meaning: null,
      fuel: null, reserve: false, laps: null, totalMs: null, lastLapMs: null,
      bestMs: null, bestReported: null
    };
    return this.cars[n];
  };
  RaceState.prototype.apply = function (pkt) {
    if (!pkt) return;
    var i, c, d;
    if (pkt.type === "mode") { this.lights = pkt.lights; this.professional = pkt.professional; }
    else if (pkt.type === "lap") {
      this.leaderLaps = pkt.leaderLaps;
      for (i = 0; i < pkt.cars.length; i++) {
        d = pkt.cars[i]; c = this.car(d.car);
        c.position = d.position; c.racing = d.racing;
        c.maxSpeed = d.maxSpeed; c.meaning = d.meaning;
      }
    } else if (pkt.type === "fuel") {
      for (i = 0; i < pkt.cars.length; i++) {
        d = pkt.cars[i]; c = this.car(d.car);
        c.fuel = d.level; c.reserve = d.reserve;
      }
    } else if (pkt.type === "result") {
      this.sawResult = true;
      c = this.car(pkt.car);
      // La base ripete gli stessi pacchetti: un totale identico al precedente non e'
      // un giro nuovo, e' una ripetizione. Senza questo controllo si contano giri finti
      // da 0 ms e il "giro veloce" diventa 0.
      if (c.totalMs === null || pkt.total.ms > c.totalMs) {
        c.lastLapMs = c.totalMs === null ? pkt.total.ms : pkt.total.ms - c.totalMs;
        c.totalMs = pkt.total.ms;
        if (c.lastLapMs > 0 && (c.bestMs === null || c.lastLapMs < c.bestMs)) c.bestMs = c.lastLapMs;
      }
      c.laps = pkt.laps;
      c.bestReported = pkt.best.ms;     // il giro veloce dichiarato dalla base
    }
  };
  RaceState.prototype.list = function () {
    var out = [], n;
    for (n in this.cars) out.push(this.cars[n]);
    out.sort(function (a, b) {
      var pa = a.position || 99, pb = b.position || 99;
      return pa !== pb ? pa - pb : a.car - b.car;
    });
    return out;
  };

  global.NINCO = {
    CR: CR, CARS: CARS, SPEED: SPEED,
    SERIAL: { baudRate: 1200, dataBits: 7, stopBits: 1, parity: "none" },
    parseLine: parseLine, parseTime: parseTime, formatMs: formatMs,
    parseFuelField: parseFuelField, Framer: Framer, RaceState: RaceState
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.NINCO;
})(typeof window !== "undefined" ? window : globalThis);
