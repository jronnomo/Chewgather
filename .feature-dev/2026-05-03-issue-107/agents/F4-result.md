# F4 Agent Result — Issue #107 Card Accessibility Maestro Flow

## Files Created

| File | Description |
|------|-------------|
| `maestro/flows/issue-107-card-accessibility.yaml` | New regression flow proving all three card testID lifts work |

## Files Modified

| File | Change |
|------|--------|
| `maestro/flows/04-discover.yaml` | Swapped `tapOn: "Pizza"` to `tapOn: { id: "restaurant-card-.*" }` |
| `maestro/flows/12-restaurant-detail.yaml` | Swapped `tapOn: "Pizza"` to `tapOn: { id: "restaurant-card-.*" }` |
| `maestro/full-suite.yaml` | Added `issue-107-card-accessibility.yaml` to regression section after issue-094 |

## Selector Audit — Per Flow

### 04-discover.yaml
**Changed.** The `tapOn: "Pizza"` was inside a `when: visible: "Pizza"` guard — intent is "tap any restaurant card that appeared from pizza search", not "tap a card named Pizza". Swapped to `id: "restaurant-card-.*"` for determinism.

### 12-restaurant-detail.yaml
**Changed.** Same pattern as 04-discover — `tapOn: "Pizza"` guarded by `when: visible: "Pizza"`, intent is "enter any restaurant detail to test the detail screen". Swapped to `id: "restaurant-card-.*"`.

### 14-plan-filtering.yaml
**No change.** Flow only switches between Upcoming/Past/All filter tabs, no card taps at all.

### 10-plan-management.yaml
**No change.** Already uses `id: "plan-more-btn"` for the three-dot menu. The plan card itself is never tapped directly (the more-button is the entry point). No text-based card tap to replace.

### 17-plan-creation-full.yaml
**No change.** Flow creates a plan via the form and then checks the Plans list — no card taps in the flow.

## New Flow: issue-107-card-accessibility.yaml

Three-part structure:
1. **PlanCard** — Navigate to Plans tab, `assertVisible: { id: "plan-card-.*" }`, then `tapOn: { id: "plan-card-.*" }` to confirm it is tappable.
2. **RestaurantCard** — Navigate to Discover, `assertVisible: { id: "restaurant-card-.*" }`, then tap to confirm.
3. **SwipeCard** — Navigate Home → tap "Find a Spot, Swipe for restaurants" (accessibilityLabel) → tap "Start Swiping" → `extendedWaitUntil` + `assertVisible: { id: "swipe-card-.*" }`.

Uses the full standard sign-in-as-alice pattern from issue-094 (email/password flow, Not Now guard, onboarding guard, tab-bar stabilization).

Note on `eat-now-btn`: The Home screen "Find a Spot" action grid button (`ActionGridButton`) does not have a `testID` — it exposes an `accessibilityLabel` of `"Find a Spot, Swipe for restaurants"`. The flow uses that label for the tap. This is reliable since there is only one such button on the screen.

## TypeScript

`npx tsc --noEmit` — **0 errors**. No TS files were touched; confirmed clean compile.
