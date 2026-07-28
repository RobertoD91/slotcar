# DS200 → MQTT + Web bridge (ESP32)

Firmware PlatformIO che legge il cronometro DS200/DS300 dalla RS-232, lo arricchisce
con un timestamp NTP, lo pubblica su MQTT ed espone una pagina web live.

## Hardware / cablaggio

La porta del DS200 è **RS-232 vera (±12 V)**: **non** va collegata direttamente ai
pin 3.3 V dell'ESP32, li distruggerebbe. Serve un convertitore di livello
**MAX3232** (o modulo equivalente con DB9).

```
DS200 DB9 TX  ──►  MAX3232 R1IN (lato RS232)
MAX3232 R1OUT (lato TTL)  ──►  ESP32 GPIO16  (UART2 RX)
DS200 DB9 GND ─────────────►  ESP32 GND
MAX3232 VCC  ──►  ESP32 3V3        MAX3232 GND ──► ESP32 GND
```

Il DS200 **trasmette soltanto**, quindi il TX dell'ESP32 (GPIO17) resta libero.
Pin e baud sono configurabili in [`include/config.h`](include/config.h)
(`DS200_RX_PIN`, `DS200_BAUD = 4800`).

## Build & flash

```bash
cd esp32
cp .env.example .env    # poi modifica .env con le TUE credenziali
pio run                 # compila
pio run -t upload       # flash via USB
pio device monitor -b 115200
```

## Flash dal browser (stile Tasmota)

La pagina [`web/esp32-installer/`](../web/esp32-installer/) usa **ESP Web Tools**: colleghi
l'ESP32 via USB, premi il pulsante e installi il firmware **senza toolchain**. A fine
flash il pulsante propone **“Connect to Wi-Fi”** e configura la rete via **Improv-Serial**
(vedi sotto). Serve Chrome/Edge/Opera su `https://` o `http://localhost`.

Il binario unico da flashare (`ds200-esp32-merged.bin`) lo produce la CI (artifact
`ds200-esp32-firmware`) oppure in locale:

```bash
cd esp32 && pio run
BUILD=.pio/build/esp32dev
BOOT=$(find ~/.platformio/packages -name boot_app0.bin | head -n1)
python -m esptool --chip esp32 merge_bin -o ../web/esp32-installer/firmware/ds200-esp32-merged.bin \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x1000 $BUILD/bootloader.bin 0x8000 $BUILD/partitions.bin \
  0xe000 $BOOT 0x10000 $BUILD/firmware.bin
# poi servi la cartella web/ via https o localhost e apri esp32-installer/
```

## Provisioning WiFi: Improv + portale + .env/config.h

Quattro modi, tutti attivi quando il dispositivo non è ancora connesso:

1. **Improv-Serial** (libreria `jnthas/Improv WiFi Library`) — il modo "Tasmota":
   imposti il WiFi dal browser via USB, integrato nell'installer web. Le credenziali
   vengono salvate nella NVS WiFi dell'ESP32 e riusate ai boot successivi.
2. **`.env`** (git-ignored) — credenziali a compile-time, iniettate come `-D` da
   [`scripts/load_env.py`](scripts/load_env.py). Copialo da [`.env.example`](.env.example).
3. **`include/config.h`** — default (NTP, timezone, pin, topic…). Niente segreti qui.
4. **WiFiManager (captive portal, non-bloccante)** — se non si connette entro
   `WIFI_CONNECT_TIMEOUT`, apre l'AP **`DS200-Setup`** (anche per i parametri MQTT),
   restando attivo **insieme** a Improv.

