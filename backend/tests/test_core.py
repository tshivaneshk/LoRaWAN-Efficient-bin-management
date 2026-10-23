import json, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import logic
from app.db import Store
from serial_bridge import parse_line

def rec(fill, seq, t="2026-10-21T06:00:00Z", bin_id="BIN-01", prov="LIVE_HARDWARE"):
    return logic.validate_record({"bin_id": bin_id, "fill_level": fill, "sequence": seq, "battery_pct": 90,
                                  "rssi_dbm": -82, "snr_db": 7.5, "received_at": t, "provenance": prov})

class Logic(unittest.TestCase):
    def test_thresholds(self):
        self.assertEqual([logic.classify(f) for f in (0, 59, 60, 79, 80, 94, 95, 100)],
                         ["NORMAL", "NORMAL", "FILLING", "FILLING", "HIGH", "HIGH", "FULL", "FULL"])
    def test_hysteresis(self):
        self.assertEqual(logic.classify(75, "HIGH"), "HIGH")
        self.assertEqual(logic.classify(69, "HIGH"), "FILLING")
        self.assertEqual(logic.classify(90, "FULL"), "FULL")
        self.assertEqual(logic.classify(84, "FULL"), "HIGH")
    def test_validation(self):
        bad = [{"fill_level": 50, "sequence": 1}, {"bin_id": "B", "fill_level": 101, "sequence": 1},
               {"bin_id": "B", "fill_level": -1, "sequence": 1}, {"bin_id": "B", "fill_level": 5, "sequence": -2},
               {"bin_id": "B", "fill_level": 5, "sequence": 1, "status": "SOMETHING"},
               {"bin_id": "B", "fill_level": "7", "sequence": 1}, {"bin_id": "B", "fill_level": True, "sequence": 1},
               {"bin_id": "B d", "fill_level": 5, "sequence": 1}]
        for b in bad:
            with self.assertRaises(logic.ValidationError, msg=str(b)): logic.validate_record(b)

class Storage(unittest.TestCase):
    def setUp(self): self.s = Store(":memory:")
    def test_duplicate_rejected(self):
        self.assertTrue(self.s.ingest(rec(20, 1))["accepted"])
        r = self.s.ingest(rec(20, 1, "2026-10-21T06:01:00Z"))
        self.assertTrue(r["duplicate"] and not r["accepted"])
        self.assertEqual(len(self.s.history("BIN-01")), 1)
    def test_same_sequence_after_window_is_reboot(self):
        self.s.ingest(rec(20, 1)); self.assertTrue(self.s.ingest(rec(20, 1, "2026-10-21T08:00:00Z"))["accepted"])
    def test_one_alert_per_transition(self):
        seq = 0; created = []
        for f in (50, 82, 83, 81, 84, 96, 97, 96, 90, 88, 86, 84, 75, 71, 69, 50):
            seq += 1; created += [a["alert_type"] for a in self.s.ingest(rec(f, seq, f"2026-10-21T06:{seq:02d}:00Z"))["alerts_created"]]
        self.assertEqual(created, ["HIGH", "FULL"])
        self.assertEqual(self.s.alerts(active_only=True), [])    # everything recovered
    def test_flicker_around_80_does_not_spam(self):
        n = 0
        for i, f in enumerate((79, 81, 79, 82, 78, 83, 79, 81)):
            n += len(self.s.ingest(rec(f, i, f"2026-10-21T06:{i:02d}:00Z"))["alerts_created"])
        self.assertEqual(n, 1)
    def test_offline_then_recovers(self):
        self.s.ingest(rec(10, 1))
        self.assertEqual(len(self.s.mark_offline(900, "2026-10-21T06:30:00Z")), 1)
        self.assertEqual(len(self.s.mark_offline(900, "2026-10-21T06:40:00Z")), 0)   # not repeated
        r = self.s.ingest(rec(10, 2, "2026-10-21T06:45:00Z"))
        self.assertIn("OFFLINE", r["alerts_resolved"])
    def test_ack(self):
        self.s.ingest(rec(85, 1)); aid = self.s.alerts()[0]["id"]
        self.assertTrue(self.s.acknowledge(aid)); self.assertFalse(self.s.acknowledge(aid))
    def test_provenance_kept(self):
        self.s.ingest(rec(97, 1, prov="SIMULATED")); self.assertEqual(self.s.bins()[0]["provenance"], "SIMULATED")

class Bridge(unittest.TestCase):
    def test_lines(self):
        good = '{"type":"telemetry","bin_id":"BIN-01","fill_level":87,"status":"HIGH","battery_pct":91,"sequence":1042,"rssi_dbm":-82,"snr_db":7.5}'
        r = parse_line(good); self.assertEqual((r["bin_id"], r["provenance"]), ("BIN-01", "LIVE_HARDWARE"))
        for ignore in ("", "LoRa init OK", '{"type":"boot","v":1}', '{"type":"telemetry","bin_id"', "[1,2]"):
            self.assertIsNone(parse_line(ignore))
        with self.assertRaises(logic.ValidationError): parse_line(good.replace("87", "187"))

if __name__ == "__main__":
    unittest.main()
