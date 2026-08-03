/*
 * DS200 / DS300 -> MQTT + Web bridge for ESP32.
 *
 *  - Reads the DS200 timing box on UART2 @ 4800 8N1 (via a MAX3232).
 *  - Parses every 21-byte frame (see ds200.h).
 *  - Stamps each frame with NTP time (epoch + ISO-8601).
 *  - Publishes JSON to MQTT (<base>/frame, /event, /lane/N, /status LWT).
 *  - Serves a live web page (WebSocket) with all DS200 info in real time.
 *
 * WiFi provisioning (all live at once when not yet connected):
 *  - Improv-Serial over USB  -> works with the ESP Web Tools flash page.
 *  - WiFiManager captive portal (non-blocking) -> AP "DS200-Setup".
 *  - config.h defaults / previously stored credentials.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <ImprovWiFiLibrary.h>
#include <time.h>

#include "config.h"
#include "ds200.h"
#include "web.h"
#include <LittleFS.h>
#if ENABLE_IMPROV_BLE
#include "improv_ble.h"
#endif
#if ENABLE_BLE_NUS
#include "nus.h"
#endif
#if ENABLE_OTA
#include <ArduinoOTA.h>
#endif

#define FW_VERSION "1.7.0"

// ---- Runtime configuration (defaults from config.h, overridable in portal) --
struct Config {
  String mqttHost = MQTT_HOST;
  int    mqttPort = MQTT_PORT;
  String mqttUser = MQTT_USER;
  String mqttPass = MQTT_PASS;
  String baseTopic = MQTT_BASE_TOPIC;
  bool   mqttEnabled = true;   // MQTT can be turned off from the settings page
  bool   apMode = false;       // standalone access point (no router)
} cfg;

Preferences prefs;

// ---- Networking objects -----------------------------------------------------
WiFiClient        net;
PubSubClient      mqtt(net);
/* LittleFS porta il Cronometro web (vedi scripts/copy_webapp.py). Se manca —
   firmware caricato ma `uploadfs` no — il ponte funziona lo stesso: i frame
   escono su /ws, via Bluetooth e su MQTT. Si perde solo la pagina, e la radice
   lo dice invece di restituire un 404 muto. */
bool fsPronto = false;
WiFiManager       wm;
ImprovWiFi        improvSerial(&Serial);

// ---- DS200 ------------------------------------------------------------------
ds200::Framer framer;

// ---- Live state (mirrored to web clients on connect) ------------------------
struct LaneState { int laps = 0; char last[16] = ""; char best[16] = ""; double bestSec = -1; bool seen = false; };
LaneState lanes[9];                 // index 1..8
String    raceState = "";
String    deviceName = "";
uint32_t  framesOk = 0, framesTotal = 0;

bool portalActive = false;          // WiFiManager non-blocking portal running
bool webUp = false;                 // HTTP server + mDNS started (STA or AP)
bool servicesUp = false;            // NTP/MQTT started after first STA connect
bool reconfigRequested = false;     // /config?do=1 asked to reboot into setup mode
bool rebootRequested = false;       // deferred reboot (OTA done, AP-mode toggled)

#if ENABLE_ANNOUNCE
int    lastAnnLap[9] = {0};         // per-lane last announced lap (dedupe 3x frames)
String lastAnnEvent;                // last announced race event (dedupe)
#endif

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
bool timeReady() { return time(nullptr) > 1700000000; }
void isoNow(char* out, size_t n) {
  time_t t = time(nullptr);
  struct tm tmv;
  localtime_r(&t, &tmv);
  strftime(out, n, "%Y-%m-%dT%H:%M:%S", &tmv);
}

// ---------------------------------------------------------------------------
// Persisted config
// ---------------------------------------------------------------------------
void loadConfig() {
  prefs.begin("ds200", true);
  cfg.mqttHost  = prefs.getString("mqttHost", MQTT_HOST);
  cfg.mqttPort  = prefs.getInt("mqttPort", MQTT_PORT);
  cfg.mqttUser  = prefs.getString("mqttUser", MQTT_USER);
  cfg.mqttPass  = prefs.getString("mqttPass", MQTT_PASS);
  cfg.baseTopic = prefs.getString("baseTopic", MQTT_BASE_TOPIC);
  cfg.mqttEnabled = prefs.getBool("mqttEn", true);
  cfg.apMode    = prefs.getBool("apMode", false);
  prefs.end();
}
void saveConfig() {
  prefs.begin("ds200", false);
  prefs.putString("mqttHost", cfg.mqttHost);
  prefs.putInt("mqttPort", cfg.mqttPort);
  prefs.putString("mqttUser", cfg.mqttUser);
  prefs.putString("mqttPass", cfg.mqttPass);
  prefs.putString("baseTopic", cfg.baseTopic);
  prefs.putBool("mqttEn", cfg.mqttEnabled);
  prefs.putBool("apMode", cfg.apMode);
  prefs.end();
}

