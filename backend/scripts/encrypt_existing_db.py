#!/usr/bin/env python3
"""One-time idempotent database migration script to encrypt existing plaintext rows in northgate.db.

- Backs up DB before proceeding.
- Checks whether values are already encrypted with 'enc1:' prefix.
- Encrypts bins, telemetry, and alerts measurement/message columns using AES-128-CCM with STORAGE_KEY.
- Checkpoints WAL with PRAGMA wal_checkpoint(TRUNCATE).
- Verifies that raw sqlite queries no longer return plain text numbers.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import aes_ccm  # noqa: E402
from app.db import ENC_PREFIX, SCHEMA  # noqa: E402
from app.keytool import get_key_from_env_or_file  # noqa: E402


def encrypt_val(val: any, table: str, column: str, row_id: str, ts: str, storage_key: bytes) -> str:
    if val is None:
        return None
    if isinstance(val, str) and val.startswith(ENC_PREFIX):
        return val  # Already encrypted
    aad = f"{table}|{column}|{row_id}|{ts}".encode("utf-8")
    raw_json = json.dumps(val).encode("utf-8")
    packet = aes_ccm.encrypt(storage_key, raw_json, aad)
    return ENC_PREFIX + base64.b64encode(packet).decode("ascii")


def migrate_db(db_path: str = "data/northgate.db"):
    if not os.path.exists(db_path):
        print(f"[migrate] DB file {db_path} not found. Nothing to migrate.")
        return

    # Backup before any modifications
    backup_dir = os.path.join(os.path.dirname(db_path) or ".", "backup")
    os.makedirs(backup_dir, exist_ok=True)
    backup_path = os.path.join(backup_dir, f"northgate_pre_migration_{int(os.path.getmtime(db_path))}.db")
    shutil.copy2(db_path, backup_path)
    print(f"[migrate] Backup created at {backup_path}")

    storage_key = get_key_from_env_or_file("STORAGE_KEY", "STORAGE_KEY")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Ensure tables exist
    conn.executescript(SCHEMA)

    with conn:
        # 1. Migrate bins
        bins = conn.execute("SELECT * FROM bins").fetchall()
        migrated_bins = 0
        for b in bins:
            bin_id = b["bin_id"]
            ts = b["last_seen_at"] or ""
            fill = b["latest_fill_level"]
            status = b["latest_status"]
            battery = b["battery_pct"]
            rssi = b["rssi_dbm"]
            snr = b["snr_db"]

            # Convert to numeric/appropriate JSON types if they were plaintext strings or numbers
            if fill is not None and not (isinstance(fill, str) and fill.startswith(ENC_PREFIX)):
                try:
                    fill = float(fill)
                except ValueError:
                    pass
                fill = encrypt_val(fill, "bins", "latest_fill_level", bin_id, ts, storage_key)

            if status is not None and not (isinstance(status, str) and status.startswith(ENC_PREFIX)):
                status = encrypt_val(status, "bins", "latest_status", bin_id, ts, storage_key)

            if battery is not None and not (isinstance(battery, str) and battery.startswith(ENC_PREFIX)):
                try:
                    battery = float(battery)
                except ValueError:
                    pass
                battery = encrypt_val(battery, "bins", "battery_pct", bin_id, ts, storage_key)

            if rssi is not None and not (isinstance(rssi, str) and rssi.startswith(ENC_PREFIX)):
                try:
                    rssi = float(rssi)
                except ValueError:
                    pass
                rssi = encrypt_val(rssi, "bins", "rssi_dbm", bin_id, ts, storage_key)

            if snr is not None and not (isinstance(snr, str) and snr.startswith(ENC_PREFIX)):
                try:
                    snr = float(snr)
                except ValueError:
                    pass
                snr = encrypt_val(snr, "bins", "snr_db", bin_id, ts, storage_key)

            conn.execute(
                "UPDATE bins SET latest_fill_level=?, latest_status=?, battery_pct=?, rssi_dbm=?, snr_db=? WHERE bin_id=?",
                (fill, status, battery, rssi, snr, bin_id)
            )
            migrated_bins += 1

        # 2. Migrate telemetry
        telemetry = conn.execute("SELECT * FROM telemetry").fetchall()
        migrated_tel = 0
        for t in telemetry:
            t_id = t["id"]
            bin_id = t["bin_id"]
            ts = t["received_at"] or ""
            fill = t["fill_level"]
            status = t["status"]
            rep_status = t["reported_status"]
            battery = t["battery_pct"]
            rssi = t["rssi_dbm"]
            snr = t["snr_db"]

            if fill is not None and not (isinstance(fill, str) and fill.startswith(ENC_PREFIX)):
                try:
                    fill = float(fill)
                except ValueError:
                    pass
                fill = encrypt_val(fill, "telemetry", "fill_level", bin_id, ts, storage_key)

            if status is not None and not (isinstance(status, str) and status.startswith(ENC_PREFIX)):
                status = encrypt_val(status, "telemetry", "status", bin_id, ts, storage_key)

            if rep_status is not None and not (isinstance(rep_status, str) and rep_status.startswith(ENC_PREFIX)):
                rep_status = encrypt_val(rep_status, "telemetry", "reported_status", bin_id, ts, storage_key)

            if battery is not None and not (isinstance(battery, str) and battery.startswith(ENC_PREFIX)):
                try:
                    battery = float(battery)
                except ValueError:
                    pass
                battery = encrypt_val(battery, "telemetry", "battery_pct", bin_id, ts, storage_key)

            if rssi is not None and not (isinstance(rssi, str) and rssi.startswith(ENC_PREFIX)):
                try:
                    rssi = float(rssi)
                except ValueError:
                    pass
                rssi = encrypt_val(rssi, "telemetry", "rssi_dbm", bin_id, ts, storage_key)

            if snr is not None and not (isinstance(snr, str) and snr.startswith(ENC_PREFIX)):
                try:
                    snr = float(snr)
                except ValueError:
                    pass
                snr = encrypt_val(snr, "telemetry", "snr_db", bin_id, ts, storage_key)

            conn.execute(
                "UPDATE telemetry SET fill_level=?, status=?, reported_status=?, battery_pct=?, rssi_dbm=?, snr_db=? WHERE id=?",
                (fill, status, rep_status, battery, rssi, snr, t_id)
            )
            migrated_tel += 1

        # 3. Migrate alerts
        alerts = conn.execute("SELECT * FROM alerts").fetchall()
        migrated_alerts = 0
        for a in alerts:
            a_id = a["id"]
            bin_id = a["bin_id"]
            ts = a["created_at"] or ""
            msg = a["message"]
            if msg is not None and not (isinstance(msg, str) and msg.startswith(ENC_PREFIX)):
                msg = encrypt_val(msg, "alerts", "message", bin_id, ts, storage_key)
                conn.execute("UPDATE alerts SET message=? WHERE id=?", (msg, a_id))
            migrated_alerts += 1

    # Checkpoint WAL so no plaintext remains in WAL
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    print(f"[migrate] Complete: {migrated_bins} bins, {migrated_tel} telemetry records, {migrated_alerts} alerts encrypted.")

    # Verification query
    raw_conn = sqlite3.connect(db_path)
    sample_tel = raw_conn.execute("SELECT fill_level, battery_pct FROM telemetry LIMIT 5").fetchall()
    print("[migrate] Raw verification sample (telemetry fill_level, battery_pct):")
    for row in sample_tel:
        print(f"  {row}")
    raw_conn.close()


if __name__ == "__main__":
    db_file = sys.argv[1] if len(sys.argv) > 1 else "data/northgate.db"
    migrate_db(db_file)
