#!/usr/bin/env python3
"""Riapplica le modifiche LOCALI di questa repo ai file copiati da monte.

Restano copiati da un'altra repo solo il contagiri DS200/DS300 (`web/ds200/`) e il
firmware `esp32/`. Le app oXigen NON sono piu' copie: vivono qui e si modificano
direttamente, quindi non hanno piu' nessuna patch.

Le patch servono perche' qui i file stanno in posti diversi rispetto alla repo di
origine (l'app DS200 passa da `webapp/` a `web/ds200/`, e `esp32/` sta fuori da
`web/` perche' non va pubblicato), piu' qualche ritocco d'interfaccia.

Ogni patch e' IDEMPOTENTE: se e' gia' applicata non fa nulla. Se invece non trova
il testo a cui agganciarsi esce con errore, cosi' un cambiamento a monte che
rompe la patch si vede subito invece di passare inosservato.

Uso:  ./tools/apply-local-patches.py [--check]
      --check  non scrive niente, dice solo cosa manca (exit 1 se manca qualcosa)
"""

import argparse
import io
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
WEB = os.path.join(ROOT, "web")

# (file, testo_da_sostituire, testo_nuovo, etichetta)
PATCHES = []

# 1. Link di ritorno dentro l'app DS200: di suo non sa di stare in un indice.
PATCHES += [
    (os.path.join(WEB, "ds200", "index.html"),
     '<span><a href="flash.html">⚡ Flash ESP32</a>',
     '<span><a href="../">← Slot Car Web Tools</a> · <a href="flash.html">⚡ Flash ESP32</a>',
     "back-link ds200/index.html"),
    (os.path.join(WEB, "ds200", "flash.html"),
     '<div class="conn"><a class="btn" href="index.html">↩ Torna all\'app</a></div>',
     '<div class="conn"><a class="btn" href="../">← Slot Car Web Tools</a> '
     '<a class="btn" href="index.html">↩ Torna all\'app</a></div>',
     "back-link ds200/flash.html"),

    # A monte webapp/ ed esp32/ sono cartelle sorelle, quindi "../esp32/README.md"
    # funziona. Qui l'app sta in web/ds200/ e esp32/ e' fuori da web/ (non finisce su
    # Pages): il link relativo darebbe 404. Lo mandiamo su GitHub.
    (os.path.join(WEB, "ds200", "flash.html"),
     '<a href="../esp32/README.md">esp32/README</a>',
     '<a href="https://github.com/RobertoD91/slotcar/blob/master/esp32/README.md"'
     ' target="_blank" rel="noopener">esp32/README</a>',
     "link esp32/README"),
]

# 2. Menu del baud. Due cose insieme:
#    - le voci dicono a quale apparecchio corrispondono: "4800" da solo non aiuta
#      chi non e' tecnico, "DS 200 — 4800" si'. Prima il DS 300, poi il DS 200, poi
#      gli altri valori marcati come prove.
#    - autocomplete="off": i browser ripristinano da soli l'opzione scelta l'ultima
#      volta quando ricarichi, scavalcando il default scritto nell'HTML.
#    Selezionato resta il DS 200 (4800), che e' l'apparecchio in uso.
PATCHES += [
    (os.path.join(WEB, "ds200", "index.html"),
     '        <select id="baud">\n'
     '          <option value="4800" selected>4800</option>\n'
     '          <option value="9600">9600</option>\n'
     '          <option value="19200">19200</option>\n'
     '          <option value="38400">38400</option>\n'
     '          <option value="57600">57600</option>\n'
     '          <option value="115200">115200</option>\n'
     '        </select>\n'
     '        <small class="baudhint">DS200 4800 · DS300 57600</small>',
     '        <select id="baud" autocomplete="off">\n'
     '          <option value="57600">DS 300 — 57600</option>\n'
     '          <option value="4800" selected>DS 200 — 4800</option>\n'
     '          <option value="9600">9600 (test)</option>\n'
     '          <option value="19200">19200 (test)</option>\n'
     '          <option value="38400">38400 (test)</option>\n'
     '          <option value="115200">115200 (test)</option>\n'
     '        </select>\n'
     '        <small class="baudhint">DS 300 = 57600 · DS 200 = 4800</small>',
     "baud: voci per apparecchio"),
]

# 3. esp32/README.md: a monte l'app sta in webapp/, qui in web/ds200/. Senza questa
#    patch il comando di merge scriverebbe il firmware nel posto sbagliato.
_ESP32_README = os.path.join(ROOT, "esp32", "README.md")
PATCHES += [
    (_ESP32_README,
     "La pagina [`webapp/flash.html`](../webapp/flash.html) usa",
     "La pagina [`web/ds200/flash.html`](../web/ds200/flash.html) usa",
     "esp32/README link flash"),
    (_ESP32_README,
     "merge_bin -o ../webapp/firmware/ds200-esp32-merged.bin",
     "merge_bin -o ../web/ds200/firmware/ds200-esp32-merged.bin",
     "esp32/README path merge"),
    (_ESP32_README,
     "# poi servi la cartella webapp/ via https o localhost e apri flash.html",
     "# poi servi la cartella web/ via https o localhost e apri ds200/flash.html",
     "esp32/README nota serve"),
]

# NB — patch RIMOSSE, e perche':
#  * i link di ritorno delle app oXigen, i tre disclaimer di i18n.js e il rimando a
#    un documento privato in remote-config: quei file ora vivono QUI, non sono piu'
#    copie, quindi le modifiche stanno gia' nei file e non c'e' niente da riapplicare.
#  * "dongle-debug: stato tradotto": correzione entrata a monte, e l'app poi rimossa.
# Regola: quando una modifica smette di essere una copia (o entra a monte), la patch
# va tolta — altrimenti verrebbe applicata due volte o fallirebbe a vuoto.


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="non modifica niente, verifica soltanto")
    args = ap.parse_args()

    applied = done = missing = 0

    for path, old, new, label in PATCHES:
        if not os.path.exists(path):
            print("  ✗ %-28s FILE MANCANTE: %s" % (label, path))
            missing += 1
            continue

        with io.open(path, encoding="utf-8") as fh:
            src = fh.read()

        if new in src:
            print("  = %-28s gia' applicata" % label)
            done += 1
            continue

        if old not in src:
            print("  ✗ %-28s NON TROVATA (il file a monte e' cambiato?)" % label)
            missing += 1
            continue

        if args.check:
            print("  ! %-28s da applicare" % label)
            missing += 1
            continue

        with io.open(path, "w", encoding="utf-8") as fh:
            fh.write(src.replace(old, new))
        print("  ✓ %-28s applicata" % label)
        applied += 1

    print("\n%d applicate, %d gia' a posto, %d da sistemare" % (applied, done, missing))
    if missing:
        print("\nControlla a mano i punti segnati con ✗/!: il testo di riferimento a monte\n"
              "e' cambiato e la patch va aggiornata in tools/apply-local-patches.py.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
