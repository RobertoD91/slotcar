/*
 * ds200.js — DS200 / DS300 RS-232 frame parser (browser, no dependencies).
 *
 * This is a 1:1 port of the Python decoder (ds_slot_serial.py) and the original
 * ds300.c reference. It exposes a global `DS200` object usable from plain
 * <script> tags and inside a Web Serial reader loop.
 *
 * Frame: 21 bytes, start 0xE0, end 0xEB.
 * Checksum (byte 19, index 18) = (sum of bytes 2..18 + byte 20) & 0xFF
 *   => (sum(frame[1..17]) + frame[19]) & 0xFF   (zero-based)
 *
 * Line settings on real hardware: 4800 8N1, no flow control.
 */
(function (global) {
  'use strict';

  const START_BYTE = 0xe0;
  const END_BYTE = 0xeb;
  const TOTAL_BYTES = 21;

  const DEVICE_NAMES = { 0x02: 'DS200', 0x03: 'DS300' };

  const DATA_TYPES = {
    0x00: 'function',
    0x1b: 'timing_data',
    0x1c: 'final_record_data',
    0x3a: 'programmed_by_time',
    0x3b: 'programmed_by_laps_total',
    0x3c: 'programmed_by_laps_individual',
    0x3d: 'programmed_by_f1',
  };

  const FUNCTIONS = {
    0xa1: 'start_race_phase_1',
    0xa2: 'start_race_phase_2',
    0xa3: 'start_race_phase_3',
    0xa4: 'end_race',
    0xa5: 'start_pause',
    0xa6: 'end_pause',
    0xa7: 'abort_race',
  };

  // Human-friendly labels for the UI.
  const FUNCTION_LABELS = {
    start_race_phase_1: 'Start gara — fase 1',
    start_race_phase_2: 'Start gara — fase 2',
    start_race_phase_3: 'Start gara — fase 3',
    end_race: 'Fine gara',
    start_pause: 'Inizio pausa',
    end_pause: 'Fine pausa',
    abort_race: 'Gara annullata',
  };

  const IDENTIFIERS = {
    // PDF: A8 = 1st position, A9 = fast lap.
    // ds300.c notes that in practice A8 also looked like a fast lap.
    0xa8: 'first_position_or_fast_lap',
    0xa9: 'fast_lap',
  };

  // Lane bit mask. The two device families number the bits differently:
  //  - DS300 (id 0x03): MSB-first, as documented (0x80=lane1 ... 0x01=lane8).
  //  - DS200 (id 0x02): LSB-first, as observed on real frames (0x01=lane1 ... 0x80=lane8).
  const LANES_DS200 = { 0x01: 1, 0x02: 2, 0x04: 3, 0x08: 4, 0x10: 5, 0x20: 6, 0x40: 7, 0x80: 8 };
  const LANES_DS300 = { 0x80: 1, 0x40: 2, 0x20: 3, 0x10: 4, 0x08: 5, 0x04: 6, 0x02: 7, 0x01: 8 };
  const LANES = LANES_DS200; // default export (DS200)

  function laneFromMask(mask, deviceId) {
    const table = deviceId === 0x03 ? LANES_DS300 : LANES_DS200;
    return table[mask] || null;
  }

  // 0xAA is the "no value" fill the DS200 sends when there is no lap time yet
  // (e.g. the very first crossing only starts the timer). Not an error.
  const NO_TIME_FILL = 0xaa;

  function hex2(b) {
    return b.toString(16).toUpperCase().padStart(2, '0');
  }

  function bcdByteToInt(b) {
    const hi = (b >> 4) & 0xf;
    const lo = b & 0xf;
    if (hi > 9 || lo > 9) return null;
    return hi * 10 + lo;
  }

  function bcdTwoBytesToInt(hiByte, loByte) {
    const parts = [(hiByte >> 4) & 0xf, hiByte & 0xf, (loByte >> 4) & 0xf, loByte & 0xf];
    if (parts.some((x) => x > 9)) return null;
    return parts[0] * 1000 + parts[1] * 100 + parts[2] * 10 + parts[3];
  }

  function calcChecksum(frame) {
    let sum = 0;
    for (let i = 1; i <= 17; i++) sum += frame[i];
    sum += frame[19];
    return sum & 0xff;
  }

  /**
   * Parse a 21-byte frame (Uint8Array or Array<number>) into an object that
   * mirrors the Python DSFrame dataclass.
   */
  function parseFrame(frame, ts) {
    if (frame.length !== TOTAL_BYTES) {
      throw new Error('Frame must be ' + TOTAL_BYTES + ' bytes, got ' + frame.length);
    }

    const expected = calcChecksum(frame);
    const actual = frame[18];
    const warnings = [];

    const validStart = frame[0] === START_BYTE;
    const validEnd = frame[20] === END_BYTE;
    const validLength = frame[2] === TOTAL_BYTES;
    const checksumOk = expected === actual;

    if (!validStart) warnings.push('bad_start: 0x' + hex2(frame[0]));
    if (!validEnd) warnings.push('bad_end: 0x' + hex2(frame[20]));
    if (!validLength) warnings.push('bad_length: 0x' + hex2(frame[2]));
    if (!checksumOk) warnings.push('bad_checksum: got 0x' + hex2(actual) + ' expected 0x' + hex2(expected));

    const dataTypeId = frame[7];
    const dataType = DATA_TYPES[dataTypeId] || 'unknown_0x' + hex2(dataTypeId);

    const functionId = frame[8];
    const func = FUNCTIONS[functionId] || null;

    // When byte 9 == 0xA1 (start of race), bytes 10/11 are the "Programme"
    // value (hi/lo), NOT an identifier or lane mask.
    const identifierId = frame[9];
    const laneMask = frame[10];

    let programHi = null;
    let programLo = null;
    let identifier = null;
    let isFastLap = false;
    let isFirstPosition = false;
    let lane = null;
    if (functionId === 0xa1) {
      programHi = frame[9];
      programLo = frame[10];
    } else {
      // Flags can appear in either the function slot (byte 9 / idx 8) or the
      // identifier slot (byte 10 / idx 9): 0xA9 = fast lap, 0xA8 = first position.
      isFastLap = frame[8] === 0xa9 || frame[9] === 0xa9;
      isFirstPosition = frame[8] === 0xa8 || frame[9] === 0xa8;
      identifier = isFastLap ? 'fast_lap' : (isFirstPosition ? 'first_position' : null);
      if (dataTypeId !== 0x00) lane = laneFromMask(laneMask, frame[3]);
    }

    const laps = bcdTwoBytesToInt(frame[11], frame[12]);
    if (laps === null) warnings.push('invalid_bcd_laps');

    // First crossing / no lap yet: time bytes are 0xAA fill -> not an error.
    const noTime = frame[14] === NO_TIME_FILL && frame[15] === NO_TIME_FILL &&
                   frame[16] === NO_TIME_FILL && frame[17] === NO_TIME_FILL;

    let hours = null;
    let minutes = null;
    let seconds = null;
    let fraction = null;
    let timeText = null;
    let timeSeconds = null;
    if (!noTime) {
      hours = bcdByteToInt(frame[13]);
      minutes = bcdByteToInt(frame[14]);
      seconds = bcdByteToInt(frame[15]);
      fraction = bcdTwoBytesToInt(frame[16], frame[17]);
      if (hours === null || minutes === null || seconds === null || fraction === null) {
        warnings.push('invalid_bcd_time');
      } else {
        timeText =
          String(hours).padStart(2, '0') + ':' +
          String(minutes).padStart(2, '0') + ':' +
          String(seconds).padStart(2, '0') + '.' +
          String(fraction).padStart(4, '0');
        timeSeconds = hours * 3600 + minutes * 60 + seconds + fraction / 10000;
      }
    }

    if (dataTypeId !== 0x00 && functionId !== 0xa1 && lane === null) {
      warnings.push('unknown_lane_mask: 0x' + hex2(laneMask));
    }

    const rawHex = Array.from(frame).map(hex2).join(' ');

    return {
      ts: ts == null ? Date.now() / 1000 : ts,
      rawHex,
      validStart, validEnd, validLength, checksumOk,
      expectedChecksum: expected,
      actualChecksum: actual,
      txCounter: frame[1],
      length: frame[2],
      deviceId: frame[3],
      device: DEVICE_NAMES[frame[3]] || 'unknown_0x' + hex2(frame[3]),
      unused: frame[4],
      passwordHi: frame[5],
      passwordLo: frame[6],
      dataTypeId, dataType,
      functionId, function: func,
      functionLabel: func ? FUNCTION_LABELS[func] : null,
      identifierId, identifier,
      isFastLap, isFirstPosition,
      laneMask, lane,
      programHi, programLo,
      laps, hours, minutes, seconds,
      fraction4digits: fraction,
      noTime,
      timeText, timeSeconds,
      control: frame[19],
      warnings,
    };
  }

  /**
   * Stateful byte-stream framer. Feed it bytes (any chunking) and it calls
   * `onFrame(Uint8Array(21))` for every synchronized 21-byte frame.
   * Mirrors iter_frames_from_bytes / the ds300.c sync loop.
   */
  function Framer(onFrame) {
    let buf = [];
    let inSync = false;
    return {
      push(bytes) {
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i] & 0xff;
          if (!inSync) {
            if (b === START_BYTE) {
              buf = [b];
              inSync = true;
            }
            continue;
          }
          buf.push(b);
          if (buf.length === TOTAL_BYTES) {
            onFrame(Uint8Array.from(buf));
            buf = [];
            inSync = false;
          }
        }
      },
      reset() {
        buf = [];
        inSync = false;
      },
    };
  }

  function parseHexString(s) {
    const matches = s.match(/[0-9a-fA-F]{2}/g) || [];
    return Uint8Array.from(matches.map((x) => parseInt(x, 16)));
  }

  global.DS200 = {
    START_BYTE, END_BYTE, TOTAL_BYTES,
    DEVICE_NAMES, DATA_TYPES, FUNCTIONS, FUNCTION_LABELS, IDENTIFIERS,
    LANES, LANES_DS200, LANES_DS300, laneFromMask,
    parseFrame, Framer, parseHexString, calcChecksum, hex2,
  };
})(typeof window !== 'undefined' ? window : this);
