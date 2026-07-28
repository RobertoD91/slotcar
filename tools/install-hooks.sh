#!/usr/bin/env bash
# Attiva gli hook git di questa repo (blocco dei segreti su commit e push).
#
#   ./tools/install-hooks.sh
#
# Usa core.hooksPath, cosi' gli hook restano versionati in tools/git-hooks/ e non
# vanno copiati a mano in .git/hooks. E' una impostazione LOCALE del clone: va
# rifatta su ogni macchina dove cloni la repo (git non attiva hook da solo, e per
# fortuna: eseguirebbe codice arbitrario appena cloni qualcosa).
#
# Per disattivarli:  git config --unset core.hooksPath

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

chmod +x tools/git-hooks/* tools/scan-secrets.py 2>/dev/null || true
git config core.hooksPath tools/git-hooks

echo "✅ Hook attivi (core.hooksPath = $(git config core.hooksPath))"
echo "   pre-commit → blocca il commit se ci sono segreti in staging"
echo "   pre-push   → blocca il push se ci sono segreti nei commit in partenza"
echo
echo "Valori personali da bloccare (i tuoi MAC, la tua password del WiFi) NON vanno"
echo "messi nel codice. Mettili uno per riga, come regex, in:"
echo "   tools/secrets-denylist.local.txt    (git-ignored, resta sulla tua macchina)"
echo "e, per la CI, nel GitHub Secret  SECRET_SCAN_EXTRA ."
echo
echo "Prova:  python3 tools/scan-secrets.py"
