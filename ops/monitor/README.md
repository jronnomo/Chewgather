# Chewgather ops: monitoring & incident response

Runs inside Paperclip (launchd service `ing.paperclip.paperclipai`, http://localhost:3100, company CHE).

## Loop
```
Health Monitor (process agent, every 5 min, monitor.py, no LLM)
  ├─ healthy → metrics.jsonl, dead-man ping, 8am daily digest email
  └─ failing (2x for probes, 1x for board/Sentry) → [incident:<check>] issue, deduped by title
       ├─ route=agent → Incident Responder (Opus): RUNBOOKS.md → evidence → incident doc → fix PR
       │     → Reviewer: review + emails jerry@chewgather.com → board approval = merge the PR
       └─ route=board → you (needs GCP/DNS/billing/Paperclip access agents don't have)
  SEV1 → immediate alert email on open + on recovery. More than 3 new failures in one run → a single "storm" incident.
Weekly: "Weekly reliability review" routine (Release Lead, Mon 9:00 America/Denver): repeats → Engineer follow-ups.
```

## Checks
| key | source | route | sev |
|---|---|---|---|
| backend-down / backend-unhealthy / backend-slow | /health/deep (falls back to /health) | agent | 1/1/3 |
| dep-mongo, dep-cloudinary, dep-resend, dep-expoPush, dep-googlePlaces | /health/deep per-check | agent | mongo 1, others 2 |
| website | chewgather.com + /privacy /support /terms | board | 2 |
| tls | cert expiry, every 6h | board | 2 (<14d), 1 (<3d) |
| google-places | free IDs-only Place Details probe | board | 1 |
| synthetic-login | login + /users/me, every 15 min (needs SYNTH_*) | agent | 1 |
| resend | Resend domain verified, every 6h (needs key) | board | 2 |
| fly-machines | Fly Machines API (needs read-only token) | agent | 1 |
| sentry-<id> | new unresolved Sentry issues (needs token) | agent | 2 |
| paperclip-agent-* / paperclip-budget-* | Paperclip's own agents | board | 2/3 |

## Operating it
- **Drill:** `echo backend-down > state/drill` (agent-routed; exercises the Responder → Reviewer → email path) or `echo website > state/drill` (board-routed). `rm state/drill` to end it. Cancel the drill issue afterwards.
- **Run once by hand:** Paperclip UI → Health Monitor → Invoke, or `curl -X POST localhost:3100/api/agents/<monitor-id>/heartbeat/invoke`.
- **State:** `state/state.json` (per-check counters), `state/metrics.jsonl` (one line per run).
- **Tune:** Monitor agent env: FAIL_THRESHOLD, SLOW_MS, MAX_NEW_INCIDENTS_PER_RUN, DIGEST_HOUR, SYNTH_INTERVAL_MIN.
- **Agent GitHub isolation:** `~/.paperclip/agent-git/` (token-only credential helper, `gh` shim, no askpass/keychain). Agents run as your macOS user, so this is guard rails, not a sandbox. A separate macOS user is the real fix.
- **Known limitation:** Paperclip blocks agent comments on other issues unless the run has a source issue, and timer runs have none. The monitor therefore posts its "still failing" / "recovered" comments as the local board (loopback, `local_trusted` mode only), prefixed `[Health Monitor]`. If the instance moves to authenticated mode, give the monitor a board API key instead.
- **Verify the agents' GitHub token** (never prints it): temporarily point the Health Monitor at `tokencheck.sh` with `GH_TOKEN` bound, invoke it once, then restore `monitor.py` and remove the binding. Or ask Claude to "run the token check".
- **Drill log:** 2026-09-30 full-loop drill (CHE-28) passed detection, SEV1 email, Responder, Reviewer, recovery email. It found that the Reviewer's post-approval email never ran (the approval hand-off cancels the run). Fixed: the Reviewer emails *before* approving. Re-verified by drill 2 (CHE-29): the Reviewer email was delivered (Resend 01a0efda).

## Paperclip operating gotchas (learned 2026-09-30)
- **Never hard-restart Paperclip while agents run.** Use `~/.local/bin/paperclipai service restart` (hot restart that preserves runs). A hard stop orphans runs and leaves `environment_leases` active, which silently blocks those issues (every run is cancelled; wakes are skipped with `execution_reconciliation_required`). Diagnose with `GET /api/issues/<id>` → `executionBlocker`. Fix: confirm the PID is dead, then release the lease row in the embedded Postgres (see the memory notes).
- **Wake an agent for a specific task** with `POST /api/agents/<id>/wakeup` and `{"payload":{"issueId":"…","taskId":"…"}}`. Plain `heartbeat/invoke` runs have no source issue, so their issue writes are rejected.
- **One review at a time for the Reviewer.** Competing wakes cancel its active run.

## Week 1 review (2026-10-06)
- **No real production incidents.** CHE-32..37 were monitoring false positives: the Mac in macOS dark wake with no network made every check fail at once (status 0). Fixed in monitor.py with a connectivity pre-check (offline runs are skipped and recorded as `host_offline` in metrics), "still failing" comments every 6 h (they had woken and cancelled the Incident Responder until it hit its daily cap), and recovery emails debounced to 6 h per check.
- The weekly review routine fired while the host was offline and failed. It was re-run manually.
- **Structural fix still needed:** monitoring, the agents and the weekly routine all depend on this laptop being awake. Move Paperclip to an always-on host, or at least keep the Mac awake on power (System Settings → Battery → Options → "Prevent automatic sleeping on power adapter when the display is off"). Add the external uptime check (CHE-22) and the healthchecks.io dead-man switch (CHE-26).
