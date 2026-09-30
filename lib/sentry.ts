import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
const SENSITIVE_KEY = /token|password|authorization|secret|email|phone/i;

function scrubObject(obj: Record<string, unknown> | undefined): void {
  if (!obj) return;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEY.test(key)) obj[key] = '[Filtered]';
  }
}

// Exported for reuse in beforeSend; strips user identity and request secrets.
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const h of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.includes(h.toLowerCase())) delete event.request.headers[h];
      }
    }
    if (event.request.query_string && typeof event.request.query_string === 'string') {
      event.request.query_string = '[Filtered]';
    }
  }
  event.breadcrumbs?.forEach((b) => scrubObject(b.data));
  scrubObject(event.extra);
  return event;
}

export function initSentry(): void {
  if (!DSN) {
    if (__DEV__) console.warn('[Sentry] EXPO_PUBLIC_SENTRY_DSN is not set — crash reporting disabled');
    return;
  }
  Sentry.init({
    dsn: DSN,
    enabled: !__DEV__,
    environment: __DEV__ ? 'development' : 'production',
    release: `${Constants.expoConfig?.slug ?? 'chewgather'}@${Constants.expoConfig?.version ?? 'unknown'}`,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => {
      scrubObject(breadcrumb.data);
      // Request URLs can carry ids/tokens in the query string; keep path only.
      if (breadcrumb.data && typeof breadcrumb.data.url === 'string') {
        breadcrumb.data.url = breadcrumb.data.url.split('?')[0];
      }
      return breadcrumb;
    },
  });
}

export function setSentryUser(id: string | null): void {
  Sentry.setUser(id ? { id } : null);
}

export const captureException = Sentry.captureException;
export const wrap = Sentry.wrap;
