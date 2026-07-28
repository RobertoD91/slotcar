/* Test del decoder Ninco. Niente hardware, niente browser:  node web/ninco/ninco.test.js
 * Gli esempi sono quelli della specifica (docs/ninco/PROTOCOLLO.md). */
const assert = require('assert');
const N = require('./ninco.js');

function eq(a, b, m) { assert.deepStrictEqual(a, b, m); }

/* ---------- MX : modalita' ---------- */
{
  const p = N.parseLine('M2');
  eq(p.type, 'mode');
  eq(p.professional, true, 'bit1 = professionale');
  eq(p.lights, false, 'bit0 = luci');
  eq(N.parseLine('M1').lights, true);
  eq(N.parseLine('M1').professional, false);
  eq(N.parseLine('M3').lights, true);
  eq(N.parseLine('M3').professional, true);
  eq(N.parseLine('M0').value, 0);
}

/* ---------- P : programmazione ---------- */
eq(N.parseLine('P').type, 'program');

/* ---------- L : passaggio sul traguardo (esempio della specifica) ---------- */
{
  const p = N.parseLine('L0025,0C,0C,2C,4C,0C,3C,0C,1C');
  eq(p.type, 'lap');
  eq(p.leaderLaps, 25, 'RRRR decimale');
  eq(p.cars.length, 8);

  // posizione 0 = non partecipa
  eq(p.cars[0].position, 0);
  eq(p.cars[0].racing, false, 'posizione 0 = fuori gara');
  // auto 3 -> "2C" = posizione 2, velocita' C
  eq(p.cars[2].position, 2);
  eq(p.cars[2].maxSpeed, 0x0C);
  eq(p.cars[2].meaning, 'amateur');
  eq(p.cars[2].racing, true);
  // auto 8 -> "1C" = primo
  eq(p.cars[7].position, 1);
  eq(p.cars[7].car, 8);
  // ordine: l'indice segue l'identificativo dell'auto, 1..8
  eq(p.cars.map(c => c.car), [1, 2, 3, 4, 5, 6, 7, 8]);
}

/* ---------- L : significato dei valori di velocita' ---------- */
{
  const mk = (h) => N.parseLine(`L0001,1${h},00,00,00,00,00,00,00`).cars[0];
  eq(mk('0').stopped, true, '0 = pista spenta / box');
  eq(mk('0').meaning, 'stop');
  eq(mk('4').lowFuel, true, '4 = piano, benzina agli sgoccioli');
  eq(mk('4').meaning, 'slow');
  eq(mk('C').meaning, 'amateur');
  eq(mk('F').meaning, 'pro');
  eq(mk('F').maxSpeed, 15);
  eq(mk('A').maxSpeed, 10, 'esadecimale, non decimale');
  eq(mk('A').meaning, null, 'valore senza nome nella specifica');
}

/* ---------- F : benzina (esempio della specifica) ---------- */
{
  const p = N.parseLine('F99,I5,66,43,05,28,47,42');
  eq(p.type, 'fuel');
  eq(p.cars.length, 8);
  eq(p.cars[0].level, 99);
  eq(p.cars[1].reserve, true, 'I5 = riserva');
  eq(p.cars[1].level, null);
  eq(p.cars[2].level, 66);
  eq(p.cars[4].level, 5, '"05" = 5');
  // l'ottava auto ha le cifre invertite: "42" -> 24
  eq(p.cars[7].level, 24, 'auto 8: cifre invertite (LSB)');
  // con lo swap disattivato torna 42
  eq(N.parseLine('F99,I5,66,43,05,28,47,42', { swapCar8: false }).cars[7].level, 42);
  // "5I" e' "I5" rovesciato: comunque riserva
  eq(N.parseLine('F00,00,00,00,00,00,00,5I').cars[7].reserve, true);
}

