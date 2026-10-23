import base64
import json
import os
import sqlite3
import sys
import unittest

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import aes_ccm
from app.db import Store
from app.keytool import get_key_from_env_or_file
from app.main import app, store
from serial_bridge import CounterState, build_secure_payload, derive_device_id


class ModeAndEncryptionTests(unittest.TestCase):
    def setUp(self):
        store.reset()
        store.set_mode("SIMULATION")

    def test_mode_get_and_post_persistence(self):
        with TestClient(app) as client:
            # Check default mode
            r = client.get("/api/mode")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json(), {"mode": "SIMULATION"})

            # Change mode to REALTIME
            r2 = client.post("/api/mode", json={"mode": "REALTIME"})
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(r2.json(), {"mode": "REALTIME"})

            # Verify persisted in Store
            self.assertEqual(store.get_mode(), "REALTIME")

            # Verify in health
            h = client.get("/api/health").json()
            self.assertEqual(h["mode"], "REALTIME")
            self.assertEqual(h["encryption"]["mode"], "REALTIME")

    def test_realtime_rejects_simulated_provenance_with_409(self):
        store.set_mode("REALTIME")
        with TestClient(app) as client:
            # Attempt to post simulated telemetry
            sim_rec = {
                "bin_id": "BIN-01",
                "fill_level": 75,
                "sequence": 101,
                "battery_pct": 95,
                "provenance": "SIMULATED"
            }
            res_tel = client.post("/api/telemetry", json=sim_rec)
            self.assertEqual(res_tel.status_code, 409)
            self.assertEqual(res_tel.json()["detail"], "mode is REALTIME")

            # Attempt to post simulated alert
            res_alert = client.post("/api/alert", json={
                "bin_id": "BIN-01",
                "fill_level": 75,
                "provenance": "SIMULATED_DEMO"
            })
            self.assertEqual(res_alert.status_code, 409)
            self.assertEqual(res_alert.json()["detail"], "mode is REALTIME")

            # Attempt demo endpoint
            res_demo = client.post("/api/demo/bins/BIN-01", json={"fill_level": 75})
            self.assertEqual(res_demo.status_code, 409)
            self.assertEqual(res_demo.json()["detail"], "mode is REALTIME")

            # Verify nothing stored in DB
            self.assertIsNone(store.bin("BIN-01"))
            self.assertEqual(len(store.alerts()), 0)

    def test_simulation_rejects_live_hardware_with_409(self):
        store.set_mode("SIMULATION")
        with TestClient(app) as client:
            live_rec = {
                "bin_id": "BIN-02",
                "fill_level": 50,
                "sequence": 201,
                "battery_pct": 90,
                "provenance": "LIVE_HARDWARE"
            }
            res_tel = client.post("/api/telemetry", json=live_rec)
            self.assertEqual(res_tel.status_code, 409)
            self.assertEqual(res_tel.json()["detail"], "mode is SIMULATION")

            res_alert = client.post("/api/alert", json={
                "bin_id": "BIN-02",
                "fill_level": 50,
                "provenance": "LIVE_HARDWARE"
            })
            self.assertEqual(res_alert.status_code, 409)
            self.assertEqual(res_alert.json()["detail"], "mode is SIMULATION")

            # Verify nothing stored
            self.assertIsNone(store.bin("BIN-02"))

    def test_secure_endpoint_roundtrip_in_realtime_mode(self):
        store.set_mode("REALTIME")
        transport_key = get_key_from_env_or_file("TRANSPORT_KEY", "TRANSPORT_KEY")
        counter_file = "test_bridge_counter.json"
        if os.path.exists(counter_file):
            os.remove(counter_file)
        c_state = CounterState(counter_file)

        raw_rec = {
            "bin_id": "BIN-SECURE",
            "fill_level": 82.0,
            "status": "HIGH",
            "battery_pct": 94,
            "sequence": 1,
            "rssi_dbm": -79.0,
            "snr_db": 8.0,
            "provenance": "LIVE_HARDWARE",
            "received_at": "2026-10-23T10:00:00Z"
        }

        payload = build_secure_payload(raw_rec, transport_key, c_state)

        with TestClient(app) as client:
            resp = client.post("/api/telemetry/secure", json=payload)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["accepted"])
            self.assertEqual(data["status"], "HIGH")

            # Verify stored and readable via decrypted API
            b = client.get("/api/bins/BIN-SECURE").json()
            self.assertEqual(b["bin_id"], "BIN-SECURE")
            self.assertEqual(b["latest_fill_level"], 82.0)
            self.assertEqual(b["latest_status"], "HIGH")

        if os.path.exists(counter_file):
            os.remove(counter_file)

    def test_tampered_ciphertext_wrong_key_and_wrong_aad_rejected_401(self):
        store.set_mode("REALTIME")
        transport_key = get_key_from_env_or_file("TRANSPORT_KEY", "TRANSPORT_KEY")
        c_state = CounterState("test_bridge_counter_tamper.json")

        raw_rec = {
            "bin_id": "BIN-TAMP",
            "fill_level": 50.0,
            "sequence": 1,
            "battery_pct": 90,
            "provenance": "LIVE_HARDWARE",
            "received_at": "2026-10-23T10:00:00Z"
        }
        payload = build_secure_payload(raw_rec, transport_key, c_state)

        with TestClient(app) as client:
            # 1. Tamper ciphertext bytes
            raw_pkt = base64.b64decode(payload["packet"])
            tampered_pkt = bytearray(raw_pkt)
            tampered_pkt[15] ^= 0xFF
            tampered_payload = {**payload, "packet": base64.b64encode(tampered_pkt).decode("ascii")}
            r_tamp = client.post("/api/telemetry/secure", json=tampered_payload)
            self.assertEqual(r_tamp.status_code, 401)

            # 2. Wrong AAD / counter header mismatch
            wrong_aad_payload = {**payload, "counter": payload["counter"] + 5}
            r_aad = client.post("/api/telemetry/secure", json=wrong_aad_payload)
            self.assertEqual(r_aad.status_code, 401)

            # 3. Wrong key
            wrong_key = aes_ccm.generate_key()
            wrong_key_payload = build_secure_payload(raw_rec, wrong_key, c_state)
            r_key = client.post("/api/telemetry/secure", json=wrong_key_payload)
            self.assertEqual(r_key.status_code, 401)

        if os.path.exists("test_bridge_counter_tamper.json"):
            os.remove("test_bridge_counter_tamper.json")

    def test_replay_counter_rejected(self):
        store.set_mode("REALTIME")
        transport_key = get_key_from_env_or_file("TRANSPORT_KEY", "TRANSPORT_KEY")
        c_state = CounterState("test_bridge_counter_replay.json")

        raw_rec = {
            "bin_id": "BIN-REPLAY",
            "fill_level": 40.0,
            "sequence": 1,
            "battery_pct": 95,
            "provenance": "LIVE_HARDWARE",
            "received_at": "2026-10-23T10:00:00Z"
        }
        payload1 = build_secure_payload(raw_rec, transport_key, c_state)

        with TestClient(app) as client:
            r1 = client.post("/api/telemetry/secure", json=payload1)
            self.assertEqual(r1.status_code, 200)

            # Replay same payload with identical counter
            r2 = client.post("/api/telemetry/secure", json=payload1)
            self.assertEqual(r2.status_code, 401)

            # Attempt lower counter
            raw_rec["sequence"] = 2
            dev_bytes = derive_device_id("BIN-REPLAY")
            lower_counter = payload1["counter"] - 1 if payload1["counter"] > 1 else 0
            nonce = aes_ccm.nonce_from_counter(dev_bytes, lower_counter)
            aad = dev_bytes + lower_counter.to_bytes(8, byteorder="big")
            pkt = aes_ccm.encrypt_with_nonce(transport_key, nonce, json.dumps(raw_rec).encode(), aad)
            payload_lower = {
                "device_id": dev_bytes.hex(),
                "counter": lower_counter,
                "packet": base64.b64encode(pkt).decode("ascii")
            }
            r3 = client.post("/api/telemetry/secure", json=payload_lower)
            self.assertEqual(r3.status_code, 401)

        if os.path.exists("test_bridge_counter_replay.json"):
            os.remove("test_bridge_counter_replay.json")

    def test_malformed_packet_returns_400(self):
        with TestClient(app) as client:
            # Bad device_id length
            r1 = client.post("/api/telemetry/secure", json={"device_id": "ABC", "counter": 1, "packet": "AAAA"})
            self.assertEqual(r1.status_code, 400)

            # Non-int counter
            r2 = client.post("/api/telemetry/secure", json={"device_id": "0102030405", "counter": -1, "packet": "AAAA"})
            self.assertEqual(r2.status_code, 400)

            # Too short packet (< 21 bytes)
            too_short = base64.b64encode(b"short").decode("ascii")
            r3 = client.post("/api/telemetry/secure", json={"device_id": "0102030405", "counter": 1, "packet": too_short})
            self.assertEqual(r3.status_code, 400)

    def test_db_columns_unreadable_in_raw_sqlite(self):
        # Insert a record into Store
        test_store = Store(":memory:")
        test_store.set_mode("SIMULATION")
        rec = {
            "bin_id": "BIN-RAW",
            "fill_level": 77.5,
            "status": "NORMAL",
            "reported_status": "NORMAL",
            "battery_pct": 88.0,
            "sequence": 1,
            "rssi_dbm": -81.0,
            "snr_db": 6.5,
            "provenance": "SIMULATED",
            "received_at": "2026-10-23T10:00:00Z"
        }
        res = test_store.ingest(rec)
        self.assertTrue(res["accepted"])

        # Execute raw SQLite query on underlying connection
        row = test_store.db.execute("SELECT fill_level, battery_pct, status FROM telemetry WHERE bin_id='BIN-RAW'").fetchone()
        raw_fill = row["fill_level"]
        raw_battery = row["battery_pct"]
        raw_status = row["status"]

        # Raw values must start with enc1: and not contain the plaintext numbers 77.5 or 88.0
        self.assertTrue(isinstance(raw_fill, str) and raw_fill.startswith("enc1:"))
        self.assertTrue(isinstance(raw_battery, str) and raw_battery.startswith("enc1:"))
        self.assertTrue(isinstance(raw_status, str) and raw_status.startswith("enc1:"))
        self.assertNotIn("77.5", raw_fill)
        self.assertNotIn("88", raw_battery)

        # But decrypted API returns the original floating points and strings
        bin_out = test_store.bin("BIN-RAW")
        self.assertEqual(bin_out["latest_fill_level"], 77.5)
        self.assertEqual(bin_out["battery_pct"], 88.0)
        self.assertEqual(bin_out["latest_status"], "FILLING")  # 77.5 classified as FILLING

    def test_bridge_spool_contains_no_plaintext(self):
        spool_file = "test_bridge_spool.jsonl"
        counter_file = "test_bridge_counter_spool.json"
        if os.path.exists(spool_file): os.remove(spool_file)
        if os.path.exists(counter_file): os.remove(counter_file)

        from serial_bridge import handle
        transport_key = get_key_from_env_or_file("TRANSPORT_KEY", "TRANSPORT_KEY")
        c_state = CounterState(counter_file)

        line = '{"type":"telemetry","bin_id":"BIN-SPOOL","fill_level":63.5,"status":"FILLING","battery_pct":91,"sequence":101,"rssi_dbm":-80,"snr_db":7.0}'
        # Use an invalid API url to force saving to spool
        handle(line, "http://127.0.0.1:54321", "", spool_file, transport_key, c_state)

        self.assertTrue(os.path.exists(spool_file))
        content = open(spool_file, "r", encoding="utf-8").read()
        self.assertNotIn("BIN-SPOOL", content)
        self.assertNotIn("63.5", content)
        self.assertIn('"packet"', content)
        self.assertIn('"device_id"', content)

        if os.path.exists(spool_file): os.remove(spool_file)
        if os.path.exists(counter_file): os.remove(counter_file)

    def test_nonces_never_repeat_across_restarts(self):
        counter_file = "test_bridge_counter_restart.json"
        if os.path.exists(counter_file): os.remove(counter_file)

        # Session 1
        s1 = CounterState(counter_file)
        dev_id = "0102030405"
        c1 = s1.next_counter(dev_id)
        c2 = s1.next_counter(dev_id)
        self.assertEqual(c1, 1)
        self.assertEqual(c2, 2)

        # Simulate program restart by instantiating new CounterState from same file
        s2 = CounterState(counter_file)
        c3 = s2.next_counter(dev_id)
        self.assertEqual(c3, 3)

        # Ensure nonce derived from c3 is strictly unique
        dev_bytes = bytes.fromhex(dev_id)
        n1 = aes_ccm.nonce_from_counter(dev_bytes, c1)
        n2 = aes_ccm.nonce_from_counter(dev_bytes, c2)
        n3 = aes_ccm.nonce_from_counter(dev_bytes, c3)
        self.assertEqual(len({n1, n2, n3}), 3)

        if os.path.exists(counter_file): os.remove(counter_file)


if __name__ == "__main__":
    unittest.main()
