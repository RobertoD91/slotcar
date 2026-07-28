#pragma once
/*
 * ===========================================================================
 *  NORMALLY YOU DON'T EDIT THIS FILE — edit  esp32/.env  instead.
 *  These are only FALLBACK DEFAULTS so the project still compiles without a
 *  .env (e.g. in CI). Anything you set in .env overrides the matching value
 *  here at build time (see scripts/load_env.py). Two files exist on purpose:
 *  defaults must live somewhere for the build, .env is your override.
 * ===========================================================================
 *
 * config.h — compile-time DEFAULTS for the DS200 ESP32 bridge.
 *
 * Precedence (highest first):
 *   1. .env file           -> injected as -D build flags by scripts/load_env.py
 *   2. WiFiManager portal  -> runtime, persisted to NVS (Preferences)
 *   3. these defaults
 *
 * Every macro below is wrapped in #ifndef, so anything defined in .env (or any
 * other -D flag) wins. Secrets therefore live in .env, NOT in this file — see
 * .env.example. Leave WIFI_SSID empty to force the captive portal on first boot.
 */

// ---- WiFi (leave SSID empty "" to force the captive portal on first boot) ---
#ifndef WIFI_SSID
#define WIFI_SSID            ""
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD        ""
#endif

// ---- MQTT broker ------------------------------------------------------------
#ifndef MQTT_HOST
#define MQTT_HOST            "192.168.1.10"
#endif
#ifndef MQTT_PORT
#define MQTT_PORT            1883
#endif
#ifndef MQTT_USER
#define MQTT_USER            ""            // empty = anonymous
#endif
#ifndef MQTT_PASS
#define MQTT_PASS            ""
#endif
#ifndef MQTT_BASE_TOPIC
#define MQTT_BASE_TOPIC      "ds200"       // topics: <base>/frame, /event, /lane/N, /status
#endif

// ---- NTP / time -------------------------------------------------------------
#ifndef NTP_SERVER_1
#define NTP_SERVER_1         "pool.ntp.org"
#endif
#ifndef NTP_SERVER_2
#define NTP_SERVER_2         "time.google.com"
#endif
// POSIX TZ string. Default = Europe/Rome (CET/CEST with DST rules).
#ifndef TZ_INFO
#define TZ_INFO              "CET-1CEST,M3.5.0,M10.5.0/3"
#endif

// ---- DS200 serial link ------------------------------------------------------
#ifndef DS200_BAUD
#define DS200_BAUD           4800          // correct rate for DS200/DS300
#endif
#ifndef DS200_RX_PIN
#define DS200_RX_PIN         16            // ESP32 UART2 RX  (from MAX3232 TTL out)
#endif
#ifndef DS200_TX_PIN
#define DS200_TX_PIN         17            // unused (DS200 only transmits)
#endif

// ---- Device / portal --------------------------------------------------------
#ifndef AP_NAME
#define AP_NAME              "DS200-Setup" // captive-portal SSID when unconfigured
#endif
#ifndef AP_PASSWORD
#define AP_PASSWORD          "ds200setup"  // >= 8 chars, or "" for an open AP
#endif
#ifndef HOSTNAME
#define HOSTNAME             "ds200"       // mDNS -> http://ds200.local
#endif
#ifndef WIFI_CONNECT_TIMEOUT
#define WIFI_CONNECT_TIMEOUT 20            // seconds to try saved WiFi before portal
#endif
#ifndef PORTAL_TIMEOUT
#define PORTAL_TIMEOUT       180           // seconds the config portal stays open
#endif

// ---- Provisioning extras ----------------------------------------------------
// Improv over BLE (set WiFi from a phone via improv-wifi.com / Home Assistant).
// Set to 0 to drop BLE entirely (smaller firmware). Improv-Serial is always on.
#ifndef ENABLE_IMPROV_BLE
#define ENABLE_IMPROV_BLE    1
#endif

// Publish a ready-to-speak phrase on <base>/announce for Home Assistant + Piper
// TTS (see homeassistant/ds200_tts.yaml). Set to 0 to disable.
#ifndef ENABLE_ANNOUNCE
#define ENABLE_ANNOUNCE      1
#endif

// Print every raw DS200 frame as hex on the USB serial console. Handy for
// debugging; harmless for Improv (it only reacts to its own packets).
#ifndef ENABLE_SERIAL_HEX
#define ENABLE_SERIAL_HEX    1
#endif

// Over-the-air updates: web uploader at /update and ArduinoOTA (pio espota).
#ifndef ENABLE_OTA
#define ENABLE_OTA           1
#endif
