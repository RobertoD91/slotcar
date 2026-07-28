#!/usr/bin/env python3
"""Cerca segreti nel repo. Stesso motore per la GitHub Action e per gli hook git.

Questa repo e' PUBBLICA: password del WiFi, chiavi, token e indirizzi MAC personali
non devono finirci ne' ora ne' nella storia. I veri segreti stanno nei GitHub Secrets
e in file .env locali, mai committati.

Modi:
  --staged            solo quello che stai per committare   (hook pre-commit)
  --range A..B        i commit che stai per pushare          (hook pre-push)
  --history           TUTTA la storia del repo               (Action)
  (niente)            i file tracciati nel working tree      (Action, default)

Valori personali (i TUOI MAC, la TUA password del WiFi) non si mettono qui dentro:
sarebbe come pubblicarli. Si aggiungono da fuori:
  * file  tools/secrets-denylist.local.txt   (git-ignored, uno per riga)
  * variabile d'ambiente  SECRET_SCAN_EXTRA  (righe separate da \\n)
    -> in CI arriva da un GitHub Secret, cosi' resta fuori dal codice.
Le righe sono espressioni regolari; se non compilano vengono trattate come testo.

In output i valori trovati sono SEMPRE mascherati: un log di CI e' pubblico quanto
il codice, non ha senso stampare in chiaro il segreto che stiamo cercando di fermare.

Uscita: 0 = pulito, 1 = trovato qualcosa, 2 = errore d'uso.
"""

import argparse
import os
import re
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))

# ---------------------------------------------------------------- regole generiche
# (nome, regex, descrizione) — niente valori personali qui: vedi il docstring.
RULES = [
    ("chiave-privata",
     r"-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----",
     "blocco di chiave privata"),
    ("aws-access-key", r"\bAKIA[0-9A-Z]{16}\b", "AWS access key id"),
    ("github-token", r"\bgh[pousr]_[A-Za-z0-9]{30,}\b", "token GitHub"),
    ("slack-token", r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b", "token Slack"),
    ("google-api-key", r"\bAIza[0-9A-Za-z_-]{35,}", "Google API key"),
    ("jwt", r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.", "JSON Web Token"),
    ("mac-address",
     r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:])",
     "indirizzo MAC"),
    # Assegnazioni tipo WIFI_PASSWORD=..., api_key: "...", MQTT_PASS = '...'.
    # NB: niente \b davanti — l'underscore e' un word-char, quindi \b non scatta
    # fra "AP_" e "PASSWORD" e si perderebbero proprio i casi piu' comuni.
    ("credenziale-assegnata",
     r"(?i)[A-Za-z0-9_.-]*"
     r"(?:passphrase|password|passwd|pass|secret|api[_-]?key|apikey"
     r"|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key)"
     r"(?![A-Za-z0-9_])\s*[:=]\s*[\"']?([^\s\"',;)}]{6,})",
     "assegnazione di password/chiave con un valore"),
    # In C/C++ le costanti si scrivono con #define, senza '=': senza questa regola
    # un  #define AP_PASSWORD "..."  passerebbe liscio.
    ("define-credenziale",
     r"(?i)^\s*#\s*define\s+[A-Za-z0-9_]*"
     r"(?:passphrase|password|passwd|pass|secret|api[_-]?key|apikey"
     r"|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key)"
     r"(?![A-Za-z0-9_])\s+\"([^\"]{6,})\"",
     "#define con dentro una credenziale"),
    ("url-con-credenziali",
     r"\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s:@]+@", "URL con user:password dentro"),
]

# Un match su una riga di codice non e' un segreto: MQTT_PASS e' il nome di una macro,
# prefs.getString( e' una chiamata, nullptr e' nullptr. Se il "valore" e' una di queste
# cose lo scartiamo, altrimenti il rumore rende lo scanner inutile e lo si ignora.
CODE_VALUE = re.compile(
    r"^(?:"
    r"[A-Z][A-Z0-9_]{2,}$"                     # MACRO_NAME
    r"|(?:nullptr|NULL|None|nil|undefined|true|false|self|this)$"
    r"|[A-Za-z_][A-Za-z0-9_.:>-]*\("            # chiamata di funzione
    r"|process\.env\.|os\.environ|getenv"       # letto dall'ambiente
    r"|[\"']?\s*[+,)]"                          # frammento di espressione
    r"|\$\{|\{\{|<%"                            # placeholder di template
    r"|(?i:your|my_|change_?me|example|placeholder|dummy|redacted|todo|fixme|xxx+|\.\.\.|<)"
    r")"
)

# ------------------------------------------------------- eccezioni note (non segreti)
# Percorsi che per natura contengono esempi/placeholder.
SKIP_PATHS = re.compile(
    r"(^|/)(\.git/|node_modules/|\.pio/|__pycache__/)"
    r"|\.(png|jpg|jpeg|gif|ico|pdf|bin|uf2|hex|woff2?|zip|gz)$"
)

# Un file di allow-list committato (una regex per riga, '#' = commento).
ALLOW_FILE = os.path.join(ROOT, "tools", "secret-scan-allow.txt")

# Marcatore da mettere sulla riga per dire "lo so, non e' un segreto".
INLINE_ALLOW = "allow-secret"


def load_lines(path):
    out = []
    if path and os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    out.append(line)
    return out


