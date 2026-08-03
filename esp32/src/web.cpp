/*
 * web.cpp — il server web del ponte DS200/DS300.
 *
 * ============================================================================
 * ⭐ PERCHE' NON C'E' PIU' ESPAsyncWebServer
 * ============================================================================
 *
 * Serviva un server **TLS sul dispositivo**, non un ponte TLS davanti: è la
 * richiesta esplicita dell'utente, e ha ragione — un proxy in mezzo è un'altra
 * scatola da tenere accesa e configurata, e la promessa «apri il sito e ti
 * colleghi» smette di valere appena quella scatola è spenta.
 *
 * ESPAsyncWebServer **non sa fare TLS**, punto: non c'è un'opzione da
 * accendere. Le strade erano due:
 *
 *   a) tenerlo su :80 e affiancargli un secondo server per :443 → due elenchi
 *      di rotte, cioè due copie della stessa pagina che invecchiano in modo
 *      diverso. E' esattamente il difetto che questa repo ha appena finito di
 *      togliersi di torno con `src/web_index.h`;
 *   b) passare a `esp_https_server`, che sta **già dentro l'SDK** (nessuna
 *      libreria nuova: `CONFIG_ESP_HTTPS_SERVER_ENABLE=y` e
 *      `CONFIG_HTTPD_WS_SUPPORT=y` sono attivi nel framework Arduino) e che ha
 *      il trasporto come CAMPO DI CONFIGURAZIONE: lo stesso identico server si
 *      avvia in chiaro o in TLS cambiando `transport_mode`.
 *
 * Quindi (b): `registraRotte()` viene chiamata su **due** ascoltatori — :80 in
 * chiaro e :443 in TLS — e l'elenco delle rotte esiste una volta sola. Sparisce
 * anche una dipendenza (ESPAsyncWebServer + AsyncTCP), il che ci ridà lo spazio
 * che mbedTLS si prende.
 *
 * ⚠️ Onestà su cosa è provato: il ponte ESP32 non è **mai** stato provato su
 * hardware, né prima né ora. Questa non è una riscrittura di codice funzionante
 * in codice non funzionante: è codice non provato che diventa codice non
 * provato con TLS. Resta da provare, ed è scritto nell'elenco delle prove.
 *
 * ============================================================================
 * ⭐ IL CERTIFICATO
 * ============================================================================
 *
 * Un ESP32 su un indirizzo privato non può avere un certificato pubblico per
 * il suo IP — nessuna autorità firma `192.168.1.50`. La strada che funziona, ed
 * è quella dell'utente, è: **un sottodominio vero che punta all'indirizzo
 * privato**. `ds200.iltuodominio.it → 192.168.1.50` si può certificare con
 * Let's Encrypt in DNS-01 (la verifica avviene sul DNS, non sulla porta 80,
 * quindi non serve che il dispositivo sia raggiungibile da internet — e infatti
 * non deve esserlo).
 *
 * Il certificato si carica da `/cert` incollando i due PEM. Finiscono in
 * LittleFS e si rileggono ad ogni avvio. Senza, l'ascoltatore TLS non parte e
 * il ponte lavora in chiaro esattamente come prima: **non si rompe niente se
 * non lo configuri**.
 *
 * ⚠️ Il certificato NON è un segreto, la chiave sì. Sta in chiaro in LittleFS,
 * che chiunque abbia il dispositivo in mano può leggere via USB. E' accettabile
 * per una centralina da pista in casa, non lo sarebbe per altro: sta scritto
 * sulla pagina, perché chi carica una chiave deve sapere dove finisce.
 */
#include "web.h"
#include "config.h"

#include <LittleFS.h>
#include <WiFi.h>
#include <esp_http_server.h>
#include <esp_https_server.h>
#include <esp_ota_ops.h>

