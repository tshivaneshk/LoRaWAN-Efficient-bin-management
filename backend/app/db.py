"""SQLite storage with field-level AES-128-CCM encryption at rest.

One connection guarded by a lock (fine for a prototype).
Encryption and decryption are handled strictly inside Store so logic.py
and API consumers continue to interact with normal JSON values.
"""
from __future__ import annotations

import base64
import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from . import aes_ccm
from . import logic
from .keytool import get_key_from_env_or_file

ENC_PREFIX = "enc1:"

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_counters(
  device_id TEXT PRIMARY KEY,
  last_counter INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bins(
  bin_id TEXT PRIMARY KEY, name TEXT, location TEXT,
  latest_fill_level TEXT, latest_status TEXT, battery_pct TEXT,
  rssi_dbm TEXT, snr_db TEXT, last_seen_at TEXT, provenance TEXT);
CREATE TABLE IF NOT EXISTS telemetry(
  id INTEGER PRIMARY KEY AUTOINCREMENT, bin_id TEXT NOT NULL,
  fill_level TEXT, status TEXT, reported_status TEXT, battery_pct TEXT,
  rssi_dbm TEXT, snr_db TEXT, sequence INTEGER, received_at TEXT, provenance TEXT);
CREATE INDEX IF NOT EXISTS ix_tel_bin_time ON telemetry(bin_id, received_at);
CREATE TABLE IF NOT EXISTS alerts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, bin_id TEXT NOT NULL, alert_type TEXT,
  message TEXT, created_at TEXT, acknowledged_at TEXT, resolved_at TEXT, provenance TEXT);
