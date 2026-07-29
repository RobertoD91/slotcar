/* app.js — Web Serial UI for the DS200/DS300 monitor. */
(function () {
  'use strict';

  // Bump on every release. Shown in the footer so you can tell at a glance
  // whether the browser/PWA cache served a stale version. Keep in sync with the
  // ?v= query strings in index.html and the cache name in sw.js.
  const APP_VERSION = '1.5.3';

  const $ = (id) => document.getElementById(id);
  const els = {
    connect: $('connect'), disconnect: $('disconnect'), status: $('status'),
    baud: $('baud'), nosupport: $('nosupport'),
    dev: $('dev'), raceState: $('race-state'), clock: $('clock'), counters: $('counters'),
    lanes: $('lanes'), events: $('events'), log: $('log'),
    reset: $('reset'), export: $('export'), clearlog: $('clearlog'),
    hideInvalid: $('hideInvalid'), installHint: $('install-hint'),
    version: $('version'), tts: $('tts'), lang: $('lang'),
    cmdCard: $('cmd-card'), cmdDev: $('cmdDev'), cmdHex: $('cmdHex'),
    cmdSend: $('cmdSend'), cmdStatus: $('cmdStatus'),
  };

  // ---- State ----------------------------------------------------------------
  let port = null;
  let reader = null;
  let keepReading = false;
  const framer = DS200.Framer(onFrame);

  const lanes = new Map();      // lane number -> { laps, lastText, lastSec, bestText, bestSec, ts }
  let totalFrames = 0;
  let okFrames = 0;
  let raceFn = null;            // current race function key (for i18n re-render)
  let device = '—';
  const allRows = [];           // for CSV export

  // ---- Race lifecycle ------------------------------------------------------
  let raceActive = false;       // between a start sequence and end/abort
  let lapsSinceStart = 0;       // crossings seen since the start (to re-anchor the clock)
  let winner = null;            // winning lane object once a race ends
  let lastFinalTotalSec = 0;    // max total time from final_record frames
  let winnerTimer = null;       // debounce so final_record frames arrive before we pick

  // Free-running race stopwatch (independent from the per-lap times in frames).
  const raceClock = (function () {
    let running = false, startMs = 0, pausedAccum = 0, pauseStart = 0, frozenMs = null;
    function liveMs() {
      let e = performance.now() - startMs - pausedAccum;
      if (pauseStart) e -= (performance.now() - pauseStart);
      return e;
    }
    return {
      start() { running = true; startMs = performance.now(); pausedAccum = 0; pauseStart = 0; frozenMs = null; },
      // Snap the elapsed time to `ms` (data from the timing box) and keep running.
      syncTo(ms) { running = true; startMs = performance.now() - ms; pausedAccum = 0; pauseStart = 0; frozenMs = null; },
      pause() { if (running && !pauseStart) pauseStart = performance.now(); },
      resume() { if (running && pauseStart) { pausedAccum += performance.now() - pauseStart; pauseStart = 0; } },
      stop() { if (running) { frozenMs = liveMs(); running = false; pauseStart = 0; } },
      freezeAt(ms) { running = false; pauseStart = 0; frozenMs = ms; },
      reset() { running = false; startMs = 0; pausedAccum = 0; pauseStart = 0; frozenMs = null; },
      isRunning() { return running; },
      elapsedMs() { return running ? liveMs() : (frozenMs != null ? frozenMs : 0); },
    };
  })();

  // i18n shortcut
  const t = (k, p) => I18N.t(k, p);
  // Translated label for a function/event frame.
  const funcLabel = (f) => (f.function ? t('func.' + f.function) : (f.functionLabel || ''));

  // ---- Text-to-speech (Web Speech API) -------------------------------------
  const ttsSupported = 'speechSynthesis' in window;
  let ttsVoice = null;
  const announcedLaps = new Set();   // "lane:laps" already spoken (frames repeat 3x)
  let lastSpokenRace = null;

  function pickVoice() {
    if (!ttsSupported) return;
    const lang = I18N.current;       // 2-letter
    const vs = speechSynthesis.getVoices();
    ttsVoice = vs.find((v) => new RegExp('^' + lang + '[-_]', 'i').test(v.lang)) ||
               vs.find((v) => (v.lang || '').toLowerCase().startsWith(lang)) || null;
  }
  if (ttsSupported) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function speak(text) {
    if (!ttsSupported || !els.tts || !els.tts.checked) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = I18N.bcp47();
    if (ttsVoice) u.voice = ttsVoice;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  // "00:01:23.4567" -> localized "1 minuti 23 secondi e 45" (centiseconds).
  function spokenTime(f) {
    const h = f.hours || 0, m = f.minutes || 0, s = f.seconds || 0;
    const cc = String(Math.floor((f.fraction4digits || 0) / 100)).padStart(2, '0');
    const parts = [];
    if (h > 0) parts.push(h + ' ' + t('time.h'));
    if (m > 0) parts.push(m + ' ' + t('time.m'));
    parts.push(t('time.secAnd', { s: s, cc: cc }));
    return parts.join(' ');
  }

  function announce(f) {
    if (!ttsSupported || !els.tts || !els.tts.checked) return;
    // Race-state changes. The DS200 sends start phase 1/2/3 as a countdown -> we
    // collapse them into a single "start" announcement. The winner is announced
    // separately at the end, so we skip the generic "race end" phrase.
    if (f.dataType === 'function' && f.function) {
      const isStart = f.function.indexOf('start_race_phase') === 0;
      const key = isStart ? 'race_start' : f.function;
      if (key !== lastSpokenRace) {
        lastSpokenRace = key;
        if (f.function !== 'end_race') speak(isStart ? t('func.race_start') : funcLabel(f));
      }
    }
    // New completed lap with a real time (skip the no-time first crossing).
    if (f.lane && f.timeText && f.dataType === 'timing_data') {
      const key = f.lane + ':' + f.laps;
      if (!announcedLaps.has(key)) {
        announcedLaps.add(key);
        let txt = t('lane') + ' ' + f.lane + ', ' + t('word.lap') + ' ' + f.laps + ', ' + spokenTime(f);
        if (f._fastLap) txt += ', ' + t('tag.fastlap');   // only on a new personal best
        speak(txt);
      }
    }
  }

  // ---- Web Serial -----------------------------------------------------------
  if (!('serial' in navigator)) {
    els.nosupport.hidden = false;
    els.connect.disabled = true;
  }

  async function connect() {
    try {
      port = await navigator.serial.requestPort();
      await port.open({
        baudRate: Number(els.baud.value),
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        flowControl: 'none',
      });
      // Match ds300.c / Python: keep RTS & DTR low.
      try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) {}

      setStatus('on', 'status.connected', { baud: els.baud.value });
      els.connect.disabled = true;
      els.disconnect.disabled = false;
      els.baud.disabled = true;
      if (els.cmdCard) els.cmdCard.classList.remove('disabled');
      keepReading = true;
      framer.reset();
      readLoop();
    } catch (err) {
      if (err && err.name === 'NotFoundError') return; // user cancelled picker
      setStatus('off', 'status.error', { msg: (err && err.message ? err.message : err) });
    }
  }

  async function readLoop() {
    while (port && port.readable && keepReading) {
      reader = port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) framer.push(value);
        }
      } catch (err) {
        setStatus('off', 'status.readInterrupted', { msg: (err && err.message ? err.message : err) });
      } finally {
        try { reader.releaseLock(); } catch (e) {}
        reader = null;
      }
    }
  }

  async function disconnect() {
    keepReading = false;
    try { if (reader) await reader.cancel(); } catch (e) {}
    try { if (port) await port.close(); } catch (e) {}
    port = null;
    setStatus('off', 'status.disconnected');
    els.connect.disabled = false;
    els.disconnect.disabled = true;
    els.baud.disabled = false;
    if (els.cmdCard) els.cmdCard.classList.add('disabled');
  }

  let lastStatus = { cls: 'off', key: 'status.disconnected', params: null };
  function setStatus(cls, key, params) {
    lastStatus = { cls, key, params: params || null };
    els.status.className = 'status ' + cls;
    els.status.textContent = t(key, params);
  }

  // ---- Experimental command sender (Web Serial write) ----------------------
  // The DS protocol is documented receive-only; these are best-effort attempts.
  let txCounter = 0;
  function buildCommand(fnByte, deviceId) {
    const f = new Array(21).fill(0);
    f[0] = 0xE0; f[1] = (++txCounter) & 0xFF; f[2] = 0x15; f[3] = deviceId & 0xFF;
    f[7] = 0x00; f[8] = fnByte & 0xFF; f[20] = 0xEB;
    f[19] = 0;                                  // control byte
    f[18] = DS200.calcChecksum(f);
    // PDF rule: if the checksum equals 0xE0/0xEB, bump the control byte and redo.
    while (f[18] === 0xE0 || f[18] === 0xEB) { f[19] = (f[19] + 1) & 0xFF; f[18] = DS200.calcChecksum(f); }
    return Uint8Array.from(f);
  }
  async function sendBytes(bytes) {
    if (!port || !port.writable) { cmdFeedback(t('cmd.notconn')); return; }
    try {
      const w = port.writable.getWriter();
      try { await w.write(bytes); } finally { w.releaseLock(); }
      cmdFeedback(t('cmd.sent') + ': ' + Array.from(bytes).map(DS200.hex2).join(' '));
    } catch (err) {
      cmdFeedback('✗ ' + (err && err.message ? err.message : err));
    }
  }
  function cmdFeedback(msg) {
    if (els.cmdStatus) els.cmdStatus.textContent = msg;
  }

  // ---- Frame handling -------------------------------------------------------
  function onFrame(bytes) {
    let f;
    try { f = DS200.parseFrame(bytes); } catch (e) { return; }

    totalFrames++;
    if (f.checksumOk && f.validStart && f.validEnd && f.validLength) okFrames++;
    els.counters.textContent = okFrames + ' / ' + totalFrames;

    device = f.device;
    els.dev.textContent = device;

    allRows.push(f);
    appendLog(f);

    // Race lifecycle (start sequence / pause / end) drives the running clock.
    if (f.dataType === 'function' && f.function) handleFunction(f);

    // Race-state / events from "function" data words.
    if (f.dataType === 'function' && funcLabel(f)) {
      raceFn = f.function;
      if (!winner) els.raceState.textContent = funcLabel(f);
      addEvent(f, funcLabel(f) + (f.programHi !== null
        ? ' · prog 0x' + DS200.hex2(f.programHi) + DS200.hex2(f.programLo) : ''));
    }

    // Per-lane timing / final record.
    if (f.lane && (f.dataType === 'timing_data' || f.dataType === 'final_record_data')) {
      updateLane(f);
    }

    // Fast-lap event only when a lane sets a NEW personal best (not every frame
    // of the record-holding lane, which is what the 0xA9 flag would give).
    if (f._fastLap && f.lane && f.timeText) {
      addEvent(f, t('tag.fastlap') + ' — ' + t('lane') + ' ' + f.lane + ' · ' + f.timeText);
    }

    // Voice announcements (Web Speech API).
    announce(f);
  }

  // ---- Race lifecycle handlers ---------------------------------------------
  function handleFunction(f) {
    const fn = f.function;
    if (fn.indexOf('start_race_phase') === 0) {
      if (!raceActive) {
        raceActive = true;
        lapsSinceStart = 0;
        resetRaceData();
        raceClock.start();
      } else if (lapsSinceStart === 0) {
        raceClock.start();   // re-anchor to the latest start phase (the green light)
      }
    } else if (fn === 'start_pause') {
      raceClock.pause();
    } else if (fn === 'end_pause') {
      raceClock.resume();
    } else if (fn === 'end_race') {
      raceActive = false;
      raceClock.stop();
      if (winnerTimer) clearTimeout(winnerTimer);
      winnerTimer = setTimeout(finalizeRace, 1500);  // let final_record frames arrive
    } else if (fn === 'abort_race') {
      raceActive = false;
      raceClock.stop();
      if (winnerTimer) { clearTimeout(winnerTimer); winnerTimer = null; }
    }
  }

  function finalizeRace() {
    winnerTimer = null;
    if (lastFinalTotalSec > 0) raceClock.freezeAt(lastFinalTotalSec * 1000);
    const w = sortedLanes()[0];
    if (w && w.laps > 0) {
      winner = w;
      const txt = '🏆 ' + t('lane') + ' ' + w.lane;
      els.raceState.textContent = txt;
      els.raceState.classList.add('winner');
      addEvent({ ts: Date.now() / 1000 }, txt);
      if (ttsSupported && els.tts && els.tts.checked) {
        speak(t('tts.winner', { lane: t('lane'), n: w.lane }));
      }
    }
  }

  function resetRaceData() {
    lanes.clear();
    announcedLaps.clear();
    winner = null;
    lastFinalTotalSec = 0;
    if (winnerTimer) { clearTimeout(winnerTimer); winnerTimer = null; }
    els.raceState.classList.remove('winner');
    renderLanes();
  }

  function updateLane(f) {
    let st = lanes.get(f.lane);
    if (!st) {
      st = { laps: 0, lastText: '—', lastSec: null, bestText: '—', bestSec: null,
             finalSec: null, cumulSec: 0, countedLap: -1, ts: 0 };
      lanes.set(f.lane, st);
    }
    if (f.laps !== null) st.laps = f.laps;

    if (f.dataType === 'timing_data') {
      lapsSinceStart++;   // any crossing means the green has passed (stop re-anchoring)
      if (f.timeText) {
        st.lastText = f.timeText;
        st.lastSec = f.timeSeconds;
        // "Fast lap" = a genuinely faster lap for THIS lane. The 0xA9 flag in the
        // frame just marks the lane that currently holds the record (set on every
        // one of its laps), so we compute the real thing from the times instead.
        const hadBest = st.bestSec !== null;
        const newBest = f.timeSeconds > 0 && (st.bestSec === null || f.timeSeconds < st.bestSec);
        if (newBest) { st.bestText = f.timeText; st.bestSec = f.timeSeconds; }
        f._fastLap = newBest && hadBest;   // announce only when beating a previous best
        // Accumulate this lane's total time (once per lap; frames repeat 3x) and
        // sync the big clock to the box's data, then keep it running.
        if (f.timeSeconds > 0 && f.laps !== st.countedLap) {
          st.countedLap = f.laps;
          st.cumulSec += f.timeSeconds;
          let maxCumul = 0;
          lanes.forEach((s) => { if (s.cumulSec > maxCumul) maxCumul = s.cumulSec; });
          raceClock.syncTo(maxCumul * 1000);
        }
      }
    } else if (f.dataType === 'final_record_data') {
      // Total race time for the lane — don't treat it as a lap time.
      if (f.timeSeconds > 0) {
        st.finalSec = f.timeSeconds;
        if (f.timeSeconds > lastFinalTotalSec) lastFinalTotalSec = f.timeSeconds;
      }
    }
    st.ts = f.ts;
    renderLanes();
  }

  function sortedLanes() {
    const rows = Array.from(lanes.entries()).map(([lane, st]) => ({ lane, ...st }));
    rows.sort((a, b) => {
      if (b.laps !== a.laps) return b.laps - a.laps;
      const av = a.bestSec == null ? Infinity : a.bestSec;
      const bv = b.bestSec == null ? Infinity : b.bestSec;
      return av - bv;
    });
    return rows;
  }

  function renderLanes() {
    const rows = sortedLanes();
    els.lanes.innerHTML = rows.map((r, i) => {
      const win = winner && r.lane === winner.lane;
      return '<tr' + (win ? ' class="winrow"' : '') + '>' +
        '<td class="pos">' + (win ? '🏆 ' : '') + (i + 1) + '</td>' +
        '<td>' + t('lane') + ' ' + r.lane + '</td>' +
        '<td class="mono">' + r.laps + '</td>' +
        '<td class="mono">' + r.lastText + '</td>' +
        '<td class="mono best">' + r.bestText + '</td>' +
        '<td class="muted">' + timeAgo(r.ts) + '</td>' +
        '</tr>';
    }).join('');
  }

  function addEvent(f, text) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="t mono">' + clock(f.ts) + '</span> ' + escapeHtml(text);
    els.events.prepend(li);
    while (els.events.children.length > 80) els.events.lastChild.remove();
  }

  function appendLog(f) {
    if (els.hideInvalid.checked && f.warnings.length) return;
    const cls = f.warnings.length ? 'bad' : 'ok';
    const line =
      '[' + clock(f.ts) + '] ' + f.device + ' ' + f.dataType +
      (f.function ? ' ' + f.function : '') +
      (f.lane ? ' lane' + f.lane : '') +
      ' laps=' + (f.laps == null ? '?' : f.laps) +
      ' t=' + (f.timeText || (f.noTime ? t('log.firstlap') : '?')) +
      ' cks=' + (f.checksumOk ? 'OK' : 'BAD') +
      (f.warnings.length ? '  ⚠ ' + f.warnings.join('; ') : '') +
      '\n  ' + f.rawHex + '\n';
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = line;
    els.log.appendChild(span);
    while (els.log.children.length > 400) els.log.firstChild.remove();
    els.log.scrollTop = els.log.scrollHeight;
  }

  // ---- Helpers --------------------------------------------------------------
  function clock(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString(I18N.bcp47(), { hour12: false }) +
      '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
  function timeAgo(ts) {
    if (!ts) return '—';
    const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
    if (s < 1) return t('ago.now');
    if (s < 60) return t('ago.sec', { n: s });
    return t('ago.min', { n: Math.floor(s / 60) });
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Elapsed ms -> "HH:MM:SS.cc" (centiseconds) for the running race clock.
  function fmtElapsed(ms) {
    if (!(ms > 0)) ms = 0;
    const cs = Math.floor(ms / 10), cc = cs % 100;
    const tot = Math.floor(cs / 100), s = tot % 60, m = Math.floor(tot / 60) % 60, h = Math.floor(tot / 3600);
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(h) + ':' + p2(m) + ':' + p2(s) + '.' + p2(cc);
  }

  function exportCsv() {
    const header = ['ts_iso', 'device', 'data_type', 'function', 'identifier', 'lane', 'laps', 'time_text', 'checksum_ok', 'warnings', 'raw_hex'];
    const lines = [header.join(',')];
    for (const f of allRows) {
      const row = [
        new Date(f.ts * 1000).toISOString(),
        f.device, f.dataType, f.function || '', f.identifier || '',
        f.lane || '', f.laps == null ? '' : f.laps, f.timeText || '',
        f.checksumOk, '"' + f.warnings.join('|') + '"', f.rawHex,
      ];
      lines.push(row.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ds200_log_' + Date.now() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function resetState() {
    lanes.clear();
    totalFrames = 0; okFrames = 0;
    allRows.length = 0;
    raceFn = null; device = '—';
    announcedLaps.clear();
    lastSpokenRace = null;
    raceActive = false; lapsSinceStart = 0; winner = null; lastFinalTotalSec = 0;
    if (winnerTimer) { clearTimeout(winnerTimer); winnerTimer = null; }
    raceClock.reset();
    els.counters.textContent = '0 / 0';
    els.raceState.textContent = '—';
    els.raceState.classList.remove('winner');
    els.dev.textContent = '—';
    els.clock.textContent = '00:00:00.00';
    els.lanes.innerHTML = '';
    els.events.innerHTML = '';
  }

  // ---- Wiring ---------------------------------------------------------------
  els.connect.addEventListener('click', connect);
  els.disconnect.addEventListener('click', disconnect);
  els.reset.addEventListener('click', resetState);
  els.export.addEventListener('click', exportCsv);
  els.clearlog.addEventListener('click', () => { els.log.innerHTML = ''; });
  window.addEventListener('beforeunload', () => { if (port) disconnect(); });

  // Experimental commands: function buttons + raw hex sender.
  if (els.cmdCard) {
    els.cmdCard.classList.add('disabled');   // enabled once connected
    els.cmdCard.querySelectorAll('[data-cmd]').forEach((b) => {
      b.addEventListener('click', () => {
        const fn = parseInt(b.getAttribute('data-cmd'), 16);
        sendBytes(buildCommand(fn, Number(els.cmdDev.value)));
      });
    });
    if (els.cmdSend) els.cmdSend.addEventListener('click', () => {
      const bytes = DS200.parseHexString(els.cmdHex.value || '');
      if (bytes.length) sendBytes(bytes); else cmdFeedback('—');
    });
  }

  // Voice toggle: hide if unsupported; speaking on the click also unlocks audio
  // on iOS (which requires a user gesture before the first utterance).
  if (!ttsSupported) {
    const lbl = $('tts-label');
    if (lbl) lbl.style.display = 'none';
  } else if (els.tts) {
    els.tts.addEventListener('change', () => {
      if (els.tts.checked) { pickVoice(); speak(t('tts.on')); }
      else speechSynthesis.cancel();
    });
  }

  // ---- i18n: detect language, apply, and wire the language menu -------------
  function refreshDynamic() {
    // Re-render everything that is built in JS (not covered by data-i18n).
    setStatus(lastStatus.cls, lastStatus.key, lastStatus.params);
    els.raceState.textContent = raceFn ? t('func.' + raceFn) : '—';
    renderLanes();
    if (els.version) els.version.textContent = 'v' + APP_VERSION;
    document.title = 'Contagiri DS200 / DS300 v' + APP_VERSION;
    if (installHintShown) showInstallHint();
  }

  I18N.init();
  if (els.lang) {
    els.lang.value = I18N.current;
    els.lang.addEventListener('change', () => {
      I18N.setLang(els.lang.value);
      I18N.applyDom();
      pickVoice();
      refreshDynamic();
    });
  }
  setStatus('off', 'status.disconnected');

  // Show the running version (helps spot a stale cache).
  if (els.version) els.version.textContent = 'v' + APP_VERSION;
  document.title = 'Contagiri DS200 / DS300 v' + APP_VERSION;
  setInterval(renderLanes, 5000); // refresh "updated Xs ago"
  // Running race stopwatch: tick the big clock smoothly.
  setInterval(() => { els.clock.textContent = fmtElapsed(raceClock.elapsedMs()); }, 50);

  // PWA install + service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  let deferredPrompt = null;
  let installHintShown = false;
  function showInstallHint() {
    if (!deferredPrompt) return;
    installHintShown = true;
    els.installHint.innerHTML = '<a href="#" id="installBtn"></a>';
    const b = $('installBtn');
    b.textContent = t('install');
    b.addEventListener('click', async (ev) => {
      ev.preventDefault();
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installHintShown = false;
      els.installHint.textContent = '';
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallHint();
  });
})();
