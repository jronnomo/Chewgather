/**
 * Budget kill switch — disables the Places API (New) when a Cloud Billing
 * budget is exceeded.
 *
 * Triggered by a Pub/Sub message that a Cloud Billing budget publishes. When the
 * reported cost exceeds the budget amount, it calls the Service Usage API to
 * DISABLE the target service (default: places.googleapis.com) on the project.
 * Everything else in the project keeps running. Re-enable with:
 *     gcloud services enable places.googleapis.com --project=YOUR_PROJECT_ID
 *
 * Deploy as a Gen-2 Cloud Function with --trigger-topic (see README.md).
 * The function's runtime service account needs roles/serviceusage.serviceUsageAdmin.
 */
const { ServiceUsageClient } = require('@google-cloud/service-usage');

const client = new ServiceUsageClient();

// Gen-2 (Cloud Run) does NOT reliably set GOOGLE_CLOUD_PROJECT, so pass the
// project id explicitly at deploy time via GCP_PROJECT_ID. Fall back to the
// auto-set vars for Gen-1 / other runtimes.
const PROJECT_ID =
  process.env.GCP_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT;
if (!PROJECT_ID) {
  throw new Error('No project id — set GCP_PROJECT_ID env var on the function');
}
// Places API (New) = places.googleapis.com. Override via env var if needed.
const TARGET_SERVICE = process.env.TARGET_SERVICE || 'places.googleapis.com';

/**
 * Pull the base64 Pub/Sub payload out of either the Gen-2 CloudEvent shape
 * (cloudEvent.data.message.data) or the Gen-1 shape (message.data).
 */
function decodeBudgetMessage(arg) {
  const b64 =
    arg?.data?.message?.data ?? // Gen 2 CloudEvent
    arg?.data ?? // Gen 1 (message, context)
    null;
  if (!b64) throw new Error('No Pub/Sub data found on the event');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

exports.killPlacesOnBudget = async (event) => {
  const budget = decodeBudgetMessage(event);
  const { costAmount, budgetAmount, budgetDisplayName, currencyCode } = budget;

  // Budgets publish on every cost update, not only when exceeded — guard here.
  if (!(Number(costAmount) > Number(budgetAmount))) {
    console.log(
      `Under budget "${budgetDisplayName}": ${costAmount}/${budgetAmount} ${currencyCode}. No action.`
    );
    return;
  }

  const name = `projects/${PROJECT_ID}/services/${TARGET_SERVICE}`;
  console.warn(
    `Budget "${budgetDisplayName}" EXCEEDED: ${costAmount} > ${budgetAmount} ${currencyCode}. Disabling ${TARGET_SERVICE}…`
  );

  try {
    const [operation] = await client.disableService({
      name,
      // keep other services that depend on it running; we only want Places off
      disableDependentServices: false,
    });
    await operation.promise();
    console.warn(`✅ Disabled ${TARGET_SERVICE} on ${PROJECT_ID}.`);
  } catch (err) {
    // If it's already disabled, that's fine.
    if (String(err.message || '').includes('not currently enabled')) {
      console.log(`${TARGET_SERVICE} already disabled.`);
      return;
    }
    console.error(`Failed to disable ${TARGET_SERVICE}:`, err);
    throw err; // let it retry
  }
};
