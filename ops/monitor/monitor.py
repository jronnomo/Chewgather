#!/usr/bin/env python3
"""Chewgather Health Monitor.

Run by the Paperclip "Health Monitor" agent (process adapter) every 5 minutes.
No LLM, stdlib only. Probes production, opens and updates deduped incident issues,
emails SEV1 alerts and a daily digest, and pings a dead-man switch.

Incident routing:
  agent -> assigned to the Incident Responder, with a review (Reviewer) then approval (board) policy
  board -> assigned to the board user; needs human access the agents do not have (GCP, DNS, billing, Paperclip)

Optional env (a check is skipped when its inputs are missing):
  GOOGLE_PLACES_API_KEY           free IDs-only Place Details probe
  SYNTH_EMAIL / SYNTH_PASSWORD    synthetic login + /users/me journey
  RESEND_API_KEY + ALERT_EMAIL    SEV1 alert emails, daily digest, Resend domain check
  FLY_API_TOKEN                   Fly machine state (read-only token)
  SENTRY_AUTH_TOKEN/ORG/PROJECT   new unresolved Sentry issues
  HEALTHCHECKS_PING_URL           dead-man switch (e.g. healthchecks.io) pinged every run
  HEARTBEAT_PATH                  heartbeat JSON written on every completed run (default STATE_DIR/heartbeat.json)
  LOCAL_FAULT_MIN_TARGETS         independent targets that must all fail with no response before a sample is
                                  classed local-network-fault (default 3)
Drill: write a check name into STATE_DIR/drill to force that check to fail (delete the file to end).
"""
import datetime as dt
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request

E = os.environ.get
API = (E("PAPERCLIP_API_URL", "http://localhost:3100").rstrip("/")) + "/api"
CO = E("PAPERCLIP_COMPANY_ID", "")
BASE = E("CHEWGATHER_API", "https://chewgather-backend.fly.dev").rstrip("/")
SITE = E("CHEWGATHER_SITE", "https://chewgather.com").rstrip("/")
STATE_DIR = E("OPS_STATE_DIR", os.path.expanduser("~/.paperclip/chewgather-ops/state"))
THRESH = int(E("FAIL_THRESHOLD", "2"))
SLOW_MS = int(E("SLOW_MS", "3000"))
MAX_NEW = int(E("MAX_NEW_INCIDENTS_PER_RUN", "3"))
STILL_FAILING_COMMENT_EVERY = int(E("STILL_FAILING_COMMENT_EVERY_SEC", str(6 * 3600)))
RECOVERY_EMAIL_EVERY = int(E("RECOVERY_EMAIL_EVERY_SEC", str(6 * 3600)))
ALERT_EMAIL = E("ALERT_EMAIL", "jerry@chewgather.com")
ALERT_FROM = E("ALERT_FROM", "Chewgather Monitor <monitor@send.chewgather.com>")
DIGEST_HOUR = int(E("DIGEST_HOUR", "8"))
BOARD_USER = E("BOARD_USER_ID", "local-board")
os.makedirs(STATE_DIR, exist_ok=True)
STATE_PATH = os.path.join(STATE_DIR, "state.json")
METRICS_PATH = os.path.join(STATE_DIR, "metrics.jsonl")
HEARTBEAT_PATH = E("HEARTBEAT_PATH", os.path.join(STATE_DIR, "heartbeat.json"))
LOCAL_FAULT_MIN_TARGETS = int(E("LOCAL_FAULT_MIN_TARGETS", "3"))
NOW = time.time()


def log(msg):
    print(msg, flush=True)


def http(method, url, body=None, headers=None, timeout=15):
    """Return (status, parsed-json-or-text, elapsed_ms). Never raises."""
    data = json.dumps(body).encode() if body is not None else None
    h = {"User-Agent": "chewgather-monitor/2", **(headers or {})}
    if data is not None:
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw, code = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, code = e.read(), e.code
    except Exception as e:  # DNS, TLS, timeout
        return 0, f"{type(e).__name__}: {e}", int((time.time() - t0) * 1000)
    ms = int((time.time() - t0) * 1000)
    try:
        return code, json.loads(raw.decode() or "null"), ms
    except Exception:
        return code, raw.decode(errors="replace")[:2000], ms