String topic(const String& leaf) { return cfg.baseTopic + "/" + leaf; }

// ---------------------------------------------------------------------------
// Web stack (works in both STA and standalone-AP mode)
// ---------------------------------------------------------------------------
void avviaWeb();   // definita in fondo, dopo i costruttori delle pagine

void startWeb() {
  if (webUp) return;
  webUp = true;
  avviaWeb();                       // prima il server: mDNS annuncia cosa e' partito davvero
  if (MDNS.begin(HOSTNAME)) {
    MDNS.addService("http", "tcp", 80);
    if (Web::tlsAttivo()) MDNS.addService("https", "tcp", 443);
  }
#if ENABLE_OTA
  ArduinoOTA.setHostname(HOSTNAME);
  ArduinoOTA.begin();   // network OTA: pio run -t upload --upload-port ds200.local
#endif
}

// Network services that need an internet/router connection (STA only).
void startServices() {
  if (servicesUp || WiFi.status() != WL_CONNECTED) return;
  servicesUp = true;
#if ENABLE_IMPROV_BLE
  ImprovBLE::setProvisioned();
#endif
  startWeb();
  configTzTime(TZ_INFO, NTP_SERVER_1, NTP_SERVER_2);
  mqtt.setServer(cfg.mqttHost.c_str(), cfg.mqttPort);
  mqtt.setBufferSize(640);
  Serial.printf("[web] http://%s/  (or http://%s.local/)\n",
                WiFi.localIP().toString().c_str(), HOSTNAME);
}

// Standalone access point: works with no router (NTP/MQTT unavailable).
void startAPMode() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_NAME, strlen(AP_PASSWORD) ? AP_PASSWORD : nullptr);
  Serial.println("[ap] ----------------------------------------------------");
  Serial.printf ("[ap] Standalone AP mode (no router):\n");
  Serial.printf ("[ap]   SSID:     %s\n", AP_NAME);
  Serial.printf ("[ap]   Password: %s\n", strlen(AP_PASSWORD) ? AP_PASSWORD : "(open network)");
  Serial.printf ("[ap]   open http://%s/\n", WiFi.softAPIP().toString().c_str());
  Serial.println("[ap] (MQTT/NTP need a router — disabled here.)");
  Serial.println("[ap] ----------------------------------------------------");
  startWeb();
}

// ---------------------------------------------------------------------------
// Improv-Serial callbacks
// ---------------------------------------------------------------------------
void onImprovConnected(const char* ssid, const char* /*password*/) {
  Serial.printf("[improv] connected to '%s' -> %s\n", ssid, WiFi.localIP().toString().c_str());
  if (portalActive) { wm.stopConfigPortal(); portalActive = false; }
  startServices();
}

// ---------------------------------------------------------------------------
// WiFi: try stored/config creds, else bring up Improv + non-blocking portal
// ---------------------------------------------------------------------------
// Connect with explicit credentials (used by Improv-BLE). Blocks briefly.
bool connectWithCreds(const String& ssid, const String& pass) {
  Serial.printf("[wifi] Improv-BLE creds for '%s'\n", ssid.c_str());
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(250);
  bool ok = WiFi.status() == WL_CONNECTED;
  if (ok) {
    if (portalActive) { wm.stopConfigPortal(); portalActive = false; }
    startServices();
  }
  return ok;
}

