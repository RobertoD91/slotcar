/* Test del motore di gara e del simulatore. Niente hardware, niente browser:
 *   node web/cronometro/race.test.js
 * Il motore e' scritto apposta senza DOM e con l'orologio iniettabile, cosi'
 * qui il tempo lo decidiamo noi e le gare sono ripetibili al millisecondo. */
const assert = require('assert');
const RACE = require('./race.js');
require('./sistemi/registry.js');
const SIM = require('./sistemi/sim.js');
const SISTEMI = globalThis.SISTEMI;

function eq(a, b, m) { assert.deepStrictEqual(a, b, m); }

/* Orologio finto: `clock.t` e' "adesso", lo muoviamo a mano. */
function fakeClock(t0) {
  const c = { t: t0 || 0 };
  c.now = () => c.t;
  c.adv = (ms) => { c.t += ms; return c.t; };
  return c;
}
function newRace(opts) {
  const clock = fakeClock(1000);
  const r = new RACE.Race(Object.assign({ now: clock.now }, opts));
  r._clock = clock;
  return r;
}

/* ---------- formattazione ---------- */
eq(RACE.formatMs(9500), '0:09.50');
eq(RACE.formatMs(75230), '1:15.23');
eq(RACE.formatMs(null), '—');
eq(RACE.formatClock(0), '0:00.00');
eq(RACE.formatClock(3661500), '1:01:01.50', 'oltre l\'ora compaiono le ore');

/* ---------- guidatori: si creano, si rinominano, si tolgono ---------- */
{
  const r = newRace({ guidatori: [{ slot: 1, name: 'Roberto' }, { slot: 2 }] });
  eq(r.guidatori.length, 2);
  eq(r.guidatore(1).name, 'Roberto');
  eq(r.guidatore(2).name, null, 'senza nome resta null: il nome lo mette la vista');

  r.rename(2, '  Ana  ');
  eq(r.guidatore(2).name, 'Ana', 'il nome viene ripulito dagli spazi');
  r.rename(2, '   ');
  eq(r.guidatore(2).name, null, 'nome vuoto = torna al valore predefinito');

  // un posto mai dichiarato compare da solo appena la pista ne parla
  r.feed({ type: 'lap', slot: 5, laps: 1, lapMs: 8000 });
  eq(r.guidatori.length, 3);
  eq(r.guidatori.map(g => g.slot), [1, 2, 5], 'sempre ordinati per posto');

  eq(r.removeGuidatore(2), true);
  eq(r.removeGuidatore(2), false, 'togliere due volte non esplode');
  eq(r.guidatori.map(g => g.slot), [1, 5]);
}

/* ---------- doppioni: i sistemi ripetono i pacchetti ---------- */
{
  const r = newRace({ guidatori: [{ slot: 1 }] });
  eq(!!r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 8000 }), true);
  eq(r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 8000 }), null, 'stesso giro = ripetizione');
  eq(r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 9999 }), null, 'anche con tempo diverso');
  eq(r.guidatore(1).laps, 1);
  eq(!!r.feed({ type: 'lap', slot: 1, laps: 2, lapMs: 7500 }), true);
  eq(r.guidatore(1).laps, 2);
}
{
  // sistema che NON dice il numero di giri: si guarda la distanza fra i passaggi
  const r = newRace({ guidatori: [{ slot: 1 }], minLapMs: 500 });
  const c = r._clock;
  eq(!!r.feed({ type: 'lap', slot: 1 }), true);
  c.adv(100);
  eq(r.feed({ type: 'lap', slot: 1 }), null, 'due passaggi a 100 ms = doppione');
  c.adv(7000);
  eq(!!r.feed({ type: 'lap', slot: 1 }), true);
  eq(r.guidatore(1).laps, 2);
  eq(r.guidatore(1).lastLapMs, 7100, 'tempo dal nostro orologio, ultima spiaggia');
}

