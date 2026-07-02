# Chewgether Skills Audit — 2026-07-01

*All 10 skills in `.claude/skills/` (a git submodule → `claude-skills` repo) read in full; every referenced artifact — scripts, paths, flows, seed data, GCP/GitHub IDs, simulator UUIDs, endpoints — verified against the repo and this machine. Emphasis on feature-dev, test-feature, test-app.*

**Overall verdict:** This is an unusually mature skill suite — the Maestro lessons alone (DevTools-kills-XCTest, Keychain persistence, anchored text matching, RUN_DIR dotfile pattern) encode months of hard-won knowledge, and the feature-dev ⇄ ux-research invocation contract + Recommendation Ledger is a genuinely sophisticated closed loop. The problems are drift, not design: one skill is **dead on arrival** (resolve-active-issues), two reference a **skill that doesn't exist** (session-handoff), the test skills carry a **seed/location mismatch** that silently blanks a feature under test, and several facts have rotted (test counts, flow lists, model names).

---

## Per-skill findings

### feature-dev (445 lines) — GRADE: A−
The strongest skill. Full lifecycle with research → architect → devil's advocate → parallel devs → QA, lessons-learned encoded as rules, worktree hygiene, R5 invocation contract with ux-research.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| F1 | minor | Commit trailer hardcodes `Co-Authored-By: Claude Opus 4.8 (1M context)` (line ~356) — stale; the harness now specifies the current model's trailer | Make it generic: "use the current model's standard trailer" |
| F2 | minor | "92% Context Limit" section header vs global CLAUDE.md's **85%** trigger | Align on 85% (the global protocol wins) |
| F3 | minor | `Task tool` naming throughout — tool is now `Agent` | Cosmetic rename |
| F4 | suggestion | No lightweight path: even a 2-file feature pays the full PRD + issue + 5-agent ceremony | Add an explicit "XS fast-path" (single dev agent, PRD-lite) with criteria |
| F5 | suggestion | Created issues never get a **milestone** — your launch milestones (#6–#12) exist and drive Goaldmine sync | Add "assign milestone if one fits" to Phase 2 Step 2 |

### test-feature (511 lines) — GRADE: A−
Excellent operational discipline: RUN_DIR dotfile, subshell-cwd rule, re-seed-before-mutating-flows, 8 Maestro authoring rules that are all real pitfalls. Verified: `gh project item-add 3` → project 3 = "Chewabl Roadmap" ✓, `ux-research-orchestrator` agent exists ✓, seed-reset.ts exists ✓, `/health` route exists (backend/src/app.ts) ✓.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| TF1 | **major** | **Seed/location mismatch:** step 2d-ter sets sim GPS to `37.6650,-77.5400` (Glen Allen **VA** = Brian's region) but flows sign in as **alice@chewabl.dev (Arvada CO, zip 80002)**. Per seed-data's own docs, the client radius filter then drops all of Alice's Trending-with-Friends data — that section silently tests as empty | Use Arvada coords (~39.80,-105.08) when signed in as Alice, or sign in as Brian for VA coords |
| TF2 | minor | `.current-test-run` dotfile is **not gitignored** — a run leaves it dirty in the repo | Add to .gitignore |
| TF3 | minor | Hardcoded simulator UUID `73D24E4A-…` (exists on this machine ✓, breaks on any other) | Derive: `xcrun simctl list devices available \| grep "iPhone 16 Pro"` fallback |
| TF4 | coupled | `org.name.ChewablQuickDiningPicks` matches the native ios/ project today ✓ — but **milestone #6 (fix bundle ID) will break every simctl call in both test skills** | When the bundle ID changes, update test-feature + test-app in the same PR |
| TF5 | polish | Targeted flows written to `/tmp` — fine, but flows die with the machine; promising ones are lost | Note: "if the flow found a real bug, promote it to maestro/flows/issue-*.yaml in the fix PR" |

### test-app (481 lines) — GRADE: B+
Same strong ops discipline. Backend health gate correctly checks `{"ok":true}` JSON (verified route exists). Mid-run backend re-check guidance is great.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| TA1 | **major** | **Flow table is stale:** `20-guest-conversion-funnel.yaml` exists on disk but is missing from the Step 6 run table, the Step 0 mkdir list, and the Step 8 summary table — a full "run all flows" pass silently skips the guest conversion funnel (your monetization-critical funnel!) | Add flow 20 + `guest-conversion/` dir; better: generate the list from `ls maestro/flows/[0-9]*.yaml` instead of a hardcoded table |
| TA2 | major | "Known examples to expect: 03/09 tap `id: eat-now-btn` which no longer exists" — true on main **today**, but the unmerged `chore/maestro-flow-de-rot` branch (16 commits) already fixed all 29 flows. The moment it merges, this note becomes misinformation steering failures to the wrong classification | Merge de-rot, then delete the note. Add a general rule instead: "check git log -1 on the flow file before classifying as stale" |
| TA3 | minor | Same seed/location mismatch as TF1 (step 4g uses the VA coords, auth flow signs in Alice) | Same fix |
| TA4 | minor | Same hardcoded UUID + bundle-ID coupling as TF3/TF4 | Same fix |

### resolve-active-issues (130 lines) — GRADE: F (dead skill)
| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| RA1 | **broken** | Built entirely around `maestro/known-issues.md`, which **does not exist on any branch and has never existed in git history** (verified: `git log --all` at that path is empty; zero references anywhere in the repo). Step 0 always concludes "zero issues, stop" — the skill is a no-op | Retarget at GitHub: "fix all open issues with label X" (e.g. `critical-bug` or `app-review`), or delete |
| RA2 | broken | Rule 9 hands off to `.claude/skills/session-handoff/SKILL.md` — **that skill does not exist** | Point at the global CLAUDE.md protocol (like test-app rule 11 correctly does) |
| RA3 | stale | "All 24 tests must pass" — backend suite is **217** now | Say "the full backend suite," never a number |

### app-review-orchestrator-pro (186 lines + 4 support files) — GRADE: B+
Well-designed adversarial review (its F-###-### output populates ~20 of your open backlog issues — it demonstrably works). Support files all present.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| AR1 | broken | Handoff protocol references the nonexistent `session-handoff` skill (same as RA2) | Point at global CLAUDE.md protocol |
| AR2 | minor | "You stay in PLAN MODE throughout" while also writing phase files to disk — plan-mode semantics don't allow writes; in practice this contradiction forces a violation either way | Drop the plan-mode framing; keep "no source-code changes" |
| AR3 | minor | `Task(subagent_type: …)` naming; 92% vs 85% threshold | Cosmetic + align |

### ux-research (163 lines + profiles) — GRADE: A
The most thoughtfully evolved skill (v2 with profiles, restraint gates backed by real evidence like the scalloped-divider failure, ledger-based outcome measurement). `chewabl.profile.md` has `active: true` and is the only profile ✓.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| UX1 | minor | `SKILL.md.pre-v2.bak` here + `ux-research-orchestrator.md.pre-v2.bak` in `.claude/agents/` — the skills dir is a git **submodule**; history already preserves v1 | Delete both .bak files |
| UX2 | minor | The profile's `screen_inventory` carries `file:line` references — these rot with every refactor (this session alone moved plan-event and _layout lines) | Add a "refresh screen_inventory" note to the profile header, or drop line numbers and keep paths |

### seed-data (162 lines) — GRADE: A−
Accurate (script exists, credentials/regions match the appstore audit's findings). The 80-line inline summary duplicates what the script knows — if the script's dataset changes, the skill silently lies.
- **SD1 (minor):** Prefer "print the script's own output" over the hardcoded summary block, or add a header noting the script is the source of truth.

### reboot (147 lines) — GRADE: B
Fine as the dev-stack bootstrapper; the LAN-IP `.env` rewrite it performs is exactly why `.env` holds `http://10.20.216.20:3000` (launch blocker B3's origin — a prod `eas.json` profile must override it, which is issue #320).

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| RB1 | minor | Advertises **Expo Go** QR — with a native `ios/` project and custom modules, the app needs a **dev client**; Expo Go may not load it. Likely stale from pre-prebuild days | Verify; if dev-client, switch to `npx expo start --dev-client` framing |
| RB2 | minor | Uses bare `cd` — contradicts the subshell-cwd discipline the test skills teach | Use `(cd X && …)` |
| RB3 | polish | Test skills say "backend missing → STOP and tell the user" — they could name `/reboot` as the remedy | Add "run /reboot, then re-invoke" to their stop messages |

### disable-places / enable-places (49/80 lines) — GRADE: A
Precise, verified-by-design (enable re-checks that the kill switch didn't re-disable), correct gcloud paths and project IDs. Only note: billing-account and project numbers are embedded in a submodule — fine while the `claude-skills` repo is private; re-check before ever making it public.

---

## Cross-cutting issues (the real punch list)

1. **The phantom session-handoff skill** — referenced by 2 skills, exists in 0. Either create it (extract Section A–F from the global CLAUDE.md protocol) or repoint both references at the global protocol. The 85% vs 92% threshold split resolves with the same edit.
2. **resolve-active-issues is dead** — its input file never existed. Retarget at GitHub labels or delete; right now it occupies a slash-command slot and does nothing.
3. **Seed/location mismatch (TF1/TA3)** — the only finding that corrupts *test results* rather than ergonomics: Trending-with-Friends silently tests as empty for Alice.
4. **Flow-list drift (TA1)** — hardcoded flow tables go stale; flow 20 (guest conversion — your monetization funnel) is currently invisible to /test-app. Generate from `ls`.
5. **Bundle-ID migration is a coupled change** — milestone #6 will break both test skills' simctl calls; bundle the skill updates into that PR.
6. **Merge de-rot** — until `chore/maestro-flow-de-rot` merges, /test-app on main runs known-stale flows; after it merges, test-app's "expect 03/09 stale" note must go.
7. **Launch-gate gap (opportunity):** nothing in the suite checks submission readiness. A tiny `/launch-gate` skill (or a test-app Step 2.5) doing cheap greps — icon files non-zero-byte, `eas.json` exists, prod URL is HTTPS, no `NSAllowsArbitraryLoads`, permission strings match used APIs, privacy-policy URL set — would have caught blockers B1/B3 automatically and keeps them from regressing before submission next month.
8. **Model/tool naming rot** — "Opus 4.8" trailers, `Task` tool. Harmless but worth a sweep; skills that name models age badly — prefer "the current orchestrator model."

## Suggested fix order (≈ one session)
1. RA1/RA2/AR1 — resolve the phantom skill + retarget or delete resolve-active-issues (unblocks nothing but removes traps)
2. TF1/TA3 seed-location fix + TA1 flow-list generation (test integrity)
3. Merge de-rot → delete TA2's stale note (do alongside PR #327 review)
4. Add `/launch-gate` checks (leverage: protects the entire launch month)
5. Hygiene sweep: .gitignore `.current-test-run`, delete .bak files, model/tool naming, 85% alignment, stale test count
