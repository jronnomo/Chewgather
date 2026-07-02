# Places API budget kill switch

Hard-stops the **Places API (New)** when a Cloud Billing **budget** is exceeded,
by disabling only that service (the rest of the project keeps running).

```
Billing budget exceeded ──▶ Pub/Sub topic ──▶ Cloud Function ──▶ disable places.googleapis.com
```

> ⚠️ **Lag caveat.** A budget fires off *reported* cost, which trails real usage
> by hours. So this is a **circuit breaker, not a real-time cap** — you can still
> overshoot a bit before it trips. Pair it with a **daily quota cap** on the
> Places API (APIs & Services → Places API (New) → Quotas → Requests per day) for
> a real-time ceiling. Use this kill switch as the backstop.

---

## 0. Prerequisites

- **Find your GCP project ID** — the project that owns the Places API key
  (`AIzaSy…` in `.env`). In the [console](https://console.cloud.google.com) it's
  in the project picker (top bar) or under *IAM & Admin → Settings*. It looks like
  `chewgether-1234`, **not** the Expo `EXPO_PUBLIC_PROJECT_ID` uuid.
- **Permissions:** Project **Owner**, or these roles: Cloud Functions Admin,
  Pub/Sub Admin, Service Usage Admin, plus **Billing Account Administrator** (to
  create the budget).
- **Install gcloud** (not on this machine yet):
  ```bash
  brew install --cask google-cloud-sdk
  gcloud auth login
  gcloud auth application-default login
  ```

Set your project once so the commands below can use `$PROJECT`:
```bash
export PROJECT=YOUR_PROJECT_ID
export REGION=us-central1
gcloud config set project "$PROJECT"
```

## 1. Enable the APIs this setup needs
```bash
gcloud services enable \
  cloudbilling.googleapis.com \
  cloudbudgets.googleapis.com \
  serviceusage.googleapis.com \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  logging.googleapis.com
```

## 2. Create the Pub/Sub topic the budget will publish to
```bash
gcloud pubsub topics create places-budget-alerts
```

## 3. Deploy the Cloud Function (from this folder)
```bash
cd infra/places-budget-killswitch
gcloud functions deploy kill-places-on-budget \
  --gen2 \
  --runtime=nodejs20 \
  --region="$REGION" \
  --source=. \
  --entry-point=killPlacesOnBudget \
  --trigger-topic=places-budget-alerts \
  --set-env-vars=TARGET_SERVICE=places.googleapis.com \
  --max-instances=1
```

## 4. Let the function disable services
Grant the function's **runtime service account** permission to toggle services.
Find the account, then bind the role:
```bash
SA=$(gcloud functions describe kill-places-on-budget --gen2 --region="$REGION" \
      --format='value(serviceConfig.serviceAccountEmail)')
echo "Function runs as: $SA"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" \
  --role="roles/serviceusage.serviceUsageAdmin"
```

## 5. Create the budget wired to the topic
Get your billing account id:
```bash
gcloud billing accounts list   # copy the ACCOUNT_ID (XXXXXX-XXXXXX-XXXXXX)
export BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX
```

Create a **$100/mo** budget scoped to this project that pings the topic at 100%
(adjust the amount). `percent=1.0` = 100%; add more `--threshold-rule`s for early
warnings:
```bash
gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="Places API cap" \
  --budget-amount=100USD \
  --filter-projects="projects/$PROJECT" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --all-updates-rule-pubsub-topic="projects/$PROJECT/topics/places-budget-alerts"
```

**To cap only Maps/Places spend** (not total project), scope the budget to the
Maps Platform services. Easiest in the **Console**: *Billing → Budgets & alerts →
Create budget → Scope → Services → select the Places/Maps SKUs*, then under
*Manage notifications* tick **“Connect a Pub/Sub topic to this budget”** and pick
`places-budget-alerts`. (CLI: add `--filter-services=<service-id>`.)

## 6. Test it without spending money
Publish a fake "over budget" message straight to the topic:
```bash
gcloud pubsub topics publish places-budget-alerts \
  --message='{"budgetDisplayName":"TEST","costAmount":999,"budgetAmount":100,"currencyCode":"USD"}'

# watch it fire
gcloud functions logs read kill-places-on-budget --gen2 --region="$REGION" --limit=20
```
You should see “Disabling places.googleapis.com”. **Re-enable immediately** (next
step) since that test really disables the API.

## 7. Re-enable after a trip (or the test)
```bash
gcloud services enable places.googleapis.com --project="$PROJECT"
```
Or in the Console: *APIs & Services → Places API (New) → Enable*.

---

## How it behaves
- The budget publishes to the topic on **every cost update** (several times/day),
  not only when exceeded — the function guards with `costAmount > budgetAmount`,
  so it only acts once you're actually over.
- It disables **only** `places.googleapis.com`. The app's Places calls will start
  returning errors; the rest of the project (backend, Cloud Functions, etc.) is
  untouched.
- Disabling the API does **not** auto-re-enable next month — re-enable manually
  (step 7) once you've confirmed spend reset / raised the budget.

## Also do this (bigger lever than the kill switch)
Your Places key is shipped in the app bundle (`EXPO_PUBLIC_…`). Restrict it so a
leaked key can't run up usage:
*APIs & Services → Credentials → (the key) →*
- **API restrictions:** allow only *Places API (New)* (+ any Maps APIs you use)
- **Application restrictions:** iOS bundle id / Android package / HTTP referrers