namespace {

Web::Ganci G;
bool fsOk = false;
bool avviato = false;

httpd_handle_t hChiaro = nullptr;
httpd_handle_t hTls = nullptr;

/* I PEM restano in heap per tutta la vita del server: esp_tls tiene il
   puntatore, non ne fa una copia. Liberarli dopo `httpd_ssl_start` sembrerebbe
   pulizia e sarebbe un use-after-free. */
char* pemCert = nullptr;
char* pemChiave = nullptr;

const char* PATH_CERT   = "/cert.pem";
const char* PATH_CHIAVE = "/key.pem";

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

// Percorso senza la query: `/app.js?v=1` -> `/app.js`.
String soloPercorso(const char* uri) {
  String p(uri);
  int q = p.indexOf('?');
  return q < 0 ? p : p.substring(0, q);
}

/* Percent-decoding di un corpo `application/x-www-form-urlencoded`. Serve
   perché i PEM viaggiano dentro un <textarea>: gli a capo diventano %0A e i
   caratteri `+ / =` del base64 diventano %2B %2F %3D. */
String sciogli(const String& s) {
  String out;
  out.reserve(s.length());
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '+') { out += ' '; }
    else if (c == '%' && i + 2 < s.length()) {
      auto nib = [](char h) -> int {
        if (h >= '0' && h <= '9') return h - '0';
        if (h >= 'a' && h <= 'f') return h - 'a' + 10;
        if (h >= 'A' && h <= 'F') return h - 'A' + 10;
        return -1;
      };
      int hi = nib(s[i + 1]), lo = nib(s[i + 2]);
      if (hi >= 0 && lo >= 0) { out += (char)((hi << 4) | lo); i += 2; }
      else out += c;
    } else out += c;
  }
  return out;
}

// Legge tutto il corpo della richiesta (limite: `max` byte).
bool leggiCorpo(httpd_req_t* r, String& out, size_t max) {
  out = "";
  if (r->content_len == 0) return true;
  if (r->content_len > max) return false;
  out.reserve(r->content_len + 1);
  char buf[512];
  size_t letti = 0;
  while (letti < r->content_len) {
    int n = httpd_req_recv(r, buf, min(sizeof(buf), r->content_len - letti));
    if (n <= 0) return false;
    for (int i = 0; i < n; i++) out += buf[i];
    letti += n;
  }
  return true;
}

esp_err_t mandaHtml(httpd_req_t* r, const String& h, const char* stato = "200 OK") {
  httpd_resp_set_status(r, stato);
  httpd_resp_set_type(r, "text/html; charset=utf-8");
  return httpd_resp_send(r, h.c_str(), h.length());
}