5. **Improv-BLE** — provisioning WiFi **via Bluetooth**, da telefono o PC senza cavo:
   apri [improv-wifi.com](https://www.improv-wifi.com/) (Web Bluetooth) o l'app Home
   Assistant, scegli il dispositivo `ds200` e inserisci la rete. Implementato con
   NimBLE (`src/improv_ble.cpp`). Disattivabile con `ENABLE_IMPROV_BLE 0` in `config.h`
   (riduce la dimensione del firmware).

Per forzare sempre il portale/Improv al primo avvio, lascia `WIFI_SSID` vuoto.

> Nota partizioni: con BLE+WiFi attivi il firmware usa lo schema `huge_app.csv`
> (3 MB app, niente OTA). Senza BLE (`ENABLE_IMPROV_BLE 0`) puoi tornare al layout
> di default rimuovendo `board_build.partitions` da `platformio.ini`.

## NTP / orario

`configTzTime()` con i server in `config.h`. Timezone di default **Europe/Rome**
(`TZ_INFO = "CET-1CEST,M3.5.0,M10.5.0/3"`, con DST). Ogni messaggio MQTT include
sia l'epoch (`ts`) sia l'ISO-8601 locale (`iso`).

## Topic MQTT

Con `MQTT_BASE_TOPIC = "ds200"`:

| Topic | Contenuto |
|---|---|
| `ds200/frame` | JSON di **ogni** frame ricevuto. |
| `ds200/event` | JSON dei soli frame "funzione" (start/pausa/fine gara…). |
| `ds200/lane/N` | Ultimo frame di timing della corsia N (**retained**). |
| `ds200/announce` | Frase pronta da leggere (TTS), es. `Corsia 2, giro 5, 11 secondi e 31`. |
| `ds200/status` | `online` / `offline` (**LWT**, retained). |

Esempio di payload `ds200/frame`:

```json
{
  "ts": 1782604291,
  "iso": "2026-06-27T23:51:31",
  "device": "DS200",
  "data_type": "timing_data",
  "identifier": "fast_lap",
  "lane": 1,
  "laps": 5,
  "time_text": "00:01:23.4567",
  "time_seconds": 83.4567,
  "checksum_ok": true,
  "tx_counter": 1,
  "raw": "E0 01 15 02 00 00 00 1B 00 A9 80 00 05 00 01 23 45 67 31 00 EB"
}
```

## Impostazioni & diagnostica

- **Pagina impostazioni**: `http://ds200.local/config` (link "⚙︎ Impostazioni" in
  fondo alla pagina del dispositivo). È un **menu di configurazione** (stile Tasmota):
  modifichi host/porta/utente/**password** MQTT (mascherata) e base topic e **salvi
  senza riavviare**. Puoi **disattivare MQTT** e attivare la **modalità AP standalone**
  (vedi sotto). Il link *Cambia WiFi* riavvia in modalità setup (portale + Improv).
  `GET /info` restituisce la config in JSON. Il WiFi-portal ora chiede **solo** il WiFi.
- **Modalità AP standalone (senza router)**: spunta *Modalità AP standalone* in
  `/config` e salva → al riavvio l'ESP32 fa da access point (`DS200-Setup`),
  serve la pagina e legge il DS200 **senza rete** (MQTT/NTP disabilitati). Per
  tornare in modalità normale, deseleziona l'opzione da `/config`.
- **Console / webserial**: il flusso grezzo del DS200 è nel riquadro **"Log frame
  (raw)"** in fondo alla home page del dispositivo (`/`). È la "webserial" stile
  Tasmota — i frame arrivano già via WebSocket.
- **OTA (aggiornamento firmware)**: due modi, attivabili con `ENABLE_OTA`.
  - Web: `http://ds200.local/update` (link dalla pagina impostazioni) → carica
    `firmware.bin` (da `esp32/.pio/build/esp32dev/firmware.bin`).
  - Rete (PlatformIO): `pio run -t upload --upload-port ds200.local` (ArduinoOTA).
- **Hex su seriale**: con `ENABLE_SERIAL_HEX` (default on) ogni frame DS200 viene
  stampato come `DS200 RX: E0 01 …` sul monitor seriale (115200). La stessa cosa,
  in stile Tasmota, è visibile **nella pagina web** (riquadro "Log frame (raw)").
- **Password AP sulla seriale**: a ogni avvio il firmware stampa SSID e password
  dell'access point di setup (utile se non li ricordi; chi ha accesso fisico può
  comunque estrarli dal firmware).
- **Improv-BLE non si connette?** Apri il monitor seriale (115200) e guarda i log
  `[ble] …`: a `Improv-BLE advertising as 'ds200'` segue `client connected` /
  `RPC write` quando un client si collega. Se non vedi l'advertising, verifica che
  `ENABLE_IMPROV_BLE` sia 1; se vedi l'advertising ma il telefono non trova il
  dispositivo, usa Chrome/Edge (Web Bluetooth) su https, oppure l'app Home
  Assistant. Dopo una disconnessione il firmware rimette in advertising da solo.

## Voce su Home Assistant (Piper)

Il firmware pubblica una **frase pronta da leggere** su `ds200/announce` (giri
completati + eventi gara, deduplicata). Con Home Assistant la lettura ad alta voce
è immediata: importa [`../homeassistant/ds200_tts.yaml`](../homeassistant/ds200_tts.yaml),
imposta la tua entità TTS **Piper** e il `media_player`, e ricarica le automazioni.
Disattivabile con `ENABLE_ANNOUNCE 0` in `config.h`. La frase è in italiano; per
altre lingue puoi costruirla in HA dal topic `ds200/frame` (esempio nel file YAML).

## Pagina web live

- `http://<ip>/` oppure `http://ds200.local/` (mDNS).
- Stessa esperienza della web app, servita dal dispositivo via WebSocket (`/ws`):
  **multilingua** (IT/EN/ES/FR/DE, menu 🌐), **voce** (Web Speech del browser),
  **cronometro gigante a scorrere**, classifica grande, **vincitore** a fine gara,
  eventi e **log frame raw** (stile webserial). Nessun dato lascia la rete locale.
- `GET /state` snapshot JSON, `GET /info` config JSON.

## Librerie (gestite da PlatformIO)

WiFiManager, PubSubClient, ArduinoJson v7, ESPAsyncWebServer + AsyncTCP. Vedi
[`platformio.ini`](platformio.ini).
