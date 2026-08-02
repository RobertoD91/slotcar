#!/usr/bin/env python3
"""
DS200 / DS300 RS-232 decoder for slot car timing boxes.

Protocol facts:
- 21-byte binary frames
- start byte: 0xE0
- end byte:   0xEB
- byte 4:     0x02 = DS200, 0x03 = DS300
- serial settings: 4800 8N1, RTS/DTR disabled.
  NOTE: the original ds300.c hard-codes 57600, but on real DS200/DS300 hardware
  the correct line rate is 4800 baud. That is the default here. If your box was
  flashed differently, override with --baud.

Install:
    python3 -m pip install pyserial

Examples:
    python3 ds_slot_serial.py --list
    python3 ds_slot_serial.py -p /dev/ttyUSB0
    python3 ds_slot_serial.py -p /dev/tty.usbserial-XXXX --raw
    python3 ds_slot_serial.py -p COM3 --json
    python3 ds_slot_serial.py --parse-hex "e0 01 15 02 00 00 00 1b 00 00 80 00 01 00 00 03 01 13 xx 00 eb"
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from dataclasses import dataclass, asdict
from typing import Iterable, Optional

__version__ = "1.2.0"

START_BYTE = 0xE0
END_BYTE = 0xEB
TOTAL_BYTES = 21

# 0xAA is the "no value" fill the DS200 sends when there is no lap time yet
# (e.g. the very first crossing only starts the timer). Not an error.
NO_TIME_FILL = 0xAA

DEVICE_NAMES = {
    0x02: "DS200",
    0x03: "DS300",
}

DATA_TYPES = {
    0x00: "function",
    0x1B: "timing_data",
    0x1C: "final_record_data",
    0x3A: "programmed_by_time",
    0x3B: "programmed_by_laps_total",
    0x3C: "programmed_by_laps_individual",
    0x3D: "programmed_by_f1",
}

FUNCTIONS = {
    0xA1: "start_race_phase_1",
    0xA2: "start_race_phase_2",
    0xA3: "start_race_phase_3",
    0xA4: "end_race",
    0xA5: "start_pause",
    0xA6: "end_pause",
    0xA7: "abort_race",
}

IDENTIFIERS = {
    # PDF: A8 = 1st position, A9 = fast lap. On real DS200 frames the fast-lap
    # flag (0xA9) shows up in the function byte (idx 8) and the 1st-position flag
    # (0xA8) in the identifier byte (idx 9); either slot may carry either flag.
    0xA8: "first_position",
    0xA9: "fast_lap",
}

# Lane bit mask. The two device families number the bits differently:
#  - DS300 (id 0x03): MSB-first, as documented in protocol_DS.pdf / ds300.c
#    (0x80 = lane 1 ... 0x01 = lane 8).
#  - DS200 (id 0x02): LSB-first, as observed on real captured frames
#    (0x01 = lane 1 ... 0x80 = lane 8).
LANES_DS200 = {0x01: 1, 0x02: 2, 0x04: 3, 0x08: 4, 0x10: 5, 0x20: 6, 0x40: 7, 0x80: 8}
LANES_DS300 = {0x80: 1, 0x40: 2, 0x20: 3, 0x10: 4, 0x08: 5, 0x04: 6, 0x02: 7, 0x01: 8}
# Backwards-compatible default export (DS200 mapping).
LANES = LANES_DS200


def lane_from_mask(mask: int, device_id: int) -> Optional[int]:
    """Resolve a lane bit mask to a lane number for the given device."""
    table = LANES_DS300 if device_id == 0x03 else LANES_DS200
    return table.get(mask)


@dataclass
class DSFrame:
    ts: float
    raw_hex: str
    valid_start: bool
    valid_end: bool
    valid_length: bool
    checksum_ok: bool
    expected_checksum: int
    actual_checksum: int

    tx_counter: int
    length: int
    device_id: int
    device: str
    unused: int
    password_hi: int
    password_lo: int
    data_type_id: int
    data_type: str
    function_id: int
    function: Optional[str]
    identifier_id: int
    identifier: Optional[str]
    is_fast_lap: bool
    is_first_position: bool
    lane_mask: int
    lane: Optional[int]
    program_hi: Optional[int]
    program_lo: Optional[int]
    programme: Optional[int]
    laps: Optional[int]
    hours: Optional[int]
    minutes: Optional[int]
    seconds: Optional[int]
    fraction_4digits: Optional[int]
    no_time: bool
    time_text: Optional[str]
    control: int
    warnings: list[str]


def bcd_byte_to_int(b: int) -> Optional[int]:
    """Convert a BCD byte 0x00..0x99 to int 0..99. Return None if invalid."""
    hi, lo = (b >> 4) & 0xF, b & 0xF
    if hi > 9 or lo > 9:
        return None
    return hi * 10 + lo


def bcd_two_bytes_to_int(hi_byte: int, lo_byte: int) -> Optional[int]:
    """Convert two BCD bytes to four decimal digits."""
    parts = [
        (hi_byte >> 4) & 0xF,
        hi_byte & 0xF,
        (lo_byte >> 4) & 0xF,
        lo_byte & 0xF,
    ]
    if any(x > 9 for x in parts):
        return None
    return parts[0] * 1000 + parts[1] * 100 + parts[2] * 10 + parts[3]


def calc_checksum(frame: bytes) -> int:
    """
    DS protocol checksum:
    byte 19 = sum(bytes 2..18 + byte 20) modulo 256
    In zero-based Python indices: sum(frame[1:18]) + frame[19].
    """
    return (sum(frame[1:18]) + frame[19]) & 0xFF


def parse_frame(frame: bytes, ts: Optional[float] = None) -> DSFrame:
    if len(frame) != TOTAL_BYTES:
        raise ValueError(f"Frame must be {TOTAL_BYTES} bytes, got {len(frame)}")

    expected = calc_checksum(frame)
    actual = frame[18]
    warnings: list[str] = []

    valid_start = frame[0] == START_BYTE
    valid_end = frame[20] == END_BYTE
    valid_length = frame[2] == TOTAL_BYTES
    checksum_ok = expected == actual

    if not valid_start:
        warnings.append(f"bad_start: got 0x{frame[0]:02X}, expected 0x{START_BYTE:02X}")
    if not valid_end:
        warnings.append(f"bad_end: got 0x{frame[20]:02X}, expected 0x{END_BYTE:02X}")
    if not valid_length:
        warnings.append(f"bad_length: got 0x{frame[2]:02X}, expected 0x{TOTAL_BYTES:02X}")
    if not checksum_ok:
        warnings.append(f"bad_checksum: got 0x{actual:02X}, expected 0x{expected:02X}")

    data_type_id = frame[7]
    data_type = DATA_TYPES.get(data_type_id, f"unknown_0x{data_type_id:02X}")

    function_id = frame[8]
    function = FUNCTIONS.get(function_id)

    # Per the protocol (byte 10/11 notes): when byte 9 == 0xA1 (start of race),
    # bytes 10 and 11 carry the "Programme" value (hi/lo), NOT an identifier or a
    # lane mask. Only decode identifier/lane when we are NOT in that A1 case.
    identifier_id = frame[9]
    lane_mask = frame[10]

    program_hi = None
    program_lo = None
    programme = None
    identifier = None
    is_fast_lap = False
    is_first_position = False
    lane = None
    if function_id == 0xA1:
        program_hi = frame[9]
        program_lo = frame[10]
        # BCD like everything else: 0x00 0x25 = 25 laps. Decoding it here keeps
        # every consumer from redoing the conversion (and getting it wrong).
        ph, pl = bcd_byte_to_int(program_hi), bcd_byte_to_int(program_lo)
        programme = None if ph is None or pl is None else ph * 100 + pl
        if programme is None:
            warnings.append("invalid_bcd_programme")
    else:
        # Flags can appear in either the function slot (byte 9 / idx 8) or the
        # identifier slot (byte 10 / idx 9): 0xA9 = fast lap, 0xA8 = first position.
        is_fast_lap = frame[8] == 0xA9 or frame[9] == 0xA9
        is_first_position = frame[8] == 0xA8 or frame[9] == 0xA8
        if is_fast_lap:
            identifier = "fast_lap"
        elif is_first_position:
            identifier = "first_position"
        # Lane number is only meaningful for non-"function" data words.
        # Mapping depends on the device (DS200 vs DS300), see lane_from_mask.
        if data_type_id != 0x00:
            lane = lane_from_mask(lane_mask, frame[3])

    # Per original ds300.c and PDF:
    # bytes 12-13 are lap count in BCD; zero-based frame[11], frame[12].
    laps = bcd_two_bytes_to_int(frame[11], frame[12])
    if laps is None:
        warnings.append(f"invalid_bcd_laps: 0x{frame[11]:02X} 0x{frame[12]:02X}")

    # First crossing / no lap yet: the time field is 0xAA fill -> not an error.
    no_time = (
        frame[14] == NO_TIME_FILL and frame[15] == NO_TIME_FILL
        and frame[16] == NO_TIME_FILL and frame[17] == NO_TIME_FILL
    )

    hours = minutes = seconds = fraction_4digits = None
    time_text = None
    if not no_time:
        hours = bcd_byte_to_int(frame[13])
        minutes = bcd_byte_to_int(frame[14])
        seconds = bcd_byte_to_int(frame[15])
        fraction_4digits = bcd_two_bytes_to_int(frame[16], frame[17])
        if None in (hours, minutes, seconds, fraction_4digits):
            warnings.append(
                "invalid_bcd_time: "
                f"0x{frame[13]:02X} 0x{frame[14]:02X} 0x{frame[15]:02X} "
                f"0x{frame[16]:02X} 0x{frame[17]:02X}"
            )
        else:
            time_text = f"{hours:02d}:{minutes:02d}:{seconds:02d}.{fraction_4digits:04d}"

    if data_type_id != 0x00 and function_id != 0xA1 and lane is None:
        warnings.append(f"unknown_lane_mask: 0x{lane_mask:02X}")

    return DSFrame(
        ts=time.time() if ts is None else ts,
        raw_hex=frame.hex(" ").upper(),
        valid_start=valid_start,
        valid_end=valid_end,
        valid_length=valid_length,
        checksum_ok=checksum_ok,
        expected_checksum=expected,
        actual_checksum=actual,
        tx_counter=frame[1],
        length=frame[2],
        device_id=frame[3],
        device=DEVICE_NAMES.get(frame[3], f"unknown_0x{frame[3]:02X}"),
        unused=frame[4],
        password_hi=frame[5],
        password_lo=frame[6],
        data_type_id=data_type_id,
        data_type=data_type,
        function_id=function_id,
        function=function,
        identifier_id=identifier_id,
        identifier=identifier,
        is_fast_lap=is_fast_lap,
        is_first_position=is_first_position,
        lane_mask=lane_mask,
        lane=lane,
        program_hi=program_hi,
        program_lo=program_lo,
        programme=programme,
        laps=laps,
        hours=hours,
        minutes=minutes,
        seconds=seconds,
        fraction_4digits=fraction_4digits,
        no_time=no_time,
        time_text=time_text,
        control=frame[19],
        warnings=warnings,
    )


def iter_frames_from_bytes(byte_iter: Iterable[int], raw: bool = False) -> Iterable[bytes]:
    """
    Synchronize on 0xE0 and then read exactly 21 bytes.
    This intentionally mirrors the old ds300.c behaviour.
    """
    buf = bytearray()
    in_sync = False

    for b in byte_iter:
        b &= 0xFF

        if raw:
            print(f"{b:02X}", end=" ", flush=True)

        if not in_sync:
            if b == START_BYTE:
                buf = bytearray([b])
                in_sync = True
            continue

        buf.append(b)

        if len(buf) == TOTAL_BYTES:
            yield bytes(buf)
            buf.clear()
            in_sync = False


def serial_byte_iter(port: str, baud: int, timeout: float) -> Iterable[int]:
    try:
        import serial
    except ImportError:
        print("Missing dependency: pyserial. Install with: python3 -m pip install pyserial", file=sys.stderr)
        raise SystemExit(2)

    with serial.Serial(
        port=port,
        baudrate=baud,
        bytesize=8,
        parity="N",
        stopbits=1,
        timeout=timeout,
        rtscts=False,
        dsrdtr=False,
        xonxoff=False,
    ) as ser:
        # Match original ds300.c: disable RTS/DTR.
        try:
            ser.setRTS(False)
            ser.setDTR(False)
        except Exception:
            pass

        while True:
            data = ser.read(1)
            if data:
                yield data[0]


def list_ports() -> None:
    try:
        from serial.tools import list_ports
    except ImportError:
        print("Missing dependency: pyserial. Install with: python3 -m pip install pyserial", file=sys.stderr)
        raise SystemExit(2)

    ports = list(list_ports.comports())
    if not ports:
        print("No serial ports found.")
        return

    for p in ports:
        print(f"{p.device}\t{p.description}")


def parse_hex_string(s: str) -> bytes:
    """
    Parse strings like:
      e0 01 15 02 ...
      E0:01:15:02
      \\xE0\\x01\\x15
    Ignore placeholders like xx only by failing loudly, because checksum tests need real bytes.
    """
    if "\\x" in s:
        values = re.findall(r"\\x([0-9a-fA-F]{2})", s)
    else:
        values = re.findall(r"(?<![0-9a-fA-F])([0-9a-fA-F]{2})(?![0-9a-fA-F])", s)

    if not values:
        raise ValueError("No hex bytes found.")
    return bytes(int(x, 16) for x in values)


def print_human(f: DSFrame, show_invalid: bool = True) -> None:
    if not show_invalid and f.warnings:
        return

    stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(f.ts))
    print(f"[{stamp}] {f.device}  counter={f.tx_counter:02X}  type={f.data_type}")

    if f.function is not None:
        print(f"  function: {f.function} (0x{f.function_id:02X})")
    elif f.data_type == "function":
        print(f"  function: unknown_0x{f.function_id:02X}")

    if f.program_hi is not None:
        print(f"  program: hi=0x{f.program_hi:02X} lo=0x{f.program_lo:02X}"
              + (f"  = {f.programme}" if f.programme is not None else ""))

    if f.identifier is not None:
        flags = []
        if f.is_fast_lap:
            flags.append("fast_lap")
        if f.is_first_position:
            flags.append("first_position")
        print(f"  flags: {', '.join(flags)}")

    if f.data_type != "function" and f.program_hi is None:
        print(f"  lane: {f.lane if f.lane is not None else 'unknown'}  mask=0x{f.lane_mask:02X}")

    print(f"  laps: {f.laps if f.laps is not None else 'invalid'}")
    if f.time_text is not None:
        time_str = f.time_text
    elif f.no_time:
        time_str = "— (nessun tempo, 1° giro)"
    else:
        time_str = "invalid"
    print(f"  time: {time_str}")
    print(f"  checksum: {'OK' if f.checksum_ok else 'BAD'} "
          f"(got=0x{f.actual_checksum:02X}, expected=0x{f.expected_checksum:02X})")
    print(f"  raw: {f.raw_hex}")

    if f.warnings:
        print("  warnings: " + "; ".join(f.warnings))

    print(flush=True)


def csv_header() -> list[str]:
    return [
        "ts", "device", "tx_counter", "data_type", "function", "identifier",
        "lane", "lane_mask", "laps", "time_text", "checksum_ok", "warnings", "raw_hex"
    ]


def csv_row(f: DSFrame) -> list[object]:
    return [
        f.ts, f.device, f.tx_counter, f.data_type, f.function, f.identifier,
        f.lane, f.lane_mask, f.laps, f.time_text, f.checksum_ok,
        "|".join(f.warnings), f.raw_hex
    ]


def run(args: argparse.Namespace) -> int:
    if args.list:
        list_ports()
        return 0

    if args.parse_hex:
        data = parse_hex_string(args.parse_hex)
        if len(data) != TOTAL_BYTES:
            print(f"Parsed {len(data)} bytes, expected {TOTAL_BYTES}.", file=sys.stderr)
            return 2
        frame = parse_frame(data)
        if args.json:
            print(json.dumps(asdict(frame), ensure_ascii=False))
        else:
            print_human(frame)
        return 0

    if not args.port:
        print("Missing --port. Use --list to see serial ports.", file=sys.stderr)
        return 2

    out_csv = None
    writer = None
    if args.csv:
        out_csv = open(args.csv, "a", newline="", encoding="utf-8")
        writer = csv.writer(out_csv)
        if out_csv.tell() == 0:
            writer.writerow(csv_header())

    last_frame: Optional[bytes] = None
    duplicate_count = 0

    try:
        source = serial_byte_iter(args.port, args.baud, args.timeout)
        for raw_frame in iter_frames_from_bytes(source, raw=args.raw):
            if args.raw:
                print()

            if args.dedupe and raw_frame == last_frame:
                duplicate_count += 1
                if args.show_duplicates:
                    print(f"duplicate frame skipped ({duplicate_count})")
                continue

            last_frame = raw_frame
            duplicate_count = 0

            frame = parse_frame(raw_frame)

            if not args.show_invalid and frame.warnings:
                continue

            if args.json:
                print(json.dumps(asdict(frame), ensure_ascii=False), flush=True)
            else:
                print_human(frame, show_invalid=args.show_invalid)

            if writer is not None:
                writer.writerow(csv_row(frame))
                out_csv.flush()

    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)
    finally:
        if out_csv is not None:
            out_csv.close()

    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description="Decode DS Racing DS200/DS300 RS-232 timing frames."
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    p.add_argument("-p", "--port", help="Serial port, e.g. /dev/ttyUSB0, /dev/tty.usbserial-*, COM3")
    p.add_argument("-b", "--baud", type=int, default=4800, help="Baud rate. Default: 4800 (correct for DS200/DS300).")
    p.add_argument("--timeout", type=float, default=0.2, help="Serial read timeout in seconds.")
    p.add_argument("--list", action="store_true", help="List available serial ports and exit.")
    p.add_argument("--raw", action="store_true", help="Print every received byte as hex while decoding.")
    p.add_argument("--json", action="store_true", help="Print each decoded frame as JSON.")
    p.add_argument("--csv", help="Append decoded frames to CSV file.")
    p.add_argument("--no-dedupe", dest="dedupe", action="store_false", help="Do not suppress repeated identical frames.")
    p.set_defaults(dedupe=True)
    p.add_argument("--show-duplicates", action="store_true", help="Print a notice when duplicate frames are skipped.")
    p.add_argument("--show-invalid", action="store_true", default=True, help="Show frames even if checksum/length/end warnings exist.")
    p.add_argument("--hide-invalid", dest="show_invalid", action="store_false", help="Hide frames with warnings.")
    p.add_argument("--parse-hex", help="Decode one 21-byte frame from a hex string and exit.")
    return run(p.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