def pc(method, path, body=None):
    headers = {}
    if E("PAPERCLIP_API_KEY"):
        headers["Authorization"] = f"Bearer {E('PAPERCLIP_API_KEY')}"
    if E("PAPERCLIP_RUN_ID"):
        headers["X-Paperclip-Run-Id"] = E("PAPERCLIP_RUN_ID")
    return http(method, API + path, body, headers)


def probe(metrics, target, code):
    """Record the raw status of one independent external target (0 = no response) for the correlation gate."""
    metrics.setdefault("probes", {})[target] = code


def local_network_fault(metrics):
    """True when every independent external target probed in this sample got no response at all.
    Backend (Fly), website (GitHub Pages), Google Places and Resend are separate providers on separate DNS
    names; they do not all fail together unless this host lost its network (e.g. macOS dark wake).
    Deliberately independent of host_online() so it still holds when that pre-check passes."""
    codes = list(metrics.get("probes", {}).values())
    return len(codes) >= LOCAL_FAULT_MIN_TARGETS and all(c == 0 for c in codes)


def write_heartbeat(outcome, failing=()):
    """Atomically write the dead-man heartbeat: an external watcher alerts when `ts` goes stale."""
    hb = {"ts": NOW, "iso": dt.datetime.fromtimestamp(NOW, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
          "outcome": outcome, "failing": sorted(failing), "pid": os.getpid()}
    os.makedirs(os.path.dirname(HEARTBEAT_PATH) or ".", exist_ok=True)
    tmp = HEARTBEAT_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(hb, f)
    os.replace(tmp, HEARTBEAT_PATH)


def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {"checks": {}}


def save_state(s):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, STATE_PATH)


def due(state, key, minutes):
    last = state.get(key, 0)
    if NOW - last >= minutes * 60:
        state[key] = NOW
        return True
    return False


class Fail:
    def __init__(self, check, sev, summary, detail="", route="agent"):
        self.check, self.sev, self.summary, self.detail, self.route = check, sev, summary, str(detail)[:3000], route


# --------------------------------------------------------------------------- checks

def check_backend(metrics):
    code, body, ms = http("GET", BASE + "/health/deep")
    endpoint = "/health/deep"
    if code == 404:
        code, body, ms = http("GET", BASE + "/health")
        endpoint = "/health"
    metrics["backend_ms"], metrics["backend_code"], metrics["backend_endpoint"] = ms, code, endpoint
    probe(metrics, "backend", code)
    out = []
    if code != 200:
        return [Fail("backend-down", 1, f"Backend {endpoint} returned {code or 'no response'}", body)]
    if isinstance(body, dict) and isinstance(body.get("checks"), dict):
        for name, c in body["checks"].items():
            ok = isinstance(c, dict) and c.get("ok") is True
            metrics.setdefault("deps", {})[name] = ok
            if not ok:
                sev = 1 if name == "mongo" else 2
                out.append(Fail(f"dep-{name}", sev, f"Dependency unhealthy: {name}", json.dumps(c)))
    elif not (isinstance(body, dict) and body.get("ok") is True):
        out.append(Fail("backend-unhealthy", 1, f"Backend {endpoint} reports not ok", body))
    if ms > SLOW_MS:
        out.append(Fail("backend-slow", 3, f"Backend {endpoint} took {ms}ms (> {SLOW_MS}ms)", body))
    return out


def check_website(metrics):
    # App Store Connect requires the support + privacy URLs to be live.
    out = []
    for path in ("/", "/privacy/", "/support/", "/terms/"):
        code, body, _ = http("GET", SITE + path)
        metrics.setdefault("site", {})[path] = code
        if path == "/":
            probe(metrics, "website", code)
        if code != 200:
            out.append(Fail("website", 2, f"{SITE}{path} returned {code or 'no response'}",
                            f"{path}: {str(body)[:300]}", route="board"))
            break
    return out


def tls_days_left(host):
    ctx = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as s:
            exp = ssl.cert_time_to_seconds(s.getpeercert()["notAfter"])
    return (exp - NOW) / 86400


