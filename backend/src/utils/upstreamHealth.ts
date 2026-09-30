import mongoose from 'mongoose';

export type Upstream = 'googlePlaces' | 'cloudinary' | 'resend' | 'expoPush';
export const UPSTREAMS: Upstream[] = ['googlePlaces', 'cloudinary', 'resend', 'expoPush'];

export const WINDOW_MS = 15 * 60 * 1000;
const MIN_CALLS = 5;
const ERROR_RATE_LIMIT = 0.2;
const MAX_EVENTS = 5000;
const AUTH_QUOTA_CODES = new Set(['401', '403', '429', 'RESOURCE_EXHAUSTED']);

interface CallEvent { at: number; errorCode?: string }

const events: Record<Upstream, CallEvent[]> = {
  googlePlaces: [],
  cloudinary: [],
  resend: [],
  expoPush: [],
};

// Reduce an upstream failure to a short status/error code. Never returns messages,
// so nothing secret/PII/stack-like can reach the health output.
export function toErrorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    for (const key of ['statusCode', 'http_code', 'status', 'code', 'name']) {
      const v = e[key];
      if ((typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v))) {
        return String(v);
      }
    }
  }
  return 'UNKNOWN';
}

function prune(list: CallEvent[], now: number) {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < list.length && list[i].at < cutoff) i++;
  if (i > 0) list.splice(0, i);
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
}

export function recordUpstreamCall(upstream: Upstream, err?: unknown, now: number = Date.now()): void {
  const list = events[upstream];
  prune(list, now);
  list.push(err === undefined ? { at: now } : { at: now, errorCode: typeof err === 'string' ? err : toErrorCode(err) });
}

export function resetUpstreamWindows(): void {
  for (const u of UPSTREAMS) events[u].length = 0;
}

export interface UpstreamCheck {
  ok: boolean;
  calls: number;
  errors: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  note?: string;
}

export function checkUpstream(upstream: Upstream, now: number = Date.now()): UpstreamCheck {
  const list = events[upstream];
  prune(list, now);
  const calls = list.length;
  const failed = list.filter(e => e.errorCode !== undefined);
  const errors = failed.length;
  const last = failed[failed.length - 1];
  const highRate = calls >= MIN_CALLS && errors / calls > ERROR_RATE_LIMIT;
  const authOrQuota = !!last && AUTH_QUOTA_CODES.has(last.errorCode!);
  const check: UpstreamCheck = {
    ok: !highRate && !authOrQuota,
    calls,
    errors,
    lastErrorCode: last?.errorCode ?? null,
    lastErrorAt: last ? new Date(last.at).toISOString() : null,
  };
  if (upstream === 'googlePlaces') check.note = 'called from the client app; no backend call sites';
  return check;
}

export async function checkMongo(timeoutMs = 2000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  const db = mongoose.connection.db;
  if (!db) return { ok: false, latencyMs: 0, error: 'NOT_CONNECTED' };
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.admin().ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    const timedOut = err instanceof Error && err.message === 'timeout';
    return { ok: false, latencyMs: Date.now() - start, error: timedOut ? 'TIMEOUT' : toErrorCode(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runDeepHealth() {
  const checks: Record<string, { ok: boolean } & Record<string, unknown>> = {
    mongo: await checkMongo(),
  };
  for (const u of UPSTREAMS) checks[u] = checkUpstream(u) as unknown as { ok: boolean };
  return { ok: Object.values(checks).every(c => c.ok), checks };
}
