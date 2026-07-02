#!/bin/bash
# Discovery runner: run every flow individually, capture pass/fail, continue past
# failures. Non-signout flows first (preserve signed-in state from 01-auth), then
# signout/clearState flows last (each self-auths or legitimately ends signed out).
# Closes RN DevTools between every flow (LESSONS #11).
export PATH="$PATH":"$HOME/.maestro/bin"
source "$HOME/.sdkman/bin/sdkman-init.sh" 2>/dev/null
cd "$(dirname "$0")/.."

CLOSE=".claude/skills/test-app/close-devtools.sh"
RESULTS="/tmp/chewgather-flow-results.txt"
: > "$RESULTS"

# Fresh seed so stateful regression flows (issue-002/088/094) run against clean
# fixtures. Seed deletes+recreates users → cached token invalid → 01-auth (first
# flow) re-auths via its sign-in fallback.
echo "seeding..." | tee -a "$RESULTS"
( cd backend && npx ts-node src/seed-reset.ts >/tmp/seed-batch.log 2>&1 ) \
  && echo "seed OK" | tee -a "$RESULTS" \
  || { echo "seed FAILED — aborting" | tee -a "$RESULTS"; exit 1; }

run() {
  local f="maestro/flows/$1.yaml"
  bash "$CLOSE" 2>/dev/null
  if maestro test "$f" >/tmp/flow-out.log 2>&1; then
    echo "PASS  $1" | tee -a "$RESULTS"
  else
    local why
    why=$(grep -iE "FAILED|not found|not visible|Assertion is false" /tmp/flow-out.log | head -1 | tr -s ' ' | cut -c1-110)
    echo "FAIL  $1  ::  $why" | tee -a "$RESULTS"
    cp /tmp/flow-out.log "/tmp/chewgather-fail-$1.log" 2>/dev/null
  fi
}

# Signed-in, non-destructive flows (keep auth state)
for f in 01-auth \
         issue-001-rsvp-deadline-validation \
         issue-002-no-double-member-add \
         issue-069-past-date-plan-tab \
         issue-088-cuisine-filtered-swipe \
         issue-094-vote-submission-autostart \
         issue-107-card-accessibility \
         02-navigation 03-swipe 04-discover 05-plans 06-friends 07-dark-mode 08-group-session \
         09-solo-swipe-full 10-plan-management 11-notification-center 12-restaurant-detail \
         14-plan-filtering 16-discover-filters 17-plan-creation-full 19-friends-full ; do
  run "$f"
done

# Sign-out / clearState flows last (each handles its own auth)
for f in 13-profile-settings \
         issue-309-request-to-join-approve \
         issue-152-doggy-bag-migration \
         issue-152-guest-favorites-leak \
         20-guest-conversion-funnel \
         15-onboarding-full 18-guest-mode ; do
  run "$f"
done

echo "===== DONE =====" | tee -a "$RESULTS"
echo "PASS: $(grep -c '^PASS' "$RESULTS")  FAIL: $(grep -c '^FAIL' "$RESULTS")" | tee -a "$RESULTS"