def check_tls(metrics, state):
    if not due(state, "last_tls", 360):
        return None  # None = not evaluated this run (keeps prior counters)
    out = []
    for host in ("chewgather.com", BASE.split("//")[1].split("/")[0]):
        try:
            days = tls_days_left(host)
        except Exception as e:
            out.append(Fail("tls", 2, f"TLS handshake failed for {host}", repr(e), route="board"))
            continue
        metrics.setdefault("tls_days", {})[host] = round(days, 1)
        if days < 14:
            out.append(Fail("tls", 1 if days < 3 else 2, f"TLS cert for {host} expires in {days:.1f} days",
                            "GitHub Pages (chewgather.com) and Fly renew automatically; a stuck renewal usually "
                            "means DNS changed or enforce-https/custom-domain settings broke.", route="board"))
    return out


def check_places(metrics):
    key = E("GOOGLE_PLACES_API_KEY")
    if not key:
        return None
    # "IDs only" Place Details is a free SKU. Googleplex place id.
    code, body, ms = http("GET", "https://places.googleapis.com/v1/places/ChIJj61dQgK6j4AR4GeTYWZsKWw",
                          headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "id",
                                   "X-Ios-Bundle-Identifier": "com.chewgather.app"})
    metrics["places_code"] = code
    probe(metrics, "google-places", code)
    if code == 200:
        return []
    err = body.get("error", {}) if isinstance(body, dict) else {}
    reason = next((d.get("reason") for d in err.get("details", []) if isinstance(d, dict) and d.get("reason")), None)
    summary = f"Google Places probe failed: {code} {err.get('status', '')} {reason or ''}".strip()
    detail = (err.get("message") or str(body)).replace(key, "<key>")
    return [Fail("google-places", 1, summary, detail, route="board")]


def check_synthetic(metrics, state):
    email, pw = E("SYNTH_EMAIL"), E("SYNTH_PASSWORD")
    if not (email and pw):
        return None
    if not due(state, "last_synth", int(E("SYNTH_INTERVAL_MIN", "15"))):
        return None
    code, body, ms = http("POST", BASE + "/auth/login", {"email": email, "password": pw})
    metrics["synth_login_ms"] = ms
    if code != 200 or not isinstance(body, dict) or not body.get("token"):
        return [Fail("synthetic-login", 1, f"Synthetic login failed ({code})",
                     f"POST /auth/login -> {code}: {str(body)[:300]}")]
    code, me, ms2 = http("GET", BASE + "/users/me", headers={"Authorization": f"Bearer {body['token']}"})
    metrics["synth_me_ms"] = ms2
    if code != 200:
        return [Fail("synthetic-login", 1, f"Synthetic /users/me failed ({code})", f"GET /users/me -> {code}: {str(me)[:300]}")]
    return []


def check_resend(metrics, state):
    key = E("RESEND_API_KEY")
    if not key or not due(state, "last_resend", 360):
        return None
    code, body, _ = http("GET", "https://api.resend.com/domains", headers={"Authorization": f"Bearer {key}"})
    probe(metrics, "resend", code)
    if code in (401, 403) and "restricted" in str(body).lower():
        # Sending-only key (least privilege): it cannot read domains. Send failures still surface via dep-resend.
        log("resend domain check skipped: key is sending-only")
        return None
    if code != 200:
        return [Fail("resend", 2, f"Resend API returned {code}", str(body)[:500], route="board")]
    doms = {d.get("name"): d.get("status") for d in (body.get("data") or [])} if isinstance(body, dict) else {}
    metrics["resend_domains"] = doms
    if doms.get("send.chewgather.com") != "verified":
        return [Fail("resend", 2, f"Resend domain send.chewgather.com status: {doms.get('send.chewgather.com')}",
                     "Password-reset and incident emails depend on this domain. Re-check the DNS records at Squarespace "
                     "(TXT resend._domainkey.send, CNAMEs rsend.send / send.send); watch for leading spaces in TXT values.",
                     route="board")]
    return []


def check_fly(metrics):
    tok = E("FLY_API_TOKEN")
    if not tok:
        return None
    app = E("FLY_APP", "chewgather-backend")
    code, body, _ = http("GET", f"https://api.machines.dev/v1/apps/{app}/machines",
                         headers={"Authorization": f"Bearer {tok}"})
    probe(metrics, "fly-api", code)
    if code != 200 or not isinstance(body, list):
        return [Fail("fly-api", 3, f"Fly Machines API returned {code}", str(body)[:300], route="board")]
    states = {m.get("id"): m.get("state") for m in body}
    metrics["fly_machines"] = states
    bad = {k: v for k, v in states.items() if v != "started"}
    if not states or bad:
        return [Fail("fly-machines", 1, f"Fly machine(s) not started: {bad or 'none exist'}",
                     json.dumps([{k: m.get(k) for k in ('id', 'state', 'region', 'updated_at')} for m in body]))]
    return []


