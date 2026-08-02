"""Tests for the DS200/DS300 decoder (ds_slot_serial.py)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ds_slot_serial as ds  # noqa: E402


def build(frame):
    """Fill in byte 18 (checksum) and return immutable bytes."""
    f = list(frame)
    f[18] = (sum(f[1:18]) + f[19]) & 0xFF
    return bytes(f)


TIMING = bytes.fromhex("E0 01 15 02 00 00 00 1B 00 A9 80 00 05 00 01 23 45 67 31 00 EB".replace(" ", ""))


def test_checksum_matches_reference():
    assert ds.calc_checksum(TIMING) == 0x31
    assert ds.parse_frame(TIMING).checksum_ok


def test_timing_frame_fields():
    f = ds.parse_frame(TIMING)
    assert f.device == "DS200"
    assert f.data_type == "timing_data"
    assert f.lane == 8  # mask 0x80 is lane 8 (LSB-first on real DS200 hardware)
    assert f.laps == 5
    assert f.time_text == "00:01:23.4567"
    assert f.identifier == "fast_lap"
    assert f.is_fast_lap
    assert f.warnings == []


def hexframe(s):
    return bytes.fromhex(s.replace(" ", ""))


def test_real_lane_mapping_from_capture():
    """Captured 2-lane race: mask 0x01 -> lane 1, 0x02 -> lane 2 (not 7/8)."""
    f1 = ds.parse_frame(hexframe("E0 05 15 02 00 00 00 1B 00 00 01 00 01 00 AA AA AA AA E1 00 EB"))
    assert f1.lane == 1
    f2 = ds.parse_frame(hexframe("E0 04 15 02 00 00 00 1B A9 00 02 00 01 00 AA AA AA AA 8A 00 EB"))
    assert f2.lane == 2


def test_first_lap_no_time_is_not_an_error():
    """First crossing sends 0xAA fill for the time -> no_time, no warning."""
    f = ds.parse_frame(hexframe("E0 04 15 02 00 00 00 1B A9 00 02 00 01 00 AA AA AA AA 8A 00 EB"))
    assert f.no_time is True
    assert f.time_text is None
    assert f.laps == 1
    assert f.is_fast_lap is True            # 0xA9 in the function slot
    assert not any("invalid_bcd_time" in w for w in f.warnings)
    assert f.warnings == []


def test_fast_lap_and_first_position_flags():
    """1B A9 A8 -> fast lap (idx8) AND first position (idx9), lane 2."""
    f = ds.parse_frame(hexframe("E0 06 15 02 00 00 00 1B A9 A8 02 00 02 00 00 08 99 38 66 00 EB"))
    assert f.is_fast_lap is True
    assert f.is_first_position is True
    assert f.identifier == "fast_lap"       # fast lap takes display priority
    assert f.lane == 2
    assert f.time_text == "00:00:08.9938"
    assert f.warnings == []


def test_bcd_helpers():
    assert ds.bcd_byte_to_int(0x23) == 23
    assert ds.bcd_byte_to_int(0x0A) is None  # invalid nibble
    assert ds.bcd_two_bytes_to_int(0x12, 0x34) == 1234
    assert ds.bcd_two_bytes_to_int(0x1A, 0x34) is None


def test_start_of_race_program_values_not_identifier_or_lane():
    """Byte 9 == 0xA1 -> bytes 10/11 are programme values, not ident/lane."""
    frame = build([0xE0, 0x01, 0x15, 0x02, 0, 0, 0, 0x00, 0xA1, 0x12, 0x34,
                   0, 0, 0, 0, 0, 0, 0, 0, 0, 0xEB])
    f = ds.parse_frame(frame)
    assert f.function == "start_race_phase_1"
    assert f.program_hi == 0x12
    # BCD: 0x12 0x34 = 1234. On the user's DS200 it is 0x00 0x25 = 25 laps.
    assert f.programme == 1234
    assert f.program_lo == 0x34
    assert f.identifier is None          # NOT mis-read as an identifier
    assert f.lane is None                # NOT mis-read as a lane
    assert "unknown_lane_mask" not in " ".join(f.warnings)


def test_bad_checksum_flagged():
    bad = bytearray(TIMING)
    bad[18] ^= 0xFF
    f = ds.parse_frame(bytes(bad))
    assert not f.checksum_ok
    assert any("bad_checksum" in w for w in f.warnings)


def test_parse_hex_roundtrip():
    data = ds.parse_hex_string("E0 01 15 02 00 00 00 1B 00 A9 80 00 05 00 01 23 45 67 31 00 EB")
    assert len(data) == ds.TOTAL_BYTES
    assert data == TIMING


def test_frame_length_validation():
    with pytest.raises(ValueError):
        ds.parse_frame(b"\xE0\x01\x15")


def test_lane_masks_all_eight_ds200():
    masks = {0x01: 1, 0x02: 2, 0x04: 3, 0x08: 4, 0x10: 5, 0x20: 6, 0x40: 7, 0x80: 8}
    for mask, lane in masks.items():
        frame = build([0xE0, 0x01, 0x15, 0x02, 0, 0, 0, 0x1B, 0x00, 0x00, mask,
                       0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0xEB])
        assert ds.parse_frame(frame).lane == lane


def test_lane_mapping_is_device_specific():
    """Same mask 0x80: DS200 -> lane 8 (LSB), DS300 -> lane 1 (MSB, documented)."""
    ds200 = build([0xE0, 0x01, 0x15, 0x02, 0, 0, 0, 0x1B, 0, 0, 0x80, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0xEB])
    ds300 = build([0xE0, 0x01, 0x15, 0x03, 0, 0, 0, 0x1B, 0, 0, 0x80, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0xEB])
    assert ds.parse_frame(ds200).device == "DS200"
    assert ds.parse_frame(ds200).lane == 8
    assert ds.parse_frame(ds300).device == "DS300"
    assert ds.parse_frame(ds300).lane == 1
    # DS300 documented mapping: 0x02 -> lane 7
    ds300b = build([0xE0, 0x01, 0x15, 0x03, 0, 0, 0, 0x1B, 0, 0, 0x02, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0xEB])
    assert ds.parse_frame(ds300b).lane == 7
