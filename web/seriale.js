/* seriale.js — la porta USB del dongle oXigen, su computer e su Android.
 *
 * Perché esiste. Il dongle è una seriale USB standard (classe CDC ACM). Su
 * computer Chrome ed Edge la aprono con il Web Serial, attraverso il driver del
 * sistema. Su Android no: il Web Serial c'è solo da Chrome 148 con Android 17, e
 * anche lì le porte USB compaiono soltanto sui telefoni configurati per esporle,
 * cioè quasi mai. Chrome per Android ha però il WebUSB, e con il WebUSB la pagina
 * fa da sé quello che farebbe il driver: prende l'interfaccia dati, imposta la
 * linea (SET_LINE_CODING) e il DTR (SET_CONTROL_LINE_STATE), poi legge e scrive
 * sui due endpoint bulk.
 *
 * La porta WebUSB imita la parte della SerialPort che le pagine usano: open,
 * close, setSignals, getInfo, connected, readable e writable. Così le pagine non
 * hanno due strade: chiedono la porta a `Seriale` e la usano come prima.
 *
 * ⚠️ Vale solo per le seriali CDC, cioè il dongle. Un cavo con un adattatore
 * USB-seriale (FTDI, Prolific, CH340…) parla il protocollo del suo chip, che qui
 * non c'è: per quelli resta il Web Serial.
 *
 * Uso:
 *   Seriale.via                 "serial", "usb" oppure null (nessuna delle due)
 *   await Seriale.richiedi()    la finestra di scelta del browser, poi la porta
 *   await Seriale.concesse()    le porte già concesse (per ritrovare il dongle
 *                               quando ricompare dopo un riavvio)
 *   Seriale.on("connect" | "disconnect", fn(porta))
 */