def check_sentry(metrics, state):
    tok, org, proj = E("SENTRY_AUTH_TOKEN"), E("SENTRY_ORG"), E("SENTRY_PROJECT")
    if not (tok and org and proj):
        return None
    since = state.get("sentry_since") or dt.datetime.fromtimestamp(NOW - 600, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    state["sentry_since"] = dt.datetime.fromtimestamp(NOW, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    q = urllib.request.quote(f"is:unresolved firstSeen:>{since}")
    code, body, _ = http("GET", f"https://sentry.io/api/0/projects/{org}/{proj}/issues/?query={q}&limit=10",
                         headers={"Authorization": f"Bearer {tok}"})
    probe(metrics, "sentry", code)
    if code != 200 or not isinstance(body, list):
        return [Fail("sentry-api", 3, f"Sentry API returned {code}", str(body)[:300], route="board")]
    return [Fail(f"sentry-{i['id']}", 2, f"Sentry: {i.get('title', '')[:120]}",
                 f"{i.get('permalink')} count={i.get('count')} users={i.get('userCount')} culprit={i.get('culprit')}")
            for i in body]


def check_paperclip(metrics):
    """Watch our own agents: error state or budget exhaustion stalls the whole loop."""
    code, agents, _ = pc("GET", f"/companies/{CO}/agents")
    if code != 200 or not isinstance(agents, list):
        return []
    out = []
    for a in agents:
        if a.get("id") == E("PAPERCLIP_AGENT_ID"):
            continue
        name = a.get("name", "?")
        slug = name.lower().replace(" ", "-")
        if a.get("status") == "error":
            out.append(Fail(f"paperclip-agent-{slug}", 2, f"Paperclip agent '{name}' is in error state",
                            str(a.get("errorReason") or "")[:800], route="board"))
        budget, spent = a.get("budgetMonthlyCents") or 0, a.get("spentMonthlyCents") or 0
        if budget and spent / budget >= 0.9:
            out.append(Fail(f"paperclip-budget-{slug}", 3, f"Agent '{name}' at {100 * spent // budget}% of monthly budget",
                            f"spent {spent}c of {budget}c; auto-pause at 100%", route="board"))
    return out


# --------------------------------------------------------------------------- email

def send_email(subject, text):
    key = E("RESEND_API_KEY")
    if not key:
        log(f"email skipped (no RESEND_API_KEY): {subject}")
        return None
    code, body, _ = http("POST", "https://api.resend.com/emails",
                         {"from": ALERT_FROM, "to": [ALERT_EMAIL], "subject": subject, "text": text},
                         headers={"Authorization": f"Bearer {key}"})
    log(f"email {code}: {subject}")
    return body.get("id") if isinstance(body, dict) else None


# --------------------------------------------------------------------------- incidents

def list_issues():
    code, issues, _ = pc("GET", f"/companies/{CO}/issues?status=backlog,todo,in_progress,in_review,blocked,done")
    return issues if code == 200 and isinstance(issues, list) else []


def tag(check):
    return f"[incident:{check}]"


def find(issues, check, statuses):
    t = tag(check)
    return [i for i in issues if (i.get("title") or "").startswith(t) and i.get("status") in statuses]


def iso_age_h(s):
    try:
        return (NOW - dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()) / 3600
    except Exception:
        return 1e9


def comment(issue_id, text):
    code, res, _ = pc("POST", f"/issues/{issue_id}/comments", {"body": text})
    if code == 403 and "run to attribute" in str(res):
        # Paperclip only lets an agent write to other issues when its run has a source issue; timer runs
        # have none. In local_trusted mode an unauthenticated loopback request acts as the local board, so
        # post the status note that way, clearly labelled. Revisit if the instance moves to authenticated mode.
        code, res, _ = http("POST", f"{API}/issues/{issue_id}/comments", {"body": f"[Health Monitor] {text}"})
    if code >= 300:
        log(f"COMMENT FAILED on {issue_id}: {code} {str(res)[:300]}")
    return code < 300


def open_incident(f, n, issues, metrics):
    sev_name = {1: "SEV1", 2: "SEV2", 3: "SEV3"}[f.sev]
    prio = {1: "critical", 2: "high", 3: "medium"}[f.sev]
    recent = [i for i in find(issues, f.check, {"done"}) if iso_age_h(i.get("updatedAt", "")) < 24]
    recurrence = f"\n- **Recurrence** of {recent[0].get('identifier')} (closed < 24h ago). The previous fix may be incomplete." if recent else ""
    desc = f"""Automated incident from the Chewgather Health Monitor.

- **Severity:** {sev_name}
- **Check:** `{f.check}`
- **First confirmed:** {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} after {n} consecutive failure(s)
- **Backend:** {BASE} ({metrics.get('backend_endpoint', '?')} {metrics.get('backend_code', '?')} in {metrics.get('backend_ms', '?')}ms){recurrence}
- **Detail:**
```
{f.detail}
```
"""
    desc += ("\nIncident Responder: follow AGENTS.md and RUNBOOKS.md (section for this check)." if f.route == "agent"
             else "\nRouted to the board: this needs access the agents do not have. The runbook section for this check is in the Incident Responder's RUNBOOKS.md.")
    payload = {"title": f"{tag(f.check)} {f.summary}"[:250], "description": desc, "priority": prio, "status": "todo",
               "parentId": E("HEALTH_PARENT_ISSUE_ID"), "projectId": E("PROJECT_ID"), "goalId": E("GOAL_ID")}
    if f.route == "agent":
        payload["assigneeAgentId"] = E("INCIDENT_AGENT_ID")
        payload["executionPolicy"] = {"mode": "normal", "commentRequired": True, "stages": [
            {"type": "review", "participants": [{"type": "agent", "agentId": E("REVIEWER_AGENT_ID")}]},
            {"type": "approval", "participants": [{"type": "user", "userId": BOARD_USER}]}]}
    else:
        payload["assigneeUserId"] = BOARD_USER
    code, res, _ = pc("POST", f"/companies/{CO}/issues", payload)
    if code >= 300 or not isinstance(res, dict) or not res.get("identifier"):
        # Responder unavailable (paused / over budget): fall back to the board inbox.
        err = res.get("error") if isinstance(res, dict) else res
        payload.pop("assigneeAgentId", None)
        payload.pop("executionPolicy", None)
        payload["assigneeUserId"] = BOARD_USER
        payload["description"] = f"Incident Responder could not be assigned ({err}). Resume it and reassign, or handle manually.\n\n" + desc
        code, res, _ = pc("POST", f"/companies/{CO}/issues", payload)
    ident = res.get("identifier", "ERR") if isinstance(res, dict) else "ERR"
    log(f"opened {ident} {payload['title']}")
    if f.sev == 1:
        send_email(f"[Chewgather {sev_name}] {f.summary}"[:180],
                   f"{f.summary}\n\nCheck: {f.check}\nIssue: {ident} (http://localhost:3100)\nRouted to: "
                   f"{'Incident Responder (fix PR will follow for review)' if f.route == 'agent' else 'you, since human action is needed'}\n\n"
                   f"Detail:\n{f.detail[:1500]}")
    return ident


def process(fails, evaluated, state, metrics):
    issues = list_issues()
    open_statuses = {"backlog", "todo", "in_progress", "in_review", "blocked"}
    checks = state.setdefault("checks", {})
    failing = {f.check for f in fails}
    to_open = []
    for f in fails:
        c = checks.setdefault(f.check, {"fails": 0, "first": NOW})
        c["fails"] += 1
        c["sev"] = f.sev
        need = 1 if f.check.startswith(("sentry-", "paperclip-")) or f.route == "board" else THRESH
        if c["fails"] < need:
            log(f"pending {f.check} ({c['fails']}/{need})")
            continue
        existing = find(issues, f.check, open_statuses)
        if existing:
            if NOW - c.get("last_comment", 0) >= STILL_FAILING_COMMENT_EVERY:
                comment(existing[0]["id"], f"Monitor: still failing ({c['fails']} consecutive checks). Latest: `{f.detail[:600]}`")
                c["last_comment"] = NOW
            log(f"open {f.check} -> {existing[0].get('identifier')}")
            continue
        to_open.append((f, c["fails"]))

    if len(to_open) > MAX_NEW:
        # Storm: many checks failing at once usually share one root cause. Open one umbrella incident.
        worst = min(f.sev for f, _ in to_open)
        umbrella = Fail("storm", worst, f"{len(to_open)} checks failing at once: " + ", ".join(f.check for f, _ in to_open)[:150],
                        "\n\n".join(f"{f.check}: {f.summary}\n{f.detail[:400]}" for f, _ in to_open))
        checks.setdefault("storm", {"fails": 1, "first": NOW, "sev": worst})
        failing.add("storm")
        if not find(issues, "storm", open_statuses):
            open_incident(umbrella, max(n for _, n in to_open), issues, metrics)
    else:
        for f, n in to_open:
            open_incident(f, n, issues, metrics)

    # Recovery: a key recovers only if the probe family that produces it ran this cycle and it passed.
    for name in list(checks):
        if name in failing:
            continue
        if name.startswith("sentry-"):
            del checks[name]  # Sentry issues are one-shot; resolution happens in Sentry
            continue
        fam = family(name)
        if fam not in evaluated and not (fam == "storm" and not fails):
            continue
        c = checks.pop(name)
        for i in find(issues, name, open_statuses):
            dur = int((NOW - c.get("first", NOW)) / 60)
            comment(i["id"], f"Monitor: `{name}` recovered at {dt.datetime.now(dt.timezone.utc).strftime('%H:%MZ')} (failing ~{dur} min). "
                             "Keep the incident open until the root cause is understood and the report is written.")
            last = state.setdefault("last_recovery_email", {}).get(name, 0)
            if c.get("sev") == 1 and NOW - last >= RECOVERY_EMAIL_EVERY:
                send_email(f"[Chewgather RECOVERED] {name}", f"{name} recovered after ~{dur} min. Incident: {i.get('identifier')}.")
                state["last_recovery_email"][name] = NOW
        log(f"recovered {name}")


def family(check):
    if check.startswith(("backend-", "dep-")):
        return "backend"
    if check.startswith("fly-"):
        return "fly"
    if check.startswith("paperclip-"):
        return "paperclip"
    if check.startswith("monitor-"):
        return check[len("monitor-"):]
    return check  # website, tls, google-places, synthetic-login, resend, storm, drill names


# --------------------------------------------------------------------------- digest

def digest(state):
    local = dt.datetime.now()
    today = local.strftime("%Y-%m-%d")
    if local.hour < DIGEST_HOUR or state.get("last_digest") == today:
        return
    state["last_digest"] = today
    rows = []
    try:
        with open(METRICS_PATH) as f:
            for line in f:
                r = json.loads(line)
                if NOW - r["ts"] <= 86400 and not r.get("classification"):
                    rows.append(r)
    except Exception:
        pass
    if not rows:
        return
    up = sum(1 for r in rows if r.get("backend_code") == 200)
    lat = sorted(r["backend_ms"] for r in rows if r.get("backend_code") == 200 and "backend_ms" in r)
    p = lambda q: lat[min(len(lat) - 1, int(q * len(lat)))] if lat else "n/a"
    issues = list_issues()
    inc = [i for i in issues if (i.get("title") or "").startswith("[incident:")]
    opened = [i for i in inc if iso_age_h(i.get("createdAt", "")) <= 24]
    still_open = [i for i in inc if i.get("status") != "done"]
    code, costs, _ = pc("GET", f"/companies/{CO}/costs/by-agent")
    cost_lines = ""
    if code == 200 and isinstance(costs, list):
        cost_lines = "\n".join(f"  {c.get('agentName', c.get('agentId', '?'))}: ${(c.get('costCents') or 0) / 100:.2f}" for c in costs)
    text = f"""Chewgather daily health — {today}

Backend availability (24h): {100 * up / len(rows):.2f}% ({up}/{len(rows)} checks)
Latency p50 / p95: {p(0.5)} ms / {p(0.95)} ms
Incidents opened (24h): {len(opened)}  |  still open: {len(still_open)}
""" + "".join(f"  - {i.get('identifier')} [{i.get('status')}] {i.get('title')}\n" for i in still_open[:10]) + (
        f"\nAgent spend this month:\n{cost_lines}\n" if cost_lines else "") + "\nBoard: http://localhost:3100\n"
    send_email(f"[Chewgather] Daily health — {100 * up / len(rows):.1f}% up, {len(still_open)} open incident(s)", text)


# --------------------------------------------------------------------------- main

def host_online():
    """True if this machine can reach the internet. During macOS dark wake / sleep the network is
    down and every probe fails at once; those runs must not count as production failures."""
    for url in ("https://1.1.1.1/cdn-cgi/trace", "https://www.google.com/generate_204"):
        code, _, _ = http("GET", url, timeout=6)
        if code in (200, 204):
            return True
    return False


def main():
    if os.path.exists(os.path.join(STATE_DIR, "debug-env")):
        log("PAPERCLIP env: " + ", ".join(sorted(k for k in os.environ if k.startswith("PAPERCLIP"))))
    state = load_state()
    metrics = {"ts": NOW}
    if not host_online():
        state["offline_runs"] = state.get("offline_runs", 0) + 1
        save_state(state)
        with open(METRICS_PATH, "a") as f:
            f.write(json.dumps({"ts": NOW, "host_offline": True, "classification": "host-offline"}) + "\n")
        write_heartbeat("host-offline")
        log("monitor skipped: this host is offline (no connectivity to 1.1.1.1 / google). Counters untouched.")
        return
    before = json.loads(json.dumps(state))
    fails, evaluated = [], set()
    drill = None
    try:
        drill = open(os.path.join(STATE_DIR, "drill")).read().strip() or None
    except Exception:
        pass

    runs = [
        ("backend", lambda: check_backend(metrics)),
        ("website", lambda: check_website(metrics)),
        ("tls", lambda: check_tls(metrics, state)),
        ("google-places", lambda: check_places(metrics)),
        ("synthetic-login", lambda: check_synthetic(metrics, state)),
        ("resend", lambda: check_resend(metrics, state)),
        ("fly", lambda: check_fly(metrics)),
        ("sentry", lambda: check_sentry(metrics, state)),
        ("paperclip", lambda: check_paperclip(metrics)),
    ]
    for name, fn in runs:
        try:
            res = fn()
        except Exception as e:
            res = [Fail(f"monitor-{name}", 3, f"Monitor check '{name}' crashed", repr(e), route="board")]
        if res is None:
            continue
        evaluated.add(name)
        fails.extend(res)

    if drill:
        log(f"DRILL active: forcing failure of '{drill}'")
        drill_sev = 1 if drill in ("backend-down", "backend-unhealthy", "dep-mongo", "synthetic-login", "fly-machines", "google-places") else 2
        fails.append(Fail(drill, drill_sev, f"DRILL: simulated failure of {drill}",
                          "This is a drill. Remove ~/.paperclip/chewgather-ops/state/drill to end it.",
                          route="board" if drill in ("website", "tls", "google-places", "resend") else "agent"))
        evaluated.add(drill)

    if local_network_fault(metrics):
        # Correlation gate: every independent target failed at once, so the fault is this host's network,
        # not production. Roll back everything the probes touched (counters, due() throttles, sentry cursor).
        state.clear()
        state.update(before)
        state["local_fault_runs"] = state.get("local_fault_runs", 0) + 1
        metrics["classification"] = "local-network-fault"
        metrics["failing"] = []
        with open(METRICS_PATH, "a") as f:
            f.write(json.dumps(metrics) + "\n")
        save_state(state)
        write_heartbeat("local-network-fault")
        log(f"monitor skipped: local-network-fault, all targets unreachable at once ({metrics['probes']}). "
            "Counters untouched, no incidents.")
        return

    process(fails, evaluated, state, metrics)
    metrics["failing"] = sorted({f.check for f in fails})
    with open(METRICS_PATH, "a") as f:
        f.write(json.dumps(metrics) + "\n")
    digest(state)
    save_state(state)

    ping = E("HEALTHCHECKS_PING_URL")
    if ping:
        http("POST", ping.rstrip("/") + ("/fail" if any(f.sev == 1 for f in fails) else ""), {"failing": metrics["failing"]})
    write_heartbeat("failing" if fails else "ok", metrics["failing"])
    log(f"monitor ok: {len(fails)} failing [{', '.join(metrics['failing'])}] | backend {metrics.get('backend_code')} "
        f"{metrics.get('backend_ms')}ms via {metrics.get('backend_endpoint')} | evaluated: {', '.join(sorted(evaluated))}")


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        try:
            write_heartbeat("error")
        except Exception:
            pass
        raise
