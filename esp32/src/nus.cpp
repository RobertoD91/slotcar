#include "config.h"

#if ENABLE_BLE_NUS

#include "nus.h"
#include <NimBLEDevice.h>
#if ENABLE_IMPROV_BLE
#include "improv_ble.h"   // per IMPROV_SVC_UUID, che va nella risposta alla scansione
#endif

/*
 * ⭐ COS'E' E PERCHE' ESISTE
 *
 * Il ponte manda gli stessi 21 byte che la centralina mette sul cavo, così
 * com'è, dentro un Nordic UART Service (NUS) — lo stesso servizio che i
 * configuratori oXigen di questo sito già usano per parlare ai chip. Dall'altra
 * parte, `web/cronometro/sistemi/ble.js` li rimette insieme e li dà allo STESSO
 * decoder del cavo. Non c'è un secondo formato: c'è un secondo TRASPORTO.
 *
 * ⭐ PERCHE' ANCHE QUESTO, se c'è già il WebSocket: **il contenuto misto**. Una
 * pagina servita da https://robertodisanto.it/slotcar/ non può aprire un
 * `ws://192.168.x.y/`; il browser lo blocca e non c'è modo di convincerlo. Web
 * Bluetooth invece parla dalla pagina HTTPS direttamente al dispositivo: niente
 * rete, niente router, niente certificato. È l'unica strada che funziona dal
 * sito pubblicato senza configurare nulla.
 * In cambio: niente iOS (Safari non ha Web Bluetooth), un client per volta e una
 * decina di metri. Il WebSocket copre esattamente quei tre casi — per questo il
 * ponte li espone tutti e due insieme e non si sceglie in fase di build.
 *
 * ⚠️ SOLO TX (dispositivo → browser). Un NUS "completo" avrebbe anche la
 * caratteristica RX per scrivere verso la seriale, ma il DS200 **trasmette e
 * basta**: non esiste un comando documentato host→centralina. Esporre una RX
 * che non porta da nessuna parte sarebbe la solita promessa che non si mantiene
 * (vedi la regola dei pulsanti attivi in CLAUDE.md). Se un giorno si scoprisse
 * un comando vero, si aggiunge qui insieme al pin TX, che oggi è inutilizzato.
 *
 * ⚠️ MTU. Con l'MTU predefinito (23) restano 20 byte utili per notifica, quindi
 * un frame da 21 viaggia SEMPRE spezzato in due. Qui si chiede un MTU più
 * grande, ma non ci si conta: il framer del decoder si sincronizza sul byte di
 * start e conta, quindi regge entrambi i casi. La prova in
 * `tools/test-cronometro.js` li spezza apposta 20+1.
 */
namespace {

// Nordic UART Service: gli stessi UUID dei configuratori oXigen.
const char* NUS_SVC = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const char* NUS_TX  = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

NimBLECharacteristic* chTx = nullptr;

}  // namespace

namespace NusBridge {

void begin(const char* deviceName) {
  // Se Improv-BLE è spento, NimBLE non l'ha inizializzato nessuno.
  if (!NimBLEDevice::getInitialized()) {
    NimBLEDevice::init(deviceName);
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  }
  // Un frame intero in una notifica sola quando il client sta al gioco.
  NimBLEDevice::setMTU(128);

  // createServer() è idempotente: se Improv l'ha già creato, torna quello.
  NimBLEServer* server = NimBLEDevice::createServer();
  NimBLEService* svc = server->createService(NUS_SVC);
  chTx = svc->createCharacteristic(NUS_TX, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  svc->start();

  /* ⚠️ L'annuncio BLE ha 31 byte in tutto, e un UUID a 128 bit ne mangia 18:
     DUE non ci stanno. Quindi il NUS va nel pacchetto principale (è quello che
     si usa ad ogni gara) e Improv nella risposta alla scansione (serve una
     volta sola, quando si configura il wifi). Chrome e i client Improv leggono
     entrambi i pacchetti, quindi si trovano lo stesso — ma se un domani si
     aggiunge un terzo servizio, non ci starà: va deciso chi esce. */
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->stop();
  adv->reset();

  NimBLEAdvertisementData ann;
  ann.setFlags(0x06);                       // LE General Discoverable, no BR/EDR
  ann.setCompleteServices(NimBLEUUID(NUS_SVC));
  adv->setAdvertisementData(ann);

  NimBLEAdvertisementData risp;
  risp.setName(deviceName);
#if ENABLE_IMPROV_BLE
  risp.setCompleteServices(NimBLEUUID(IMPROV_SVC_UUID));
#endif
  adv->setScanResponseData(risp);

  adv->start();
  Serial.printf("[ble] NUS attivo su '%s' (servizio %s)\n", deviceName, NUS_SVC);
}

void send(const uint8_t* data, size_t n) {
  if (!chTx || chTx->getSubscribedCount() == 0) return;
  chTx->setValue(data, n);
  chTx->notify();
}

int listeners() { return chTx ? (int)chTx->getSubscribedCount() : 0; }

}  // namespace NusBridge

#endif  // ENABLE_BLE_NUS
