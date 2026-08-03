#pragma once
/*
 * web.h — il server web del ponte: HTTP in chiaro e HTTPS, stesse pagine.
 *
 * Vedi web.cpp per il perché di questa scelta. In breve: un solo elenco di
 * rotte registrato su DUE ascoltatori, così non esistono due versioni della
 * stessa pagina da tenere allineate.
 */
#include <Arduino.h>
#include <stddef.h>

namespace Web {

// Callback che il firmware fornisce per le pagine che leggono/scrivono stato.
// Stanno qui e non dentro web.cpp perché lo stato vive in main.cpp: il server
// non deve conoscere né MQTT né la centralina, solo come chiedere.
struct Ganci {
  void (*statoJson)(char* buf, size_t n) = nullptr;   // -> /state e all'apertura del WS
  String (*infoJson)() = nullptr;                     // -> /info
  String (*paginaConfig)() = nullptr;                 // -> /config (GET)
  // Riceve i campi già decodificati; torna true se serve riavviare.
  bool (*salvaConfig)(const String& corpo) = nullptr;  // -> /config (POST)
  void (*chiediRiavvio)() = nullptr;
  void (*dimenticaWifi)() = nullptr;
};

// Avvia gli ascoltatori. `fsPronto` dice se LittleFS è montato (senza, niente
// pagine: restano le API e il WebSocket). Idempotente.
void begin(const Ganci& g, bool fsPronto);

// Manda una riga di testo a tutti i client WebSocket, su entrambi gli ascoltatori.
void trasmetti(const char* testo);

// Quanti client WebSocket ci sono adesso.
int clientWs();

// true se l'ascoltatore TLS è partito (certificato presente e valido).
bool tlsAttivo();

// Estrae un campo da un corpo `a=b&c=d` con la percent-encoding sciolta.
// Esposta perché la usa anche main.cpp per il salvataggio delle impostazioni.
String campo(const String& corpo, const char* nome);

// Cornice comune delle pagine di servizio (/config, /cert, /update). Esposta
// perché la pagina delle impostazioni la costruisce main.cpp, che è dove vive
// lo stato: senza, quella pagina avrebbe un aspetto suo — e le pagine di
// servizio sono già la parte del sito che nessuno guarda mai due volte.
String cornice(const String& corpo);

}  // namespace Web
