/* app.js — l'interfaccia del Cronometro web.
 *
 * Qui dentro c'e' SOLO interfaccia: leggere i controlli, disegnare, parlare.
 * Le regole di gara stanno in race.js, il dialogo con la pista nei sistemi
 * (sistemi/*.js). Se ti trovi a scrivere una regola qui, e' nel posto sbagliato.
 */
(function () {
  "use strict";

  var APP_VERSION = "0.2.0";
  var LS = { nomi: "cronometro.nomi", cfg: "cronometro.cfg" };

  var $ = function (id) { return document.getElementById(id); };
  var t = function (k, p) { return I18N.t(k, p); };

  var els = {
    lang: $("lang"), tts: $("tts"),
    sys: $("sys"), sysDesc: $("sysDesc"), mode: $("mode"), laps: $("laps"),
    lapsFld: $("lapsFld"), connect: $("connect"), sysOpts: $("sysOpts"),
    roster: $("roster"), addDriver: $("addDriver"),
    clock: $("clock"), stateVal: $("stateVal"), bestVal: $("bestVal"), targetVal: $("targetVal"),
    start: $("start"), pause: $("pause"), stop: $("stop"), reset: $("reset"), csv: $("csv"),
    board: $("board"), boardEmpty: $("boardEmpty"),
    log: $("log"), clearLog: $("clearLog"), install: $("install"), appver: $("appver")
  };

  /* ---- memoria locale ------------------------------------------------------ */
  function load(key, dflt) {
    try { return JSON.parse(localStorage.getItem(key)) || dflt; } catch (e) { return dflt; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  var nomi = load(LS.nomi, {});          // { "1": "Roberto", ... }
  var cfg = load(LS.cfg, {});
  cfg = Object.assign({
    sys: "sim", mode: "pratica", laps: 20, tts: false, slots: [1, 2, 3, 4],
    opts: {}                              // opzioni per sistema: { sim:{seed,speed}, ... }
  }, cfg);
  if (!cfg.opts) cfg.opts = {};

  /* ---- gara e sistema ------------------------------------------------------ */
  var race = new RACE.Race({ mode: cfg.mode, targetLaps: cfg.laps });
  var sistema = null;
  var caps = SISTEMI.CAPS_DEFAULT;

  /* ---- voce ---------------------------------------------------------------- */
  var ttsOk = "speechSynthesis" in window;
  var voce = null;
  function pickVoice() {
    if (!ttsOk) return;
    var lang = I18N.current;
    var vs = speechSynthesis.getVoices();
    voce = vs.find(function (v) { return new RegExp("^" + lang + "[-_]", "i").test(v.lang); }) ||
           vs.find(function (v) { return (v.lang || "").toLowerCase().indexOf(lang) === 0; }) || null;
  }
  if (ttsOk) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  function speak(text, urgente) {
    if (!ttsOk || !els.tts.checked) return;
    /* A simulazione accelerata gli eventi arrivano molto piu' in fretta di
       quanto si riesca a pronunciarli: se c'e' gia' coda si salta, altrimenti
       la voce resta indietro di minuti. Partenza e vincitore passano sempre. */
    if (!urgente && speechSynthesis.pending) return;
    var u = new SpeechSynthesisUtterance(text);
    u.lang = I18N.bcp47();
    if (voce) u.voice = voce;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  function spokenTime(ms) {
    if (ms == null) return "";
    var m = Math.floor(ms / 60000), s = Math.floor(ms % 60000 / 1000);
    var cc = String(Math.floor(ms % 1000 / 10));
    if (cc.length < 2) cc = "0" + cc;
    var parts = [];
    if (m > 0) parts.push(t("time.min", { n: m }));
    parts.push(t("time.secAnd", { s: s, cc: cc }));
    return parts.join(" ");
  }

  /* Come si chiama un guidatore a voce e a video: il nome se c'e', altrimenti
     "Corsia 3" o "Auto 3" a seconda del sistema collegato. */
  function nomeDi(g) {
    if (g.name) return g.name;
    return t("slot." + (caps.slotLabel || "car")) + " " + g.slot;
  }

  /* ---- registro ------------------------------------------------------------ */
  var logLines = [];
  function logga(s) {
    logLines.push(s);
    if (logLines.length > 400) logLines = logLines.slice(-300);
    els.log.textContent = logLines.join("\n");
    els.log.scrollTop = els.log.scrollHeight;
  }

  /* ---- elenchi a tendina --------------------------------------------------- */
  function fillLang() {
    els.lang.innerHTML = "";
    I18N.langs.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l; o.textContent = l.toUpperCase();
      els.lang.appendChild(o);
    });
    els.lang.value = I18N.current;
  }

  function fillSystems() {
    els.sys.innerHTML = "";
    SISTEMI.list().forEach(function (d) {
      var o = document.createElement("option");
      o.value = d.id;
      var ok = SISTEMI.available(d);
      o.textContent = t(d.labelKey) + (ok ? "" : " — " + t("sys.noBus"));
      o.disabled = !ok;
      els.sys.appendChild(o);
    });
    var wanted = SISTEMI.get(cfg.sys);
    els.sys.value = (wanted && SISTEMI.available(wanted)) ? cfg.sys : "sim";
  }

  function fillModes() {
    els.mode.innerHTML = "";
    Object.keys(RACE.MODES).forEach(function (m) {
      var o = document.createElement("option");
      o.value = m; o.textContent = t("mode." + m);
      els.mode.appendChild(o);
    });
    els.mode.value = cfg.mode;
  }

  /* ---- guidatori ----------------------------------------------------------- */
  function applicaNomiSalvati() {
    race.guidatori.forEach(function (g) {
      if (g.name == null && nomi[g.slot]) g.name = nomi[g.slot];
    });
  }

  function renderRoster() {
    els.roster.innerHTML = "";
    race.guidatori.forEach(function (g) {
      var row = document.createElement("div");
      row.className = "slotrow";

      var num = document.createElement("span");
      num.className = "num";
      num.textContent = t("slot." + (caps.slotLabel || "car")) + " " + g.slot;

      var inp = document.createElement("input");
      inp.type = "text";
      inp.value = g.name || "";
      inp.placeholder = t("hdr.driver");
      inp.setAttribute("aria-label", num.textContent);
      inp.addEventListener("input", function () {
        race.rename(g.slot, inp.value);
        nomi[g.slot] = inp.value;
        save(LS.nomi, nomi);
        renderBoard();
      });

      var del = document.createElement("button");
      del.className = "del";
      del.type = "button";
      del.textContent = t("setup.remove");
      del.addEventListener("click", function () {
        race.removeGuidatore(g.slot);
        salvaSlots();
      });

      row.appendChild(num); row.appendChild(inp); row.appendChild(del);
      els.roster.appendChild(row);
    });
  }

  function salvaSlots() {
    cfg.slots = race.guidatori.map(function (g) { return g.slot; });
    save(LS.cfg, cfg);
  }

  els.addDriver.addEventListener("click", function () {
    var n = 1;
    while (race.bySlot[n]) n++;
    race.guidatore(n);
    applicaNomiSalvati();
    salvaSlots();
    renderRoster();
    renderBoard();
  });

  /* ---- classifica ---------------------------------------------------------- */
  function gapText(g, leader) {
    if (!leader || g === leader) return "—";
    if (g.laps < leader.laps) {
      var d = leader.laps - g.laps;
      return d === 1 ? t("gap.lap") : t("gap.laps", { n: d });
    }
    if (g.lastCrossAt != null && leader.lastCrossAt != null) {
      return "+" + RACE.formatMs(g.lastCrossAt - leader.lastCrossAt);
    }
    return "—";
  }

  function renderBoard() {
    var st = race.standings({ prefer: caps.position ? "reported" : null });
    var migliore = race.bestLap();
    els.board.innerHTML = "";
    els.boardEmpty.hidden = st.length > 0;

    st.forEach(function (g, i) {
      var tr = document.createElement("tr");
      if (i === 0) tr.className = "lead";

      var td = function (html, cls) {
        var c = document.createElement("td");
        if (cls) c.className = cls;
        c.innerHTML = html;
        return c;
      };
      var esc = function (s) {
        return String(s).replace(/[&<>"]/g, function (c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
      };

      tr.appendChild(td(g.finished ? "🏁" : String(i + 1), "pos"));

      var etichetta = t("slot." + (caps.slotLabel || "car")) + " " + g.slot;
      tr.appendChild(td(
        esc(nomeDi(g)) + (g.name ? "<small>" + esc(etichetta) + "</small>" : ""), "who"));

      tr.appendChild(td(String(g.laps)));
      tr.appendChild(td(RACE.formatMs(g.lastLapMs)));
      tr.appendChild(td(RACE.formatMs(g.bestLapMs),
        migliore && migliore.slot === g.slot && g.bestLapMs != null ? "best" : ""));
      tr.appendChild(td(gapText(g, st[0]), "gapCol"));

      var fuel = "—";
      if (g.reserve) fuel = '<span class="tag res">' + esc(t("tbl.reserve")) + "</span>";
      else if (g.fuel != null) fuel = String(g.fuel);
      if (g.pit) fuel += '<span class="tag pit">' + esc(t("tbl.pit")) + "</span>";
      tr.appendChild(td(fuel, "fuelCol"));

      els.board.appendChild(tr);
    });

    els.bestVal.textContent = migliore ? RACE.formatMs(migliore.bestLapMs) : "—";
    els.targetVal.textContent = race.mode === "gp"
      ? t("info.targetLaps", { n: race.targetLaps })
      : t("mode.pratica");
  }

  function renderState() {
    els.stateVal.textContent = t("state." + race.state);
    var box = els.stateVal.parentElement;
    box.className = "stat" + (race.state === "running" ? " on"
                            : race.state === "paused" ? " warn" : "");

    var inGara = race.state === "running";
    var inPausa = race.state === "paused";
    els.start.disabled = inGara || inPausa;
    els.pause.disabled = !inGara && !inPausa;
    els.pause.textContent = inPausa ? t("btn.resume") : t("btn.pause");
    els.stop.disabled = !inGara && !inPausa;
    els.csv.disabled = race.guidatori.length === 0;
  }

  function renderClock() {
    els.clock.textContent = RACE.formatClock(race.elapsedMs());
    requestAnimationFrame(renderClock);
  }

  /* ---- opzioni del sistema -------------------------------------------------- */
  /* Nessun controllo e' cablato nella pagina: ogni sistema dichiara le sue
     opzioni in `def.options` e qui le disegniamo. Aggiungere un sistema non
     richiede di toccare l'HTML. */
  function valoriOpzioni(def) {
    var v = Object.assign({}, cfg.opts[def.id]);
    (def.options || []).forEach(function (o) {
      if (v[o.id] == null) v[o.id] = o.dflt;
    });
    return v;
  }

  function renderOpzioni() {
    var def = SISTEMI.get(els.sys.value);
    els.sysOpts.innerHTML = "";
    els.sysDesc.textContent = def ? t(def.descKey) : "";
    if (!def || !def.options || !def.options.length) { els.sysOpts.hidden = true; return; }
    els.sysOpts.hidden = false;

    var valori = valoriOpzioni(def);
    def.options.forEach(function (o) {
      var lab = document.createElement("label");
      lab.className = "fld";
      var sp = document.createElement("span");
      sp.textContent = t(o.labelKey);
      lab.appendChild(sp);

      var ctl;
      if (o.type === "select") {
        ctl = document.createElement("select");
        o.values.forEach(function (x) {
          var op = document.createElement("option");
          op.value = String(x.v);
          op.textContent = x.labelKey ? t(x.labelKey) : x.label;
          ctl.appendChild(op);
        });
        ctl.value = String(valori[o.id]);
      } else if (o.type === "checkbox") {
        ctl = document.createElement("input");
        ctl.type = "checkbox";
        ctl.checked = !!valori[o.id];
      } else {
        ctl = document.createElement("input");
        ctl.type = "number";
        if (o.min != null) ctl.min = o.min;
        if (o.max != null) ctl.max = o.max;
        ctl.value = valori[o.id];
        ctl.autocomplete = "off";
      }
      ctl.id = "opt-" + def.id + "-" + o.id;   // stabile: ci si aggancia dai test
      ctl.addEventListener("change", function () {
        if (!cfg.opts[def.id]) cfg.opts[def.id] = {};
        cfg.opts[def.id][o.id] = o.type === "checkbox" ? ctl.checked
                               : (o.type === "select" ? (isNaN(+ctl.value) ? ctl.value : +ctl.value)
                                                      : (parseInt(ctl.value, 10) || o.dflt));
        save(LS.cfg, cfg);
      });
      lab.appendChild(ctl);
      els.sysOpts.appendChild(lab);
    });

    if (def.optionsHintKey) {
      var h = document.createElement("span");
      h.className = "hint";
      h.textContent = t(def.optionsHintKey);
      els.sysOpts.appendChild(h);
    }
  }

  /* ---- collegamento del sistema -------------------------------------------- */

  async function connetti() {
    if (sistema) return disconnetti();
    var id = els.sys.value;
    var d = SISTEMI.get(id);
    if (!d || !SISTEMI.available(d)) return;

    sistema = SISTEMI.create(id, {
      values: valoriOpzioni(d),
      cars: race.guidatori.length || 4
    });
    caps = sistema.caps;
    document.body.classList.toggle("has-fuel", !!caps.fuel);

    sistema.on("event", function (ev) { race.feed(ev); });
    sistema.on("raw", function (s) { logga(s); });
    sistema.on("status", function (s) {
      logga("[" + s.state + "]" + (s.detail ? " " + s.detail : ""));
      if (s.state === SISTEMI.STATUS.ERROR) {
        sistema = null;
        els.connect.textContent = t("btn.connect");
      }
    });

    try {
      await sistema.connect();
      els.connect.textContent = t("btn.disconnect");
      els.sys.disabled = true;
      applicaNomiSalvati();
      renderRoster();
      renderBoard();
      renderState();
    } catch (e) {
      logga("errore: " + (e && e.message ? e.message : e));
      sistema = null;
    }
  }

  async function disconnetti() {
    if (!sistema) return;
    try { await sistema.disconnect(); } catch (e) {}
    sistema = null;
    els.connect.textContent = t("btn.connect");
    els.sys.disabled = false;
    renderState();
  }

  /* ---- comandi di gara ------------------------------------------------------ */
  /* Un comando va SEMPRE al motore; va anche al sistema solo se quel sistema
     accetta comandi (oXigen e il simulatore si', DS200 e Ninco no: la' il via
     lo da' la centralina o il dito dell'utente). */
  function comando(cmd) {
    race.command(cmd);
    if (sistema && caps.control) sistema.command(cmd);
    renderState();
    renderBoard();
  }

  els.start.addEventListener("click", function () {
    if (!sistema) { connetti().then(function () { if (sistema) comando("start"); }); return; }
    comando("start");
  });
  els.pause.addEventListener("click", function () {
    comando(race.state === "paused" ? "resume" : "pause");
  });
  els.stop.addEventListener("click", function () { comando("stop"); });
  els.reset.addEventListener("click", function () { comando("reset"); });
  els.connect.addEventListener("click", function () { connetti(); });
  els.clearLog.addEventListener("click", function () { logLines = []; els.log.textContent = ""; });

  els.mode.addEventListener("change", function () {
    race.mode = els.mode.value;
    cfg.mode = race.mode; save(LS.cfg, cfg);
    els.lapsFld.hidden = race.mode !== "gp";
    renderBoard(); renderState();
  });
  els.laps.addEventListener("change", function () {
    race.targetLaps = Math.max(1, parseInt(els.laps.value, 10) || 1);
    els.laps.value = race.targetLaps;
    cfg.laps = race.targetLaps; save(LS.cfg, cfg);
    renderBoard();
  });
  els.sys.addEventListener("change", function () {
    cfg.sys = els.sys.value; save(LS.cfg, cfg);
    renderOpzioni();
  });

  els.tts.addEventListener("change", function () {
    cfg.tts = els.tts.checked; save(LS.cfg, cfg);
    if (els.tts.checked) { pickVoice(); speak(t("tts.on"), true); }
    else if (ttsOk) speechSynthesis.cancel();
  });

  els.lang.addEventListener("change", function () {
    I18N.setLang(els.lang.value);
    I18N.applyDom();
    pickVoice();
    fillSystems(); fillModes();
    renderOpzioni();
    renderRoster(); renderBoard(); renderState();
  });

  /* ---- annunci ------------------------------------------------------------- */
  var detti = Object.create(null);   // "posto:giro" gia' annunciati
  var leaderPrec = null;

  race.on("state", function (e) {
    if (e.state === "running" && e.prev !== "paused") { detti = Object.create(null); leaderPrec = null; speak(t("tts.start"), true); }
    else if (e.state === "running" && e.prev === "paused") speak(t("tts.resumed"));
    else if (e.state === "paused") speak(t("tts.paused"));
    renderState();
  });

  race.on("lap", function (e) {
    var key = e.slot + ":" + e.laps;
    if (detti[key]) return;
    detti[key] = 1;
    if (e.lapMs == null) return;
    var txt = t("tts.lap", { who: nomeDi(e.guidatore), n: e.laps, time: spokenTime(e.lapMs) });
    if (e.best) txt += ", " + t("tts.best");
    speak(txt);
  });

  race.on("lead", function (e) {
    // al primo giro "in testa" non e' una notizia: lo si dice solo ai sorpassi
    if (leaderPrec != null && leaderPrec !== e.slot) speak(t("tts.lead", { who: nomeDi(e.guidatore) }));
    leaderPrec = e.slot;
  });

  race.on("end", function (e) {
    if (sistema && caps.control) sistema.command("stop");
    speak(e.winner ? t("tts.winner", { who: nomeDi(e.winner) }) : t("tts.finished"), true);
    renderState(); renderBoard();
  });

  race.on("roster", function () { applicaNomiSalvati(); renderRoster(); });

  /* Ridisegno a raffica: con la simulazione accelerata arrivano decine di
     eventi al secondo, ridisegnare ogni volta e' sprecato. */
  var attesa = null;
  race.on("change", function () {
    if (attesa) return;
    attesa = setTimeout(function () { attesa = null; renderBoard(); }, 80);
  });

  /* ---- export -------------------------------------------------------------- */
  els.csv.addEventListener("click", function () {
    var righe = [["pos", "guidatore", "posto", "giri", "ultimo_ms", "veloce_ms", "benzina"].join(";")];
    race.standings().forEach(function (g, i) {
      righe.push([
        i + 1, (g.name || "").replace(/;/g, ","), g.slot, g.laps,
        g.lastLapMs == null ? "" : g.lastLapMs,
        g.bestLapMs == null ? "" : g.bestLapMs,
        g.reserve ? "riserva" : (g.fuel == null ? "" : g.fuel)
      ].join(";"));
    });
    var blob = new Blob([righe.join("\n")], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gara-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* ---- PWA ----------------------------------------------------------------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
  var promptInstall = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    promptInstall = e;
    els.install.hidden = false;
  });
  els.install.addEventListener("click", function () {
    if (!promptInstall) return;
    promptInstall.prompt();
    promptInstall = null;
    els.install.hidden = true;
  });

  /* ---- avvio ---------------------------------------------------------------- */
  function avvio() {
    I18N.init();
    fillLang(); fillSystems(); fillModes();

    els.laps.value = cfg.laps;
    els.tts.checked = !!cfg.tts && ttsOk;
    if (!ttsOk) els.tts.parentElement.hidden = true;
    els.appver.textContent = APP_VERSION;
    els.lapsFld.hidden = cfg.mode !== "gp";

    race.setGuidatori((cfg.slots || [1, 2]).map(function (s) { return { slot: s, name: nomi[s] || null }; }));

    renderOpzioni();
    renderRoster();
    renderBoard();
    renderState();
    renderClock();
  }

  /* i18n.js costruisce il dizionario subito, ma il DOM potrebbe non esserci
     ancora: se disegniamo prima, a video restano le chiavi al posto del testo. */
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvio);
  else avvio();
})();
