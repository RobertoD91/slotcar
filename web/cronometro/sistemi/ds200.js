/* sistemi/ds200.js — cronometro DS Electronic DS200 / DS300 via RS-232.
 *
 * Il decoder dei frame NON sta qui: e' quello gia' collaudato del contagiri,
 * `web/ds200-ds300/ds200.js`, caricato dalla pagina. Qui c'e' solo la porta
 * seriale e la traduzione frame -> eventi normalizzati.
 *
 * Cosa da' questo sistema, e cosa no:
 *   ✔ tempo sul giro — lo manda la centralina, non lo calcoliamo noi
 *   ✔ stato della gara — la centralina annuncia partenza, pausa, fine, annullo
 *   ✘ posizione — la ricaviamo dai giri (la centralina non la manda)
 *   ✘ benzina, box, batteria — il DS non li conosce
 *   ✘ comandi — il protocollo e' documentato solo in ricezione: il via lo da'
 *     la centralina, non l'applicazione. Per questo caps.control resta false.
 *
 * Cablaggio: RS-232 vero a ±12 V. Serve un adattatore con MAX3232 o simile;
 * un convertitore TTL 3,3/5 V collegato diretto si danneggia.
 */
(function (global) {
  "use strict";

  var SISTEMI = global.SISTEMI;
  if (!SISTEMI) throw new Error("ds200.js: serve registry.js caricato prima");

  /* Mappa ricavata da una cattura vera su DS200 (vedi il test end-to-end, che
     usa quegli stessi byte). La sequenza osservata e':
         partenza   A1 → A2 → A3 → passaggi
         pausa      A5 → A6 → A2 → A3 → passaggi
     cioe' la centralina, dopo la pausa, RIFA' il semaforo — ma la fase 1
     compare solo alla partenza vera. Quindi la fase 1 e' l'unico annuncio di
     "gara nuova": le fasi 2 e 3 non devono azzerare niente. */
  var STATO = {
    start_race_phase_1: "newrace",
    start_race_phase_2: "countdown",
    start_race_phase_3: "running",
    end_race: "finished",
    start_pause: "paused",
    end_pause: "running",
    abort_race: "aborted"
  };

  /* Il frame della fase 1 porta anche il PROGRAMMA di gara: il tipo-dato dice
     come si vince e i due byte del "programme" quanto. Nella cattura:
        07=3C (giri individuali)  09=00 0A=25  →  25 giri, in BCD.
     ⚠️ La lettura BCD del valore e' un'inferenza: torna con la gara catturata
     (25 giri) ma va confermata su altre programmazioni. */
  var PROGRAMMA = {
    programmed_by_time: "time",
    programmed_by_laps_total: "lapsTotal",
    programmed_by_laps_individual: "laps",
    programmed_by_f1: "f1"
  };

  function bcdByte(b) {
    var hi = (b >> 4) & 0xf, lo = b & 0xf;
    return (hi > 9 || lo > 9) ? null : hi * 10 + lo;
  }

  function Ds200Sistema(def, opts) {
    SISTEMI.Sistema.call(this, def, opts);
    var v = (opts && opts.values) || {};
    /* Il baud e le corsie li porta la DEFINIZIONE del sistema, non una scelta
       da fare a mano: DS200 = 4800 e 2 corsie, DS300 = 57600 e 8. Restano
       cambiabili nelle opzioni avanzate, per provare. Poi il primo frame valido
       conferma o corregge: il modello sta nel byte 4 di OGNI frame. */
    this.attesa = def.device || 0x02;
    this.baud = Number(v.baud) || def.baudDflt || 4800;
    this.port = null;
    this.reader = null;
    this.leggo = false;
    this.ok = 0;
    this.tot = 0;
  }
  Ds200Sistema.prototype = Object.create(SISTEMI.Sistema.prototype);
  Ds200Sistema.prototype.constructor = Ds200Sistema;

  Ds200Sistema.prototype.connect = async function () {
    if (!global.DS200) throw new Error("decoder DS200 non caricato");
    if (!navigator.serial) throw new Error("Web Serial non disponibile");

    this.setStatus(SISTEMI.STATUS.CONNECTING);
    var port = await navigator.serial.requestPort();
    await port.open({
      baudRate: this.baud, dataBits: 8, parity: "none", stopBits: 1, flowControl: "none"
    });
    /* Come il decoder di riferimento (ds300.c) e il CLI: RTS e DTR bassi. */
    try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) {}

    this.port = port;
    this.leggo = true;
    this.ok = 0; this.tot = 0;
    this.setStatus(SISTEMI.STATUS.ON, this.baud + " baud");

    var self = this;
    this.framer = global.DS200.Framer(function (bytes) { self._frame(bytes); });
    this._loop();
  };

  Ds200Sistema.prototype._loop = async function () {
    while (this.port && this.port.readable && this.leggo) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          var r = await this.reader.read();
          if (r.done) break;
          if (r.value && r.value.length) this.framer.push(r.value);
        }
      } catch (e) {
        if (this.leggo) this.setStatus(SISTEMI.STATUS.ERROR, e && e.message ? e.message : String(e));
      } finally {
        try { this.reader.releaseLock(); } catch (e2) {}
        this.reader = null;
      }
    }
  };

  Ds200Sistema.prototype._frame = function (bytes) {
    var f;
    this.tot++;
    try {
      f = global.DS200.parseFrame(bytes);
    } catch (e) {
      this.raw("frame scartato: " + (e && e.message ? e.message : e));
      return;
    }

    /* Un frame con checksum o delimitatori sbagliati si scrive nel registro ma
       non entra in classifica: meglio un buco che un giro inventato. */
    if (f.warnings.length) {
      this.raw(f.rawHex + "   ⚠ " + f.warnings.join(", "));
      if (!f.checksumOk || !f.validStart || !f.validEnd) return;
    }
    this.ok++;

    /* DS200 o DS300? Lo dice ogni frame, e cambia quante corsie esistono:
       2 contro 8. Meglio leggerlo che chiederlo. */
    if (f.deviceId === 0x02 || f.deviceId === 0x03) {
      var corsie = f.deviceId === 0x02 ? 2 : 8;
      if (this.caps.slots !== corsie) {
        this.setCaps({ slots: corsie });
        this.raw("centralina riconosciuta: " + f.device + " — " + corsie + " corsie");
      }
      /* Hai scelto DS200 e risponde un DS300 (o viceversa): capita, e il baud
         giusto lo hai comunque azzeccato. Non e' un errore da fermare tutto, ma
         va detto — altrimenti ti chiedi perche' le corsie sono cambiate. */
      if (f.deviceId !== this.attesa) {
        this.attesa = f.deviceId;
        this.raw("⚠ avevi scelto un'altra centralina: sta parlando un " + f.device);
      }
    }

    /* Lo stato gara sta nel byte della FUNZIONE, che e' valido anche quando il
       tipo-dato non e' "function": il frame di partenza della cattura ha
       tipo-dato 0x3C (gara programmata a giri) e funzione A1 insieme. Guardare
       solo il tipo-dato faceva sparire la partenza. */
    if (f.function) {
      var st = STATO[f.function];
      this.raw(f.rawHex + "   " + f.function +
               (f.dataType !== "function" ? " [" + f.dataType + "]" : ""));

      // il frame di fase 1 porta il programma di gara deciso sulla centralina
      if (f.function === "start_race_phase_1" && PROGRAMMA[f.dataType]) {
        var hi = bcdByte(f.programHi), lo = bcdByte(f.programLo);
        var val = (hi == null || lo == null) ? null : hi * 100 + lo;
        this.send({ type: "programme", kind: PROGRAMMA[f.dataType], value: val });
        this.raw("   programma di gara: " + PROGRAMMA[f.dataType] + " = " + val);
      }
      if (st) this.send({ type: "state", state: st });
      return;
    }

    if (f.dataType === "timing_data" && f.lane) {
      this.send({
        type: "lap",
        slot: f.lane,
        laps: f.laps,
        /* ⚠️ NON si arrotonda: la centralina manda DIECIMILLESIMI di secondo
           (0.1 ms), e Math.round li avrebbe buttati via. A video ne mostriamo
           comunque quanti ne dichiara `caps.timeDecimals`, ma il confronto fra
           due giri va fatto su TUTTE le cifre — altrimenti due giri che pari
           ai centesimi risultano pari e basta, e il giro veloce diventa una
           lotteria. Le cifre in piu' servono all'ORDINE, non alla vetrina. */
        lapMs: f.noTime || f.timeSeconds == null ? null : f.timeSeconds * 1000
      });
      this.raw(f.rawHex + "   corsia " + f.lane + " giro " + f.laps +
               "  " + (f.noTime ? "(primo passaggio)" : f.timeText));
      return;
    }

    /* Il record finale porta il tempo TOTALE, non un giro: darlo in pasto al
       motore come passaggio conterebbe un giro che non c'e'. Resta a registro,
       la fine della gara la annuncia il frame di funzione. */
    if (f.dataType === "final_record_data") {
      if (f.lane) this.send({ type: "presence", slot: f.lane });
      this.raw(f.rawHex + "   finale corsia " + f.lane + ": " + f.laps + " giri, totale " + f.timeText);
      return;
    }

    this.raw(f.rawHex + "   " + f.dataType);
  };

  Ds200Sistema.prototype.disconnect = async function () {
    this.leggo = false;
    try { if (this.reader) await this.reader.cancel(); } catch (e) {}
    try { if (this.port) await this.port.close(); } catch (e) {}
    this.port = null;
    this.setStatus(SISTEMI.STATUS.OFF, this.ok + "/" + this.tot + " frame validi");
  };

  /* ⭐ DS200 e DS300 sono DUE APPARECCHI DIVERSI, non un'opzione dello stesso:
     2 corsie contro 8, 4800 baud contro 57600. Metterli in una voce sola
     obbligava a scegliere il baud — cioe' a ricordare un numero — per dire una
     cosa che sai benissimo, cioe' quale scatola hai sul tavolo. Ora sono due
     voci, e il baud scende fra le avanzate: si tocca solo per provare.
     Il modello vero lo dice comunque ogni frame (byte 4), e se non e' quello
     che hai scelto l'app lo scrive nel registro invece di correggere in
     silenzio. */
  var BAUD = [
    { v: 4800, label: "4800 (DS 200)" },
    { v: 57600, label: "57600 (DS 300)" },
    { v: 9600, label: "9600 (test)" },
    { v: 19200, label: "19200 (test)" },
    { v: 38400, label: "38400 (test)" },
    { v: 115200, label: "115200 (test)" }
  ];

  /* Tutto quello che le due centraline hanno in comune. Cambiano solo il baud
     e il numero di corsie. */
  var CAPS_DS = {
    slotLabel: "lane",
    lapTime: true,
    /* Quattro: la centralina manda HH:MM:SS.dddd, cioe' diecimillesimi. E'
       l'unico sistema del gruppo che va oltre i centesimi (Ninco manda MMSSCC,
       oXigen centesimi via telemetria). */
    timeDecimals: 4,
    position: false,
    fuel: false,
    pit: false,
    battery: false,
    raceState: true,
    control: false,
    needsUserGesture: true
  };

  function creaDef(id, device, baudDflt, corsie) {
    var d = {
      id: id,
      device: device,          // byte 4 del frame: 0x02 = DS200, 0x03 = DS300
      baudDflt: baudDflt,
      labelKey: "sys." + id,
      descKey: "sys." + id + ".desc",
      bus: "serial",
      optionsHintKey: "sys.ds.baudHint",
      options: [
        { id: "baud", labelKey: "sys.ds.baud", type: "select", dflt: baudDflt,
          advanced: true, values: BAUD }
      ],
      caps: Object.assign({}, CAPS_DS, { slots: corsie }),
      create: function (opts) { return new Ds200Sistema(d, opts); }
    };
    return d;
  }

  var defDs200 = creaDef("ds200", 0x02, 4800, 2);
  var defDs300 = creaDef("ds300", 0x03, 57600, 8);
  SISTEMI.register(defDs200);
  SISTEMI.register(defDs300);
  global.SIS_DS200 = { def: defDs200, defDs300: defDs300, STATO: STATO };
})(typeof window !== "undefined" ? window : globalThis);
