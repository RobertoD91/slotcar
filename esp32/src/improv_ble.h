#pragma once
/*
 * improv_ble.h — minimal Improv-over-BLE provisioning for ESP32 (NimBLE).
 *
 * Implements the Improv BLE spec (https://www.improv-wifi.com/ble/) so a phone
 * or the improv-wifi.com web app can set the WiFi credentials over Bluetooth.
 * Improv-Serial (USB) is handled separately by the jnthas library in main.cpp.
 */
#include <Arduino.h>

namespace ImprovBLE {

// Called when the client sends WiFi credentials. Return true if connected.
typedef bool (*WifiCallback)(const String& ssid, const String& password);

// Start BLE advertising the Improv service. `deviceUrl` may contain the
// placeholder "{LOCAL_IPV4}" which is filled in with the device IP on success.
void begin(const char* deviceName, const char* deviceUrl, WifiCallback cb);

// Mark the device as already provisioned (e.g. connected via another path).
void setProvisioned();

}  // namespace ImprovBLE
