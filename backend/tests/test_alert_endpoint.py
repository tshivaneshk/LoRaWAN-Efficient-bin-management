import asyncio
import os
import sys
import unittest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.main import app, store

class AlertEndpointTests(unittest.TestCase):
    def setUp(self):
        store.reset()
        store.set_mode("SIMULATION")

    def test_valid_alert_accepted_and_recorded(self):
        with TestClient(app) as client:
            resp = client.post("/api/alert", json={
                "bin_id": "BIN-01",
                "fill_level": 82.5,
                "status": "HIGH",
                "battery_pct": 90,
                "note": "Spike after lunch market rush",
                "provenance": "SIMULATED_DEMO"
            })
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data.get("accepted"))
            self.assertEqual(data.get("status"), "HIGH")
            self.assertEqual(len(data.get("alerts_created", [])), 1)
            self.assertEqual(data["alerts_created"][0]["alert_type"], "HIGH")

            # Verify GET /api/bins/BIN-01
            bin_resp = client.get("/api/bins/BIN-01")
            self.assertEqual(bin_resp.status_code, 200)
            b = bin_resp.json()
            self.assertEqual(b["bin_id"], "BIN-01")
            self.assertEqual(b["latest_fill_level"], 82.5)
            self.assertEqual(b["latest_status"], "HIGH")

    def test_invalid_payload_rejected_422(self):
        with TestClient(app) as client:
            # Missing fill_level
            resp1 = client.post("/api/alert", json={"bin_id": "BIN-01"})
            self.assertEqual(resp1.status_code, 422)

            # fill_level > 100
            resp2 = client.post("/api/alert", json={"bin_id": "BIN-01", "fill_level": 150})
            self.assertEqual(resp2.status_code, 422)

            # Invalid bin_id characters
            resp3 = client.post("/api/alert", json={"bin_id": "BIN 01 bad!", "fill_level": 50})
            self.assertEqual(resp3.status_code, 422)

            # Invalid provenance
            resp4 = client.post("/api/alert", json={"bin_id": "BIN-01", "fill_level": 50, "provenance": "HACKED"})
            self.assertEqual(resp4.status_code, 422)

    def test_duplicate_suppressed(self):
        # Direct Store test: same bin, sequence, and provenance within dup window is suppressed
        rec = {
            "bin_id": "BIN-01",
            "fill_level": 50.0,
            "status": "NORMAL",
            "reported_status": "NORMAL",
            "battery_pct": 95,
            "sequence": 1234,
            "rssi_dbm": -80,
            "snr_db": 8.0,
            "provenance": "SIMULATED_DEMO",
            "received_at": "2026-10-21T06:00:00Z"
        }
        res1 = store.ingest(rec)
        self.assertTrue(res1["accepted"])
        # Same sequence within duplicate window
        res2 = store.ingest({**rec, "received_at": "2026-10-21T06:01:00Z"})
        self.assertFalse(res2["accepted"])
        self.assertTrue(res2["duplicate"])

    def test_websocket_receives_broadcast_on_alert(self):
        with TestClient(app) as client:
            with client.websocket_connect("/live") as ws:
                hello = ws.receive_json()
                self.assertEqual(hello.get("type"), "hello")

                # Send an alert that raises HIGH
                resp = client.post("/api/alert", json={
                    "bin_id": "BIN-02",
                    "fill_level": 88,
                    "provenance": "SIMULATED_DEMO"
                })
                self.assertEqual(resp.status_code, 200)

                # Expect exactly telemetry broadcast followed by alert broadcast
                msg1 = ws.receive_json()
                self.assertEqual(msg1.get("type"), "simulated_telemetry")
                self.assertEqual(msg1.get("bin_id"), "BIN-02")
                self.assertEqual(msg1.get("status"), "HIGH")

                msg2 = ws.receive_json()
                self.assertEqual(msg2.get("type"), "alert")
                self.assertEqual(msg2.get("bin_id"), "BIN-02")
                self.assertEqual(msg2.get("alert_type"), "HIGH")

    def test_get_bin_404_when_unknown(self):
        with TestClient(app) as client:
            resp = client.get("/api/bins/NON-EXISTENT")
            self.assertEqual(resp.status_code, 404)

    def test_admin_reset_endpoint(self):
        with TestClient(app) as client:
            client.post("/api/alert", json={"bin_id": "BIN-99", "fill_level": 70})
            self.assertEqual(client.get("/api/bins/BIN-99").status_code, 200)

            reset_resp = client.post("/api/admin/reset")
            self.assertEqual(reset_resp.status_code, 200)
            self.assertEqual(client.get("/api/bins/BIN-99").status_code, 404)
            self.assertEqual(len(client.get("/api/bins").json()), 0)

if __name__ == "__main__":
    unittest.main()