void startPortal() {
  // WiFi-only portal. MQTT and the rest are configured on /config (no reboot),
  // which also masks the password and saves reliably.
  wm.setConfigPortalBlocking(false);          // non-blocking: pump with wm.process()
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT);

  // autoConnect tries WiFiManager's stored creds first; if none, starts the AP.
  if (wm.autoConnect(AP_NAME, strlen(AP_PASSWORD) ? AP_PASSWORD : nullptr)) {
    startServices();
  } else {
    portalActive = true;
    Serial.println("[wifi] ----------------------------------------------------");
    Serial.printf ("[wifi] Captive portal open. Connect to WiFi AP:\n");
    Serial.printf ("[wifi]   SSID:     %s\n", AP_NAME);
    Serial.printf ("[wifi]   Password: %s\n", strlen(AP_PASSWORD) ? AP_PASSWORD : "(open network)");
    Serial.printf ("[wifi]   then open http://192.168.4.1/\n");
    Serial.println("[wifi] (Improv-Serial and Improv-BLE are also active.)");
    Serial.println("[wifi] ----------------------------------------------------");
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);

  // 1) config.h creds if present, otherwise previously stored creds (Improv etc.)
  if (strlen(WIFI_SSID) > 0) {
    Serial.printf("[wifi] trying config.h SSID '%s'...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  } else {
    Serial.println("[wifi] trying stored credentials...");
    WiFi.begin();
  }
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_CONNECT_TIMEOUT * 1000UL) {
    delay(250); Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected: %s\n", WiFi.localIP().toString().c_str());
    startServices();
  } else {
    Serial.println("[wifi] not connected; opening provisioning (portal + Improv).");
    startPortal();
  }
}

// ---------------------------------------------------------------------------
// MQTT
// ---------------------------------------------------------------------------
void mqttReconnect() {
  if (!cfg.mqttEnabled || cfg.mqttHost.length() == 0) { if (mqtt.connected()) mqtt.disconnect(); return; }
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  static uint32_t lastTry = 0;
  if (millis() - lastTry < 3000) return;
  lastTry = millis();

  String cid = String(HOSTNAME) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  String statusTopic = topic("status");
  mqtt.setServer(cfg.mqttHost.c_str(), cfg.mqttPort);
  mqtt.setBufferSize(640);
  bool ok = mqtt.connect(
      cid.c_str(),
      cfg.mqttUser.length() ? cfg.mqttUser.c_str() : nullptr,
      cfg.mqttPass.length() ? cfg.mqttPass.c_str() : nullptr,
      statusTopic.c_str(), 0, true, "offline");
  if (ok) {
    Serial.println("[mqtt] connected");
    mqtt.publish(statusTopic.c_str(), "online", true);
  } else {
    Serial.printf("[mqtt] failed, rc=%d\n", mqtt.state());
  }
}

// ---------------------------------------------------------------------------
// Frame -> JSON
// ---------------------------------------------------------------------------
size_t buildFrameJson(const ds200::Frame& fr, char* buf, size_t n) {
  JsonDocument doc;
  time_t now = time(nullptr);
  doc["ts"] = (uint32_t)now;
  if (timeReady()) { char iso[24]; isoNow(iso, sizeof(iso)); doc["iso"] = iso; }
  doc["device"]     = fr.device;
  doc["data_type"]  = fr.dataType;
  if (fr.function)      doc["function"] = fr.function;
  if (fr.functionLabel) doc["function_label"] = fr.functionLabel;
  if (fr.identifier)    doc["identifier"] = fr.identifier;
  if (fr.isFastLap)      doc["fast_lap"] = true;
  if (fr.isFirstPosition) doc["first_position"] = true;
  if (fr.lane)          doc["lane"] = fr.lane;
  if (fr.programHi >= 0) { doc["program_hi"] = fr.programHi; doc["program_lo"] = fr.programLo; }
  doc["laps"] = fr.laps;
  if (fr.noTime) doc["no_time"] = true;
  if (fr.timeText[0]) { doc["time_text"] = fr.timeText; doc["time_seconds"] = fr.timeSeconds; }
  doc["checksum_ok"] = fr.checksumOk;
  doc["tx_counter"]  = fr.txCounter;
  doc["raw"]         = fr.rawHex;
  if (fr.warnings[0]) {
    JsonArray w = doc["warnings"].to<JsonArray>();
    char tmp[160]; strncpy(tmp, fr.warnings, sizeof(tmp));
    for (char* tok = strtok(tmp, ";"); tok; tok = strtok(nullptr, ";")) {
      while (*tok == ' ') tok++;
      w.add(tok);
    }
  }
  return serializeJson(doc, buf, n);
}

void buildStateJson(char* buf, size_t n) {
  JsonDocument doc;
  doc["type"]   = "state";
  doc["device"] = deviceName;
  doc["race"]   = raceState;
  doc["ok"]     = framesOk;
  doc["total"]  = framesTotal;
  JsonArray arr = doc["lanes"].to<JsonArray>();
  for (int i = 1; i <= 8; i++) {
    if (!lanes[i].seen) continue;
    JsonObject o = arr.add<JsonObject>();
    o["lane"] = i;
    o["laps"] = lanes[i].laps;
    o["last"] = lanes[i].last;
    o["best"] = lanes[i].best;
    o["bestSec"] = lanes[i].bestSec < 0 ? (double)0 : lanes[i].bestSec;
  }
  serializeJson(doc, buf, n);
}

