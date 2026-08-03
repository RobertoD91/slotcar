#pragma once
/*
 * nus.h — il ponte pubblica i frame DS200/DS300 grezzi via Bluetooth LE.
 *
 * Vedi nus.cpp per il perché. In due righe: è l'unico trasporto che funziona
 * dal sito pubblicato in HTTPS senza certificati e senza rete.
 */
#include "config.h"

#if ENABLE_BLE_NUS

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

namespace NusBridge {

// Crea il servizio e (ri)configura l'annuncio BLE. Va chiamata DOPO
// ImprovBLE::begin(), che è chi inizializza NimBLE: qui si aggiunge un secondo
// servizio allo stesso server e si rifà l'annuncio per nominarli entrambi.
void begin(const char* deviceName);

// Manda i byte di un frame ai client collegati. Senza client non fa niente.
void send(const uint8_t* data, size_t n);

// Quanti client stanno ascoltando (per la pagina /info e il log).
int listeners();

}  // namespace NusBridge

#endif  // ENABLE_BLE_NUS
