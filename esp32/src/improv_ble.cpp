#include "config.h"

#if ENABLE_IMPROV_BLE

#include "improv_ble.h"
#include <NimBLEDevice.h>
#include <WiFi.h>
#include <vector>

// Improv BLE GATT UUIDs (per the Improv spec). IMPROV_SVC_UUID sta in improv_ble.h.
#define UUID_CURRENT    "00467768-6228-2272-4663-277478268001"  // state, read/notify
#define UUID_ERROR      "00467768-6228-2272-4663-277478268002"  // error, read/notify
#define UUID_RPC        "00467768-6228-2272-4663-277478268003"  // command, write
#define UUID_RPC_RESULT "00467768-6228-2272-4663-277478268004"  // result, read/notify
#define UUID_CAPS       "00467768-6228-2272-4663-277478268005"  // capabilities, read

// State values
#define STATE_AUTHORIZED   0x02
#define STATE_PROVISIONING 0x03
#define STATE_PROVISIONED  0x04
// Error values
#define ERR_NONE           0x00
#define ERR_INVALID_RPC    0x01
#define ERR_UNKNOWN_RPC    0x02
#define ERR_UNABLE_CONNECT 0x03
// RPC command
#define RPC_SEND_WIFI      0x01

namespace {
NimBLECharacteristic* chCurrent = nullptr;
NimBLECharacteristic* chError   = nullptr;
NimBLECharacteristic* chResult  = nullptr;
ImprovBLE::WifiCallback wifiCb   = nullptr;
String gDeviceUrl;

void setState(uint8_t s) { if (chCurrent) { chCurrent->setValue(&s, 1); chCurrent->notify(); } }
void setError(uint8_t e) { if (chError)   { chError->setValue(&e, 1);   chError->notify(); } }

// RPC result packet: [cmd][len][ (len8,bytes)... ][checksum]
void sendWifiResult(const String& url) {
  std::vector<uint8_t> strs;
  strs.push_back((uint8_t)url.length());
  for (size_t i = 0; i < url.length(); i++) strs.push_back((uint8_t)url[i]);

  std::vector<uint8_t> pkt;
  pkt.push_back(RPC_SEND_WIFI);
  pkt.push_back((uint8_t)strs.size());
  for (uint8_t b : strs) pkt.push_back(b);
  uint8_t cks = 0;
  for (uint8_t b : pkt) cks += b;
  pkt.push_back(cks);

  if (chResult) { chResult->setValue(pkt.data(), pkt.size()); chResult->notify(); }
}

// Restart advertising after a client disconnects, so the device stays
// discoverable for the next provisioning attempt.
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*) override { Serial.println("[ble] client connected"); }
  void onDisconnect(NimBLEServer*) override {
    Serial.println("[ble] client disconnected -> re-advertising");
    NimBLEDevice::startAdvertising();
  }
};
ServerCallbacks serverCallbacks;

class RpcCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    NimBLEAttValue val = c->getValue();
    Serial.printf("[ble] RPC write, %u bytes\n", (unsigned)val.length());
    const uint8_t* d = val.data();
    size_t n = val.length();

    if (n < 3) { setError(ERR_INVALID_RPC); return; }
    uint8_t cks = 0;
    for (size_t i = 0; i < n - 1; i++) cks += d[i];
    if (cks != d[n - 1]) { setError(ERR_INVALID_RPC); return; }

    uint8_t cmd = d[0];
    if (cmd != RPC_SEND_WIFI) { setError(ERR_UNKNOWN_RPC); return; }

    // data region: d[2 .. n-2]; format: ssidLen, ssid, passLen, pass
    size_t p = 2;
    if (p >= n - 1) { setError(ERR_INVALID_RPC); return; }
    uint8_t ssidLen = d[p++];
    if (p + ssidLen > n - 1) { setError(ERR_INVALID_RPC); return; }
    String ssid; for (uint8_t i = 0; i < ssidLen; i++) ssid += (char)d[p++];
    if (p >= n - 1) { setError(ERR_INVALID_RPC); return; }
    uint8_t passLen = d[p++];
    if (p + passLen > n - 1) { setError(ERR_INVALID_RPC); return; }
    String pass; for (uint8_t i = 0; i < passLen; i++) pass += (char)d[p++];

    setError(ERR_NONE);
    setState(STATE_PROVISIONING);

    bool ok = wifiCb ? wifiCb(ssid, pass) : false;
    if (ok) {
      setState(STATE_PROVISIONED);
      String url = gDeviceUrl;
      url.replace("{LOCAL_IPV4}", WiFi.localIP().toString());
      sendWifiResult(url);
    } else {
      setError(ERR_UNABLE_CONNECT);
      setState(STATE_AUTHORIZED);
    }
  }
};
RpcCallbacks rpcCallbacks;
}  // namespace

namespace ImprovBLE {

void begin(const char* deviceName, const char* deviceUrl, WifiCallback cb) {
  wifiCb = cb;
  gDeviceUrl = deviceUrl;

  NimBLEDevice::init(deviceName);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);   // max TX power for range
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(&serverCallbacks);
  NimBLEService* svc = server->createService(IMPROV_SVC_UUID);

  NimBLECharacteristic* caps = svc->createCharacteristic(UUID_CAPS, NIMBLE_PROPERTY::READ);
  uint8_t capability = 0x00;  // 0 = no "identify" support
  caps->setValue(&capability, 1);

  chCurrent = svc->createCharacteristic(UUID_CURRENT, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  uint8_t st = STATE_AUTHORIZED; chCurrent->setValue(&st, 1);

  chError = svc->createCharacteristic(UUID_ERROR, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  uint8_t er = ERR_NONE; chError->setValue(&er, 1);

  // Some Improv clients write with response, others without -> allow both.
  NimBLECharacteristic* rpc = svc->createCharacteristic(
      UUID_RPC, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rpc->setCallbacks(&rpcCallbacks);

  chResult = svc->createCharacteristic(UUID_RPC_RESULT, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(IMPROV_SVC_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMaxPreferred(0x12);
  adv->start();
  Serial.printf("[ble] Improv-BLE advertising as '%s' (service %s)\n",
                deviceName, IMPROV_SVC_UUID);
}

void setProvisioned() { setState(STATE_PROVISIONED); }

}  // namespace ImprovBLE

#endif  // ENABLE_IMPROV_BLE