#if ENABLE_ANNOUNCE
// Italian phrase for a lap time, e.g. "11 secondi e 31" (centiseconds).
String spokenTimeIt(const ds200::Frame& fr) {
  int h = fr.hours < 0 ? 0 : fr.hours;
  int m = fr.minutes < 0 ? 0 : fr.minutes;
  int s = fr.seconds < 0 ? 0 : fr.seconds;
  int cc = (fr.fraction < 0 ? 0 : fr.fraction) / 100;
  String out;
  if (h > 0) out += String(h) + " ore ";
  if (m > 0) out += String(m) + " minuti ";
  char buf[28];
  snprintf(buf, sizeof(buf), "%d secondi e %02d", s, cc);
  out += buf;
  return out;
}

// Publish a ready-to-speak phrase on <base>/announce (for HA + Piper).
// `newBest` = this lap is a genuine new best for the lane (not just the 0xA9
// flag, which marks the lane that currently holds the fast-lap record).
void publishAnnounce(const ds200::Frame& fr, bool newBest) {
  if (!mqtt.connected()) return;

  if (fr.dataType && strcmp(fr.dataType, "function") == 0 && fr.functionLabel) {
    String ev = fr.functionLabel;
    if (ev != lastAnnEvent) {
      lastAnnEvent = ev;
      mqtt.publish(topic("announce").c_str(), ev.c_str());
    }
    if (fr.function && strcmp(fr.function, "start_race_phase_1") == 0) {
      for (int i = 1; i <= 8; i++) lastAnnLap[i] = 0;   // new race -> re-announce laps
    }
  }

  if (fr.lane >= 1 && fr.lane <= 8 && fr.timeText[0] &&
      strcmp(fr.dataType, "timing_data") == 0 && fr.laps != lastAnnLap[fr.lane]) {
    lastAnnLap[fr.lane] = fr.laps;
    String txt = "Corsia " + String(fr.lane) + ", giro " + String(fr.laps) + ", " + spokenTimeIt(fr);
    if (newBest) txt += ", giro veloce";
    mqtt.publish(topic("announce").c_str(), txt.c_str());
  }
}
#endif

// ---------------------------------------------------------------------------
// Handle one parsed frame: update state, publish MQTT, broadcast WS
// ---------------------------------------------------------------------------
void handleFrame(const ds200::Frame& fr, const uint8_t* grezzo) {
#if ENABLE_SERIAL_HEX
  Serial.print("DS200 RX: "); Serial.println(fr.rawHex);
#endif
  framesTotal++;
  if (fr.checksumOk && fr.validStart && fr.validEnd && fr.validLength && fr.warnings[0] == '\0')
    framesOk++;
  deviceName = fr.device;

  if (fr.dataType && strcmp(fr.dataType, "function") == 0 && fr.functionLabel)
    raceState = fr.functionLabel;

  bool newBestLap = false;
  if (fr.lane >= 1 && fr.lane <= 8 &&
      (strcmp(fr.dataType, "timing_data") == 0 || strcmp(fr.dataType, "final_record_data") == 0)) {
    LaneState& s = lanes[fr.lane];
    s.seen = true;
    if (fr.laps >= 0) s.laps = fr.laps;
    if (fr.timeText[0]) {
      strncpy(s.last, fr.timeText, sizeof(s.last));
      bool hadBest = s.bestSec >= 0;
      if (fr.timeSeconds > 0 && (s.bestSec < 0 || fr.timeSeconds < s.bestSec)) {
        strncpy(s.best, fr.timeText, sizeof(s.best));
        s.bestSec = fr.timeSeconds;
        if (hadBest && strcmp(fr.dataType, "timing_data") == 0) newBestLap = true;
      }
    }
  }

  char json[640];
  buildFrameJson(fr, json, sizeof(json));

  if (mqtt.connected()) {
    mqtt.publish(topic("frame").c_str(), json);
    if (fr.dataType && strcmp(fr.dataType, "function") == 0 && fr.function)
      mqtt.publish(topic("event").c_str(), json);
    if (fr.lane >= 1 && fr.lane <= 8) {
      String t = topic("lane/") + String(fr.lane);
      mqtt.publish(t.c_str(), json, true);
    }
  }

#if ENABLE_ANNOUNCE
  publishAnnounce(fr, newBestLap);
#endif

  Web::trasmetti(json);

#if ENABLE_BLE_NUS
  /* ⭐ Via Bluetooth non si manda il JSON: si mandano **i 21 byte com'erano sul
     cavo**. Dall'altra parte li decodifica lo stesso parser del cavo, quindi
     non nasce un secondo formato da tenere allineato — nasce un secondo
     trasporto. (Il WebSocket manda il JSON perché ci mette dentro anche `raw`,
     e il sistema web usa quello: stessa idea, altra confezione.) */
  NusBridge::send(grezzo, ds200::TOTAL_BYTES);
#endif
}

