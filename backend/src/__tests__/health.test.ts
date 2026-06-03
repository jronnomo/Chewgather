import request from 'supertest';
import app from '../app';
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