def compile_extra(raw_lines, label):
    pats = []
    for raw in raw_lines:
        try:
            pats.append((label, re.compile(raw), "valore nella denylist privata"))
        except re.error:
            pats.append((label, re.compile(re.escape(raw)), "valore nella denylist privata"))
    return pats


def build_rules():
    rules = [(n, re.compile(p), d) for n, p, d in RULES]
    rules += compile_extra(load_lines(os.path.join(ROOT, "tools", "secrets-denylist.local.txt")),
                           "denylist-locale")
    # Stesse regole del file locale: righe vuote e commenti '#' si ignorano, cosi' si
    # puo' caricare tools/secrets-denylist.local.txt tale e quale dentro il GitHub
    # Secret senza doverlo ripulire a mano.
    env = os.environ.get("SECRET_SCAN_EXTRA", "")
    rules += compile_extra(
        [l.strip() for l in env.splitlines()
         if l.strip() and not l.strip().startswith("#")],
        "denylist-CI")
    return rules


def build_allow():
    return [re.compile(p) for p in load_lines(ALLOW_FILE)]


def mask(value):
    """Non stampare mai il valore in chiaro: un log di CI e' pubblico."""
    value = value.strip()
    if len(value) <= 4:
        return "*" * len(value)
    return value[:2] + "*" * (len(value) - 4) + value[-2:]


def git(*args):
    return subprocess.run(["git", "-C", ROOT] + list(args),
                          capture_output=True, text=True, errors="replace").stdout


def scan_text(path, text, rules, allow, findings, only_added=False):
    for num, line in enumerate(text.splitlines(), 1):
        if only_added:
            if not line.startswith("+") or line.startswith("+++"):
                continue
            line = line[1:]
        if INLINE_ALLOW in line:
            continue
        if any(a.search(line) for a in allow):
            continue
        for name, rx, desc in rules:
            m = rx.search(line)
            if m:
                val = m.group(m.lastindex or 0)
                # Le regole "assegnazione" catturano il valore: se e' codice, lascia stare.
                if m.lastindex and CODE_VALUE.match(val.strip()):
                    continue
                findings.append((path, num, name, desc, mask(val)))
                break


def tracked_files():
    return [f for f in git("ls-files").splitlines() if f and not SKIP_PATHS.search(f)]


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--staged", action="store_true", help="solo le modifiche in staging")
    g.add_argument("--range", dest="rng", help="commit da controllare, es. origin/master..HEAD")
    g.add_argument("--history", action="store_true", help="tutta la storia del repo")
    ap.add_argument("--quiet", action="store_true", help="stampa solo i problemi")
    args = ap.parse_args()

    rules, allow = build_rules(), build_allow()
    findings = []
    what = ""

    if args.staged:
        what = "modifiche in staging"
        diff = git("diff", "--cached", "--unified=0", "--no-color")
        cur = None
        for line in diff.splitlines():
            if line.startswith("+++ b/"):
                cur = line[6:]
            elif cur and not SKIP_PATHS.search(cur):
                scan_text(cur, line, rules, allow, findings, only_added=True)

    elif args.rng:
        what = "commit %s" % args.rng
        diff = git("diff", "--unified=0", "--no-color", args.rng)
        cur = None
        for line in diff.splitlines():
            if line.startswith("+++ b/"):
                cur = line[6:]
            elif cur and not SKIP_PATHS.search(cur):
                scan_text(cur, line, rules, allow, findings, only_added=True)

    elif args.history:
        what = "tutta la storia"
        diff = git("log", "--all", "-p", "--no-color", "--no-merges",
                   "--format=commit %h")
        cur, commit = None, "?"
        for line in diff.splitlines():
            if line.startswith("commit "):
                commit = line.split()[1]
            elif line.startswith("+++ b/"):
                cur = line[6:]
            elif cur and not SKIP_PATHS.search(cur):
                scan_text("%s @%s" % (cur, commit), line, rules, allow, findings,
                          only_added=True)

    else:
        what = "file tracciati (working tree)"
        for f in tracked_files():
            p = os.path.join(ROOT, f)
            try:
                with open(p, encoding="utf-8", errors="replace") as fh:
                    scan_text(f, fh.read(), rules, allow, findings)
            except (IOError, OSError):
                continue

    if not args.quiet:
        print("scansione segreti — %s" % what)

    if not findings:
        if not args.quiet:
            print("✅ nessun segreto trovato")
        return 0

    # dedup mantenendo l'ordine
    seen, uniq = set(), []
    for f in findings:
        if f not in seen:
            seen.add(f)
            uniq.append(f)

    print("\n🚨 POSSIBILI SEGRETI (%d)\n" % len(uniq))
    for path, num, name, desc, val in uniq:
        print("  %s:%s" % (path, num))
        print("      %-22s %s  →  %s" % (name, desc, val))
    print("""
Cosa fare:
  • se e' un segreto VERO: toglilo dal file, mettilo in un .env locale (git-ignored)
    o nei GitHub Secrets, e cambia la credenziale — considerala compromessa.
  • se e' un falso allarme: aggiungi il commento  %s  sulla riga,
    oppure una regex in  tools/secret-scan-allow.txt .""" % INLINE_ALLOW)
    return 1


if __name__ == "__main__":
    sys.exit(main())
