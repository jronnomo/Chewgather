# Sentry crash reporting (iOS)

The app uses `@sentry/react-native` (Expo config plugin). This is a **native module**, so it must be in the binary from the first production build (CHE-7).

## EAS secrets the human must set

Set all four in EAS (project `Chewgather`) and make them available to the `production` build profile (also `preview` if you want crash reports from internal builds):

| Variable | Purpose | If missing |
|----------|---------|------------|
| `EXPO_PUBLIC_SENTRY_DSN` | Where the app sends events (read in `lib/sentry.ts`). The DSN is not a secret, but keep it out of the repo. | `initSentry()` returns early: **crash reporting is silently off**. |
| `SENTRY_ORG` | Sentry org slug, used by the plugin's debug-symbol / source-map upload phase. | Plugin writes `ios/sentry.properties` with no org; no upload target. |
| `SENTRY_PROJECT` | Sentry project slug, same purpose. | Same as above. |
| `SENTRY_AUTH_TOKEN` | Sentry auth token (scopes: `project:releases`, `org:read`) for uploading symbols/source maps. **Secret visibility only.** | Same as above; never put it in `app.json` (the plugin strips and warns on an inline `authToken`). |

Set them at expo.dev → Chewgather project → Environment variables (or with `eas env:create`), environment `production`. `SENTRY_AUTH_TOKEN` should use secret visibility.

For local development, `EXPO_PUBLIC_SENTRY_DSN` can go in `.env`; leave it unset to disable reporting.

## Silent-failure warning

A missing DSN does **not** fail the build. It ships a production binary with crash reporting quietly turned off, and fixing it requires a new build. A missing org/project/token likewise produces a build with unsymbolicated crashes.

**Do not run the CHE-7 production build until all four variables are set in EAS.**

## Privacy

`sendDefaultPii: false`; screenshots and view hierarchy are not attached; `beforeSend` reduces the user to an opaque id and drops cookies, request bodies, auth headers and URL query strings; `beforeBreadcrumb` strips URL query strings.

## Notes

- `environment` is derived from `__DEV__` only, so `preview` builds report as `production`. If that becomes noisy, add an `EXPO_PUBLIC_SENTRY_ENV` variable.
