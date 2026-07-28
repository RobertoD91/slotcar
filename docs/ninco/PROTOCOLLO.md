# Ninco N-Digital — protocollo seriale verso il PC

Riassunto operativo del protocollo della **power base Ninco N-Digital**, ricavato dalle
fonti in fondo. È la specifica su cui è scritto il decoder `web/ninco/ninco.js`.

## Collegamento fisico

I segnali sulla presa **Out** sono **RS-232 / EIA-232 veri** (±12 V), quindi si collegano
direttamente a una seriale del PC o a un convertitore RS-232↔USB. **Non** a un ingresso
TTL 3,3/5 V senza un convertitore tipo MAX3232, o lo si danneggia.

Cavo adattatore Mini-DIN 6 (maschio) ↔ D-Sub 9 (femmina), **Rx e Tx incrociati**:

| Presa Out (Mini-DIN 6) | D-Sub 9 | |
|---|---|---|
| 1 | 2 | dati dalla power base al PC |
| 6 | 3 | dati dal PC alla power base |
| 5 | 5 | massa |

**Parametri seriali: 1200 baud, 7 bit di dati, nessuna parità, 1 bit di stop.**

## Verso della comunicazione

La power base **trasmette e basta**, di sua iniziativa, senza che nessuno le chieda
niente; non risulta che accetti dati dal PC. Il filo PC→base è cablato ma non usato.
⇒ un'app può solo **leggere**: non si comanda la gara da PC.

## Pacchetti (power base → PC)

Tutti i pacchetti finiscono con un **ritorno a capo**, `0x0D`, indicato qui con `<CR>`.
Sono **testo ASCII**, non binario.

### `MX<CR>` — modalità · es. `M2<CR>`
Inviato quando sulla base si cambia l'impostazione luci o amatore/professionale.
`X` è un carattere ASCII `0`–`3`, di cui contano i 2 bit bassi:

| bit | significato quando vale 1 |
|---|---|
| 0 | le auto vanno con le **luci** accese |
| 1 | modalità **professionale** attiva |

### `P<CR>` — programmazione
Inviato quando si preme il tasto **Menu** e diventa possibile assegnare l'identificativo
a un'auto. Arriva **sempre**, che poi la programmazione avvenga o no, e non c'è modo di
sapere se è avvenuta. **Dalla versione 1.08 viene mandato sempre due volte.**

### `LRRRR,A1,…,A8<CR>` — passaggio sul traguardo · es. `L0025,0C,0C,2C,4C,0C,3C,0C,1C<CR>`
Inviato prima della partenza, dopo la partenza e **ad ogni passaggio sul traguardo**.
**Spesso viene ripetuto due volte di fila.**

- `RRRR` — giri del **capofila**, numero decimale ASCII. A seconda della modalità di gara
  sono i giri **già fatti** oppure quelli **che restano da fare**: il pacchetto non lo dice.
- `A1…A8` — **due caratteri per ogni auto**, dalla 1 alla 8:
  - **1° carattere = posizione**, decimale ASCII. **`0` = l'auto non partecipa**, `1` = primo, ecc.
  - **2° carattere = massima velocità consentita**, esadecimale ASCII (`0`–`9`, `A`–`F`),
    cioè un valore a 4 bit:

    | valore | significato |
    |---|---|
    | `0` | pista spenta, oppure l'auto sta entrando ai **box** |
    | `4` | l'auto deve andare piano, es. **benzina quasi finita** |
    | `C` | strada libera, modalità **amatore** |
    | `F` | strada libera, modalità **professionale** |

### `FB1,…,B8<CR>` — benzina · es. `F99,I5,66,43,05,28,47,42<CR>`
Inviato a intervalli regolari.
Otto valori separati da virgola, uno per auto, dalla 1 alla 8:

- solo cifre decimali → **livello di benzina** attuale;
- **`I5` oppure `5I`** → l'auto è in **riserva**; il valore non cambia più finché non
  rifornisce. Dopo **tre passaggi consecutivi** in riserva, la massima velocità nel
  pacchetto `L` viene messa a `4`.
- ⚠️ **L'ottava auto ha le due cifre invertite** (auto 1–7 in MSB, auto 8 in LSB). L'autore
  della documentazione non sa dire se sia un difetto della *sua* power base o se sia
  sempre così — per questo il decoder lo tratta come **opzione**, attiva di default ma
  disattivabile.

### `DAAAA,RRRR,GGGGGG,SSSSSS<CR>` — risultato · es. `D0008,0004,000523,000213<CR>`
Inviato quando a fine gara si chiedono i tempi delle singole auto sulla base.
**Dalla versione 1.08 arriva anche ad ogni passaggio sul traguardo**, e in quel caso il
tempo totale è quello trascorso fino a quel momento ⇒ **la differenza fra due totali
consecutivi della stessa auto è il tempo sul giro** (per il primo giro si usa il totale
stesso). È l'unico modo di avere i tempi sul giro: la base non li manda mai come numero.

- `AAAA` — numero dell'auto, decimale ASCII
- `RRRR` — giri percorsi, decimale ASCII. **Eccetto in modalità GP**, dove è il *distacco*
  in giri dal vincitore.
- `GGGGGG` — **tempo totale**, decimale ASCII, formato **`MMSSCC`**: `123456` = 12 minuti,
  34 secondi, 56 centesimi.
- `SSSSSS` — **giro più veloce**, stesso formato.

## Cosa NON si può avere

- **Tempi sul giro con firmware precedente alla 1.08**: la base non li trasmette.
- **Comandare la gara dal PC**: la base non accetta dati.
- **Sapere se `RRRR` sono i giri fatti o quelli mancanti**: dipende dalla modalità di gara
  impostata sulla base, e il protocollo non la comunica.

## Fonti

- **slotbaer.de — «N-Digital Rechner-Kopplung»** (in tedesco, è la fonte primaria):
  <http://www.slotbaer.de/ninco-n-digital/24-n-digital-rechner-kopplung.html>
  Copia locale in [`slotbaer-rechner-kopplung.html`](slotbaer-rechner-kopplung.html) e
  [`.txt`](slotbaer-rechner-kopplung.txt).
  ⚠️ Il sito risponde solo su `www.` e solo in HTTP (senza `www.` il DNS non risolve).
- **France Slot Forum — «N-Digital Ninco sur écran»** (in francese, riprende e traduce la
  fonte tedesca, con discussione e software):
  <https://www.franceslotforum.com/forum/n-digital-ninco-sur-ecran-1337250.html>
- [`NincoDB9.jpg`](NincoDB9.jpg) — schema del cavo (mostra i soli due fili della lettura).

> Refuso nella fonte tedesca: «123456 bedeutet 12:34:56 also 12 Minuten **23** Sekunden»
> — le cifre `12|34|56` sono minuti|secondi|centesimi, quindi sono 34 secondi. Il formato
> `MMSSCC` è confermato dalla struttura stessa dell'esempio.
