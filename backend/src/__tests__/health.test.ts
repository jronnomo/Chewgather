import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
import {
  WINDOW_MS,
  checkMongo,
  checkUpstream,
  recordUpstreamCall,
  resetUpstreamWindows,
} from '../utils/upstreamHealth';
import { connectTestDB, disconnectTestDB } from './helpers/db';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });

it('GET /health returns ok', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

it('GAP-002: responses carry Helmet security headers', async () => {
  const res = await request(app).get('/health');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  // helmet also sets frameguard (X-Frame-Options) and removes X-Powered-By
  expect(res.headers['x-frame-options']).toBeDefined();
  expect(res.headers['x-powered-by']).toBeUndefined();
});

describe('GET /health/deep', () => {
  const NOW = Date.now();

  beforeEach(() => resetUpstreamWindows());
  afterEach(() => jest.restoreAllMocks());

  function mockPing(impl: () => Promise<unknown>) {
    jest.spyOn(mongoose.connection.db!, 'admin').mockReturnValue({ ping: impl } as never);
  }

  it('returns 200, ok:true and all checks when healthy', async () => {
    const res = await request(app).get('/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Object.keys(res.body.checks).sort()).toEqual(['cloudinary', 'expoPush', 'googlePlaces', 'mongo', 'resend']);
    expect(res.body.checks.mongo.ok).toBe(true);
    expect(typeof res.body.checks.mongo.latencyMs).toBe('number');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports mongo failure with HTTP 200 and no raw error message', async () => {
    mockPing(() => Promise.reject(new Error('connect ECONNREFUSED mongodb://user:secret@host')));
    const res = await request(app).get('/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.checks.mongo.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|ECONNREFUSED|mongodb:\/\//);
  });

  it('times out a hung mongo ping', async () => {
    mockPing(() => new Promise(() => undefined));
    const result = await checkMongo(50);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TIMEOUT');
  });

  it('is ok when an upstream has few calls, even if they all failed', () => {
    for (let i = 0; i < 4; i++) recordUpstreamCall('resend', { statusCode: 500 }, NOW);
    expect(checkUpstream('resend', NOW).ok).toBe(true);
  });

  it('flags an upstream when errors/calls > 20% with >= 5 calls', () => {
    for (let i = 0; i < 7; i++) recordUpstreamCall('cloudinary', undefined, NOW);
    for (let i = 0; i < 3; i++) recordUpstreamCall('cloudinary', { http_code: 500 }, NOW);
    const c = checkUpstream('cloudinary', NOW);
    expect(c).toMatchObject({ ok: false, calls: 10, errors: 3, lastErrorCode: '500' });
  });

  it('stays ok at exactly 20% errors', () => {
    for (let i = 0; i < 4; i++) recordUpstreamCall('cloudinary', undefined, NOW);
    recordUpstreamCall('cloudinary', { http_code: 500 }, NOW);
    expect(checkUpstream('cloudinary', NOW).ok).toBe(true);
  });

  it.each(['401', '403', '429', 'RESOURCE_EXHAUSTED'])('flags an auth/quota error (%s) even with one call', code => {
    recordUpstreamCall('expoPush', code, NOW);
    const c = checkUpstream('expoPush', NOW);
    expect(c.ok).toBe(false);
    expect(c.lastErrorCode).toBe(code);
  });

  it('drops events older than the 15 minute window', () => {
    recordUpstreamCall('resend', { statusCode: 401 }, NOW - WINDOW_MS - 1000);
    const c = checkUpstream('resend', NOW);
    expect(c).toMatchObject({ ok: true, calls: 0, errors: 0, lastErrorCode: null, lastErrorAt: null });
  });

  it('surfaces unhealthy upstream in /health/deep without leaking upstream messages', async () => {
    recordUpstreamCall('resend', { statusCode: 403, message: 'API key re_secret123 is invalid' });
    const res = await request(app).get('/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.checks.resend).toMatchObject({ ok: false, calls: 1, errors: 1, lastErrorCode: '403' });
    expect(res.body.checks.mongo.ok).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/re_secret123|invalid/);
  });

  it('never puts non-code text from an error into lastErrorCode', () => {
    recordUpstreamCall('resend', { message: 'user@example.com failed', name: 'has spaces & PII' }, NOW);
    expect(checkUpstream('resend', NOW).lastErrorCode).toBe('UNKNOWN');
  });

  it('returns 503 only when the handler itself fails', async () => {
    const mod = await import('../utils/upstreamHealth');
    jest.spyOn(mod, 'runDeepHealth').mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/health/deep');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });
});
