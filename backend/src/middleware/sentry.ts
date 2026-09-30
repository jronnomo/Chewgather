import type { ErrorRequestHandler, RequestHandler } from 'express';
import * as Sentry from '@sentry/node';

const CAPTURED = Symbol('sentryCaptured');
type Flagged = { [CAPTURED]?: true };

// Routes that catch their own errors and reply 5xx never reach the error handler,
// so report the response itself. No-op when Sentry has no client (SENTRY_DSN unset).
export const captureServerErrorResponses: RequestHandler = (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 500 || (res as Flagged)[CAPTURED]) return;
    Sentry.captureMessage(`HTTP ${res.statusCode} ${req.method} ${req.route?.path ?? req.path}`, {
      level: 'error',
      tags: { http_status: String(res.statusCode) },
    });
  });
  next();
};

export const captureServerErrors: ErrorRequestHandler = (err, _req, res, next) => {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode
    ?? 500;
  if (status >= 500) {
    Sentry.captureException(err);
    (res as Flagged)[CAPTURED] = true;
  }
  next(err);
};