/* ---------- D : risultato / tempi (esempio della specifica) ---------- */
{
  const p = N.parseLine('D0008,0004,000523,000213');
  eq(p.type, 'result');
  eq(p.car, 8);
  eq(p.laps, 4);
  // MMSSCC: 000523 = 0 min, 5 s, 23 centesimi
  eq(p.total.mm, 0); eq(p.total.ss, 5); eq(p.total.cc, 23);
  eq(p.total.ms, 5230);
  eq(p.best.ms, 2130);
  // l'esempio della specifica sul formato: 123456 = 12 min 34 s 56 cent
  const t = N.parseTime('123456');
  eq([t.mm, t.ss, t.cc], [12, 34, 56], 'MMSSCC, non HHMMSS');
  eq(t.ms, 12 * 60000 + 34 * 1000 + 560);
}

/* ---------- righe non valide ---------- */
{
  eq(N.parseLine(''), null);
  eq(N.parseLine('L0025,0C'), { type: 'unknown', raw: 'L0025,0C' }, 'campi mancanti');
  eq(N.parseLine('Z123').type, 'unknown', 'tipo sconosciuto: non lo butto');
  eq(N.parseLine('D0008,0004,0005,000213').type, 'unknown', 'tempo non a 6 cifre');
  eq(N.parseLine('L0025,0G,0C,0C,0C,0C,0C,0C,0C').type, 'unknown', 'G non e\' esadecimale');
}

/* ---------- Framer: i byte arrivano spezzati a caso ---------- */
{
  const f = new N.Framer();
  const bytes = (s) => [...s].map(c => c.charCodeAt(0));
  eq(f.push(bytes('M2\r')), ['M2']);
  // pacchetto spezzato in tre pezzi
  eq(f.push(bytes('L0025,0C,0C')), []);
  eq(f.push(bytes(',2C,4C,0C,3C')), []);
  eq(f.push(bytes(',0C,1C\r')), ['L0025,0C,0C,2C,4C,0C,3C,0C,1C']);
  // due pacchetti in un colpo solo, con LF di troppo
  eq(f.push(bytes('P\r\nM3\r')), ['P', 'M3']);
  // il CR da solo non produce righe vuote
  eq(f.push(bytes('\r\r')), []);
}

/* ---------- RaceState: i tempi sul giro si ricavano per differenza ---------- */
{
  const st = new N.RaceState();
  st.apply(N.parseLine('M2'));
  eq(st.professional, true);

  st.apply(N.parseLine('L0025,0C,0C,2C,4C,0C,3C,0C,1C'));
  eq(st.leaderLaps, 25);
  eq(st.car(8).position, 1);

  st.apply(N.parseLine('F99,I5,66,43,05,28,47,42'));
  eq(st.car(1).fuel, 99);
  eq(st.car(2).reserve, true);

  // primo passaggio: il totale E' il primo giro
  st.apply(N.parseLine('D0001,0001,001000,001000'));
  eq(st.car(1).lastLapMs, 10000);
  eq(st.car(1).bestMs, 10000);
  // secondo passaggio: 19.50 - 10.00 = 9.50
  st.apply(N.parseLine('D0001,0002,001950,000950'));
  eq(st.car(1).lastLapMs, 9500);
  eq(st.car(1).bestMs, 9500, 'il migliore si aggiorna');
  // terzo giro piu' lento: il migliore NON cambia
  st.apply(N.parseLine('D0001,0003,003000,000950'));
  eq(st.car(1).lastLapMs, 10500);
  eq(st.car(1).bestMs, 9500);
  eq(st.car(1).laps, 3);
  eq(st.sawResult, true, 'se arrivano D il firmware e\' >= 1.08');

  // La base ripete i pacchetti: la ripetizione non deve creare un giro da 0 ms
  st.apply(N.parseLine('D0001,0003,003000,000950'));
  eq(st.car(1).lastLapMs, 10500, 'pacchetto ripetuto ignorato');
  eq(st.car(1).bestMs, 9500, 'il giro veloce non diventa 0');

  // ordinamento per posizione, chi non corre in fondo
  const order = st.list().map(c => c.car);
  eq(order[0], 8, 'in testa chi ha posizione 1');
}

/* ---------- formattazione ---------- */
eq(N.formatMs(9500), '0:09.50');
eq(N.formatMs(75230), '1:15.23');
eq(N.formatMs(null), '—');

console.log('ninco.js: all assertions passed');
