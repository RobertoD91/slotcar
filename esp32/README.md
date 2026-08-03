# DS200 → MQTT + Web bridge (ESP32)

Firmware PlatformIO che legge il cronometro DS200/DS300 dalla RS-232, lo arricchisce
con un timestamp NTP e lo rende disponibile in **quattro** modi contemporaneamente:
MQTT, WebSocket, **Bluetooth (NUS)** e la pagina del **Cronometro web** servita dal
dispositivo, in `http://` e — con un certificato caricato — in `https://`.

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
cd esp32 && pio run && pio run -t buildfs      # ⚠️ ANCHE il filesystem
BUILD=.pio/build/esp32dev
BOOT=$(find ~/.platformio/packages -name boot_app0.bin | head -n1)
python -m esptool --chip esp32 merge_bin -o ../web/esp32-installer/firmware/ds200-esp32-merged.bin \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x1000 $BUILD/bootloader.bin 0x8000 $BUILD/partitions.bin \
  0xe000 $BOOT 0x10000 $BUILD/firmware.bin 0x310000 $BUILD/littlefs.bin
# poi servi la cartella web/ via https o localhost e apri esp32-installer/
```

⚠️ **Il filesystem fa parte dell'immagine.** Le pagine non sono compilate dentro il
firmware: stanno in LittleFS, e ce le mette [`scripts/copy_webapp.py`](scripts/copy_webapp.py)
copiando `web/cronometro/` ad ogni build. Un'immagine senza `littlefs.bin` installa un
ponte che alla radice dice «pagine non caricate» — funziona (i frame escono lo stesso),
ma senza interfaccia. Da riga di comando serve **`pio run -t uploadfs`** dopo l'upload.

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

> Nota partizioni: con BLE+WiFi+TLS attivi il firmware usa lo schema `huge_app.csv`
> (3 MB app, **una sola** area applicativa → nessun aggiornamento via rete, vedi sotto).
> Senza BLE (`ENABLE_IMPROV_BLE 0` e `ENABLE_BLE_NUS 0`) puoi tornare al layout di
> default rimuovendo `board_build.partitions` da `platformio.ini`.

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
- **Aggiornamento firmware: solo via USB.** `huge_app.csv` ha **una sola** area
  applicativa, quindi non esiste uno slot dove scrivere il firmware nuovo mentre gira
  quello vecchio: né il caricamento da browser né ArduinoOTA possono funzionare. La
  pagina `http://ds200.local/update` lo dice **guardando le partizioni vere**
  (`esp_ota_get_next_update_partition()`), invece di offrire un modulo che fallisce
  sempre. Per riavere l'aggiornamento via rete serve una tabella a due slot, che
  toglie spazio all'applicazione (oggi servono BLE + WiFi + TLS): è una scelta, non
  un difetto da correggere di nascosto.
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

- `http://<ip>/` oppure `http://ds200.local/` (mDNS) → rimanda a `/cronometro/`.
- **È il Cronometro web vero**, quello di questo sito, non una copia: lo copia in
  LittleFS [`scripts/copy_webapp.py`](scripts/copy_webapp.py) ad ogni build. Prima
  c'era un `src/web_index.h` incollato a mano che è invecchiato per mesi senza che
  nessuno se ne accorgesse — con la vecchia tavolozza, un suo dizionario a 5 lingue e
  il cronometro che scorreva da solo. Una sorgente sola, e un passo di build.
- Il sistema **«DS200/DS300 senza fili (ponte ESP32)»** si collega da solo alla stessa
  origine della pagina: nessun indirizzo da scrivere.
- `GET /state` snapshot JSON, `GET /info` config JSON (compresi `https`, `ws_clients`,
  `ble_clients`).

## Bluetooth: la centralina senza cavo *e* senza rete

Il ponte pubblica i **21 byte grezzi** del frame su un **Nordic UART Service**
(`6e400001-…`, solo notifiche: il DS200 trasmette e basta). Nel Cronometro si sceglie
il sistema **«DS200/DS300 via Bluetooth»** e si collega, senza wifi e senza indirizzi.

⭐ È l'unico trasporto che funziona **dal sito pubblicato**: una pagina `https://` non
può aprire un `ws://` verso un indirizzo privato (contenuto misto), mentre Web
Bluetooth parla al dispositivo direttamente. In cambio: niente iOS, un client per volta
e una decina di metri. Si disattiva con `ENABLE_BLE_NUS 0`.

## HTTPS con un certificato tuo

Il server è `esp_https_server`, che sta **già nell'SDK**: le stesse rotte girano su due
ascoltatori, `:80` in chiaro e `:443` in TLS. Il TLS parte **solo** se in LittleFS ci
sono `/cert.pem` e `/key.pem`; senza, il ponte lavora in chiaro come prima.

Si caricano da **`http://ds200.local/cert`**, incollando i due PEM.

⚠️ Serve un **nome di dominio**: nessuna autorità firma `192.168.1.50`. Con un
sottodominio che punta all'indirizzo privato (`ds200.tuodominio.it` → 192.168.x.y) il
certificato si ottiene da Let's Encrypt con la verifica **DNS-01**, che non richiede che
il dispositivo sia raggiungibile da internet.

⚠️ La **chiave privata resta in chiaro** in LittleFS: chi ha il dispositivo in mano può
rileggerla via USB. Accettabile per una centralina da pista, non per altro.

## Librerie (gestite da PlatformIO)

WiFiManager, PubSubClient, ArduinoJson v7, NimBLE-Arduino, Improv WiFi. Vedi
[`platformio.ini`](platformio.ini).

⚠️ **Niente ESPAsyncWebServer**: non sa fare TLS, e il ponte deve terminare lui
l'https. Il server ora è `esp_https_server` dell'SDK — nessuna libreria in più,
WebSocket compreso, e il trasporto è un campo di configurazione, così l'elenco delle
rotte esiste una volta sola invece di essere copiato per la porta 443. Il perché
disteso è in cima a [`src/web.cpp`](src/web.cpp).