// Cornice minima delle pagine di servizio: nessuna dipendenza da file esterni,
// perché queste pagine devono funzionare anche quando LittleFS non c'è.
String pagina(const String& corpo) {
  return String("<!doctype html><meta charset=utf-8>"
                "<meta name=viewport content='width=device-width,initial-scale=1'>"
                "<body style='font-family:sans-serif;background:#0b0f17;color:#e6edf6;"
                "max-width:680px;margin:auto;padding:20px;line-height:1.55'>"
                "<style>label{display:block;margin:10px 0 3px;color:#8aa0bd}"
                "input,button,textarea{font-size:15px;padding:8px;border-radius:8px;"
                "border:1px solid #243044;background:#1a2332;color:#e6edf6;width:100%;"
                "box-sizing:border-box}"
                "textarea{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;"
                "min-height:150px;white-space:pre}"
                "button{background:#2ea3ff;border-color:#2ea3ff;color:#04121f;font-weight:700;"
                "cursor:pointer;margin-top:14px}a{color:#2ea3ff}"
                ".row{display:flex;gap:10px;align-items:center;margin-top:12px}"
                ".row input{width:auto}.mut{color:#8aa0bd;font-size:13px}"
                ".warn{background:rgba(224,168,0,.12);border:1px solid #e0a800;border-radius:10px;"
                "padding:10px 13px;font-size:13px}</style>") + corpo + "</body>";
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
struct LavoroWs { httpd_handle_t h; int fd; char* testo; };

void inviaWs(void* arg) {
  LavoroWs* l = (LavoroWs*)arg;
  httpd_ws_frame_t f = {};
  f.type = HTTPD_WS_TYPE_TEXT;
  f.payload = (uint8_t*)l->testo;
  f.len = strlen(l->testo);
  httpd_ws_send_frame_async(l->h, l->fd, &f);
  free(l->testo);
  delete l;
}

/* ⚠️ Non si scrive sul socket dal task di loop: il server ha un task suo e i
   due si pesterebbero i piedi. `httpd_queue_work` fa eseguire l'invio DENTRO
   quel task, che è il modo documentato di mandare qualcosa a un client fuori
   dal giro richiesta/risposta. */
void trasmettiSu(httpd_handle_t h, const char* testo) {
  if (!h) return;
  size_t n = 8;
  int fds[8];
  if (httpd_get_client_list(h, &n, fds) != ESP_OK) return;
  for (size_t i = 0; i < n; i++) {
    if (httpd_ws_get_fd_info(h, fds[i]) != HTTPD_WS_CLIENT_WEBSOCKET) continue;
    LavoroWs* l = new LavoroWs{h, fds[i], strdup(testo)};
    if (!l->testo || httpd_queue_work(h, inviaWs, l) != ESP_OK) { free(l->testo); delete l; }
  }
}

int contaWs(httpd_handle_t h) {
  if (!h) return 0;
  size_t n = 8;
  int fds[8], c = 0;
  if (httpd_get_client_list(h, &n, fds) != ESP_OK) return 0;
  for (size_t i = 0; i < n; i++)
    if (httpd_ws_get_fd_info(h, fds[i]) == HTTPD_WS_CLIENT_WEBSOCKET) c++;
  return c;
}

esp_err_t rottaWs(httpd_req_t* r) {
  /* Apertura: il server ha già risposto all'handshake, e qui si manda lo stato
     corrente — altrimenti chi si collega a gara iniziata parte dal vuoto. */
  if (r->method == HTTP_GET) {
    if (G.statoJson) {
      char buf[1024];
      G.statoJson(buf, sizeof(buf));
      LavoroWs* l = new LavoroWs{r->handle, httpd_req_to_sockfd(r), strdup(buf)};
      if (!l->testo || httpd_queue_work(r->handle, inviaWs, l) != ESP_OK) { free(l->testo); delete l; }
    }
    return ESP_OK;
  }
  // Il browser non ci manda niente: si scarta quello che arriva senza rumore.
  httpd_ws_frame_t f = {};
  uint8_t scarto[64];
  f.payload = scarto;
  httpd_ws_recv_frame(r, &f, sizeof(scarto));
  return ESP_OK;
}

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------
esp_err_t rottaRadice(httpd_req_t* r) {
  if (!fsOk) {
    return mandaHtml(r, pagina(
        "<h2>Pagine non caricate</h2><p>Il firmware c'&egrave;, ma l'immagine LittleFS no. "
        "Dalla cartella <code>esp32/</code>:</p><pre>pio run -t uploadfs</pre>"
        "<p>Il flusso dei frame &egrave; comunque attivo su <code>/ws</code>, "
        "via Bluetooth e su MQTT.</p><p><a href='/config'>Impostazioni</a></p>"));
  }
  httpd_resp_set_status(r, "302 Found");
  httpd_resp_set_hdr(r, "Location", "/cronometro/");
  return httpd_resp_send(r, "", 0);
}

esp_err_t rottaStato(httpd_req_t* r) {
  char buf[1024];
  if (G.statoJson) G.statoJson(buf, sizeof(buf)); else strcpy(buf, "{}");
  httpd_resp_set_type(r, "application/json");
  return httpd_resp_send(r, buf, HTTPD_RESP_USE_STRLEN);
}

esp_err_t rottaInfo(httpd_req_t* r) {
  String j = G.infoJson ? G.infoJson() : String("{}");
  httpd_resp_set_type(r, "application/json");
  return httpd_resp_send(r, j.c_str(), j.length());
}

esp_err_t rottaConfigGet(httpd_req_t* r) {
  // ?do=1 = dimentica il wifi e riavvia in modalità configurazione.
  char q[32];
  if (httpd_req_get_url_query_str(r, q, sizeof(q)) == ESP_OK && strstr(q, "do=1")) {
    mandaHtml(r, pagina("<h3>Riavvio in modalit&agrave; setup&hellip;</h3>"
                        "<p>Collega l'AP <b>" AP_NAME "</b> e apri "
                        "<a href='http://192.168.4.1/'>http://192.168.4.1/</a>.</p>"));
    if (G.dimenticaWifi) G.dimenticaWifi();
    return ESP_OK;
  }
  return mandaHtml(r, G.paginaConfig ? G.paginaConfig() : pagina("<h3>—</h3>"));
}

esp_err_t rottaConfigPost(httpd_req_t* r) {
  String corpo;
  if (!leggiCorpo(r, corpo, 4096))
    return mandaHtml(r, pagina("<h3>Richiesta troppo grande.</h3>"), "413 Payload Too Large");
  bool riavvia = G.salvaConfig ? G.salvaConfig(corpo) : false;
  if (riavvia) {
    mandaHtml(r, pagina("<h3>Salvato. Riavvio&hellip;</h3>"));
    if (G.chiediRiavvio) G.chiediRiavvio();
    return ESP_OK;
  }
  /* 303 e non una pagina con un refresh: così un F5 non rimanda il modulo una
     seconda volta (e non risalva impostazioni che l'utente ha già cambiato). */
  httpd_resp_set_status(r, "303 See Other");
  httpd_resp_set_hdr(r, "Location", "/config");
  return httpd_resp_send(r, "", 0);
}

// ---- certificato ----------------------------------------------------------
String riassuntoPem(const char* path) {
  File f = LittleFS.open(path, "r");
  if (!f) return "assente";
  size_t n = f.size();
  f.close();
  return String(n) + " byte";
}

esp_err_t rottaCertGet(httpd_req_t* r) {
  String h = "<h2>Certificato TLS</h2>";
  h += "<p class=mut>Stato: HTTPS <b>";
  h += hTls ? "attivo sulla porta 443" : "non attivo";
  h += "</b> &middot; certificato: " + riassuntoPem(PATH_CERT) +
       " &middot; chiave: " + riassuntoPem(PATH_CHIAVE) + "</p>";
  h += "<div class=warn><b>Perch&eacute; serve un dominio.</b> Nessuna autorit&agrave; "
       "firma un indirizzo privato: il certificato va emesso per un <b>nome</b> "
       "(es. <code>ds200.iltuodominio.it</code>) che nel DNS punta all'indirizzo di "
       "questo dispositivo. Con Let's Encrypt si ottiene con la verifica <b>DNS-01</b>, "
       "che non richiede che il dispositivo sia raggiungibile da internet.</div>";
  h += "<div class=warn style='margin-top:10px'><b>La chiave privata resta qui in "
       "chiaro</b>, nella memoria interna: chi ha in mano il dispositivo pu&ograve; "
       "rileggerla via USB. Va bene per una centralina da pista, non per altro.</div>";
  h += "<form method='POST' action='/cert'>";
  h += "<label>Certificato &mdash; incolla <code>fullchain.pem</code> "
       "(catena completa: prima il tuo, poi gli intermedi)</label>"
       "<textarea name=cert placeholder='-----BEGIN CERTIFICATE-----'></textarea>";
  h += "<label>Chiave privata &mdash; <code>privkey.pem</code>, "
       "<b>senza password</b></label>"
       /* ⚠️ Il segnaposto contiene l'intestazione di un PEM e lo scanner dei
          segreti lo segnala — giustamente, perché in QUESTO campo si incolla
          davvero una chiave privata. Il marcatore sta a fine riga perché lo
          scanner guarda la riga del match: marcata resta solo questa, quindi
          una chiave d'esempio finita nel codice protesterebbe lo stesso. */
       "<textarea name=key placeholder='-----BEGIN PRIVATE KEY-----'></textarea>";  // allow-secret
  h += "<button type=submit>Salva e riavvia</button></form>";
  h += "<form method='POST' action='/cert' onsubmit=\"return confirm('Cancellare "
       "certificato e chiave? Il dispositivo torner&agrave; in chiaro.')\">"
       "<input type=hidden name=cancella value=1>"
       "<button type=submit style='background:#1a2332;color:#ff6b6b;border-color:#3a2430'>"
       "Cancella certificato</button></form>";
  h += "<p><a href='/config'>&larr; Impostazioni</a></p>";
  return mandaHtml(r, pagina(h));
}

bool scriviFile(const char* path, const String& dati) {
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  size_t n = f.print(dati);
  f.close();
  return n == dati.length();
}

esp_err_t rottaCertPost(httpd_req_t* r) {
  String corpo;
  // Un fullchain + una chiave RSA 2048 stanno abbondantemente sotto i 12 KB,
  // anche con la percent-encoding.
  if (!leggiCorpo(r, corpo, 12288))
    return mandaHtml(r, pagina("<h3>Troppo grande.</h3><p>Il limite &egrave; 12 KB fra "
                               "certificato e chiave.</p><p><a href='/cert'>Torna</a></p>"),
                     "413 Payload Too Large");

  if (Web::campo(corpo, "cancella") == "1") {
    LittleFS.remove(PATH_CERT);
    LittleFS.remove(PATH_CHIAVE);
    mandaHtml(r, pagina("<h3>Cancellato. Riavvio&hellip;</h3>"
                        "<p>Al ritorno il ponte sar&agrave; in chiaro.</p>"));
    if (G.chiediRiavvio) G.chiediRiavvio();
    return ESP_OK;
  }

  String cert = Web::campo(corpo, "cert");
  String key = Web::campo(corpo, "key");
  cert.trim(); key.trim();

  /* Controllo minimo ma non inutile: senza, un incollaggio a metà si scopre solo
     al riavvio, quando l'HTTPS non parte e non si sa perché. Qui il "perché" si
     legge subito. */
  auto pemOk = [](const String& s) {
    return s.startsWith("-----BEGIN") && s.indexOf("-----END") > 0 && s.length() > 200;
  };
  if (!pemOk(cert) || !pemOk(key)) {
    return mandaHtml(r, pagina("<h3>Non sembrano due PEM.</h3><p>Servono <b>entrambi</b> i "
                               "riquadri, ognuno che comincia con <code>-----BEGIN</code> e "
                               "finisce con <code>-----END</code>.</p>"
                               "<p><a href='/cert'>Torna</a></p>"),
                     "400 Bad Request");
  }
  // Il PEM vuole l'a capo finale: senza, mbedTLS rifiuta l'ultima riga.
  if (!cert.endsWith("\n")) cert += "\n";
  if (!key.endsWith("\n")) key += "\n";

  if (!fsOk || !scriviFile(PATH_CERT, cert) || !scriviFile(PATH_CHIAVE, key)) {
    return mandaHtml(r, pagina("<h3>Non sono riuscito a salvare.</h3>"
                               "<p>LittleFS non &egrave; montato o &egrave; pieno.</p>"),
                     "500 Internal Server Error");
  }
  mandaHtml(r, pagina("<h3>Salvato. Riavvio&hellip;</h3><p>Se il certificato &egrave; valido, "
                      "al ritorno risponder&agrave; anche in <b>https</b> sulla porta 443. "
                      "Se non parte, il motivo compare sulla console seriale.</p>"));
  if (G.chiediRiavvio) G.chiediRiavvio();
  return ESP_OK;
}

// ---- aggiornamento firmware ----------------------------------------------
esp_err_t rottaUpdate(httpd_req_t* r) {
  /* ⚠️ Qui non c'è un modulo di caricamento, e non è una dimenticanza: si
     guarda la TABELLA DELLE PARTIZIONI e si dice com'è messa. Con
     `huge_app.csv` c'è **una sola** partizione applicativa, quindi non esiste
     nessuno slot in cui scrivere il firmware nuovo mentre gira quello vecchio:
     l'aggiornamento via rete non può funzionare, per nessuna strada. La pagina
     di prima offriva un modulo che falliva sempre — la solita promessa che non
     si mantiene. Meglio dire la verità, e dirla guardando il dispositivo invece
     che fidandosi di quello che c'è scritto in un file .csv. */
  const esp_partition_t* prossima = esp_ota_get_next_update_partition(nullptr);
  const esp_partition_t* corrente = esp_ota_get_running_partition();
  String h = "<h2>Aggiornamento firmware</h2>";
  h += "<p class=mut>In esecuzione da <code>";
  h += corrente ? corrente->label : "?";
  h += "</code> (";
  h += String(corrente ? corrente->size / 1024 : 0) + " KB).</p>";
  if (!prossima) {
    h += "<div class=warn><b>Da qui non si pu&ograve; aggiornare.</b> Questa tabella "
         "delle partizioni (<code>huge_app.csv</code>) ha una sola area applicativa: "
         "non c'&egrave; un secondo slot dove scrivere il firmware nuovo mentre gira "
         "quello vecchio, quindi <b>nessun</b> aggiornamento via rete pu&ograve; "
         "riuscire &mdash; n&eacute; da questa pagina n&eacute; con ArduinoOTA.</div>"
         "<p>Si aggiorna via USB:</p><pre>pio run -t upload</pre>"
         "<p class=mut>Per riavere l'aggiornamento via rete serve una tabella con due "
         "slot, che toglie spazio all'applicazione (oggi servono BLE + WiFi + TLS): "
         "&egrave; una scelta da fare, non un difetto da correggere di nascosto.</p>";
  } else {
    h += "<div class=warn>C'&egrave; un secondo slot (<code>";
    h += prossima->label;
    h += "</code>), ma il caricamento da browser non &egrave; implementato su questo "
         "server. Usa <code>pio run -t upload</code> via USB oppure ArduinoOTA "
         "(<code>--upload-port " HOSTNAME ".local</code>).</div>";
  }
  h += "<p><a href='/config'>&larr; Impostazioni</a></p>";
  return mandaHtml(r, pagina(h));
}

// ---- file statici ---------------------------------------------------------
const char* tipoDi(const String& p) {
  if (p.endsWith(".html") || p.endsWith("/")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".webmanifest")) return "application/manifest+json";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

esp_err_t rottaStatica(httpd_req_t* r) {
  if (!fsOk) { httpd_resp_send_err(r, HTTPD_404_NOT_FOUND, "LittleFS non montato"); return ESP_FAIL; }

  String p = soloPercorso(r->uri);
  if (p.endsWith("/")) p += "index.html";
  if (!LittleFS.exists(p)) {
    httpd_resp_send_err(r, HTTPD_404_NOT_FOUND, "Non c'e'");
    return ESP_FAIL;
  }
  File f = LittleFS.open(p, "r");
  if (!f || f.isDirectory()) {
    if (f) f.close();
    httpd_resp_send_err(r, HTTPD_404_NOT_FOUND, "Non c'e'");
    return ESP_FAIL;
  }
  httpd_resp_set_type(r, tipoDi(p));
  /* I file sono versionati con `?v=`: si possono tenere in cache a lungo, e su
     un ESP32 conta — la lettura da LittleFS e (soprattutto) la stretta di mano
     TLS costano molto più della rete. */
  if (r->uri && strchr(r->uri, '?')) httpd_resp_set_hdr(r, "Cache-Control", "max-age=604800");

  static uint8_t buf[1024];
  size_t n;
  while ((n = f.read(buf, sizeof(buf))) > 0) {
    if (httpd_resp_send_chunk(r, (const char*)buf, n) != ESP_OK) {
      f.close();
      return ESP_FAIL;
    }
  }
  f.close();
  return httpd_resp_send_chunk(r, nullptr, 0);
}

// ---------------------------------------------------------------------------
// Registrazione — UNA volta, su ogni ascoltatore
// ---------------------------------------------------------------------------
void registraRotte(httpd_handle_t h) {
  auto reg = [&](const char* uri, httpd_method_t m, esp_err_t (*fn)(httpd_req_t*), bool ws = false) {
    httpd_uri_t u = {};
    u.uri = uri;
    u.method = m;
    u.handler = fn;
    u.is_websocket = ws;
    httpd_register_uri_handler(h, &u);
  };

  reg("/", HTTP_GET, rottaRadice);
  reg("/ws", HTTP_GET, rottaWs, true);
  reg("/state", HTTP_GET, rottaStato);
  reg("/info", HTTP_GET, rottaInfo);
  reg("/config", HTTP_GET, rottaConfigGet);
  reg("/config", HTTP_POST, rottaConfigPost);
  reg("/cert", HTTP_GET, rottaCertGet);
  reg("/cert", HTTP_POST, rottaCertPost);
  reg("/update", HTTP_GET, rottaUpdate);

  /* ⚠️ PER ULTIMA, sempre. `/*` cattura QUALUNQUE percorso: registrata prima si
     mangerebbe /state, /info, /config e /ws, e il sintomo sarebbe «le API non
     rispondono più», non «i file non si servono». Il server prova le rotte
     nell'ordine in cui sono state registrate, quindi qui l'ordine È la
     precedenza. (Stessa trappola del vecchio serveStatic.) */
  reg("/*", HTTP_GET, rottaStatica);
}

// Legge un PEM in heap. `len` esce comprensivo dello ZERO finale: esp_tls lo
// pretende per i PEM, ed è l'errore che fa fallire la partenza senza spiegazioni.
char* leggiPem(const char* path, size_t* len) {
  if (!fsOk) return nullptr;
  File f = LittleFS.open(path, "r");
  if (!f) return nullptr;
  size_t n = f.size();
  if (n == 0 || n > 16384) { f.close(); return nullptr; }
  char* buf = (char*)malloc(n + 1);
  if (!buf) { f.close(); return nullptr; }
  size_t letti = f.read((uint8_t*)buf, n);
  f.close();
  buf[letti] = 0;
  *len = letti + 1;
  return buf;
}

void avviaChiaro() {
  httpd_config_t c = HTTPD_DEFAULT_CONFIG();
  c.server_port = 80;
  c.ctrl_port = 32768;
  c.max_uri_handlers = 12;
  c.uri_match_fn = httpd_uri_match_wildcard;
  c.lru_purge_enable = true;
  c.stack_size = 8192;            // le pagine si costruiscono con delle String
  if (httpd_start(&hChiaro, &c) == ESP_OK) {
    registraRotte(hChiaro);
    Serial.println("[web] http sulla porta 80");
  } else {
    hChiaro = nullptr;
    Serial.println("[web] ⚠ http non parte");
  }
}

void avviaTls() {
  size_t nCert = 0, nChiave = 0;
  pemCert = leggiPem(PATH_CERT, &nCert);
  pemChiave = leggiPem(PATH_CHIAVE, &nChiave);
  if (!pemCert || !pemChiave) {
    if (pemCert) { free(pemCert); pemCert = nullptr; }
    if (pemChiave) { free(pemChiave); pemChiave = nullptr; }
    Serial.println("[web] https: nessun certificato caricato (si carica da /cert) — resto in chiaro");
    return;
  }

  httpd_ssl_config_t c = HTTPD_SSL_CONFIG_DEFAULT();
  c.transport_mode = HTTPD_SSL_TRANSPORT_SECURE;
  c.port_secure = 443;
  c.cacert_pem = (const uint8_t*)pemCert;      // ⚠ qui ci va il cert del SERVER
  c.cacert_len = nCert;
  c.prvtkey_pem = (const uint8_t*)pemChiave;
  c.prvtkey_len = nChiave;
  /* Ogni connessione TLS si porta via ~40 KB di heap durante la stretta di mano,
     e qui dentro ci stanno già WiFi e NimBLE. Tre bastano: le richieste sono
     sequenziali (keep-alive), non parallele. */
  c.httpd.max_open_sockets = 3;
  c.httpd.ctrl_port = 32769;                   // ⚠ diverso da quello in chiaro
  c.httpd.max_uri_handlers = 12;
  c.httpd.uri_match_fn = httpd_uri_match_wildcard;
  c.httpd.lru_purge_enable = true;
  c.httpd.stack_size = 12288;                  // mbedTLS mangia stack

  esp_err_t e = httpd_ssl_start(&hTls, &c);
  if (e == ESP_OK) {
    registraRotte(hTls);
    Serial.println("[web] https sulla porta 443 (certificato caricato)");
  } else {
    hTls = nullptr;
    /* Il motivo più comune è un PEM incompleto o una chiave con password. Si
       dice qui, perché dall'altra parte si vedrebbe solo un browser che non si
       collega. */
    Serial.printf("[web] ⚠ https NON parte (%s). Certificato o chiave non validi?\n",
                  esp_err_to_name(e));
    free(pemCert); pemCert = nullptr;
    free(pemChiave); pemChiave = nullptr;
  }
}

}  // namespace

namespace Web {

String cornice(const String& corpo) { return pagina(corpo); }

String campo(const String& corpo, const char* nome) {
  String chiave = String(nome) + "=";
  int i = 0;
  while (i < (int)corpo.length()) {
    int fine = corpo.indexOf('&', i);
    if (fine < 0) fine = corpo.length();
    if (corpo.startsWith(chiave, i))
      return sciogli(corpo.substring(i + chiave.length(), fine));
    i = fine + 1;
  }
  return String();
}

void begin(const Ganci& g, bool fsPronto) {
  if (avviato) return;
  avviato = true;
  G = g;
  fsOk = fsPronto;
  avviaChiaro();
  avviaTls();
}

void trasmetti(const char* testo) {
  trasmettiSu(hChiaro, testo);
  trasmettiSu(hTls, testo);
}

int clientWs() { return contaWs(hChiaro) + contaWs(hTls); }

bool tlsAttivo() { return hTls != nullptr; }

}  // namespace Web
