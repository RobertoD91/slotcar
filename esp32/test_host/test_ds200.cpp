// Host unit test for esp32/src/ds200.h (no hardware required).
// Build: g++ -std=c++17 -I esp32/test_host -I esp32/src test_ds200.cpp -o t && ./t
#include "ds200.h"
#include <cassert>
#include <cstdio>
#include <cstring>

using namespace ds200;

static void fill_checksum(uint8_t* f) { f[18] = checksum(f); }

int main() {
  // 1) Reference timing frame
  uint8_t timing[21] = {0xE0,0x01,0x15,0x02,0x00,0x00,0x00,0x1B,0x00,0xA9,0x80,
                        0x00,0x05,0x00,0x01,0x23,0x45,0x67,0x31,0x00,0xEB};
  Frame f; parse(timing, f);
  assert(strcmp(f.device, "DS200") == 0);
  assert(strcmp(f.dataType, "timing_data") == 0);
  assert(f.lane == 8);  // mask 0x80 -> lane 8 (LSB-first on real hardware)
  assert(f.laps == 5);
  assert(strcmp(f.timeText, "00:01:23.4567") == 0);
  assert(f.identifier && strcmp(f.identifier, "fast_lap") == 0);
  assert(f.isFastLap);
  assert(f.checksumOk);
  assert(f.warnings[0] == '\0');

  // 1b) Real captured frames: lane mapping 0x01->1, 0x02->2 (was wrongly 8/7)
  uint8_t l1[21] = {0xE0,0x05,0x15,0x02,0,0,0,0x1B,0,0,0x01,0,0x01,0,0xAA,0xAA,0xAA,0xAA,0xE1,0,0xEB};
  Frame fl1; parse(l1, fl1); assert(fl1.lane == 1);
  uint8_t l2[21] = {0xE0,0x04,0x15,0x02,0,0,0,0x1B,0xA9,0,0x02,0,0x01,0,0xAA,0xAA,0xAA,0xAA,0x8A,0,0xEB};
  Frame fl2; parse(l2, fl2); assert(fl2.lane == 2);

  // 1c) First crossing: 0xAA time fill -> noTime, no warning, fast-lap flag set
  assert(fl2.noTime);
  assert(fl2.timeText[0] == '\0');
  assert(fl2.laps == 1);
  assert(fl2.isFastLap);
  assert(strstr(fl2.warnings, "invalid_bcd_time") == nullptr);
  assert(fl2.warnings[0] == '\0');

  // 1d) Fast lap (idx8) + first position (idx9) together
  uint8_t fp[21] = {0xE0,0x06,0x15,0x02,0,0,0,0x1B,0xA9,0xA8,0x02,0,0x02,0,0,0x08,0x99,0x38,0x66,0,0xEB};
  Frame ffp; parse(fp, ffp);
  assert(ffp.isFastLap && ffp.isFirstPosition);
  assert(ffp.lane == 2);
  assert(strcmp(ffp.timeText, "00:00:08.9938") == 0);

  // 2) Start-of-race A1 -> programme values, not identifier/lane
  uint8_t a[21] = {0xE0,0x01,0x15,0x02,0,0,0,0x00,0xA1,0x12,0x34,0,0,0,0,0,0,0,0,0,0xEB};
  fill_checksum(a);
  Frame fa; parse(a, fa);
  assert(strcmp(fa.function, "start_race_phase_1") == 0);
  assert(fa.programHi == 0x12 && fa.programLo == 0x34);
  // BCD: 0x12 0x34 = 1234. On the user's DS200 it is 0x00 0x25 = 25 laps.
  assert(fa.programme == 1234);
  assert(fa.identifier == nullptr);
  assert(fa.lane == 0);
  assert(strstr(fa.warnings, "unknown_lane_mask") == nullptr);

  // 3) Bad checksum flagged
  uint8_t b[21]; memcpy(b, timing, 21); b[18] ^= 0xFF;
  Frame fb; parse(b, fb);
  assert(!fb.checksumOk);
  assert(strstr(fb.warnings, "bad_checksum") != nullptr);

  // 4) Framer resyncs past junk
  Framer fm; uint8_t out[21];
  uint8_t stream[] = {0xFF,0xAA,0xE0,0x01,0x15,0x02,0x00,0x00,0x00,0x1B,0x00,0xA9,
                      0x80,0x00,0x05,0x00,0x01,0x23,0x45,0x67,0x31,0x00,0xEB,0x99};
  int frames = 0;
  for (size_t i = 0; i < sizeof(stream); i++) if (fm.push(stream[i], out)) { frames++; Frame fr; parse(out, fr); assert(fr.lane == 8); }
  assert(frames == 1);

  // 5) All eight lane masks (DS200, LSB-first)
  int masks[8] = {0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80};
  for (int i = 0; i < 8; i++) {
    uint8_t fr[21] = {0xE0,0x01,0x15,0x02,0,0,0,0x1B,0x00,0x00,(uint8_t)masks[i],0,0x01,0,0,0,0,0,0,0,0xEB};
    fill_checksum(fr);
    Frame ff; parse(fr, ff);
    assert(ff.lane == i + 1);
  }

  // 6) Device-specific mapping: mask 0x80 -> DS200 lane 8, DS300 lane 1
  uint8_t d2[21] = {0xE0,0x01,0x15,0x02,0,0,0,0x1B,0,0,0x80,0,0x01,0,0,0,0,0,0,0,0xEB};
  fill_checksum(d2); Frame fd2; parse(d2, fd2);
  assert(strcmp(fd2.device,"DS200")==0 && fd2.lane == 8);
  uint8_t d3[21] = {0xE0,0x01,0x15,0x03,0,0,0,0x1B,0,0,0x80,0,0x01,0,0,0,0,0,0,0,0xEB};
  fill_checksum(d3); Frame fd3; parse(d3, fd3);
  assert(strcmp(fd3.device,"DS300")==0 && fd3.lane == 1);

  printf("ds200.h host test: all assertions passed\n");
  return 0;
}