/* ---------- tempo sul giro: le tre sorgenti ---------- */
{
  // 1) lo dice il sistema (DS200, oXigen)
  const r = newRace({ guidatori: [{ slot: 1 }] });
  r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 8123 });
  eq(r.guidatore(1).lastLapMs, 8123);
}
{
  // 2) differenza fra due totali (Ninco manda il tempo totale)
  const r = newRace({ guidatori: [{ slot: 1 }] });
  r.feed({ type: 'lap', slot: 1, laps: 1, totalMs: 9000 });
  eq(r.guidatore(1).lastLapMs, null, 'sul primo giro non c\'e\' un totale precedente');
  r.feed({ type: 'lap', slot: 1, laps: 2, totalMs: 17500 });
  eq(r.guidatore(1).lastLapMs, 8500);
  eq(r.guidatore(1).totalMs, 17500);
}

/* ---------- giro veloce: il primo giro non e' un record ---------- */
{
  const r = newRace({ guidatori: [{ slot: 1 }] });
  const rec = [];
  r.on('lap', (e) => rec.push(e.best));
  r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 9000 });
  r.feed({ type: 'lap', slot: 1, laps: 2, lapMs: 8000 });
  r.feed({ type: 'lap', slot: 1, laps: 3, lapMs: 8500 });
  eq(rec, [false, true, false], 'si annuncia solo quando si migliora davvero');
  eq(r.guidatore(1).bestLapMs, 8000);
  eq(r.bestLap().slot, 1);
}

/* ---------- pratica: parte da sola al primo passaggio ---------- */
{
  const r = newRace({ mode: 'pratica', guidatori: [{ slot: 1 }] });
  eq(r.state, RACE.STATE.IDLE);
  r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 8000 });
  eq(r.state, RACE.STATE.RUNNING, 'in pratica il via lo da\' il primo passaggio');
  r._clock.adv(5000);
  eq(r.elapsedMs(), 5000);
}

/* ---------- GP a giri: non parte da sola, finisce al traguardo ---------- */
{
  const r = newRace({ mode: 'gp', targetLaps: 3, guidatori: [{ slot: 1 }, { slot: 2 }] });
  const eventi = [];
  r.on('finish', (e) => eventi.push('finish:' + e.slot + ':' + e.position));
  r.on('end', (e) => eventi.push('end:' + (e.winner ? e.winner.slot : '-')));

  r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 8000 });
  eq(r.state, RACE.STATE.IDLE, 'in GP il passaggio da solo non fa partire niente');
  eq(r.guidatore(1).laps, 0, 'e i giri prima del via non contano');

  eq(r.command('start'), true);
  eq(r.state, RACE.STATE.RUNNING);

  const c = r._clock;
  for (let l = 1; l <= 3; l++) {
    c.adv(7000); r.feed({ type: 'lap', slot: 1, laps: l, lapMs: 7000 });
    c.adv(500);  r.feed({ type: 'lap', slot: 2, laps: l, lapMs: 7500 });
  }
  eq(r.state, RACE.STATE.FINISHED);
  eq(eventi, ['finish:1:1', 'end:1'], 'chi arriva primo a 3 giri vince e la gara chiude');
  // regola del GP a giri: alla bandiera si chiude, gli altri restano ai giri fatti
  eq(r.guidatore(2).laps, 2, 'il passaggio arrivato a gara chiusa non conta piu\'');
  eq(r.guidatore(2).finished, false);
  eq(r.standings().map(g => g.slot), [1, 2]);
}

/* ---------- classifica: giri, poi chi ci e' arrivato prima, poi giro veloce -- */
{
  const r = newRace({ guidatori: [{ slot: 1 }, { slot: 2 }, { slot: 3 }] });
  const c = r._clock;
  r.command('start');
  c.adv(7000); r.feed({ type: 'lap', slot: 2, laps: 1, lapMs: 7000 });
  c.adv(100);  r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 7100 });
  eq(r.standings().map(g => g.slot), [2, 1, 3], 'a pari giri e\' avanti chi e\' passato prima');
  c.adv(6000); r.feed({ type: 'lap', slot: 1, laps: 2, lapMs: 6000 });
  eq(r.standings().map(g => g.slot), [1, 2, 3], 'un giro in piu\' passa davanti');
  eq(r.standings()[2].slot, 3, 'chi non e\' mai passato resta ultimo');
}