(function () {
  "use strict";
  var nav = typeof navigator !== "undefined" ? navigator : {};
  var android = /Android/i.test(nav.userAgent || "") ||
    !!(nav.userAgentData && /Android/i.test(nav.userAgentData.platform || ""));

  /* Su Android il WebUSB anche quando il Web Serial esiste: lì il Web Serial
     elenca il dongle solo sui pochi telefoni che espongono le porte. Altrove il
     Web Serial, che passa dal driver del sistema: su Windows il WebUSB non
     potrebbe nemmeno prendere un'interfaccia già in mano al driver seriale. */
  var via = nav.usb && (android || !nav.serial) ? "usb" : (nav.serial ? "serial" : null);

  var CDC_CONTROLLO = 0x02, CDC_DATI = 0x0a;
  var SET_LINE_CODING = 0x20, SET_CONTROL_LINE_STATE = 0x22;
  var PARITA = { none: 0, odd: 1, even: 2 };

  function errore(msg, nome) {
    try { return new DOMException(msg, nome); } catch (e) { return new Error(msg); }
  }

  /* L'interfaccia di controllo (classe 0x02) riceve le richieste di linea;
     quella dati (classe 0x0a) ha un endpoint bulk in ingresso e uno in uscita. */
  function interfacce(conf) {
    var ctrl = null, dati = null;
    conf.interfaces.forEach(function (itf) {
      itf.alternates.forEach(function (alt) {
        if (alt.interfaceClass === CDC_CONTROLLO && ctrl === null) ctrl = itf.interfaceNumber;
        if (alt.interfaceClass !== CDC_DATI || dati) return;
        var dentro = null, fuori = null;
        alt.endpoints.forEach(function (ep) {
          if (ep.type !== "bulk") return;
          if (ep.direction === "in") dentro = ep; else fuori = ep;
        });
        if (dentro && fuori) {
          dati = { num: itf.interfaceNumber, alt: alt.alternateSetting, dentro: dentro, fuori: fuori };
        }
      });
    });
    return { ctrl: ctrl, dati: dati };
  }

  function PortaUsb(device) {
    this.device = device;
    this._collegata = true;
    this._aperta = false;
    this._fatale = false;       // staccata o in errore: niente più flussi fino a una nuova open
    this._r = null;
    this._w = null;
    this._dati = null;
    this._ctrl = null;
    this._ctrlPresa = false;
    this._segnali = { dataTerminalReady: false, requestToSend: false };
  }

  PortaUsb.prototype.getInfo = function () {
    return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId };
  };

  Object.defineProperty(PortaUsb.prototype, "connected", {
    get: function () { return this._collegata; }
  });

  /* Come nel Web Serial: il flusso si ricrea da solo se quello di prima è stato
     annullato, ma resta null a porta chiusa o dopo un errore fatale (dispositivo
     staccato). I cicli di lettura delle pagine contano su questo per fermarsi. */
  Object.defineProperty(PortaUsb.prototype, "readable", {
    get: function () {
      if (this._r) return this._r;
      if (!this._aperta || this._fatale) return null;
      return (this._r = this._lettura());
    }
  });
  Object.defineProperty(PortaUsb.prototype, "writable", {
    get: function () {
      if (this._w) return this._w;
      if (!this._aperta || this._fatale) return null;
      return (this._w = this._scrittura());
    }
  });

  PortaUsb.prototype.open = async function (opz) {
    if (this._aperta) throw errore("La porta è già aperta", "InvalidStateError");
    opz = opz || {};
    var d = this.device;
    if (!d.opened) await d.open();
    if (!d.configuration) await d.selectConfiguration(1);
    var itf = interfacce(d.configuration);
    if (!itf.dati) {
      try { await d.close(); } catch (e) {}
      throw errore("Il dispositivo non è una seriale USB standard (CDC): via WebUSB si apre solo il dongle",
                   "NotSupportedError");
    }
    this._ctrl = itf.ctrl !== null ? itf.ctrl : itf.dati.num;
    this._ctrlPresa = false;
    if (itf.ctrl !== null) {
      /* Se il sistema non la cede, le richieste di linea si provano lo stesso:
         al peggio falliscono loro, e la pagina lo scrive nel registro. */
      try { await d.claimInterface(itf.ctrl); this._ctrlPresa = true; } catch (e) {}
    }
    await d.claimInterface(itf.dati.num);
    if (itf.dati.alt) await d.selectAlternateInterface(itf.dati.num, itf.dati.alt);
    this._dati = itf.dati;
    this._aperta = true;
    this._fatale = false;
    this._segnali = { dataTerminalReady: false, requestToSend: false };

    /* Il baud non conta per il dongle (è una COM virtuale), ma il driver di un
       computer lo imposta comunque: si fa lo stesso, e se non va pazienza. */
    var linea = new DataView(new ArrayBuffer(7));
    linea.setUint32(0, opz.baudRate || 9600, true);
    linea.setUint8(4, opz.stopBits === 2 ? 2 : 0);
    linea.setUint8(5, PARITA[opz.parity] || 0);
    linea.setUint8(6, opz.dataBits || 8);
    try { await this._richiesta(SET_LINE_CODING, 0, linea.buffer); } catch (e) {}
  };

  PortaUsb.prototype._richiesta = async function (richiesta, valore, dati) {
    var setup = { requestType: "class", recipient: "interface", request: richiesta,
                  value: valore, index: this._ctrl };
    var r = dati ? await this.device.controlTransferOut(setup, dati)
                 : await this.device.controlTransferOut(setup);
    if (r.status !== "ok") throw errore("richiesta USB 0x" + richiesta.toString(16) + ": " + r.status, "NetworkError");
  };

  /* Il dongle non legge e non scrive senza DTR: SET_CONTROL_LINE_STATE, bit 0 = DTR,
     bit 1 = RTS. */
  PortaUsb.prototype.setSignals = async function (s) {
    if (!this._aperta) throw errore("La porta è chiusa", "InvalidStateError");
    s = s || {};
    if ("dataTerminalReady" in s) this._segnali.dataTerminalReady = !!s.dataTerminalReady;
    if ("requestToSend" in s) this._segnali.requestToSend = !!s.requestToSend;
    await this._richiesta(SET_CONTROL_LINE_STATE,
      (this._segnali.dataTerminalReady ? 1 : 0) | (this._segnali.requestToSend ? 2 : 0));
  };

  PortaUsb.prototype._lettura = function () {
    var porta = this, d = this.device, ep = this._dati.dentro;
    var quanti = (ep.packetSize || 64) * 4;
    var flusso = new ReadableStream({
      pull: async function (ctl) {
        for (;;) {
          var r;
          try { r = await d.transferIn(ep.endpointNumber, quanti); }
          catch (e) {
            /* Dispositivo staccato o porta chiusa: la lettura finisce e non si
               ricrea. Il ciclo della pagina vede readable === null ed esce. */
            porta._fatale = true;
            if (porta._r === flusso) porta._r = null;
            throw e;
          }
          if (r.status === "stall") {
            try { await d.clearHalt("in", ep.endpointNumber); } catch (e) {}
            continue;
          }
          if (r.data && r.data.byteLength) {
            ctl.enqueue(new Uint8Array(r.data.buffer.slice(r.data.byteOffset,
                                                           r.data.byteOffset + r.data.byteLength)));
            return;
          }
        }
      },
      cancel: function () { if (porta._r === flusso) porta._r = null; }
    });
    return flusso;
  };

  PortaUsb.prototype._scrittura = function () {
    var porta = this, d = this.device, ep = this._dati.fuori;
    var flusso = new WritableStream({
      write: async function (pezzo) {
        var r;
        try { r = await d.transferOut(ep.endpointNumber, pezzo); }
        catch (e) {
          porta._fatale = true;
          if (porta._w === flusso) porta._w = null;
          throw e;
        }
        if (r.status === "stall") {
          try { await d.clearHalt("out", ep.endpointNumber); } catch (e) {}
          throw errore("scrittura USB rifiutata (stall)", "NetworkError");
        }
      },
      close: function () { if (porta._w === flusso) porta._w = null; },
      abort: function () { if (porta._w === flusso) porta._w = null; }
    });
    return flusso;
  };

  PortaUsb.prototype.close = async function () {
    if (!this._aperta) return;
    var r = this._r, w = this._w, d = this.device;
    this._aperta = false;
    this._r = this._w = null;
    try { if (r && !r.locked) await r.cancel(); } catch (e) {}
    try { if (w && !w.locked) await w.abort(); } catch (e) {}
    /* Un driver di sistema abbassa il DTR quando si chiude la porta, e il dongle
       se ne accorge: si fa lo stesso, perché si comporti come su un computer. */
    if (!this._fatale) {
      try { await this._richiesta(SET_CONTROL_LINE_STATE, 0); } catch (e) {}
    }
    try { if (this._dati) await d.releaseInterface(this._dati.num); } catch (e) {}
    try { if (this._ctrlPresa) await d.releaseInterface(this._ctrl); } catch (e) {}
    this._dati = null;
    this._ctrlPresa = false;
    try { if (d.opened) await d.close(); } catch (e) {}
  };

  /* Un oggetto porta per dispositivo, così le pagine possono confrontarle con ===.
     Dopo un riavvio il dongle torna come dispositivo NUOVO, quindi porta nuova:
     è lo stesso comportamento del Web Serial. */
  var porte = new Map();
  function porta(d) {
    var p = porte.get(d);
    if (!p) { p = new PortaUsb(d); porte.set(d, p); }
    return p;
  }

  var ascolti = { connect: [], disconnect: [] };
  function avvisa(evento, p) {
    ascolti[evento].forEach(function (f) { try { f(p); } catch (e) {} });
  }
  try {
    if (via === "usb" && nav.usb.addEventListener) {
      nav.usb.addEventListener("connect", function (e) {
        var p = porta(e.device);
        p._collegata = true;
        avvisa("connect", p);
      });
      nav.usb.addEventListener("disconnect", function (e) {
        var p = porte.get(e.device);
        if (!p) return;
        p._collegata = false;
        p._fatale = true;
        porte.delete(e.device);
        avvisa("disconnect", p);
      });
    } else if (via === "serial" && nav.serial.addEventListener) {
      nav.serial.addEventListener("connect", function (e) { avvisa("connect", e.target); });
      nav.serial.addEventListener("disconnect", function (e) { avvisa("disconnect", e.target); });
    }
  } catch (e) {}

  window.Seriale = {
    via: via,
    android: android,
    /* ⚠️ Nessun filtro, come per il Web Serial: un filtro sul selettore IMPONE il
       dispositivo, e con un VID/PID diverso la finestra esce vuota senza dire
       perché. Le pagine controllano dopo, con getInfo(), e avvisano. */
    richiedi: async function () {
      if (via === "usb") return porta(await nav.usb.requestDevice({ filters: [] }));
      if (via === "serial") return nav.serial.requestPort();
      throw errore("Né Web Serial né WebUSB in questo browser", "NotSupportedError");
    },
    concesse: async function () {
      if (via === "usb") return (await nav.usb.getDevices()).map(porta);
      if (via === "serial") return nav.serial.getPorts();
      return [];
    },
    on: function (evento, fn) { if (ascolti[evento]) ascolti[evento].push(fn); },
    PortaUsb: PortaUsb
  };
})();
