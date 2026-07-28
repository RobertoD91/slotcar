#!/usr/bin/env bash
# Riallinea le web app di questa repo alle repo di sviluppo, che restano private.
#
#   <OXIGEN_REPO>/web/{car-config,remote-config,dongle-debug,modes,i18n.js,sw.js}
#        -> web/
#   <DS200_REPO>/webapp/  -> web/ds200/
#   <DS200_REPO>/esp32/   -> esp32/
#
# I PERCORSI NON SONO SCRITTI QUI DENTRO: questa repo e' pubblica e non deve
# contenere i nomi o la struttura delle repo di sviluppo. Li prende, in ordine:
#   1. dalle variabili d'ambiente OXIGEN_REPO / DS200_REPO
#   2. da tools/sync.local.conf  (git-ignored: te lo crei tu la prima volta,
#      vedi tools/sync.local.conf.example)
#
# NON tocca i file propri di questa repo: web/index.html, web/version.json,
# README.md, .github/, tools/.  Dopo la copia riapplica le patch locali
# (link di ritorno all'indice, disclaimer, percorsi rimappati).
#
# Uso:
#   ./tools/sync-from-upstream.sh
#   OXIGEN_REPO=~/src/... DS200_REPO=~/src/... ./tools/sync-from-upstream.sh
#   ./tools/sync-from-upstream.sh --dry-run
#
# Dopo il sync: rileggi `git diff`, aggiorna web/version.json + SITE_VERSION in
# web/index.html se pubblichi, poi committa.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$HERE/tools/sync.local.conf"

# shellcheck source=/dev/null
[ -f "$CONF" ] && . "$CONF"

OXIGEN_REPO="${OXIGEN_REPO:-}"
DS200_REPO="${DS200_REPO:-}"

die() { echo "ERRORE: $*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "   [dry-run] $*"; else "$@"; fi; }

need_conf() {
  cat >&2 <<EOF
ERRORE: non so dove sono le repo di sviluppo.

Impostale una volta sola in  tools/sync.local.conf  (e' git-ignored):

    cp tools/sync.local.conf.example tools/sync.local.conf
    \$EDITOR tools/sync.local.conf

oppure passale al volo:

    OXIGEN_REPO=/percorso/repo-oxigen DS200_REPO=/percorso/repo-ds200 \\
      ./tools/sync-from-upstream.sh
EOF
  exit 1
}

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

[ -n "$OXIGEN_REPO" ] && [ -n "$DS200_REPO" ] || need_conf
[ -d "$OXIGEN_REPO/web" ]   || die "non trovo $OXIGEN_REPO/web"
[ -d "$DS200_REPO/webapp" ] || die "non trovo $DS200_REPO/webapp"

echo "Sorgenti:"
echo "  oXigen : $OXIGEN_REPO/web"
echo "  DS200  : $DS200_REPO"
echo "Destinazione: $HERE"
[ "$DRY" = 1 ] && echo "(dry-run: non scrivo niente)"
echo

echo "1. app oXigen + asset condivisi"
for app in car-config remote-config dongle-debug modes; do
  [ -d "$OXIGEN_REPO/web/$app" ] || die "manca $OXIGEN_REPO/web/$app"
  run rm -rf "$HERE/web/$app"
  run cp -r "$OXIGEN_REPO/web/$app" "$HERE/web/$app"
  echo "   web/$app"
done
for f in i18n.js sw.js; do
  [ -f "$OXIGEN_REPO/web/$f" ] || die "manca $OXIGEN_REPO/web/$f"
  run cp "$OXIGEN_REPO/web/$f" "$HERE/web/$f"
  echo "   web/$f"
done

echo "2. contagiri DS200/DS300"
# I .bin del firmware li produce la CI e non stanno a monte: qui non ci sono comunque.
run rm -rf "$HERE/web/ds200"
run mkdir -p "$HERE/web/ds200"
run cp -r "$DS200_REPO/webapp/." "$HERE/web/ds200/"
echo "   web/ds200/"

echo "3. firmware ESP32"
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
echo "4. patch locali"
python3 "$HERE/tools/apply-local-patches.py"

echo
echo "5. controlli"
node "$HERE/tools/check-links.js"
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