/* ---------- classifica dichiarata dal sistema (la power base Ninco) ---------- */
{
  const r = newRace({ guidatori: [{ slot: 1 }, { slot: 2 }] });
  r.feed({ type: 'telemetry', slot: 1, position: 2 });
  eq(r.standings({ prefer: 'reported' }).map(g => g.slot), [1, 2],
    'con una sola posizione nota si resta sul calcolo nostro');
  r.feed({ type: 'telemetry', slot: 2, position: 1 });
  eq(r.standings({ prefer: 'reported' }).map(g => g.slot), [2, 1],
    'quando il sistema le da\' tutte, comandano le sue');
}

/* ---------- pausa: il tempo in pausa non si conta ---------- */
{
  const r = newRace({ mode: 'gp', guidatori: [{ slot: 1 }] });
  const c = r._clock;
  r.command('start');
  c.adv(10000);
  eq(r.command('pause'), true);
  eq(r.elapsedMs(), 10000);
  c.adv(60000);
  eq(r.elapsedMs(), 10000, 'in pausa il cronometro sta fermo');
  eq(r.command('resume'), true);
  c.adv(5000);
  eq(r.elapsedMs(), 15000);
  eq(r.command('resume'), false, 'un comando fuori posto non fa danni');
  r.command('stop');
  eq(r.state, RACE.STATE.FINISHED);
  c.adv(9999);
  eq(r.elapsedMs(), 15000, 'a gara finita il tempo e\' congelato');
}

/* ---------- stato annunciato dal sistema (il DS200 lo fa) ---------- */
{
  const r = newRace({ mode: 'gp', targetLaps: 5, guidatori: [{ slot: 1 }] });
  const stati = [];
  r.on('state', (e) => stati.push(e.state));
  r.feed({ type: 'state', state: 'countdown' });
  r.feed({ type: 'state', state: 'running' });
  r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 8000 });
  r.feed({ type: 'state', state: 'paused' });
  r.feed({ type: 'state', state: 'running' });
  r.feed({ type: 'state', state: 'finished' });
  eq(stati, ['countdown', 'running', 'paused', 'running', 'finished']);
  eq(r.guidatore(1).laps, 1, 'i giri fatti restano nella classifica finale');
}

/* ---------- il semaforo di RIPRESA non azzera la gara ----------------------
   Riproduce la sequenza vera del DS200 (catturata in pista): dopo la pausa la
   centralina rimanda le fasi 2 e 3, cioe' rifa' il semaforo. Il difetto stava
   qui: entrare in countdown azzerava tutto e la classifica spariva. */
{
  const r = newRace({ mode: 'gp', targetLaps: 25, guidatori: [{ slot: 1 }, { slot: 2 }] });
  const c = r._clock;
  r.feed({ type: 'state', state: 'newrace' });     // fase 1: gara nuova
  r.feed({ type: 'state', state: 'countdown' });   // fase 2
  r.feed({ type: 'state', state: 'running' });     // fase 3: via
  c.adv(5039); r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: null });
  c.adv(5039); r.feed({ type: 'lap', slot: 1, laps: 2, lapMs: 5039 });
  eq(r.guidatore(1).laps, 2);

  c.adv(1000);
  r.feed({ type: 'state', state: 'paused' });      // A5
  c.adv(30000);                                    // 30 s di pausa
  r.feed({ type: 'state', state: 'running' });     // A6 fine pausa
  r.feed({ type: 'state', state: 'countdown' });   // A2 ← il semaforo di ripresa
  eq(r.guidatore(1).laps, 2, 'la classifica sopravvive al semaforo di ripresa');
  const fermo = r.elapsedMs();
  c.adv(2000);
  eq(r.elapsedMs(), fermo, 'e durante il semaforo il cronometro sta fermo');

  r.feed({ type: 'state', state: 'running' });     // A3
  c.adv(4000); r.feed({ type: 'lap', slot: 1, laps: 3, lapMs: 22197 });
  eq(r.guidatore(1).laps, 3, 'i giri riprendono da dove erano');
  eq(r.guidatore(1).bestLapMs, 5039, 'e il giro veloce non si perde');
  eq(r.elapsedMs(), 5039 + 5039 + 1000 + 4000, 'pausa e semaforo restano fuori dal tempo');
}

