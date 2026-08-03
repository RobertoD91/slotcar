# Copia il Cronometro web dentro esp32/data/, da cui PlatformIO costruisce
# l'immagine LittleFS che il firmware serve.
#
# ⭐ PERCHE' ESISTE QUESTO SCRIPT
#
# Prima l'ESP32 serviva `src/web_index.h`: una COPIA A MANO dell'app, 174 righe
# incollate dentro il firmware. E' invecchiata come invecchiano tutte le copie a
# mano — quando l'abbiamo tolta aveva ancora la vecchia tavolozza rossa, un suo
# dizionario a 5 lingue e il cronometro che scorreva da solo, cioe' proprio
# l'antipattern che avevamo appena eliminato dall'app vera. Nessuno l'aveva
# toccata in mesi perche' nessuno si ricordava che esistesse.
#
# Questo script NON e' una copia a mano: e' un passo di build, deterministico,
# che gira ad ogni `pio run`. La sorgente resta una sola — `web/` — e il
# firmware ne riceve un artefatto. Non c'e' niente da tenere allineato.
#
# ⚠️ La struttura delle cartelle si RISPETTA (web/cronometro/ resta
# data/cronometro/, ui.css resta accanto): cosi' i percorsi relativi dentro
# index.html — `../ui.css`, `../tema.js`, `../ds200-ds300/ds200.js` — funzionano
# senza riscrivere una riga. Appiattire l'albero avrebbe voluto dire riscrivere
# i percorsi, cioe' reintrodurre una trasformazione da mantenere.
import os
import shutil

Import("env")  # noqa: F821  (lo inietta PlatformIO)

QUI = os.path.dirname(os.path.abspath(__file__))
ESP32 = os.path.dirname(QUI)
WEB = os.path.join(os.path.dirname(ESP32), "web")
DATA = os.path.join(ESP32, "data")

# Solo quello che serve al cronometro. Il resto del sito (i debugger oXigen, la
# guida, l'installer) non c'entra niente con un ponte per il DS200.
FILE = ["ui.css", "tema.js"]
CARTELLE = [
    ("cronometro", None),
    # il decoder dei frame: index.html lo carica da ../ds200-ds300/
    ("ds200-ds300", ["ds200.js"]),
]
# `sw.js`: la cache-first non ha senso su LittleFS — la pagina la serve un
# dispositivo che hai in mano, e su origine non sicura un service worker non si
# registra nemmeno. `race.test.js`: gira da riga di comando, non sul dispositivo.
SALTA = {"sw.js", "race.test.js"}


def copia():
    if os.path.isdir(DATA):
        shutil.rmtree(DATA)
    os.makedirs(DATA)

    n = 0
    for f in FILE:
        src = os.path.join(WEB, f)
        if not os.path.isfile(src):
            raise SystemExit("copy_webapp: manca %s" % src)
        shutil.copy2(src, os.path.join(DATA, f))
        n += 1

    for nome, soltanto in CARTELLE:
        src = os.path.join(WEB, nome)
        if not os.path.isdir(src):
            raise SystemExit("copy_webapp: manca la cartella %s" % src)
        for radice, _, files in os.walk(src):
            for f in files:
                if f in SALTA:
                    continue
                if soltanto is not None and f not in soltanto:
                    continue
                pieno = os.path.join(radice, f)
                rel = os.path.relpath(pieno, WEB)
                dest = os.path.join(DATA, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(pieno, dest)
                n += 1

    peso = sum(
        os.path.getsize(os.path.join(r, f))
        for r, _, fs in os.walk(DATA)
        for f in fs
    )
    print("copy_webapp: %d file, %.0f KB -> esp32/data/" % (n, peso / 1024.0))
    # La partizione LittleFS di huge_app.csv e' 0xE0000 = 896 KB. Se un giorno
    # l'app crescesse fino a non entrarci, meglio saperlo qui che davanti a un
    # `uploadfs` che fallisce a meta'.
    if peso > 800 * 1024:
        print("copy_webapp: ⚠ vicino al limite della partizione (896 KB)")


copia()
