"""One-shot delivery test for alert email (run in the Health Monitor's context)."""
import os, importlib.util
spec = importlib.util.spec_from_file_location("monitor", "/Users/ggronnii/.paperclip/chewgather-ops/monitor.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
code, body, _ = m.http("POST", "https://api.resend.com/emails",
    {"from": m.ALERT_FROM, "to": [m.ALERT_EMAIL], "subject": "[Chewgather] Test alert from the Health Monitor",
     "text": "This is a one-time test from the Chewgather Health Monitor (Paperclip).\n\nIf you're reading this in your inbox, SEV1 alerts, recovery notices, the 8am daily digest and incident emails will reach you.\n\nNo action needed."},
    headers={"Authorization": f"Bearer {os.environ.get('RESEND_API_KEY','')}"})
print("resend status:", code, "| id:", body.get("id") if isinstance(body, dict) else None,
      "| error:", (body.get("message") or body.get("name")) if isinstance(body, dict) and code >= 300 else None)
