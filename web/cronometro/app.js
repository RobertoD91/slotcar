/* app.js — l'interfaccia del Cronometro web.
 *
 * Qui dentro c'e' SOLO interfaccia: leggere i controlli, disegnare, parlare.
 * Le regole di gara stanno in race.js, il dialogo con la pista nei sistemi
 * (sistemi/*.js). Se ti trovi a scrivere una regola qui, e' nel posto sbagliato.
 */
(function () {
  "use strict";

  var APP_VERSION = "0.5.2";
  var LS = { nomi: "cronometro.nomi", cfg: "cronometro.cfg" };

  var $ = function (id) { return document.getElementById(id); };
  var t = function (k, p) { return I18N.t(k, p); };

  var els = {
    lang: $("lang"), tts: $("tts"),
    sys: $("sys"), sysDesc: $("sysDesc"), mode: $("mode"), laps: $("laps"),
    lapsFld: $("lapsFld"), connect: $("connect"), sysOpts: $("sysOpts"),
    modeFld: $("modeFld"), progVal: $("progVal"), modeHint: $("modeHint"),
    roster: $("roster"), addDriver: $("addDriver"), slotNote: $("slotNote"),
    ctrlNote: $("ctrlNote"), raceNote: $("raceNote"),
    clock: $("clock"), stateVal: $("stateVal"), bestVal: $("bestVal"), targetVal: $("targetVal"),
    start: $("start"), pause: $("pause"), stop: $("stop"), reset: $("reset"), csv: $("csv"),
    board: $("board"), boardEmpty: $("boardEmpty"),
    clockPanel: $("clockPanel"),
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
  /* ⚠️ Le bandierine sono coppie di "indicatori regionali": su Windows non
     esistono nel font di sistema e si vedono le due lettere. Va bene lo stesso —
     erano gia' due lettere prima — ma per questo resta anche il nome. */
  var BANDIERE = { it: "🇮🇹", en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪" };
  var NOMI_LINGUA = { it: "Italiano", en: "English", es: "Español", fr: "Français", de: "Deutsch" };

  function fillLang() {
    els.lang.innerHTML = "";
    I18N.langs.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l;
      o.textContent = (BANDIERE[l] || "") + " " + (NOMI_LINGUA[l] || l.toUpperCase());
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
    /* ⚠️ Qui l'elenco si ricostruisce da capo, e se stai scrivendo un nome la
       casella sotto le dita sparisce col fuoco dentro. Rinominare non passa piu'
       di qui (vedi race.rename), ma un'altra via resta aperta: se mentre scrivi
       arriva il giro di un posto ancora sconosciuto, il roster cambia davvero e
       ridisegnarlo e' giusto. Allora ci si ricorda dov'era il cursore. */
    var attivo = document.activeElement;
    var slotAttivo = null, sel = 0;
    if (attivo && attivo.tagName === "INPUT" && els.roster.contains(attivo)) {
      slotAttivo = attivo.dataset.slot;
      sel = attivo.selectionStart;
    }

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
      inp.dataset.slot = g.slot;
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
    renderLimite();

    if (slotAttivo != null) {
      var tornato = els.roster.querySelector('input[data-slot="' + slotAttivo + '"]');
      if (tornato) { tornato.focus(); try { tornato.setSelectionRange(sel, sel); } catch (e) {} }
    }
  }

  function salvaSlots() {
    cfg.slots = race.guidatori.map(function (g) { return g.slot; });
    save(LS.cfg, cfg);
  }

  els.addDriver.addEventListener("click", function () {
    if (race.guidatori.length >= limitePosti()) return;
    var n = 1;
    while (race.bySlot[n]) n++;
    race.guidatore(n);
    applicaNomiSalvati();
    salvaSlots();
    renderRoster();
    renderBoard();
  });

  /* ---- classifica ---------------------------------------------------------- */
  /* Quanti decimali scrivere: lo dichiara il SISTEMA collegato, non l'interfaccia.
     Il DS200 manda diecimillesimi e li mostriamo; Ninco e oXigen mandano
     centesimi e mostrarne quattro sarebbe inventarne due. Il grande orologio
     resta a due: e' un tempo di gara, non un tempo sul giro, e a distanza le
     cifre in piu' sono rumore. Anche la voce dice sempre i centesimi. */
  function dec() { return caps.timeDecimals == null ? 2 : caps.timeDecimals; }
  function tempo(ms) { return RACE.formatMs(ms, dec()); }

  function gapText(g, leader) {
    if (!leader || g === leader) return "—";
    if (g.laps < leader.laps) {
      var d = leader.laps - g.laps;
      return d === 1 ? t("gap.lap") : t("gap.laps", { n: d });
    }
    if (g.lastCrossAt != null && leader.lastCrossAt != null) {
      return "+" + tempo(g.lastCrossAt - leader.lastCrossAt);
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
      tr.appendChild(td(tempo(g.lastLapMs)));
      tr.appendChild(td(tempo(g.bestLapMs),
        migliore && migliore.slot === g.slot && g.bestLapMs != null ? "best" : ""));
      tr.appendChild(td(gapText(g, st[0]), "gapCol"));

      var fuel = "—";
      if (g.reserve) fuel = '<span class="tag res">' + esc(t("tbl.reserve")) + "</span>";
      else if (g.fuel != null) fuel = String(g.fuel);
      if (g.pit) fuel += '<span class="tag pit">' + esc(t("tbl.pit")) + "</span>";
      tr.appendChild(td(fuel, "fuelCol"));

      els.board.appendChild(tr);
    });

    els.bestVal.textContent = migliore ? tempo(migliore.bestLapMs) : "—";
    /* Col DS la casella "Traguardo" riporta il programma DELLA CENTRALINA, non
       la nostra modalità: prima che lei parli non sappiamo se sta correndo a
       giri, a tempo o in F1, e scriverci "Pratica" sarebbe l'ennesimo dato
       inventato — solo più discreto degli altri. */
    els.targetVal.textContent =
        traguardoDelSistema() ? testoProgramma()
      : race.mode !== "gp" ? t("mode.pratica")
      : giriNoti() ? t("info.targetLaps", { n: race.targetLaps })
      : "—";
  }

  function renderState() {
    els.stateVal.textContent = t("state." + race.state);
    var box = els.stateVal.parentElement;
    box.className = "stat" + (race.state === "running" ? " on"
                            : race.state === "paused" ? " warn" : "");
    /* Il tempo cambia colore con lo stato: da lontano il colore si legge prima
       della parola, e spesso è l'unica cosa che serve sapere. */
    els.clockPanel.className = "clockpanel " +
      (race.state === "running" ? "on"
       : race.state === "paused" || race.state === "countdown" ? "warn"
       : race.state === "finished" ? "done" : "idle");

    var inGara = race.state === "running";
    var inPausa = race.state === "paused";

    /* Quando comanda la centralina (DS200/DS300) i pulsanti di gara sono una
       bugia: l'app non puo' far partire niente, e premerli servirebbe solo a
       raccontare una storia diversa da quella che si vede in pista. Restano
       spenti, con scritto perche'. "Azzera" resta acceso: e' locale, e serve
       anche a tirarsi fuori se la centralina non annuncia mai la fine. */
    var comandaSistema = race.authority === "sistema";
    els.start.disabled = comandaSistema || inGara || inPausa;
    els.pause.disabled = comandaSistema || (!inGara && !inPausa);
    els.pause.textContent = inPausa ? t("btn.resume") : t("btn.pause");
    els.stop.disabled = comandaSistema || (!inGara && !inPausa);
    els.csv.disabled = race.guidatori.length === 0;
    els.ctrlNote.hidden = !comandaSistema;
    if (comandaSistema) els.ctrlNote.textContent = t("ctrl.systemRuns");
  }

  /* Quanti posti gestisce la pista collegata: 2 corsie sul DS200, 8 sul DS300 e
     sulla Ninco, 20 auto su oXigen. Il limite non cancella niente — i nomi che
     hai scritto sono roba tua — ma spegne "aggiungi" e segnala chi resta fuori. */
  function limitePosti() { return caps && caps.slots > 0 ? caps.slots : 99; }

  /* ⭐ Le caratteristiche del sistema si applicano APPENA LO SCEGLI, non solo
   * quando ti colleghi. Il DS200 gestisce 2 corsie e il DS300 otto: adesso che
   * sono due sistemi distinti l'app lo sa gia' dal menu, e lasciarti aggiungere
   * otto guidatori per poi toglierteli al collegamento e' un giro a vuoto.
   * (Prima non poteva saperlo: la voce era una sola e il numero di corsie
   * dipendeva dal baud, cioe' da un'opzione.)
   *
   * Stessa cosa per l'etichetta dei posti — "Corsia" o "Auto" — e per la colonna
   * della benzina: sono tutte cose che il sistema DICHIARA, non che scopre.
   * A collegamento avviato invece comandano le caps vive, che i frame possono
   * aver corretto: qui non si tocca niente. */
  function applicaCaps(c) {
    caps = c;
    document.body.classList.toggle("has-fuel", !!caps.fuel);
    race.authority = SISTEMI.authority(caps);
  }

  function anteprimaSistema() {
    if (sistema) return;                       // collegati: comandano le caps vive
    var def = SISTEMI.get(els.sys.value);
    applicaCaps(def ? def.caps : SISTEMI.CAPS_DEFAULT);
    if (traguardoDelSistema()) { race.targetLaps = null; programma = null; }
    renderTraguardo(); renderRoster(); renderBoard(); renderState();
  }

  /* ⭐ Chi decide su quanti giri si corre.
   *
   * Se la gara la comanda la centralina, il traguardo e' SUO: lo programmi sulla
   * scatola e lei lo annuncia nel frame di partenza. L'app non deve chiederlo —
   * e soprattutto non deve ANNUNCIARE un numero che ha chiesto a te, perche'
   * quello non e' un dato: e' un desiderio. Finche' la centralina non parla il
   * traguardo e' semplicemente sconosciuto, e "—" e' l'unica cosa vera da
   * scrivere. E' lo stesso motivo per cui al contagiri abbiamo tolto il
   * cronometro che scorreva da solo. */
  function traguardoDelSistema() { return race.authority === "sistema"; }

  /* Il programma dichiarato dalla centralina: {kind, value} oppure null se non
     l'ha ancora detto. Vive qui e non nel motore perche' il motore sa fare due
     modalita' — pratica e GP a giri — mentre la centralina ne sa fare quattro,
     e le altre due le sappiamo solo RIPORTARE, non arbitrare. */
  var programma = null;

  function testoProgramma() {
    if (!programma) return "—";
    var k = "prog.kind." + programma.kind;
    return programma.value > 0 ? t(k, { n: programma.value }) : t(k, { n: "?" });
  }

  /* Il traguardo lo sappiamo? Con la centralina, solo dopo che l'ha detto. */
  function giriNoti() { return race.targetLaps != null && race.targetLaps > 0; }

  function renderTraguardo() {
    var suo = traguardoDelSistema();

    /* ⭐ La MODALITA' non si sceglie quando la gara la programma la centralina:
       lei sa correre a giri individuali, a giri totali, a tempo o in F1, e
       quella che sta correndo la dice nel frame di partenza. Un menu che ti fa
       scegliere fra "pratica" e "GP a giri" mentre la scatola sta correndo una
       F1 non e' una scelta: e' un modo di raccontarti una gara diversa da
       quella che hai davanti. Al suo posto compare quello che ha detto lei. */
    els.mode.hidden = suo;
    els.progVal.hidden = !suo;
    els.modeHint.hidden = !suo;
    els.modeHint.textContent = suo ? " — " + t("setup.modeFromBox") : "";
    if (suo) els.progVal.textContent = testoProgramma();

    /* ⭐ Col DS la casella dei giri sparisce del tutto, non si spegne soltanto:
       il numero lo dice gia' il programma qui accanto ("25 giri individuali"),
       e ripeterlo in una casella grigia vuol dire scrivere due volte lo stesso
       fatto e invitare comunque a modificarlo. Un dato, un posto. */
    els.laps.disabled = suo;
    if (suo) els.laps.value = giriNoti() ? race.targetLaps : "";
    els.lapsFld.hidden = suo || race.mode !== "gp";
  }

  function renderLimite() {
    var max = limitePosti();
    var n = race.guidatori.length;
    els.addDriver.disabled = n >= max;
    var eccesso = race.guidatori.slice(max).map(function (g) { return g.slot; });
    els.slotNote.hidden = n < max;
    if (n > max) els.slotNote.textContent = t("setup.tooMany", { n: max, extra: eccesso.join(", ") });
    else if (n === max) els.slotNote.textContent = t("setup.atMax", { n: max });
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
    var dettagli = null;
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
      (o.advanced ? avanzate() : els.sysOpts).appendChild(lab);
    });

    if (def.optionsHintKey && dettagli) {
      var h = document.createElement("span");
      h.className = "hint";
      h.textContent = t(def.optionsHintKey);
      dettagli.appendChild(h);
    }
    els.sysOpts.hidden = !els.sysOpts.children.length;

    /* Le opzioni "avanzate" esistono ma non stanno addosso: il baud non si
       sceglie piu' — lo porta il sistema — e serve solo se stai provando
       qualcosa di strano. Creato pigramente: se non ce ne sono, niente riquadro. */
    function avanzate() {
      if (dettagli) return dettagli;
      dettagli = document.createElement("details");
      dettagli.className = "adv";
      var sum = document.createElement("summary");
      sum.textContent = t("setup.advanced");
      dettagli.appendChild(sum);
      els.sysOpts.hidden = false;
      els.sysOpts.appendChild(dettagli);
      return dettagli;
    }
  }

  /* ---- programma di gara letto dalla pista --------------------------------- */
  /* Il DS200 annuncia com'e' programmata la gara (a giri, a tempo…) e con che
     numero. Se la centralina lo sa, e' inutile fartelo riscrivere: l'app si
     adegua e te lo dice. La regola di fine gara resta comunque sua. */
  function programmaGara(ev) {
    programma = { kind: ev.kind, value: ev.value };

    if ((ev.kind === "laps" || ev.kind === "lapsTotal") && ev.value > 0) {
      /* Questa la sappiamo arbitrare: e' il nostro GP a giri. */
      race.mode = "gp";
      race.targetLaps = ev.value;
      els.mode.value = "gp";
      nota(t("prog.laps", { n: ev.value }));
    } else {
      /* A tempo o F1: il motore non sa fare quelle regole, e fingere sarebbe
         peggio che ammetterlo. Ma RIPORTARE si puo' — giri, tempi, classifica —
         e la bandiera la sventola comunque la centralina, che e' l'unica ad
         avere titolo per farlo. Quindi niente traguardo nostro e nessuna
         modalita' inventata: si registra e basta. */
      race.mode = "pratica";
      race.targetLaps = null;
      nota(t("prog.other", { prog: testoProgramma() }));
    }
    /* ⚠️ Non si salva in `cfg`: e' la programmazione DELLA CENTRALINA di oggi,
       non una preferenza tua. Salvandola, alla riapertura successiva l'app
       ripartirebbe con un traguardo che nessuno ha piu' confermato — di nuovo
       un numero inventato con l'aria di un dato. */
    renderTraguardo();
    renderBoard(); renderState();
  }

  /* Riga di avviso sopra la barra dei numeri: sparisce da sola. */
  var notaTimer = null;
  function nota(testo) {
    els.raceNote.textContent = testo;
    els.raceNote.hidden = !testo;
    if (notaTimer) clearTimeout(notaTimer);
    if (testo) notaTimer = setTimeout(function () { els.raceNote.hidden = true; }, 12000);
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
    /* Chi comanda: col DS200 la gara la fa partire la centralina, e il motore
       non deve nemmeno chiudere la gara per conto suo. Vedi registry.authority. */
    applicaCaps(sistema.caps);
    /* Il numero che avevi scritto tu non vale piu': lo dira' la centralina.
       Lasciarlo li' vorrebbe dire annunciare "gara a 20 giri" mentre sulla
       scatola ne sono programmati 12. */
    if (traguardoDelSistema()) { race.targetLaps = null; programma = null; }
    renderTraguardo();

    sistema.on("event", function (ev) {
      if (ev.type === "programme") return programmaGara(ev);
      race.feed(ev);
    });
    sistema.on("raw", function (s) { logga(s); });
    sistema.on("caps", function (c) {
      applicaCaps(c);
      renderTraguardo(); renderRoster(); renderBoard(); renderState();
    });
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
    renderTraguardo();
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
    anteprimaSistema();
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
    renderOpzioni(); renderTraguardo();
    renderRoster(); renderBoard(); renderState();
  });

  /* ---- annunci ------------------------------------------------------------- */
  var detti = Object.create(null);   // "posto:giro" gia' annunciati
  var leaderPrec = null;

  race.on("state", function (e) {
    if (e.state === "running" && e.prev !== "paused") {
      detti = Object.create(null); leaderPrec = null;
      /* Alla partenza si dice anche SU QUANTI GIRI si corre. Col DS200 il
         numero non l'hai scelto tu: l'ha deciso la centralina e l'app l'ha
         appena letto dal frame di partenza — sentirselo dire è l'unica
         conferma che quello che sta per correre è davvero quello programmato. */
      var via = t("tts.start");
      /* Solo se il numero e' un fatto. Col DS200 arriva col frame di fase 1,
         cioe' PRIMA del via: se non e' arrivato, non lo sappiamo e si tace. */
      if (race.mode === "gp" && giriNoti()) {
        via += ", " + t("tts.startLaps", { n: race.targetLaps });
      }
      speak(via, true);
    }
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
    renderTraguardo();

    race.setGuidatori((cfg.slots || [1, 2]).map(function (s) { return { slot: s, name: nomi[s] || null }; }));

    renderOpzioni();
    anteprimaSistema();
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