CREATE INDEX IF NOT EXISTS ix_alert_bin ON alerts(bin_id, alert_type);
"""


def _parse(ts: str) -> datetime:
    d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


class Store:
    def __init__(self, path: str = ":memory:", duplicate_window_s: int = 600, storage_key: bytes | None = None):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self.dup_window = duplicate_window_s
        self.storage_key = storage_key or get_key_from_env_or_file("STORAGE_KEY", "STORAGE_KEY")

        with self.lock:
            if path != ":memory:":
                self.db.execute("PRAGMA journal_mode=WAL")
            self.db.executescript(SCHEMA)
            # Default mode = SIMULATION
            cur = self.db.execute("SELECT value FROM settings WHERE key='mode'").fetchone()
            if not cur:
                self.db.execute("INSERT INTO settings(key, value) VALUES('mode', 'SIMULATION')")
                self.db.commit()

    def _encrypt_val(self, val: any, table: str, column: str, row_id: str, ts: str) -> str:
        """Encrypt a single value with AES-128-CCM and return formatted as enc1:<base64>."""
        if val is None:
            return None
        aad = f"{table}|{column}|{row_id}|{ts}".encode("utf-8")
        raw_json = json.dumps(val).encode("utf-8")
        packet = aes_ccm.encrypt(self.storage_key, raw_json, aad)
        return ENC_PREFIX + base64.b64encode(packet).decode("ascii")

    def _decrypt_val(self, enc_val: any, table: str, column: str, row_id: str, ts: str) -> any:
        """Decrypt a value if prefixed with enc1:, or return as-is for plaintext compatibility."""
        if enc_val is None:
            return None
        if isinstance(enc_val, str) and enc_val.startswith(ENC_PREFIX):
            b64_str = enc_val[len(ENC_PREFIX):]
            packet = base64.b64decode(b64_str)
            aad = f"{table}|{column}|{row_id}|{ts}".encode("utf-8")
            plaintext = aes_ccm.decrypt(self.storage_key, packet, aad)
            return json.loads(plaintext.decode("utf-8"))
        # Unencrypted legacy value: attempt float/int/json conversion or return raw
        return enc_val

    def get_mode(self) -> str:
        with self.lock:
            row = self.db.execute("SELECT value FROM settings WHERE key='mode'").fetchone()
            return row["value"] if row else "SIMULATION"

    def set_mode(self, mode: str) -> str:
        if mode not in ("SIMULATION", "REALTIME"):
            raise ValueError("mode must be SIMULATION or REALTIME")
        with self.lock, self.db:
            self.db.execute(
                "INSERT INTO settings(key, value) VALUES('mode', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (mode,)
            )
            return mode

    def check_and_update_device_counter(self, device_id: str, counter: int) -> bool:
        """Check monotonic counter per device. Rejects replay (counter <= last_counter)."""
        now_iso = logic.utcnow_iso()
        with self.lock, self.db:
            row = self.db.execute("SELECT last_counter FROM device_counters WHERE device_id=?", (device_id,)).fetchone()
            if row:
                if counter <= row["last_counter"]:
                    return False
                self.db.execute(
                    "UPDATE device_counters SET last_counter=?, updated_at=? WHERE device_id=?",
                    (counter, now_iso, device_id)
                )
            else:
                self.db.execute(
                    "INSERT INTO device_counters(device_id, last_counter, updated_at) VALUES(?, ?, ?)",
                    (device_id, counter, now_iso)
                )
            return True

    def _active(self, bin_id: str) -> dict[str, int]:
        rows = self.db.execute(
            "SELECT id, alert_type FROM alerts WHERE bin_id=? AND resolved_at IS NULL", (bin_id,)
        ).fetchall()
        return {r["alert_type"]: r["id"] for r in rows}

    def _get_bin_decrypted(self, bin_id: str) -> dict | None:
        row = self.db.execute("SELECT * FROM bins WHERE bin_id=?", (bin_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        ts = d.get("last_seen_at") or ""
        d["latest_fill_level"] = self._decrypt_val(d["latest_fill_level"], "bins", "latest_fill_level", bin_id, ts)
        d["latest_status"] = self._decrypt_val(d["latest_status"], "bins", "latest_status", bin_id, ts)
        d["battery_pct"] = self._decrypt_val(d["battery_pct"], "bins", "battery_pct", bin_id, ts)
        d["rssi_dbm"] = self._decrypt_val(d["rssi_dbm"], "bins", "rssi_dbm", bin_id, ts)
        d["snr_db"] = self._decrypt_val(d["snr_db"], "bins", "snr_db", bin_id, ts)
        return d

    def ingest(self, rec: dict) -> dict:
        """Store a validated record. Returns what happened."""
        with self.lock, self.db:
            now = _parse(rec["received_at"])
            dup = self.db.execute(
                "SELECT received_at FROM telemetry WHERE bin_id=? AND sequence=? AND provenance=? "
                "ORDER BY id DESC LIMIT 1", (rec["bin_id"], rec["sequence"], rec["provenance"])
            ).fetchone()
            if dup and abs((now - _parse(dup["received_at"])).total_seconds()) <= self.dup_window:
                return {"accepted": False, "duplicate": True}

            prev_bin = self._get_bin_decrypted(rec["bin_id"])
            prev_status = prev_bin["latest_status"] if (prev_bin and prev_bin.get("latest_status")) else "NORMAL"
            status = logic.classify(rec["fill_level"], prev_status)

            # Encrypt values for telemetry table
            rec_at = rec["received_at"]
            bin_id = rec["bin_id"]

            tel_fill = self._encrypt_val(rec["fill_level"], "telemetry", "fill_level", bin_id, rec_at)
            tel_status = self._encrypt_val(status, "telemetry", "status", bin_id, rec_at)
            tel_rep_status = self._encrypt_val(rec.get("reported_status"), "telemetry", "reported_status", bin_id, rec_at)
            tel_battery = self._encrypt_val(rec.get("battery_pct"), "telemetry", "battery_pct", bin_id, rec_at)
            tel_rssi = self._encrypt_val(rec.get("rssi_dbm"), "telemetry", "rssi_dbm", bin_id, rec_at)
            tel_snr = self._encrypt_val(rec.get("snr_db"), "telemetry", "snr_db", bin_id, rec_at)

            self.db.execute(
                "INSERT INTO telemetry(bin_id,fill_level,status,reported_status,battery_pct,rssi_dbm,snr_db,"
                "sequence,received_at,provenance) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (bin_id, tel_fill, tel_status, tel_rep_status, tel_battery,
                 tel_rssi, tel_snr, rec["sequence"], rec_at, rec["provenance"])
            )

            # Encrypt values for bins table (keyed by bin_id and last_seen_at)
            bin_fill = self._encrypt_val(rec["fill_level"], "bins", "latest_fill_level", bin_id, rec_at)
            bin_status = self._encrypt_val(status, "bins", "latest_status", bin_id, rec_at)
            bin_battery = self._encrypt_val(rec.get("battery_pct"), "bins", "battery_pct", bin_id, rec_at)
            bin_rssi = self._encrypt_val(rec.get("rssi_dbm"), "bins", "rssi_dbm", bin_id, rec_at)
            bin_snr = self._encrypt_val(rec.get("snr_db"), "bins", "snr_db", bin_id, rec_at)

            self.db.execute(
                "INSERT INTO bins(bin_id,name,latest_fill_level,latest_status,battery_pct,rssi_dbm,snr_db,"
                "last_seen_at,provenance) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bin_id) DO UPDATE SET "
                "latest_fill_level=excluded.latest_fill_level, latest_status=excluded.latest_status, "
                "battery_pct=COALESCE(excluded.battery_pct,battery_pct), rssi_dbm=excluded.rssi_dbm, "
                "snr_db=excluded.snr_db, last_seen_at=excluded.last_seen_at, provenance=excluded.provenance",
                (bin_id, bin_id, bin_fill, bin_status, bin_battery,
                 bin_rssi, bin_snr, rec_at, rec["provenance"])
            )

            raise_, resolve = logic.plan_alerts(status, set(self._active(bin_id)))
            active = self._active(bin_id)
            for kind in resolve:
                self.db.execute("UPDATE alerts SET resolved_at=? WHERE id=?", (rec_at, active[kind]))

            created = []
            for kind in raise_:
                msg = logic.alert_message(kind, bin_id, rec["fill_level"])
                # Note: alert message encrypted with AAD="alerts|message|bin_id|created_at"
                enc_msg = self._encrypt_val(msg, "alerts", "message", bin_id, rec_at)
                cur = self.db.execute(
                    "INSERT INTO alerts(bin_id,alert_type,message,created_at,provenance) VALUES(?,?,?,?,?)",
                    (bin_id, kind, enc_msg, rec_at, rec["provenance"])
                )
                created.append({"id": cur.lastrowid, "bin_id": bin_id, "alert_type": kind, "message": msg})

            return {"accepted": True, "duplicate": False, "status": status,
                    "alerts_created": created, "alerts_resolved": resolve}

    def mark_offline(self, timeout_s: int, now_iso: str = None) -> list:
        """Raise one OFFLINE alert for each bin silent for longer than timeout_s."""
        now = _parse(now_iso or logic.utcnow_iso())
        out = []
        with self.lock, self.db:
            for b in self.db.execute("SELECT bin_id,last_seen_at,provenance FROM bins").fetchall():
                if now - _parse(b["last_seen_at"]) > timedelta(seconds=timeout_s) and \
                        "OFFLINE" not in self._active(b["bin_id"]):
                    msg = logic.alert_message("OFFLINE", b["bin_id"], 0)
                    ts = now_iso or logic.utcnow_iso()
                    enc_msg = self._encrypt_val(msg, "alerts", "message", b["bin_id"], ts)
                    cur = self.db.execute(
                        "INSERT INTO alerts(bin_id,alert_type,message,created_at,provenance) VALUES(?,?,?,?,?)",
                        (b["bin_id"], "OFFLINE", enc_msg, ts, b["provenance"])
                    )
                    out.append({"id": cur.lastrowid, "bin_id": b["bin_id"], "alert_type": "OFFLINE", "message": msg})
        return out

    def bins(self):
        with self.lock:
            rows = self.db.execute("SELECT * FROM bins ORDER BY bin_id").fetchall()
            out = []
            for r in rows:
                d = dict(r)
                ts = d.get("last_seen_at") or ""
                bin_id = d["bin_id"]
                d["latest_fill_level"] = self._decrypt_val(d["latest_fill_level"], "bins", "latest_fill_level", bin_id, ts)
                d["latest_status"] = self._decrypt_val(d["latest_status"], "bins", "latest_status", bin_id, ts)
                d["battery_pct"] = self._decrypt_val(d["battery_pct"], "bins", "battery_pct", bin_id, ts)
                d["rssi_dbm"] = self._decrypt_val(d["rssi_dbm"], "bins", "rssi_dbm", bin_id, ts)
                d["snr_db"] = self._decrypt_val(d["snr_db"], "bins", "snr_db", bin_id, ts)
                out.append(d)
            return out

    def bin(self, bin_id: str):
        with self.lock:
            return self._get_bin_decrypted(bin_id)

    def history(self, bin_id: str, limit: int = 200):
        with self.lock:
            rows = self.db.execute(
                "SELECT * FROM telemetry WHERE bin_id=? ORDER BY id DESC LIMIT ?",
                (bin_id, limit)
            ).fetchall()
            out = []
            for r in reversed(rows):
                d = dict(r)
                rec_at = d.get("received_at") or ""
                b_id = d["bin_id"]
                d["fill_level"] = self._decrypt_val(d["fill_level"], "telemetry", "fill_level", b_id, rec_at)
                d["status"] = self._decrypt_val(d["status"], "telemetry", "status", b_id, rec_at)
                d["reported_status"] = self._decrypt_val(d["reported_status"], "telemetry", "reported_status", b_id, rec_at)
                d["battery_pct"] = self._decrypt_val(d["battery_pct"], "telemetry", "battery_pct", b_id, rec_at)
                d["rssi_dbm"] = self._decrypt_val(d["rssi_dbm"], "telemetry", "rssi_dbm", b_id, rec_at)
                d["snr_db"] = self._decrypt_val(d["snr_db"], "telemetry", "snr_db", b_id, rec_at)
                out.append(d)
            return out

    def alerts(self, active_only: bool = False, limit: int = 100):
        q = "SELECT * FROM alerts" + (" WHERE resolved_at IS NULL" if active_only else "") + " ORDER BY id DESC LIMIT ?"
        with self.lock:
            rows = self.db.execute(q, (limit,)).fetchall()
            out = []
            for r in rows:
                d = dict(r)
                ts = d.get("created_at") or ""
                bin_id = d["bin_id"]
                d["message"] = self._decrypt_val(d["message"], "alerts", "message", bin_id, ts)
                out.append(d)
            return out

    def acknowledge(self, alert_id: int) -> bool:
        with self.lock, self.db:
            cur = self.db.execute(
                "UPDATE alerts SET acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL",
                (logic.utcnow_iso(), alert_id)
            )
            return cur.rowcount > 0

    def reset(self):
        with self.lock, self.db:
            self.db.execute("DELETE FROM alerts")
            self.db.execute("DELETE FROM telemetry")
            self.db.execute("DELETE FROM bins")
            self.db.execute("DELETE FROM device_counters")
