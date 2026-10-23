#!/usr/bin/env python3
"""Reads gateway JSON lines from the Arduino USB serial port and POSTs them securely to the backend.

  python serial_bridge.py --port COM5                 (Windows)
  python serial_bridge.py --port /dev/ttyUSB0         (Linux/macOS)
  python serial_bridge.py --stdin < sample_lines.txt  (no hardware, for testing)

Close the Arduino Serial Monitor first: only one program can use the port.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from app import aes_ccm  # noqa: E402
from app.keytool import get_key_from_env_or_file  # noqa: E402
from app.logic import ValidationError, utcnow_iso, validate_record  # noqa: E402


def parse_line(line: str):
    """Return a clean record for a telemetry line, or None for anything else
    (startup messages, blank lines, half-received lines)."""
    line = line.strip()
    if not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict) or obj.get("type") != "telemetry":
        return None
    obj = {k: v for k, v in obj.items() if k != "type"}
    obj["received_at"] = utcnow_iso()
    obj["provenance"] = "LIVE_HARDWARE"
    return validate_record(obj)


def derive_device_id(bin_id: str) -> bytes:
    """Derive deterministic 5-byte device_id from bin_id string."""
    return hashlib.sha256(bin_id.encode("utf-8")).digest()[:5]


class CounterState:
    """Monotonically increasing counter per device persisted to disk."""
    def __init__(self, filepath: str = "bridge_counter.json"):
        self.filepath = filepath
        self.counters: dict[str, int] = {}
        self._load()

    def _load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    self.counters = json.load(f)
            except Exception:
                self.counters = {}

    def _save(self):
        with open(self.filepath, "w", encoding="utf-8") as f:
            json.dump(self.counters, f, indent=2)

    def next_counter(self, device_id_hex: str) -> int:
        current = self.counters.get(device_id_hex, 0)
        nxt = current + 1
        self.counters[device_id_hex] = nxt
        self._save()
        return nxt


def build_secure_payload(rec: dict, transport_key: bytes, counter_state: CounterState) -> dict:
    """Encrypt validated record using AES-128-CCM with monotonic nonce."""
    dev_bytes = derive_device_id(rec["bin_id"])
    dev_hex = dev_bytes.hex()
    counter = counter_state.next_counter(dev_hex)

    nonce = aes_ccm.nonce_from_counter(dev_bytes, counter)
    aad = dev_bytes + counter.to_bytes(8, byteorder="big")

    compact_plaintext = json.dumps(rec, separators=(",", ":")).encode("utf-8")
    packet = aes_ccm.encrypt_with_nonce(transport_key, nonce, compact_plaintext, aad)

    return {
        "device_id": dev_hex,
        "counter": counter,
        "packet": base64.b64encode(packet).decode("ascii"),
    }


def post_secure(api: str, secure_payload: dict, key: str, timeout: int = 5) -> dict:
    data = json.dumps(secure_payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if key:
        headers["X-API-Key"] = key
    req = urllib.request.Request(api.rstrip("/") + "/api/telemetry/secure", data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def handle(line: str, api: str, key: str, spool: str, transport_key: bytes, counter_state: CounterState):
    try:
        rec = parse_line(line)
    except ValidationError as e:
        print(f"[reject] {e}: {line.strip()[:120]}", flush=True)
        return
    if rec is None:
        return

    secure_payload = build_secure_payload(rec, transport_key, counter_state)

    try:
        res = post_secure(api, secure_payload, key)
        print(f"[ok] {rec['bin_id']} {rec['fill_level']}% -> {res.get('status')}"
              f"{' (duplicate)' if res.get('duplicate') else ''}", flush=True)
    except urllib.error.HTTPError as e:
        if e.code == 409:
            # Mode mismatch (e.g. backend is in SIMULATION mode): reject, do not spool, do not retry
            print(f"[rejected 409] {e.read().decode('utf-8', 'replace')[:120]}", flush=True)
            return
        print(f"[backend rejected {e.code}] {e.read().decode('utf-8', 'replace')[:120]}", flush=True)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"[backend down] saved to {spool}: {e}", flush=True)
        with open(spool, "a", encoding="utf-8") as f:
            f.write(json.dumps(secure_payload) + "\n")


def flush_spool(api: str, key: str, spool: str):
    try:
        with open(spool, "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        return
    left = []
    for ln in lines:
        if not ln.strip():
            continue
        try:
            payload = json.loads(ln)
            post_secure(api, payload, key)
        except urllib.error.HTTPError as e:
            # If rejected with 409 or 4xx, do not retry forever
            if e.code in (400, 401, 409, 422):
                continue
            left.append(ln)
        except (urllib.error.URLError, TimeoutError, OSError):
            left.append(ln)
    with open(spool, "w", encoding="utf-8") as f:
        f.write("".join(x + "\n" for x in left))


def load_transport_key(transport_key_file: str | None = None) -> bytes:
    if transport_key_file:
        if not os.path.exists(transport_key_file):
            raise FileNotFoundError(f"Key file not found: {transport_key_file}")
        with open(transport_key_file, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        # Might be JSON or raw hex
        if raw.startswith("{"):
            data = json.loads(raw)
            raw = data.get("TRANSPORT_KEY", "")
        key_bytes = bytes.fromhex(raw)
        if len(key_bytes) != aes_ccm.KEY_LENGTH:
            raise ValueError(f"TRANSPORT_KEY in {transport_key_file} must be {aes_ccm.KEY_LENGTH} bytes (32 hex characters)")
        return key_bytes

    return get_key_from_env_or_file("TRANSPORT_KEY", "TRANSPORT_KEY")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--api", default="http://localhost:8765")
    ap.add_argument("--key", default="")
    ap.add_argument("--transport-key-file", default=None)
    ap.add_argument("--spool", default="bridge_spool.jsonl")
    ap.add_argument("--counter-file", default="bridge_counter.json")
    ap.add_argument("--stdin", action="store_true")
    a = ap.parse_args()

    try:
        transport_key = load_transport_key(a.transport_key_file)
    except Exception as e:
        sys.exit(f"Failed to load TRANSPORT_KEY: {e}")

    counter_state = CounterState(a.counter_file)

    if a.stdin:
        for line in sys.stdin:
            handle(line, a.api, a.key, a.spool, transport_key, counter_state)
        return

    if not a.port:
        ap.error("--port is required (or use --stdin)")

    import serial  # pip install pyserial
    while True:
        try:
            with serial.Serial(a.port, a.baud, timeout=2) as s:
                print(f"[serial] listening on {a.port} @ {a.baud}", flush=True)
                flush_spool(a.api, a.key, a.spool)
                while True:
                    raw = s.readline()
                    if raw:
                        handle(raw.decode("utf-8", "replace"), a.api, a.key, a.spool, transport_key, counter_state)
        except serial.SerialException as e:
            print(f"[serial] {e}; retrying in 3 s", flush=True)
            time.sleep(3)


if __name__ == "__main__":
    main()
