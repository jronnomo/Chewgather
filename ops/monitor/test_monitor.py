"""Offline tests for monitor.py: python3 -m unittest ops/monitor/test_monitor.py (stdlib only, no network)."""
import copy
import importlib.util
import json
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_TMP = tempfile.mkdtemp()
os.environ.update(OPS_STATE_DIR=_TMP, GOOGLE_PLACES_API_KEY="k", PAPERCLIP_COMPANY_ID="co", FAIL_THRESHOLD="2")
for var in ("RESEND_API_KEY", "FLY_API_TOKEN", "SENTRY_AUTH_TOKEN", "SYNTH_EMAIL", "HEALTHCHECKS_PING_URL"):
    os.environ.pop(var, None)
spec = importlib.util.spec_from_file_location("monitor", os.path.join(HERE, "monitor.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

HEALTHY_BODY = {"ok": True, "checks": {"mongo": {"ok": True}}}


class MonitorTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        m.STATE_DIR = self.dir
        m.STATE_PATH = os.path.join(self.dir, "state.json")
        m.METRICS_PATH = os.path.join(self.dir, "metrics.jsonl")
        m.HEARTBEAT_PATH = os.path.join(self.dir, "heartbeat.json")
        m.NOW = 1_800_000_000.0
        self.net_up = True  # pre-check result; the gate must hold with this True
        self.down = set()  # targets returning no response
        self.requests = []
        self.tls_error = False
        m.http = self.fake_http
        m.tls_days_left = self.fake_tls

    def fake_http(self, method, url, body=None, headers=None, timeout=15):
        self.requests.append((method, url))
        if "1.1.1.1" in url or "generate_204" in url:
            return (204, "", 1) if self.net_up else (0, "URLError", 1)
        if "/api/companies/" in url and url.endswith("/agents"):
            return 200, [], 1
        if "/issues" in url and method == "GET":
            return 200, [], 1
        if "/issues" in url and method == "POST":
            return 201, {"identifier": "CHE-X"}, 1
        for target, needle in (("backend", "chewgather-backend.fly.dev"), ("website", "chewgather.com"),
                               ("google-places", "places.googleapis.com")):
            if needle in url:
                if target in self.down:
                    return 0, "URLError: down", 1
                return (200, HEALTHY_BODY if target == "backend" else "ok", 5)
        return 200, {}, 1

    def fake_tls(self, host):
        if self.tls_error:
            raise OSError("network is unreachable")
        return 90.0

    def run_once(self):
        m.main()
        with open(m.METRICS_PATH) as f:
            return [json.loads(line) for line in f]

    def incidents(self):
        return [r for r in self.requests if r[0] == "POST" and r[1].endswith("/issues")]

    def state(self):
        with open(m.STATE_PATH) as f:
            return json.load(f)

    def test_all_targets_down_is_local_network_fault_even_when_precheck_passes(self):
        self.down = {"backend", "website", "google-places"}
        self.tls_error = True  # board-routed, threshold 1: would open an incident immediately if not gated
        seed = {"checks": {"backend-down": {"fails": 1, "first": 1.0, "sev": 1}}, "last_tls": 5.0}
        with open(m.STATE_PATH, "w") as f:
            json.dump(seed, f)
        for _ in range(3):
            rows = self.run_once()
        self.assertEqual(self.incidents(), [])
        self.assertTrue(all(r["classification"] == "local-network-fault" for r in rows))
        self.assertEqual(rows[-1]["probes"], {"backend": 0, "website": 0, "google-places": 0})
        st = self.state()
        self.assertEqual(st["checks"], seed["checks"])  # counters untouched
        self.assertEqual(st["last_tls"], 5.0)  # due() throttle rolled back
        self.assertEqual(st["local_fault_runs"], 3)
        self.assertEqual(json.load(open(m.HEARTBEAT_PATH))["outcome"], "local-network-fault")

    def test_single_target_failure_still_reaches_threshold_and_opens_incident(self):
        self.down = {"backend"}
        self.run_once()
        self.assertEqual(self.state()["checks"]["backend-down"]["fails"], 1)
        self.assertEqual(self.incidents(), [])
        rows = self.run_once()
        self.assertEqual(self.state()["checks"]["backend-down"]["fails"], 2)
        self.assertEqual(len(self.incidents()), 1)
        self.assertNotIn("classification", rows[-1])
        self.assertEqual(json.load(open(m.HEARTBEAT_PATH))["outcome"], "failing")

    def test_two_of_three_targets_down_counts_normally(self):
        self.down = {"backend", "website"}
        self.run_once()
        rows = self.run_once()
        self.assertNotIn("classification", rows[-1])
        self.assertEqual(self.state()["checks"]["backend-down"]["fails"], 2)
        self.assertEqual(self.state()["checks"]["website"]["fails"], 2)

    def test_non_zero_http_error_is_not_a_local_fault(self):
        # 503 from a reachable backend is a real outage signal, not a missing network.
        self.assertFalse(m.local_network_fault({"probes": {"backend": 503, "website": 0, "google-places": 0}}))
        self.assertFalse(m.local_network_fault({"probes": {"backend": 0, "website": 0}}))  # too few targets
        self.assertTrue(m.local_network_fault({"probes": {"backend": 0, "website": 0, "resend": 0}}))

    def test_offline_precheck_still_skips_and_writes_heartbeat(self):
        self.net_up = False
        before = copy.deepcopy(self.state()) if os.path.exists(m.STATE_PATH) else None
        rows = self.run_once()
        self.assertEqual(rows[-1]["classification"], "host-offline")
        self.assertEqual(self.incidents(), [])
        self.assertEqual(json.load(open(m.HEARTBEAT_PATH))["outcome"], "host-offline")
        self.assertEqual(self.state().get("checks", {}), (before or {}).get("checks", {}))

    def test_healthy_run_writes_heartbeat(self):
        self.run_once()
        hb = json.load(open(m.HEARTBEAT_PATH))
        self.assertEqual((hb["outcome"], hb["failing"], hb["ts"]), ("ok", [], m.NOW))


if __name__ == "__main__":
    unittest.main()
