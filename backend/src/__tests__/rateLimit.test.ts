import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { MongoRateLimitStore } from '../utils/mongoRateLimitStore';
import { connectTestDB, disconnectTestDB } from './helpers/db';

// Simulate Fly: the app must trust exactly one proxy hop. Set before app loads.
process.env.FLY_APP_NAME = 'chewgather-backend-test';
process.env.RATE_LIMIT_IN_TESTS = '1';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../app').default as express.Express;

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => {
  delete process.env.RATE_LIMIT_IN_TESTS;
  delete process.env.FLY_APP_NAME;
  await disconnectTestDB();
});
beforeEach(async () => { await mongoose.connection.collection('ratelimits').deleteMany({}); });

const login = (ip: string) =>
  request(app).post('/auth/login').set('X-Forwarded-For', ip).send({ email: 'nobody@example.com', password: 'x' });

describe('client IP keying behind the Fly proxy', () => {
  it('trusts exactly one proxy hop', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  it('login limiter buckets per client IP, not per proxy', async () => {
    for (let i = 0; i < 5; i++) expect((await login('203.0.113.7')).status).not.toBe(429);
    expect((await login('203.0.113.7')).status).toBe(429);
    // A different client behind the same proxy is unaffected.
    expect((await login('203.0.113.8')).status).not.toBe(429);
  });

  it('ignores a client-forged leading X-Forwarded-For entry', async () => {
    // Fly appends the real client IP; only the rightmost entry is trusted.
    for (let i = 0; i < 5; i++) expect((await login(`10.0.0.${i}, 203.0.113.9`)).status).not.toBe(429);
    expect((await login('10.0.0.99, 203.0.113.9')).status).toBe(429);
  });
});

describe('MongoRateLimitStore', () => {
  const build = (windowMs = 60_000) => {
    const a = express();
    a.set('trust proxy', 1);
    a.use(rateLimit({ windowMs, limit: 3, store: new MongoRateLimitStore('shared'), validate: false }));
    a.get('/', (_req, res) => { res.json({ ok: true }); });
    return a;
  };

  it('is shared across independent app instances (two machines)', async () => {
    const machineA = build();
    const machineB = build();
    const hit = (a: express.Express) => request(a).get('/').set('X-Forwarded-For', '198.51.100.1');

    expect((await hit(machineA)).status).toBe(200);
    expect((await hit(machineB)).status).toBe(200);
    expect((await hit(machineA)).status).toBe(200);
    // 4th request lands on the other machine but still hits the shared bucket.
    expect((await hit(machineB)).status).toBe(429);
  });

  it('counts atomically under concurrent hits', async () => {
    const a = build();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(a).get('/').set('X-Forwarded-For', '198.51.100.2'))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(7);
  });

  it('starts a fresh window once the previous one expires', async () => {
    const a = build(300);
    const hit = () => request(a).get('/').set('X-Forwarded-For', '198.51.100.3');
    for (let i = 0; i < 3; i++) expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
    await new Promise((r) => setTimeout(r, 400));
    expect((await hit()).status).toBe(200);
  });

  it('keeps separate prefixes isolated', async () => {
    const other = express();
    other.set('trust proxy', 1);
    other.use(rateLimit({ windowMs: 60_000, limit: 3, store: new MongoRateLimitStore('other'), validate: false }));
    other.get('/', (_req, res) => { res.json({ ok: true }); });
    const shared = build();
    for (let i = 0; i < 3; i++) await request(shared).get('/').set('X-Forwarded-For', '198.51.100.4');
    expect((await request(shared).get('/').set('X-Forwarded-For', '198.51.100.4')).status).toBe(429);
    expect((await request(other).get('/').set('X-Forwarded-For', '198.51.100.4')).status).toBe(200);
  });
});
