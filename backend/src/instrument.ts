// Must be imported before anything else in index.ts so Sentry hooks process-level handlers first.
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { scrubEvent } from './utils/sentryScrub';

dotenv.config();

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE || process.env.GIT_SHA || process.env.FLY_IMAGE_REF || undefined,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
