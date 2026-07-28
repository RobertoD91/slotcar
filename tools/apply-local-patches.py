#!/usr/bin/env python3
"""Riapplica le modifiche LOCALI di questa repo alle app copiate da monte.

Le app arrivano da altre due repo (vedi sync-from-upstream.sh) e qui servono
qualche ritocco: il link di ritorno punta all'indice di QUESTA repo, e il
disclaimer condiviso deve nominare anche DS Electronic (di là c'era solo Slot.it).

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

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "web")
WEB = os.path.normpath(WEB)

OXIGEN_APPS = ["car-config", "dongle-debug", "remote-config", "modes"]

# (file, testo_da_sostituire, testo_nuovo) — "done" = testo_nuovo gia' presente.
PATCHES = []

# 1. Link di ritorno delle app oXigen: l'indice ora si chiama "Slot Car Web Tools".
for _app in OXIGEN_APPS:
    PATCHES.append((
        os.path.join(WEB, _app, "index.html"),
        "← oXigen Web Tools",
        "← Slot Car Web Tools",
        "back-link %s" % _app,
    ))

# 2. Disclaimer condiviso: nominare anche DS Electronic (qui ci sono anche i DS200/DS300).
_I18N = os.path.join(WEB, "i18n.js")
PATCHES += [
    (_I18N,
     '"sponsorizzata né supportata da Slot.it / Galileo Engineering</b>. '
     '«Slot.it» e «oXigen» sono marchi dei " +',
     '"sponsorizzata né supportata da Slot.it / Galileo Engineering, DS Electronic o Ninco</b>. '
     '«Slot.it», «oXigen», " +\n        "«DS Electronic», «DS200», «DS300» e «Ninco» sono marchi dei " +',
     "disclaimer IT"),
    (_I18N,
     '"supported by Slot.it / Galileo Engineering</b>. '
     '\\"Slot.it\\" and \\"oXigen\\" are trademarks of their " +',
     '"supported by Slot.it / Galileo Engineering, DS Electronic or Ninco</b>. '
     '\\"Slot.it\\", \\"oXigen\\", \\"DS Electronic\\", " +\n        '
     '"\\"DS200\\", \\"DS300\\" and \\"Ninco\\" are trademarks of their " +',
     "disclaimer EN"),
    (_I18N,
     '"patrocinada ni respaldada por Slot.it / Galileo Engineering</b>. '
     '«Slot.it» y «oXigen» son marcas de sus " +',
     '"patrocinada ni respaldada por Slot.it / Galileo Engineering, DS Electronic o Ninco</b>. '
     '«Slot.it», «oXigen», " +\n        "«DS Electronic», «DS200», «DS300» y «Ninco» son marcas de sus " +',
     "disclaimer ES"),
]

# 3. Link di ritorno dentro l'app DS200 (di suo non sa di stare in un indice).
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

# 3-bis. Menu del baud. Due cose insieme:
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

# NB: la patch "dongle-debug: stato tradotto" e' stata RIMOSSA da qui perche' la
#     correzione e' stata fatta a monte (lo stato mostrava la chiave i18n invece del
#     testo al primo caricamento). Tenerla avrebbe applicato la correzione due volte
#     al prossimo sync. Regola generale: quando una patch entra a monte, si toglie —
#     e --check lo segnala da solo, perche' il testo di aggancio non c'e' piu'.

# 4. Via i rimandi a documenti che esistono solo nelle repo di sviluppo: qui sarebbero
#    riferimenti morti (questa repo non ha una cartella docs/).
PATCHES += [
    (os.path.join(WEB, "remote-config", "index.html"),
     "// registri leggibili di config/info del controller "
     "(docs/REPORT-ble-controller-scp3.md) — 2° elem = chiave i18n del nome",
     "// registri leggibili di config/info del controller "
     "— 2° elem = chiave i18n del nome",
     "no rimando a docs/ privati"),
]

# 5. esp32/README.md: a monte l'app sta in webapp/, qui in web/ds200/. Senza questa
#    patch il comando di merge scriverebbe il firmware nel posto sbagliato.
_ESP32_README = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "esp32", "README.md"))
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