// ---------------------------------------------------------------------------
// Le pagine che dipendono dallo stato — lo stato vive qui, non in web.cpp
// ---------------------------------------------------------------------------
String infoJson() {
  JsonDocument doc;
  doc["version"]   = FW_VERSION;
  doc["hostname"]  = HOSTNAME;
  doc["ip"]        = WiFi.localIP().toString();
  doc["ssid"]      = WiFi.SSID();
  doc["rssi"]      = WiFi.RSSI();
  doc["mqtt_host"] = cfg.mqttHost;
  doc["mqtt_port"] = cfg.mqttPort;
  doc["mqtt_connected"] = mqtt.connected();
  doc["base_topic"] = cfg.baseTopic;
  doc["https"]     = Web::tlsAttivo();
  doc["ws_clients"] = Web::clientWs();
#if ENABLE_BLE_NUS
  doc["ble_clients"] = NusBridge::listeners();
#endif
  String out;
  serializeJson(doc, out);
  return out;
}

String paginaConfig() {
  String mode = cfg.apMode ? String("AP standalone")
                           : ("STA " + WiFi.SSID() + " (" + WiFi.localIP().toString() + ")");
  String h = "<h2>Impostazioni DS200</h2>";
  h += "<p class=mut>v" FW_VERSION " &middot; " + mode + " &middot; MQTT " +
       (mqtt.connected() ? "connesso" : "non connesso") + " &middot; " +
       (Web::tlsAttivo() ? "https attivo" : "solo http") + "</p>";
  h += "<form method='POST' action='/config'>";
  h += "<div class=row><input type=checkbox name=mqtt_en " + String(cfg.mqttEnabled ? "checked" : "") + "><span>MQTT attivo</span></div>";
  h += "<label>MQTT host</label><input name=host value='" + cfg.mqttHost + "'>";
  h += "<label>MQTT port</label><input name=port type=number value='" + String(cfg.mqttPort) + "'>";
  h += "<label>MQTT user</label><input name=user value='" + cfg.mqttUser + "'>";
  h += "<label>MQTT password</label><input name=pass type=password value='" + cfg.mqttPass + "'>";
  h += "<label>Base topic</label><input name=base value='" + cfg.baseTopic + "'>";
  h += "<div class=row><input type=checkbox name=ap_mode " + String(cfg.apMode ? "checked" : "") +
       "><span>Modalit&agrave; AP standalone (nessun router) &mdash; richiede riavvio</span></div>";
  h += "<button type=submit>Salva</button></form>";
  h += "<p style='margin-top:18px'><a href='/cert'>Certificato TLS (https)</a>";
  h += " &middot; <a href='/config?do=1' onclick=\"return confirm('Riavviare in setup per cambiare WiFi?')\">Cambia WiFi (riavvia in setup)</a>";
#if ENABLE_OTA
  h += " &middot; <a href='/update'>Aggiornamento firmware</a>";
#endif
  h += " &middot; <a href='/'>Cronometro / tempi live</a></p>";
  return Web::cornice(h);
}

