#!/usr/bin/env bash
# Riallinea le web app di questa repo alle repo di sviluppo (che restano private).
#
#   reverse_slot.it/web/{car-config,remote-config,dongle-debug,modes,i18n.js,sw.js}
#        -> web/
#   ds200rs232/webapp/  -> web/ds200/
#   ds200rs232/esp32/   -> esp32/
#
# NON tocca i file propri di questa repo: web/index.html, web/version.json,
# README.md, .github/, tools/.  Dopo la copia riapplica le patch locali
# (link di ritorno all'indice, disclaimer che nomina anche DS Electronic).
#
# Uso:
#   ./tools/sync-from-upstream.sh
#   REVERSE_REPO=~/src/reverse_slot.it DS200_REPO=~/src/ds200rs232 ./tools/sync-from-upstream.sh
#   ./tools/sync-from-upstream.sh --dry-run
#
# Dopo il sync: rileggi `git diff`, aggiorna web/version.json + SITE_VERSION in
# web/index.html se pubblichi, poi committa.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT="$(dirname "$HERE")"

REVERSE_REPO="${REVERSE_REPO:-$PARENT/reverse_slot.it}"
DS200_REPO="${DS200_REPO:-$PARENT/ds200rs232}"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

die() { echo "ERRORE: $*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "   [dry-run] $*"; else "$@"; fi; }

[ -d "$REVERSE_REPO/web" ] || die "non trovo $REVERSE_REPO/web (imposta REVERSE_REPO=...)"
[ -d "$DS200_REPO/webapp" ] || die "non trovo $DS200_REPO/webapp (imposta DS200_REPO=...)"

echo "Sorgenti:"
echo "  oXigen : $REVERSE_REPO/web"
echo "  DS200  : $DS200_REPO"
echo "Destinazione: $HERE"
[ "$DRY" = 1 ] && echo "(dry-run: non scrivo niente)"
echo

echo "1. app oXigen + asset condivisi"
for app in car-config remote-config dongle-debug modes; do
  [ -d "$REVERSE_REPO/web/$app" ] || die "manca $REVERSE_REPO/web/$app"
  run rm -rf "$HERE/web/$app"
  run cp -r "$REVERSE_REPO/web/$app" "$HERE/web/$app"
  echo "   web/$app"
done
for f in i18n.js sw.js; do
  [ -f "$REVERSE_REPO/web/$f" ] || die "manca $REVERSE_REPO/web/$f"
  run cp "$REVERSE_REPO/web/$f" "$HERE/web/$f"
  echo "   web/$f"
done

echo "2. contagiri DS200/DS300"
# --delete via rsync se c'e', altrimenti rm+cp. I .bin del firmware sono
# prodotti dalla CI e non stanno a monte: si preservano.
run rm -rf "$HERE/web/ds200"
run mkdir -p "$HERE/web/ds200"
run cp -r "$DS200_REPO/webapp/." "$HERE/web/ds200/"
echo "   web/ds200/"

echo "3. firmware ESP32"
run rm -rf "$HERE/esp32"
run cp -r "$DS200_REPO/esp32" "$HERE/esp32"
# Roba di build/segreti che non deve entrare qui.
run rm -rf "$HERE/esp32/.pio" "$HERE/esp32/.vscode"
run rm -f "$HERE/esp32/.env"
echo "   esp32/"

if [ "$DRY" = 1 ]; then
  echo
  echo "dry-run finito: niente e' stato scritto."
  exit 0
fi

echo
echo "4. patch locali"
python3 "$HERE/tools/apply-local-patches.py"

echo
echo "5. test parser"
if command -v node >/dev/null 2>&1; then
  node "$HERE/web/ds200/ds200.test.js"
else
  echo "   (node non installato, salto il parser JS)"
fi
if command -v g++ >/dev/null 2>&1; then
  g++ -std=c++17 -I "$HERE/esp32/test_host" -I "$HERE/esp32/src" \
      "$HERE/esp32/test_host/test_ds200.cpp" -o /tmp/slotcar_test_ds200
  /tmp/slotcar_test_ds200
else
  echo "   (g++ non installato, salto il parser C++)"
fi

echo
echo "Fatto. Ora: git diff, poi aggiorna web/version.json e SITE_VERSION in"
echo "web/index.html se stai pubblicando un aggiornamento."
