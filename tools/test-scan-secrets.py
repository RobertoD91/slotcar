#!/usr/bin/env python3
"""Test delle regole di scan-secrets.py — nessun file, nessun hardware, un secondo.

Le stringhe qui sotto sono FINTE ma hanno la forma di segreti veri, quindi ognuna
porta il marcatore  allow-secret  altrimenti lo scanner segnalerebbe questo stesso
file. Se aggiungi una regola, aggiungi qui un caso che deve scattare e uno che non
deve: e' il modo piu' rapido per accorgersi che una regex e' troppo larga.
"""
import os
import sys

# scan-secrets.py ha un trattino nel nome, quindi non e' importabile con "import":
# va caricato a mano dal percorso.
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "scan_secrets", os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan-secrets.py"))
scan = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scan)

# (testo, deve_scattare, cosa_stiamo_verificando)
CASES = [
    # --- devono SCATTARE -----------------------------------------------------
    ('WIFI_PASSWORD=SuperSegreta123', True, "password WiFi in un .env"),          # allow-secret
    ('#define WIFI_PASSWORD "SuperSegreta123"', True, "password in un #define"),  # allow-secret
    ('MQTT_PASS=hunter2hunter', True, "password MQTT"),                           # allow-secret
    ('api_key: "abcd1234efgh5678"', True, "api key in yaml"),                     # allow-secret
    ('client_secret = "9f8e7d6c5b4a3210"', True, "client secret"),                # allow-secret
    ('MAC del mio dongle: A7:B9:F3:0B:81:E7', True, "indirizzo MAC"),             # allow-secret
    ('addr = "e2:ff:e4:7b:52:5d"', True, "MAC minuscolo"),                        # allow-secret
    ('-----BEGIN RSA PRIVATE KEY-----', True, "chiave privata"),                  # allow-secret
    ('AKIAIOSFODNN7EXAMPLE', True, "AWS access key"),                             # allow-secret
    ('token = ghp_0123456789abcdefghijklmnopqrstuvwxyz', True, "token GitHub"),   # allow-secret
    ('https://utente:segreto@example.com/repo.git', True, "URL con credenziali"), # allow-secret
    ('AIzaSyA1234567890abcdefghijklmnopqrstuv', True, "Google API key"),         # allow-secret

    # --- NON devono scattare (falsi allarmi che avevo davvero) ---------------
    ('  String mqttPass = MQTT_PASS;', False, "valore = nome di macro"),
    ('cfg.mqttPass = prefs.getString("mqttPass", MQTT_PASS);', False, "chiamata di funzione"),
    ('WiFi.softAP(AP_NAME, strlen(AP_PASSWORD) ? AP_PASSWORD : nullptr);', False, "nullptr"),
    ('#define WIFI_PASSWORD        ""', False, "default vuoto"),
    ('WIFI_PASSWORD=', False, "campo vuoto nell'esempio"),
    ('password: your_password_here', False, "placeholder"),
    ('# la password si mette nel file .env, mai qui', False, "prosa"),
    ('const pass = process.env.SECRET;', False, "letto dall'ambiente"),
    ('E0 01 15 02 00 00 00 00 A1 00 00 00 00 00 00 00 00 00 xx 00 EB', False,
     "frame esadecimale DS200, non un MAC"),
    ('"status.connected": "Connesso @ {baud} baud"', False, "stringa i18n"),
]


def main():
    rules = [(n, __import__("re").compile(p), d) for n, p, d in scan.RULES]
    allow = scan.build_allow()
    bad = 0

    for text, should_hit, what in CASES:
        found = []
        scan.scan_text("test", text, rules, allow, found)
        hit = bool(found)
        if hit != should_hit:
            bad += 1
            print("  ❌ %-38s atteso=%s ottenuto=%s   | %s"
                  % (what, "scatta" if should_hit else "silenzio",
                     "scatta" if hit else "silenzio", text[:52]))
        else:
            print("  ✅ %-38s %s" % (what, "scatta" if hit else "silenzio"))

    print("\n%d casi, %d sbagliati" % (len(CASES), bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
