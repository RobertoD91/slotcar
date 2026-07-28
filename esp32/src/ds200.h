#pragma once
/*
 * ds200.h — DS200 / DS300 frame parser for ESP32 (Arduino).
 * 1:1 port of ds_slot_serial.py / ds200.js.
 *
 * Frame: 21 bytes, start 0xE0, end 0xEB.
 * Checksum (byte 19, idx 18) = (sum(bytes 2..18) + byte 20) & 0xFF
 *                            = (sum(idx 1..17) + idx 19) & 0xFF
 */
#include <Arduino.h>

namespace ds200 {

static const uint8_t START_BYTE = 0xE0;
static const uint8_t END_BYTE   = 0xEB;
static const uint8_t TOTAL_BYTES = 21;
// 0xAA = "no value" fill the DS200 sends when there is no lap time yet
// (e.g. the first crossing only starts the timer). Not an error.
static const uint8_t NO_TIME_FILL = 0xAA;

struct Frame {
  bool     validStart, validEnd, validLength, checksumOk;
  uint8_t  expectedChecksum, actualChecksum;
  uint8_t  txCounter, length, deviceId;
  const char* device;
  uint8_t  dataTypeId;
  const char* dataType;
  uint8_t  functionId;
  const char* function;       // nullptr if none
  const char* functionLabel;  // human label, nullptr if none
  uint8_t  identifierId;
  const char* identifier;     // nullptr if none
  bool     isFastLap;
  bool     isFirstPosition;
  uint8_t  laneMask;
  int      lane;              // 0 if none, else 1..8
  int      programHi, programLo; // -1 if not applicable
  int      laps;             // -1 if invalid BCD
  int      hours, minutes, seconds, fraction; // -1 if invalid
  bool     noTime;           // true = no lap time yet (0xAA fill)
  char     timeText[16];     // "HH:MM:SS.ffff" or "" if invalid/none
  double   timeSeconds;      // -1 if invalid
  char     rawHex[64];       // "E0 01 ..."
  char     warnings[160];    // semicolon-joined, "" if none
};

inline const char* deviceName(uint8_t id) {
  switch (id) { case 0x02: return "DS200"; case 0x03: return "DS300"; default: return "unknown"; }
}
inline const char* dataTypeName(uint8_t id) {
  switch (id) {
    case 0x00: return "function";
    case 0x1B: return "timing_data";
    case 0x1C: return "final_record_data";
    case 0x3A: return "programmed_by_time";
    case 0x3B: return "programmed_by_laps_total";
    case 0x3C: return "programmed_by_laps_individual";
    case 0x3D: return "programmed_by_f1";
    default:   return "unknown";
  }
}
inline const char* functionName(uint8_t id) {
  switch (id) {
    case 0xA1: return "start_race_phase_1";
    case 0xA2: return "start_race_phase_2";
    case 0xA3: return "start_race_phase_3";
    case 0xA4: return "end_race";
    case 0xA5: return "start_pause";
    case 0xA6: return "end_pause";
    case 0xA7: return "abort_race";
    default:   return nullptr;
  }
}
inline const char* functionLabel(uint8_t id) {
  switch (id) {
    case 0xA1: return "Start gara - fase 1";
    case 0xA2: return "Start gara - fase 2";
    case 0xA3: return "Start gara - fase 3";
    case 0xA4: return "Fine gara";
    case 0xA5: return "Inizio pausa";
    case 0xA6: return "Fine pausa";
    case 0xA7: return "Gara annullata";
    default:   return nullptr;
  }
}
inline const char* identifierName(uint8_t id) {
  switch (id) {
    case 0xA8: return "first_position_or_fast_lap";
    case 0xA9: return "fast_lap";
    default:   return nullptr;
  }
}
// Lane bit mask differs per device family:
//  - DS300 (id 0x03): MSB-first, as documented (0x80=lane1 ... 0x01=lane8).
//  - DS200 (id 0x02): LSB-first, as observed on real frames (0x01=lane1 ... 0x80=lane8).
inline int laneFromMask(uint8_t m, uint8_t deviceId) {
  if (deviceId == 0x03) {  // DS300, documented
    switch (m) {
      case 0x80: return 1; case 0x40: return 2; case 0x20: return 3; case 0x10: return 4;
      case 0x08: return 5; case 0x04: return 6; case 0x02: return 7; case 0x01: return 8;
      default:   return 0;
    }
  }
  switch (m) {            // DS200 (and default), observed
    case 0x01: return 1; case 0x02: return 2; case 0x04: return 3; case 0x08: return 4;
    case 0x10: return 5; case 0x20: return 6; case 0x40: return 7; case 0x80: return 8;
    default:   return 0;
  }
}

inline int bcdByte(uint8_t b) {
  int hi = (b >> 4) & 0xF, lo = b & 0xF;
  if (hi > 9 || lo > 9) return -1;
  return hi * 10 + lo;
}
inline int bcdTwo(uint8_t hi, uint8_t lo) {
  int a = (hi >> 4) & 0xF, b = hi & 0xF, c = (lo >> 4) & 0xF, d = lo & 0xF;
  if (a > 9 || b > 9 || c > 9 || d > 9) return -1;
  return a * 1000 + b * 100 + c * 10 + d;
}
inline uint8_t checksum(const uint8_t* f) {
  uint16_t s = 0;
  for (int i = 1; i <= 17; i++) s += f[i];
  s += f[19];
  return s & 0xFF;
}

inline void parse(const uint8_t* f, Frame& fr) {
  fr.expectedChecksum = checksum(f);
  fr.actualChecksum   = f[18];
  fr.validStart  = (f[0] == START_BYTE);
  fr.validEnd    = (f[20] == END_BYTE);
  fr.validLength = (f[2] == TOTAL_BYTES);
  fr.checksumOk  = (fr.expectedChecksum == fr.actualChecksum);

  fr.txCounter = f[1];
  fr.length    = f[2];
  fr.deviceId  = f[3];
  fr.device    = deviceName(f[3]);

  fr.dataTypeId = f[7];
  fr.dataType   = dataTypeName(f[7]);
  fr.functionId = f[8];
  fr.function   = functionName(f[8]);
  fr.functionLabel = functionLabel(f[8]);

  fr.identifierId = f[9];
  fr.laneMask     = f[10];
  fr.programHi = fr.programLo = -1;
  fr.identifier = nullptr;
  fr.isFastLap = false;
  fr.isFirstPosition = false;
  fr.lane = 0;
  if (f[8] == 0xA1) {                 // start of race -> bytes 10/11 are programme values
    fr.programHi = f[9];
    fr.programLo = f[10];
  } else {
    // Flags appear in either the function slot (idx 8) or identifier slot (idx 9):
    // 0xA9 = fast lap, 0xA8 = first position.
    fr.isFastLap = (f[8] == 0xA9) || (f[9] == 0xA9);
    fr.isFirstPosition = (f[8] == 0xA8) || (f[9] == 0xA8);
    fr.identifier = fr.isFastLap ? "fast_lap" : (fr.isFirstPosition ? "first_position" : nullptr);
    if (f[7] != 0x00) fr.lane = laneFromMask(f[10], f[3]);
  }

  fr.laps = bcdTwo(f[11], f[12]);

  // First crossing / no lap yet: time field is 0xAA fill -> not an error.
  fr.noTime = (f[14] == NO_TIME_FILL && f[15] == NO_TIME_FILL &&
               f[16] == NO_TIME_FILL && f[17] == NO_TIME_FILL);

  fr.hours = fr.minutes = fr.seconds = fr.fraction = -1;
  fr.timeText[0] = '\0';
  fr.timeSeconds = -1;
  if (!fr.noTime) {
    fr.hours    = bcdByte(f[13]);
    fr.minutes  = bcdByte(f[14]);
    fr.seconds  = bcdByte(f[15]);
    fr.fraction = bcdTwo(f[16], f[17]);
    if (fr.hours >= 0 && fr.minutes >= 0 && fr.seconds >= 0 && fr.fraction >= 0) {
      snprintf(fr.timeText, sizeof(fr.timeText), "%02d:%02d:%02d.%04d",
               fr.hours, fr.minutes, fr.seconds, fr.fraction);
      fr.timeSeconds = fr.hours * 3600.0 + fr.minutes * 60.0 + fr.seconds + fr.fraction / 10000.0;
    }
  }

  // warnings
  fr.warnings[0] = '\0';
  char* w = fr.warnings;
  size_t cap = sizeof(fr.warnings);
  auto add = [&](const char* msg) {
    size_t len = strlen(fr.warnings);
    if (len) { snprintf(w + len, cap - len, "; %s", msg); }
    else     { snprintf(w, cap, "%s", msg); }
  };
  if (!fr.validStart)  add("bad_start");
  if (!fr.validEnd)    add("bad_end");
  if (!fr.validLength) add("bad_length");
  if (!fr.checksumOk)  add("bad_checksum");
  if (fr.laps < 0)     add("invalid_bcd_laps");
  if (!fr.noTime && fr.timeText[0] == '\0') add("invalid_bcd_time");
  if (fr.dataTypeId != 0x00 && f[8] != 0xA1 && fr.lane == 0) add("unknown_lane_mask");

  // raw hex
  char* p = fr.rawHex;
  for (int i = 0; i < TOTAL_BYTES; i++) {
    p += snprintf(p, fr.rawHex + sizeof(fr.rawHex) - p, "%s%02X", i ? " " : "", f[i]);
  }
}

// Stateful framer. Call push(byte) for each received byte; returns true and
// fills `out` (21 bytes) when a full synchronized frame is ready.
class Framer {
 public:
  bool push(uint8_t b, uint8_t* out) {
    if (!inSync_) {
      if (b == START_BYTE) { buf_[0] = b; n_ = 1; inSync_ = true; }
      return false;
    }
    buf_[n_++] = b;
    if (n_ == TOTAL_BYTES) {
      memcpy(out, buf_, TOTAL_BYTES);
      n_ = 0; inSync_ = false;
      return true;
    }
    return false;
  }
  void reset() { n_ = 0; inSync_ = false; }
 private:
  uint8_t buf_[TOTAL_BYTES];
  uint8_t n_ = 0;
  bool inSync_ = false;
};

}  // namespace ds200