/* ---------- la fase 1 invece azzera davvero (gara nuova) ---------- */
{
  const r = newRace({ mode: 'gp', targetLaps: 5, guidatori: [{ slot: 1 }] });
  r.feed({ type: 'state', state: 'running' });
  r.feed({ type: 'lap', slot: 1, laps: 4, lapMs: 7000 });
  eq(r.guidatore(1).laps, 4);
  r.feed({ type: 'state', state: 'newrace' });
  eq(r.guidatore(1).laps, 0, 'la fase 1 apre una gara nuova');
  eq(r.state, RACE.STATE.COUNTDOWN);
  eq(r.elapsedMs(), 0);
}

/* ---------- rete di sicurezza: i giri non tornano indietro ---------- */
{
  const r = newRace({ guidatori: [{ slot: 1 }, { slot: 2 }] });
  const c = r._clock;
  r.command('start');
  c.adv(7000); r.feed({ type: 'lap', slot: 1, laps: 8, lapMs: 7000 });
  c.adv(7000); r.feed({ type: 'lap', slot: 2, laps: 7, lapMs: 7000 });
  let riavvii = 0;
  r.on('restart', () => riavvii++);
  // la pista ricomincia a contare: o siamo entrati a gara iniziata, o ne è partita una nuova
  c.adv(7000); r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: null });
  eq(riavvii, 1, 'un giro che torna indietro = la pista ha ricominciato');
  eq(r.guidatore(1).laps, 1);
  eq(r.guidatore(2).laps, 0, 'azzerati tutti, non solo chi ha mandato l\'evento');
  eq(r.elapsedMs(), 0, 'e il cronometro riparte da zero');
}

/* ---------- quando comanda il sistema, il motore non chiude la gara ---------- */
{
  const r = newRace({ mode: 'gp', targetLaps: 3, authority: 'sistema', guidatori: [{ slot: 1 }] });
  const c = r._clock;
  r.feed({ type: 'state', state: 'running' });
  for (let l = 1; l <= 5; l++) { c.adv(7000); r.feed({ type: 'lap', slot: 1, laps: l, lapMs: 7000 }); }
  eq(r.state, RACE.STATE.RUNNING, 'oltre il traguardo si continua: la bandiera la dà la centralina');
  eq(r.guidatore(1).laps, 5);
  r.feed({ type: 'state', state: 'finished' });
  eq(r.state, RACE.STATE.FINISHED);

  const a = newRace({ mode: 'gp', targetLaps: 3, guidatori: [{ slot: 1 }] });
  a.command('start');
  for (let l = 1; l <= 3; l++) { a._clock.adv(7000); a.feed({ type: 'lap', slot: 1, laps: l, lapMs: 7000 }); }
  eq(a.state, RACE.STATE.FINISHED, 'con l\'autorità all\'app il traguardo chiude la gara');
}

/* ---------- chi comanda: la formula ---------- */
{
  const A = SISTEMI.authority;
  eq(A({ control: true, raceState: true }), 'app', 'se accetta comandi, comanda l\'app');
  eq(A({ control: false, raceState: true }), 'sistema', 'annuncia ma non obbedisce: comanda lui');
  eq(A({ control: false, raceState: false }), 'app', 'né l\'uno né l\'altro: comanda l\'app');
  eq(A(null), 'app');
  eq(A(SISTEMI.get('sim').caps), 'app', 'il simulatore obbedisce');
}

/* ---------- azzeramento ---------- */
{
  const r = newRace({ guidatori: [{ slot: 1, name: 'Roberto' }] });
  r.command('start');
  r.feed({ type: 'lap', slot: 1, laps: 4, lapMs: 8000 });
  r.command('reset');
  eq(r.state, RACE.STATE.IDLE);
  eq(r.guidatore(1).laps, 0);
  eq(r.guidatore(1).bestLapMs, null);
  eq(r.guidatore(1).name, 'Roberto', 'azzerare la gara NON cancella i guidatori');
  eq(r.elapsedMs(), 0);
}

