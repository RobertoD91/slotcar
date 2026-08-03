/* sistemi/ble.js — la centralina DS200/DS300 senza fili, via Bluetooth.
 *
 * ⭐ Come il ponte WiFi, e per la stessa ragione: NON è un protocollo nuovo. Il
 * ponte ESP32 pubblica i 21 byte del frame, così com'è, su un Nordic UART
 * Service (NUS) — lo stesso servizio che i configuratori oXigen di questo sito
 * già usano per parlare ai chip. Qui si rimettono insieme i byte e si dànno
 * allo STESSO decoder del cavo, ereditando da `Ds200Sistema`.
 *
 * ⭐ PERCHÉ ESISTE ANCHE QUESTO, se c'è già il WebSocket. Per una ragione sola,
 * ma pesante: **il contenuto misto**. Una pagina servita da `https://` non può
 * aprire un `ws://` verso un indirizzo di LAN, e un ESP32 non ha un certificato
 * valido per un IP privato. Web Bluetooth invece parla dalla pagina HTTPS
 * direttamente al dispositivo, senza rete, senza router, senza broker e senza
 * certificati. È l'unico trasporto che funziona **dal sito pubblicato**.
 *
 * ⚠️ In cambio: niente iOS (Safari non ha Web Bluetooth), un client per volta e
 * una decina di metri di portata. Il WebSocket copre esattamente quei tre casi.
 * Non sono alternative, sono due strade — e l'ESP32 le espone entrambe insieme.
 *
 * Banda: il DS200 a 4800 baud fa 480 byte al secondo nel caso peggiore, e in
 * pratica parla solo quando succede qualcosa. Il NUS ne regge molti di più.
 */
(function (global) {
  "use strict";

  var SISTEMI = global.SISTEMI;
  if (!SISTEMI) throw new Error("ble.js: serve registry.js caricato prima");
  var BASE = global.SIS_DS200;
  if (!BASE) throw new Error("ble.js: serve sistemi/ds200.js caricato prima");

  /* Nordic UART Service: gli stessi UUID dei configuratori oXigen. TX è la
     caratteristica da cui il dispositivo NOTIFICA (per noi: entra). */
  var NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  var TX  = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  function Esp32BleSistema(def, opts) {
    BASE.Sistema.call(this, def, opts);
    this.dev = null;
    this.tx = null;
    this.voluto = false;
    /* Come sul ponte WiFi: quale centralina ci sia lo dirà il primo frame. */
    this.attesa = null;
    /* Il NUS spezza i dati in pacchetti da ~20 byte, quindi un frame da 21
       arriva quasi sempre in DUE notifiche. Il framer del decoder è fatto
       apposta per questo: si sincronizza sul byte di start e conta. */
    var self = this;
    this.framer = global.DS200.Framer(function (bytes) { self._frame(bytes); });
  }
  Esp32BleSistema.prototype = Object.create(BASE.Sistema.prototype);
  Esp32BleSistema.prototype.constructor = Esp32BleSistema;

  Esp32BleSistema.prototype.connect = async function () {
    if (!global.DS200) throw new Error("decoder DS200 non caricato");
    if (!navigator.bluetooth) throw new Error("Web Bluetooth non disponibile");

    this.setStatus(SISTEMI.STATUS.CONNECTING);
    this.ok = 0; this.tot = 0;
    this.voluto = true;
    this.framer.reset();

    /* ⚠️ Si filtra sul SERVIZIO, non sul nome: il nome del dispositivo lo puoi
       cambiare dalle impostazioni del ponte, il servizio no. Filtrare sul nome
       avrebbe fatto uscire una finestra vuota a chi l'ha rinominato — è la
       stessa trappola di `requestPort({filters})` con la seriale. */
    var dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [NUS] }],
      optionalServices: [NUS]
    });
    this.dev = dev;

    var self = this;
    dev.addEventListener("gattserverdisconnected", function () {
      self.tx = null;
      if (self.voluto) self.setStatus(SISTEMI.STATUS.ERROR, "collegamento caduto");
    });

    var gatt = await dev.gatt.connect();
    var srv = await gatt.getPrimaryService(NUS);
    this.tx = await srv.getCharacteristic(TX);
    this.tx.addEventListener("characteristicvaluechanged", function (e) {
      var v = e.target.value;
      var b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      self.framer.push(b);
    });
    await this.tx.startNotifications();

    this.setStatus(SISTEMI.STATUS.ON, dev.name || "ponte BLE");
  };

  Esp32BleSistema.prototype.disconnect = async function () {
    this.voluto = false;
    try { if (this.tx) await this.tx.stopNotifications(); } catch (e) {}
    try { if (this.dev && this.dev.gatt.connected) this.dev.gatt.disconnect(); } catch (e) {}
    this.tx = null; this.dev = null;
    this.setStatus(SISTEMI.STATUS.OFF, this.ok + "/" + this.tot + " frame validi");
  };

  var def = {
    id: "ble",
    labelKey: "sys.ble",
    descKey: "sys.ble.desc",
    bus: "bluetooth",            // il registro spegne la voce se il browser non ce l'ha
    caps: Object.assign({}, BASE.CAPS, { slots: 8 }),
    create: function (opts) { return new Esp32BleSistema(def, opts); }
  };

  SISTEMI.register(def);
  global.SIS_BLE = { def: def, Sistema: Esp32BleSistema, NUS: NUS, TX: TX };
})(typeof window !== "undefined" ? window : globalThis);
