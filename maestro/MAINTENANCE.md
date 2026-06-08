# Maestro Suite — Maintenance & Drift Guide

The flows drift because the app moves faster than the tests. This is the map of
**where it drifts**, **why**, and **what to anchor on instead** so re-aligning is
fast next time. (Hard-won 2026-06; see also the gitignored
`.claude/skills/test-app/LESSONS-LEARNED.md` for the deeper operational notes.)

---

## Run it

Prereqs every run needs:
- **Backend up** — `cd backend && npm run dev`, verify `curl http://10.20.216.20:3000/health` → `{"ok":true}`. It has crashed mid-session before; if a flow shows "Server Unavailable", restart it.
- **Metro up, no DevTools pileup** — `BROWSER=none npx expo start` (the DevTools auto-open is what clogs the machine; `BROWSER=none` stops it at the source).
- **Clean state** — `xcrun simctl keychain booted reset` (clearState does NOT clear the auth token), then re-seed: `cd backend && npx ts-node src/seed-reset.ts`.

```bash
# Whole suite (the definition of done — must exit 0)
maestro test maestro/full-suite.yaml

# Discovery sweep: run every flow, collect pass/fail, continue past failures
bash maestro/run-all.sh        # results in /tmp/chewgether-flow-results.txt

# Single flow
maestro test maestro/flows/<flow>.yaml
```

The standalone clearState/guest flows (`issue-309`, `issue-152-*`, `20-guest`)
are NOT in `full-suite.yaml` — run them individually, each from a fresh keychain
reset + seed. The guest favorites/swipe flows also need a sim **location**:
`xcrun simctl location booted set 39.8028,-105.0875`.

---

## Drift hot-spots — what breaks and what to anchor on

| Area | Why it drifts | Anchor on instead of… |
|------|---------------|-----------------------|
| **Home greeting** | Rotates ("Reservations for one craving, <name>?") | the tab bar: `Home, tab, 1 of 5` — never the greeting text |
| **Brand text** | Chewabl → Chewgether renames | regex (`Welcome to Chewgether.*`) |
| **Pick/swipe results** | `swipe-choose-btn` = single decisive pick ("You're going with X"); the multi-pick **"Your Picks"** screen only appears after the deck is exhausted | swipe the whole deck (`repeat while notVisible "Your Picks"`) for multi; choose-btn for single |
| **Discover list** | Auto-applies saved cuisine/budget prefs as filters; guests have **no location** (empty list) | reset filters (`cuisine-chip-all`/`budget-chip-all`) before search; tap "Enable location" as a guest |
| **Restaurant detail** | It's a pushed screen with **no tab bar**; `pressKey:back` is a no-op on iOS | tap the "Go back" arrow before any tab navigation |
| **Tab navigation** | Single taps are flaky and silently leave you on the prior tab (LESSONS #5) | always double-tap (`tapOn` ×2) |
| **Keyboard** | Occludes lower form fields → input lands in the wrong field; `hideKeyboard` is flaky | `pressKey: Enter` to dismiss; also dismiss the iOS "Save Password?" dialog after auth |
| **Collapsed a11y labels** | PlanCard/RestaurantCard/PickConfirmSheet wrap children → title text isn't matchable | use the testID (`plan-card-<id>-title-<slug>`, `pick-confirm-finish-btn`, etc.) |
| **App id** | rork (`app.rork.*`) vs dev build (`org.name.ChewablQuickDiningPicks`) | dev-build id everywhere (run model is `expo run:ios` + local Metro, NOT the rork tunnel) |

---

## When a flow fails — triage in this order

1. **Is the backend up?** ("Server Unavailable" screen, or sign-in/signup never reaches Home). Restart it.
2. **Is the driver hung?** (maestro process old but log stuck right after `launchApp`). After ~150 runs the XCTest driver fatigues — `pkill -9 -f maestro.cli; pkill -9 -f "xcodebuild test-without-building"` and re-run (a fresh `maestro test` spawns a clean driver).
3. **Are we even on the expected screen?** Read the `❌` screenshot in `~/.maestro/tests/<ts>/` (`sips -Z 1000 <png>` first — raw is too big to view). Most "X not found" failures are a flaky tab tap landing on Home, or a no-tab-bar detail screen.
4. **Only then** is it a genuinely stale selector — fix against the hot-spots table above, preferring a testID.

---

## Don't repeat these

- A flow isn't done until `maestro test maestro/full-suite.yaml` exits 0 end-to-end. Single-flow passes hide state-accumulation bugs (e.g. an earlier flow creating a plan that shifts a later flow's list).
- Re-seed before stateful regression flows (issue-094 consumes a vote; doggy's fixed signup email collides on re-run).
- Don't dump screenshots to the repo root — flows using bare `takeScreenshot: "name"` land in the project root; clean with `find . -maxdepth 1 -name '*.png' -delete`.