/* ---------- telemetria ---------- */
{
  const r = newRace({ guidatori: [{ slot: 1 }] });
  r.feed({ type: 'telemetry', slot: 1, fuel: 42, reserve: false, pit: true });
  eq(r.guidatore(1).fuel, 42);
  eq(r.guidatore(1).pit, true);
  r.feed({ type: 'telemetry', slot: 1, fuel: null, reserve: true });
  eq(r.guidatore(1).reserve, true);
  eq(r.guidatore(1).pit, true, 'un campo non citato resta com\'era');
}

/* ---------- registro dei sistemi ---------- */
{
  const def = SISTEMI.get('sim');
  eq(def.id, 'sim');
  eq(def.caps.control, true);
  eq(def.caps.needsUserGesture, false, 'i valori dichiarati vincono sui predefiniti');
  eq(SISTEMI.available(def), true, 'il simulatore non ha bisogno di nessun bus');
  eq(SISTEMI.available({ bus: 'serial' }), typeof navigator !== 'undefined' && 'serial' in navigator);
  eq(SISTEMI.list().some(d => d.id === 'sim'), true);
  assert.throws(() => SISTEMI.create('inesistente'), /sconosciuto/);
}

/* ---------- simulatore: stesso seme, stessa gara ---------- */
{
  const a = SIM.plan({ seed: 7, cars: 4, maxLaps: 10 });
  const b = SIM.plan({ seed: 7, cars: 4, maxLaps: 10 });
  eq(JSON.stringify(a.events), JSON.stringify(b.events), 'il seme rende la gara ripetibile');

  const d = SIM.plan({ seed: 8, cars: 4, maxLaps: 10 });
  assert.notStrictEqual(JSON.stringify(a.events), JSON.stringify(d.events), 'semi diversi, gare diverse');

  eq(a.cars.length, 4);
  eq(a.events.every((e, i, arr) => i === 0 || arr[i - 1].at <= e.at), true, 'eventi in ordine di tempo');

  const giri = a.events.filter(e => e.ev.type === 'lap');
  eq(giri.length, 40, '4 guidatori x 10 giri');
  eq(giri.every(e => e.ev.lapMs > 0 && e.ev.laps > 0), true);

  // benzina: cala, va in riserva, e ai box torna piena. Con 6 unita' a giro su
  // 99 il serbatoio dura ~16 giri, quindi qui serve una gara piu' lunga.
  const lunga = SIM.plan({ seed: 7, cars: 2, maxLaps: 20 });
  const tele = lunga.events.filter(e => e.ev.type === 'telemetry').map(e => e.ev);
  eq(tele.some(e => e.reserve), true, 'prima o poi si va in riserva');
  eq(tele.some(e => e.pit), true, 'e prima o poi si rifornisce');
  eq(tele.every(e => e.fuel >= 0 && e.fuel <= SIM.DEFAULTS.fuelStart), true);
  // il giro del rifornimento e' piu' lungo: la sosta si vede nei tempi. Il
  // confronto e' con il giro piu' veloce di QUELLA auto, non con un numero
  // fisso: ogni guidatore ha il suo passo.
  const soste = lunga.events.filter(e => e.ev.type === 'telemetry' && e.ev.pit);
  eq(soste.length > 0, true, 'nei 20 giri ci sta almeno una sosta');
  soste.forEach((s) => {
    const giro = lunga.events.find(e => e.ev.type === 'lap' && e.at === s.at && e.ev.slot === s.ev.slot);
    const veloce = Math.min(...lunga.events
      .filter(e => e.ev.type === 'lap' && e.ev.slot === s.ev.slot).map(e => e.ev.lapMs));
    eq(giro.ev.lapMs > veloce + SIM.DEFAULTS.pitMs * 0.8, true, 'il giro con sosta e\' molto piu\' lento');
  });
}

