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
     '"sponsorizzata né supportata da Slot.it / Galileo Engineering né da DS Electronic</b>. '
     '«Slot.it», «oXigen», " +\n        "«DS Electronic», «DS200» e «DS300» sono marchi dei " +',
     "disclaimer IT"),
    (_I18N,
     '"supported by Slot.it / Galileo Engineering</b>. '
     '\\"Slot.it\\" and \\"oXigen\\" are trademarks of their " +',
     '"supported by Slot.it / Galileo Engineering or DS Electronic</b>. '
     '\\"Slot.it\\", \\"oXigen\\", \\"DS Electronic\\", " +\n        '
     '"\\"DS200\\" and \\"DS300\\" are trademarks of their " +',
     "disclaimer EN"),
    (_I18N,
     '"patrocinada ni respaldada por Slot.it / Galileo Engineering</b>. '
     '«Slot.it» y «oXigen» son marcas de sus " +',
     '"patrocinada ni respaldada por Slot.it / Galileo Engineering ni por DS Electronic</b>. '
     '«Slot.it», «oXigen», " +\n        "«DS Electronic», «DS200» y «DS300» son marcas de sus " +',
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

# 4. esp32/README.md: a monte l'app sta in webapp/, qui in web/ds200/. Senza questa
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
