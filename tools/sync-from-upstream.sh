#!/usr/bin/env bash
# Riallinea al progetto DS200 quel che ancora arriva da fuori:
#
#   <DS200_REPO>/webapp/  -> web/ds200/
#   <DS200_REPO>/esp32/   -> esp32/
#
# Tutto il RESTO di questa repo e' sorgente, non copia: le app oXigen
# (car-config, remote-config, modes, chron02, o2-bootloader), il contagiri Ninco,
# l'indice, i tool e la documentazione si modificano direttamente qui.
#
# IL PERCORSO NON E' SCRITTO QUI DENTRO: questa repo e' pubblica e non deve
# contenere il nome o la struttura della repo di sviluppo. Lo prende, in ordine:
#   1. dalla variabile d'ambiente DS200_REPO
#   2. da tools/sync.local.conf  (git-ignored: te lo crei tu la prima volta,
#      vedi tools/sync.local.conf.example)
#
# Dopo la copia riapplica le patch locali (link di ritorno, percorsi rimappati,
# menu del baud) e rilancia i controlli.
#
# Uso:
#   ./tools/sync-from-upstream.sh
#   DS200_REPO=~/src/... ./tools/sync-from-upstream.sh
#   ./tools/sync-from-upstream.sh --dry-run

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$HERE/tools/sync.local.conf"

# shellcheck source=/dev/null
[ -f "$CONF" ] && . "$CONF"

DS200_REPO="${DS200_REPO:-}"

die() { echo "ERRORE: $*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "   [dry-run] $*"; else "$@"; fi; }

need_conf() {
  cat >&2 <<EOF
ERRORE: non so dove sia la repo del progetto DS200.

Impostala una volta sola in  tools/sync.local.conf  (e' git-ignored):

    cp tools/sync.local.conf.example tools/sync.local.conf
    \$EDITOR tools/sync.local.conf

oppure passala al volo:

    DS200_REPO=/percorso/repo-ds200 ./tools/sync-from-upstream.sh
EOF
  exit 1
}

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

[ -n "$DS200_REPO" ] || need_conf
[ -d "$DS200_REPO/webapp" ] || die "non trovo $DS200_REPO/webapp"

echo "Sorgente DS200: $DS200_REPO"
echo "Destinazione:   $HERE"
[ "$DRY" = 1 ] && echo "(dry-run: non scrivo niente)"
echo

echo "1. contagiri DS200/DS300"
# I .bin del firmware li produce la CI e non stanno a monte: qui non ci sono comunque.
run rm -rf "$HERE/web/ds200"
run mkdir -p "$HERE/web/ds200"
run cp -r "$DS200_REPO/webapp/." "$HERE/web/ds200/"
echo "   web/ds200/"

echo "2. firmware ESP32"
run rm -rf "$HERE/esp32"
run cp -r "$DS200_REPO/esp32" "$HERE/esp32"
# Roba di build/segreti che non deve entrare in una repo pubblica.
run rm -rf "$HERE/esp32/.pio" "$HERE/esp32/.vscode"
run rm -f "$HERE/esp32/.env"
echo "   esp32/"

if [ "$DRY" = 1 ]; then
  echo
  echo "dry-run finito: niente e' stato scritto."
  exit 0
fi

echo
echo "3. patch locali"
python3 "$HERE/tools/apply-local-patches.py"

echo
echo "4. controlli"
node "$HERE/tools/check-links.js"
if command -v node >/dev/null 2>&1; then
  node "$HERE/web/ds200/ds200.test.js"
  node "$HERE/web/ninco/ninco.test.js"
else
  echo "   (node non installato, salto i parser)"
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