/* ---------- simulatore + motore: una gara intera, in automatico ---------- */
{
  const p = SIM.plan({ seed: 99, cars: 4, maxLaps: 60 });
  const clock = fakeClock(0);
  const r = new RACE.Race({
    now: clock.now, mode: 'gp', targetLaps: 15,
    guidatori: [{ slot: 1 }, { slot: 2 }, { slot: 3 }, { slot: 4 }]
  });
  let fine = null;
  r.on('end', (e) => { if (!fine) fine = e; });
  r.command('start');
  for (const item of p.events) {
    clock.t = item.at;
    r.feed(item.ev);
    if (fine) break;
  }
  eq(r.state, RACE.STATE.FINISHED, 'la gara finisce da sola');
  eq(fine.winner.laps >= 15, true, 'il vincitore ha tagliato il traguardo');
  eq(fine.winner.finishPos, 1);
  eq(fine.standings[0].slot, fine.winner.slot);
  // nessuno puo' avere piu' giri del vincitore quando la bandiera e' gia' scesa
  eq(fine.standings.every(g => g.laps <= fine.winner.laps), true);
  // ognuno ha un giro veloce sensato
  eq(fine.standings.every(g => g.bestLapMs > 3000 && g.bestLapMs < 30000), true);
}

/* ---------- frame ripetuti: la centralina li manda TRE volte ---------- */
{
  /* Il DS200 ripete ogni frame tre volte. Chiudere una gara gia' chiusa non e'
     un evento: senza la guardia in _finish, la voce annunciava il vincitore
     tre volte di fila. */
  const r = newRace({ mode: 'gp', targetLaps: 3 });
  let fini = 0;
  r.on('end', () => fini++);
  r.feed({ type: 'state', state: 'running' });
  r._clock.adv(5000);
  r.feed({ type: 'lap', slot: 1, laps: 1, lapMs: 5000 });

  r.feed({ type: 'state', state: 'finished' });
  r.feed({ type: 'state', state: 'finished' });
  r.feed({ type: 'state', state: 'finished' });
  eq(fini, 1, "'end' una volta sola anche se il frame arriva tre volte");

  // e nemmeno lo stop manuale la richiude
  r.command('stop');
  eq(fini, 1, 'nemmeno uno stop dopo la fine riapre e richiude la gara');

  // ma una gara NUOVA puo' finire di nuovo
  r.command('newrace');
  r.feed({ type: 'state', state: 'running' });
  r.feed({ type: 'state', state: 'finished' });
  eq(fini, 2, 'una gara nuova pero' + String.fromCharCode(39) + ' finisce davvero');
}

/* ---------- rinominare non e' un cambio di roster ---------- */
{
  /* 'roster' vuol dire "chi c'e' e' cambiato", e chi ascolta ridisegna l'elenco
     da capo — cancellando la casella di testo sotto le dita di chi sta
     scrivendo. Rinominare non cambia chi c'e'. */
  const r = newRace({});
  r.guidatore(1);
  let roster = 0, rename = 0;
  r.on('roster', () => roster++);
  r.on('rename', () => rename++);

  'Roberto'.split('').forEach((_, i) => r.rename(1, 'Roberto'.slice(0, i + 1)));
  eq(roster, 0, 'sette lettere, zero eventi roster');
  eq(rename, 7, 'ma sette eventi rename, uno per lettera');
  eq(r.bySlot[1].name, 'Roberto');

  // aggiungere e togliere invece SI'
  r.guidatore(2);
  eq(roster, 1, 'un posto nuovo cambia il roster');
  r.removeGuidatore(2);
  eq(roster, 2, 'e toglierlo pure');
}

/* ---------- simulatore: riproduzione a tempo reale (accelerata) ---------- */
(async () => {
  const s = SISTEMI.create('sim', {
    values: { seed: 3, speed: 400 }, cars: 3, settings: { maxLaps: 6 }
  });
  const clock = fakeClock(0);
  const r = new RACE.Race({ now: () => Date.now(), mode: 'pratica' });
  s.on('event', (ev) => r.feed(ev));
  await s.connect();
  eq(s.status, SISTEMI.STATUS.ON);
  eq(r.guidatori.length, 3, 'i posti compaiono appena il sistema si collega');

  s.command('start');
  await new Promise((res) => setTimeout(res, 600));
  s.command('stop');
  await s.disconnect();
  eq(r.guidatori.every(g => g.laps > 0), true, 'a 400x in mezzo secondo hanno tutti girato');
  eq(s.status, SISTEMI.STATUS.OFF);

  console.log('race.js + sim.js: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
