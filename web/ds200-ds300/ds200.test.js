/*
 * Node test for the browser parser (ds200.js). Run: node webapp/ds200.test.js
 * No test framework: exits non-zero on the first failed assertion.
 */
'use strict';
const assert = require('assert');

global.window = global;
require('./ds200.js');
const D = global.DS200;

function build(arr) {
  const f = arr.slice();
  f[18] = D.calcChecksum(f);
  return Uint8Array.from(f);
}

// 1) Reference timing frame
const timing = D.parseHexString('E0 01 15 02 00 00 00 1B 00 A9 80 00 05 00 01 23 45 67 31 00 EB');
let f = D.parseFrame(timing, 1700000000);
assert.strictEqual(f.device, 'DS200');
assert.strictEqual(f.dataType, 'timing_data');
assert.strictEqual(f.lane, 8); // mask 0x80 -> lane 8 (LSB-first on real hardware)
assert.strictEqual(f.laps, 5);
assert.strictEqual(f.timeText, '00:01:23.4567');
assert.strictEqual(f.identifier, 'fast_lap');
assert.strictEqual(f.isFastLap, true);
assert.strictEqual(f.checksumOk, true);
assert.strictEqual(f.warnings.length, 0);

// 1b) Real captured frames: lane mapping 0x01 -> 1, 0x02 -> 2
const hf = (s) => D.parseHexString(s);
assert.strictEqual(D.parseFrame(hf('E0 05 15 02 00 00 00 1B 00 00 01 00 01 00 AA AA AA AA E1 00 EB')).lane, 1);
const firstLap = D.parseFrame(hf('E0 04 15 02 00 00 00 1B A9 00 02 00 01 00 AA AA AA AA 8A 00 EB'));
assert.strictEqual(firstLap.lane, 2);

// 1c) First crossing: 0xAA fill -> noTime, no warning, fast-lap flag from idx 8
assert.strictEqual(firstLap.noTime, true);
assert.strictEqual(firstLap.timeText, null);
assert.strictEqual(firstLap.laps, 1);
assert.strictEqual(firstLap.isFastLap, true);
assert.strictEqual(firstLap.warnings.length, 0);

// 1d) Fast lap (idx8) + first position (idx9) together
const fp = D.parseFrame(hf('E0 06 15 02 00 00 00 1B A9 A8 02 00 02 00 00 08 99 38 66 00 EB'));
assert.ok(fp.isFastLap && fp.isFirstPosition);
assert.strictEqual(fp.lane, 2);
assert.strictEqual(fp.timeText, '00:00:08.9938');

// 2) Start-of-race A1 -> programme values, not identifier/lane
let a = build([0xE0, 0x01, 0x15, 0x02, 0, 0, 0, 0x00, 0xA1, 0x12, 0x34, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xEB]);
let r = D.parseFrame(a, 1700000000);
assert.strictEqual(r.function, 'start_race_phase_1');
assert.strictEqual(r.programHi, 0x12);
// i due byte sono BCD: 0x12 0x34 = 1234. Col DS200 dell'utente sono 0x00 0x25 = 25 giri.
assert.strictEqual(r.programme, 1234);
assert.strictEqual(r.programLo, 0x34);
assert.strictEqual(r.identifier, null);
assert.strictEqual(r.lane, null);
assert.ok(!r.warnings.some((w) => w.includes('unknown_lane_mask')));

// 3) Bad checksum flagged
let bad = Uint8Array.from(timing);
bad[18] ^= 0xFF;
let rb = D.parseFrame(bad);
assert.strictEqual(rb.checksumOk, false);
assert.ok(rb.warnings.some((w) => w.includes('bad_checksum')));

// 4) Framer resyncs past junk bytes
const framed = [];
const fm = D.Framer((bytes) => framed.push(D.parseFrame(bytes)));
fm.push([0xFF, 0xAA]);                 // junk before start
fm.push(timing);
fm.push([0x99]);                       // trailing junk
assert.strictEqual(framed.length, 1);
assert.strictEqual(framed[0].lane, 8);

// 5) All eight lane masks
const masks = { 0x01: 1, 0x02: 2, 0x04: 3, 0x08: 4, 0x10: 5, 0x20: 6, 0x40: 7, 0x80: 8 };
for (const [mask, lane] of Object.entries(masks)) {
  const fr = build([0xE0, 0x01, 0x15, 0x02, 0, 0, 0, 0x1B, 0x00, 0x00, Number(mask), 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0xEB]);
  assert.strictEqual(D.parseFrame(fr).lane, lane);
}

// 6) Lane mapping is device-specific: mask 0x80 -> DS200 lane 8, DS300 lane 1
const ds200f = build([0xE0, 0x01, 0x15, 0x02, 0, 0, 0, 0x1B, 0, 0, 0x80, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0xEB]);
const ds300f = build([0xE0, 0x01, 0x15, 0x03, 0, 0, 0, 0x1B, 0, 0, 0x80, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0xEB]);
assert.strictEqual(D.parseFrame(ds200f).device, 'DS200');
assert.strictEqual(D.parseFrame(ds200f).lane, 8);
assert.strictEqual(D.parseFrame(ds300f).device, 'DS300');
assert.strictEqual(D.parseFrame(ds300f).lane, 1);

console.log('ds200.js: all assertions passed');