// Torna true se serve riavviare (solo il cambio di modalità AP lo richiede).
bool salvaConfigDa(const String& corpo) {
  bool wasAp = cfg.apMode;
  /* ⚠️ Una casella non spuntata NON viene inviata dal browser: la sua assenza è
     il valore «no». Cercare `mqtt_en=0` non troverebbe mai niente e le caselle
     non si spegnerebbero più. */
  cfg.mqttEnabled = corpo.indexOf("mqtt_en=") >= 0;
  cfg.apMode      = corpo.indexOf("ap_mode=") >= 0;
  /* I campi di testo il browser li manda SEMPRE, anche vuoti: si assegnano
     senza guardie, così svuotarne uno lo svuota davvero. La porta no: vuota
     diventerebbe 0, e uno zero non è una scelta, è un modulo compilato male. */
  cfg.mqttHost  = Web::campo(corpo, "host");
  cfg.mqttUser  = Web::campo(corpo, "user");
  cfg.mqttPass  = Web::campo(corpo, "pass");
  cfg.baseTopic = Web::campo(corpo, "base");
  int porta = Web::campo(corpo, "port").toInt();
  if (porta > 0 && porta < 65536) cfg.mqttPort = porta;
  saveConfig();
  if (cfg.apMode != wasAp) return true;
  if (mqtt.connected()) mqtt.disconnect();     // si riconnette con le nuove impostazioni
  mqtt.setServer(cfg.mqttHost.c_str(), cfg.mqttPort);
  return false;
}

void avviaWeb() {
  Web::Ganci g;
  g.statoJson     = buildStateJson;
  g.infoJson      = infoJson;
  g.paginaConfig  = paginaConfig;
  g.salvaConfig   = salvaConfigDa;
  g.chiediRiavvio = []() { rebootRequested = true; };
  g.dimenticaWifi = []() { reconfigRequested = true; };
  Web::begin(g, fsPronto);
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[DS200] booting v" FW_VERSION);
  Serial.printf("[setup] Setup AP (when unconfigured) -> SSID '%s'  password '%s'\n",
                AP_NAME, strlen(AP_PASSWORD) ? AP_PASSWORD : "(open network)");

  Serial2.begin(DS200_BAUD, SERIAL_8N1, DS200_RX_PIN, DS200_TX_PIN);

  loadConfig();

  /* Le pagine stanno in LittleFS. Se il montaggio fallisce non ci si ferma: il
     mestiere di questo firmware e' portare i frame dalla seriale alla rete, e
     quello funziona anche senza pagine. */
  fsPronto = LittleFS.begin(true);
  Serial.printf("[fs] LittleFS %s\n", fsPronto ? "montato" : "NON montato (manca `pio run -t uploadfs`?)");

  // Improv-Serial: lets the ESP Web Tools flash page provision WiFi over USB.
  improvSerial.setDeviceInfo(ImprovTypes::ChipFamily::CF_ESP32,
                             "DS200 Bridge", FW_VERSION, HOSTNAME, "http://{LOCAL_IPV4}/");
  improvSerial.onImprovConnected(onImprovConnected);

#if ENABLE_IMPROV_BLE
  // Improv-BLE: provision WiFi from a phone (improv-wifi.com / Home Assistant).
  ImprovBLE::begin(HOSTNAME, "http://{LOCAL_IPV4}/", connectWithCreds);
#endif
#if ENABLE_BLE_NUS
  /* Dopo Improv, che e' chi inizializza NimBLE: qui si aggiunge il secondo
     servizio e si rifa' l'annuncio per nominarli tutti e due. */
  NusBridge::begin(HOSTNAME);
#endif

  // Le pagine e le rotte le tiene web.cpp: un elenco solo, registrato su TUTTI
  // gli ascoltatori (:80 in chiaro e :443 in TLS). Qui si passano solo i ganci
  // verso lo stato, che vive qui.

  if (cfg.apMode) startAPMode();    // standalone, no router
  else connectWiFi();
}

void loop() {
  if (reconfigRequested) {            // /config?do=1 -> forget WiFi, reboot to setup
    delay(250);
    wm.resetSettings();
    ESP.restart();
  }
  if (rebootRequested) { delay(400); ESP.restart(); }

  improvSerial.handleSerial();        // USB provisioning, always responsive

  if (cfg.apMode) {                   // standalone AP: web only, no STA/MQTT/NTP
#if ENABLE_OTA
    ArduinoOTA.handle();
#endif
  } else {
    if (portalActive) wm.process();   // captive-portal pump
    if (WiFi.status() == WL_CONNECTED) {
      if (!servicesUp) startServices();
      if (portalActive) { wm.stopConfigPortal(); portalActive = false; }
#if ENABLE_OTA
      ArduinoOTA.handle();
#endif
      mqttReconnect();
      mqtt.loop();
    }
  }

  // Drain UART2 -> framer -> handleFrame (works even before WiFi is up)
  uint8_t out[ds200::TOTAL_BYTES];
  while (Serial2.available()) {
    uint8_t b = (uint8_t)Serial2.read();
    if (framer.push(b, out)) {
      ds200::Frame fr;
      ds200::parse(out, fr);
      handleFrame(fr, out);
    }
  }
}
